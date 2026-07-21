/**
 * 순환선 AI — 완전 정보 조합게임이므로 탐색 기반.
 *
 * 핵심 구성:
 * 1) findCompletion: 현재 배치 + 남은 타일로 순환선 완성이 가능한지(증인 사이클 탐색).
 *    실행 불가능이면 '불가능' 선언이 곧 승리 → 탐색 트리가 실행 가능 상태로 강하게 축소.
 * 2) winValue: 메모이제이션 승패 탐색(대칭 정규화 + 노드 예산). 예산 초과 시
 *    휴리스틱(상대 즉승 수 최소화)으로 폴백.
 *
 * **방향이 고정된 뒤의 탐색**: 타일마다 방향이 확정되므로 상태 공간은 넓어지지만,
 * 대신 증인 탐색이 놓인 타일을 지날 때 **들어온 반대편 출구로 나가는 것이 강제**된다
 * (수로가 이어져야 하므로). 그래서 경로 탐색은 오히려 좁아진다.
 *
 * 모든 정보가 공개인 게임이라 숨은 정보 접근 문제는 없다.
 */

import type { Board, LLState, PlayerId, Tile } from './engine.ts';
import {
  E,
  H,
  N,
  S,
  STATIONS,
  W,
  WST,
  isLoop,
  isValidCells,
  isValidPlacement,
  legalMasks,
  neighbors4,
  openBits,
  opposite,
  placedCells,
  rc,
  step,
} from './engine.ts';

// ---------- 수 생성 ----------

const EMPTY_SET: Set<number> = new Set();

/**
 * 1~3칸 일렬 후보 (방향은 아직 정하지 않은 위치들).
 * free = 탐색 중 가상으로 차지한 칸 — 여기에는 놓을 수 없고, 맞닿음의 기준은 된다.
 */
export function legalLines(board: Board, maxLen: number, free: Set<number> = EMPTY_SET): number[][] {
  const taken = (c: number) => board[c] !== 0 || free.has(c);
  const out: number[][] = [];
  const seen = new Set<string>();
  const front = new Set<number>();
  for (const p of placedCells(board)) for (const n of neighbors4(p)) if (!taken(n)) front.add(n);
  for (const p of free) for (const n of neighbors4(p)) if (!taken(n)) front.add(n);

  const valid = (line: number[]) => {
    if (line.length < 1 || line.length > maxLen) return false;
    for (const c of line) if (taken(c)) return false;
    return line.some((c) => neighbors4(c).some((n) => taken(n)));
  };
  const push = (line: number[]) => {
    const key = [...line].sort((a, b) => a - b).join(',');
    if (!seen.has(key) && valid(line)) {
      seen.add(key);
      out.push(line);
    }
  };
  for (const f of front) {
    push([f]);
    if (maxLen < 2) continue;
    const [r, c] = rc(f);
    for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
      for (let len = 2; len <= maxLen; len++) {
        for (let off = -(len - 1); off <= 0; off++) {
          const line: number[] = [];
          let ok = true;
          for (let i = 0; i < len; i++) {
            const rr = r + dr * (off + i);
            const cc = c + dc * (off + i);
            if (rr < 0 || rr >= H || cc < 0 || cc >= W) { ok = false; break; }
            const cell = rr * W + cc;
            if (taken(cell)) { ok = false; break; }
            line.push(cell);
          }
          if (ok) push(line);
        }
      }
    }
  }
  return out;
}

/** 한 줄의 칸들에 방향을 배정하는 모든 조합 (모서리 일치를 만족하는 것만) */
export function maskCombos(board: Board, cells: number[], cap = 400): Tile[][] {
  const out: Tile[][] = [];
  const tmp = board.slice();
  const acc: Tile[] = [];
  const rec = (i: number) => {
    if (out.length >= cap) return;
    if (i === cells.length) {
      out.push(acc.slice());
      return;
    }
    for (const m of legalMasks(tmp, cells[i])) {
      tmp[cells[i]] = m;
      acc.push({ cell: cells[i], mask: m });
      rec(i + 1);
      acc.pop();
      tmp[cells[i]] = 0;
      if (out.length >= cap) return;
    }
  };
  rec(0);
  return out;
}

