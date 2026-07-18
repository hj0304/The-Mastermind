/**
 * 순환선 AI — 완전 정보 조합게임이므로 탐색 기반.
 *
 * 핵심 구성:
 * 1) findCompletion: 현재 배치 + 남은 타일로 순환선 완성이 가능한지(증인 사이클 탐색).
 *    실행 불가능이면 '불가능' 선언이 곧 승리 → 탐색 트리가 실행 가능 상태로 강하게 축소.
 * 2) winValue: 메모이제이션 승패 탐색(대칭 정규화 + 노드 예산). 예산 초과 시
 *    휴리스틱(상대 즉승 수 최소화)으로 폴백.
 *
 * 모든 정보가 공개인 게임이라 숨은 정보 접근 문제는 없다.
 */

import type { LLState, PlayerId } from './engine.ts';
import {
  H,
  STATIONS,
  W,
  isLoop,
  isValidLine,
  legalLines,
  neighbors4,
  placedSet,
  rc,
} from './engine.ts';

// ---------- 완성 가능성 (증인 사이클 DFS) ----------

const compCache = new Map<string, number[] | null>();
/** 직전 findCompletion 호출이 노드 캡에 걸렸는가 — true면 null이어도 '불가능 확정' 아님 */
export let completionCapped = false;

function manhattan(a: number, b: number): number {
  const [ra, ca] = rc(a);
  const [rb, cb] = rc(b);
  return Math.abs(ra - rb) + Math.abs(ca - cb);
}

/**
 * placed 전체를 포함하고 budget개 이하의 새 칸을 추가해 만들 수 있는
 * 순환선이 존재하면 그 증인(전체 사이클 칸 목록)을, 없으면 null.
 * 사이클은 역A→역B→…→(역A 왼쪽 칸)→역A 경로로 탐색한다.
 */
export function findCompletion(placed: number[], budget: number): number[] | null {
  const key = placed.join(',') + '|' + budget;
  const hit = compCache.get(key);
  if (hit !== undefined) {
    completionCapped = false;
    return hit;
  }

  const pset = new Set(placed);
  const A = STATIONS[0];
  const B = STATIONS[1];
  const end = A - 1; // 역A 왼쪽 칸 — 여기 도달하면 사이클 폐합
  const rightOfB = B + 1;

  // 역이 좌우로 통과하므로 end(A-1), B+1은 반드시 경로에 포함
  const inPath = new Set<number>([A, B]);
  const path: number[] = [A, B];
  let unvisited = 0;
  for (const p of placed) if (p !== A && p !== B) unvisited++;

  let nodes = 0;
  const NODE_CAP = 250000;
  let capped = false;

  // end/B+1 칸이 이미 배치돼 있으면 unvisited에 포함되어 있음
  const dfs = (cur: number, budgetLeft: number, unvis: number): boolean => {
    if (++nodes > NODE_CAP) {
      capped = true;
      return false;
    }
    for (const n of neighbors4(cur)) {
      if (n === end && cur !== A) {
        // 폐합 시도: end까지 왔고 모든 배치 칸을 방문했어야 하며,
        // end는 경로 내에서 cur와 A에만 인접해야 함(현 금지 → 차수 2 보장)
        if (inPath.has(end)) continue;
        let deg = 0;
        for (const m of neighbors4(end)) if (inPath.has(m)) deg++;
        if (deg !== 2) continue; // cur + A 외 인접 존재
        const endPlaced = pset.has(end);
        const u2 = endPlaced ? unvis - 1 : unvis;
        const b2 = endPlaced ? budgetLeft : budgetLeft - 1;
        if (b2 < 0 || u2 !== 0) continue;
        path.push(end);
        return true;
      }
      if (inPath.has(n) || n === end) continue;
      // 현 금지: 새 칸은 경로 내 칸 중 cur에만 인접해야 사이클 차수가 2로 유지됨
      let adj = 0;
      for (const m of neighbors4(n)) if (inPath.has(m)) adj++;
      if (adj !== 1) continue;
      const isPlaced = pset.has(n);
      const b2 = isPlaced ? budgetLeft : budgetLeft - 1;
      if (b2 < 0) continue;
      const u2 = isPlaced ? unvis - 1 : unvis;
      // 가지치기: 남은 수용량(새 칸 + 미방문 배치 칸)으로 end까지 못 가면 중단
      const cap = b2 + u2;
      if (manhattan(n, end) - 1 > cap) continue;
      // 미방문 배치 칸 경유 하한
      let ok = true;
      if (u2 > 0) {
        for (const p of placed) {
          if (inPath.has(p) || p === n) continue;
          if (manhattan(n, p) + manhattan(p, end) - 1 > cap) { ok = false; break; }
        }
      }
      if (!ok) continue;
      inPath.add(n);
      path.push(n);
      if (dfs(n, b2, u2)) return true;
      inPath.delete(n);
      path.pop();
    }
    return false;
  };

  // 첫 걸음은 B의 오른쪽 칸(역 통과 강제)
  let result: number[] | null = null;
  {
    const n = rightOfB;
    const [, cB] = rc(B);
    if (cB < W - 1) {
      const isPlaced = pset.has(n);
      const b0 = isPlaced ? budget : budget - 1;
      const u0 = isPlaced ? unvisited - 1 : unvisited;
      if (b0 >= 0) {
        inPath.add(n);
        path.push(n);
        if (dfs(n, b0, u0)) result = [...path];
      }
    }
  }
  completionCapped = capped && result === null;
  // 캡에 걸린 '미확정 null'은 캐시하지 않는다
  if (!completionCapped && compCache.size < 60000) compCache.set(key, result);
  return result;
}

