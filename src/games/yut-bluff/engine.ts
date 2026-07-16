/**
 * 윷과 거짓말 (원작: 의심 윷놀이 / 원류: 챠오챠오) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §5, 원작 충실 2인 대칭 변형):
 * - 전통 윷판에서 일반 윷놀이 룰로 진행 (잡기·업기·지름길·한 번 더). 뒷도 없음.
 * - 윷가락 대신 10면체 주사위: 도·개·걸 각 2면, 윷·모 각 1면, 꽝 2면.
 * - 주사위 결과는 굴린 본인만 확인 → 이동할 말(경로 포함)을 지정하며 결과를 선언.
 *   거짓 선언 가능 — 믿어주면 선언된 값만큼 이동한다.
 * - 꽝: 판 위 자기 말 1개 제거(본인 선택, 판에 없으면 대기 말). 이동이 없으므로
 *   의심 대상이 아니며 즉시 해결된다. 꽝을 거짓으로 선언하는 것도 가능(자기 말 제거).
 * - 의심(이동 선언에만 가능):
 *   · 적중(거짓) — 이동시키려던 말 제거(업힌 말은 1개만), 이동 무효, 차례 넘김
 *   · 실패(진실) — 의심자의 말 1개 제거(대기 우선, 없으면 가장 뒤처진 말),
 *     이동은 그대로 진행(잡기/한 번 더 포함)
 * - 잡힌 말은 제거가 아니라 출발 전으로 복귀. 잡거나 윷/모면 한 번 더(추가는 1번만).
 * - 스타트 지점(0)을 **통과해야** 완주 — 정확히 0에 서면(참먹이) 다음 이동으로 탈출.
 * - 말 6개 중 2개 완주 시 승리. 남은 말(제거되지 않은 말)이 2개 미만이면 즉시 패배.
 * - (안전장치) 400라운드 무승부.
 */

import { YUT_JUNCTIONS, yutNextNode } from '../shared/yut-graph.ts';

export type PlayerId = 0 | 1;

export const HOME = -1;
export const DEAD = -99;
export const GOAL = 99;
export const PIECES_PER_PLAYER = 6;

/** 주사위 면: 값(칸수), 꽝=0 */
export const DIE_FACES = [1, 1, 2, 2, 3, 3, 4, 5, 0, 0];

export const VALUE_NAME: Record<number, string> = {
  0: '꽝',
  1: '도',
  2: '개',
  3: '걸',
  4: '윷',
  5: '모',
};

export interface Declaration {
  value: number; // 0(꽝)~5(모)
  /** 이동 출발(값 1~5) 또는 제거 대상(꽝): HOME 또는 노드 */
  from: number;
  branch: 0 | 1;
}

export interface RoundRec {
  roller: PlayerId;
  declared: number;
  from: number;
  challenged: boolean;
  revealed: boolean;
  /** 실제 주사위 값 — revealed=false면 UI/AI에 노출 금지 */
  roll: number;
  wasLie: boolean | null;
  outcome: 'moved' | 'liar-caught' | 'wrong-challenge' | 'kkang';
  caught: boolean;
  dest: number | null;
  extra: boolean;
}

export interface BState {
  /** pieces[p] = 말 6개의 위치 (HOME/0~28/GOAL/DEAD) */
  pieces: [number[], number[]];
  turn: PlayerId; // 현재 롤러
  phase: 'declare' | 'respond' | 'gameover';
  /** 현재 롤러의 비공개 주사위 값 */
  roll: number;
  declaration: Declaration | null;
  history: RoundRec[];
  round: number;
  result: { winner: PlayerId | null } | null;
}

export function rollDie(): number {
  return DIE_FACES[Math.floor(Math.random() * DIE_FACES.length)];
}

export function createGame(firstTurn: PlayerId, firstRoll?: number): BState {
  return {
    pieces: [
      new Array(PIECES_PER_PLAYER).fill(HOME),
      new Array(PIECES_PER_PLAYER).fill(HOME),
    ],
    turn: firstTurn,
    phase: 'declare',
    roll: firstRoll ?? rollDie(),
    declaration: null,
    history: [],
    round: 0,
    result: null,
  };
}

