import { useEffect, useRef, useState } from 'react';
import type { LLState, PlayerId } from './engine.ts';
import {
  TILES,
  applyDeclare,
  applyGiveUp,
  applyPlace,
  createGame,
  emptyBoard,
  isValidCells,
  isValidFreeform,
  isValidPlacement,
} from './engine.ts';
import { chooseAiAction, recordGameEnd } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import LoopLineOnline from './LoopLineOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import { RailBoard, TileTray, usePlacer, workBoard } from './placer.tsx';
import './loopline.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

/** 완성된 순환선 렌더용 글리프 */

export default function LoopLineGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<LLState | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);
  const humanDeclared = useRef(false);

  const board = state?.board ?? emptyBoard();
  const humanActsNow =
    !!state &&
    !state.result &&
    ((state.phase === 'play' && state.turn === HUMAN) ||
      (state.phase === 'attempt' && state.attempter === HUMAN)) &&
    !aiThinking;
  const attemptMode = state?.phase === 'attempt';
  const placer = usePlacer(board, state?.tilesLeft ?? 0, humanActsNow, attemptMode);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  function startGame() {
    setToss(Math.random() < 0.5 ? HUMAN : AI);
  }

  function begin(first: PlayerId) {
    setState(createGame(first));
    placer.clear();
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
          if (act.kind === 'place') return applyPlace(s, act.tiles);
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

  const humanActs = humanActsNow;

  function confirmPlace() {
    if (!humanActs || !state) return;
    try {
      const next = applyPlace(state, placer.pending);
      setState(next);
      placer.clear();
      setNotice(null);
    } catch {
      // 무효 — UI 가드로 도달 불가
    }
  }

  function declare() {
    if (!humanActs || !state || state.phase !== 'play' || placer.pending.length > 0) return;
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
    const rec = getRecord('loop-line');
    return (
      <div className="ll-root">
        <GameHeader onExit={onExit} />
        <div className="ll-setup">
          <h2>순환선</h2>
          <p className="ll-rule-summary">
            기차역 2개에서 출발해 다시 돌아오는 <b>하나의 순환선</b>을 만드는 철로 게임.
            철로 타일 <b>16개</b>를 번갈아 <b>1~3개씩 일렬로</b> 놓습니다(기존 타일에
            맞닿게). 타일은 양면 — <b>직선(─)과 ㄱ자(└) 중 골라 회전시켜</b> 놓고, 한 번
            놓은 방향은 바뀌지 않습니다. 철로가 아직 안 이어져도 되지만 <b>맞닿는 모서리를
            어긋나게(수로를 막게) 놓을 수는 없습니다.</b> 순환선을 <b>완성하는 마지막 타일</b>을
            놓는 사람이 승리 — 단,
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

  const picksValid =
    placer.pending.length > 0 &&
    isValidPlacement(state.board, placer.pending, state.tilesLeft, attemptMode);
  /** 지금 이 칸에 든 타일을 놓을 수 있는가 (자리 조건 — 방향은 자동으로 맞춰준다) */
  const canPlace = (cell: number) =>
    humanActs &&
    (attemptMode
      ? isValidFreeform(state.board, [...placer.pending.map((t) => t.cell), cell], state.tilesLeft)
      : isValidCells(state.board, [...placer.pending.map((t) => t.cell), cell], state.tilesLeft)) &&
    workBoard(state.board, placer.pending)[cell] === 0;

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

      <RailBoard
        board={state.board}
        pending={placer.pending}
        loop={state.loop}
        lastMove={state.lastMove}
        canPlace={canPlace}
        onCell={placer.clickCell}
      />

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
            {(placer.notice ?? notice) && (
              <p className="ll-msg notice">{placer.notice ?? notice}</p>
            )}
            <TileTray
              held={placer.held}
              heldKind={placer.heldKind}
              onPick={placer.pickKind}
              onRotate={placer.rotate}
            />
            <div className="ll-btn-row">
              <button className="primary-btn" disabled={!picksValid} onClick={confirmPlace}>
                배치 확정 ({placer.pending.length})
              </button>
              {placer.pending.length > 0 && (
                <button className="ghost-btn" onClick={placer.clear}>선택 취소</button>
              )}
              {state.phase === 'play' && placer.pending.length === 0 && (
                <button className="danger-btn" onClick={declare}>불가능 선언</button>
              )}
              {state.phase === 'attempt' && (
                <button className="danger-btn" onClick={giveUp}>포기</button>
              )}
            </div>
            <p className="ll-hint">
              {attemptMode ? (
                <>
                  혼자 완성하는 국면이라 <b>일렬·3개 제한이 없습니다</b> — 남은 타일{' '}
                  {state.tilesLeft}개로 이어지게만 놓으면 됩니다. 타일을 고르고{' '}
                  <b>회전</b>으로 방향을 맞추세요.
                </>
              ) : (
                <>
                  타일을 고르고 <b>회전</b>으로 방향을 정한 뒤 빈 칸에 놓으세요 (한 턴에
                  1~3개, 2개 이상이면 일렬). 놓아둔 타일을 다시 누르면 그 자리에서
                  돌아갑니다.
                </>
              )}
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
