import { YUT_BIG_NODES, YUT_NEXT, YUT_POS } from './yut-graph.ts';
import './yutboard.css';

/** 판 위 말 하나 (안정적 id 필수 — 이동 애니메이션 기준) */
export interface BoardPiece {
  id: string;
  player: 0 | 1;
  node: number; // 0~28
}

interface YutBoardProps {
  pieces: BoardPiece[];
  /** 반짝이며 클릭 가능한 칸 (이동할 말 선택) */
  movableNodes?: Set<number>;
  /** 도착 후보 칸 (초록 펄스 — 클릭으로 이동 확정) */
  targetNodes?: Set<number>;
  selectedNode?: number | null;
  /** 직전 이동 도착 칸 강조 */
  lastDest?: number | null;
  /** 상대 선언 등으로 주목시킬 칸 */
  markedNode?: number | null;
  onNodeClick?: (node: number) => void;
}

/** 전통 윷판 — 공용 렌더러 */
export default function YutBoard({
  pieces,
  movableNodes,
  targetNodes,
  selectedNode,
  lastDest,
  markedNode,
  onNodeClick,
}: YutBoardProps) {
  // 노드별 말 그룹 (겹침 오프셋 계산)
  const byNode = new Map<number, BoardPiece[]>();
  for (const p of pieces) {
    if (!byNode.has(p.node)) byNode.set(p.node, []);
    byNode.get(p.node)!.push(p);
  }

  return (
    <svg className="yutboard" viewBox="0 0 420 420">
      {/* 판 배경 */}
      <rect x={4} y={4} width={412} height={412} rx={22} className="yb-board-bg" />
      <rect x={12} y={12} width={396} height={396} rx={16} className="yb-board-inner" />

      {/* 경로선 */}
      {Object.entries(YUT_NEXT).map(([a, b]) => {
        const [x1, y1] = YUT_POS[Number(a)];
        const [x2, y2] = YUT_POS[b];
        return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} className="yb-path" />;
      })}

      {/* 정거점 */}
      {Object.entries(YUT_POS).map(([id, [x, y]]) => {
        const n = Number(id);
        const big = YUT_BIG_NODES.has(n);
        const movable = movableNodes?.has(n) ?? false;
        const target = targetNodes?.has(n) ?? false;
        return (
          <g
            key={n}
            className={`yb-station ${movable ? 'movable' : ''} ${target ? 'target' : ''} ${
              selectedNode === n ? 'sel' : ''
            } ${lastDest === n ? 'last' : ''} ${markedNode === n ? 'marked' : ''}`}
            onClick={() => onNodeClick?.(n)}
          >
            {big && <circle cx={x} cy={y} r={19} className="yb-node-outer" />}
            <circle cx={x} cy={y} r={big ? 12 : 10} className="yb-node" />
            {(movable || target) && (
              <circle cx={x} cy={y} r={big ? 23 : 16} className="yb-node-pulse" />
            )}
          </g>
        );
      })}

      {/* 출발 라벨 */}
      <text x={380} y={409} textAnchor="middle" className="yb-start-label">출발 · 도착</text>

      {/* 말 — 안정적 id로 transform 트랜지션 */}
      {pieces.map((p) => {
        const group = byNode.get(p.node)!;
        const mine = group.filter((g) => g.player === p.player);
        const stackIdx = mine.findIndex((g) => g.id === p.id);
        const [x, y] = YUT_POS[p.node];
        // 같은 편 스택은 살짝 겹치고, 다른 편과는 좌우로 분리
        const sideOff = group.some((g) => g.player !== p.player) ? (p.player === 0 ? -7 : 7) : 0;
        const dx = sideOff + stackIdx * 3;
        const dy = -4 - stackIdx * 5;
        // 업힌 말은 맨 위 말에 개수 배지를 달아 명확히 표시
        const topOfStack = stackIdx === mine.length - 1 && mine.length > 1;
        return (
          <g
            key={p.id}
            className={`yb-piece pl${p.player}`}
            style={{ transform: `translate(${x + dx}px, ${y + dy}px)` }}
            onClick={() => onNodeClick?.(p.node)}
          >
            <ellipse cx={0} cy={7} rx={9} ry={3.5} className="yb-piece-shadow" />
            <circle cx={0} cy={0} r={10} className="yb-piece-body" />
            <circle cx={0} cy={-3} r={4.5} className="yb-piece-cap" />
            {topOfStack && (
              <g className="yb-stack-badge">
                <circle cx={9} cy={-9} r={7.5} className="yb-stack-badge-bg" />
                <text x={9} y={-5.5} textAnchor="middle" className="yb-stack-badge-text">
                  {mine.length}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