/**
 * from에서 v칸 전진(일반 윷놀이, 뒷도 없음).
 * - HOME: 출발점(0)에서 시작해 v칸.
 * - 0(참먹이): 어떤 값이든 출발점을 넘어 즉시 완주.
 * - 이동 중 0에 "도달하고 스텝이 남으면" 통과 = 완주, 마지막 스텝이면 0에 안착.
 */
export function walkBluff(from: number, v: number, branch: 0 | 1): number {
  if (from === 0) return GOAL;
  let cur = from === HOME ? 0 : from;
  let prev: number | null = null;
  for (let k = 0; k < v; k++) {
    const nxt = yutNextNode(cur, prev, k === 0 && from !== HOME ? branch : null);
    if (nxt === 0) return k === v - 1 ? 0 : GOAL;
    prev = cur;
    cur = nxt;
  }
  return cur;
}

/** 이동 선언 가능한 출발 위치(값과 무관): 대기(하나로 취급) + 내 말이 있는 노드 */
export function movableFroms(s: BState, p: PlayerId): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const pos of s.pieces[p]) {
    if (pos === GOAL || pos === DEAD) continue;
    if (seen.has(pos)) continue;
    seen.add(pos);
    out.push(pos);
  }
  return out;
}

/** 꽝 선언 시 제거 지정 가능한 위치: 판 위 말 우선, 없으면 대기 */
export function kkangTargets(s: BState, p: PlayerId): number[] {
  const board = movableFroms(s, p).filter((x) => x !== HOME);
  if (board.length > 0) return board;
  return s.pieces[p].includes(HOME) ? [HOME] : [];
}

export function branchOptions(from: number): (0 | 1)[] {
  return from !== HOME && YUT_JUNCTIONS.has(from) ? [0, 1] : [0];
}

function aliveCount(pieces: number[]): number {
  return pieces.filter((x) => x !== DEAD).length;
}

function killOneAt(pieces: number[], pos: number): number[] {
  const out = [...pieces];
  const i = out.indexOf(pos);
  if (i < 0) throw new Error('no piece at ' + pos);
  out[i] = DEAD;
  return out;
}

/** 의심 실패 페널티 대상: 대기 우선, 없으면 가장 뒤처진 판 위 말 */
export function penaltyTargetPos(s: BState, p: PlayerId): number | null {
  if (s.pieces[p].includes(HOME)) return HOME;
  const board = s.pieces[p].filter((x) => x >= 0 && x !== GOAL);
  if (board.length === 0) return null;
  let worst = board[0];
  for (const b of board) if (remainToGoal(b) > remainToGoal(worst)) worst = b;
  return worst;
}

/** 완주까지 남은 최단 칸수 근사 (지름길 최선 가정, 통과 필요 +1) */
export function remainToGoal(pos: number): number {
  if (pos === GOAL) return 0;
  if (pos === DEAD) return 999;
  if (pos === HOME) return 21;
  if (pos === 0) return 1;
  const DIST0: Record<number, number> = {
    1: 19, 2: 18, 3: 17, 4: 16, 5: 6, 6: 14, 7: 13, 8: 12, 9: 11, 10: 6,
    11: 9, 12: 8, 13: 7, 14: 6, 15: 5, 16: 4, 17: 3, 18: 2, 19: 1,
    20: 5, 21: 4, 22: 3, 23: 7, 24: 6, 25: 5, 26: 4, 27: 2, 28: 1,
  };
  return DIST0[pos] + 1;
}

export function declare(s: BState, d: Declaration): BState {
  if (s.phase !== 'declare') throw new Error('not declare phase');
  if (!Number.isInteger(d.value) || d.value < 0 || d.value > 5) throw new Error('bad value');
  if (d.value === 0) {
    if (!kkangTargets(s, s.turn).includes(d.from)) throw new Error('bad kkang target');
    // 꽝은 이동이 없어 의심 대상이 아님 — 즉시 해결
    const pieces: [number[], number[]] = [[...s.pieces[0]], [...s.pieces[1]]];
    pieces[s.turn] = killOneAt(pieces[s.turn], d.from);
    const rec: RoundRec = {
      roller: s.turn,
      declared: 0,
      from: d.from,
      challenged: false,
      revealed: false,
      roll: s.roll,
      wasLie: null,
      outcome: 'kkang',
      caught: false,
      dest: null,
      extra: false,
    };
    return finishRound(s, pieces, rec, false);
  }
  if (!movableFroms(s, s.turn).includes(d.from)) throw new Error('bad from');
  if (!branchOptions(d.from).includes(d.branch)) throw new Error('bad branch');
  return { ...s, phase: 'respond', declaration: { ...d } };
}

