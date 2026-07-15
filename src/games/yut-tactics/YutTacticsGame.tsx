import { useEffect, useRef, useState } from 'react';
import type { MoveOption, PlayerId, YState } from './engine.ts';
import {
  GOAL,
  HOME,
  STEP_NAME,
  applyMove,
  createGame,
  moveOptions,
  resolveThrow,
} from './engine.ts';
import { chooseAiMove, chooseAiSticks, recordGameEnd, recordPickForLearning } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import './yut.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

const POS: Record<number, [number, number]> = {
  0: [300, 300], 1: [300, 246], 2: [300, 192], 3: [300, 138], 4: [300, 84], 5: [300, 30],
  6: [246, 30], 7: [192, 30], 8: [138, 30], 9: [84, 30], 10: [30, 30],
  11: [30, 84], 12: [30, 138], 13: [30, 192], 14: [30, 246], 15: [30, 300],
  16: [84, 300], 17: [138, 300], 18: [192, 300], 19: [246, 300],
  20: [255, 75], 21: [210, 120], 22: [165, 165], 23: [120, 210], 24: [75, 255],
  25: [75, 75], 26: [120, 120], 27: [210, 210], 28: [255, 255],
};
const BIG_NODES = new Set([0, 5, 10, 15, 22]);

export default function YutTacticsGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<YState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [aiActing, setAiActing] = useState(false);
  const recorded = useRef(false);

  function startGame() {
    setState(createGame(Math.random() < 0.5 ? HUMAN : AI));
    setSelected(null);
    recorded.current = false;
    setPhase('playing');
  }

  // AI 무버의 이동 자동 진행
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result) return;
    if (state.phase === 'move' && state.turn === AI) {
      setAiActing(true);
      const timer = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'move' || s.turn !== AI) return s;
          return applyMove(s, chooseAiMove(s, AI));
        });
        setAiActing(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state?.result) {
      if (!recorded.current) {
        recorded.current = true;
        recordGameEnd();
        if (state.result.winner !== null) {
          recordResult('yut-tactics', state.result.winner === HUMAN);
        }
      }
      const timer = setTimeout(() => setPhase('done'), 900);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  function onPick(humanPick: number) {
    if (!state || state.phase !== 'choose' || state.result) return;
    const aiPick = chooseAiSticks(state, AI);
    recordPickForLearning(state.turn === HUMAN, humanPick);
    setState(resolveThrow(state, [humanPick, aiPick]));
    setSelected(null);
  }

  const opts = state && state.phase === 'move' && state.turn === HUMAN ? moveOptions(state) : [];
  const fromNodes = new Set(opts.map((o) => o.from));
  const selectedOpts = opts.filter((o) => o.from === selected);

  function onSelectFrom(from: number) {
    if (!fromNodes.has(from)) {
      setSelected(null);
      return;
    }
    const cand = opts.filter((o) => o.from === from);
    if (cand.length === 1) {
      doMove(cand[0]);
    } else {
      setSelected(from);
    }
  }

  function doMove(o: MoveOption) {
    if (!state) return;
    setState(applyMove(state, o));
    setSelected(null);
  }

  if (phase === 'setup') {
    const rec = getRecord('yut-tactics');
    return (
      <div className="yt-root">
        <GameHeader onExit={onExit} />
        <div className="yt-setup">
          <h2>윷 대전</h2>
          <p className="yt-rule-summary">
            윷을 던지지 않습니다. 매번 <b>양쪽이 윷가락 2개씩의 앞/뒤를 비밀 선택</b>하고, 앞면
            총수가 결과가 됩니다 — 0개 <b>모</b>(5칸·한번 더), 1개 <b>뒷도</b>(1칸 후진!), 2개{' '}
            <b>개</b>, 3개 <b>걸</b>, 4개 <b>윷</b>(한번 더). 결과는 차례인 쪽 말에 적용되니, 내
            차례엔 크게, 상대 차례엔 뒷도를 노리세요. 상대 말을 잡으면 한 번 더. 말 2개를 먼저
            완주시키면 승리 — <b>1번 칸에서 뒷도를 받으면 그대로 완주</b>입니다.
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 당신의 윷가락 선택 패턴을 역할별로 학습합니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>대전 시작</button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const lt = state.lastThrow;
  const moverName = state.turn === HUMAN ? '나' : 'AI';

  return (
    <div className="yt-root">
      <GameHeader onExit={onExit} />

      <div className="yt-status">
        <span>
          {state.result
            ? state.result.winner === null
              ? '무승부'
              : state.result.winner === HUMAN
                ? '승리!'
                : 'AI 승리'
            : state.phase === 'choose'
              ? `${moverName}의 말이 움직이는 던지기`
              : aiActing
                ? 'AI가 말을 고르는 중…'
                : '움직일 말을 선택하세요'}
        </span>
        {lt && (
          <span className="yt-throw-info">
            나 앞{lt.picks[HUMAN]} + AI 앞{lt.picks[AI]} ={' '}
            <b>{STEP_NAME[lt.steps]}</b>
            {lt.passed && ' (움직일 말 없음 — 차례 넘김)'}
          </span>
        )}
      </div>

      <PlayerTray state={state} p={AI} label="AI" />

      <div className="yt-board-wrap">
        <svg className="yt-board" viewBox="0 0 330 330">
          {/* 윷판 선 */}
          <rect x={30} y={30} width={270} height={270} className="yt-frame" />
          <line x1={300} y1={30} x2={30} y2={300} className="yt-frame" />
          <line x1={30} y1={30} x2={300} y2={300} className="yt-frame" />
          {/* 노드 */}
          {Object.entries(POS).map(([id, [x, y]]) => {
            const n = Number(id);
            return (
              <circle
                key={n}
                cx={x}
                cy={y}
                r={BIG_NODES.has(n) ? 13 : 9}
                className={`yt-node ${fromNodes.has(n) ? 'movable' : ''} ${
                  selected === n ? 'sel' : ''
                } ${state.lastMoveDest === n ? 'last' : ''}`}
                onClick={() => onSelectFrom(n)}
              />
            );
          })}
          <text x={300} y={323} textAnchor="middle" className="yt-start-label">출발·도착</text>
          {/* 말 */}
          {([0, 1] as PlayerId[]).map((pl) => {
            const byNode = new Map<number, number>();
            for (const p of state.pieces[pl]) {
              if (p.pos >= 0 && p.pos !== GOAL) byNode.set(p.pos, (byNode.get(p.pos) ?? 0) + 1);
            }
            return [...byNode.entries()].map(([node, count]) => {
              const [x, y] = POS[node];
              const dx = pl === HUMAN ? -4 : 4;
              return (
                <g key={`${pl}-${node}`} className={`yt-piece pl${pl}`} onClick={() => onSelectFrom(node)}>
                  <circle cx={x + dx} cy={y - 4} r={10} className="yt-token" />
                  {count > 1 && (
                    <text x={x + dx} y={y} textAnchor="middle" className="yt-stack-badge">
                      {count}
                    </text>
                  )}
                </g>
              );
            });
          })}
        </svg>
      </div>

      <PlayerTray state={state} p={HUMAN} label="나" movable={fromNodes.has(HOME)} onEnter={() => onSelectFrom(HOME)} />

      {/* 조작 패널 */}
      <div className="yt-panel">
        {state.phase === 'choose' && !state.result && (
          <>
            <span className="yt-note">
              {state.turn === HUMAN
                ? '내 말이 움직입니다 — 앞면이 많을수록 멀리 (단 합계 1이면 뒷도)'
                : 'AI 말이 움직입니다 — 뒷도(합계 1)를 노려보세요'}
            </span>
            <div className="yt-pick-btns">
              <button className="yt-pick" onClick={() => onPick(0)}>뒤 · 뒤 <small>앞 0</small></button>
              <button className="yt-pick" onClick={() => onPick(1)}>앞 · 뒤 <small>앞 1</small></button>
              <button className="yt-pick" onClick={() => onPick(2)}>앞 · 앞 <small>앞 2</small></button>
            </div>
          </>
        )}
        {state.phase === 'move' && state.turn === HUMAN && selectedOpts.length > 1 && (
          <div className="yt-branch-btns">
            {selectedOpts.map((o) => (
              <button key={o.branch} className="yt-pick" onClick={() => doMove(o)}>
                {o.branch === 1 ? '지름길' : selected === 22 ? '횡단길' : '바깥길'} →{' '}
                {o.dest === GOAL ? '완주!' : `${o.catches ? '잡기!' : ''} 전진`}
              </button>
            ))}
          </div>
        )}
        {state.phase === 'move' && state.turn === HUMAN && selectedOpts.length <= 1 && (
          <span className="yt-note dim">반짝이는 칸(또는 대기 말)을 눌러 이동하세요</span>
        )}
      </div>

      {phase === 'done' && state.result && (
        <div className="yt-overlay">
          <div className="yt-endcard">
            <h2>
              {state.result.winner === null
                ? '무승부'
                : state.result.winner === HUMAN
                  ? '🏆 승리!'
                  : '패배…'}
            </h2>
            <p>
              {state.result.winner === null
                ? '승부를 가리지 못했습니다'
                : state.result.winner === HUMAN
                  ? '두 말이 모두 완주했습니다'
                  : 'AI의 두 말이 먼저 완주했습니다'}
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

function PlayerTray({
  state,
  p,
  label,
  movable,
  onEnter,
}: {
  state: YState;
  p: PlayerId;
  label: string;
  movable?: boolean;
  onEnter?: () => void;
}) {
  const home = state.pieces[p].filter((x) => x.pos === HOME).length;
  const done = state.pieces[p].filter((x) => x.pos === GOAL).length;
  return (
    <div className={`yt-tray pl${p}`}>
      <span className="yt-tray-label">{label}</span>
      <button
        className={`yt-home ${movable ? 'movable' : ''}`}
        disabled={!movable}
        onClick={onEnter}
      >
        대기 {home}
      </button>
      <span className="yt-done">완주 {done}/2</span>
    </div>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">윷 대전</span>
    </header>
  );
}
