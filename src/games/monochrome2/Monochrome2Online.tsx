import { useEffect, useRef, useState } from 'react';
import type { M2State, PlayerId } from './engine.ts';
import { bidColor, createGame, currentPlayer, play } from './engine.ts';
import { viewFor } from './view.ts';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { Gauge } from './gauge.tsx';
import './monochrome2.css';
import '../../net/online.css';

/**
 * 모노크롬 II 온라인 대전 — 호스트 권위 방식.
 * 상대의 정확한 포인트·제시액은 뷰에서 마스킹된다(게이지 단계와 색만 유지).
 */

type NetMsg =
  /** 선공 동전 결과 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' } | { t: 'view'; v: M2State } | { t: 'act'; bid: number };

export default function Monochrome2Online({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<M2State | null>(null);
  const [view, setView] = useState<M2State | null>(null);
  const [bidInput, setBidInput] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [oppLeft, setOppLeft] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);
  const prevHist = useRef(0);

  function hostApply(next: M2State) {
    stateRef.current = next;
    setView(viewFor(next, 0));
    room.send({ t: 'view', v: viewFor(next, 1) } satisfies NetMsg);
  }

  function hostAct(s: M2State, actor: PlayerId, bid: number): M2State | null {
    if (s.result || currentPlayer(s) !== actor) return null;
    if (!Number.isInteger(bid) || bid < 0 || bid > s.points[actor]) return null;
    try {
      return play(s, bid);
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
        if (msg.t === 'ready') room.send({ t: 'view', v: viewFor(s, 1) } satisfies NetMsg);
        if (msg.t === 'act') {
          const next = hostAct(s, 1, msg.bid);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'view') {
        setView(msg.v);
      }
    });
    const offPeers = room.onPeers((c) => {
      if (c === 0) setOppLeft(true);
    });
    if (room.isHost) hostApply(createGame(tossFirst()));
    else room.send({ t: 'ready' } satisfies NetMsg);
    return () => {
      offMsg();
      offPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 라운드 결과 플래시
  useEffect(() => {
    if (!view) return;
    if (view.history.length > prevHist.current) {
      const r = view.history[view.history.length - 1];
      setFlash(r.winner === null ? '무승부!' : r.winner === me ? '라운드 승리!' : '라운드 패배');
      const t = setTimeout(() => setFlash(null), 1200);
      prevHist.current = view.history.length;
      return () => clearTimeout(t);
    }
    prevHist.current = view.history.length;
  }, [view, me]);

  function exit() {
    room.leave();
    onExit();
  }

  function submitBid() {
    if (!view) return;
    const bid = Math.max(0, Math.min(bidInput, view.points[me]));
    if (room.isHost) {
      const s = stateRef.current;
      if (!s) return;
      const next = hostAct(s, 0, bid);
      if (next) hostApply(next);
    } else {
      room.send({ t: 'act', bid } satisfies NetMsg);
    }
    setBidInput(0);
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
      <div className="m2-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const state = view;
  const myTurn = !state.result && currentPlayer(state) === me;
  const iAmLeader = state.leader === me;
  const oppPending = state.pending !== null && currentPlayer(state) === me;
  const roundNo = Math.min(state.roundInSet + 1, state.maxRounds);

  return (
    <div className="m2-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="m2-scoreboard">
        <div className="score me">나 <b>{state.scores[me]}</b></div>
        <div className="round-info">
          {state.overtime > 0 && <span className="overtime">연장 {state.overtime}</span>}
          라운드 {roundNo}/{state.maxRounds} · 5점 선취
        </div>
        <div className="score ai"><b>{state.scores[opp]}</b> 상대</div>
      </div>

      <div className="m2-gauges">
        <Gauge label="내 포인트" points={state.points[me]} exact />
        <Gauge label="상대 포인트" points={state.points[opp]} />
      </div>

      <div className="m2-table">
        {oppPending ? (
          <div className={`m2-bid-card ${bidColor(state.pending!)}`}>
            <span className="q">?</span>
            <span className="color-name">
              {bidColor(state.pending!) === 'black' ? '흑 (한 자릿수)' : '백 (두 자릿수)'}
            </span>
          </div>
        ) : state.pending !== null ? (
          <div className={`m2-bid-card ${bidColor(state.pending)}`}>
            <span>{state.pending}</span>
            <span className="color-name">내 제시 — 상대 응수 대기</span>
          </div>
        ) : (
          <div className="table-hint">
            {state.result ? '' : myTurn ? (iAmLeader ? '당신이 선입니다 — 포인트를 제시하세요' : '') : '상대가 고민 중…'}
          </div>
        )}
        {flash && <div className="result-flash">{flash}</div>}
      </div>

      {myTurn && !state.result && (
        <div className="m2-bid-input">
          <div className="quick-bids">
            {[0, 1, 5, 9, 10, 11, 15, 20].filter((v) => v <= state.points[me]).map((v) => (
              <button key={v} className={`quick ${bidInput === v ? 'active' : ''}`} onClick={() => setBidInput(v)}>
                {v}
              </button>
            ))}
          </div>
          <div className="bid-row">
            <input
              type="range"
              min={0}
              max={state.points[me]}
              value={bidInput}
              onChange={(e) => setBidInput(+e.target.value)}
            />
            <span className={`bid-preview ${bidInput <= 9 ? 'black' : 'white'}`}>{bidInput}</span>
            <button className="primary-btn" onClick={submitBid}>제시</button>
          </div>
          <p className="bid-note">
            {bidInput <= 9 ? '흑으로 표시됩니다 (0~9)' : '백으로 표시됩니다 (10~99)'}
          </p>
        </div>
      )}

      {/* 히스토리: 상대 숫자는 비공개 (무승부만 공개) */}
      <div className="m2-history">
        {state.history.slice(state.history.length - state.roundInSet).map((r, i) => (
          <div key={i} className={`hist-row ${r.winner === me ? 'win' : r.winner === opp ? 'lose' : 'draw'}`}>
            <span className="hist-round">R{i + 1}</span>
            <span className={`hist-bid ${bidColor(r.bids[me])}`}>{r.bids[me]}</span>
            <span className="hist-vs">vs</span>
            <span className={`hist-bid ${bidColor(r.bids[opp])}`}>
              {r.winner === null ? r.bids[opp] : '?'}
            </span>
            <span className="hist-result">{r.winner === me ? '승' : r.winner === opp ? '패' : '무'}</span>
          </div>
        ))}
      </div>

      {state.result && (
        <div className="m2-overlay">
          <div className="m2-endcard">
            <h2>
              {state.result.winner === null ? '무승부' : state.result.winner === me ? '🏆 승리!' : '패배…'}
            </h2>
            <p>{state.scores[me]} : {state.scores[opp]}</p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={() => { prevHist.current = 0; hostApply(createGame(tossFirst())); }}>
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
      <span className="game-title">모노크롬 II · 온라인</span>
    </header>
  );
}
