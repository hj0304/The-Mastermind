/**
 * 순환선 배치 조작 — AI 대전과 온라인 대전이 공유한다.
 *
 * 원작처럼 **트레이에서 타일을 집어 회전시켜 끼워 넣는다**:
 *   1) 트레이에서 직선(─) 또는 ㄱ자(└)를 고르고, 회전으로 방향을 정한다
 *   2) 빈 칸을 눌러 놓는다 (한 턴에 1~3개, 2개 이상이면 일렬)
 *   3) 놓아둔 타일을 다시 누르면 그 자리에서 회전, 배치 확정을 누르면 확정
 *
 * 맞닿는 타일과 모서리가 어긋나면(수로를 막으면) 놓을 수 없다. 든 방향이 안 맞지만
 * 같은 타일의 다른 방향이 맞으면 그쪽으로 자동으로 맞춰 준다 — 규칙은 지키되
 * 매번 손으로 돌리게 만들지는 않는다.
 */

import { useState } from 'react';
import type { Board, Tile } from './engine.ts';
import {
  CURVE_CYCLE,
  H,
  STATIONS,
  STRAIGHT_CYCLE,
  STRAIGHT_H,
  W,
  fits,
  isValidCells,
  isValidFreeform,
} from './engine.ts';
import { RailTile, StationTile, TrainOnLoop, maskDirs } from './rail.tsx';

export type TileKind = 'straight' | 'curve';

export function kindOf(mask: number): TileKind {
  return STRAIGHT_CYCLE.includes(mask) ? 'straight' : 'curve';
}

function cycleOf(kind: TileKind): number[] {
  return kind === 'straight' ? STRAIGHT_CYCLE : CURVE_CYCLE;
}

/** board + 아직 확정하지 않은 타일들을 합친 판 */
export function workBoard(board: Board, pending: Tile[], skip?: number): Board {
  const b = board.slice();
  for (const t of pending) if (t.cell !== skip) b[t.cell] = t.mask;
  return b;
}

export interface Placer {
  held: number;
  heldKind: TileKind;
  pending: Tile[];
  notice: string | null;
  pickKind: (k: TileKind) => void;
  rotate: () => void;
  clickCell: (cell: number) => void;
  clear: () => void;
  setNotice: (m: string | null) => void;
}

/**
 * freeform = 불가능 선언 뒤 혼자 완성하는 국면.
 * 이때는 1~3개·일렬 제약이 없어 남은 타일을 한 번에 깔 수 있다.
 */
export function usePlacer(
  board: Board,
  tilesLeft: number,
  active: boolean,
  freeform = false,
): Placer {
  const [held, setHeld] = useState<number>(STRAIGHT_H);
  const [pending, setPending] = useState<Tile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const heldKind = kindOf(held);

  function pickKind(k: TileKind) {
    setHeld(cycleOf(k)[0]);
    setNotice(null);
  }

  function rotate() {
    const cyc = cycleOf(heldKind);
    setHeld(cyc[(cyc.indexOf(held) + 1) % cyc.length]);
    setNotice(null);
  }

  function clickCell(cell: number) {
    if (!active) return;
    const existing = pending.find((t) => t.cell === cell);
    if (existing) {
      // 놓아둔 타일 회전 — 같은 종류에서 맞는 다음 방향으로
      const cyc = cycleOf(kindOf(existing.mask));
      const others = pending.filter((t) => t.cell !== cell);
      const wb = workBoard(board, others);
      const start = cyc.indexOf(existing.mask);
      for (let i = 1; i <= cyc.length; i++) {
        const m = cyc[(start + i) % cyc.length];
        if (m === existing.mask) break;
        if (fits(wb, cell, m)) {
          setPending(pending.map((t) => (t.cell === cell ? { cell, mask: m } : t)));
          setNotice(null);
          return;
        }
      }
      // 돌릴 곳이 없으면 집어 든다(취소)
      setPending(others);
      setNotice(null);
      return;
    }

    const cells = [...pending.map((t) => t.cell), cell];
    const okCells = freeform
      ? isValidFreeform(board, cells, tilesLeft)
      : isValidCells(board, cells, tilesLeft);
    if (!okCells) {
      setNotice(
        freeform
          ? '이미 놓인 철로에 이어지도록 놓아야 합니다'
          : pending.length === 0
            ? '기존 타일에 맞닿은 빈 칸에만 놓을 수 있습니다'
            : '한 턴에 놓는 타일은 1~3개이고, 2개 이상이면 일렬이어야 합니다',
      );
      return;
    }
    const wb = workBoard(board, pending);
    let mask = fits(wb, cell, held) ? held : 0;
    let auto = false;
    if (mask === 0) {
      const alt = cycleOf(heldKind).find((m) => fits(wb, cell, m));
      if (alt === undefined) {
        setNotice('이 자리에 그 타일을 놓으면 수로가 막힙니다 — 다른 종류를 골라보세요');
        return;
      }
      mask = alt;
      auto = true;
    }
    setPending([...pending, { cell, mask }]);
    setHeld(mask);
    setNotice(auto ? '맞닿는 철로에 맞춰 방향을 돌렸습니다' : null);
  }

  function clear() {
    setPending([]);
    setNotice(null);
  }

  return { held, heldKind, pending, notice, pickKind, rotate, clickCell, clear, setNotice };
}

