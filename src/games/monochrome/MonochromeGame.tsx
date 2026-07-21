import { useEffect, useRef, useState } from 'react';
import type { MonoState, PlayerId } from './engine.ts';
import { createGame, currentPlayer, isTerminal, play, tileColor, winner } from './engine.ts';
import { chooseAiMove, loadTendency, recordGameEnd, recordHumanPlay } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import MonochromeOnline from './MonochromeOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './monochrome.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

/** 솔로 플레이는 단일 EXTREME 난이도 */
const DIFFICULTY = 'hard' as const;

interface Props {
  onExit: () => void;
}

type Phase = 'setup' | 'playing' | 'done';

export default function MonochromeGame({ onExit }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<MonoState | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [lastResultFlash, setLastResultFlash] = useState<string | null>(null);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const gameEndRecorded = useRef(false);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  function startGame() {
    setToss(0); // 값은 의미 없다 — 선공은 동전을 던져 정해진다
  }

  function begin(first: PlayerId) {
    const firstLeader: PlayerId = first;
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
        const move = chooseAiMove(s, { difficulty: DIFFICULTY, me: AI });
        const next = play(s, move);
        flashResult(s, next);
        return next;
      });
      setAiThinking(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [phase, state]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state && isTerminal(state)) {
      if (!gameEndRecorded.current) {
        gameEndRecorded.current = true;
        recordGameEnd();
        recordResult('monochrome', winner(state) === HUMAN);
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

  if (online !== null && online !== 'panel') {
    return <MonochromeOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="mono-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel
          gameName="모노크롬"
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
    const rec = getRecord('monochrome');
    const memory = loadTendency().games;
    return (
      <div className="mono-root">
        <GameHeader onExit={onExit} />
        <div className="mono-setup">
          <h2>모노크롬</h2>
          <p className="mono-rule-summary">
            0~8 타일 아홉 장(짝수=흑, 홀수=백). 선이 타일을 엎어 내면 상대에겐 <b>색만</b> 보입니다.
            높은 숫자가 승점 1점, 승자가 다음 선. 단 <b>0은 8을 잡습니다</b> — 최약체가 최강자를
            무너뜨리는 한 수. 9라운드 후 승점이 높으면 승리 — 숫자는 끝까지 공개되지 않습니다.
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            {memory > 0 && (
              <span className="memory-line">AI가 당신과의 대국 {memory}판을 기억하고 있습니다</span>
            )}
          </div>
          <button className="primary-btn" onClick={startGame}>
            AI 대전 시작
          </button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>
            ⚔️ 온라인 대전
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
          <b>{state.scores[AI]}</b> AI (EXTREME)
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
