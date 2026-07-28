import { useEffect, useRef, useState } from 'react';
import type { BpAction, BpState, PlayerId } from './engine.ts';
import { act, createGame, gameWinner, legalInfo, nextHand, potSize } from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import ChatPanel from '../../net/ChatPanel.tsx';
import PokerLayout, { BetSlider, PkCard, PkOverlay, PkResult, useMood } from '../shared/pokerui.tsx';
import './blindpoker.css';
import '../../net/online.css';

/**
 * 블라인드 포커 온라인 대전 — 호스트 권위 방식.
 *
 * 이 게임의 은닉은 방향이 반대다: 상대 카드는 보이고 **내 카드만 내가 못 본다**.
 * 그래서 좌석별 뷰에서 자기 카드를 가리고(핸드가 끝나 공개될 때까지), 덱은 통째로
 * 제거한다(다음에 나올 카드를 알면 카운팅이 무의미해지므로).
 */

const HIDDEN = 0;

interface BpView {
  s: BpState;
  /** 이번 핸드에서 내 카드가 공개됐는가 */
  myCardShown: boolean;
}

type NetMsg =
  /** 선공 동전 결과 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' } | { t: 'view'; v: BpView } | { t: 'act'; a: BpAction } | { t: 'next' };

function viewFor(s: BpState, seat: PlayerId): BpView {
  const revealed = s.phase !== 'betting';
  const cards = [s.cards[0], s.cards[1]] as [number, number];
  if (!revealed) cards[seat] = HIDDEN;
  return { s: { ...s, deck: [], cards }, myCardShown: revealed };
}

export default function BlindPokerOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<BpState | null>(null);
  const [view, setView] = useState<BpView | null>(null);
  /** 레이즈 총액 (상대 베팅 + 증분) — 렌더 시 범위로 클램프 */
  const [raiseTo, setRaiseTo] = useState(1);
  const [mood, setMood] = useMood();
  const [oppLeft, setOppLeft] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);

  function hostApply(next: BpState) {
    stateRef.current = next;
    setView(viewFor(next, 0));
    room.send({ t: 'view', v: viewFor(next, 1) } satisfies NetMsg);
  }

  function hostAct(s: BpState, actor: PlayerId, a: BpAction): BpState | null {
    if (s.phase !== 'betting' || s.toAct !== actor) return null;
    try {
      return act(s, a);
    } catch {
      return null;
    }
  }

  /** (호스트) 선공을 뽑아 양쪽에 동전을 띄운다 */
  function tossFirst(): PlayerId {
    const first: PlayerId = Math.random() < 0.5 ? 0 : 1;
    lastToss.current = first;
    room.send({ t: 'toss', first } satisfies NetMsg);
    setToss(first);
    return first;
  }

  useEffect(() => {
    const offMsg = room.onMsg((raw) => {
      const msg = raw as NetMsg;
      if (msg.t === 'toss') {
        setToss(msg.first);
        return;
      }
      // 호스트가 게스트 입장 전에 보낸 동전은 버려지므로 다시 알린다
      if (room.isHost && msg.t === 'ready' && lastToss.current !== null) {
        room.send({ t: 'toss', first: lastToss.current } satisfies NetMsg);
      }
      if (room.isHost) {
        const s = stateRef.current;
        if (!s) return;
        if (msg.t === 'ready') {
          room.send({ t: 'view', v: viewFor(s, 1) } satisfies NetMsg);
        }
        if (msg.t === 'act') {
          const next = hostAct(s, 1, msg.a);
          if (next) hostApply(next);
        }
        if (msg.t === 'next' && s.phase === 'result') {
          hostApply(nextHand(s));
        }
      } else if (msg.t === 'view') {
        setView(msg.v);
      }
    });
    const offPeers = room.onPeers((count) => {
      if (count === 0) setOppLeft(true);
    });
    if (room.isHost) hostApply(createGame(tossFirst()));
    else room.send({ t: 'ready' } satisfies NetMsg);
    return () => {
      offMsg();
      offPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exit() {
    room.leave();
    onExit();
  }

  function doAct(a: BpAction) {
    if (room.isHost) {
      const s = stateRef.current;
      if (!s) return;
      const next = hostAct(s, 0, a);
      if (next) hostApply(next);
    } else {
      room.send({ t: 'act', a } satisfies NetMsg);
    }
    setRaiseTo(1);
  }

  function proceedNextHand() {
    if (room.isHost) {
      const s = stateRef.current;
      if (s && s.phase === 'result') hostApply(nextHand(s));
    } else {
      room.send({ t: 'next' } satisfies NetMsg);
    }
    setRaiseTo(1);
  }

  if (toss !== null) {
    return (
      <CoinToss
        mode="show"
        first={toss === me ? 0 : 1}
        labels={['나', '상대']}
        onDone={() => setToss(null)}
      />
    );
  }

  if (!view) {
    return (
      <div className="bp-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
        <ChatPanel room={room} />
      </div>
    );
  }

  const state = view.s;
  const info = state.phase === 'betting' ? legalInfo(state) : null;
  const myTurn = state.phase === 'betting' && state.toAct === me;
  const lastHand = state.history[state.history.length - 1];
  const winner = state.phase === 'gameover' ? gameWinner(state) : null;

  const oppBet = state.invested[opp];
  const minTo = oppBet + 1;
  const maxTo = info ? oppBet + info.maxRaise : minTo;
  const rv = Math.min(Math.max(raiseTo, minTo), Math.max(minTo, maxTo));
  const noRaise = !info || info.maxRaise < 1;

  const panel = (
    <>
      {state.phase === 'betting' && !myTurn && <div className="pk-thinking">상대가 고민 중…</div>}
      {myTurn && info && (
        <>
          <div className="pk-status">
            {info.callCost > 0
              ? `콜하려면 ${info.callCost} 필요 · 10을 들고 폴드하면 −10`
              : '베팅 동액 — 콜하면 즉시 공개됩니다'}
          </div>
          {!noRaise && <BetSlider value={rv} min={minTo} max={maxTo} onChange={setRaiseTo} />}
          <div className="pk-actions three">
            <button className="pk-btn fold" onClick={() => doAct({ type: 'fold' })}>
              폴드
            </button>
            <button className="pk-btn solid" onClick={() => doAct({ type: 'call' })}>
              {info.callCost > 0 ? `콜 ${info.callCost}` : '콜 (공개)'}
            </button>
            <button
              className="pk-btn ac"
              disabled={noRaise}
              onClick={() => doAct({ type: 'raise', amount: rv - oppBet })}
            >
              레이즈 {rv}
            </button>
          </div>
        </>
      )}
      {state.phase === 'result' && lastHand && (
        <PkResult
          left={String(lastHand.cards[opp])}
          right={
            lastHand.outcome !== 'fold' || lastHand.folder === me
              ? String(lastHand.cards[me])
              : '?'
          }
          text={
            lastHand.outcome === 'draw'
              ? '무승부 — 팟이 다음 핸드로 이월됩니다'
              : lastHand.outcome === 'showdown'
                ? lastHand.winner === me
                  ? `승리! +${lastHand.potWon}칩`
                  : `패배 −${lastHand.potWon}칩`
                : lastHand.folder === me
                  ? `폴드 — 상대가 팟을 가져갑니다${lastHand.penalty ? ' (10 페널티 −10칩)' : ''}`
                  : `상대 폴드 — +${lastHand.potWon}칩${lastHand.penalty ? ' (상대 10 페널티)' : ''}`
          }
          onNext={proceedNextHand}
        />
      )}
    </>
  );

  return (
    <PokerLayout
      mood={mood}
      onMood={setMood}
      header={
        <>
          <GameHeader onExit={exit} />
          <div className="online-status">
            <span className={`dot ${oppLeft ? 'off' : ''}`} />
            방 {room.code} · {room.isHost ? '호스트' : '게스트'}
          </div>
        </>
      }
      handNo={state.handNo}
      opp={{ name: '상대', turn: state.phase === 'betting' && state.toAct === opp, stack: state.stacks[opp] }}
      me={{ name: '나', turn: state.phase === 'betting' && state.toAct === me, stack: state.stacks[me] }}
      oppCard={<PkCard value={state.cards[opp]} caption="내게만 보임" />}
      myCard={
        view.myCardShown ? (
          <PkCard value={state.cards[me]} caption="공개됨" />
        ) : (
          <PkCard hidden caption="나만 못 봄" captionAccent />
        )
      }
      oppBet={state.invested[opp]}
      myBet={state.invested[me]}
      pot={state.phase === 'betting' ? potSize(state) : lastHand?.potWon ?? 0}
      carried={state.carried}
      panel={panel}
    >
      {state.phase === 'gameover' && (
        <PkOverlay
          title={winner === me ? '🏆 승리!' : '패배…'}
          sub={`최종 칩 — 나 ${state.stacks[me]} : 상대 ${state.stacks[opp]}`}
        >
          <div className="end-actions">
            {room.isHost ? (
              <button className="primary-btn" onClick={() => hostApply(createGame(tossFirst()))}>
                다시 대전
              </button>
            ) : (
              <p className="online-hint">호스트가 재대결을 시작할 수 있습니다</p>
            )}
            <button className="ghost-btn" onClick={exit}>
              로비로
            </button>
          </div>
        </PkOverlay>
      )}
      {oppLeft && state.phase !== 'gameover' && (
        <div className="online-notice-overlay">
          <div className="online-notice">
            <p>상대의 연결이 끊어졌습니다</p>
            <button className="primary-btn" onClick={exit}>
              로비로
            </button>
          </div>
        </div>
      )}
      <ChatPanel room={room} />
    </PokerLayout>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">블라인드 포커 · 온라인</span>
    </header>
  );
}