/** 이번 턴에 둘 수 있는 모든 배치 */
export function allMoves(board: Board, tilesLeft: number): Tile[][] {
  const out: Tile[][] = [];
  for (const line of legalLines(board, Math.min(3, tilesLeft))) {
    out.push(...maskCombos(board, line));
  }
  return out;
}

function withTiles(board: Board, tiles: Tile[]): Board {
  const b = board.slice();
  for (const t of tiles) b[t.cell] = t.mask;
  return b;
}

// ---------- 완성 가능성 (증인 사이클 DFS) ----------

const compCache = new Map<string, number[] | null>();
/** 직전 findCompletion 호출이 노드 캡에 걸렸는가 — true면 null이어도 '불가능 확정' 아님 */
export let completionCapped = false;

function boardKey(board: Board): string {
  const parts: string[] = [];
  for (let c = 0; c < board.length; c++) if (board[c]) parts.push(`${c}:${board[c]}`);
  return parts.join(',');
}

function manhattan(a: number, b: number): number {
  const [ra, ca] = rc(a);
  const [rb, cb] = rc(b);
  return Math.abs(ra - rb) + Math.abs(ca - cb);
}

/**
 * 놓인 타일 전부를 지나면서 budget개 이하의 새 타일로 닫을 수 있는 순환선이
 * 존재하면 그 증인(사이클 칸 순서)을, 없으면 null.
 *
 * 역A의 동쪽 출구로 나가 역A의 서쪽 입구로 돌아오는 경로를 찾는다.
 * 놓인 타일에 들어가면 반대편 출구가 강제되고, 빈 칸은 새 타일을 놓아
 * 나갈 방향을 고른다(들어온 방향을 제외한 3가지).
 */
export function findCompletion(
  board: Board,
  budget: number,
  free: Set<number> = EMPTY_SET,
): number[] | null {
  const key =
    boardKey(board) + '|' + budget + (free.size ? '|f' + [...free].sort((a, b) => a - b).join('.') : '');
  const hit = compCache.get(key);
  if (hit !== undefined) {
    completionCapped = false;
    return hit;
  }

  const A = STATIONS[0];
  // free = 이미 차지했지만 방향은 아직 정하지 않은 칸 (탐색 중의 가상 배치).
  // 반드시 경로에 포함되어야 하지만 방향 제약은 없고 예산도 쓰지 않는다.
  const placed = [...placedCells(board), ...free];
  const work = board.slice();
  const path: number[] = [A];
  const inPath = new Set<number>([A]);
  let unvisited = placed.length - 1; // A 제외

  let nodes = 0;
  const NODE_CAP = 200000;
  let capped = false;
  let result: number[] | null = null;

  /**
   * cur에 fromBit(= cur에서 직전 칸을 향하는 방향)으로 들어왔다.
   * 여기서 나가는 경우들을 시도한다.
   */
  const walk = (cur: number, fromBit: number, budgetLeft: number, unvis: number): boolean => {
    if (++nodes > NODE_CAP) {
      capped = true;
      return false;
    }
    const placedHere = work[cur] !== 0;
    const exits: number[] = [];
    if (placedHere) {
      const bits = openBits(work[cur]);
      if (!bits.includes(fromBit)) return false; // 수로가 이어지지 않는다
      exits.push(bits.find((b) => b !== fromBit)!);
    } else {
      for (const b of [N, E, S, WST]) if (b !== fromBit) exits.push(b);
    }

    for (const exit of exits) {
      const nxt = step(cur, exit);
      if (nxt < 0) continue;
      // 새 타일이면 이 시점에 확정하고 모서리 일치를 검사한다
      let placedNew = false;
      if (!placedHere) {
        const mask = fromBit | exit;
        // 이미 경로에 넣을 때 fits로 검사했으므로 여기서는 마스크만 확정
        work[cur] = mask;
        placedNew = true;
        // 맞닿은 타일과 어긋나면 무효
        let ok = true;
        for (const b of [N, E, S, WST]) {
          const n2 = step(cur, b);
          if (n2 < 0 || n2 === nxt) continue;
          const nm = work[n2];
          if (nm === 0) continue;
          if (((mask & b) !== 0) !== ((nm & opposite(b)) !== 0)) { ok = false; break; }
        }
        if (!ok) {
          work[cur] = 0;
          placedNew = false;
          continue;
        }
      }

      const closing = nxt === A;
      if (closing) {
        // 역A의 서쪽으로 돌아와야 하고, 모든 놓인 타일을 지났어야 한다
        if (opposite(exit) === WST && unvis === 0 && budgetLeft >= 0) {
          result = [...path];
          return true;
        }
        if (placedNew) work[cur] = 0;
        continue;
      }
      if (inPath.has(nxt)) {
        if (placedNew) work[cur] = 0;
        continue;
      }

      // 이미 차지된 칸(방향 확정이든 미정이든)은 예산을 쓰지 않고, 방문 의무를 하나 던다
      const nxtTaken = work[nxt] !== 0 || free.has(nxt);
      const b2 = nxtTaken ? budgetLeft : budgetLeft - 1;
      const u2 = nxtTaken ? unvis - 1 : unvis;
      if (b2 < 0) {
        if (placedNew) work[cur] = 0;
        continue;
      }
      // 남은 수용량으로 역까지 돌아갈 수 있는가 + 미방문 타일을 들를 수 있는가
      const cap = b2 + u2;
      let prune = manhattan(nxt, A) - 1 > cap;
      if (!prune && u2 > 0) {
        for (const p of placed) {
          if (inPath.has(p) || p === nxt) continue;
          if (manhattan(nxt, p) + manhattan(p, A) - 1 > cap) { prune = true; break; }
        }
      }
      if (prune) {
        if (placedNew) work[cur] = 0;
        continue;
      }

      inPath.add(nxt);
      path.push(nxt);
      if (walk(nxt, opposite(exit), b2, u2)) return true;
      path.pop();
      inPath.delete(nxt);
      if (placedNew) work[cur] = 0;
    }
    return false; // 각 분기에서 work[cur]는 이미 되돌렸다
  };

  // 첫 걸음: 역A의 동쪽(= 역B)으로 나간다
  const first = step(A, E);
  if (first >= 0 && work[first] !== 0) {
    inPath.add(first);
    path.push(first);
    if (!walk(first, WST, budget, unvisited - 1)) {
      path.pop();
      inPath.delete(first);
    }
  }

  completionCapped = capped && result === null;
  if (!completionCapped && compCache.size < 60000) compCache.set(key, result);
  return result;
}

