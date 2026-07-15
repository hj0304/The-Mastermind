/**
 * 윷 대전 (원작: 전략 윷놀이) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §4, 2인 변형):
 * - 윷을 던지지 않는다. 매 던지기마다 두 플레이어가 각자 윷가락 2개의 앞/뒤를
 *   **비밀 동시 선택** → 앞면 총수로 결과 결정: 0=모(5칸), 1=도, 2=개, 3=걸, 4=윷.
 * - **모든 도는 뒷도(1칸 후진)** 로 간주한다 (원작 룰).
 * - **뒷도로 출발점 진입도 한 바퀴로 인정** — 1번 칸에서 뒷도를 받으면 완주(원작 룰).
 * - 결과는 현재 차례(무버)의 말에 적용. 말은 각자 2개, 둘 다 완주하면 승리.
 * - 전통 윷판: 모서리(5·10)나 중앙(22)에 정확히 서면 다음 이동에서 지름길 선택 가능.
 *   완주는 출발점(0) 도달/통과 즉시 인정.
 * - 상대 말을 잡으면 그 말은 출발 전으로, 잡거나 윷/모가 나오면 한 번 더.
 * - 같은 칸의 내 말은 업힌다(함께 이동, 함께 잡힘). 잡을 말이 없는 뒷도는 차례 넘김.
 * - (안전장치) 500번째 던지기 이후 무승부.
 *
 * 판 노드: 0=출발/도착, 1~19 외곽 반시계, 지름길 5→20→21→22(중앙)→23→24→15,
 * 10→25→26→22→27→28→0. 중앙(22)에서 출발 시 27(출구) 또는 23(횡단) 선택.
 */

export type PlayerId = 0 | 1;

export const HOME = -1;
export const GOAL = 99;

export interface YPiece {
  pos: number; // HOME | 0~28 | GOAL
  cameFrom: number | null; // 뒷도용 직전 칸
}

export interface ThrowInfo {
  picks: [number, number]; // [p0 앞면 수, p1 앞면 수] (0~2)
  steps: number; // -1(뒷도) | 2 | 3 | 4 | 5
  mover: PlayerId;
  passed: boolean; // 움직일 말이 없어 차례를 넘김
}

export interface MoveOption {
  from: number; // HOME 또는 노드
  branch: 0 | 1; // 분기점 출발 시 1=지름길(5,10) / 1=횡단(22)
  dest: number; // 노드 또는 GOAL
  destCameFrom: number | null;
  catches: boolean;
  stacks: boolean;
}

export interface YState {
  pieces: [YPiece[], YPiece[]];
  turn: PlayerId;
  phase: 'choose' | 'move';
  pendingSteps: number | null;
  lastThrow: ThrowInfo | null;
  lastMoveDest: number | null;
  throwCount: number;
  result: { winner: PlayerId | null } | null;
}

export const STEP_NAME: Record<number, string> = {
  [-1]: '뒷도',
  2: '개',
  3: '걸',
  4: '윷',
  5: '모',
};

const NEXT: Record<number, number> = {
  0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10,
  10: 11, 11: 12, 12: 13, 13: 14, 14: 15, 15: 16, 16: 17, 17: 18, 18: 19, 19: 0,
  20: 21, 21: 22, 23: 24, 24: 15, 25: 26, 26: 22, 27: 28, 28: 0,
};

const PREV: Record<number, number> = {
  1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9,
  11: 10, 12: 11, 13: 12, 14: 13, 15: 14, 16: 15, 17: 16, 18: 17, 19: 18,
  20: 5, 21: 20, 22: 21, 23: 22, 24: 23, 25: 10, 26: 25, 27: 22, 28: 27,
};

/** 분기 가능 노드 (그 칸에서 이동을 시작할 때만) */
export const JUNCTIONS = new Set([5, 10, 22]);

export function createGame(firstTurn: PlayerId): YState {
  return {
    pieces: [
      [{ pos: HOME, cameFrom: null }, { pos: HOME, cameFrom: null }],
      [{ pos: HOME, cameFrom: null }, { pos: HOME, cameFrom: null }],
    ],
    turn: firstTurn,
    phase: 'choose',
    pendingSteps: null,
    lastThrow: null,
    lastMoveDest: null,
    throwCount: 0,
    result: null,
  };
}

export function totalToSteps(total: number): number {
  return [5, -1, 2, 3, 4][total];
}

function nextNode(cur: number, cameFrom: number | null, firstStepBranch: 0 | 1 | null): number {
  if (cur === 5 && firstStepBranch !== null) return firstStepBranch === 1 ? 20 : 6;
  if (cur === 10 && firstStepBranch !== null) return firstStepBranch === 1 ? 25 : 11;
  if (cur === 22) {
    if (firstStepBranch !== null) return firstStepBranch === 1 ? 23 : 27;
    return cameFrom === 26 ? 27 : 23; // 통과: 들어온 방향의 직진
  }
  return NEXT[cur];
}

