/**
 * 수(數)의 진 (원작: 숫자장기 / 모티브: 스트라테고) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §13):
 * - 6열 × 9행 = 54칸. 각자 가까운 3행이 자기 진영. 기물 14개(숫자 1~10, 지뢰 3, 왕 1)를
 *   자기 진영에 자유 배치, 상대에게는 뒷면(비공개).
 * - 이동: 좌우 1칸, 전방 대각 1칸, 앞으로 1~2칸(점프 불가). 뒤로는 어떤 방향으로도 불가.
 *   지뢰는 이동 불가. 이미 기물이 있는 칸으로는 이동 불가(밟아서 잡는 방식이 아님).
 * - 대결: 이동 후 이동한 기물이 상하좌우로 적 기물과 맞닿으면 즉시 대결.
 *   여러 기물과 맞닿으면 동시 대결 — 제거 조건이 하나라도 충족된 기물은 모두 제거.
 *   · 두 숫자의 합이 10 이상 → 큰 수 승리 / 10 미만 → 작은 수 승리 / 같으면 둘 다 제거
 *   · 두 칸 사이에 마이너스 표식이 있으면 차 대결 → 작은 수 승리 (같으면 둘 다 제거)
 *   · 지뢰: 대결한 기물과 함께 자폭
 *   · 왕: 대결 즉시 제거 = 상대 승리 (왕끼리는 아무 일 없음)
 * - 숫자 기물이 상대 진영 맨 끝줄 도달 시: 그 기물을 제거하고 죽은 기물 하나를
 *   공개 상태로 자기 맨 끝줄에 부활시킬 수 있다(선택).
 * - 승리: ① 상대 왕과의 대결(왕 제거) ② 상대의 왕 제외 전멸 ③ 자신의 왕이 상대 끝줄 도달
 * - 원작의 아이템(+1/-1/BLIND)과 턴 시간제한은 이 버전에서 제외.
 * - 교착 방지: 300수 초과 시 무승부 처리 (원작에 없는 안전장치).
 */

export type PlayerId = 0 | 1;
/** 1~10 = 숫자, 'K' = 왕, 'M' = 지뢰 */
export type NType = number | 'K' | 'M';

export interface NPiece {
  id: number;
  type: NType;
  owner: PlayerId;
  /** 대결·부활로 정체가 공개됐는가 */
  revealed: boolean;
  /** 한 번이라도 움직였는가 (지뢰 추론 단서) */
  hasMoved: boolean;
}

export const N_COLS = 6;
export const N_ROWS = 9;
export const cellIdx = (row: number, col: number) => row * N_COLS + col;

export type NMove = { from: number; to: number };

export interface NResult {
  winner: PlayerId | null;
  reason: 'king' | 'annihilation' | 'throne' | 'stalemate';
}

export interface NState {
  board: (NPiece | null)[];
  dead: [NPiece[], NPiece[]];
  turn: PlayerId;
  result: NResult | null;
  lastMove: NMove | null;
  /** 방금 끝줄에 도달해 부활 선택 대기 중인 상태 (해당 기물은 이미 제거됨) */
  pendingRevive: PlayerId | null;
  /** 부활 대상에서 제외할 기물 id (방금 희생된 기물 자신) */
  pendingReviveExclude: number | null;
  plies: number;
  /** 직전 대결 로그 (UI 연출용): [내용] */
  lastBattles: Array<{ a: NPiece; b: NPiece; minus: boolean; removedIds: number[] }>;
}

export function homeRow(p: PlayerId): number {
  return p === 0 ? 0 : N_ROWS - 1;
}
export function enemyBackRow(p: PlayerId): number {
  return homeRow((1 - p) as PlayerId);
}
const forward = (p: PlayerId) => (p === 0 ? 1 : -1);

/** 자기 진영 행 목록 (배치 가능 구역) */
export function territoryRows(p: PlayerId): number[] {
  return p === 0 ? [0, 1, 2] : [6, 7, 8];
}

// ---------- 마이너스 표식 (칸 사이 경계선 18개, 180도 회전 대칭) ----------

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

