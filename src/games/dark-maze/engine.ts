/**
 * 암전 미궁 (원작: 마법의 미로 Das magische Labyrinth) 게임 엔진.
 * 룰 상세: docs/GAME_RULES.md §10
 *
 * 6×6 판, 보이지 않는 벽 24개. 주사위(1,2,2,3,3,4) 눈 이하만큼 상하좌우 이동.
 * 벽을 지나면 남은 걸음 몰수 + 시작 코너 복귀. 목표 심볼 칸 도달 시 칩 획득.
 * 칩 5개 선취 승리.
 */

export type PlayerId = 0 | 1;

export const SIZE = 6;
export const CELLS = SIZE * SIZE; // 36
export const WALL_COUNT = 24;
export const CHIPS_TO_WIN = 5;
export const DIE_FACES = [1, 2, 2, 3, 3, 4];

/** 시작 코너: 나(0)=좌상단, AI(1)=우하단 (대각 맞은편) */
export const START: [number, number] = [0, CELLS - 1];
const CORNERS = [0, SIZE - 1, CELLS - SIZE, CELLS - 1];

// ---------- 간선(벽 후보) 인코딩 ----------
// 가로 인접 (r,c)-(r,c+1): id = r*(SIZE-1)+c  → 30개
// 세로 인접 (r,c)-(r+1,c): id = 30 + r*SIZE+c → 30개
export const EDGE_COUNT = 2 * SIZE * (SIZE - 1); // 60

/** 인접한 두 칸 사이의 간선 id. 인접하지 않으면 -1 */
export function edgeBetween(a: number, b: number): number {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const r = Math.floor(lo / SIZE);
  const c = lo % SIZE;
  if (hi === lo + 1 && c < SIZE - 1) return r * (SIZE - 1) + c;
  if (hi === lo + SIZE) return SIZE * (SIZE - 1) + lo;
  return -1;
}

/** 간선 id → [칸a, 칸b] */
export function edgeCells(e: number): [number, number] {
  const H = SIZE * (SIZE - 1);
  if (e < H) {
    const r = Math.floor(e / (SIZE - 1));
    const c = e % (SIZE - 1);
    const a = r * SIZE + c;
    return [a, a + 1];
  }
  const a = e - H;
  return [a, a + SIZE];
}

/** 칸의 상하좌우 이웃 */
export function neighbors(cell: number): number[] {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  const out: number[] = [];
  if (c > 0) out.push(cell - 1);
  if (c < SIZE - 1) out.push(cell + 1);
  if (r > 0) out.push(cell - SIZE);
  if (r < SIZE - 1) out.push(cell + SIZE);
  return out;
}

// ---------- 미로 생성 ----------

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 벽 24개 배치: 무작위 스패닝 트리(35개 간선 개방)로 전 칸 연결을 보장하고,
 * 나머지 25개 중 1개를 추가 개방 → 정확히 24개가 벽.
 */
export function generateWalls(): number[] {
  const parent = Array.from({ length: CELLS }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const edges = shuffle(Array.from({ length: EDGE_COUNT }, (_, i) => i));
  const closed: number[] = [];
  for (const e of edges) {
    const [a, b] = edgeCells(e);
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) closed.push(e);
    else parent[ra] = rb;
  }
  // closed = 25개. 그중 1개를 열어 벽 24개.
  const extra = shuffle(closed);
  extra.pop();
  return extra.sort((x, y) => x - y);
}

// ---------- 상태 ----------

export interface DMState {
  /** 숨겨진 벽 간선 id 목록 — UI/AI는 절대 직접 읽지 않는다 */
  walls: number[];
  /** 공개 정보: 확정된 벽 / 확정 개방 간선 (양쪽 플레이어의 충돌·통과로 드러남) */
  knownWalls: number[];
  knownOpen: number[];
  pos: [number, number];
  chips: [number, number];
  /** 획득한 심볼 칸 id 목록 (UI 표시용) */
  collected: [number[], number[]];
  /** 목표 칩 추첨 주머니(칸 id, 코너 제외) */
  bag: number[];
  target: number;
  turn: PlayerId;
  phase: 'roll' | 'move' | 'gameover';
  /** 이번 턴 주사위 눈 / 남은 걸음 */
  rolled: number | null;
  steps: number;
  /** 마지막 이벤트 (UI 연출용) */
  lastEvent:
    | { kind: 'bump'; by: PlayerId; edge: number }
    | { kind: 'chip'; by: PlayerId; cell: number }
    | null;
  result: { winner: PlayerId } | null;
}