/** from에서 m(≥2)칸 전진한 결과. from=HOME이면 0에서 출발 */
export function walkForward(
  from: number,
  m: number,
  branch: 0 | 1,
): { dest: number; cameFrom: number | null } {
  let cur = from === HOME ? 0 : from;
  let prev: number | null = null;
  for (let k = 0; k < m; k++) {
    const nxt = nextNode(cur, prev, k === 0 && from !== HOME ? branch : null);
    if (nxt === 0) return { dest: GOAL, cameFrom: null }; // 출발점 도달 = 완주
    prev = cur;
    cur = nxt;
  }
  return { dest: cur, cameFrom: prev };
}

export function moveOptions(s: YState): MoveOption[] {
  if (s.phase !== 'move' || s.pendingSteps === null) return [];
  const m = s.pendingSteps;
  const mover = s.turn;
  const opp = (1 - mover) as PlayerId;
  const opts: MoveOption[] = [];
  const seenFrom = new Set<string>();

  for (const piece of s.pieces[mover]) {
    if (piece.pos === GOAL) continue;
    if (m === -1) {
      if (piece.pos === HOME) continue;
      const key = `b${piece.pos}`;
      if (seenFrom.has(key)) continue;
      seenFrom.add(key);
      const back = piece.cameFrom ?? PREV[piece.pos];
      const dest = back === 0 ? GOAL : back; // 뒷도 출발점 진입 = 완주
      opts.push(buildOption(s, opp, piece.pos, 0, dest, dest === GOAL ? null : piece.pos));
      continue;
    }
    const branches: (0 | 1)[] =
      piece.pos !== HOME && JUNCTIONS.has(piece.pos) ? [0, 1] : [0];
    for (const branch of branches) {
      const key = `f${piece.pos}:${branch}`;
      if (seenFrom.has(key)) continue;
      seenFrom.add(key);
      const { dest, cameFrom } = walkForward(piece.pos, m, branch);
      opts.push(buildOption(s, opp, piece.pos, branch, dest, cameFrom));
    }
  }
  return opts;
}

function buildOption(
  s: YState,
  opp: PlayerId,
  from: number,
  branch: 0 | 1,
  dest: number,
  destCameFrom: number | null,
): MoveOption {
  const catches = dest !== GOAL && s.pieces[opp].some((p) => p.pos === dest);
  const stacks =
    dest !== GOAL && s.pieces[s.turn].some((p) => p.pos === dest && p.pos !== from);
  return { from, branch, dest, destCameFrom, catches, stacks };
}

/** 양측의 비밀 선택을 공개하고 결과를 확정한다 */
export function resolveThrow(s: YState, picks: [number, number]): YState {
  if (s.result) throw new Error('game over');
  if (s.phase !== 'choose') throw new Error('not choose phase');
  if (picks.some((p) => p < 0 || p > 2 || !Number.isInteger(p))) throw new Error('bad pick');
  const steps = totalToSteps(picks[0] + picks[1]);
  const throwCount = s.throwCount + 1;
  const info: ThrowInfo = { picks, steps, mover: s.turn, passed: false };

  const pending: YState = {
    ...s,
    phase: 'move',
    pendingSteps: steps,
    lastThrow: info,
    lastMoveDest: null,
    throwCount,
  };

  if (throwCount >= 500) return { ...pending, phase: 'choose', pendingSteps: null, result: { winner: null } };

  if (moveOptions(pending).length === 0) {
    // 뒷도인데 판 위에 말이 없음 → 차례 넘김
    return {
      ...pending,
      phase: 'choose',
      pendingSteps: null,
      lastThrow: { ...info, passed: true },
      turn: (1 - s.turn) as PlayerId,
    };
  }
  return pending;
}

/** 무버가 이동 선택을 적용한다 */
export function applyMove(s: YState, opt: MoveOption): YState {
  if (s.phase !== 'move' || s.pendingSteps === null) throw new Error('not move phase');
  const mover = s.turn;
  const opp = (1 - mover) as PlayerId;
  const steps = s.pendingSteps;

  const valid = moveOptions(s).some(
    (o) => o.from === opt.from && o.branch === opt.branch && o.dest === opt.dest,
  );
  if (!valid) throw new Error('illegal move option');

  const myPieces = s.pieces[mover].map((p) => ({ ...p }));
  const oppPieces = s.pieces[opp].map((p) => ({ ...p }));

  if (opt.from === HOME) {
    const enter = myPieces.find((p) => p.pos === HOME)!;
    enter.pos = opt.dest;
    enter.cameFrom = opt.destCameFrom;
  } else {
    for (const p of myPieces) {
      if (p.pos === opt.from) {
        p.pos = opt.dest;
        p.cameFrom = opt.destCameFrom;
      }
    }
  }

  let caught = false;
  if (opt.dest !== GOAL) {
    for (const p of oppPieces) {
      if (p.pos === opt.dest) {
        p.pos = HOME;
        p.cameFrom = null;
        caught = true;
      }
    }
  }

  const pieces: [YPiece[], YPiece[]] =
    mover === 0 ? [myPieces, oppPieces] : [oppPieces, myPieces];

  const won = myPieces.every((p) => p.pos === GOAL);
  const extra = caught || steps === 4 || steps === 5;

  return {
    ...s,
    pieces,
    phase: 'choose',
    pendingSteps: null,
    lastMoveDest: opt.dest,
    turn: won ? mover : extra ? mover : ((1 - mover) as PlayerId),
    result: won ? { winner: mover } : null,
  };
}
