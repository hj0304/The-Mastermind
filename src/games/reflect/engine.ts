/**
 * 리플렉트 (원작: 레이저 장기 / 원류: Khet) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §6):
 * - 기물: 레이저(이동 불가·회전만, 턴 종료 시 자동 발사, 파괴 불가),
 *   왕(어느 면이든 피격 시 즉시 패배), 세모기사 ×5(거울 1면 반사, 비거울면 피격 시 제거),
 *   네모기사 ×2(거울 1면이 정면 반사 — 동일 원리의 사각 기물), 스플리터(투과+반사 2갈래, 파괴 불가).
 * - 턴: 자기 기물 1개를 8방향 1칸 이동(빈 칸으로만) 또는 90° 회전(레이저는 회전만,
 *   판 바깥 방향 불가). 턴 종료 시 자기 레이저 자동 발사 → 비거울면 피격 기물은 피아 불문 제거.
 * - 승리: 상대 왕 피격. 자기 왕을 맞히면 즉시 패배(자살수 포함).
 * - 초기 배치는 자체 밸런싱한 오리지널 배치 (9×7, 180° 회전 대칭, 초기 발사는 무피해).
 * - (안전장치) 동일 국면 3회 반복 또는 300수 경과 시 무승부.
 *
 * 방향: 0=N, 1=E, 2=S, 3=W. 세모기사 방향 d = 직각 꼭짓점 위치(0=NE,1=SE,2=SW,3=NW),
 * 빗변이 거울. 네모기사 방향 d = 거울 면. 스플리터 d%2: 0='/', 1='\'.
 */

export type PlayerId = 0 | 1;
export type PieceType = 'laser' | 'king' | 'tri' | 'sq' | 'split';
export type Dir = 0 | 1 | 2 | 3;

export interface Piece {
  type: PieceType;
  owner: PlayerId;
  dir: Dir;
}

export type Move =
  | { kind: 'move'; from: number; to: number }
  | { kind: 'rot'; from: number; to: Dir };

export interface FireResult {
  /** 빔 폴리라인(칸 좌표 [r,c] 목록) — 스플리터 분기마다 별도 라인 */
  beams: [number, number][][];
  /** 제거된 기물 위치 목록 */
  destroyed: { cell: number; piece: Piece }[];
  /** 피격된 왕의 소유자들 */
  kingsHit: PlayerId[];
}

export interface RfState {
  board: (Piece | null)[];
  turn: PlayerId;
  ply: number;
  lastMove: Move | null;
  lastFire: FireResult | null;
  repCount: Record<string, number>;
  result: { winner: PlayerId | null } | null;
}

export const ROWS = 7;
export const COLS = 9;
export const idx = (r: number, c: number) => r * COLS + c;
export const rowOf = (i: number) => Math.floor(i / COLS);
export const colOf = (i: number) => i % COLS;

const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];

/** 세모기사 반사표: TRI_REFLECT[기물방향][입사방향] = 반사방향 (undefined면 비거울면 피격) */
const TRI_REFLECT: Record<number, Partial<Record<number, Dir>>> = {
  0: { 2: 1, 3: 0 }, // NE: 남진→동, 서진→북
  1: { 0: 1, 3: 2 }, // SE: 북진→동, 서진→남
  2: { 0: 3, 1: 2 }, // SW: 북진→서, 동진→남
  3: { 2: 3, 1: 0 }, // NW: 남진→서, 동진→북
};

/** 스플리터 반사표 (투과 빔은 별도): '/'=[N→E,E→N,S→W,W→S], '\'=[N→W,E→S,S→E,W→N] */
const SPLIT_REFLECT: [Dir[], Dir[]] = [
  [1, 0, 3, 2],
  [3, 2, 1, 0],
];

// ---------- 초기 배치 ----------

/** P0(아래) 기물 배치 — P1은 180° 회전 대칭 */
const P0_LAYOUT: { r: number; c: number; type: PieceType; dir: Dir }[] = [
  { r: 6, c: 8, type: 'laser', dir: 0 },
  { r: 6, c: 4, type: 'king', dir: 0 },
  { r: 6, c: 3, type: 'sq', dir: 0 },
  { r: 6, c: 5, type: 'sq', dir: 0 },
  { r: 6, c: 1, type: 'tri', dir: 0 },
  { r: 5, c: 4, type: 'tri', dir: 0 },
  { r: 4, c: 2, type: 'tri', dir: 1 },
  { r: 4, c: 6, type: 'tri', dir: 3 },
  { r: 5, c: 7, type: 'tri', dir: 3 },
  { r: 3, c: 3, type: 'split', dir: 0 },
];

