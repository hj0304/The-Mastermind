import { useEffect, useRef, useState } from 'react';
import type { HFState, PlayerId } from './engine.ts';
import {
  MAX_HINTS,
  ROUNDS,
  WINDOW_SECONDS,
  advanceHint,
  buzz,
  createGame,
  nextRound,
  numTurn,
  submitAnswer,
  submitNum,
} from './engine.ts';
import type { PublicView } from './ai.ts';
import {
  aiBuzzDelay,
  aiPickNumber,
  aiStatus,
  pickConsidered,
  recordGameEnd,
  recordRound,
} from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import './hiddenformula.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

const view = (s: HFState): PublicView => ({ X: s.X, Y: s.Y, hints: s.hints });

export default function HiddenFormulaGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<HFState | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [numInput, setNumInput] = useState('');
  const [ansInput, setAnsInput] = useState('');
  const [aiBuzzed, setAiBuzzed] = useState(false);
  const considered = useRef<number[]>([]);
  const roundRef = useRef(0);
  const windowKeyRef = useRef('');
  const recordedRound = useRef('');
  const recorded = useRef(false);

  function startGame() {
    const s = createGame(Math.random() < 0.5 ? HUMAN : AI);
    considered.current = pickConsidered();
    roundRef.current = 1;
    windowKeyRef.current = '';
    recordedRound.current = '';
    recorded.current = false;
    setAiBuzzed(false);
    setNumInput('');
    setAnsInput('');
    setState(s);
    setPhase('playing');
  }

  // 라운드 변경 → AI 고려 규칙 폭 재선정
  useEffect(() => {
    if (!state) return;
    if (state.round !== roundRef.current) {
      roundRef.current = state.round;
      considered.current = pickConsidered();
      setAiBuzzed(false);
    }
  }, [state]);

  // 힌트 창 시작 → 데드라인 설정 (오답 후 재개 시에는 유지)
  useEffect(() => {
    if (!state) return;
    if (state.phase === 'window') {
      const key = `${state.round}-${state.hints.length}`;
      if (windowKeyRef.current !== key) {
        windowKeyRef.current = key;
        setDeadline(Date.now() + WINDOW_SECONDS * 1000);
      }
    }
  }, [state]);

  // 카운트다운 + 시간 초과
  useEffect(() => {
    if (phase !== 'playing' || !state || state.phase !== 'window' || !deadline) return;
    const iv = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= deadline) {
        setState((s) => {
          if (!s || s.phase !== 'window') return s;
          return advanceHint(s);
        });
      }
    }, 250);
    return () => clearInterval(iv);
  }, [phase, state, deadline]);

  // AI 시퀀서
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result) return;

    // 수 제시
    if ((state.phase === 'num1' || state.phase === 'num2') && numTurn(state) === AI) {
      const t = setTimeout(() => {
        setState((s) => {
          if (!s || (s.phase !== 'num1' && s.phase !== 'num2') || numTurn(s) !== AI) return s;
          try {
            const pos = s.phase === 'num1' ? 'first' : 'second';
            const n = aiPickNumber(view(s), pos, s.num1, considered.current);
            return submitNum(s, n);
          } catch {
            return submitNum(s, 7);
          }
        });
      }, 1000 + Math.random() * 900);
      return () => clearTimeout(t);
    }

    // 버저 (확신할 때만)
    if (state.phase === 'window' && !state.wrongBuzzed[AI] && deadline) {
      const st = aiStatus(view(state), considered.current);
      if (st.certain) {
        const remainMs = deadline - Date.now();
        const delay = Math.max(600, Math.min(aiBuzzDelay(state.hints.length), remainMs - 1500));
        const t = setTimeout(() => {
          setAiBuzzed(true);
          setState((s) => {
            if (!s || s.phase !== 'window' || s.wrongBuzzed[AI]) return s;
            try {
              return buzz(s, AI);
            } catch {
              return s;
            }
          });
        }, delay);
        return () => clearTimeout(t);
      }
      return;
    }

    // AI 정답 제시
    if (state.phase === 'answer' && state.answerer === AI) {
      const t = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'answer' || s.answerer !== AI) return s;
          const st = aiStatus(view(s), considered.current);
          return submitAnswer(s, st.answer ?? '0');
        });
        setAiBuzzed(false);
      }, 1700);
      return () => clearTimeout(t);
    }
  }, [phase, state, deadline]);

  // 라운드 종료 학습 기록
  useEffect(() => {
    if (!state || state.phase !== 'roundend' || !state.lastRound) return;
    const key = `${state.round}`;
    if (recordedRound.current === key) return;
    recordedRound.current = key;
    recordRound(state.lastRound.winner === HUMAN);
  }, [state]);

  // 게임 종료
  useEffect(() => {
    if (phase !== 'playing' || !state?.result || recorded.current) return;
    recorded.current = true;
    recordGameEnd();
    recordResult('hidden-formula', state.result.winner === HUMAN);
    const t = setTimeout(() => setPhase('done'), 800);
    return () => clearTimeout(t);
  }, [phase, state]);

  function submitMyNum() {
    const n = parseInt(numInput, 10);
    if (!Number.isFinite(n)) return;
    setState((s) => {
      if (!s || (s.phase !== 'num1' && s.phase !== 'num2') || numTurn(s) !== HUMAN) return s;
      try {
        return submitNum(s, n);
      } catch {
        return s;
      }
    });
    setNumInput('');
  }

  function myBuzz() {
    setState((s) => {
      if (!s || s.phase !== 'window' || s.wrongBuzzed[HUMAN]) return s;
      try {
        return buzz(s, HUMAN);
      } catch {
        return s;
      }
    });
  }

  function submitMyAnswer() {
    if (!ansInput.trim()) return;
    setState((s) => {
      if (!s || s.phase !== 'answer' || s.answerer !== HUMAN) return s;
      return submitAnswer(s, ansInput);
    });
    setAnsInput('');
  }

  function skipHint() {
    if (!state || state.phase !== 'window') return;
    const st = aiStatus(view(state), considered.current);
    if (st.certain && !state.wrongBuzzed[AI]) {
      // AI는 알고 있다 — 넘기려는 순간 버저를 누른다
      setAiBuzzed(true);
      setState((s) => (s && s.phase === 'window' && !s.wrongBuzzed[AI] ? buzz(s, AI) : s));
    } else {
      setState((s) => (s && s.phase === 'window' ? advanceHint(s) : s));
    }
  }

  if (phase === 'setup') {
    const rec = getRecord('hidden-formula');
    return (
      <div className="hf-root">
        <GameHeader onExit={onExit} />
        <div className="hf-setup">
          <h2>히든 포뮬러</h2>
          <p className="hf-rule-summary">
            <b>X ? Y</b> — 물음표에 숨은 연산 규칙을 추리하는 버저 게임. 번갈아 수를
            제시하면 그 두 수를 숨은 규칙에 대입한 <b>힌트</b>가 공개됩니다. 규칙을
            간파했다면 <b>버저</b>를 누르고 문제의 정답을 제시하세요 — 정답 <b>+1점</b>,
            오답 <b>−1점</b>(기회는 상대에게). 힌트는 문제당 최대 {MAX_HINTS}개,
            총 {ROUNDS}라운드 승점 승부!
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 힌트와 모순되는 규칙을 소거하는 귀납 추론만 사용하며, 당신의 정답률을 학습해 추론 폭과 버저 속도를 조절합니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>대전 시작</button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const remainSec = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : WINDOW_SECONDS;
  const myNumTurn = (state.phase === 'num1' || state.phase === 'num2') && numTurn(state) === HUMAN;

  return (
    <div className="hf-root">
      <GameHeader onExit={onExit} />

      <div className="hf-status">
        <div className={`hf-score me ${state.answerer === HUMAN ? 'answering' : ''}`}>
          나 <b>{state.scores[HUMAN]}</b>점
        </div>
        <div className="hf-round">
          라운드 {Math.min(state.round, ROUNDS)}/{ROUNDS}
          {state.round > ROUNDS && ' (연장)'}
        </div>
        <div className={`hf-score ai ${state.answerer === AI ? 'answering' : ''}`}>
          AI <b>{state.scores[AI]}</b>점
        </div>
      </div>

      <div className="hf-problem">
        <span className="num">{state.X}</span>
        <span className="q">?</span>
        <span className="num">{state.Y}</span>
      </div>

      <div className="hf-hints">
        {state.hints.length === 0 && <p className="hf-empty">첫 힌트를 만들 수를 제시하세요</p>}
        {state.hints.map((h, i) => (
          <div key={i} className={`hf-hint ${i === state.hints.length - 1 ? 'latest' : ''}`}>
            <span className="idx">{i + 1}</span>
            <span className="expr">{h.a} ? {h.b} = <b>{h.c}</b></span>
          </div>
        ))}
      </div>

      <div className="hf-controls">
        {state.phase === 'gameover' || phase === 'done' ? null : state.phase === 'roundend' && state.lastRound ? (
          <div className="hf-roundend">
            <p className="hf-reveal">
              {state.lastRound.winner === null
                ? '아무도 규칙을 간파하지 못했습니다'
                : state.lastRound.winner === HUMAN
                  ? '🎉 정답! +1점'
                  : 'AI가 정답을 맞혔습니다'}
            </p>
            <p className="hf-rule-reveal">
              규칙: <b>{state.lastRound.ruleDesc}</b> · 정답 <b>{state.lastRound.answer}</b>
            </p>
            <button
              className="primary-btn"
              onClick={() => setState((s) => (s && s.phase === 'roundend' ? nextRound(s) : s))}
            >
              {state.round >= ROUNDS && state.scores[0] !== state.scores[1] ? '결과 보기' : '다음 라운드'}
            </button>
          </div>
        ) : state.phase === 'num1' || state.phase === 'num2' ? (
          myNumTurn ? (
            <div className="hf-numform">
              <p className="hf-prompt">
                {state.phase === 'num1' ? '힌트의 앞 수' : `힌트의 뒤 수 (${state.num1} ? □)`}를
                제시하세요 (0 제외)
              </p>
              <div className="hf-input-row">
                <input
                  type="number"
                  min={1}
                  value={numInput}
                  onChange={(e) => setNumInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitMyNum()}
                  placeholder="1~999999"
                />
                <button className="primary-btn" onClick={submitMyNum}>제시</button>
              </div>
            </div>
          ) : (
            <p className="hf-msg">AI가 수를 고르는 중…{state.num1 !== null && ` (${state.num1} ? □)`}</p>
          )
        ) : state.phase === 'window' ? (
          <div className="hf-window">
            <div className="hf-timer">
              <div className="hf-timer-bar" style={{ width: `${(remainSec / WINDOW_SECONDS) * 100}%` }} />
              <span className="hf-timer-num">{remainSec}s</span>
            </div>
            {aiBuzzed && <p className="hf-msg ai-buzz">🔔 AI 버저!</p>}
            <div className="hf-btn-row">
              <button className="buzzer" disabled={state.wrongBuzzed[HUMAN]} onClick={myBuzz}>
                🔔 버저!
              </button>
              <button className="ghost-btn" onClick={skipHint}>다음 힌트</button>
            </div>
            {state.wrongBuzzed[HUMAN] && <p className="hf-hint-msg">오답 — 이번 힌트에선 다시 누를 수 없습니다</p>}
            {state.wrongBuzzed[AI] && <p className="hf-hint-msg">AI가 오답을 냈습니다! (−1점)</p>}
          </div>
        ) : state.phase === 'answer' ? (
          state.answerer === HUMAN ? (
            <div className="hf-numform">
              <p className="hf-prompt">정답: <b>{state.X} ? {state.Y}</b> = ?</p>
              <div className="hf-input-row">
                <input
                  autoFocus
                  value={ansInput}
                  onChange={(e) => setAnsInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitMyAnswer()}
                  placeholder="정답 입력"
                />
                <button className="primary-btn" onClick={submitMyAnswer}>제출</button>
              </div>
            </div>
          ) : (
            <p className="hf-msg ai-buzz">🔔 AI가 정답을 말하는 중…</p>
          )
        ) : null}
      </div>

      {phase === 'done' && state.result && (
        <div className="hf-endcard-overlay">
          <div className="hf-endcard">
            <h3>{state.result.winner === HUMAN ? '승리!' : '패배…'}</h3>
            <p>
              최종 승점 {state.scores[HUMAN]} : {state.scores[AI]}
              {state.result.winner === HUMAN ? ' — 규칙을 지배했습니다' : ' — AI의 추론이 앞섰습니다'}
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
      <span className="game-title">히든 포뮬러</span>
    </header>
  );
}
