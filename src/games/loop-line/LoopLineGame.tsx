import { useEffect, useRef, useState } from 'react';
import type { LLState, PlayerId } from './engine.ts';
import {
  H,
  STATIONS,
  TILES,
  W,
  applyDeclare,
  applyGiveUp,
  applyPlace,
  createGame,
  isValidLine,
  placedSet,
} from './engine.ts';
import { chooseAiAction, recordGameEnd } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import LoopLineOnline from './LoopLineOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import { RailTile, StationTile, TrainOnLoop, openDirs } from './rail.tsx';
import './loopline.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

/** 완성된 순환선 렌더용 글리프 */

export default function LoopLineGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<LLState | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);
  const humanDeclared = useRef(false);

  function startGame() {
    setState(createGame(Math.random() < 0.5 ? HUMAN : AI));
    setPicks([]);
    setNotice(null);
    recorded.current = false;
    humanDeclared.current = false;
    setPhase('playing');
  }

  // AI 진행 (일반 턴 + 불가능 선언 후 완성 시도)
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result) return;
    const aiActs =
      (state.phase === 'play' && state.turn === AI) ||
      (state.phase === 'attempt' && state.attempter === AI);
    if (!aiActs) return;
    setAiThinking(true);
    const t = setTimeout(() => {
      setState((s) => {
        if (!s || s.result) return s;
        const acting =
          (s.phase === 'play' && s.turn === AI) ||
          (s.phase === 'attempt' && s.attempter === AI);
        if (!acting) return s;
        try {
          const act = chooseAiAction(s, AI);
          if (act.kind === 'place') return applyPlace(s, act.line);
          if (act.kind === 'declare') {
            setNotice('AI: 불가능 선언! 남은 타일로 순환선을 완성하면 당신의 승리입니다');
            return applyDeclare(s);
          }
          setNotice('AI가 완성을 포기했습니다');
          return applyGiveUp(s);
        } catch {
          return s;
        }
      });
      setAiThinking(false);
    }, state.phase === 'attempt' ? 700 : 650);
    return () => clearTimeout(t);
  }, [phase, state]);

  // 종료 기록
  useEffect(() => {
    if (phase !== 'playing' || !state?.result || recorded.current) return;
    recorded.current = true;
    recordGameEnd(humanDeclared.current, state.result.winner === HUMAN);
    recordResult('loop-line', state.result.winner === HUMAN);
    const t = setTimeout(() => setPhase('done'), 2400);
    return () => clearTimeout(t);
  }, [phase, state]);

  const humanActs =
    !!state &&
    !state.result &&
    ((state.phase === 'play' && state.turn === HUMAN) ||
      (state.phase === 'attempt' && state.attempter === HUMAN)) &&
    !aiThinking;

  function togglePick(cell: number) {
    if (!humanActs) return;
    setPicks((p) => (p.includes(cell) ? p.filter((c) => c !== cell) : [...p, cell]));
  }

  function confirmPlace() {
    if (!humanActs || !state) return;
    try {
      const next = applyPlace(state, picks);
      setState(next);
      setPicks([]);
      setNotice(null);
    } catch {
      // 무효 — UI 가드로 도달 불가
    }
  }

  function declare() {
    if (!humanActs || !state || state.phase !== 'play' || picks.length > 0) return;
    humanDeclared.current = true;
    setNotice('불가능 선언! AI가 남은 타일로 완성을 시도합니다…');
    setState(applyDeclare(state));
  }

  function giveUp() {
    if (!humanActs || !state || state.phase !== 'attempt') return;
    setState(applyGiveUp(state));
  }

  if (online !== null && online !== 'panel') {
    return <LoopLineOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="ll-root">
        <header className="game-header">
          <button className="back-btn" onClick={onExit}>← 로비</button>
          <span className="game-title">순환선</span>
        </header>
        <OnlinePanel
          gameName="순환선"
          onReady={(room) => setOnline(room)}
          onCancel={() => setOnline(null)}
        />
      </div>
    );
  }

  if (phase === 'setup') {
    const rec = getRecord('loop-line');
    return (
      <div className="ll-root">
        <GameHeader onExit={onExit} />
        <div className="ll-setup">
          <h2>순환선</h2>
          <p className="ll-rule-summary">
            기차역 2개에서 출발해 다시 돌아오는 <b>하나의 순환선</b>을 만드는 철로 게임.
            철로 타일 <b>16개</b>를 번갈아 <b>1~3개씩 일렬로</b> 놓습니다(기존 타일에
            맞닿게). 순환선을 <b>완성하는 마지막 타일</b>을 놓는 사람이 승리 — 단,
            놓인 타일은 전부 순환선에 포함되어야 합니다. 남은 타일로 완성이 불가능해
            보이면 <b>불가능 선언</b>: 상대가 완성하면 상대 승, 실패하면 당신의 승리!
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 남은 모든 수를 완전 탐색해 필승 경로와 불가능 국면을 정확히 계산합니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>AI 대전 시작</button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>⚔️ 온라인 대전</button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const set = placedSet(state);
  const railSet = new Set([...set, ...picks]);
  const loopIndex = new Map<number, number>();
  if (state.loop) state.loop.forEach((c, i) => loopIndex.set(c, i));
  const picksValid = picks.length > 0 && isValidLine(set, picks, state.tilesLeft);
  const canPick = (cell: number) =>
    humanActs && !set.has(cell) &&
    (picks.includes(cell) || (picks.length < Math.min(3, state.tilesLeft) && isValidLine(set, [...picks, cell], state.tilesLeft)));

  const usedTiles = TILES - state.tilesLeft;

  return (
    <div className="ll-root">
      <GameHeader onExit={onExit} />

      <div className="ll-status">
        <span className={`ll-turn ${!state.result && ((state.phase === 'play' && state.turn === HUMAN) || (state.phase === 'attempt' && state.attempter === HUMAN)) ? 'me' : 'ai'}`}>
          {state.result
            ? '게임 종료'
            : state.phase === 'attempt'
              ? state.attempter === HUMAN ? '완성 시도: 나' : '완성 시도: AI'
              : state.turn === HUMAN ? '내 차례' : 'AI 차례'}
        </span>
        <span className="ll-tiles">
          철로 타일 <b>{state.tilesLeft}</b>/{TILES}
          <span className="tile-dots">
            {Array.from({ length: TILES }, (_, i) => (
              <i key={i} className={i < usedTiles ? 'used' : ''} />
            ))}
          </span>
        </span>
      </div>

      <div className="ll-board-wrap">
        <div className="ll-board" style={{ gridTemplateColumns: `repeat(${W}, 1fr)` }}>
          {Array.from({ length: W * H }, (_, cell) => {
            const isStation = STATIONS.includes(cell as never);
            const isPlaced = set.has(cell);
            const isPick = picks.includes(cell);
            const pickable = canPick(cell);
            const inLoop = loopIndex.has(cell);
            const isLast = state.lastMove?.includes(cell);
            return (
              <button
                key={cell}
                className={[
                  'll-cell',
                  isStation ? 'station' : '',
                  isPlaced && !isStation ? 'placed' : '',
                  isPick ? 'pick' : '',
                  pickable && !isPick ? 'pickable' : '',
                  inLoop ? 'loop' : '',
                  isLast && !inLoop ? 'last' : '',
                ].join(' ')}
                style={inLoop ? { animationDelay: `${(loopIndex.get(cell) ?? 0) * 60}ms` } : undefined}
                disabled={!pickable}
                onClick={() => togglePick(cell)}
              >
                {isStation ? (
                  <StationTile />
                ) : isPlaced ? (
                  <RailTile dirs={openDirs(cell, railSet)} variant={inLoop ? 'loop' : 'placed'} />
                ) : isPick ? (
                  <RailTile dirs={openDirs(cell, railSet)} variant="preview" />
                ) : null}
              </button>
            );
          })}
          {state.loop && <TrainOnLoop loop={state.loop} cellPct={100 / W} />}
        </div>
      </div>

      <div className="ll-controls">
        {state.result ? (
          <p className="ll-msg end">
            {state.result.reason === 'complete'
              ? state.result.winner === HUMAN
                ? '🚂 순환선 완성! 승리!'
                : 'AI가 순환선을 완성했습니다…'
              : state.result.winner === HUMAN
                ? '불가능 판정 적중! 승리!'
                : 'AI의 불가능 선언이 적중했습니다…'}
          </p>
        ) : aiThinking ? (
          <p className="ll-msg">AI 수읽기 중…</p>
        ) : humanActs ? (
          <div className="ll-actions">
            {notice && <p className="ll-msg notice">{notice}</p>}
            <div className="ll-btn-row">
              <button className="primary-btn" disabled={!picksValid} onClick={confirmPlace}>
                배치 확정 ({picks.length})
              </button>
              {picks.length > 0 && (
                <button className="ghost-btn" onClick={() => setPicks([])}>선택 취소</button>
              )}
              {state.phase === 'play' && picks.length === 0 && (
                <button className="danger-btn" onClick={declare}>불가능 선언</button>
              )}
              {state.phase === 'attempt' && (
                <button className="danger-btn" onClick={giveUp}>포기</button>
              )}
            </div>
            <p className="ll-hint">
              {state.phase === 'attempt'
                ? `남은 타일 ${state.tilesLeft}개로 순환선을 완성하세요 (1~3개씩 일렬)`
                : '빈 칸을 눌러 타일 1~3개를 일렬로 선택하세요'}
            </p>
          </div>
        ) : (
          <p className="ll-msg">{notice ?? 'AI 차례…'}</p>
        )}
      </div>

      {phase === 'done' && state.result && (
        <div className="ll-endcard-overlay">
          <div className="ll-endcard">
            <h3>{state.result.winner === HUMAN ? '승리!' : '패배…'}</h3>
            <p>
              {state.result.reason === 'complete'
                ? state.result.winner === HUMAN
                  ? '마지막 타일로 순환선을 완성했습니다'
                  : 'AI가 마지막 타일로 순환선을 완성했습니다'
                : state.result.winner === HUMAN
                  ? humanDeclared.current
                    ? '불가능 선언이 적중했습니다'
                    : 'AI의 불가능 선언을 뒤집고 완성했습니다'
                  : humanDeclared.current
                    ? 'AI가 남은 타일로 완성해냈습니다'
                    : '남은 타일로 완성하지 못했습니다'}
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
      <span className="game-title">순환선</span>
    </header>
  );
}
