import { useEffect, useRef, useState } from 'react';
import type { BpAction, BpState, PlayerId } from './engine.ts';
import { act, createGame, gameWinner, legalInfo, nextHand, potSize, seenCards } from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import ChatPanel from '../../net/ChatPanel.tsx';
import BettingTable, { ActionBtn, ChipTray, PlayCard, RailTitle } from '../shared/BettingTable.tsx';
import { accumulateTendency, emptyTendency, seatBadge, TendencyPanel } from './insight.tsx';
import type { Tendency } from './insight.tsx';
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
  const [raiseAmt, setRaiseAmt] = useState(1);
  const [oppLeft, setOppLeft] = useState(false);
  const [tend, setTend] = useState<Tendency>(emptyTendency);
  const tendHands = useRef(0);
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

  // 상대 성향 집계 — 핸드가 끝날 때마다 상대 행동 누적, 재대결 시 리셋
  useEffect(() => {
    const s = view?.s;
    if (!s) return;
    if (s.phase === 'result' && s.history.length > tendHands.current) {
      tendHands.current = s.history.length;
      setTend((t) => {
        const next = { ...t };
        accumulateTendency(next, s, opp);
        return next;
      });
    }
    if (s.handNo === 1 && s.history.length === 0 && tendHands.current > 0) {
      tendHands.current = 0;
      setTend(emptyTendency());
    }
  }, [view, opp]);

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
  }

  function proceedNextHand() {
    if (room.isHost) {
      const s = stateRef.current;
      if (s && s.phase === 'result') hostApply(nextHand(s));
    } else {
      room.send({ t: 'next' } satisfies NetMsg);
    }
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

  // 내가 본 카드 (내 카드는 가려져 있으므로 seenCards가 자연히 제외한다)
  const seen = seenCards(state, me);
  const seenCount = new Array<number>(11).fill(0);
  for (const c of seen) seenCount[c] += 1;

  // 레이즈는 "총액" 개념 — raiseAmt(증분)을 저장하되 표시는 총액(상대 베팅 + 증분)
  const amt = info ? Math.max(1, Math.min(raiseAmt, info.maxRaise)) : 1;
  const oppBet = state.invested[opp];
  const raiseTo = oppBet + amt;
  const minTo = oppBet + 1;
  const maxTo = info ? oppBet + info.maxRaise : minTo;
  const raiseNow = () => doAct({ type: 'raise', amount: amt });

  const lastOppRaise = [...state.actions]
    .reverse()
    .find((a) => a.player === opp && a.action.type === 'raise')?.action.amount;

  const leftRail = (
    <>
      <RailTitle>핸드 로그</RailTitle>
      {state.history.length === 0 ? (
        <p className="bta-rail-note">아직 기록이 없습니다</p>
      ) : (
        <div className="bta-log">
          {state.history.slice(-8).map((h, i) => {
            const idx = state.history.length - Math.min(8, state.history.length) + i;
            const myCardKnown = h.outcome !== 'fold' || h.folder === me;
            const what =
              h.outcome === 'draw'
                ? '무승부 이월'
                : h.outcome === 'fold'
                  ? `${h.folder === me ? '나' : '상대'} 폴드${h.penalty ? ' ⚠' : ''}`
                  : '쇼다운';
            return (
              <div key={idx} className="bta-log-row">
                <span className="no">#{idx + 1}</span>
                <span className="what">
                  나 {myCardKnown ? h.cards[me] : '?'} · 상대 {h.cards[opp]} · {what}
                </span>
                <span className={`amt ${h.winner === me ? 'win' : h.winner === opp ? 'lose' : ''}`}>
                  {h.winner !== undefined ? `${h.winner === me ? '+' : '−'}${h.potWon}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="bta-rail-card">
        <div className="head">이월 팟</div>
        <span className="gold-num">{state.carried}</span>
        <span className="cap">지난 무승부 이월</span>
      </div>
    </>
  );

  const rightRail = (
    <>
      <RailTitle>카드 카운팅</RailTitle>
      <div className="bta-count">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <div key={n} className={`bta-count-cell c${seenCount[n]}`}>
            {n}
          </div>
        ))}
      </div>
      <p className="bta-rail-note">
        밝은 칸 = 이미 나온 숫자 (진할수록 2장 모두 소진). 남은 {20 - seen.length}장 + 내 이마,
        20장 소진 시 새 덱으로 리셋됩니다.
      </p>
      <div className="bta-rail-hr" />
      <RailTitle>상대 성향</RailTitle>
      <TendencyPanel t={tend} />
      <div className="bta-rail-card gold">
        <div className="head">폴드 페널티</div>
        <p>
          10을 들고 폴드하면 칩 <strong>10개</strong>를 추가로 잃습니다. 내 카드는 볼 수 없습니다.
        </p>
      </div>
    </>
  );

  const statusLine =
    state.phase === 'betting' && myTurn && info
      ? lastOppRaise !== undefined
        ? `상대가 ${lastOppRaise} 레이즈. 응답하세요.`
        : info.callCost > 0
          ? `콜하려면 ${info.callCost} 필요합니다.`
          : '베팅이 같습니다 — 콜하면 즉시 공개됩니다.'
      : undefined;

  const actionBar =
    state.phase === 'betting' ? (
      !myTurn ? (
        <div className="bta-thinking">상대가 고민 중…</div>
      ) : info ? (
        <div className="bta-actions">
          <div className="bta-btn-grid">
            <ActionBtn
              variant="secondary"
              caption="10 보유 시 −10"
              captionTone="gold"
              onClick={() => doAct({ type: 'fold' })}
            >
              폴드
            </ActionBtn>
            <ActionBtn
              variant={info.callCost > 0 ? 'primary' : 'secondary'}
              caption={info.callCost > 0 ? `총 ${oppBet}까지` : '즉시 쇼다운'}
              onClick={() => doAct({ type: 'call' })}
            >
              {info.callCost > 0 ? `콜 ${info.callCost}` : '콜 (공개)'}
            </ActionBtn>
            <ActionBtn
              variant="accent"
              caption={`최소 ${minTo}`}
              onClick={raiseNow}
              disabled={info.maxRaise < 1}
            >
              레이즈 {raiseTo}
            </ActionBtn>
            <ActionBtn
              variant="gold"
              caption={`최대 ${maxTo}`}
              onClick={() => doAct({ type: 'raise', amount: info.maxRaise })}
              disabled={info.maxRaise < 1}
            >
              올인
            </ActionBtn>
          </div>
          {info.maxRaise >= 1 && (
            <ChipTray
              value={raiseTo}
              min={minTo}
              max={maxTo}
              onChange={(t) => setRaiseAmt(t - oppBet)}
              onEnter={raiseNow}
            />
          )}
        </div>
      ) : undefined
    ) : state.phase === 'result' && lastHand ? (
      <div className="bta-result">
        <HandResultView hand={lastHand} me={me} />
        <button className="primary-btn" onClick={proceedNextHand}>
          다음 핸드
        </button>
      </div>
    ) : undefined;

  const turnBadge =
    state.phase === 'betting'
      ? myTurn
        ? { label: '내 차례', tone: 'accent' as const }
        : { label: '대기', tone: 'neutral' as const }
      : { label: '핸드 종료', tone: 'neutral' as const };

  return (
    <div className="bp-root bp-wide">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      {/* A안 테이블 보드: 헤더 → 3컬럼(핸드 로그 | 중앙 축 | 카운팅·성향) → 액션 바 */}
      <BettingTable
        title="블라인드 포커 · 온라인"
        handNo={state.handNo}
        deckInfo={`${20 - seen.length}/20`}
        turn={turnBadge}
        opp={{ name: '상대', stack: state.stacks[opp], badge: seatBadge(state, opp) }}
        me={{ name: '나', stack: state.stacks[me], badge: seatBadge(state, me) }}
        oppBet={state.invested[opp]}
        myBet={state.invested[me]}
        pot={state.phase === 'betting' ? potSize(state) : lastHand?.potWon ?? 0}
        carried={state.carried}
        oppCard={<PlayCard value={state.cards[opp]} caption="내게만 보임" />}
        myCard={
          view.myCardShown ? (
            <PlayCard value={state.cards[me]} caption="공개됨" />
          ) : (
            <PlayCard hidden caption="나만 못 봄" />
          )
        }
        leftRail={leftRail}
        rightRail={rightRail}
        statusLine={statusLine}
        actionBar={actionBar}
      />

      {state.phase === 'gameover' && (
        <div className="bp-overlay">
          <div className="bp-endcard">
            <h2>{winner === me ? '🏆 승리!' : '패배…'}</h2>
            <p>
              {state.stacks[me]} : {state.stacks[opp]}
            </p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={() => hostApply(createGame(tossFirst()))}>다시 대전</button>
              ) : (
                <p className="online-hint">호스트가 재대결을 시작할 수 있습니다</p>
              )}
              <button className="ghost-btn" onClick={exit}>로비로</button>
            </div>
          </div>
        </div>
      )}

      {oppLeft && state.phase !== 'gameover' && (
        <div className="online-notice-overlay">
          <div className="online-notice">
            <p>상대의 연결이 끊어졌습니다</p>
            <button className="primary-btn" onClick={exit}>로비로</button>
          </div>
        </div>
      )}
      <ChatPanel room={room} />
    </div>
  );
}

function HandResultView({ hand, me }: { hand: BpState['history'][number]; me: PlayerId }) {
  const opp = (1 - me) as PlayerId;
  return (
    <div className="hand-result">
      <div className="cards">
        <span>나 <b>{hand.cards[me]}</b></span>
        <span>상대 <b>{hand.cards[opp]}</b></span>
      </div>
      <div className="outcome">
        {hand.outcome === 'draw'
          ? `무승부 — 팟 ${hand.potWon} 이월`
          : hand.outcome === 'fold'
            ? `${hand.folder === me ? '내' : '상대'} 폴드${hand.penalty ? ' (10 페널티!)' : ''} — ${hand.winner === me ? '내가' : '상대가'} ${hand.potWon} 획득`
            : `쇼다운 — ${hand.winner === me ? '내가' : '상대가'} ${hand.potWon} 획득`}
      </div>
    </div>
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
