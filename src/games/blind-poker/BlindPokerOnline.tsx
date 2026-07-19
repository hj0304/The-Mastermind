import { useEffect, useRef, useState } from 'react';
import type { BpAction, BpState, PlayerId } from './engine.ts';
import { act, createGame, gameWinner, legalInfo, nextHand, potSize, seenCards } from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
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

type NetMsg = { t: 'ready' } | { t: 'view'; v: BpView } | { t: 'act'; a: BpAction } | { t: 'next' };

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
  const [oppLeft, setOppLeft] = useState(false);

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

  useEffect(() => {
    const offMsg = room.onMsg((raw) => {
      const msg = raw as NetMsg;
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
    if (room.isHost) hostApply(createGame());
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
  }

  function proceedNextHand() {
    if (room.isHost) {
      const s = stateRef.current;
      if (s && s.phase === 'result') hostApply(nextHand(s));
    } else {
      room.send({ t: 'next' } satisfies NetMsg);
    }
  }

  if (!view) {
    return (
      <div className="bp-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
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

  return (
    <div className="bp-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="bp-scoreboard">
        <div className="stack me">나 <b>{state.stacks[me]}</b>칩</div>
        <div className="pot-info">
          핸드 #{state.handNo}
          <div className="pot">팟 {state.phase === 'betting' ? potSize(state) : lastHand?.potWon ?? 0}</div>
          {state.carried > 0 && <div className="carried">이월 {state.carried}</div>}
        </div>
        <div className="stack ai">상대 <b>{state.stacks[opp]}</b>칩</div>
      </div>

      <div className="bp-table">
        <div className="card-slot">
          <div className="slot-label">상대의 이마</div>
          <div className="pcard face">{state.cards[opp]}</div>
          <div className="bet-chips">베팅 {state.invested[opp]}</div>
        </div>
        <div className="vs">VS</div>
        <div className="card-slot">
          <div className="slot-label">내 이마 (나만 못 봄)</div>
          <div className={view.myCardShown ? 'pcard face' : 'pcard hidden-card'}>
            {view.myCardShown ? state.cards[me] : '?'}
          </div>
          <div className="bet-chips">베팅 {state.invested[me]}</div>
        </div>
      </div>

      {state.phase === 'betting' && (
        <div className="bp-actions">
          {!myTurn && <div className="thinking">상대가 고민 중…</div>}
          {myTurn && info && (
            <>
              <button className="action-btn fold" onClick={() => doAct({ type: 'fold' })}>
                폴드
              </button>
              <button className="action-btn call" onClick={() => doAct({ type: 'call' })}>
                {info.callCost > 0 ? `콜 (+${info.callCost})` : '콜 (공개)'}
              </button>
              {info.raiseOptions.map((r) => (
                <button
                  key={r}
                  className="action-btn raise"
                  onClick={() => doAct({ type: 'raise', amount: r })}
                >
                  {r === info.maxRaise ? `올인 +${r}` : `레이즈 +${r}`}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {state.phase === 'result' && lastHand && (
        <div className="bp-hand-result">
          <HandResultView hand={lastHand} me={me} />
          {room.isHost ? (
            <button className="primary-btn" onClick={proceedNextHand}>다음 핸드</button>
          ) : (
            <button className="primary-btn" onClick={proceedNextHand}>다음 핸드</button>
          )}
        </div>
      )}

      <div className="bp-seen">
        <div className="label">이번 덱에서 확인한 카드 (남은 {20 - seen.length}장 + 내 이마)</div>
        <div className="seen-grid">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <div key={n} className={`seen-cell c${seenCount[n]}`}>
              <span className="num">{n}</span>
              <span className="cnt">{2 - seenCount[n]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bp-history">
        {state.history.slice(-6).map((h, i) => {
          const idx = state.history.length - Math.min(6, state.history.length) + i;
          const myCardKnown = h.outcome !== 'fold' || h.folder === me;
          return (
            <div
              key={idx}
              className={`hist-row ${h.winner === me ? 'win' : h.winner === opp ? 'lose' : 'draw'}`}
            >
              <span className="hist-no">#{idx + 1}</span>
              <span>나 {myCardKnown ? h.cards[me] : '?'}</span>
              <span>상대 {h.cards[opp]}</span>
              <span className="hist-outcome">
                {h.outcome === 'draw'
                  ? '무승부(이월)'
                  : h.outcome === 'fold'
                    ? `${h.folder === me ? '나' : '상대'} 폴드${h.penalty ? ' ⚠10페널티' : ''}`
                    : '쇼다운'}
              </span>
              <span className="hist-pot">
                {h.winner !== undefined ? `${h.winner === me ? '+' : '-'}${h.potWon}` : ''}
              </span>
            </div>
          );
        })}
      </div>

      {state.phase === 'gameover' && (
        <div className="bp-overlay">
          <div className="bp-endcard">
            <h2>{winner === me ? '🏆 승리!' : '패배…'}</h2>
            <p>
              {state.stacks[me]} : {state.stacks[opp]}
            </p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={() => hostApply(createGame())}>다시 대전</button>
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
