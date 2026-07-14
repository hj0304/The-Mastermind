/**
 * 밀림장기 (원작: 십이장기 / 원류: 동물장기) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §1):
 * - 3열 × 4행 12칸. 각자 맨 끝 행이 자기 진영(홈로우).
 * - 기물: 왕(8방향) / 장(상하좌우) / 상(대각 4방향) / 자(앞 1칸, 상대 진영 진입 시 후로 승격)
 *   후 = 대각 뒤 2방향을 제외한 6방향(금장).
 * - 잡은 기물은 포로 — 자기 턴에 빈 칸에 드롭 가능(턴 소모). 단 상대 진영에는 드롭 불가.
 *   후를 잡으면 자로 되돌려 사용.
 * - 승리: ① 상대 왕 포획 ② 자신의 왕이 상대 진영에 들어가 상대의 응수 후에도 생존
 *   (= 자기 턴이 다시 돌아온 시점에 왕이 상대 진영에 있으면 승리)
 * - 원작에는 무승부 규칙이 없으나, 무한 반복 방지를 위해 동일 국면 3회 반복 시 무승부 처리.
 */

export type PlayerId = 0 | 1;
/** K=왕, G=장, E=상, C=자, H=후 */
export type PieceType = 'K' | 'G' | 'E' | 'C' | 'H';

export interface Piece {
  type: PieceType;
  owner: PlayerId;
}

export const COLS = 3;
export const ROWS = 4;

/** cell index = row * COLS + col. row 0 = 플레이어0 진영(아래), row 3 = 플레이어1 진영(위) */
export const idx = (row: number, col: number) => row * COLS + col;

export type Move =
  | { kind: 'move'; from: number; to: number }
  | { kind: 'drop'; piece: PieceType; to: number };

export interface JResult {
  /** null = 무승부(반복) */
  winner: PlayerId | null;
  reason: 'capture' | 'territory' | 'repetition';
}

export interface JState {
  board: (Piece | null)[];
  /** 포로 (드롭 가능 기물) */
  hands: [PieceType[], PieceType[]];
  turn: PlayerId;
  /** 반복 감지용 국면 키 카운트 */
  repCounts: Record<string, number>;
  result: JResult | null;
  /** 직전 수 (UI 하이라이트용) */
  lastMove: Move | null;
}

export function homeRow(p: PlayerId): number {
  return p === 0 ? 0 : ROWS - 1;
}
export function enemyRow(p: PlayerId): number {
  return homeRow((1 - p) as PlayerId);
}
/** 전진 방향 (row 증가/감소) */
const forward = (p: PlayerId) => (p === 0 ? 1 : -1);

export function createGame(first: PlayerId): JState {
  const board: (Piece | null)[] = new Array(12).fill(null);
  // P0 (아래): 본인 시점 왼쪽=상, 중앙=왕, 오른쪽=장, 왕 앞=자
  board[idx(0, 0)] = { type: 'E', owner: 0 };
  board[idx(0, 1)] = { type: 'K', owner: 0 };
  board[idx(0, 2)] = { type: 'G', owner: 0 };
  board[idx(1, 1)] = { type: 'C', owner: 0 };
  // P1 (위): 180도 회전 배치
  board[idx(3, 2)] = { type: 'E', owner: 1 };
  board[idx(3, 1)] = { type: 'K', owner: 1 };
  board[idx(3, 0)] = { type: 'G', owner: 1 };
  board[idx(2, 1)] = { type: 'C', owner: 1 };

  const s: JState = {
    board,
    hands: [[], []],
    turn: first,
    repCounts: {},
    result: null,
    lastMove: null,
  };
  s.repCounts[positionKey(s)] = 1;
  return s;
}

export function positionKey(s: JState): string {
  const b = s.board.map((c) => (c ? c.type + c.owner : '.')).join('');
  const h0 = [...s.hands[0]].sort().join('');
  const h1 = [...s.hands[1]].sort().join('');
  return `${b}|${h0}|${h1}|${s.turn}`;
}