// ---------- 승패 탐색 ----------

/**
 * 방향까지 포함해 완전 탐색하면 한 턴의 수가 800가지를 넘어 탐색이 불가능하다
 * (칸만 볼 때는 40~60가지). 그런데 이 게임의 전략은 원래 **어느 칸을 채우는가**
 * — 나무위키의 (n,n)·(1,2,3)·nㄱm 같은 빈 공간 모양 이론 — 에 있고, 방향은
 * 맞닿은 타일 때문에 대체로 국소적으로 강제된다.
 *
 * 그래서 승패 탐색은 **칸 단위로** 하고(놓인 타일의 방향은 고정 조건으로 반영),
 * 실제로 놓을 때의 방향은 "완성 가능성이 남는 방향"으로 고른다.
 * 즉 모양 싸움은 완전 탐색, 끼워맞추기는 증인 탐색이 맡는다.
 */

/** 칸 집합이 (놓인 타일의 방향과 모순 없이) 하나의 순환선을 이루는가 */
function cellsCloseLoop(board: Board, cells: Set<number>): boolean {
  if (cells.size < 4) return false;
  const nb = new Map<number, number[]>();
  for (const c of cells) {
    const adj = neighbors4(c).filter((n) => cells.has(n));
    if (adj.length !== 2) return false;
    nb.set(c, adj);
  }
  // 놓인 타일은 자기 방향과 일치해야 한다
  for (const c of cells) {
    if (board[c] === 0) continue;
    let implied = 0;
    for (const b of [N, E, S, WST]) {
      const t = step(c, b);
      if (t >= 0 && nb.get(c)!.includes(t)) implied |= b;
    }
    if (implied !== board[c]) return false;
  }
  // 연결성
  const seen = new Set<number>([STATIONS[0]]);
  const q = [STATIONS[0]];
  while (q.length) {
    const u = q.pop()!;
    for (const n of nb.get(u)!) if (!seen.has(n)) { seen.add(n); q.push(n); }
  }
  return seen.size === cells.size;
}

