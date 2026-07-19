/**
 * 리플렉트 기물 SVG 렌더링 — AI 대전(ReflectGame)과 온라인 대전(ReflectOnline)이 공유한다.
 * 거울면 표현이 규칙 그 자체이므로 렌더링 코드를 중복하지 않는다.
 */

import type { Dir, Piece } from './engine.ts';
import { colOf, rowOf } from './engine.ts';

export const CELL = 46;
export const DIR_ARROW = ['↑', '→', '↓', '←'];

export function rotLabel(p: Piece, to: Dir): string {
  if (p.type === 'split') return '⟳ 90°';
  return (to - p.dir + 4) % 4 === 1 ? '↻ 시계' : '↺ 반시계';
}

/** 기물 SVG — 세모기사 빗변·네모기사 정면이 거울(밝은 선) */
export function PieceGfx({ piece, cell }: { piece: Piece; cell: number }) {
  const x = colOf(cell) * CELL;
  const y = rowOf(cell) * CELL;
  const s = CELL;
  const cls = `rf-piece owner${piece.owner}`;
  const NW = `${x + 6},${y + 6}`;
  const NE = `${x + s - 6},${y + 6}`;
  const SE = `${x + s - 6},${y + s - 6}`;
  const SW = `${x + 6},${y + s - 6}`;

  if (piece.type === 'tri') {
    // dir = 직각 꼭짓점 (0=NE,1=SE,2=SW,3=NW), 빗변이 거울
    const corner = [NE, SE, SW, NW][piece.dir];
    const diag = piece.dir % 2 === 0 ? [NW, SE] : [NE, SW];
    return (
      <g className={cls}>
        <polygon points={`${diag[0]} ${diag[1]} ${corner}`} className="rf-body" />
        <line
          x1={diag[0].split(',')[0]}
          y1={diag[0].split(',')[1]}
          x2={diag[1].split(',')[0]}
          y2={diag[1].split(',')[1]}
          className="rf-mirror"
        />
      </g>
    );
  }
  if (piece.type === 'sq') {
    const edges: Record<number, [string, string]> = {
      0: [NW, NE],
      1: [NE, SE],
      2: [SW, SE],
      3: [NW, SW],
    };
    const [a, b] = edges[piece.dir];
    return (
      <g className={cls}>
        <rect x={x + 6} y={y + 6} width={s - 12} height={s - 12} rx={4} className="rf-body" />
        <line
          x1={a.split(',')[0]}
          y1={a.split(',')[1]}
          x2={b.split(',')[0]}
          y2={b.split(',')[1]}
          className="rf-mirror"
        />
      </g>
    );
  }
  if (piece.type === 'split') {
    const [a, b] = piece.dir % 2 === 0 ? [SW, NE] : [NW, SE];
    return (
      <g className={cls}>
        <circle cx={x + s / 2} cy={y + s / 2} r={s / 2 - 7} className="rf-body split" />
        <line
          x1={a.split(',')[0]}
          y1={a.split(',')[1]}
          x2={b.split(',')[0]}
          y2={b.split(',')[1]}
          className="rf-mirror split"
        />
      </g>
    );
  }
  if (piece.type === 'king') {
    return (
      <g className={cls}>
        <circle cx={x + s / 2} cy={y + s / 2} r={s / 2 - 8} className="rf-body king" />
        <text x={x + s / 2} y={y + s / 2 + 6} textAnchor="middle" className="rf-glyph">
          王
        </text>
      </g>
    );
  }
  // laser
  const cx = x + s / 2;
  const cy = y + s / 2;
  const tip = [
    [cx, cy - 13],
    [cx + 13, cy],
    [cx, cy + 13],
    [cx - 13, cy],
  ][piece.dir];
  return (
    <g className={cls}>
      <rect x={x + 9} y={y + 9} width={s - 18} height={s - 18} rx={9} className="rf-body laser" />
      <circle cx={cx} cy={cy} r={4} className="rf-laser-core" />
      <line x1={cx} y1={cy} x2={tip[0]} y2={tip[1]} className="rf-laser-dir" />
    </g>
  );
}
