import { useEffect, useRef, useState } from 'react';
import type { MonoState, PlayerId } from './engine.ts';
import { createGame, currentPlayer, isTerminal, play, tileColor, winner } from './engine.ts';
import type { Difficulty } from './ai.ts';
import { chooseAiMove, recordGameEnd, recordHumanPlay } from './ai.ts';
import './monochrome.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

const DIFF_LABEL: Record<Difficulty, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '극한',
};

interface Props {
  onExit: () => void;
}

type Phase = 'setup' | 'playing' | 'done';

export default function MonochromeGame({ onExit }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [state, setState] = useState<MonoState | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [lastResultFlash, setLastResultFlash] = useState<string | null>(null);
  const gameEndRecorded = useRef(false);

  function startGame() {
    const firstLeader: PlayerId = Math.random() < 0.5 ? HUMAN : AI;
    setState(createGame(firstLeader));
    gameEndRecorded.current = false;
    setLastResultFlash(null);
    setPhase('playing');
  }

  // AI 턴 자동 진행
  useEffect(() => {
    if (phase !== 'playing' || !state || isTerminal(state)) return;
    if (currentPlayer(state) !== AI) return;
    setAiThinking(true);
    const delay = 600 + Math.random() * 700;
    const timer = setTimeout(() => {
      setState((s) => {
        if (!s || isTerminal(s) || currentPlayer(s) !== AI) return s;
        const move = chooseAiMove(s, { difficulty, me: AI });
        const next = play(s, move);
        flashResult(s, next);
        return next;
      });
      setAiThinking(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [phase, state, difficulty]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state && isTerminal(state)) {
      if (!gameEndRecorded.current) {
        gameEndRecorded.current = true;
        recordGameEnd();
      }
      const timer = setTimeout(() => setPhase('done'), 900);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  function flashResult(prev: MonoState, next: MonoState) {
    if (next.history.length > prev.history.length) {
      const r = next.history[next.history.length - 1];
      const msg =
        r.winner === null ? '무승부!' : r.winner === HUMAN ? '라운드 승리!' : '라운드 패배';
      setLastResultFlash(msg);
      setTimeout(() => setLastResultFlash(null), 1200);
    }
  }

  function onHumanPlay(tile: number) {
    if (!state || phase !== 'playing') return;
    if (currentPlayer(state) !== HUMAN || aiThinking) return;
    recordHumanPlay(state.history.length % 9, tile);
    const next = play(state, tile);
    flashResult(state, next);
    setState(next);
  }

  // ---------- 렌더 ----------

  if (phase === 'setup') {
    return (
      <div className="mono-root">
        <GameHeader onExit={onExit} />
        <div className="mono-setup">
          <h2>모노크롬</h2>
          <p className="mono-rule-summary">
            0~8 타일 아홉 장(짝수=흑, 홀수=백). 선이 타일을 엎어 내면 상대에겐 <b>색만</b> 보입니다.
            높은 숫자가 승점 1점, 승자가 다음 선. 9라운드 후 승점이 높으면 승리 — 숫자는 끝까지
            공개되지 않습니다.
          </p>
          <div className="mono-diff-select">
            {(Object.keys(DIFF_LABEL) as Difficulty[]).map((d) => (
              <button
                key={d}
                className={`diff-btn ${difficulty === d ? 'active' : ''}`}
                onClick={() => setDifficulty(d)}
              >
                {DIFF_LABEL[d]}
                {d === 'hard' && <span className="diff-note">패턴 학습 AI</span>}
              </button>
            ))}
          </div>
          <button className="primary-btn" onClick={startGame}>
            대전 시작
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const myTurn = phase === 'playing' && currentPlayer(state) === HUMAN && !aiThinking;
  const iAmLeader = state.leader === HUMAN;
  const aiPending = state.pending !== null && currentPlayer(state) === HUMAN;
  const roundNo = Math.min((state.history.length % 9) + 1, 9);

  return (
    <div className="mono-root">
      <GameHeader onExit={onExit} />

      <div className="mono-scoreboard">
        <div className="score me">
          나 <b>{state.scores[HUMAN]}</b>
        </div>
        <div className="round-info">
          {state.overtime > 0 && <span className="overtime">연장 {state.overtime}</span>}
          라운드 {roundNo}/9
        </div>
        <div className="score ai">
          <b>{state.scores[AI]}</b> AI ({DIFF_LABEL[difficulty]})
        </div>
      </div>

      {/* 상대 영역 */}
      <div className="mono-opponent">
        <div className="label">
          상대 타일 {state.hands[AI].length + (aiPending ? 1 : 0)}장
          {state.leader === AI && <span className="leader-mark"> · 선</span>}
        </div>
        <div className="tile-backs">
          {/* 상대 잔여 타일 수만큼 뒷면 표시 — 색 구성은 비공개이므로 중립 */}
          {Array.from({ length: state.hands[AI].length }, (_, i) => (
            <div key={i} className="tile back neutral" />
          ))}
        </div>
      </div>

      {/* 중앙 대결 영역 */}
      <div className="mono-table">
        {aiPending ? (
          <div className={`tile back ${tileColor(state.pending!)}`}>
            <span className="q">?</span>
          </div>
        ) : state.pending !== null ? (
          <div className={`tile face ${tileColor(state.pending)}`}>{state.pending}</div>
        ) : (
          <div className="table-hint">
            {aiThinking ? 'AI가 고민 중…' : iAmLeader ? '당신이 선입니다 — 타일을 내세요' : ''}
          </div>
        )}
        {lastResultFlash && <div className="result-flash">{lastResultFlash}</div>}
      </div>

      {/* 내 손패 */}
      <div className="mono-hand">
        <div className="label">
          내 타일{state.leader === HUMAN && <span className="leader-mark"> · 선</span>}
          {aiPending && ' — 상대가 낸 타일의 색을 보고 응수하세요'}
        </div>
        <div className="tiles">
          {state.hands[HUMAN].map((t) => (
            <button
              key={t}
              className={`tile face ${tileColor(t)} playable`}
              disabled={!myTurn}
              onClick={() => onHumanPlay(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 히스토리 */}
      <div className="mono-history">
        {state.history.slice(9 * state.overtime).map((r, i) => (
          <div key={i} className={`hist-row ${r.winner === HUMAN ? 'win' : r.winner === AI ? 'lose' : 'draw'}`}>
            <span className="hist-round">R{i + 1}</span>
            <span className={`hist-tile ${tileColor(r.tiles[HUMAN])}`}>{r.tiles[HUMAN]}</span>
            <span className="hist-vs">vs</span>
            <span className={`hist-tile ${tileColor(r.tiles[AI])}`}>
              {r.winner === null ? r.tiles[AI] : '?'}
            </span>
            <span className="hist-result">
              {r.winner === HUMAN ? '승' : r.winner === AI ? '패' : '무'}
            </span>
          </div>
        ))}
      </div>

      {phase === 'done' && (
        <div className="mono-overlay">
          <div className="mono-endcard">
            <h2>{winner(state) === HUMAN ? '🏆 승리!' : '패배…'}</h2>
            <p>
              {state.scores[HUMAN]} : {state.scores[AI]}
            </p>
            <div className="end-actions">
              <button className="primary-btn" onClick={startGame}>
                다시 대전
              </button>
              <button className="ghost-btn" onClick={onExit}>
                로비로
              </button>
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
      <button className="back-btn" onClick={onExit}>
        ← 로비
      </button>
      <span className="game-title">모노크롬</span>
    </header>
  );
}
