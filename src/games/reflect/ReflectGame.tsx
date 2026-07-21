import { useEffect, useRef, useState } from 'react';
import type { Move, PlayerId, RfState } from './engine.ts';
import { COLS, ROWS, applyMove, colOf, createGame, legalMoves, rowOf } from './engine.ts';
import { chooseAiMove } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { CELL, DIR_ARROW, PieceGfx, rotLabel } from './pieces.tsx';
import ReflectOnline from './ReflectOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './reflect.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

export default function ReflectGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<RfState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiInfo, setAiInfo] = useState<string | null>(null);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  function startGame() {
    setToss(0); // 값은 의미 없다 — 선공은 동전을 던져 정해진다
  }

  function begin(first: PlayerId) {
    setState(createGame(first));
    setSelected(null);
    setAiInfo(null);
    recorded.current = false;
    setPhase('playing');
  }

  // AI 턴
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result || state.turn !== AI) return;
    setAiThinking(true);
    const timer = setTimeout(() => {
      setState((s) => {
        if (!s || s.result || s.turn !== AI) return s;
        const r = chooseAiMove(s, 900);
        setAiInfo(r.depth === 0 ? '필승 경로 발견' : `탐색 깊이 ${r.depth} · ${(r.nodes / 1000).toFixed(0)}k 노드`);
        return applyMove(s, r.move);
      });
      setAiThinking(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [phase, state]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state?.result) {
      if (!recorded.current) {
        recorded.current = true;
        if (state.result.winner !== null) {
          recordResult('reflect', state.result.winner === HUMAN);
        }
      }
      const timer = setTimeout(() => setPhase('done'), 1200);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  const myTurn = phase !== 'setup' && !!state && !state.result && state.turn === HUMAN && !aiThinking;

  const moves = state && myTurn ? legalMoves(state) : [];
  const targets = new Set<number>();
  const rotations: Move[] = [];
  if (selected !== null) {
    for (const m of moves) {
      if (m.from !== selected) continue;
      if (m.kind === 'move') targets.add(m.to);
      else rotations.push(m);
    }
  }

  function doMove(m: Move) {
    if (!state) return;
    setState(applyMove(state, m));
    setSelected(null);
  }

  function onCellClick(cell: number) {
    if (!state || !myTurn) return;
    if (selected !== null && targets.has(cell)) {
      doMove({ kind: 'move', from: selected, to: cell });
      return;
    }
    const p = state.board[cell];
    setSelected(p && p.owner === HUMAN ? (cell === selected ? null : cell) : null);
  }

  if (online !== null && online !== 'panel') {
    return <ReflectOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="rf-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel
          gameName="리플렉트"
          onReady={(room) => setOnline(room)}
          onCancel={() => setOnline(null)}
        />
      </div>
    );
  }

  if (toss !== null) {
    return (
      <CoinToss
        mode="call"
        labels={['나', 'AI']}
        onDone={(winner) => {
          begin(winner === 0 ? HUMAN : AI);
          setToss(null);
        }}
      />
    );
  }

  if (phase === 'setup') {
    const rec = getRecord('reflect');
    return (
      <div className="rf-root">
        <GameHeader onExit={onExit} />
        <div className="rf-setup">
          <h2>리플렉트</h2>
          <p className="rf-rule-summary">
            매 턴 기물 하나를 <b>1칸 이동 또는 90° 회전</b>시키면, 턴이 끝날 때 내{' '}
            <b>레이저가 자동 발사</b>됩니다. 세모기사의 빗변과 네모기사의 정면은 거울 —
            빔을 꺾거나 되돌립니다. 비거울면에 맞은 기물은 <b>피아 불문 제거</b>.
            스플리터는 빔을 두 갈래로 나눕니다. 상대 <b>왕</b>을 맞히면 승리, 내 왕을
            맞히면 즉시 패배입니다.
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">완전정보 게임 — AI는 레이저 경로를 수만 갈래 앞서 계산합니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>AI 대전 시작</button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>⚔️ 온라인 대전</button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const lastTo = state.lastMove?.kind === 'move' ? state.lastMove.to : state.lastMove?.from ?? -1;

  return (
    <div className="rf-root">
      <GameHeader onExit={onExit} />

      <div className="rf-status">
        <span>
          {state.result
            ? state.result.winner === null
              ? '무승부'
              : state.result.winner === HUMAN
                ? '승리!'
                : 'AI 승리'
            : aiThinking
              ? 'AI가 반사 경로를 계산 중…'
              : state.turn === HUMAN
                ? '당신의 차례'
                : 'AI 차례'}
        </span>
        {aiInfo && <span className="ai-info">{aiInfo}</span>}
      </div>

      <div className="rf-board-wrap">
        <svg className="rf-board" viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}>
          {/* 격자 */}
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

          {/* 기물 */}
          {state.board.map((p, i) => (p ? <PieceGfx key={`p${i}`} piece={p} cell={i} /> : null))}

          {/* 레이저 빔 */}
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

          {/* 이동 목표 표시 */}
          {[...targets].map((t) => (
            <circle
              key={`t${t}`}
              cx={colOf(t) * CELL + CELL / 2}
              cy={rowOf(t) * CELL + CELL / 2}
              r={7}
              className="rf-target"
            />
          ))}

          {/* 클릭 레이어 */}
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

      {/* 회전 컨트롤 */}
      <div className="rf-controls">
        {selected !== null && rotations.length > 0 ? (
          <>
            <span className="rf-ctl-label">
              {state.board[selected]?.type === 'laser' ? '레이저 방향' : '회전'}
            </span>
            {rotations.map((m) =>
              m.kind === 'rot' ? (
                <button key={m.to} className="rf-rot-btn" onClick={() => doMove(m)}>
                  {state.board[selected]?.type === 'laser'
                    ? DIR_ARROW[m.to]
                    : rotLabel(state.board[selected]!, m.to)}
                </button>
              ) : null,
            )}
          </>
        ) : (
          <span className="rf-ctl-label dim">
            {myTurn ? '기물을 선택하세요 — 이동(초록 점) 또는 회전' : ' '}
          </span>
        )}
      </div>

      {phase === 'done' && state.result && (
        <div className="rf-overlay">
          <div className="rf-endcard">
            <h2>
              {state.result.winner === null
                ? '무승부'
                : state.result.winner === HUMAN
                  ? '🏆 승리!'
                  : '패배…'}
            </h2>
            <p>
              {state.result.winner === null
                ? '반복 국면 — 승부를 가리지 못했습니다'
                : state.result.winner === HUMAN
                  ? 'AI의 왕이 레이저에 격추되었습니다'
                  : '당신의 왕이 레이저에 격추되었습니다'}
            </p>
            <div className="end-actions">
              <button className="primary-btn" onClick={startGame}>다시 대전</button>
              <button className="ghost-btn" onClick={onExit}>로비로</button>
            </div>
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
      <span className="game-title">리플렉트</span>
    </header>
  );
}
