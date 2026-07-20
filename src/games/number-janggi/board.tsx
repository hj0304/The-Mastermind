/**
 * 수의 진 보드·기물 렌더링 — AI 대전과 온라인 대전이 공유한다.
 *
 * 기존에는 렌더러가 HUMAN 상수를 직접 참조해 좌석 0 전용이었다. 온라인에서는
 * 게스트가 좌석 1이므로 `me`를 받아 시점을 결정하고, 보드도 자기 진영이 아래에
 * 오도록 좌석별로 뒤집는다.
 */

import type { NPiece, NType, PlayerId } from './engine.ts';
import { N_COLS, N_ROWS, cellIdx, isMinusEdge } from './engine.ts';

export function typeLabel(t: NType): string {
  if (t === 'K') return '王';
  if (t === 'M') return '💣';
  return String(t);
}

export function PieceView({
  piece,
  me,
  placementMode,
}: {
  piece: NPiece;
  me: PlayerId;
  placementMode: boolean;
}) {
  const isMine = piece.owner === me;
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

export function Board({
  board,
  me,
  onCellClick,
  highlight,
  targets,
  lastMove,
  placementMode,
}: {
  board: (NPiece | null)[];
  me: PlayerId;
  onCellClick: (cell: number) => void;
  highlight: Set<number>;
  targets: Set<number>;
  lastMove: { from: number; to: number } | null;
  placementMode: boolean;
}) {
  return (
    <div className="nj-board">
      {Array.from({ length: N_ROWS }, (_, ri) => {
        // 내 진영이 항상 화면 아래에 오도록 좌석별로 행 순서를 뒤집는다
        const row = me === 0 ? N_ROWS - 1 - ri : ri;
        return Array.from({ length: N_COLS }, (_, ci) => {
          const col = me === 0 ? ci : N_COLS - 1 - ci;
          const cell = cellIdx(row, col);
          const piece = board[cell];
          // 마이너스 경계 표시: 화면 기준 오른쪽 이웃 / 위쪽 이웃
          const rightNeighbor = me === 0 ? col + 1 : col - 1;
          const upNeighbor = me === 0 ? row + 1 : row - 1;
          const minusRight =
            rightNeighbor >= 0 && rightNeighbor < N_COLS && isMinusEdge(cell, cellIdx(row, rightNeighbor));
          const minusUp =
            upNeighbor >= 0 && upNeighbor < N_ROWS && isMinusEdge(cell, cellIdx(upNeighbor, col));
          const myZone = me === 0 ? row <= 2 : row >= 6;
          const oppZone = me === 0 ? row >= 6 : row <= 2;
          const zone = myZone ? 'me' : oppZone ? 'ai' : '';
          const isLast = lastMove !== null && (cell === lastMove.from || cell === lastMove.to);
          return (
            <button
              key={cell}
              className={`nj-cell zone-${zone} ${highlight.has(cell) ? 'selected' : ''} ${targets.has(cell) ? 'target' : ''} ${isLast ? 'last-move' : ''}`}
              onClick={() => onCellClick(cell)}
            >
              {minusRight && <span className="minus right" />}
              {minusUp && <span className="minus up" />}
              {piece && <PieceView piece={piece} me={me} placementMode={placementMode} />}
            </button>
          );
        });
      })}
    </div>
  );
}

export function DeadTray({
  label,
  pieces,
  mine,
}: {
  label: string;
  pieces: NPiece[];
  mine: boolean;
}) {
  return (
    <div className="nj-tray">
      <span className="label">{label}</span>
      <div className="tray-pieces">
        {pieces.length === 0 && <span className="empty">없음</span>}
        {pieces.map((p) => (
          <span key={p.id} className={`nj-piece dead ${mine ? 'mine' : 'enemy'} face`}>
            {typeLabel(p.type)}
          </span>
        ))}
      </div>
    </div>
  );
}