// ---------- 승패 탐색 ----------

/** 대칭 정규화: 가로 미러(역 중심축), 세로 미러, 둘 다 — 4가지 중 사전순 최소 키 */
function canonKey(placed: number[], tilesLeft: number): string {
  const variants: string[] = [];
  const hm = (cell: number) => {
    const [r, c] = rc(cell);
    return r * W + (11 - c); // 역(5,6) 보존: c' = 11 - c
  };
  const vm = (cell: number) => {
    const [r, c] = rc(cell);
    return (H - 1 - r) * W + c;
  };
  const forms = [
    placed,
    placed.map(hm),
    placed.map(vm),
    placed.map((x) => vm(hm(x))),
  ];
  for (const f of forms) variants.push([...f].sort((a, b) => a - b).join(','));
  variants.sort();
  return variants[0] + '|' + tilesLeft;
}

const winCache = new Map<string, boolean>();
let searchNodes = 0;
let searchCap = 0;

class BudgetExceeded extends Error {}

/** 현재 두는 쪽이 이기는가 (완전 탐색, 예산 초과 시 BudgetExceeded) */
function winValue(placed: number[], tilesLeft: number): boolean {
  const key = canonKey(placed, tilesLeft);
  const hit = winCache.get(key);
  if (hit !== undefined) return hit;
  if (++searchNodes > searchCap) throw new BudgetExceeded();

  const set = new Set(placed);
  const lines = legalLines(set, Math.min(3, tilesLeft));

  // 1) 즉시 완성 가능 → 승
  for (const line of lines) {
    for (const c of line) set.add(c);
    const done = isLoop(set);
    for (const c of line) set.delete(c);
    if (done) {
      winCache.set(key, true);
      return true;
    }
  }
  // 2) 완성 자체가 불가능(확정) → 불가능 선언 승
  if (findCompletion(placed, tilesLeft) === null && !completionCapped) {
    winCache.set(key, true);
    return true;
  }
  // 3) 실행 가능성을 유지하는 수 중 상대가 지는 수가 있으면 승
  for (const line of lines) {
    const next = [...placed, ...line].sort((a, b) => a - b);
    const tl = tilesLeft - line.length;
    if (findCompletion(next, tl) === null && !completionCapped) continue; // 상대가 선언으로 이김 → 나쁜 수
    if (!winValue(next, tl)) {
      winCache.set(key, true);
      return true;
    }
  }
  winCache.set(key, false);
  return false;
}

// ---------- 행동 선택 ----------

export type LLAiAction =
  | { kind: 'place'; line: number[] }
  | { kind: 'declare' }
  | { kind: 'giveup' };

