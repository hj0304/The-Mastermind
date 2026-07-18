/**
 * 순환선 (원작: 더 지니어스 모노레일 / 원류: 베니스 커넥션) 게임 엔진.
 * 룰 상세: docs/GAME_RULES.md §11
 *
 * 기차역 타일 2개(가로 나란히)로 시작, 철로 타일 16개를 번갈아 1~3개씩
 * (2개 이상이면 일렬) 기존 타일에 맞닿게 배치. 역→역으로 돌아오는 하나의
 * 순환선(놓인 타일 전부 포함)을 완성하는 마지막 타일을 놓는 쪽이 승리.
 * 자기 턴 시작 시 '불가능' 선언 가능 → 상대가 남은 타일로 완성하면 상대 승.
 *
 * 판은 13×9로 유한(실물 테이블의 유한성 반영). 기차역은 중앙에 고정.
 */

export type PlayerId = 0 | 1;

export const W = 13;
export const H = 9;
export const TILES = 16;

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

// ---------- 순환선 판정 ----------

/**
 * 놓인 타일 전체가 하나의 순환선인가:
 * 모든 칸의 차수가 정확히 2, 전체 연결, 기차역은 좌우로 통과.
 */
export function isLoop(cells: Set<number>): boolean {
  if (cells.size < 4) return false;
  for (const c of cells) {
    let deg = 0;
    for (const n of neighbors4(c)) if (cells.has(n)) deg++;
    if (deg !== 2) return false;
  }
  // 기차역 좌우 통과: 역의 양 이웃이 가로여야 함
  for (const st of STATIONS) {
    if (!cells.has(st - 1) || !cells.has(st + 1)) return false;
  }
  // 연결성
  const seen = new Set<number>([STATIONS[0]]);
  const q = [STATIONS[0]];
  while (q.length) {
    const u = q.pop()!;
    for (const n of neighbors4(u)) {
      if (cells.has(n) && !seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen.size === cells.size;
}

/** 완성된 순환선의 사이클 순서 (렌더용). isLoop 전제. */
export function traceLoop(cells: Set<number>): number[] {
  const start = STATIONS[0];
  const order = [start];
  let prev = -1;
  let cur = start;
  do {
    let next = -1;
    for (const n of neighbors4(cur)) {
      if (cells.has(n) && n !== prev) {
        next = n;
        break;
      }
    }
    prev = cur;
    cur = next;
    if (cur !== start) order.push(cur);
  } while (cur !== start && order.length <= cells.size + 1);
  return order;
}

// ---------- 배치 ----------

/**
 * 가능한 라인 배치 전부 열거: 연속된 빈 칸 1~maxLen개의 일렬이며,
 * 그중 최소 한 칸이 기존 타일에 상하좌우로 맞닿아야 한다.
 */
export function legalLines(placed: Set<number>, maxLen: number): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>();
  const frontier = new Set<number>();
  for (const p of placed) for (const n of neighbors4(p)) if (!placed.has(n)) frontier.add(n);

  const push = (line: number[]) => {
    const key = [...line].sort((a, b) => a - b).join(',');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(line);
    }
  };

  for (const f of frontier) {
    push([f]);
    if (maxLen < 2) continue;
    const [r, c] = rc(f);
    // f를 포함하는 가로/세로 연속 빈칸 라인 (f가 어느 위치든 가능)
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
            if (placed.has(cell)) { ok = false; break; }
            line.push(cell);
          }
          if (ok) push(line);
        }
      }
    }
  }
  return out;
}

/** 라인 배치 유효성 (UI/엔진 공용) */
export function isValidLine(placed: Set<number>, line: number[], tilesLeft: number): boolean {
  if (line.length < 1 || line.length > 3 || line.length > tilesLeft) return false;
  const uniq = new Set(line);
  if (uniq.size !== line.length) return false;
  for (const cell of line) {
    if (cell < 0 || cell >= W * H || placed.has(cell)) return false;
  }
  if (line.length > 1) {
    const rows = line.map((c) => rc(c)[0]);
    const cols = line.map((c) => rc(c)[1]);
    const sameRow = rows.every((r) => r === rows[0]);
    const sameCol = cols.every((c) => c === cols[0]);
    if (!sameRow && !sameCol) return false;
    const axis = (sameRow ? cols : rows).slice().sort((a, b) => a - b);
    for (let i = 1; i < axis.length; i++) if (axis[i] !== axis[i - 1] + 1) return false;
  }
  // 최소 한 칸이 기존 타일에 맞닿아야 함
  return line.some((cell) => neighbors4(cell).some((n) => placed.has(n)));
}

// ---------- 상태 ----------

export interface LLState {
  placed: number[]; // 정렬된 칸 목록 (기차역 포함)
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
  return {
    placed: [...STATIONS].sort((a, b) => a - b),
    tilesLeft: TILES,
    turn: first,
    phase: 'play',
    attempter: null,
    lastMove: null,
    loop: null,
    result: null,
  };
}

export function placedSet(s: LLState): Set<number> {
  return new Set(s.placed);
}

/** 타일 라인 배치 (play/attempt 공용) */
export function applyPlace(s: LLState, line: number[]): LLState {
  if (s.phase !== 'play' && s.phase !== 'attempt') throw new Error('bad phase');
  const set = placedSet(s);
  if (!isValidLine(set, line, s.tilesLeft)) throw new Error('invalid line');
  for (const c of line) set.add(c);
  const placed = [...set].sort((a, b) => a - b);
  const tilesLeft = s.tilesLeft - line.length;
  const mover = s.phase === 'attempt' ? s.attempter! : s.turn;

  if (isLoop(set)) {
    return {
      ...s,
      placed,
      tilesLeft,
      lastMove: line,
      loop: traceLoop(set),
      phase: 'gameover',
      result: { winner: mover, reason: 'complete' },
    };
  }
  if (s.phase === 'attempt') {
    // 시도자는 남은 타일로 계속 놓는다. 타일 소진 시 실패 → 선언자 승.
    if (tilesLeft === 0) {
      return {
        ...s,
        placed,
        tilesLeft,
        lastMove: line,
        phase: 'gameover',
        result: { winner: (1 - s.attempter!) as PlayerId, reason: 'declare' },
      };
    }
    return { ...s, placed, tilesLeft, lastMove: line };
  }
  return { ...s, placed, tilesLeft, lastMove: line, turn: (1 - s.turn) as PlayerId };
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
