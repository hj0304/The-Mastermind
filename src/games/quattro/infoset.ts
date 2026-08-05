/**
 * 테트라 정보집합 키 + 메타 행동 집합 — **학습기·평가기·게임 AI가 공유**한다.
 *
 * 테트라의 원시 행동은 조합적이다(교환 = 가상 6명 × 줄 카드 최대 4장 + 패스,
 * 오픈 = 최대 4장, 멀리건 2지선다). 원시 행동 위에서 균형을 학습하는 대신
 * **메타 행동(휴리스틱 옵션)** 위에서 학습한다 — CFR이 배우는 것은
 * "어떤 상황에서 어떤 옵션을 쓰는가"이고, 옵션의 구체 실행은 ai.ts의
 * resolveMeta가 담당한다(학습·실전이 같은 함수를 쓴다 — 모델 불일치 차단).
 *
 * 결정 3종과 메타 행동:
 *  - 멀리건 M: k(유지) / m(다시 받기)
 *  - 오픈   O: h(목표 조합의 최고 숫자 — 기존 휴리스틱) / l(목표 조합의 최저 숫자)
 *  - 교환   X: p(패스) / e(기대값 최선 교환) / z(0 카드를 상대 미방문 가상에 주입)
 *
 * 키 자릿수는 전부 사람이 알 수 있는 정보에서만 계산된다.
 */

import type { PlayerId, QCard, QState } from './engine.ts';
import { canDecline, cardSum, finalFour } from './engine.ts';

/** 색·숫자 모두 겹치지 않는 최대 부분집합 크기 (테트라 완성도의 핵심 지표) */
export function largestCompatibleSubset(cards: QCard[]): number {
  let best = 0;
  const n = cards.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const subset = cards.filter((_, i) => mask & (1 << i));
    const colors = new Set(subset.map((c) => c.color));
    const nums = new Set(subset.map((c) => c.num));
    if (colors.size === subset.length && nums.size === subset.length) {
      best = Math.max(best, subset.length);
    }
  }
  return best;
}

export type MetaCode = 'k' | 'm' | 'h' | 'l' | 'p' | 'e' | 'z';

const sumBucket = (cards: QCard[]): number => Math.min(5, Math.floor(cardSum(cards) / 4));
const zeroCount = (cards: QCard[]): number => cards.filter((c) => c.color === 'K').length;
/** 미방문 가상 수 버킷: 0 / 1~3 / 4~6 */
const unvBucket = (n: number): number => (n === 0 ? 0 : n <= 3 ? 1 : 2);

/** 멀리건 결정 키 (mulligansUsed ≥ 2는 엔진이 자동 확정 — 결정 없음) */
export function mullKey(hand: QCard[], used: number): string {
  return `M${largestCompatibleSubset(hand)}${sumBucket(hand)}${zeroCount(hand)}${used}`;
}

/** 오픈 결정 키 — 최종 4장(오픈+손패)의 완성도·합계로 요약 */
export function openKey(s: QState, me: PlayerId): string {
  const four = finalFour(s, me);
  return `O${s.opens[me].length}${largestCompatibleSubset(four)}${sumBucket(four)}${zeroCount(four)}`;
}

/** 교환 단계에서 z(0 주입)가 가능한가: 내 손에 0 + 양쪽 다 미방문인 가상 존재 */
export function zeroInjectable(s: QState, me: PlayerId): boolean {
  if (!s.hands[me].some((c) => c.color === 'K')) return false;
  const opp = (1 - me) as PlayerId;
  for (let v = 0; v < 6; v++) {
    if (!s.exchanged[me][v] && !s.exchanged[opp][v]) return true;
  }
  return false;
}

/** 교환 결정 키 */
export function xchgKey(s: QState, me: PlayerId): string {
  const opp = (1 - me) as PlayerId;
  const four = finalFour(s, me);
  const unvMe = s.exchanged[me].filter((x) => !x).length;
  const unvOpp = s.exchanged[opp].filter((x) => !x).length;
  const pF = canDecline(s, me) ? 1 : 0;
  const zF = zeroInjectable(s, me) ? 1 : 0;
  const od = s.declined[opp] ? 1 : 0;
  const oppSumB = Math.min(3, Math.floor(cardSum(s.opens[opp]) / 5));
  return (
    `X${s.opens[me].length}${largestCompatibleSubset(four)}${sumBucket(four)}${zeroCount(four)}` +
    `${unvBucket(unvMe)}${unvBucket(unvOpp)}${pF}${zF}${od}${oppSumB}`
  );
}

/**
 * 교환 메타 행동 집합. 미방문 가상이 없으면 교환 자체가 불가 → ['p'] (강제수,
 * 정보집합 불필요). 집합 구성은 키의 pF/zF 자리와 정확히 일치해야 한다.
 */
export function xchgMetas(s: QState, me: PlayerId): MetaCode[] {
  if (s.exchanged[me].every(Boolean)) return ['p'];
  const out: MetaCode[] = [];
  if (canDecline(s, me)) out.push('p');
  out.push('e');
  if (zeroInjectable(s, me)) out.push('z');
  return out;
}

const M_LABELS: MetaCode[] = ['k', 'm'];
const O_LABELS: MetaCode[] = ['h', 'l'];

/** 정보집합 키 → 행동 라벨 복원 (학습 결과 저장·검증용) */
export function labelsFromKey(key: string): MetaCode[] {
  if (key[0] === 'M') return M_LABELS;
  if (key[0] === 'O') return O_LABELS;
  // X + opens(1) subset(1) sumB(1) zeros(1) unvMe(1) unvOpp(1) pF(1) zF(1) od(1) oppSumB(1)
  const out: MetaCode[] = [];
  if (key[7] === '1') out.push('p');
  out.push('e');
  if (key[8] === '1') out.push('z');
  return out;
}