/** 트레이 — 두 종류의 타일과 회전 */
export function TileTray({
  held,
  heldKind,
  onPick,
  onRotate,
  disabled,
}: {
  held: number;
  heldKind: TileKind;
  onPick: (k: TileKind) => void;
  onRotate: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="ll-tray">
      <span className="ll-tray-label">타일</span>
      {(['straight', 'curve'] as TileKind[]).map((k) => (
        <button
          key={k}
          className={`ll-tray-tile ${heldKind === k ? 'held' : ''}`}
          disabled={disabled}
          onClick={() => onPick(k)}
        >
          <RailTile dirs={maskDirs(heldKind === k ? held : cycleOf(k)[0])} variant="preview" />
          <span>{k === 'straight' ? '직선' : 'ㄱ자'}</span>
        </button>
      ))}
      <button className="ll-rotate" disabled={disabled} onClick={onRotate}>
        ⟳ 회전
      </button>
    </div>
  );
}

/** 판 — 놓인 타일은 저장된 방향 그대로, 확정 전 타일은 미리보기로 그린다 */
export function RailBoard({
  board,
  pending,
  loop,
  lastMove,
  canPlace,
  onCell,
}: {
  board: Board;
  pending: Tile[];
  loop: number[] | null;
  lastMove: number[] | null;
  canPlace: (cell: number) => boolean;
  onCell: (cell: number) => void;
}) {
  const loopIndex = new Map<number, number>();
  if (loop) loop.forEach((c, i) => loopIndex.set(c, i));
  const pendingMap = new Map(pending.map((t) => [t.cell, t.mask]));

  return (
    <div className="ll-board-wrap">
      <div className="ll-board" style={{ gridTemplateColumns: `repeat(${W}, 1fr)` }}>
        {Array.from({ length: W * H }, (_, cell) => {
          const isStation = STATIONS.includes(cell as never);
          const placedMask = board[cell];
          const pend = pendingMap.get(cell);
          const inLoop = loopIndex.has(cell);
          const isLast = lastMove?.includes(cell);
          const placeable = pend === undefined && placedMask === 0 && canPlace(cell);
          return (
            <button
              key={cell}
              className={[
                'll-cell',
                isStation ? 'station' : '',
                placedMask !== 0 && !isStation ? 'placed' : '',
                pend !== undefined ? 'pick' : '',
                placeable ? 'pickable' : '',
                inLoop ? 'loop' : '',
                isLast && !inLoop ? 'last' : '',
              ].join(' ')}
              style={inLoop ? { animationDelay: `${(loopIndex.get(cell) ?? 0) * 60}ms` } : undefined}
              disabled={!placeable && pend === undefined}
              onClick={() => onCell(cell)}
            >
              {isStation ? (
                <StationTile />
              ) : pend !== undefined ? (
                <RailTile dirs={maskDirs(pend)} variant="preview" />
              ) : placedMask !== 0 ? (
                <RailTile dirs={maskDirs(placedMask)} variant={inLoop ? 'loop' : 'placed'} />
              ) : null}
            </button>
          );
        })}
        {loop && <TrainOnLoop loop={loop} cellPct={100 / W} />}
      </div>
    </div>
  );
}