/** 기물별 이동 벡터 [dCol, dRow] (owner 기준) */
export function pieceVectors(type: PieceType, owner: PlayerId): Array<[number, number]> {
  const f = forward(owner);
  switch (type) {
    case 'K':
      return [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    case 'G':
      return [[0, 1], [0, -1], [1, 0], [-1, 0]];
    case 'E':
      return [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    case 'C':
      return [[0, f]];
    case 'H':
      // 금장: 전방 3방향 + 좌우 + 후방 (대각 뒤 제외)
      return [[0, f], [1, f], [-1, f], [1, 0], [-1, 0], [0, -f]];
  }
}

export function legalMoves(s: JState): Move[] {
  if (s.result) return [];
  const p = s.turn;
  const moves: Move[] = [];
  for (let cell = 0; cell < 12; cell++) {
    const piece = s.board[cell];
    if (!piece || piece.owner !== p) continue;
    const row = Math.floor(cell / COLS);
    const col = cell % COLS;
    for (const [dc, dr] of pieceVectors(piece.type, p)) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const target = s.board[idx(nr, nc)];
      if (target && target.owner === p) continue;
      moves.push({ kind: 'move', from: cell, to: idx(nr, nc) });
    }
  }
  // 드롭: 빈 칸, 단 상대 진영 행 제외
  const eRow = enemyRow(p);
  const uniqueHand = [...new Set(s.hands[p])];
  for (const piece of uniqueHand) {
    for (let cell = 0; cell < 12; cell++) {
      if (s.board[cell]) continue;
      if (Math.floor(cell / COLS) === eRow) continue;
      moves.push({ kind: 'drop', piece, to: cell });
    }
  }
  return moves;
}

export function applyMove(s: JState, m: Move): JState {
  if (s.result) throw new Error('game is over');
  const p = s.turn;
  const q = (1 - p) as PlayerId;
  const board = [...s.board];
  const hands: [PieceType[], PieceType[]] = [[...s.hands[0]], [...s.hands[1]]];
  let result: JResult | null = null;

  if (m.kind === 'move') {
    const piece = board[m.from];
    if (!piece || piece.owner !== p) throw new Error('illegal move: no own piece at from');
    const captured = board[m.to];
    if (captured) {
      if (captured.owner === p) throw new Error('illegal move: own piece at to');
      if (captured.type === 'K') {
        result = { winner: p, reason: 'capture' };
      } else {
        hands[p].push(captured.type === 'H' ? 'C' : captured.type);
      }
    }
    let type = piece.type;
    // 자 승격: 상대 진영 행 진입 시 후로
    if (type === 'C' && Math.floor(m.to / COLS) === enemyRow(p)) type = 'H';
    board[m.from] = null;
    board[m.to] = { type, owner: p };
  } else {
    const i = hands[p].indexOf(m.piece);
    if (i < 0) throw new Error('illegal drop: piece not in hand');
    if (board[m.to]) throw new Error('illegal drop: cell occupied');
    if (Math.floor(m.to / COLS) === enemyRow(p)) throw new Error('illegal drop: enemy territory');
    hands[p].splice(i, 1);
    board[m.to] = { type: m.piece, owner: p };
  }

  const next: JState = {
    board,
    hands,
    turn: q,
    repCounts: s.repCounts,
    result,
    lastMove: m,
  };

  if (!next.result) {
    // 진영 승리: 이제 q의 턴 — q의 왕이 상대 진영에서 생존해 있다면 q 승리
    const kCell = board.findIndex((c) => c?.type === 'K' && c.owner === q);
    if (kCell >= 0 && Math.floor(kCell / COLS) === enemyRow(q)) {
      next.result = { winner: q, reason: 'territory' };
    }
  }

  if (!next.result) {
    // 반복 무승부
    const key = positionKey(next);
    const repCounts = { ...s.repCounts, [key]: (s.repCounts[key] ?? 0) + 1 };
    next.repCounts = repCounts;
    if (repCounts[key] >= 3) {
      next.result = { winner: null, reason: 'repetition' };
    }
  }

  return next;
}
