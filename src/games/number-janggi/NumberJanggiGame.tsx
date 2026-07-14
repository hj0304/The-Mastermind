import { useEffect, useRef, useState } from 'react';
import type { NPiece, NState, NType, PlayerId } from './engine.ts';
import {
  N_COLS,
  N_ROWS,
  applyMove,
  cellIdx,
  createGame,
  isMinusEdge,
  pieceMoves,
  randomPlacement,
  resolveRevive,
  reviveCells,
  reviveOptions,
  territoryRows,
} from './engine.ts';
import { chooseAiMove, chooseAiRevive } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import './numberjanggi.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'placement' | 'playing' | 'done';
type Placement = Array<{ cell: number; piece: NPiece }>;

function typeLabel(t: NType): string {
  if (t === 'K') return '王';
  if (t === 'M') return '雷';
  return String(t);
}

export default function NumberJanggiGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [myPlacement, setMyPlacement] = useState<Placement>([]);
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [state, setState] = useState<NState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const recorded = useRef(false);

  function enterPlacement() {
    setMyPlacement(randomPlacement(HUMAN, 0));
    setSwapFrom(null);
    setPhase('placement');
  }

  function startGame() {
    const aiPlacement = randomPlacement(AI, 100);
    setState(createGame(myPlacement, aiPlacement, Math.random() < 0.5 ? HUMAN : AI));
    setSelected(null);
    recorded.current = false;
    setPhase('playing');
  }

  // AI 턴 + AI 부활 처리
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result) return;
    if (state.pendingRevive === AI) {
      const timer = setTimeout(() => {
        setState((s) => {
          if (!s || s.pendingRevive !== AI) return s;
          const r = chooseAiRevive(s);
          return resolveRevive(s, r?.pieceId ?? null, r?.cell ?? null);
        });
      }, 600);
      return () => clearTimeout(timer);
    }
    if (state.turn !== AI || state.pendingRevive !== null) return;
    setAiThinking(true);
    const timer = setTimeout(() => {
      setState((s) => {
        if (!s || s.result || s.turn !== AI || s.pendingRevive !== null) return s;
        return applyMove(s, chooseAiMove(s, AI));
      });
      setAiThinking(false);
    }, 500 + Math.random() * 600);
    return () => clearTimeout(timer);
  }, [phase, state]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state?.result) {
      if (!recorded.current) {
        recorded.current = true;
        if (state.result.winner !== null) {
          recordResult('number-janggi', state.result.winner === HUMAN);
        }
      }
      const timer = setTimeout(() => setPhase('done'), 900);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  const myTurn =
    phase === 'playing' &&
    !!state &&
    !state.result &&
    state.turn === HUMAN &&
    state.pendingRevive === null &&
    !aiThinking;

  const targets = new Set<number>(state && myTurn && selected !== null ? pieceMoves(state, selected) : []);

  function onCellClick(cell: number) {
    if (!state || !myTurn) return;
    const piece = state.board[cell];
    if (selected !== null && targets.has(cell)) {
      setState(applyMove(state, { from: selected, to: cell }));
      setSelected(null);
      return;
    }
    setSelected(piece && piece.owner === HUMAN ? cell : null);
  }

  function onPlacementClick(cell: number) {
    const rows = territoryRows(HUMAN);
    if (!rows.includes(Math.floor(cell / N_COLS))) return;
    if (swapFrom === null) {
      setSwapFrom(cell);
      return;
    }
    if (swapFrom !== cell) {
      setMyPlacement((pl) =>
        pl.map((e) =>
          e.cell === swapFrom ? { ...e, cell } : e.cell === cell ? { ...e, cell: swapFrom } : e,
        ),
      );
    }
    setSwapFrom(null);
  }

  function onHumanRevive(pieceId: number | null) {
    if (!state || state.pendingRevive !== HUMAN) return;
    if (pieceId === null) {
      setState(resolveRevive(state, null, null));
      return;
    }
    const cells = reviveCells(state, HUMAN);
    if (cells.length === 0) {
      setState(resolveRevive(state, null, null));
      return;
    }
    cells.sort((a, b) => Math.abs((a % N_COLS) - 2.5) - Math.abs((b % N_COLS) - 2.5));
    setState(resolveRevive(state, pieceId, cells[0]));
  }

  // ---------- 렌더 ----------

  if (phase === 'setup') {
    const rec = getRecord('number-janggi');
    return (
      <div className="nj-root">
        <GameHeader onExit={onExit} />
        <div className="nj-setup">
          <h2>수(數)의 진</h2>
          <p className="nj-rule-summary">
            숫자 1~10, 지뢰 3, 왕 1을 자기 진영에 <b>비공개로</b> 배치합니다. 이동 후 적과
            맞닿으면 즉시 대결 — <b>두 수의 합이 10 이상이면 큰 수가, 미만이면 작은 수가
            승리</b>합니다. 붉은 경계(−)를 사이에 두면 차 대결(작은 수 승리). 지뢰는 자폭, 왕은
            대결 즉시 패배! 상대 끝줄에 숫자 기물이 도달하면 죽은 기물을 부활시킬 수 있고, 왕이
            도달하면 그대로 승리합니다.
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 당신의 기물 이동 이력에서 지뢰와 왕을 추리합니다</span>
          </div>
          <button className="primary-btn" onClick={enterPlacement}>
            기물 배치하기
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'placement') {
    const placementBoard: (NPiece | null)[] = new Array(54).fill(null);
    for (const { cell, piece } of myPlacement) placementBoard[cell] = piece;
    return (
      <div className="nj-root">
        <GameHeader onExit={onExit} />
        <p className="nj-hint">
          내 기물 배치 — 두 칸을 차례로 클릭하면 서로 위치를 바꿉니다. (상대에겐 전부 뒷면으로
          보입니다)
        </p>
        <Board
          board={placementBoard}
          onCellClick={onPlacementClick}
          highlight={swapFrom !== null ? new Set([swapFrom]) : new Set()}
          targets={new Set()}
          lastMove={null}
          placementMode
        />
        <div className="nj-actions">
          <button className="ghost-btn" onClick={enterPlacement}>
            🎲 다시 섞기
          </button>
          <button className="primary-btn" onClick={startGame}>
            이 배치로 대전 시작
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const lastBattle = state.lastBattles.length > 0 ? state.lastBattles : null;

  return (
    <div className="nj-root">
      <GameHeader onExit={onExit} />

      <div className="nj-status">
        <span>
          {state.result
            ? '대국 종료'
            : state.pendingRevive === HUMAN
              ? '부활할 기물을 선택하세요'
              : aiThinking
                ? 'AI가 수를 읽는 중…'
                : state.turn === HUMAN
                  ? '당신의 차례'
                  : 'AI 차례'}
        </span>
        <span className="nj-dead">
          AI 잃음 {state.dead[AI].length} · 나 잃음 {state.dead[HUMAN].length}
        </span>
      </div>

      <DeadTray label="AI가 잃은 기물" pieces={state.dead[AI]} owner={AI} />

      <Board
        board={state.board}
        onCellClick={onCellClick}
        highlight={selected !== null ? new Set([selected]) : new Set()}
        targets={targets}
        lastMove={state.lastMove}
        placementMode={false}
      />

      <DeadTray label="내가 잃은 기물" pieces={state.dead[HUMAN]} owner={HUMAN} />

      {lastBattle && (
        <div className="nj-battles">
          {lastBattle.map((b, i) => (
            <div key={i} className="battle-line">
              ⚔️ {typeLabel(b.a.type)} vs {typeLabel(b.b.type)}
              {b.minus && <span className="minus-mark"> (차 대결)</span>}
              {' → '}
              {b.removedIds.length === 2
                ? '동시 제거'
                : b.removedIds.includes(b.a.id)
                  ? `${typeLabel(b.a.type)} 제거`
                  : `${typeLabel(b.b.type)} 제거`}
            </div>
          ))}
        </div>
      )}

      {/* 부활 선택 모달 */}
      {state.pendingRevive === HUMAN && (
        <div className="nj-overlay">
          <div className="nj-modal">
            <h3>끝줄 도달! 부활시킬 기물 선택</h3>
            <div className="revive-options">
              {reviveOptions(state)
                .filter((d) => d.type !== 'K')
                .map((d) => (
                  <button key={d.id} className="nj-piece mine face revive" onClick={() => onHumanRevive(d.id)}>
                    {typeLabel(d.type)}
                  </button>
                ))}
            </div>
            <button className="ghost-btn" onClick={() => onHumanRevive(null)}>
              부활 포기
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && state.result && (
        <div className="nj-overlay">
          <div className="nj-modal">
            <h2>
              {state.result.winner === null
                ? '무승부'
                : state.result.winner === HUMAN
                  ? '🏆 승리!'
                  : '패배…'}
            </h2>
            <p>
              {state.result.reason === 'king' && '왕이 대결에 휘말렸습니다'}
              {state.result.reason === 'annihilation' && '왕을 제외한 전 기물이 제거됐습니다'}
              {state.result.reason === 'throne' && '왕이 상대 끝줄에 도달했습니다'}
              {state.result.reason === 'stalemate' && '300수 교착 — 무승부'}
            </p>
            <div className="end-actions">
              <button className="primary-btn" onClick={enterPlacement}>
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

function Board({
  board,
  onCellClick,
  highlight,
  targets,
  lastMove,
  placementMode,
}: {
  board: (NPiece | null)[];
  onCellClick: (cell: number) => void;
  highlight: Set<number>;
  targets: Set<number>;
  lastMove: { from: number; to: number } | null;
  placementMode: boolean;
}) {
  return (
    <div className="nj-board">
      {Array.from({ length: N_ROWS }, (_, ri) => {
        const row = N_ROWS - 1 - ri; // 화면 위 = AI 진영(row 8)
        return Array.from({ length: N_COLS }, (_, col) => {
          const cell = cellIdx(row, col);
          const piece = board[cell];
          // 마이너스 경계 표시: 오른쪽 이웃 / 화면 위 이웃
          const minusRight = col < N_COLS - 1 && isMinusEdge(cell, cellIdx(row, col + 1));
          const minusUp = row < N_ROWS - 1 && isMinusEdge(cell, cellIdx(row + 1, col));
          const zone = row <= 2 ? 'me' : row >= 6 ? 'ai' : '';
          const isLast = lastMove !== null && (cell === lastMove.from || cell === lastMove.to);
          return (
            <button
              key={cell}
              className={`nj-cell zone-${zone} ${highlight.has(cell) ? 'selected' : ''} ${targets.has(cell) ? 'target' : ''} ${isLast ? 'last-move' : ''}`}
              onClick={() => onCellClick(cell)}
            >
              {minusRight && <span className="minus right" />}
              {minusUp && <span className="minus up" />}
              {piece && <PieceView piece={piece} placementMode={placementMode} />}
            </button>
          );
        });
      })}
    </div>
  );
}

function PieceView({ piece, placementMode }: { piece: NPiece; placementMode: boolean }) {
  const isMine = piece.owner === HUMAN;
  if (!isMine && !piece.revealed) {
    return <span className="nj-piece enemy back">?</span>;
  }
  return (
    <span
      className={`nj-piece ${isMine ? 'mine' : 'enemy'} face ${piece.type === 'K' ? 'king' : ''} ${piece.type === 'M' ? 'mine-piece' : ''}`}
    >
      {typeLabel(piece.type)}
      {isMine && piece.revealed && !placementMode && <i className="exposed" title="상대에게 공개됨" />}
    </span>
  );
}

function DeadTray({ label, pieces, owner }: { label: string; pieces: NPiece[]; owner: PlayerId }) {
  return (
    <div className="nj-tray">
      <span className="label">{label}</span>
      <div className="tray-pieces">
        {pieces.length === 0 && <span className="empty">없음</span>}
        {pieces.map((p) => (
          <span key={p.id} className={`nj-piece dead ${owner === HUMAN ? 'mine' : 'enemy'} face`}>
            {typeLabel(p.type)}
          </span>
        ))}
      </div>
    </div>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>
        ← 로비
      </button>
      <span className="game-title">수(數)의 진</span>
    </header>
  );
}