/** 휴리스틱 폴백: 실행 가능 유지 수 중 상대 즉승 응수가 가장 적은 수 */
function heuristicMove(placed: number[], tilesLeft: number, lines: number[][]): number[] | null {
  let best: number[] | null = null;
  let bestScore = -Infinity;
  for (const line of lines) {
    const next = [...placed, ...line].sort((a, b) => a - b);
    const tl = tilesLeft - line.length;
    if (findCompletion(next, tl) === null && !completionCapped) continue;
    const nset = new Set(next);
    const oppLines = legalLines(nset, Math.min(3, tl));
    let oppWins = 0;
    for (const ol of oppLines) {
      for (const c of ol) nset.add(c);
      if (isLoop(nset)) oppWins++;
      for (const c of ol) nset.delete(c);
    }
    // 상대 즉승 수가 적을수록, 적게 소비할수록 선호
    const score = -oppWins * 10 - line.length + Math.random() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return best;
}

export function chooseAiAction(s: LLState, me: PlayerId): LLAiAction {
  const placed = s.placed;
  const set = placedSet(s);

  // ----- 불가능 선언 후 완성 시도 -----
  if (s.phase === 'attempt') {
    if (s.attempter !== me) throw new Error('not attempter');
    const witness = findCompletion(placed, s.tilesLeft);
    if (!witness) return { kind: 'giveup' };
    // 증인 사이클에서 아직 없는 칸들을 인접 순서로 배치
    const need = witness.filter((c) => !set.has(c));
    // 기존 타일에 맞닿는 시작 칸부터 최대 3개 일렬
    for (const start of need) {
      if (!neighbors4(start).some((n) => set.has(n))) continue;
      const line = [start];
      // 같은 축으로 연장
      for (const dir of [1, -1, W, -W]) {
        while (line.length < 3) {
          const nxt = line[line.length - 1] + dir;
          if (!need.includes(nxt) || line.includes(nxt)) break;
          // 축 유지 검사
          const cand = [...line, nxt];
          if (!isValidLine(set, cand, s.tilesLeft)) break;
          line.push(nxt);
        }
        if (line.length > 1) break;
      }
      if (isValidLine(set, line, s.tilesLeft)) return { kind: 'place', line };
    }
    // 인접 시작점을 못 찾으면(이론상 드묾) 한 칸이라도
    for (const start of need) {
      if (isValidLine(set, [start], s.tilesLeft)) return { kind: 'place', line: [start] };
    }
    return { kind: 'giveup' };
  }

  // ----- 일반 턴 -----
  if (s.turn !== me) throw new Error('not my turn');
  const lines = legalLines(set, Math.min(3, s.tilesLeft));

  // 1) 즉시 완성
  for (const line of lines) {
    for (const c of line) set.add(c);
    const done = isLoop(set);
    for (const c of line) set.delete(c);
    if (done) return { kind: 'place', line };
  }
  // 2) 완성 불가능(확정) → 선언 승리
  if (findCompletion(placed, s.tilesLeft) === null && !completionCapped) {
    return { kind: 'declare' };
  }

  // 3) 완전 탐색 (예산 내)
  searchNodes = 0;
  searchCap = 120000;
  const winning: number[][] = [];
  const losing = new Set<number[]>();
  try {
    for (const line of lines) {
      const next = [...placed, ...line].sort((a, b) => a - b);
      const tl = s.tilesLeft - line.length;
      if (findCompletion(next, tl) === null && !completionCapped) {
        losing.add(line);
        continue; // 상대 선언 승
      }
      if (!winValue(next, tl)) winning.push(line);
    }
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    // 예산 초과 → 지금까지 찾은 필승 수 우선, 없으면 휴리스틱
  }
  if (winning.length > 0) {
    return { kind: 'place', line: winning[Math.floor(Math.random() * winning.length)] };
  }
  const feasible = lines.filter((l) => !losing.has(l));
  const h = heuristicMove(placed, s.tilesLeft, feasible.length ? feasible : lines);
  if (h) return { kind: 'place', line: h };
  // 모든 수가 실행 불가능을 만든다면 아무 수나 (필패 국면)
  if (lines.length > 0) return { kind: 'place', line: lines[0] };
  return { kind: 'declare' };
}

// ---------- 전적/성향 (표시용) ----------

const TENDENCY_KEY = 'mastermind.loop-line.tendency.v1';

export function recordGameEnd(humanDeclared: boolean, humanWon: boolean) {
  try {
    const t = JSON.parse(localStorage.getItem(TENDENCY_KEY) ?? '{}');
    t.games = (t.games ?? 0) + 1;
    if (humanDeclared) t.humanDeclares = (t.humanDeclares ?? 0) + 1;
    if (humanWon) t.humanWins = (t.humanWins ?? 0) + 1;
    localStorage.setItem(TENDENCY_KEY, JSON.stringify(t));
  } catch {
    // ignore
  }
}
