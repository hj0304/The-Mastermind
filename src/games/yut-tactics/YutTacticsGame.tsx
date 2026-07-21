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
  totalToSteps,
} from './engine.ts';
import { chooseAiMove, chooseAiSticks, recordGameEnd, recordPickForLearning } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import YutBoard from '../shared/YutBoard.tsx';
import type { BoardPiece } from '../shared/YutBoard.tsx';
import { PlayerTray } from './tray.tsx';
import YutTacticsOnline from './YutTacticsOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './yut.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

interface Reveal {
  picks: [number, number]; // [human 앞면 수, ai 앞면 수]
  steps: number;
  again: boolean;
  mover: PlayerId;
}

export default function YutTacticsGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<YState | null>(null);
  const [selectedStep, setSelectedStep] = useState(0);
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [aiActing, setAiActing] = useState(false);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  function startGame() {
    setToss(Math.random() < 0.5 ? HUMAN : AI);
  }

  function begin(first: PlayerId) {
    setState(createGame(first));
    setSelectedStep(0);
    setSelectedFrom(null);
    setReveal(null);
    recorded.current = false;
    setPhase('playing');
  }

  // 던지기 연출 종료 → 그 시점의 최신 상태에 결과 적용 (미리 계산한 상태를
  // 덮어쓰면 그 사이의 변화가 지워지는 레이스가 생긴다)
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => {
      setState((s) =>
        s && s.phase === 'choose' && !s.result ? resolveThrow(s, reveal.picks) : s,
      );
      setReveal(null);
    }, 2100);
    return () => clearTimeout(timer);
  }, [reveal]);

  // AI 무버의 이동 자동 진행 (남은 결과를 하나씩 적용)
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
    const steps = totalToSteps(humanPick + aiPick);
    setSelectedStep(0);
    setSelectedFrom(null);
    setReveal({
      picks: [humanPick, aiPick],
      steps,
      again: steps === 4 || steps === 5,
      mover: state.turn,
    });
  }

  const myMovePhase =
    !!state && state.phase === 'move' && state.turn === HUMAN && !state.result && !reveal;
  const allOpts = myMovePhase ? moveOptions(state) : [];
  const stepIdx = state && selectedStep < state.pending.length ? selectedStep : 0;
  const stepOpts = allOpts.filter((o) => o.stepIdx === stepIdx);
  const fromNodes = new Set(stepOpts.map((o) => o.from));
  const destOpts = selectedFrom !== null ? stepOpts.filter((o) => o.from === selectedFrom) : [];
  const targetNodes = new Set(destOpts.map((o) => o.dest).filter((d) => d !== GOAL));
  const goalOpt = destOpts.find((o) => o.dest === GOAL);

  function doMove(o: MoveOption) {
    if (!state) return;
    // 함수형 업데이트 + 방어: 연속 클릭 등으로 상태가 이미 바뀌었으면 무시
    setState((s) => {
      if (!s || s.phase !== 'move' || s.result) return s;
      try {
        return applyMove(s, o);
      } catch {
        return s;
      }
    });
    setSelectedStep(0);
    setSelectedFrom(null);
  }

  function onNodeClick(n: number) {
    if (!myMovePhase) return;
    // 도착 칸 클릭 → 이동 확정
    if (selectedFrom !== null) {
      const hit = destOpts.find((o) => o.dest === n);
      if (hit) {
        doMove(hit);
        return;
      }
    }
    // 출발 말 선택 — 도착지가 하나뿐이어도 바로 옮기지 않는다.
    // 어디로 가는지 먼저 보여주고 유저가 그 칸을 눌러 확정하게 한다.
    if (fromNodes.has(n)) {
      setSelectedFrom(n === selectedFrom ? null : n);
      return;
    }
    setSelectedFrom(null);
  }

  if (online !== null && online !== 'panel') {
    return <YutTacticsOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="yt-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel gameName="윷 대전" onReady={(room) => setOnline(room)} onCancel={() => setOnline(null)} />
      </div>
    );
  }

  if (toss !== null) {
    return (
      <CoinToss
        first={toss}
        labels={['나', 'AI']}
        onDone={() => {
          begin(toss);
          setToss(null);
        }}
      />
    );
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
            선택</b>하고, 던져진 4가락의 앞면 수가 결과가 됩니다 — 0개 <b>모</b>(5칸), 1개{' '}
            <b>뒷도</b>(1칸 후진!), 2개 <b>개</b>, 3개 <b>걸</b>, 4개 <b>윷</b>. 윷·모가 나오면{' '}
            <b>한 번 더 던진 뒤</b> 모인 결과를 원하는 순서로 씁니다. 잡으면 한 번 더, 같은
            칸의 내 말은 업고 갑니다. 말 2개 먼저 완주하면 승리 — <b>1번 칸에서 뒷도를 받으면
            그대로 완주</b>입니다.
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 당신의 윷가락 선택 패턴을 역할별로 학습합니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>AI 대전 시작</button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>⚔️ 온라인 대전</button>
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
              ? state.extraThrow
                ? `${moverName} — 잡았다! 보너스 던지기`
                : state.pending.length > 0
                  ? `${moverName} — 윷·모! 한 번 더 던집니다`
                  : `${moverName}의 말이 움직이는 던지기`
              : aiActing
                ? 'AI가 말을 고르는 중…'
                : selectedFrom !== null
                  ? '초록 칸(도착지)을 눌러 이동하세요'
                  : '움직일 말(반짝이는 칸)을 선택하세요'}
        </span>
        {lt && !reveal && (
          <span className="yt-throw-info">
            나 앞{lt.picks[HUMAN]} + AI 앞{lt.picks[AI]} = <b>{STEP_NAME[lt.steps]}</b>
            {lt.passed && ' (쓸 수 있는 결과 없음 — 차례 넘김)'}
          </span>
        )}
        {/* 모인 결과 칩 */}
        {state.pending.length > 0 && !reveal && (
          <div className="yt-step-chips">
            <span className="chips-label">남은 결과:</span>
            {state.pending.map((st, i) => (
              <button
                key={i}
                className={`yt-step-chip ${myMovePhase && i === stepIdx ? 'active' : ''}`}
                disabled={!myMovePhase}
                onClick={() => {
                  setSelectedStep(i);
                  setSelectedFrom(null);
                }}
              >
                {STEP_NAME[st]}
              </button>
            ))}
          </div>
        )}
      </div>

      <PlayerTray state={state} p={AI} label="AI" />

      <YutBoard
        pieces={boardPieces}
        movableNodes={
          selectedFrom === null ? new Set([...fromNodes].filter((n) => n >= 0)) : undefined
        }
        targetNodes={targetNodes}
        selectedNode={selectedFrom}
        lastDest={state.lastMoveDest ?? null}
        onNodeClick={onNodeClick}
      />

      <PlayerTray
        state={state}
        p={HUMAN}
        label="나"
        movable={myMovePhase && fromNodes.has(HOME)}
        onEnter={() => onNodeClick(HOME)}
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
        {myMovePhase && goalOpt && (
          <button className="primary-btn" onClick={() => doMove(goalOpt)}>
            🏁 완주!
          </button>
        )}
        {myMovePhase && selectedFrom !== null && !goalOpt && destOpts.length > 0 && (
          <span className="yt-note dim">
            {destOpts.length > 1
              ? '갈림길 — 초록으로 표시된 도착 칸 중 하나를 누르세요'
              : '초록으로 표시된 도착 칸을 눌러 이동을 확정하세요'}
          </span>
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
            {reveal.again
              ? '윷·모 — 한 번 더 던집니다!'
              : `${reveal.mover === HUMAN ? '내' : 'AI'} 말이 결과를 사용합니다`}
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

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">윷 대전</span>
    </header>
  );
}
