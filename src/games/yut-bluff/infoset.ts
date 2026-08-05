/**
 * 윷과 거짓말 정보집합 키 + 메타 행동 — **학습기·평가기·게임 AI가 공유**한다.
 *
 * 이 게임의 매 라운드는 **3×2 스테이지 게임**이다:
 *   롤러가 선언 카테고리 3종(진실 / 낮게 거짓 / 높게 거짓) 중 하나를 고르고,
 *   응답자가 믿기·의심 2종 중 하나를 고른다.
 * 블러핑 게임의 해는 단일 수가 아니라 **혼합 전략**이고(항상 진실하면 읽히고, 항상
 * 거짓이면 말이 소모된다), 기존 휴리스틱은 기대값에 난수를 얹는 방식이라 빈도가
 * 균형이 아니다 — 그 빈도를 CFR로 학습하는 것이 이 모듈의 목적이다.
 *
 * 어느 말을 어디로 움직일지(from·branch)는 균형이 아니라 위치 최적화 문제라
 * 기존 휴리스틱에 맡기고(ai.ts의 resolve*), 학습은 카테고리 선택만 담당한다.
 *
 * 키는 각 결정자가 실제로 아는 정보에서만 계산된다 — 특히 응답 키에는
 * **주사위 값이 들어가지 않는다**(응답자는 끝까지 모른다).
 */

import type { BState, PlayerId } from './engine.ts';
import { DEAD, GOAL, HOME, remainToGoal } from './engine.ts';

/** 롤러 메타: t=진실 / l=낮게 거짓(1~3) / h=높게 거짓(4~5) / k=꽝 진실 신고 */
/** 응답자 메타: b=믿기 / c=의심 */
export type MetaCode = 't' | 'l' | 'h' | 'k' | 'b' | 'c';

const MAX_PROGRESS = 21;

/** 진행도 합: 살아있는 말들의 (21 − 남은 칸수). HOME=0, GOAL=21 */
export function totalProgress(pieces: number[]): number {
  let sum = 0;
  for (const pos of pieces) {
    if (pos === DEAD) continue;
    sum += MAX_PROGRESS - Math.min(MAX_PROGRESS, remainToGoal(pos));
  }
  return sum;
}

const aliveCount = (pieces: number[]): number => pieces.filter((x) => x !== DEAD).length;
const goalCount = (pieces: number[]): number => pieces.filter((x) => x === GOAL).length;

/** 말 여유 버킷: 2개(벼랑)=0 · 3=1 · 4=2 · 5~6=3 */
const aliveBucket = (n: number): number => Math.max(0, Math.min(3, n - 2));

/** 진행도 차 버킷: 크게 밀림 0 ~ 크게 앞섬 4 */
function progBucket(diff: number): number {
  if (diff <= -30) return 0;
  if (diff <= -10) return 1;
  if (diff < 10) return 2;
  if (diff < 30) return 3;
  return 4;
}

/** 공통 국면 자릿수 — me 관점 */
function boardDigits(s: BState, me: PlayerId): string {
  const opp = (1 - me) as PlayerId;
  const myGoals = Math.min(1, goalCount(s.pieces[me]));
  const oppGoals = Math.min(1, goalCount(s.pieces[opp]));
  const myA = aliveBucket(aliveCount(s.pieces[me]));
  const oppA = aliveBucket(aliveCount(s.pieces[opp]));
  const pb = progBucket(totalProgress(s.pieces[me]) - totalProgress(s.pieces[opp]));
  return `${myGoals}${oppGoals}${myA}${oppA}${pb}`;
}

/**
 * 선언 결정 키. 자기 주사위 값은 자신이 아는 정보이므로 키에 포함된다.
 * winReach = 이 주사위로 완주해 승리를 확정할 수 있는가(이미 1개 완주 + 도달 가능).
 *
 * "거짓말이 들키면 잃을 말의 아까운 정도" 자리(stakeB)도 시도했으나 **차이가 없었다**:
 * 3만 판 측정에서 단순 키 52.5% vs stakeB 52.0% (각 표준오차 0.29% — 1.2σ, 유의하지 않음).
 * 정보집합만 5,359 → 7,455개로 늘어나므로 단순한 키를 채택했다. 말의 가치는
 * 해석기(resolveDeclMeta)가 이미 반영하기 때문으로 보인다.
 *
 * 측정 교훈: 2천 판으로는 표준오차가 1.1%여서 두 설계를 구분할 수 없었다
 * (그 표본에서는 54.3% vs 50.7%로 보였다). 설계 비교는 3만 판으로 측정한다.
 */
export function declKey(s: BState, me: PlayerId, winReach: boolean): string {
  return `D${s.roll}${boardDigits(s, me)}${winReach ? 1 : 0}`;
}

/** 말 위치 → 아까운 정도 버킷 (선언 키의 stakeB, 응답 키의 penB 공용 척도) */
export function positionBucket(pos: number): number {
  if (pos === HOME) return 0;
  if (pos < 0 || pos === GOAL) return 0;
  return remainToGoal(pos) > 12 ? 1 : 2;
}

/**
 * 응답 결정 키. **주사위 값 없음** — 응답자가 아는 것은 선언된 값뿐이다.
 * winThreat = 믿어주면 상대가 그대로 승리하는가.
 * penB = 의심 실패 시 내가 잃을 말의 아까운 정도(0=대기말, 2=많이 전진한 말).
 */
export function respKey(s: BState, me: PlayerId, winThreat: boolean): string {
  const d = s.declaration;
  const declared = d ? d.value : 0;
  return `R${declared}${boardDigits(s, me)}${winThreat ? 1 : 0}${penaltyBucket(s, me)}`;
}

/** 의심 실패 페널티의 아까운 정도 (engine.penaltyTargetPos와 같은 우선순위) */
export function penaltyBucket(s: BState, me: PlayerId): number {
  if (s.pieces[me].includes(HOME)) return 0; // 대기 말이 먼저 죽는다 — 가장 싸다
  const board = s.pieces[me].filter((x) => x >= 0 && x !== GOAL);
  if (board.length === 0) return 0;
  let worst = board[0];
  for (const b of board) if (remainToGoal(b) > remainToGoal(worst)) worst = b;
  return positionBucket(worst);
}

const ROLLER_ZERO: MetaCode[] = ['k', 'l', 'h'];
const ROLLER_NORMAL: MetaCode[] = ['t', 'l', 'h'];
const RESPONDER: MetaCode[] = ['b', 'c'];

/**
 * 선언 메타 집합. 주사위가 꽝(0)이면 진실한 이동 선언이 불가능하므로
 * "꽝 신고(k)" 가 진실 옵션의 자리를 대신한다 — 집합 크기는 항상 3이고
 * 키의 주사위 자리(key[1])로 복원 가능하다.
 */
export function declMetas(roll: number): MetaCode[] {
  return roll === 0 ? ROLLER_ZERO : ROLLER_NORMAL;
}

export function respMetas(): MetaCode[] {
  return RESPONDER;
}

/** 정보집합 키 → 행동 라벨 복원 (학습 결과 저장·검증용) */
export function labelsFromKey(key: string): MetaCode[] {
  if (key[0] === 'R') return RESPONDER;
  return key[1] === '0' ? ROLLER_ZERO : ROLLER_NORMAL;
}