const winCache = new Map<string, boolean>();
let searchNodes = 0;
let searchCap = 0;
/** 탐색 마감 시각 — 노드 수만으로는 기기에 따라 체감 속도가 달라진다 */
let searchDeadline = 0;
/** 이번 턴의 고정 방향 서명 — 방향이 다르면 승패도 달라지므로 키에 섞는다 */
let rootSig = '';

class BudgetExceeded extends Error {}

/** 칸 단위 대칭 정규화 */
function canonCells(cells: number[], tilesLeft: number): string {
  const hm = (cell: number) => {
    const [r, c] = rc(cell);
    return r * W + (11 - c);
  };
  const vm = (cell: number) => {
    const [r, c] = rc(cell);
    return (H - 1 - r) * W + c;
  };
  const forms = [cells, cells.map(hm), cells.map(vm), cells.map((x) => vm(hm(x)))]
    .map((f) => [...f].sort((a, b) => a - b).join(','))
    .sort();
  return rootSig + '#' + forms[0] + '|' + tilesLeft;
}

/**
 * 현재 두는 쪽이 이기는가 (칸 단위 완전 탐색, 예산 초과 시 BudgetExceeded).
 *
 * board는 뿌리 국면의 방향 확정 타일들이고, free는 탐색 중 가상으로 차지한
 * (방향 미정) 칸들이다. 방향을 노드마다 확정하려 하면 조합이 폭발하므로,
 * "이 칸들을 반드시 지나는 순환선이 아직 있는가"만 증인 탐색으로 확인한다.
 */
function winValue(board: Board, free: Set<number>, tilesLeft: number): boolean {
  const cells = [...placedCells(board), ...free].sort((a, b) => a - b);
  const key = canonCells(cells, tilesLeft);
  const hit = winCache.get(key);
  if (hit !== undefined) return hit;
  if (++searchNodes > searchCap) throw new BudgetExceeded();
  if ((searchNodes & 255) === 0 && Date.now() > searchDeadline) throw new BudgetExceeded();

  const set = new Set(cells);
  const lines = legalLines(board, Math.min(3, tilesLeft), free);

  // 1) 즉시 완성 가능 → 승.
  //    고리 판정은 비싸므로 값싼 필요조건으로 먼저 거른다: 이미 놓인 칸들의
  //    "모자란 차수"의 합은 새 타일이 메워야 하고, 타일 하나가 메울 수 있는 것은
  //    최대 2이므로 missing ≤ 2×(놓는 개수)일 때만 실제로 검사한다.
  let missing = 0;
  for (const c of set) {
    let deg = 0;
    for (const n of neighbors4(c)) if (set.has(n)) deg++;
    if (deg > 2) { missing = Infinity; break; } // 차수 3 이상 — 이 국면은 고리가 될 수 없다
    missing += 2 - deg;
  }
  for (const line of lines) {
    if (missing > 2 * line.length) continue;
    for (const c of line) set.add(c);
    const done = cellsCloseLoop(board, set);
    for (const c of line) set.delete(c);
    if (done) {
      winCache.set(key, true);
      return true;
    }
  }
  // 2) 완성 자체가 불가능(확정) → 불가능 선언 승
  if (findCompletion(board, tilesLeft, free) === null && !completionCapped) {
    winCache.set(key, true);
    return true;
  }
  // 3) 상대가 지는 수가 있으면 승.
  //    (완성 불가능하게 만드는 수는 자식 노드의 2)에서 상대의 '선언 승'으로 잡히므로
  //     여기서 또 검사하지 않는다 — 자식마다 증인 탐색을 돌리면 노드 비용이 40배가 된다)
  for (const line of lines) {
    const tl = tilesLeft - line.length;
    const nextFree = new Set(free);
    for (const c of line) nextFree.add(c);
    if (!winValue(board, nextFree, tl)) {
      winCache.set(key, true);
      return true;
    }
  }
  winCache.set(key, false);
  return false;
}

