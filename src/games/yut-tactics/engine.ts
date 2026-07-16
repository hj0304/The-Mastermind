/**
 * 윷 대전 (원작: 전략 윷놀이) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §4, 2인 변형 — 기본은 일반 윷놀이):
 * - 윷을 던지지 않는다. 매 던지기마다 두 플레이어가 각자 윷가락 2개의 앞/뒤를
 *   **비밀 동시 선택** → 앞면 총수로 결과 결정: 0=모(5칸), 1=도, 2=개, 3=걸, 4=윷.
 * - **모든 도는 뒷도(1칸 후진)** 로 간주한다 (원작 룰).
 * - **윷/모가 나오면 이동 전에 한 번 더 던진다** — 결과를 모아 두었다가
 *   원하는 순서·원하는 말에 나눠 적용한다 (일반 윷놀이 룰).
 * - **뒷도로 출발점 진입도 한 바퀴로 인정** — 1번 칸에서 뒷도를 받으면 완주(원작 룰).
 * - 상대 말을 잡으면 이동을 모두 마친 뒤 **한 번 더 던진다** (여러 번 잡아도 1회).
 * - 같은 칸의 내 말은 업힌다(함께 이동, 함께 잡힘). 쓸 수 없는 결과(뒷도인데 판에
 *   말이 없음)는 버려진다. 말 2개가 모두 완주하면 승리.
 * - 전통 윷판: 모서리(5·10)나 중앙(22)에 정확히 서면 다음 이동에서 지름길 선택 가능.
 *   완주는 출발점(0) 도달/통과 즉시 인정.
 * - (안전장치) 500번째 던지기 이후 무승부.
 *
 * 판 노드: 0=출발/도착, 1~19 외곽 반시계, 지름길 5→20→21→22(중앙)→23→24→15,
 * 10→25→26→22→27→28→0. 중앙(22)에서 출발 시 27(출구) 또는 23(횡단) 선택.
 */

import { YUT_JUNCTIONS, YUT_PREV, yutNextNode } from '../shared/yut-graph.ts';

export type PlayerId = 0 | 1;

export const HOME = -1;
export const GOAL = 99;

export interface YPiece {
  pos: number; // HOME | 0~28 | GOAL
  cameFrom: number | null; // 뒷도용 직전 칸 (전진 이동만 기록)
}

export interface ThrowInfo {
  picks: [number, number]; // [p0 앞면 수, p1 앞면 수] (0~2)
  steps: number; // -1(뒷도) | 2 | 3 | 4 | 5
  mover: PlayerId;
  passed: boolean; // 쓸 수 있는 결과가 없어 차례를 넘김
  again: boolean; // 윷/모 — 이동 전에 한 번 더 던짐
}

export interface MoveOption {
  stepIdx: number; // pending 내 인덱스
  step: number; // 적용할 결과 값
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
  /** 아직 적용하지 않은 던지기 결과들 (윷/모 연속 던지기로 누적) */
  pending: number[];
  /** 잡기 보너스 — 남은 결과를 모두 쓴 뒤 한 번 더 던짐 (중복 잡기도 1회) */
  extraThrow: boolean;
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

const PREV = YUT_PREV;

/** 분기 가능 노드 (그 칸에서 이동을 시작할 때만) */
export const JUNCTIONS = YUT_JUNCTIONS;

export function createGame(firstTurn: PlayerId): YState {
  return {
    pieces: [
      [{ pos: HOME, cameFrom: null }, { pos: HOME, cameFrom: null }],
      [{ pos: HOME, cameFrom: null }, { pos: HOME, cameFrom: null }],
    ],
    turn: firstTurn,
    phase: 'choose',
    pending: [],
    extraThrow: false,
    lastThrow: null,
    lastMoveDest: null,
    throwCount: 0,
    result: null,
  };
}

export function totalToSteps(total: number): number {
  return [5, -1, 2, 3, 4][total];
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
    const nxt = yutNextNode(cur, prev, k === 0 && from !== HOME ? branch : null);
    if (nxt === 0) return { dest: GOAL, cameFrom: null }; // 출발점 도달 = 완주
    prev = cur;
    cur = nxt;
  }
  return { dest: cur, cameFrom: prev };
}

