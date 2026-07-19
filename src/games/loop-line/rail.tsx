/**
 * 순환선 철로 렌더링 — AI 대전(LoopLineGame)과 온라인 대전(LoopLineOnline)이 공유한다.
 *
 * 원작에서 타일은 양면(앞=직선 / 뒤=ㄱ자)이고 놓을 때 면을 고른다. 본 구현은
 * 칸을 차지하는 방식이라 모양을 따로 고르지 않는 대신, **인접한 타일 관계로 철로
 * 모양을 실시간으로 그려** 같은 그림이 보이게 한다. 최종 순환선에서는 모든 칸의
 * 차수가 정확히 2이므로 각 칸의 모양(직선/ㄱ자)이 유일하게 결정되고, 따라서
 * 이 표현은 완성 시점에 원작과 동일한 배치가 된다.
 */

import { useEffect, useState } from 'react';
import { STATIONS, W, neighbors4, rc } from './engine.ts';

/** 0=위, 1=오른쪽, 2=아래, 3=왼쪽 */
export type Dir = 0 | 1 | 2 | 3;

const VB = 100; // 셀 좌표계
const MID = VB / 2;
/** 중심에서 각 방향 가장자리로 향하는 끝점 */
const EDGE: Record<Dir, [number, number]> = {
  0: [MID, 0],
  1: [VB, MID],
  2: [MID, VB],
  3: [0, MID],
};

/** 셀에서 열린 방향들 — 인접한 '놓인 칸' 쪽으로 철로가 뻗는다 */
export function openDirs(cell: number, placed: Set<number>): Dir[] {
  const [r, c] = rc(cell);
  const out: Dir[] = [];
  for (const n of neighbors4(cell)) {
    if (!placed.has(n)) continue;
    const [nr, nc] = rc(n);
    if (nr === r - 1) out.push(0);
    else if (nc === c + 1) out.push(1);
    else if (nr === r + 1) out.push(2);
    else if (nc === c - 1) out.push(3);
  }
  // 기차역은 항상 좌우로 열려 있다(순환선이 역을 가로로 통과)
  if (STATIONS.includes(cell as never)) {
    if (!out.includes(1)) out.push(1);
    if (!out.includes(3)) out.push(3);
  }
  return out;
}

/** 침목을 선분 위에 일정 간격으로 배치 */
function sleepers(from: [number, number], to: [number, number], count: number) {
  const items: { x: number; y: number; angle: number }[] = [];
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    items.push({ x: from[0] + dx * t, y: from[1] + dy * t, angle });
  }
  return items;
}

/**
 * 한 칸의 철로 그래픽.
 * - 열린 방향이 2개면 직선 또는 ㄱ자(원작 타일의 두 면)
 * - 1개면 아직 이어지지 않은 끝, 0개면 고립된 타일
 */
export function RailTile({
  dirs,
  variant = 'placed',
}: {
  dirs: Dir[];
  variant?: 'placed' | 'preview' | 'loop';
}) {
  const cls = `rail rail-${variant}`;
  const paths: string[] = [];
  const ties: { x: number; y: number; angle: number }[] = [];

  if (dirs.length === 0) {
    // 아직 어디와도 닿지 않은 타일 — 짧은 토막으로 표시
    paths.push(`M ${MID - 18} ${MID} L ${MID + 18} ${MID}`);
    ties.push(...sleepers([MID - 18, MID], [MID + 18, MID], 2));
  } else if (dirs.length === 2 && (dirs[0] + 2) % 4 === dirs[1] % 4) {
    // 마주보는 두 방향 = 직선
    const a = EDGE[dirs[0]];
    const b = EDGE[dirs[1]];
    paths.push(`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`);
    ties.push(...sleepers(a, b, 4));
  } else if (dirs.length === 2) {
    // 꺾이는 두 방향 = ㄱ자. 중심을 제어점으로 둔 곡선이라 실제 철로 커브처럼 보인다
    const a = EDGE[dirs[0]];
    const b = EDGE[dirs[1]];
    paths.push(`M ${a[0]} ${a[1]} Q ${MID} ${MID} ${b[0]} ${b[1]}`);
    ties.push(...sleepers(a, [MID, MID], 2), ...sleepers([MID, MID], b, 2));
  } else {
    // 아직 한쪽만 이어진 끝, 또는 세 갈래 이상(순환선이 될 수 없는 형태)
    for (const d of dirs) {
      const e = EDGE[d];
      paths.push(`M ${e[0]} ${e[1]} L ${MID} ${MID}`);
      ties.push(...sleepers(e, [MID, MID], 2));
    }
  }

  return (
    <svg className={cls} viewBox={`0 0 ${VB} ${VB}`} aria-hidden>
      {paths.map((d, i) => (
        <path key={`b${i}`} d={d} className="rail-bed" />
      ))}
      {ties.map((t, i) => (
        <rect
          key={`t${i}`}
          x={t.x - 3}
          y={t.y - 11}
          width={6}
          height={22}
          rx={1.5}
          className="rail-tie"
          transform={`rotate(${t.angle} ${t.x} ${t.y})`}
        />
      ))}
      {paths.map((d, i) => (
        <path key={`r${i}`} d={d} className="rail-line" />
      ))}
    </svg>
  );
}

/** 기차역 — 좌우로 철로가 열린 승강장 */
export function StationTile() {
  return (
    <svg className="rail rail-station" viewBox={`0 0 ${VB} ${VB}`} aria-hidden>
      <path d={`M 0 ${MID} L ${VB} ${MID}`} className="rail-bed" />
      {sleepers([0, MID], [VB, MID], 4).map((t, i) => (
        <rect
          key={i}
          x={t.x - 3}
          y={t.y - 11}
          width={6}
          height={22}
          rx={1.5}
          className="rail-tie"
          transform={`rotate(${t.angle} ${t.x} ${t.y})`}
        />
      ))}
      <path d={`M 0 ${MID} L ${VB} ${MID}`} className="rail-line" />
      <rect x={22} y={14} width={56} height={20} rx={4} className="station-roof" />
      <text x={MID} y={29} textAnchor="middle" className="station-text">
        역
      </text>
    </svg>
  );
}

/**
 * 완성된 순환선을 도는 기차.
 * 사이클 칸을 순서대로 밟으며 이동하고, 칸 사이는 CSS 트랜지션이 메운다.
 */
export function TrainOnLoop({ loop, cellPct }: { loop: number[]; cellPct: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (loop.length === 0) return;
    const iv = setInterval(() => setI((n) => (n + 1) % loop.length), 260);
    return () => clearInterval(iv);
  }, [loop.length]);
  if (loop.length === 0) return null;
  const [r, c] = rc(loop[i]);
  return (
    <div
      className="ll-train"
      style={{ left: `${(c + 0.5) * cellPct}%`, top: `${(r + 0.5) * cellPct}%` }}
    >
      🚂
    </div>
  );
}

/** 셀 인덱스 → [행, 열] (렌더러 편의용 재수출) */
export { rc, W };