const MINUS_EDGES = new Set<string>();
{
  const V = (row: number, colLeft: number) =>
    MINUS_EDGES.add(edgeKey(cellIdx(row, colLeft), cellIdx(row, colLeft + 1)));
  const H = (rowLow: number, col: number) =>
    MINUS_EDGES.add(edgeKey(cellIdx(rowLow, col), cellIdx(rowLow + 1, col)));
  // 세로 경계(좌우 인접 칸 사이): 중앙 지대에 집중
  V(3, 1); V(4, 1); V(5, 1);
  V(3, 3); V(4, 3); V(5, 3);
  V(2, 2); V(6, 2);
  // 가로 경계(상하 인접 칸 사이)
  H(3, 1); H(4, 1); H(3, 4); H(4, 4);
  H(2, 2); H(5, 2); H(2, 3); H(5, 3);
  H(3, 0); H(4, 5);
}

export function isMinusEdge(a: number, b: number): boolean {
  return MINUS_EDGES.has(edgeKey(a, b));
}

/** UI 렌더용 전체 마이너스 경계 목록 */
export function minusEdges(): Array<[number, number]> {
  return [...MINUS_EDGES].map((k) => k.split('-').map(Number) as [number, number]);
}

// ---------- 배치 ----------

export const FULL_SET: NType[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'M', 'M', 'M', 'K'];

