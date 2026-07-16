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
import YutBoard from '../shared/YutBoard.tsx';
import type { BoardPiece } from '../shared/YutBoard.tsx';
import './yut.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

interface Reveal {
  next: YState;
  picks: [number, number]; // [human 앞면 수, ai 앞면 수]
  steps: number;
  passed: boolean;
}

export default function YutTacticsGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<YState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [aiActing, setAiActing] = useState(false);
  const recorded = useRef(false);

  function startGame() {
    setState(createGame(Math.random() < 0.5 ? HUMAN : AI));
    setSelected(null);
    setReveal(null);
    recorded.current = false;
    setPhase('playing');
  }

  // 던지기 연출 종료 → 결과 상태 적용
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => {
      setState(reveal.next);
      setReveal(null);
    }, 2100);
    return () => clearTimeout(timer);
  }, [reveal]);

  // AI 무버의 이동 자동 진행
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result || reveal) return;
    if (state.phase === 'move' && state.turn === AI) {
      setAiActing(true);
      const timer = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'move' || s.turn !== AI) return s;
          return applyMove(s, chooseAiMove(s, AI));
        });
        setAiActing(false);
      }, 1100);
      return () => clearTimeout(timer);
    }
  }, [phase, state, reveal]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state?.result && !reveal) {
      if (!recorded.current) {
        recorded.current = true;
        recordGameEnd();
        if (state.result.winner !== null) {
          recordResult('yut-tactics', state.result.winner === HUMAN);
        }
      }
      const timer = setTimeout(() => setPhase('done'), 1100);
      return () => clearTimeout(timer);
    }
  }, [phase, state, reveal]);

  function onPick(humanPick: number) {
    if (!state || state.phase !== 'choose' || state.result || reveal) return;
    const aiPick = chooseAiSticks(state, AI);
    recordPickForLearning(state.turn === HUMAN, humanPick);
    const next = resolveThrow(state, [humanPick, aiPick]);
    setSelected(null);
    setReveal({
      next,
      picks: [humanPick, aiPick],
      steps: next.lastThrow!.steps,
      passed: next.lastThrow!.passed,
    });
  }

  const opts =
    state && state.phase === 'move' && state.turn === HUMAN && !reveal ? moveOptions(state) : [];
  const fromNodes = new Set(opts.map((o) => o.from));
  const selectedOpts = opts.filter((o) => o.from === selected);

  function onSelectFrom(from: number) {
    if (!fromNodes.has(from)) {
      setSelected(null);
      return;
    }
    const cand = opts.filter((o) => o.from === from);
    if (cand.length === 1) doMove(cand[0]);
    else setSelected(from);
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
            윷의 결과는 운이 아닙니다. 매 던지기마다 <b>양쪽이 윷가락 2개씩의 앞/뒤를 비밀
            선택</b>하고, 던져진 4가락의 앞면 수가 결과가 됩니다 — 0개 <b>모</b>(5칸·한번 더),
            1개 <b>뒷도</b>(1칸 후진!), 2개 <b>개</b>, 3개 <b>걸</b>, 4개 <b>윷</b>(한번 더).
            결과는 차례인 쪽 말에 적용됩니다. 잡으면 한 번 더, 같은 칸의 내 말은 업고 갑니다.
            말 2개 먼저 완주하면 승리 — <b>1번 칸에서 뒷도를 받으면 그대로 완주</b>입니다.
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

  const boardPieces: BoardPiece[] = [];
  for (const pl of [0, 1] as PlayerId[]) {
    state.pieces[pl].forEach((p, i) => {
      if (p.pos >= 0 && p.pos !== GOAL) {
        boardPieces.push({ id: `p${pl}-${i}`, player: pl, node: p.pos });
      }
    });
  }

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
                : '움직일 말(반짝이는 칸)을 선택하세요'}
        </span>
        {lt && !reveal && (
          <span className="yt-throw-info">
            나 앞{lt.picks[HUMAN]} + AI 앞{lt.picks[AI]} = <b>{STEP_NAME[lt.steps]}</b>
            {lt.passed && ' (움직일 말 없음 — 차례 넘김)'}
          </span>
        )}
      </div>

      <PlayerTray state={state} p={AI} label="AI" />

      <YutBoard
        pieces={boardPieces}
        movableNodes={new Set([...fromNodes].filter((n) => n >= 0))}
        selectedNode={selected}
        lastDest={state.lastMoveDest ?? null}
        onNodeClick={onSelectFrom}
      />

      <PlayerTray
        state={state}
        p={HUMAN}
        label="나"
        movable={fromNodes.has(HOME)}
        onEnter={() => onSelectFrom(HOME)}
      />

      {/* 조작 패널 */}
      <div className="yt-panel">
        {state.phase === 'choose' && !state.result && !reveal && (
          <>
            <span className="yt-note">
              {state.turn === HUMAN
                ? '내 말이 움직입니다 — 크게 노리세요 (단 합계 1이면 뒷도)'
                : 'AI 말이 움직입니다 — 뒷도(합계 1)를 노려보세요'}
            </span>
            <div className="yt-pick-btns">
              {[0, 1, 2].map((n) => (
                <button key={n} className="yt-pick" onClick={() => onPick(n)}>
                  <span className="mini-sticks">
                    <i className={n >= 1 ? 'f' : 'b'} />
                    <i className={n >= 2 ? 'f' : 'b'} />
                  </span>
                  앞 {n}개
                </button>
              ))}
            </div>
          </>
        )}
        {state.phase === 'move' && state.turn === HUMAN && !reveal && selectedOpts.length > 1 && (
          <div className="yt-branch-btns">
            {selectedOpts.map((o) => (
              <button key={o.branch} className="yt-pick" onClick={() => doMove(o)}>
                {o.branch === 1 ? '지름길' : selected === 22 ? '횡단길' : '바깥길'} →{' '}
                {o.dest === GOAL ? '완주!' : o.catches ? '잡기!' : '전진'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 윷 던지기 연출 */}
      {reveal && (
        <div className="yut-throw-overlay">
          <div className="yut-sticks">
            {([0, 1, 2, 3] as const).map((i) => {
              const isHuman = i < 2;
              const count = isHuman ? reveal.picks[0] : reveal.picks[1];
              const front = (isHuman ? i : i - 2) < count;
              return (
                <div
                  key={i}
                  className={`yut-stick ${front ? 'front' : 'back'}`}
                  style={{ ['--tilt' as string]: `${(i - 1.5) * 5}deg` }}
                >
                  <span className="stick-mark">{isHuman ? '나' : 'AI'}</span>
                </div>
              );
            })}
          </div>
          <div className="yut-throw-result">{STEP_NAME[reveal.steps]}!</div>
          <div className="yut-throw-sub">
            {reveal.next.lastThrow!.mover === HUMAN ? '내' : 'AI'} 말이{' '}
            {reveal.steps === -1 ? '1칸 후진' : `${reveal.steps}칸 전진`}
            {reveal.passed && ' — 움직일 말이 없어 차례를 넘깁니다'}
          </div>
        </div>
      )}

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
        {Array.from({ length: home }, (_, i) => (
          <span key={i} className={`tray-token pl${p}`} />
        ))}
        <span>대기 {home}</span>
      </button>
      <span className="yt-done">
        완주 <b>{done}</b>/2
      </span>
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