/**
 * 칸들에 "완성 가능성이 남는" 방향을 배정한다. 놓을 방향이 아예 없으면 null.
 * 탐색 중에도 방향을 확정해 나가야 이후 판단이 실제 규칙과 어긋나지 않는다.
 */
function orientCells(board: Board, cells: number[], tilesLeft: number): Tile[] | null {
  // 이 칸들을 반드시 지나는 증인 사이클을 한 번 찾고, 그 경로가 요구하는 방향을 읽는다.
  // (방향 조합을 하나씩 넣어보면 조합당 증인 탐색이 필요해 탐색이 감당 못 한다)
  const w = findCompletion(board, tilesLeft, new Set(cells));
  if (w !== null) {
    const order = new Map<number, number>();
    w.forEach((c, i) => order.set(c, i));
    const tiles: Tile[] = [];
    for (const c of cells) {
      const i = order.get(c);
      if (i === undefined) { tiles.length = 0; break; }
      const prev = w[(i - 1 + w.length) % w.length];
      const nxt = w[(i + 1) % w.length];
      let mask = 0;
      for (const b of [N, E, S, WST]) {
        const t = step(c, b);
        if (t === prev || t === nxt) mask |= b;
      }
      tiles.push({ cell: c, mask });
    }
    if (tiles.length === cells.length && isValidPlacement(board, tiles, tilesLeft)) return tiles;
  }
  // 증인이 없으면(이미 완성 불가) 규칙상 놓을 수 있는 방향 아무거나
  const combos = maskCombos(board, cells, 1);
  return combos.length > 0 ? combos[0] : null;
}

/** 칸 집합이 이루는 고리에서 각 새 칸이 가져야 할 방향 */
function impliedTiles(cells: Set<number>, newCells: number[]): Tile[] {
  return newCells.map((c) => {
    let mask = 0;
    for (const b of [N, E, S, WST]) {
      const t = step(c, b);
      if (t >= 0 && cells.has(t)) mask |= b;
    }
    return { cell: c, mask };
  });
}

// ---------- 행동 선택 ----------

export type LLAiAction =
  | { kind: 'place'; tiles: Tile[] }
  | { kind: 'declare' }
  | { kind: 'giveup' };

/** 휴리스틱 폴백: 실행 가능 유지 수 중 상대 즉승 응수가 가장 적은 수 */
function heuristicMove(board: Board, cells: number[], tilesLeft: number, lines: number[][]): Tile[] | null {
  let best: Tile[] | null = null;
  let bestScore = -Infinity;
  for (const line of lines) {
    const tl = tilesLeft - line.length;
    const tiles = orientCells(board, line, tl);
    if (tiles === null) continue;
    const next = withTiles(board, tiles);
    if (findCompletion(next, tl) === null && !completionCapped) continue;
    const nextCells = new Set([...cells, ...line]);
    let oppWins = 0;
    for (const ol of legalLines(next, Math.min(3, tl))) {
      for (const c of ol) nextCells.add(c);
      if (cellsCloseLoop(next, nextCells)) oppWins++;
      for (const c of ol) nextCells.delete(c);
    }
    const score = -oppWins * 10 - line.length + Math.random() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = tiles;
    }
  }
  return best;
}

/** 증인 사이클을 따라 최대 3칸 일렬을 골라 실제 배치로 만든다 */
function tilesFromWitness(board: Board, witness: number[], tilesLeft: number): Tile[] | null {
  // 증인 사이클의 각 칸에 필요한 마스크를 계산
  const need = new Map<number, number>();
  for (let i = 0; i < witness.length; i++) {
    const cur = witness[i];
    if (board[cur] !== 0) continue;
    const prev = witness[(i - 1 + witness.length) % witness.length];
    const nxt = witness[(i + 1) % witness.length];
    let mask = 0;
    for (const b of [N, E, S, WST]) {
      const t = step(cur, b);
      if (t === prev || t === nxt) mask |= b;
    }
    need.set(cur, mask);
  }
  if (need.size === 0) return null;
  const cells = [...need.keys()];
  // 기존 타일에 맞닿는 칸부터, 같은 축으로 최대 3칸까지 이어 붙인다
  for (const start of cells) {
    if (!neighbors4(start).some((n) => board[n] !== 0)) continue;
    for (const dir of [1, -1, W, -W]) {
      const line = [start];
      while (line.length < Math.min(3, tilesLeft)) {
        const nxt = line[line.length - 1] + dir;
        if (!need.has(nxt) || line.includes(nxt)) break;
        const cand = [...line, nxt];
        if (!isValidCells(board, cand, tilesLeft)) break;
        line.push(nxt);
      }
      if (isValidCells(board, line, tilesLeft)) {
        return line.map((c) => ({ cell: c, mask: need.get(c)! }));
      }
    }
  }
  for (const start of cells) {
    if (isValidCells(board, [start], tilesLeft)) {
      return [{ cell: start, mask: need.get(start)! }];
    }
  }
  return null;
}