/** 휴리스틱 랜덤 배치: 지뢰 분산, 왕은 뒷줄, 9/10 사이드, 1/2 중앙 성향 */
export function randomPlacement(p: PlayerId, idStart: number): Array<{ cell: number; piece: NPiece }> {
  const rows = territoryRows(p);
  const back = rows[p === 0 ? 0 : 2];
  const mid = rows[1];
  const front = rows[p === 0 ? 2 : 0];
  const cells = (row: number) => Array.from({ length: N_COLS }, (_, c) => cellIdx(row, c));
  const shuffle = <T,>(arr: T[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const placement = new Map<number, NType>();
  const backCells = shuffle(cells(back));
  const midCells = shuffle(cells(mid));
  const frontCells = shuffle(cells(front));

  // 왕: 뒷줄 중앙 4칸 중 하나
  const kingCell = shuffle(cells(back).filter((c) => { const col = c % N_COLS; return col >= 1 && col <= 4; }))[0];
  placement.set(kingCell, 'K');

  // 지뢰 3: 뒷줄/중간줄에 분산
  const mineCandidates = shuffle([...backCells, ...midCells].filter((c) => !placement.has(c)));
  for (let i = 0; i < 3; i++) placement.set(mineCandidates[i], 'M');

  // 9, 10: 사이드 선호 (합 대결 강자)
  const sides = shuffle([...frontCells, ...midCells].filter((c) => !placement.has(c) && (c % N_COLS === 0 || c % N_COLS === 5)));
  const numbers = shuffle([9, 10]);
  for (const n of numbers) {
    const cell = sides.pop();
    if (cell !== undefined) placement.set(cell, n);
  }

  // 나머지 숫자 무작위
  const remainingTypes = shuffle(FULL_SET.filter((t) => {
    const used = [...placement.values()];
    const cnt = used.filter((u) => u === t).length;
    const total = FULL_SET.filter((f) => f === t).length;
    return cnt < total;
  }));
  const remainingCells = shuffle([...backCells, ...midCells, ...frontCells].filter((c) => !placement.has(c)));
  for (const t of remainingTypes) {
    const cell = remainingCells.pop();
    if (cell !== undefined) placement.set(cell, t);
  }

  let id = idStart;
  return [...placement.entries()].map(([cell, type]) => ({
    cell,
    piece: { id: id++, type, owner: p, revealed: false, hasMoved: false },
  }));
}

export function createGame(
  myPlacement: Array<{ cell: number; piece: NPiece }>,
  aiPlacement: Array<{ cell: number; piece: NPiece }>,
  first: PlayerId,
): NState {
  const board: (NPiece | null)[] = new Array(54).fill(null);
  for (const { cell, piece } of [...myPlacement, ...aiPlacement]) board[cell] = piece;
  return {
    board,
    dead: [[], []],
    turn: first,
    result: null,
    lastMove: null,
    pendingRevive: null,
    pendingReviveExclude: null,
    plies: 0,
    lastBattles: [],
  };
}

// ---------- 이동 ----------

export function pieceMoves(s: NState, cell: number): number[] {
  return movesOnBoard(s.board, cell);
}

/** 보드 배열만으로 이동 가능 칸 계산 (AI의 가상 보드 평가용) */
export function movesOnBoard(board: (NPiece | null)[], cell: number): number[] {
  const piece = board[cell];
  if (!piece || piece.type === 'M') return [];
  const row = Math.floor(cell / N_COLS);
  const col = cell % N_COLS;
  const f = forward(piece.owner);
  const out: number[] = [];
  const tryCell = (r: number, c: number) => {
    if (r < 0 || r >= N_ROWS || c < 0 || c >= N_COLS) return false;
    const t = cellIdx(r, c);
    if (board[t]) return false;
    out.push(t);
    return true;
  };
  tryCell(row, col - 1);
  tryCell(row, col + 1);
  tryCell(row + f, col - 1);
  tryCell(row + f, col + 1);
  const oneAhead = tryCell(row + f, col);
  if (oneAhead) tryCell(row + 2 * f, col); // 1칸 앞이 비어야 2칸 전진 가능
  return out;
}

export function legalMoves(s: NState): NMove[] {
  if (s.result || s.pendingRevive !== null) return [];
  const moves: NMove[] = [];
  for (let cell = 0; cell < 54; cell++) {
    const piece = s.board[cell];
    if (!piece || piece.owner !== s.turn) continue;
    for (const to of pieceMoves(s, cell)) moves.push({ from: cell, to });
  }
  return moves;
}

/** 대결 판정: [mover 제거?, other 제거?, 즉시 승자(왕 대결)] */
export function battleOutcome(
  mover: NPiece,
  other: NPiece,
  minus: boolean,
): { removeMover: boolean; removeOther: boolean; instantWinner: PlayerId | null } {
  if (mover.type === 'K' && other.type === 'K') {
    return { removeMover: false, removeOther: false, instantWinner: null };
  }
  if (other.type === 'K') return { removeMover: false, removeOther: true, instantWinner: mover.owner };
  if (mover.type === 'K') return { removeMover: true, removeOther: false, instantWinner: other.owner };
  if (mover.type === 'M' || other.type === 'M') {
    return { removeMover: true, removeOther: true, instantWinner: null };
  }
  const a = mover.type as number;
  const b = other.type as number;
  if (a === b) return { removeMover: true, removeOther: true, instantWinner: null };
  let moverWins: boolean;
  if (minus) {
    moverWins = a < b; // 차 대결: 작은 수 승리
  } else {
    moverWins = a + b >= 10 ? a > b : a < b;
  }
  return { removeMover: !moverWins, removeOther: moverWins, instantWinner: null };
}

export function applyMove(s: NState, m: NMove): NState {
  if (s.result) throw new Error('game over');
  if (s.pendingRevive !== null) throw new Error('revive pending');
  const p = s.turn;
  const board = [...s.board];
  const mover = board[m.from];
  if (!mover || mover.owner !== p) throw new Error('illegal move');
  board[m.from] = null;
  const movedPiece: NPiece = { ...mover, hasMoved: true };
  board[m.to] = movedPiece;

  const dead: [NPiece[], NPiece[]] = [[...s.dead[0]], [...s.dead[1]]];
  const battles: NState['lastBattles'] = [];
  let result: NResult | null = null;

  // 대결: 이동한 기물과 상하좌우로 맞닿은 적 기물 전부, 동시 판정
  const row = Math.floor(m.to / N_COLS);
  const col = m.to % N_COLS;
  const adj: number[] = [];
  if (row > 0) adj.push(cellIdx(row - 1, col));
  if (row < N_ROWS - 1) adj.push(cellIdx(row + 1, col));
  if (col > 0) adj.push(cellIdx(row, col - 1));
  if (col < N_COLS - 1) adj.push(cellIdx(row, col + 1));

  let removeMover = false;
  const removeCells: number[] = [];
  for (const c of adj) {
    const other = board[c];
    if (!other || other.owner === p) continue;
    const minus = isMinusEdge(m.to, c);
    const o = battleOutcome(movedPiece, other, minus);
    // 대결한 기물은 모두 공개
    movedPiece.revealed = true;
    board[c] = { ...other, revealed: true };
    battles.push({
      a: movedPiece,
      b: board[c]!,
      minus,
      removedIds: [
        ...(o.removeMover ? [movedPiece.id] : []),
        ...(o.removeOther ? [board[c]!.id] : []),
      ],
    });
    if (o.instantWinner !== null && !result) {
      result = { winner: o.instantWinner, reason: 'king' };
    }
    if (o.removeMover) removeMover = true;
    if (o.removeOther) removeCells.push(c);
  }
  for (const c of removeCells) {
    const piece = board[c]!;
    dead[piece.owner].push(piece);
    board[c] = null;
  }
  if (removeMover) {
    dead[p].push(movedPiece);
    board[m.to] = null;
  }

  const next: NState = {
    board,
    dead,
    turn: (1 - p) as PlayerId,
    result,
    lastMove: m,
    pendingRevive: null,
    pendingReviveExclude: null,
    plies: s.plies + 1,
    lastBattles: battles,
  };

  if (!next.result) {
    // 왕 끝줄 도달 승리 / 숫자 기물 끝줄 도달 → 부활 선택
    const survived = board[m.to];
    if (survived && Math.floor(m.to / N_COLS) === enemyBackRow(p)) {
      if (survived.type === 'K') {
        next.result = { winner: p, reason: 'throne' };
      } else if (survived.type !== 'M') {
        // 기물 제거 후 부활 선택 대기 (자신 외에 죽은 기물이 없으면 그냥 제거만)
        // 제거되는 기물은 정체가 공개된다
        dead[p].push({ ...survived, revealed: true });
        board[m.to] = null;
        if (dead[p].length > 1) {
          next.pendingRevive = p;
          next.pendingReviveExclude = survived.id; // 방금 희생된 기물은 부활 불가
          next.turn = p; // 부활 선택은 같은 플레이어가 진행 (턴 넘기기 전)
        }
      }
    }
  }

  if (!next.result) {
    // 왕 제외 전멸 체크
    for (const q of [0, 1] as PlayerId[]) {
      const alive = board.filter((c) => c && c.owner === q && c.type !== 'K');
      if (alive.length === 0) {
        next.result = { winner: (1 - q) as PlayerId, reason: 'annihilation' };
      }
    }
  }

  if (!next.result && next.plies >= 300) {
    next.result = { winner: null, reason: 'stalemate' };
  }

  return next;
}

/** 부활 가능한 죽은 기물 목록 (방금 희생된 기물 제외) */
export function reviveOptions(s: NState): NPiece[] {
  if (s.pendingRevive === null) return [];
  return s.dead[s.pendingRevive].filter((d) => d.id !== s.pendingReviveExclude);
}

/**
 * 부활 처리. pieceId=null이면 부활 포기.
 * 부활 기물은 공개 상태로 자기 맨 끝줄의 빈 칸(지정)에 배치된다.
 */
export function resolveRevive(s: NState, pieceId: number | null, cell: number | null): NState {
  if (s.pendingRevive === null) throw new Error('no revive pending');
  const p = s.pendingRevive;
  const board = [...s.board];
  const dead: [NPiece[], NPiece[]] = [[...s.dead[0]], [...s.dead[1]]];

  if (pieceId !== null && cell !== null) {
    const i = dead[p].findIndex((d) => d.id === pieceId);
    if (i < 0) throw new Error('piece not dead');
    if (board[cell] || Math.floor(cell / N_COLS) !== homeRow(p)) throw new Error('bad revive cell');
    const piece = dead[p][i];
    dead[p].splice(i, 1);
    board[cell] = { ...piece, revealed: true, hasMoved: true };
  }

  return {
    ...s,
    board,
    dead,
    pendingRevive: null,
    pendingReviveExclude: null,
    turn: (1 - p) as PlayerId,
  };
}

/** 자기 끝줄의 빈 칸 목록 (부활 배치 후보) */
export function reviveCells(s: NState, p: PlayerId): number[] {
  const row = homeRow(p);
  const out: number[] = [];
  for (let c = 0; c < N_COLS; c++) {
    const cell = cellIdx(row, c);
    if (!s.board[cell]) out.push(cell);
  }
  return out;
}
