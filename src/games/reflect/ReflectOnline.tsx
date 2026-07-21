import { useEffect, useRef, useState } from 'react';
import type { Move, PlayerId, RfState } from './engine.ts';
import { COLS, ROWS, applyMove, colOf, createGame, legalMoves, rowOf } from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { CELL, DIR_ARROW, PieceGfx, rotLabel } from './pieces.tsx';
import './reflect.css';
import '../../net/online.css';

/**
 * 리플렉트 온라인 대전 — 완전 공개 정보 게임이라 호스트가 전체 상태를 복제 전송한다.
 * 액션 검증은 호스트 엔진에서 수행(호스트 권위).
 *
 * 보드는 좌석별로 뒤집지 않는다(기물 거울 방향·빔 좌표까지 변환해야 해서 오히려
 * 혼란). 대신 내 기물 색을 상단에 명시한다.
 */

type NetMsg =
  /** 선공 동전 결과 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' } | { t: 'state'; s: RfState } | { t: 'act'; m: Move };


export default function ReflectOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const stateRef = useRef<RfState | null>(null);
  const [state, setState] = useState<RfState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [oppLeft, setOppLeft] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);

  function hostApply(next: RfState) {
    stateRef.current = next;
    setState(next);
    room.send({ t: 'state', s: next } satisfies NetMsg);
  }

  function hostAct(s: RfState, actor: PlayerId, m: Move): RfState | null {
    if (s.result || s.turn !== actor) return null;
    const legal = legalMoves(s).some(
      (x) => x.kind === m.kind && x.from === m.from && x.to === m.to,
    );
    if (!legal) return null;
    try {
      return applyMove(s, m);
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
        if (msg.t === 'ready' && stateRef.current) {
          room.send({ t: 'state', s: stateRef.current } satisfies NetMsg);
        }
        if (msg.t === 'act' && stateRef.current) {
          const next = hostAct(stateRef.current, 1, msg.m);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'state') {
        setState(msg.s);
        setSelected(null);
      }
    });
    const offPeers = room.onPeers((count) => {
      if (count === 0) setOppLeft(true);
    });
    if (room.isHost) {
      hostApply(createGame(tossFirst()));
    } else {
      room.send({ t: 'ready' } satisfies NetMsg);
    }
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

  function act(m: Move) {
    if (!state) return;
    if (room.isHost) {
      const next = hostAct(state, 0, m);
      if (next) {
        hostApply(next);
        setSelected(null);
      }
    } else {
      room.send({ t: 'act', m } satisfies NetMsg);
      setSelected(null);
    }
  }

  if (toss !== null) {
    return (
      <CoinToss
        first={toss === me ? 0 : 1}
        labels={['나', '상대']}
        onDone={() => setToss(null)}
      />
    );
  }

  if (!state) {
    return (
      <div className="rf-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const myTurn = !state.result && state.turn === me;
  const moves = myTurn ? legalMoves(state) : [];
  const targets = new Set<number>();
  const rotations: Move[] = [];
  if (selected !== null) {
    for (const m of moves) {
      if (m.from !== selected) continue;
      if (m.kind === 'move') targets.add(m.to);
      else rotations.push(m);
    }
  }

  function onCellClick(cell: number) {
    if (!state || !myTurn) return;
    if (selected !== null && targets.has(cell)) {
      act({ kind: 'move', from: selected, to: cell });
      return;
    }
    const p = state.board[cell];
    setSelected(p && p.owner === me ? (cell === selected ? null : cell) : null);
  }

  const lastTo = state.lastMove?.kind === 'move' ? state.lastMove.to : state.lastMove?.from ?? -1;

  return (
    <div className="rf-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'} · 내 기물 {me === 0 ? '파랑(아래)' : '빨강(위)'}
      </div>

      <div className="rf-status">
        <span>
          {state.result
            ? state.result.winner === null
              ? '무승부'
              : state.result.winner === me
                ? '승리!'
                : '상대 승리'
            : myTurn
              ? '당신의 차례'
              : '상대 차례'}
        </span>
      </div>

      <div className="rf-board-wrap">
        <svg className="rf-board" viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}>
          {Array.from({ length: ROWS * COLS }, (_, i) => {
            const r = rowOf(i);
            const c = colOf(i);
            return (
              <rect
                key={i}
                x={c * CELL}
                y={r * CELL}
                width={CELL}
                height={CELL}
                className={`rf-cell ${(r + c) % 2 === 0 ? 'even' : 'odd'} ${
                  i === lastTo ? 'last' : ''
                } ${i === selected ? 'sel' : ''}`}
              />
            );
          })}

          {state.board.map((p, i) => (p ? <PieceGfx key={`p${i}`} piece={p} cell={i} /> : null))}

          {state.lastFire && (
            <g className="rf-beams" key={`beam${state.ply}`}>
              {state.lastFire.beams.map((line, bi) => (
                <polyline
                  key={bi}
                  points={line.map(([r, c]) => `${c * CELL + CELL / 2},${r * CELL + CELL / 2}`).join(' ')}
                  className="rf-beam"
                />
              ))}
            </g>
          )}

          {[...targets].map((t) => (
            <circle
              key={`t${t}`}
              cx={colOf(t) * CELL + CELL / 2}
              cy={rowOf(t) * CELL + CELL / 2}
              r={7}
              className="rf-target"
            />
          ))}

          {Array.from({ length: ROWS * COLS }, (_, i) => (
            <rect
              key={`c${i}`}
              x={colOf(i) * CELL}
              y={rowOf(i) * CELL}
              width={CELL}
              height={CELL}
              fill="transparent"
              onClick={() => onCellClick(i)}
            />
          ))}
        </svg>
      </div>

      <div className="rf-controls">
        {selected !== null && rotations.length > 0 ? (
          <>
            <span className="rf-ctl-label">
              {state.board[selected]?.type === 'laser' ? '레이저 방향' : '회전'}
            </span>
            {rotations.map((m) =>
              m.kind === 'rot' ? (
                <button key={m.to} className="rf-rot-btn" onClick={() => act(m)}>
                  {state.board[selected]?.type === 'laser'
                    ? DIR_ARROW[m.to]
                    : rotLabel(state.board[selected]!, m.to)}
                </button>
              ) : null,
            )}
          </>
        ) : (
          <span className="rf-ctl-label dim">
            {myTurn ? '기물을 선택하세요 — 이동(초록 점) 또는 회전' : ' '}
          </span>
        )}
      </div>

      {state.result && (
        <div className="rf-overlay">
          <div className="rf-endcard">
            <h2>
              {state.result.winner === null ? '무승부' : state.result.winner === me ? '🏆 승리!' : '패배…'}
            </h2>
            <p>
              {state.result.winner === null
                ? '반복 국면 — 승부를 가리지 못했습니다'
                : state.result.winner === me
                  ? '상대의 왕이 레이저에 격추되었습니다'
                  : '당신의 왕이 레이저에 격추되었습니다'}
            </p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={() => { setSelected(null); hostApply(createGame(tossFirst())); }}>
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
      <span className="game-title">리플렉트 · 온라인</span>
    </header>
  );
}