export function createGame(firstTurn: PlayerId): RfState {
  const board: (Piece | null)[] = new Array(ROWS * COLS).fill(null);
  for (const p of P0_LAYOUT) {
    board[idx(p.r, p.c)] = { type: p.type, owner: 0, dir: p.dir };
    board[idx(ROWS - 1 - p.r, COLS - 1 - p.c)] = {
      type: p.type,
      owner: 1,
      dir: ((p.dir + 2) % 4) as Dir,
    };
  }
  const s: RfState = {
    board,
    turn: firstTurn,
    ply: 0,
    lastMove: null,
    lastFire: null,
    repCount: {},
    result: null,
  };
  s.repCount[positionKey(s)] = 1;
  return s;
}

export function positionKey(s: RfState): string {
  let key = String(s.turn);
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (p) key += `${i}:${p.type[0]}${p.owner}${p.dir},`;
  }
  return key;
}

// ---------- 기물 위치 조회 ----------

export function findPiece(s: RfState, owner: PlayerId, type: PieceType): number {
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (p && p.owner === owner && p.type === type) return i;
  }
  return -1;
}

/** 레이저가 향할 수 있는 방향 (판 바깥 방향 불가) */
export function laserDirs(cell: number): Dir[] {
  const r = rowOf(cell);
  const c = colOf(cell);
  const dirs: Dir[] = [];
  if (r > 0) dirs.push(0);
  if (c < COLS - 1) dirs.push(1);
  if (r < ROWS - 1) dirs.push(2);
  if (c > 0) dirs.push(3);
  return dirs;
}

// ---------- 수 생성 ----------

export function legalMoves(s: RfState): Move[] {
  if (s.result) return [];
  const moves: Move[] = [];
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (!p || p.owner !== s.turn) continue;
    const r = rowOf(i);
    const c = colOf(i);

    if (p.type !== 'laser') {
      // 8방향 1칸 이동 (빈 칸만)
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          const to = idx(nr, nc);
          if (s.board[to] === null) moves.push({ kind: 'move', from: i, to });
        }
      }
    }

    // 회전
    if (p.type === 'laser') {
      for (const d of laserDirs(i)) if (d !== p.dir) moves.push({ kind: 'rot', from: i, to: d });
    } else if (p.type === 'tri' || p.type === 'sq') {
      moves.push({ kind: 'rot', from: i, to: ((p.dir + 1) % 4) as Dir });
      moves.push({ kind: 'rot', from: i, to: ((p.dir + 3) % 4) as Dir });
    } else if (p.type === 'split') {
      moves.push({ kind: 'rot', from: i, to: ((p.dir + 1) % 4) as Dir });
    }
    // king은 이동만
  }
  return moves;
}

// ---------- 레이저 발사 ----------

/**
 * board 위에서 p의 레이저를 추적. 기물 제거는 하지 않고 결과만 반환.
 * 추적 중 판은 정적(동시 발사 취급) — 스플리터로 같은 기물에 두 빔이 닿아도 1회 제거.
 */
