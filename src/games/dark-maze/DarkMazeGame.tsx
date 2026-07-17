import { useEffect, useRef, useState } from 'react';
import type { DMState, PlayerId } from './engine.ts';
import {
  CHIPS_TO_WIN,
  SIZE,
  START,
  applyRoll,
  applyStep,
  applyStop,
  createGame,
  edgeCells,
  neighbors,
  rollDie,
} from './engine.ts';
import { chooseAiStep, recordGameEnd, recordHumanTurn } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import './darkmaze.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

/** 코너(출발점) 제외 32칸의 심볼 — 칸 번호 오름차순으로 배정 */
const SYMBOL_LIST = [
  '🌙', '⭐', '🔥', '💧', '🍀', '👑', '🗝️', '🦉', '🐍', '🌹', '⚡', '🍄',
  '🔔', '🎭', '🧭', '⚗️', '📜', '🕸️', '🪶', '🦋', '🐚', '🎲', '⏳', '🕯️',
  '💎', '🌈', '🪄', '🐸', '🗿', '🍎', '☂️', '🎈',
];
const CORNERS = [0, SIZE - 1, SIZE * SIZE - SIZE, SIZE * SIZE - 1];
const CELL_SYMBOL: (string | null)[] = (() => {
  const out: (string | null)[] = [];
  let i = 0;
  for (let c = 0; c < SIZE * SIZE; c++) out.push(CORNERS.includes(c) ? null : SYMBOL_LIST[i++]);
  return out;
})();

const PCT = 100 / SIZE;

