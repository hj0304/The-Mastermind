/**
 * 암전 미궁 AI.
 *
 * 공정성 원칙: 숨겨진 벽 배치(state.walls)는 절대 읽지 않는다.
 * 양쪽 플레이어의 충돌(벽 확정)·통과(개방 확정)로 드러난 공개 정보만 완벽 기억하고,
 * 미지 간선은 잔여 벽 수 기반 확률로 기대 비용을 매겨 최단 경로를 탐색한다.
 *
 * 학습: 인간의 충돌 빈도(기억력)를 누적 기록 — 인간이 정확할수록 AI도 위험을
 * 감수하고 경주하고, 인간이 자주 부딪히면 안전한 우회로를 선호한다.
 */

import type { DMState, PlayerId } from './engine.ts';
import { EDGE_COUNT, START, WALL_COUNT, edgeBetween, neighbors } from './engine.ts';

// ---------- 성향 저장 ----------

const TENDENCY_KEY = 'mastermind.dark-maze.tendency.v1';

interface Tendency {
  humanTurns: number;
  humanBumps: number;
  games: number;
}

function loadTendency(): Tendency {
  try {
    const raw = localStorage.getItem(TENDENCY_KEY);
    if (raw) return { humanTurns: 0, humanBumps: 0, games: 0, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { humanTurns: 0, humanBumps: 0, games: 0 };
}

function saveTendency(t: Tendency) {
  try {
    localStorage.setItem(TENDENCY_KEY, JSON.stringify(t));
  } catch {
    // ignore
  }
}

export function recordHumanTurn(bumped: boolean) {
  const t = loadTendency();
  t.humanTurns += 1;
  if (bumped) t.humanBumps += 1;
  saveTendency(t);
}

export function recordGameEnd() {
  const t = loadTendency();
  t.games += 1;
  saveTendency(t);
}

/** 인간 충돌률(사전값 0.3) — 낮을수록(정확할수록) AI가 더 공격적으로 경주 */
function humanBumpRate(): number {
  const t = loadTendency();
  return (t.humanBumps + 3) / (t.humanTurns + 10);
}

// ---------- 경로 탐색 ----------

interface Knowledge {
  wall: Set<number>;
  open: Set<number>;
  pWall: number;
}

function knowledgeOf(s: DMState): Knowledge {
  const wall = new Set(s.knownWalls);
  const open = new Set(s.knownOpen);
  const unknownEdges = EDGE_COUNT - wall.size - open.size;
  const remaining = Math.max(0, WALL_COUNT - wall.size);
  return { wall, open, pWall: unknownEdges > 0 ? remaining / unknownEdges : 0 };
}

/**
 * 기대 비용 다익스트라. 미지 간선 비용 = 1 + pWall × 충돌 페널티.
 * 결정적(타이브레이크: 칸 번호) — 공정성 테스트에서 숨은 벽과의 무관성을 검증한다.
 */
function expectedDist(
  from: number,
  target: number,
  k: Knowledge,
  bumpPenalty: number,
): { dist: number[]; prev: number[] } {
  const dist = new Array<number>(36).fill(Infinity);
  const prev = new Array<number>(36).fill(-1);
  const done = new Array<boolean>(36).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < 36; i++) {
      if (!done[i] && (u === -1 || dist[i] < dist[u])) u = i;
    }
    if (u === -1 || dist[u] === Infinity) break;
    done[u] = true;
    if (u === target) break;
    for (const v of neighbors(u)) {
      const e = edgeBetween(u, v);
      if (k.wall.has(e)) continue;
      const cost = k.open.has(e) ? 1 : 1 + k.pWall * bumpPenalty;
      if (dist[u] + cost < dist[v] - 1e-9) {
        dist[v] = dist[u] + cost;
        prev[v] = u;
      }
    }
  }
  return { dist, prev };
}

function manhattan(a: number, b: number): number {
  return Math.abs(Math.floor(a / 6) - Math.floor(b / 6)) + Math.abs((a % 6) - (b % 6));
}

/**
 * AI의 다음 한 걸음 선택. 이동할 칸 번호를 돌려주고, 유효한 수가 없으면 null(멈춤).
 * 숨겨진 벽은 참조하지 않는다 — knownWalls/knownOpen/공개 상태만 사용.
 */
export function chooseAiStep(s: DMState, me: PlayerId): number | null {
  if (s.phase !== 'move' || s.turn !== me || s.steps <= 0) return null;
  const k = knowledgeOf(s);
  // 충돌 페널티: 시작 코너로부터 다시 와야 하는 거리 + 턴 상실.
  // 인간이 정확할수록(충돌률 낮음) 페널티를 낮춰 위험을 감수하고 경주한다.
  const risk = 0.55 + humanBumpRate(); // 대략 0.6~1.5
  const bumpPenalty = (manhattan(START[me], s.target) + 3) * risk;
  const from = s.pos[me];
  const { dist, prev } = expectedDist(from, s.target, k, bumpPenalty);
  if (dist[s.target] === Infinity) return null;
  // 경로 역추적으로 첫 걸음 찾기
  let cur = s.target;
  while (prev[cur] !== from) {
    cur = prev[cur];
    if (cur === -1) return null;
  }
  return cur;
}