export function traceLaser(board: (Piece | null)[], owner: PlayerId): FireResult {
  let laserCell = -1;
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (p && p.owner === owner && p.type === 'laser') {
      laserCell = i;
      break;
    }
  }
  const result: FireResult = { beams: [], destroyed: [], kingsHit: [] };
  if (laserCell < 0) return result;

  const destroyedSet = new Set<number>();
  const visited = new Set<string>();
  // 분기 큐: 시작 칸(폴리라인 시작점)과 진행 방향
  const queue: { r: number; c: number; dir: Dir }[] = [
    { r: rowOf(laserCell), c: colOf(laserCell), dir: board[laserCell]!.dir },
  ];

  while (queue.length > 0) {
    const start = queue.shift()!;
    const vkey = `${start.r},${start.c},${start.dir}`;
    if (visited.has(vkey)) continue;
    visited.add(vkey);

    const line: [number, number][] = [[start.r, start.c]];
    let r = start.r;
    let c = start.c;
    let dir = start.dir;

    for (;;) {
      r += DR[dir];
      c += DC[dir];
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) {
        line.push([r, c]); // 판 밖으로 나가는 표시점
        break;
      }
      const cell = idx(r, c);
      const p = board[cell];
      if (!p) continue;

      if (p.type === 'laser') {
        line.push([r, c]);
        break; // 파괴 불가, 빔 정지
      }
      if (p.type === 'king') {
        line.push([r, c]);
        if (!result.kingsHit.includes(p.owner)) result.kingsHit.push(p.owner);
        break;
      }
      if (p.type === 'split') {
        line.push([r, c]);
        // 반사 분기 + 투과 분기 (현재 라인은 여기서 끊고 둘 다 큐에)
        queue.push({ r, c, dir: SPLIT_REFLECT[p.dir % 2][dir] });
        queue.push({ r, c, dir });
        break;
      }
      if (p.type === 'tri') {
        const out = TRI_REFLECT[p.dir][dir];
        if (out === undefined) {
          line.push([r, c]);
          if (!destroyedSet.has(cell)) {
            destroyedSet.add(cell);
            result.destroyed.push({ cell, piece: p });
          }
          break;
        }
        line.push([r, c]);
        dir = out;
        const key = `${r},${c},${dir}`;
        if (visited.has(key)) break;
        visited.add(key);
        continue;
      }
      // sq: 거울 면 d 정면(입사방향 = d+2)만 반사(왔던 길 반사)
      if (dir === (p.dir + 2) % 4) {
        line.push([r, c]);
        dir = p.dir;
        const key = `${r},${c},${dir}`;
        if (visited.has(key)) break;
        visited.add(key);
        continue;
      }
      line.push([r, c]);
      if (!destroyedSet.has(cell)) {
        destroyedSet.add(cell);
        result.destroyed.push({ cell, piece: p });
      }
      break;
    }
    result.beams.push(line);
  }
  return result;
}

// ---------- 수 적용 ----------

export function applyMove(s: RfState, m: Move): RfState {
  if (s.result) throw new Error('game over');
  const p = s.board[m.from];
  if (!p || p.owner !== s.turn) throw new Error('illegal move: no own piece');
  if (m.kind === 'move') {
    if (p.type === 'laser') throw new Error('laser cannot move');
    if (s.board[m.to] !== null) throw new Error('cell occupied');
    const r1 = rowOf(m.from);
    const c1 = colOf(m.from);
    const r2 = rowOf(m.to);
    const c2 = colOf(m.to);
    if (Math.abs(r1 - r2) > 1 || Math.abs(c1 - c2) > 1 || m.from === m.to)
      throw new Error('illegal step');
  } else {
    if (p.type === 'king') throw new Error('king cannot rotate');
    if (p.type === 'laser' && !laserDirs(m.from).includes(m.to))
      throw new Error('laser cannot face off-board');
  }

  const next = applyMoveLite(s, m);
  if (next.result) return next;

  // 무승부 안전장치 (반복 3회) — 탐색용 lite 경로에서는 생략됨
  const key = positionKey(next);
  const count = (s.repCount[key] ?? 0) + 1;
  next.repCount = { ...s.repCount, [key]: count };
  if (count >= 3) return { ...next, result: { winner: null } };
  return next;
}

/**
 * 검증·반복국면 추적을 생략한 경량 적용 — AI 탐색 전용.
 * legalMoves()로 생성된 수에만 사용할 것.
 */
export function applyMoveLite(s: RfState, m: Move): RfState {
  const p = s.board[m.from]!;
  const board = [...s.board];
  if (m.kind === 'move') {
    board[m.to] = p;
    board[m.from] = null;
  } else {
    board[m.from] = { ...p, dir: m.to };
  }

  // 턴 종료: 내 레이저 발사
  const fire = traceLaser(board, s.turn);
  for (const d of fire.destroyed) board[d.cell] = null;

  const next: RfState = {
    board,
    turn: (1 - s.turn) as PlayerId,
    ply: s.ply + 1,
    lastMove: m,
    lastFire: fire,
    repCount: s.repCount,
    result: null,
  };

  // 왕 피격 판정: 자기 왕을 맞히면 (동시 피격 포함) 발사자 패배
  if (fire.kingsHit.length > 0) {
    const winner: PlayerId = fire.kingsHit.includes(s.turn)
      ? ((1 - s.turn) as PlayerId)
      : s.turn;
    return { ...next, result: { winner } };
  }
  if (next.ply >= 300) return { ...next, result: { winner: null } };
  return next;
}