/** 특정 결과(step) 하나에 대한 이동 후보 */
export function optionsForStep(s: YState, step: number, stepIdx: number): MoveOption[] {
  const mover = s.turn;
  const opp = (1 - mover) as PlayerId;
  const opts: MoveOption[] = [];
  const seenFrom = new Set<string>();

  for (const piece of s.pieces[mover]) {
    if (piece.pos === GOAL) continue;
    if (step === -1) {
      if (piece.pos === HOME) continue;
      const key = `b${piece.pos}`;
      if (seenFrom.has(key)) continue;
      seenFrom.add(key);
      const back = piece.cameFrom ?? PREV[piece.pos];
      const dest = back === 0 ? GOAL : back; // 뒷도 출발점 진입 = 완주
      // 후진 뒤에는 cameFrom을 비워 다음 뒷도가 기본 역방향(PREV)을 따르게 한다
      opts.push(buildOption(s, opp, stepIdx, step, piece.pos, 0, dest, null));
      continue;
    }
    const branches: (0 | 1)[] =
      piece.pos !== HOME && JUNCTIONS.has(piece.pos) ? [0, 1] : [0];
    for (const branch of branches) {
      const key = `f${piece.pos}:${branch}`;
      if (seenFrom.has(key)) continue;
      seenFrom.add(key);
      const { dest, cameFrom } = walkForward(piece.pos, step, branch);
      opts.push(buildOption(s, opp, stepIdx, step, piece.pos, branch, dest, cameFrom));
    }
  }
  return opts;
}

/** 남은 모든 결과에 대한 이동 후보 */
export function moveOptions(s: YState): MoveOption[] {
  if (s.result) return [];
  return s.pending.flatMap((step, i) => optionsForStep(s, step, i));
}

function buildOption(
  s: YState,
  opp: PlayerId,
  stepIdx: number,
  step: number,
  from: number,
  branch: 0 | 1,
  dest: number,
  destCameFrom: number | null,
): MoveOption {
  const catches = dest !== GOAL && s.pieces[opp].some((p) => p.pos === dest);
  const stacks =
    dest !== GOAL && s.pieces[s.turn].some((p) => p.pos === dest && p.pos !== from);
  return { stepIdx, step, from, branch, dest, destCameFrom, catches, stacks };
}

/** 양측의 비밀 선택을 공개하고 결과를 누적한다 */
export function resolveThrow(s: YState, picks: [number, number]): YState {
  if (s.result) throw new Error('game over');
  if (s.phase !== 'choose') throw new Error('not choose phase');
  if (picks.some((p) => p < 0 || p > 2 || !Number.isInteger(p))) throw new Error('bad pick');
  const steps = totalToSteps(picks[0] + picks[1]);
  const throwCount = s.throwCount + 1;
  const pending = [...s.pending, steps];
  const again = steps === 4 || steps === 5;
  const info: ThrowInfo = { picks, steps, mover: s.turn, passed: false, again };

  if (throwCount >= 500) {
    return { ...s, pending: [], throwCount, lastThrow: info, result: { winner: null } };
  }

  // 윷/모: 이동 전에 한 번 더 던진다 (결과 누적)
  if (again) {
    return { ...s, pending, throwCount, lastThrow: info };
  }

  const next: YState = { ...s, phase: 'move', pending, throwCount, lastThrow: info, lastMoveDest: null };
  if (moveOptions(next).length === 0) {
    // 쓸 수 있는 결과가 하나도 없음 (예: 뒷도뿐인데 판에 말이 없음) → 차례 넘김
    return {
      ...next,
      phase: 'choose',
      pending: [],
      extraThrow: false,
      lastThrow: { ...info, passed: true },
      turn: (1 - s.turn) as PlayerId,
    };
  }
  return next;
}

/** 무버가 남은 결과 중 하나를 골라 적용한다 */
export function applyMove(s: YState, opt: MoveOption): YState {
  if (s.result) throw new Error('game over');
  const mover = s.turn;
  const opp = (1 - mover) as PlayerId;

  const valid = moveOptions(s).some(
    (o) =>
      o.stepIdx === opt.stepIdx &&
      o.from === opt.from &&
      o.branch === opt.branch &&
      o.dest === opt.dest,
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
  const pending = s.pending.filter((_, i) => i !== opt.stepIdx);
  const extraThrow = s.extraThrow || caught;

  const won = myPieces.every((p) => p.pos === GOAL);
  if (won) {
    return {
      ...s,
      pieces,
      pending: [],
      extraThrow: false,
      phase: 'choose',
      lastMoveDest: opt.dest,
      result: { winner: mover },
    };
  }

  const next: YState = { ...s, pieces, pending, extraThrow, lastMoveDest: opt.dest };

  // 남은 결과가 있고 쓸 수 있으면 계속 이동
  if (pending.length > 0 && moveOptions(next).length > 0) {
    return { ...next, phase: 'move' };
  }
  // 남은 결과가 있어도 쓸 수 없으면 버린다 → 턴 정리
  if (extraThrow) {
    return { ...next, pending: [], extraThrow: false, phase: 'choose' }; // 잡기 보너스 던지기
  }
  return {
    ...next,
    pending: [],
    extraThrow: false,
    phase: 'choose',
    turn: (1 - mover) as PlayerId,
  };
}