/** 선언된 이동을 실제 실행 (잡기 포함). 반환: [pieces, caught, dest] */
function executeMove(
  s: BState,
  roller: PlayerId,
  d: Declaration,
): { pieces: [number[], number[]]; caught: boolean; dest: number } {
  const opp = (1 - roller) as PlayerId;
  const dest = walkBluff(d.from, d.value, d.branch);
  const mine = [...s.pieces[roller]];
  const theirs = [...s.pieces[opp]];

  if (d.from === HOME) {
    mine[mine.indexOf(HOME)] = dest;
  } else {
    for (let i = 0; i < mine.length; i++) if (mine[i] === d.from) mine[i] = dest; // 업힌 말 동반
  }

  let caught = false;
  if (dest !== GOAL) {
    for (let i = 0; i < theirs.length; i++) {
      if (theirs[i] === dest) {
        theirs[i] = HOME; // 잡힌 말은 제거가 아니라 복귀
        caught = true;
      }
    }
  }
  const pieces: [number[], number[]] = roller === 0 ? [mine, theirs] : [theirs, mine];
  return { pieces, caught, dest };
}

export function respond(s: BState, challenge: boolean): BState {
  if (s.phase !== 'respond' || !s.declaration) throw new Error('not respond phase');
  const roller = s.turn;
  const responder = (1 - roller) as PlayerId;
  const d = s.declaration;
  const wasLie = s.roll !== d.value;

  if (challenge && wasLie) {
    // 의심 적중: 이동시키려던 말 제거 (업힌 말은 1개만)
    const pieces: [number[], number[]] = [[...s.pieces[0]], [...s.pieces[1]]];
    pieces[roller] = killOneAt(pieces[roller], d.from);
    const rec: RoundRec = {
      roller,
      declared: d.value,
      from: d.from,
      challenged: true,
      revealed: true,
      roll: s.roll,
      wasLie: true,
      outcome: 'liar-caught',
      caught: false,
      dest: null,
      extra: false,
    };
    return finishRound(s, pieces, rec, false);
  }

  // 이동 실행 (믿음 또는 의심 실패)
  const { pieces, caught, dest } = executeMove(s, roller, d);
  if (challenge) {
    // 의심 실패: 의심자 말 1개 제거
    const target = penaltyTargetPos({ ...s, pieces } as BState, responder);
    if (target !== null) pieces[responder] = killOneAt(pieces[responder], target);
  }
  const extra = caught || d.value >= 4; // 잡기/윷/모 — 중복이어도 1번만
  const rec: RoundRec = {
    roller,
    declared: d.value,
    from: d.from,
    challenged: challenge,
    revealed: challenge,
    roll: s.roll,
    wasLie: challenge ? wasLie : null,
    outcome: challenge ? 'wrong-challenge' : 'moved',
    caught,
    dest,
    extra,
  };
  return finishRound(s, pieces, rec, extra);
}

function finishRound(
  s: BState,
  pieces: [number[], number[]],
  rec: RoundRec,
  extra: boolean,
): BState {
  const roller = s.turn;
  let winner: PlayerId | null | undefined;
  for (const p of [0, 1] as PlayerId[]) {
    if (pieces[p].filter((x) => x === GOAL).length >= 2) winner = p;
  }
  if (winner === undefined) {
    for (const p of [0, 1] as PlayerId[]) {
      if (aliveCount(pieces[p]) < 2) winner = (1 - p) as PlayerId;
    }
  }
  const round = s.round + 1;
  if (winner === undefined && round >= 400) winner = null;

  if (winner !== undefined) {
    return {
      ...s,
      pieces,
      phase: 'gameover',
      declaration: null,
      history: [...s.history, rec],
      round,
      result: { winner },
    };
  }
  return {
    ...s,
    pieces,
    turn: extra ? roller : ((1 - roller) as PlayerId),
    phase: 'declare',
    roll: rollDie(),
    declaration: null,
    history: [...s.history, rec],
    round,
    result: null,
  };
}
