import { useEffect, useRef, useState } from 'react';
import type { BhAction, BhState, PlayerId } from './engine.ts';
import {
  act,
  createGame,
  gameWinner,
  handRank,
  legalInfo,
  nextHand,
  potSize,
  riskProfile,
} from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import ChatPanel from '../../net/ChatPanel.tsx';
import {
  BetSlider,
  MoodPills,
  MoodScope,
  PkCard,
  PkOverlay,
  useMood,
} from '../shared/pokerui.tsx';
import { CommunityCards, RankTag, RiskBadge, riskNote } from './holdemui.tsx';
import { resultDetail, resultText } from './BlindHoldemGame.tsx';
import './holdem.css';
import '../../net/online.css';

/**
 * 블라인드 홀덤 온라인 대전 — 호스트 권위 방식.
 *
 * 은닉은 블라인드 포커와 같은 방향이다: 공유 카드와 상대 이마는 보이고
 * **내 이마만 내가 못 본다**. 그래서 좌석별 뷰에서 자기 이마를 가리고,
 * 덱은 통째로 제거한다(다음에 나올 카드를 알면 카운팅이 무의미해지므로).
 */

const HIDDEN = 0;

interface BhView {
  s: BhState;
  /** 이번 핸드에서 내 이마가 공개됐는가 */
  myCardShown: boolean;
}

type NetMsg =
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' }
  | { t: 'view'; v: BhView }
  | { t: 'act'; a: BhAction }
  | { t: 'next' };

function viewFor(s: BhState, seat: PlayerId): BhView {
  const revealed = s.phase !== 'betting';
  const cards = [s.cards[0], s.cards[1]] as [number, number];
  if (!revealed) cards[seat] = HIDDEN;
  // 과거 기록도 마스킹: 상대가 폴드한 핸드의 내 이마는 영구 비공개
  const history = s.history.map((h) => {
    if (h.outcome !== 'fold' || h.folder === seat) return h;
    const masked: [number, number] = [h.cards[0], h.cards[1]];
    masked[seat] = HIDDEN;
    return { ...h, cards: masked };
  });
  return { s: { ...s, deck: [], cards, history }, myCardShown: revealed };
}

export default function BlindHoldemOnline({
  room,
  onExit,
}: {
  room: NetRoom;
  onExit: () => void;
}) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<BhState | null>(null);
  const [view, setView] = useState<BhView | null>(null);
  const [raiseTo, setRaiseTo] = useState(1);
  const [mood, setMood] = useMood();
  const [oppLeft, setOppLeft] = useState(false);
  const [toss, setToss] = useState<PlayerId | null>(null);
  const lastToss = useRef<PlayerId | null>(null);

  function hostApply(next: BhState) {
    stateRef.current = next;
    setView(viewFor(next, 0));
    room.send({ t: 'view', v: viewFor(next, 1) } satisfies NetMsg);
  }

  function hostAct(s: BhState, actor: PlayerId, a: BhAction): BhState | null {
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

  function doAct(a: BhAction) {
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
      <div className="bh-root">
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
  const last = state.history[state.history.length - 1];
  const showResult = state.phase === 'result' && last;
  const winner = state.phase === 'gameover' ? gameWinner(state) : null;

  const community = showResult ? last.community : state.community;
  const risk = riskProfile(community);
  const oppRank = handRank(community, state.cards[opp]);

  const oppBet = state.invested[opp];
  const minTo = oppBet + 1;
  const maxTo = info ? oppBet + info.maxRaise : minTo;
  const rv = Math.min(Math.max(raiseTo, minTo), Math.max(minTo, maxTo));
  const noRaise = !info || info.maxRaise < 1;
  const myRevealed = !!showResult && (last.outcome !== 'fold' || last.folder === me);

  const panel = (
    <>
      {state.phase === 'betting' && !myTurn && <div className="pk-thinking">상대가 고민 중…</div>}
      {myTurn && info && (
        <>
          <div className="pk-status">
            {riskNote(risk)}
            <br />
            {info.callCost > 0
              ? `콜하려면 ${info.callCost} 필요합니다.`
              : '베팅 동액 — 콜하면 즉시 공개됩니다.'}
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
      {showResult && (
        <div className="bh-result">
          <div className="txt">{resultText(last, me)}</div>
          <div className="sub">{resultDetail(last, me, opp)}</div>
          <button className="pk-btn ac next" onClick={proceedNextHand}>
            다음 핸드
          </button>
        </div>
      )}
    </>
  );

  return (
    <MoodScope mood={mood}>
      <div className="pk-col bh-col">
        <GameHeader onExit={exit} />
        <div className="online-status">
          <span className={`dot ${oppLeft ? 'off' : ''}`} />
          방 {room.code} · {room.isHost ? '호스트' : '게스트'}
        </div>
        <div className="pk-handrow">HAND {String(state.handNo).padStart(2, '0')}</div>

        <div className="pk-seat">
          <div className="pk-seat-left">
            {state.phase === 'betting' && !myTurn && <span className="pk-dot" />}
            <span className="pk-seat-name">상대</span>
            <RankTag rank={oppRank} label="상대" />
          </div>
          <div className="pk-seat-right">
            <span className="k">칩</span>
            <span className="v">{state.stacks[opp]}</span>
          </div>
        </div>

        <div className="pk-center">
          <div className="pk-zone">
            <PkCard value={state.cards[opp]} caption="상대의 이마 — 내게만 보임" />
            <span className="pk-bet-pill">
              베팅 <b>{state.invested[opp]}</b>
            </span>
          </div>

          <div className="bh-mid">
            <CommunityCards cards={community} />
            <RiskBadge risk={risk} />
            <div className="pk-pot">
              <span className="pk-pot-label">팟</span>
              <span className="pk-pot-num">
                {state.phase === 'betting' ? potSize(state) : (last?.potWon ?? 0)}
              </span>
              {state.carried > 0 && <span className="pk-pot-carry">이월 +{state.carried}</span>}
            </div>
          </div>

          <div className="pk-zone">
            <span className="pk-bet-pill">
              내 베팅 <b>{state.invested[me]}</b>
            </span>
            {myRevealed && last.cards[me] !== HIDDEN ? (
              <PkCard value={last.cards[me]} caption="내 이마 — 공개됨" />
            ) : (
              <PkCard hidden caption="내 이마 — 나만 못 봄" captionAccent />
            )}
          </div>
        </div>

        <div className="pk-seat">
          <div className="pk-seat-left">
            {myTurn && <span className="pk-dot" />}
            <span className="pk-seat-name">나</span>
          </div>
          <div className="pk-seat-right">
            <span className="k">칩</span>
            <span className="v">{state.stacks[me]}</span>
          </div>
        </div>

        <div className="pk-panel">{panel}</div>
        <MoodPills mood={mood} onMood={setMood} />

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
      </div>
    </MoodScope>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>
        ← 로비
      </button>
      <span className="game-title">블라인드 홀덤 · 온라인</span>
    </header>
  );
}
