/**
 * 순환선 (원작: 더 지니어스 모노레일 / 원류: 베니스 커넥션) 게임 엔진.
 * 룰 상세: docs/GAME_RULES.md §11
 *
 * 기차역 타일 2개(가로 나란히)로 시작, 철로 타일 16개를 번갈아 1~3개씩
 * (2개 이상이면 일렬) 기존 타일에 맞닿게 배치. 역→역으로 돌아오는 하나의
 * 순환선(놓인 타일 전부 포함)을 완성하는 마지막 타일을 놓는 쪽이 승리.
 * 자기 턴 시작 시 '불가능' 선언 가능 → 상대가 남은 타일로 완성하면 상대 승.
 *
 * **타일의 방향**: 타일은 양면(앞=직선, 뒤=ㄱ자)이고 놓을 때 면과 방향을 정하며,
 * 한 번 놓으면 바뀌지 않는다. 원류 룰의 두 조항이 이 처리의 근거다.
 *   - "Only the tiles must be connected, not the course of the canal"
 *     → 수로 끝이 빈 칸을 향하는 것은 자유(아직 이어지지 않아도 된다)
 *   - "Tiles must not be laid in such a manner as to block the canal"
 *     → 이미 놓인 타일과 맞닿는 모서리를 어긋나게 놓는 것은 반칙
 * 그래서 배치 판정은 fits()의 모서리 일치 검사이고, 승리 판정은 칸 배치가 아니라
 * **실제 수로가 이어져 하나의 고리를 이루는가**로 한다.
 *
 * 판은 13×9로 유한(실물 테이블의 유한성 반영). 기차역은 중앙에 고정.
 */

export type PlayerId = 0 | 1;

export const W = 13;
export const H = 9;
export const TILES = 16;

/** 수로가 열린 방향 비트 */
export const N = 1;
export const E = 2;
export const S = 4;
export const WST = 8;

/** 직선 2가지 + ㄱ자 4가지 = 타일이 가질 수 있는 모든 모양 */
export const STRAIGHT_H = E | WST; // ─
export const STRAIGHT_V = N | S; // │
export const CURVE_NE = N | E; // └
export const CURVE_ES = E | S; // ┌
export const CURVE_SW = S | WST; // ┐
export const CURVE_WN = WST | N; // ┘
export const ALL_MASKS = [STRAIGHT_H, STRAIGHT_V, CURVE_NE, CURVE_ES, CURVE_SW, CURVE_WN];

/** 회전 순서 (UI의 회전 버튼이 도는 순서) */
export const STRAIGHT_CYCLE = [STRAIGHT_H, STRAIGHT_V];
export const CURVE_CYCLE = [CURVE_NE, CURVE_ES, CURVE_SW, CURVE_WN];

/** 기차역 2칸 (가로 나란히, 순환선이 좌우로 통과해야 함) */
export const STATIONS: [number, number] = [4 * W + 5, 4 * W + 6];

export function rc(cell: number): [number, number] {
  return [Math.floor(cell / W), cell % W];
}

export function neighbors4(cell: number): number[] {
  const [r, c] = rc(cell);
  const out: number[] = [];
  if (c > 0) out.push(cell - 1);
  if (c < W - 1) out.push(cell + 1);
  if (r > 0) out.push(cell - W);
  if (r < H - 1) out.push(cell + W);
  return out;
}

/** 방향 비트 → 이웃 칸 (판 밖이면 -1) */
export function step(cell: number, bit: number): number {
  const [r, c] = rc(cell);
  if (bit === N) return r > 0 ? cell - W : -1;
  if (bit === S) return r < H - 1 ? cell + W : -1;
  if (bit === E) return c < W - 1 ? cell + 1 : -1;
  if (bit === WST) return c > 0 ? cell - 1 : -1;
  return -1;
}

export function opposite(bit: number): number {
  if (bit === N) return S;
  if (bit === S) return N;
  if (bit === E) return WST;
  return E;
}

/** 마스크에서 열린 방향 비트들 */
export function openBits(mask: number): number[] {
  const out: number[] = [];
  for (const b of [N, E, S, WST]) if (mask & b) out.push(b);
  return out;
}

// ---------- 판 ----------

/** board[cell] = 0(빈칸) 또는 열린 방향 마스크 */
export type Board = number[];

export function emptyBoard(): Board {
  return new Array(W * H).fill(0);
}

export function placedCells(board: Board): number[] {
  const out: number[] = [];
  for (let c = 0; c < board.length; c++) if (board[c] !== 0) out.push(c);
  return out;
}

/**
 * cell에 mask로 놓을 수 있는가 — 맞닿는 타일과 모서리가 일치해야 한다.
 * (빈 칸·판 밖을 향해 열린 것은 자유)
 */