export function chooseAiAction(s: LLState, me: PlayerId): LLAiAction {
  const board = s.board;

  // ----- 불가능 선언 후 완성 시도 -----
  // 이 국면에는 1~3개·일렬 제약이 없으므로 증인 사이클이 요구하는 칸을 한 번에 깐다
  if (s.phase === 'attempt') {
    if (s.attempter !== me) throw new Error('not attempter');
    const witness = findCompletion(board, s.tilesLeft);
    if (!witness) return { kind: 'giveup' };
    const all: Tile[] = [];
    for (let i = 0; i < witness.length; i++) {
      const cur = witness[i];
      if (board[cur] !== 0) continue;
      const prev = witness[(i - 1 + witness.length) % witness.length];
      const nxt = witness[(i + 1) % witness.length];
      let mask = 0;
      for (const b of [N, E, S, WST]) {
        const t = step(cur, b);
        if (t === prev || t === nxt) mask |= b;
      }
      all.push({ cell: cur, mask });
    }
    if (all.length > 0 && isValidPlacement(board, all, s.tilesLeft, true)) {
      return { kind: 'place', tiles: all };
    }
    const tiles = tilesFromWitness(board, witness, s.tilesLeft);
    return tiles ? { kind: 'place', tiles } : { kind: 'giveup' };
  }

  // ----- 일반 턴 -----
  if (s.turn !== me) throw new Error('not my turn');
  const cells = placedCells(board);
  const lines = legalLines(board, Math.min(3, s.tilesLeft));
  rootSig = boardKey(board);

  // 1) 즉시 완성 — 고리가 되는 칸 배치를 찾아 그 고리가 요구하는 방향으로 놓는다
  {
    const set = new Set(cells);
    for (const line of lines) {
      for (const c of line) set.add(c);
      const done = cellsCloseLoop(board, set);
      if (done) {
        const tiles = impliedTiles(set, line);
        for (const c of line) set.delete(c);
        if (isValidPlacement(board, tiles, s.tilesLeft) && isLoop(withTiles(board, tiles))) {
          return { kind: 'place', tiles };
        }
        continue;
      }
      for (const c of line) set.delete(c);
    }
  }
  // 2) 완성 불가능(확정) → 선언 승리
  if (findCompletion(board, s.tilesLeft) === null && !completionCapped) {
    return { kind: 'declare' };
  }

  // 3) 칸 단위 완전 탐색 (예산 내)
  searchNodes = 0;
  searchCap = 400000;
  searchDeadline = Date.now() + 2500;
  const winning: Tile[][] = [];
  const feasibleLines: number[][] = [];
  try {
    for (const line of lines) {
      const tl = s.tilesLeft - line.length;
      const free = new Set(line);
      if (findCompletion(board, tl, free) === null && !completionCapped) continue; // 상대 선언 승
      feasibleLines.push(line);
      if (!winValue(board, free, tl)) {
        const tiles = orientCells(board, line, tl);
        if (tiles) winning.push(tiles);
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
  }
  if (winning.length > 0) {
    return { kind: 'place', tiles: winning[Math.floor(Math.random() * winning.length)] };
  }
  const h = heuristicMove(board, cells, s.tilesLeft, feasibleLines.length ? feasibleLines : lines);
  if (h) return { kind: 'place', tiles: h };
  for (const line of lines) {
    const tiles = orientCells(board, line, s.tilesLeft - line.length);
    if (tiles) return { kind: 'place', tiles };
  }
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
