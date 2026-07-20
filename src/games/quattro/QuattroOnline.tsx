import { useEffect, useRef, useState } from 'react';
import type { PlayerId, QState } from './engine.ts';
import {
  canDecline,
  cardSum,
  createGame,
  currentActor,
  decline,
  exchange,
  finalFour,
  isQuattro,
  keepHand,
  mulligan,
  openCard,
} from './engine.ts';
import { viewFor } from './view.ts';
import type { NetRoom } from '../../net/room.ts';
import { CardBack, CardView, COLOR_NAME } from './cards.tsx';
import './quattro.css';
import '../../net/online.css';

/**
 * 콰트로 온라인 대전 — 호스트 권위 방식.
 * 상대 손패·가상 플레이어 카드·상대가 교환으로 받은 카드는 뷰에서 마스킹된다(view.ts).
 */

type QAction =
  | { k: 'mulligan' }
  | { k: 'keep' }
  | { k: 'open'; cardId: number }
  | { k: 'exchange'; virtualIdx: number; giveCardId: number }
  | { k: 'decline' };

type NetMsg = { t: 'ready' } | { t: 'view'; v: QState } | { t: 'act'; a: QAction };

export default function QuattroOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<QState | null>(null);
  const [view, setView] = useState<QState | null>(null);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oppLeft, setOppLeft] = useState(false);
  const seenLog = useRef(0);

  function hostApply(next: QState) {
    stateRef.current = next;
    setView(viewFor(next, 0));
    room.send({ t: 'view', v: viewFor(next, 1) } satisfies NetMsg);
  }

  function hostAct(s: QState, actor: PlayerId, a: QAction): QState | null {
    try {
      if (a.k === 'mulligan') {
        if (s.phase !== 'mulligan' || s.mulliganDone[actor] || s.mulligansUsed[actor] >= 2) return null;
        return mulligan(s, actor);
      }
      if (a.k === 'keep') {
        if (s.phase !== 'mulligan' || s.mulliganDone[actor]) return null;
        return keepHand(s, actor);
      }
      if (a.k === 'open') {
        if (s.phase !== 'opening' || s.pendingOpen[0] !== actor) return null;
        return openCard(s, actor, a.cardId);
      }
      if (a.k === 'exchange') {
        if (s.phase !== 'exchange' || currentActor(s) !== actor) return null;
        return exchange(s, actor, a.virtualIdx, a.giveCardId);
      }
      if (s.phase !== 'exchange' || currentActor(s) !== actor || !canDecline(s, actor)) return null;
      return decline(s, actor);
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
        if (msg.t === 'ready') room.send({ t: 'view', v: viewFor(s, 1) } satisfies NetMsg);
        if (msg.t === 'act') {
          const next = hostAct(s, 1, msg.a);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'view') {
        setView(msg.v);
      }
    });
    const offPeers = room.onPeers((c) => {
      if (c === 0) setOppLeft(true);
    });
    if (room.isHost) hostApply(createGame(Math.random() < 0.5 ? 0 : 1));
    else room.send({ t: 'ready' } satisfies NetMsg);
    return () => {
      offMsg();
      offPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 내가 교환으로 받은 카드 알림 (뷰에는 내 것만 실값이 들어온다)
  useEffect(() => {
    if (!view) return;
    if (view.log.length > seenLog.current) {
      const last = view.log[view.log.length - 1];
      if (last.player === me) {
        setNotice(
          `가상 ${last.virtualIdx + 1}에게서 받은 카드: ${COLOR_NAME[last.received.color]} ${last.received.num}`,
        );
        const t = setTimeout(() => setNotice(null), 2500);
        seenLog.current = view.log.length;
        return () => clearTimeout(t);
      }
    }
    seenLog.current = view.log.length;
  }, [view, me]);

  function exit() {
    room.leave();
    onExit();
  }

  function act(a: QAction) {
    if (room.isHost) {
      const s = stateRef.current;
      if (!s) return;
      const next = hostAct(s, 0, a);
      if (next) hostApply(next);
    } else {
      room.send({ t: 'act', a } satisfies NetMsg);
    }
    setSelectedCard(null);
  }

  if (!view) {
    return (
      <div className="qt-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const state = view;
  const myExchangeTurn = state.phase === 'exchange' && currentActor(state) === me;
  const myOpenTurn = state.phase === 'opening' && state.pendingOpen[0] === me;

  const statusText = state.result
    ? '게임 종료'
    : state.phase === 'mulligan'
      ? state.mulliganDone[me] ? '상대가 패를 확정하는 중…' : '패를 확정하거나 멀리건하세요'
      : state.phase === 'opening'
        ? myOpenTurn ? '공개할 카드를 선택하세요' : '상대가 카드를 공개하는 중…'
        : myExchangeTurn
          ? selectedCard !== null ? '교환할 가상 플레이어를 선택하세요' : '손패를 골라 교환하거나 패스하세요'
          : '상대가 고민 중…';

  const myUnvisited = state.exchanged[me].filter((x) => !x).length;

  function onMyCardClick(cardId: number) {
    if (myOpenTurn) {
      act({ k: 'open', cardId });
      return;
    }
    if (myExchangeTurn) setSelectedCard((c) => (c === cardId ? null : cardId));
  }

  function onVirtualClick(v: number) {
    if (selectedCard === null || !myExchangeTurn || state.exchanged[me][v]) return;
    act({ k: 'exchange', virtualIdx: v, giveCardId: selectedCard });
  }

  function onPass() {
    if (!myExchangeTurn) return;
    if (!canDecline(state, me)) {
      setNotice('아직 교환하지 않은 가상 플레이어가 있어 패스할 수 없습니다');
      setTimeout(() => setNotice(null), 2500);
      return;
    }
    act({ k: 'decline' });
  }

  return (
    <div className="qt-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="qt-status">
        <span>{statusText}</span>
        {state.phase === 'exchange' && <span className="qt-sub">남은 의무 교환 {myUnvisited}곳</span>}
      </div>

      {/* 상대 영역 */}
      <div className="qt-player-row ai">
        <span className="label">상대</span>
        <div className="cards">
          {state.opens[opp].map((c) => <CardView key={c.id} card={c} />)}
          {state.hands[opp].map((c) => <CardBack key={c.id} />)}
        </div>
      </div>

      {/* 가상 플레이어 6명 */}
      <div className="qt-virtuals">
        {state.virtuals.length === 6
          ? state.virtuals.map((v, i) => (
              <button
                key={i}
                className={`qt-virtual ${state.exchanged[me][i] ? 'visited' : ''} ${selectedCard !== null && !state.exchanged[me][i] ? 'selectable' : ''}`}
                onClick={() => onVirtualClick(i)}
              >
                <span className="v-name">가상 {i + 1}</span>
                <div className="v-cards">
                  {v.map((c) => <span key={c.id} className="mini-back" />)}
                </div>
                <span className="v-marks">
                  {state.exchanged[me][i] && <em className="me">나✓</em>}
                  {state.exchanged[opp][i] && <em className="op">상대✓</em>}
                </span>
              </button>
            ))
          : <span className="qt-sub">멀리건이 끝나면 가상 플레이어에게 카드가 배분됩니다</span>}
      </div>

      {/* 교환 로그 — 건넨 카드만 공개 정보 */}
      {state.log.length > 0 && (
        <div className="qt-log">
          {state.log.slice(-3).map((e, i) => (
            <span key={i} className="log-line">
              {e.player === me ? '나' : '상대'} → 가상{e.virtualIdx + 1}:{' '}
              <b className={`c-${e.given.color}`}>{COLOR_NAME[e.given.color]} {e.given.num}</b> 건넴
            </span>
          ))}
        </div>
      )}

      {/* 내 영역 */}
      <div className="qt-player-row me">
        <span className="label">나</span>
        <div className="cards">
          {state.opens[me].map((c) => <CardView key={c.id} card={c} opened />)}
          {state.hands[me].map((c) => (
            <CardView
              key={c.id}
              card={c}
              selectable
              selected={selectedCard === c.id}
              onClick={() => onMyCardClick(c.id)}
            />
          ))}
        </div>
      </div>

      <div className="qt-actions">
        {state.phase === 'mulligan' && !state.mulliganDone[me] && (
          <>
            <button
              className="ghost-btn"
              disabled={state.mulligansUsed[me] >= 2}
              onClick={() => act({ k: 'mulligan' })}
            >
              🎲 멀리건 ({2 - state.mulligansUsed[me]}회 남음)
            </button>
            <button className="primary-btn" onClick={() => act({ k: 'keep' })}>
              이 패로 확정
            </button>
          </>
        )}
        {myExchangeTurn && (
          <button className="ghost-btn" onClick={onPass}>패스</button>
        )}
      </div>

      {notice && <div className="qt-notice">{notice}</div>}

      {state.result && (
        <div className="qt-overlay">
          <div className="qt-endcard">
            <h2>
              {state.result.winner === null ? '무승부' : state.result.winner === me ? '🏆 승리!' : '패배…'}
            </h2>
            <p className="qt-detail">{state.result.detail}</p>
            <div className="final-rows">
              {([me, opp] as PlayerId[]).map((p) => {
                const four = finalFour(state, p);
                return (
                  <div key={p} className="final-row">
                    <span className="who">{p === me ? '나' : '상대'}</span>
                    {four.map((c) => <CardView key={c.id} card={c} small />)}
                    <span className={`verdict ${isQuattro(four) ? 'ok' : 'fail'}`}>
                      {isQuattro(four) ? `콰트로 ${cardSum(four)}` : `미완성 ${cardSum(four)}`}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={() => hostApply(createGame(Math.random() < 0.5 ? 0 : 1))}>
                  다시 대전
                </button>
              ) : (
                <p className="online-hint">호스트가 재대결을 시작할 수 있습니다</p>
              )}
              <button className="ghost-btn" onClick={exit}>로비로</button>
            </div>
          </div>
        </div>
      )}

      {oppLeft && !state.result && (
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

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">콰트로 · 온라인</span>
    </header>
  );
}