export function fits(board: Board, cell: number, mask: number): boolean {
  if (board[cell] !== 0) return false;
  for (const b of [N, E, S, WST]) {
    const n = step(cell, b);
    if (n < 0) continue;
    const nm = board[n];
    if (nm === 0) continue; // 빈 칸 — 아직 이어질 필요 없다
    const mineOpen = (mask & b) !== 0;
    const theirsOpen = (nm & opposite(b)) !== 0;
    if (mineOpen !== theirsOpen) return false; // 수로를 막는 배치
  }
  return true;
}

/** cell에 놓을 수 있는 모든 방향 */
export function legalMasks(board: Board, cell: number): number[] {
  return ALL_MASKS.filter((m) => fits(board, cell, m));
}

/** 놓인 타일 전부가 이어져 하나의 순환선을 이루는가 */
export function isLoop(board: Board): boolean {
  const cells = placedCells(board);
  if (cells.length < 4) return false;
  // 열린 수로가 빈 칸/판 밖을 향하면 아직 미완성
  for (const c of cells) {
    for (const b of openBits(board[c])) {
      const n = step(c, b);
      if (n < 0 || board[n] === 0) return false;
    }
  }
  // 모든 타일의 차수가 2이므로, 전부 연결되어 있으면 하나의 고리다
  const seen = new Set<number>([STATIONS[0]]);
  const q = [STATIONS[0]];
  while (q.length) {
    const u = q.pop()!;
    for (const b of openBits(board[u])) {
      const n = step(u, b);
      if (n >= 0 && board[n] !== 0 && !seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen.size === cells.length;
}

/** 완성된 순환선의 사이클 순서 (렌더용). isLoop 전제. */
export function traceLoop(board: Board): number[] {
  const start = STATIONS[0];
  const order = [start];
  let prev = -1;
  let cur = start;
  do {
    let next = -1;
    for (const b of openBits(board[cur])) {
      const n = step(cur, b);
      if (n !== prev) {
        next = n;
        break;
      }
    }
    prev = cur;
    cur = next;
    if (cur !== start && cur >= 0) order.push(cur);
  } while (cur !== start && cur >= 0 && order.length <= placedCells(board).length + 1);
  return order;
}

// ---------- 배치 ----------

/** 한 번에 놓는 타일들 */
export interface Tile {
  cell: number;
  mask: number;
}

/** 칸 배열이 1~3개의 일렬이며 기존 타일에 맞닿는가 (방향과 무관한 위치 조건) */
export function isValidCells(board: Board, cells: number[], tilesLeft: number): boolean {
  if (cells.length < 1 || cells.length > 3 || cells.length > tilesLeft) return false;
  const uniq = new Set(cells);
  if (uniq.size !== cells.length) return false;
  for (const cell of cells) {
    if (cell < 0 || cell >= W * H || board[cell] !== 0) return false;
  }
  if (cells.length > 1) {
    const rows = cells.map((c) => rc(c)[0]);
    const cols = cells.map((c) => rc(c)[1]);
    const sameRow = rows.every((r) => r === rows[0]);
    const sameCol = cols.every((c) => c === cols[0]);
    if (!sameRow && !sameCol) return false;
    const axis = (sameRow ? cols : rows).slice().sort((a, b) => a - b);
    for (let i = 1; i < axis.length; i++) if (axis[i] !== axis[i - 1] + 1) return false;
  }
  return cells.some((cell) => neighbors4(cell).some((n) => board[n] !== 0));
}

/**
 * 불가능 선언 뒤 혼자 완성할 때의 위치 조건.
 *
 * 1~3개·일렬 제약은 "번갈아 놓는" 진행 규칙에 붙은 것이고, 원작에서 시도자는
 * "남은 타일을 이용해 철로를 완성"하기만 하면 된다. 어차피 시도자는 여러 번
 * 나눠 놓을 수 있어 만들 수 있는 최종 배치가 같으므로(최종 고리를 기존 구조에서
 * 한 칸씩 붙여 나가면 모든 중간 단계가 합법) 승패에는 영향이 없고, 조작만 편해진다.
 *
 * 대신 **떠 있는 섬은 안 된다** — 각 타일은 기존 타일이나 같은 배치의 다른 타일과
 * 이어져 있어야 한다.
 */
export function isValidFreeform(board: Board, cells: number[], tilesLeft: number): boolean {
  if (cells.length < 1 || cells.length > tilesLeft) return false;
  const uniq = new Set(cells);
  if (uniq.size !== cells.length) return false;
  for (const cell of cells) {
    if (cell < 0 || cell >= W * H || board[cell] !== 0) return false;
  }
  // 기존 타일에서 출발해 인접한 것부터 흡수 — 전부 흡수되면 하나로 이어진 배치다
  const rest = new Set(cells);
  const grown = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of [...rest]) {
      if (neighbors4(c).some((n) => board[n] !== 0 || grown.has(n))) {
        rest.delete(c);
        grown.add(c);
        changed = true;
      }
    }
  }
  return rest.size === 0;
}

/** 타일 묶음 배치의 유효성 (위치 + 방향 모두) */
export function isValidPlacement(
  board: Board,
  tiles: Tile[],
  tilesLeft: number,
  freeform = false,
): boolean {
  const cells = tiles.map((t) => t.cell);
  if (!(freeform ? isValidFreeform(board, cells, tilesLeft) : isValidCells(board, cells, tilesLeft))) {
    return false;
  }
  const tmp = board.slice();
  for (const t of tiles) {
    if (!ALL_MASKS.includes(t.mask)) return false;
    if (!fits(tmp, t.cell, t.mask)) return false;
    tmp[t.cell] = t.mask;
  }
  return true;
}

/**
 * 놓을 자리가 있는 칸들 (프론티어) — 방향은 별도로 고른다.
 * 한 칸이라도 놓을 방향이 없으면(맞닿은 타일 3면 이상이 열림 등) 제외한다.
 */
export function frontier(board: Board): number[] {
  const out = new Set<number>();
  for (const p of placedCells(board)) {
    for (const n of neighbors4(p)) {
      if (board[n] === 0 && legalMasks(board, n).length > 0) out.add(n);
    }
  }
  return [...out];
}

// ---------- 상태 ----------

export interface LLState {
  board: Board;
  tilesLeft: number;
  turn: PlayerId;
  phase: 'play' | 'attempt' | 'gameover';
  /** 불가능 선언 후 완성을 시도하는 쪽 (선언자의 상대) */
  attempter: PlayerId | null;
  lastMove: number[] | null;
  /** 완성된 순환선 (사이클 순서, 렌더용) */
  loop: number[] | null;
  result: { winner: PlayerId; reason: 'complete' | 'declare' } | null;
}

export function createGame(first: PlayerId): LLState {
  const board = emptyBoard();
  // 기차역은 양끝으로 철로가 열린 가로 타일
  board[STATIONS[0]] = STRAIGHT_H;
  board[STATIONS[1]] = STRAIGHT_H;
  return {
    board,
    tilesLeft: TILES,
    turn: first,
    phase: 'play',
    attempter: null,
    lastMove: null,
    loop: null,
    result: null,
  };
}

/** 타일 배치 (play/attempt 공용) */
export function applyPlace(s: LLState, tiles: Tile[]): LLState {
  if (s.phase !== 'play' && s.phase !== 'attempt') throw new Error('bad phase');
  // 혼자 완성하는 국면에서는 1~3개·일렬 제약이 없다 (isValidFreeform 주석 참조)
  if (!isValidPlacement(s.board, tiles, s.tilesLeft, s.phase === 'attempt')) {
    throw new Error('invalid placement');
  }
  const board = s.board.slice();
  for (const t of tiles) board[t.cell] = t.mask;
  const tilesLeft = s.tilesLeft - tiles.length;
  const mover = s.phase === 'attempt' ? s.attempter! : s.turn;
  const lastMove = tiles.map((t) => t.cell);

  if (isLoop(board)) {
    return {
      ...s,
      board,
      tilesLeft,
      lastMove,
      loop: traceLoop(board),
      phase: 'gameover',
      result: { winner: mover, reason: 'complete' },
    };
  }
  if (s.phase === 'attempt') {
    // 시도자는 남은 타일로 계속 놓는다. 타일 소진 시 실패 → 선언자 승.
    if (tilesLeft === 0) {
      return {
        ...s,
        board,
        tilesLeft,
        lastMove,
        phase: 'gameover',
        result: { winner: (1 - s.attempter!) as PlayerId, reason: 'declare' },
      };
    }
    return { ...s, board, tilesLeft, lastMove };
  }
  return { ...s, board, tilesLeft, lastMove, turn: (1 - s.turn) as PlayerId };
}

/** 불가능 선언 (자기 턴 시작 시) → 상대가 남은 타일로 완성 시도 */
export function applyDeclare(s: LLState): LLState {
  if (s.phase !== 'play') throw new Error('bad phase');
  const attempter = (1 - s.turn) as PlayerId;
  if (s.tilesLeft === 0) {
    return { ...s, phase: 'gameover', result: { winner: s.turn, reason: 'declare' } };
  }
  return { ...s, phase: 'attempt', attempter, lastMove: null };
}

/** 완성 시도 포기 → 선언자 승 */
export function applyGiveUp(s: LLState): LLState {
  if (s.phase !== 'attempt') throw new Error('bad phase');
  return {
    ...s,
    phase: 'gameover',
    result: { winner: (1 - s.attempter!) as PlayerId, reason: 'declare' },
  };
}