export default function DarkMazeGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<DMState | null>(null);
  /** 주사위 연출: 값을 미리 뽑아 애니메이션 후 적용 */
  const [dieAnim, setDieAnim] = useState<{ value: number; by: PlayerId } | null>(null);
  /** 충돌/획득 연출 (벽 플래시 + 메시지) */
  const [flash, setFlash] = useState<{ kind: 'bump' | 'chip'; by: PlayerId; edge?: number; cell?: number } | null>(null);
  const recorded = useRef(false);

  function startGame() {
    setState(createGame(Math.random() < 0.5 ? HUMAN : AI));
    setDieAnim(null);
    setFlash(null);
    recorded.current = false;
    setPhase('playing');
  }

  // 주사위 연출 → 적용 (사람/AI 공용, 단일 타이머)
  useEffect(() => {
    if (!dieAnim) return;
    const t = setTimeout(() => {
      setState((s) => {
        if (!s || s.phase !== 'roll' || s.result) return s;
        return applyRoll(s, dieAnim.value);
      });
      setDieAnim(null);
    }, 1250);
    return () => clearTimeout(t);
  }, [dieAnim]);

  // AI 진행 시퀀서 (조건별로 정확히 하나의 타이머만 예약)
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result || dieAnim) return;
    if (state.phase === 'roll' && state.turn === AI) {
      const t = setTimeout(() => setDieAnim({ value: rollDie(), by: AI }), 900);
      return () => clearTimeout(t);
    }
    if (state.phase === 'move' && state.turn === AI) {
      const t = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'move' || s.turn !== AI || s.result) return s;
          try {
            const dest = chooseAiStep(s, AI);
            return dest === null ? applyStop(s) : applyStep(s, dest);
          } catch {
            return applyStop(s);
          }
        });
      }, 430);
      return () => clearTimeout(t);
    }
  }, [phase, state, dieAnim]);

  // 이벤트 연출(충돌 벽 플래시 / 칩 획득) — lastEvent 변화 감지
  const lastEventRef = useRef<DMState['lastEvent']>(null);
  useEffect(() => {
    if (!state || state.lastEvent === lastEventRef.current) return;
    lastEventRef.current = state.lastEvent;
    if (!state.lastEvent) return;
    const ev = state.lastEvent;
    setFlash(
      ev.kind === 'bump'
        ? { kind: 'bump', by: ev.by, edge: ev.edge }
        : { kind: 'chip', by: ev.by, cell: ev.cell },
    );
    const t = setTimeout(() => setFlash(null), 1700);
    return () => clearTimeout(t);
  }, [state]);

  // 게임 종료 기록
  useEffect(() => {
    if (phase !== 'playing' || !state?.result || recorded.current) return;
    recorded.current = true;
    recordGameEnd();
    recordResult('dark-maze', state.result.winner === HUMAN);
    const t = setTimeout(() => setPhase('done'), 2000);
    return () => clearTimeout(t);
  }, [phase, state]);

  const myTurn = !!state && !state.result && state.turn === HUMAN && !dieAnim;

  function humanRoll() {
    if (!myTurn || state!.phase !== 'roll') return;
    setDieAnim({ value: rollDie(), by: HUMAN });
  }

  function humanStep(dest: number) {
    if (!myTurn || state!.phase !== 'move') return;
    try {
      const next = applyStep(state!, dest);
      // 충돌 성향 학습 (공개 정보): 턴이 끝났으면 이번 턴의 충돌 여부를 기록
      if (next.lastEvent?.kind === 'bump' && next.lastEvent.by === HUMAN) recordHumanTurn(true);
      else if (next.turn !== HUMAN || next.result) recordHumanTurn(false);
      setState(next);
    } catch {
      // 무효 클릭은 무시
    }
  }

  function humanStop() {
    if (!myTurn || state!.phase !== 'move') return;
    recordHumanTurn(false);
    setState(applyStop(state!));
  }

  if (phase === 'setup') {
    const rec = getRecord('dark-maze');
    return (
      <div className="dm-root">
        <GameHeader onExit={onExit} />
        <div className="dm-setup">
          <h2>암전 미궁</h2>
          <p className="dm-rule-summary">
            6×6 미궁 어딘가에 <b>보이지 않는 벽 24개</b>가 숨어 있습니다. 주사위 눈만큼
            움직여 목표 심볼 칸에 먼저 도달하면 칩 획득 — 하지만 벽을 지나치는 순간
            <b> 쇠구슬이 떨어지며 시작점으로 되돌아갑니다</b>. 부딪힌 자리는 상대도
            봅니다. 길을 기억하며 <b>칩 {CHIPS_TO_WIN}개</b>를 먼저 모으면 승리!
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 드러난 벽과 열린 길을 완벽 기억하고, 당신의 기억력 수준에 맞춰 위험을 조절합니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>대전 시작</button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const movable =
    myTurn && state.phase === 'move' ? neighbors(state.pos[HUMAN]) : [];

  return (
    <div className="dm-root">
      <GameHeader onExit={onExit} />

      <div className="dm-status">
        <div className={`dm-side me ${state.turn === HUMAN && !state.result ? 'active' : ''}`}>
          <span className="who">나 🧙</span>
          <span className="tray">
            {state.collected[HUMAN].map((c) => (
              <i key={c}>{CELL_SYMBOL[c]}</i>
            ))}
            {Array.from({ length: CHIPS_TO_WIN - state.chips[HUMAN] }, (_, i) => (
              <i key={`e${i}`} className="empty">○</i>
            ))}
          </span>
        </div>
        <div className="dm-target">
          {state.target >= 0 ? (
            <>
              <span className="target-label">목표</span>
              <span className="target-chip">{CELL_SYMBOL[state.target]}</span>
            </>
          ) : (
            <span className="target-chip">—</span>
          )}
        </div>
        <div className={`dm-side ai ${state.turn === AI && !state.result ? 'active' : ''}`}>
          <span className="who">🦹 AI</span>
          <span className="tray">
            {state.collected[AI].map((c) => (
              <i key={c}>{CELL_SYMBOL[c]}</i>
            ))}
            {Array.from({ length: CHIPS_TO_WIN - state.chips[AI] }, (_, i) => (
              <i key={`e${i}`} className="empty">○</i>
            ))}
          </span>
        </div>
      </div>

      <div className="dm-board-wrap">
        <div className="dm-board">
          {Array.from({ length: SIZE * SIZE }, (_, c) => {
            const isTarget = c === state.target;
            const canMove = movable.includes(c);
            return (
              <button
                key={c}
                className={[
                  'dm-cell',
                  CORNERS.includes(c) ? 'corner' : '',
                  c === START[HUMAN] ? 'home-me' : '',
                  c === START[AI] ? 'home-ai' : '',
                  isTarget ? 'target' : '',
                  canMove ? 'movable' : '',
                  flash?.kind === 'chip' && flash.cell === c ? 'chip-pop' : '',
                ].join(' ')}
                disabled={!canMove}
                onClick={() => humanStep(c)}
              >
                <span className="sym">{CELL_SYMBOL[c] ?? (c === START[HUMAN] ? '🏠' : c === START[AI] ? '🏰' : '')}</span>
              </button>
            );
          })}

          {/* 충돌한 벽 플래시 (양쪽 모두에게 공개되는 정보) */}
          {flash?.kind === 'bump' && flash.edge !== undefined && (() => {
            const [a, b] = edgeCells(flash.edge);
            const r = Math.floor(a / SIZE);
            const c = a % SIZE;
            const style =
              b === a + 1
                ? { left: `calc(${(c + 1) * PCT}% - 2px)`, top: `${r * PCT}%`, width: '4px', height: `${PCT}%` }
                : { left: `${c * PCT}%`, top: `calc(${(r + 1) * PCT}% - 2px)`, width: `${PCT}%`, height: '4px' };
            return <div className="dm-wall-flash" style={style} />;
          })()}

          {/* 말 */}
          {[HUMAN, AI].map((p) => {
            const cell = state.pos[p];
            const bumped = flash?.kind === 'bump' && flash.by === p;
            return (
              <div
                key={p}
                className={`dm-piece ${p === HUMAN ? 'me' : 'ai'} ${bumped ? 'bumped' : ''}`}
                style={{ left: `${(cell % SIZE) * PCT}%`, top: `${Math.floor(cell / SIZE) * PCT}%` }}
              >
                {p === HUMAN ? '🧙' : '🦹'}
              </div>
            );
          })}
        </div>
      </div>

      <div className="dm-controls">
        {state.result ? (
          <p className="dm-msg endmsg">
            {state.result.winner === HUMAN ? '🎉 승리! 심볼 5개를 모았습니다' : 'AI가 심볼 5개를 먼저 모았습니다…'}
          </p>
        ) : flash?.kind === 'bump' ? (
          <p className="dm-msg bump">
            💥 {flash.by === HUMAN ? '보이지 않는 벽에 부딪혔습니다! 시작점으로…' : 'AI가 벽에 부딪혔습니다! (위치를 기억하세요)'}
          </p>
        ) : flash?.kind === 'chip' ? (
          <p className="dm-msg chip">
            {flash.by === HUMAN ? '✨ 심볼 획득!' : 'AI가 심볼을 가져갔습니다'}
          </p>
        ) : myTurn && state.phase === 'roll' ? (
          <button className="primary-btn" onClick={humanRoll}>🎲 주사위 굴리기</button>
        ) : myTurn && state.phase === 'move' ? (
          <div className="dm-move-bar">
            <span className="steps">
              남은 걸음{' '}
              {Array.from({ length: state.steps }, (_, i) => (
                <i key={i} className="step-dot" />
              ))}
            </span>
            <button className="stop-btn" onClick={humanStop}>멈추기</button>
          </div>
        ) : (
          <p className="dm-msg">AI 차례…</p>
        )}
      </div>

      {/* 주사위 오버레이 */}
      {dieAnim && (
        <div className="dm-die-overlay">
          <div className="dm-die-box">
            <p>{dieAnim.by === HUMAN ? '나' : 'AI'}의 주사위</p>
            <div className="dm-die" key={`${dieAnim.by}-${dieAnim.value}`}>
              <span>{dieAnim.value}</span>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && state.result && (
        <div className="dm-endcard-overlay">
          <div className="dm-endcard">
            <h3>{state.result.winner === HUMAN ? '승리!' : '패배…'}</h3>
            <p>
              {state.chips[HUMAN]} : {state.chips[AI]}
              {state.result.winner === HUMAN ? ' — 미궁을 정복했습니다' : ' — AI의 기억력이 앞섰습니다'}
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
      <span className="game-title">암전 미궁</span>
    </header>
  );
}