/** 목표 추첨. 이미 그 칸에 서 있는 플레이어는 즉시 획득(원작 룰). */
function drawTarget(s: DMState): DMState {
  let { bag, chips, collected, target, result, phase } = s;
  bag = bag.slice();
  chips = [...chips] as [number, number];
  collected = [collected[0].slice(), collected[1].slice()];
  while (bag.length > 0) {
    const t = bag.pop()!;
    const standing =
      s.pos[s.turn] === t ? s.turn : s.pos[1 - s.turn] === t ? ((1 - s.turn) as PlayerId) : null;
    if (standing === null) {
      target = t;
      return { ...s, bag, chips, collected, target, result, phase };
    }
    chips[standing] += 1;
    collected[standing].push(t);
    if (chips[standing] >= CHIPS_TO_WIN) {
      result = { winner: standing };
      phase = 'gameover';
      return { ...s, bag, chips, collected, target: -1, result, phase };
    }
  }
  // 주머니 소진(이론상 도달 불가에 가까움) → 칩 많은 쪽 승, 동수면 현재 턴 상대 승
  const winner: PlayerId =
    chips[0] === chips[1] ? ((1 - s.turn) as PlayerId) : chips[0] > chips[1] ? 0 : 1;
  return { ...s, bag, chips, collected, target: -1, result: { winner }, phase: 'gameover' };
}

export function createGame(first: PlayerId): DMState {
  const bag = shuffle(
    Array.from({ length: CELLS }, (_, i) => i).filter((c) => !CORNERS.includes(c)),
  );
  const s: DMState = {
    walls: generateWalls(),
    knownWalls: [],
    knownOpen: [],
    pos: [START[0], START[1]],
    chips: [0, 0],
    collected: [[], []],
    bag,
    target: -1,
    turn: first,
    phase: 'roll',
    rolled: null,
    steps: 0,
    lastEvent: null,
    result: null,
  };
  return drawTarget(s);
}

export function rollDie(): number {
  return DIE_FACES[Math.floor(Math.random() * DIE_FACES.length)];
}

/** 주사위 굴림 적용 (눈은 외부에서 rollDie()로 뽑아 전달 — UI 연출과 분리) */
export function applyRoll(s: DMState, value: number): DMState {
  if (s.phase !== 'roll') throw new Error('not roll phase');
  if (!DIE_FACES.includes(value)) throw new Error('bad die value');
  return { ...s, phase: 'move', rolled: value, steps: value, lastEvent: null };
}

function endTurn(s: DMState): DMState {
  return { ...s, phase: 'roll', rolled: null, steps: 0, turn: (1 - s.turn) as PlayerId };
}

/** 한 칸 이동 시도. dest는 현재 위치와 인접해야 한다. */
export function applyStep(s: DMState, dest: number): DMState {
  if (s.phase !== 'move') throw new Error('not move phase');
  if (s.steps <= 0) throw new Error('no steps left');
  const from = s.pos[s.turn];
  const e = edgeBetween(from, dest);
  if (e < 0) throw new Error('not adjacent');
  // 이미 드러난 벽에도 다시 부딪힐 수 있다(기억 실수 허용) — UI는 벽을 표시하지 않는다.
  if (s.walls.includes(e)) {
    // 쿵! 벽 확정 공개, 남은 걸음 몰수, 시작 코너 복귀
    const pos = [...s.pos] as [number, number];
    pos[s.turn] = START[s.turn];
    const knownWalls = s.knownWalls.includes(e) ? s.knownWalls : [...s.knownWalls, e];
    return endTurn({
      ...s,
      pos,
      knownWalls,
      lastEvent: { kind: 'bump', by: s.turn, edge: e },
    });
  }

  const knownOpen = s.knownOpen.includes(e) ? s.knownOpen : [...s.knownOpen, e];
  const pos = [...s.pos] as [number, number];
  pos[s.turn] = dest;
  let next: DMState = { ...s, pos, knownOpen, steps: s.steps - 1, lastEvent: null };

  if (dest === next.target) {
    const chips = [...next.chips] as [number, number];
    chips[s.turn] += 1;
    const collected: [number[], number[]] = [next.collected[0].slice(), next.collected[1].slice()];
    collected[s.turn].push(dest);
    next = { ...next, chips, collected, lastEvent: { kind: 'chip', by: s.turn, cell: dest } };
    if (chips[s.turn] >= CHIPS_TO_WIN) {
      return { ...next, phase: 'gameover', result: { winner: s.turn } };
    }
    return drawTarget(endTurn(next));
  }
  if (next.steps === 0) return endTurn(next);
  return next;
}

/** 남은 걸음 포기 */
export function applyStop(s: DMState): DMState {
  if (s.phase !== 'move') throw new Error('not move phase');
  return endTurn({ ...s, lastEvent: null });
}
