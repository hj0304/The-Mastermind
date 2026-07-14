/**
 * 콰트로 AI — 공개 정보 기반 가상 플레이어 손패 추적 + 교환 기대값 평가.
 *
 * AI가 사용하는 정보 (사람과 동일):
 * - 자기 손패/오픈, 상대 오픈, 모든 플레이어가 건넨 카드(공개), 자기가 받은 카드
 * - 가상 플레이어 응답 규칙이 결정적이라는 점 (0 우선 → 오픈 양립 최적 → 최고 숫자)
 * - 상대가 어떤 가상과 교환했는지 (0 카드 이동 추적)
 *
 * 전략 요소: 0 카드를 상대가 방문해야 할 가상 플레이어에게 주입, 상대 오픈과
 * 양립하는 고득점 카드는 건네지 않기, 방문 의무(6명 전원)의 순서 최적화.
 */

import type { PlayerId, QCard, QState } from './engine.ts';
import {
  canDecline,
  cardSum,
  currentActor,
  finalFour,
  fullDeck,
  isQuattro,
  virtualResponse,
} from './engine.ts';

// ---------- 손패 평가 ----------

/** 색·숫자 모두 겹치지 않는 최대 부분집합 크기 */
function largestCompatibleSubset(cards: QCard[]): number {
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

/** 최종 4장 후보 평가: 콰트로 여부 > 양립 부분집합 크기 > 합계 */
export function evalFour(cards: QCard[]): number {
  const sum = cardSum(cards);
  if (isQuattro(cards)) return 1000 + sum * 10;
  // 완성 우선: 양립 부분집합 크기의 가중치를 합계보다 훨씬 크게
  return largestCompatibleSubset(cards) * 150 + sum * 4;
}

// ---------- 가상 플레이어 손패 지식 추적 ----------

interface VirtualKnowledge {
  /** 확실히 들고 있는 카드 */
  present: QCard[];
  /** 미확인 슬롯 수 */
  unknownCount: number;
}

function virtualKnowledgeFor(s: QState, me: PlayerId): VirtualKnowledge[] {
  const know: VirtualKnowledge[] = Array.from({ length: 6 }, () => ({
    present: [],
    unknownCount: 3,
  }));
  for (const e of s.log) {
    const k = know[e.virtualIdx];
    if (e.player === me) {
      // 내가 받은 카드가 그 가상에게서 나감
      const i = k.present.findIndex((c) => c.id === e.received.id);
      if (i >= 0) k.present.splice(i, 1);
      else k.unknownCount -= 1;
    } else {
      // 상대 교환: 무엇을 받아갔는지 모름. 단 0 카드 규칙으로 0 보유가 확실했다면 0이 나감.
      const zi = k.present.findIndex((c) => c.color === 'K');
      if (zi >= 0) k.present.splice(zi, 1);
      else if (k.unknownCount > 0) k.unknownCount -= 1;
      else {
        // 전부 알려진 손패면 응답 규칙으로 나간 카드를 정확히 계산 가능하지만,
        // 상대 오픈 기준 최적 카드 근사: 최고 숫자 제거
        k.present.sort((a, b) => b.num - a.num);
        k.present.shift();
      }
    }
    k.present.push(e.given);
  }
  return know;
}

/** 미확인 슬롯 후보 풀 (내 시점에서 아직 위치를 모르는 카드들) */
function candidatePool(s: QState, me: PlayerId, know: VirtualKnowledge[]): QCard[] {
  const seen = new Set<number>();
  for (const c of s.hands[me]) seen.add(c.id);
  for (const c of s.opens[me]) seen.add(c.id);
  for (const c of s.opens[1 - me]) seen.add(c.id);
  for (const k of know) for (const c of k.present) seen.add(c.id);
  return fullDeck().filter((c) => !seen.has(c.id));
}

/** 가상 플레이어 v와 교환 시 받게 될 카드의 분포 샘플링 */
function sampleResponses(
  s: QState,
  me: PlayerId,
  virtualIdx: number,
  know: VirtualKnowledge[],
  pool: QCard[],
  samples = 40,
): QCard[] {
  const k = know[virtualIdx];
  const out: QCard[] = [];
  for (let i = 0; i < samples; i++) {
    const hand = [...k.present];
    if (k.unknownCount > 0) {
      const shuffled = [...pool];
      for (let j = shuffled.length - 1; j > 0; j--) {
        const r = Math.floor(Math.random() * (j + 1));
        [shuffled[j], shuffled[r]] = [shuffled[r], shuffled[j]];
      }
      hand.push(...shuffled.slice(0, k.unknownCount));
    }
    if (hand.length === 0) continue;
    out.push(virtualResponse(hand, s.opens[me]));
  }
  return out;
}

// ---------- 의사결정 ----------

/** 멀리건 여부: 양립 3장 미만이거나 3장인데 합이 낮으면 다시 받는다 */
export function aiWantsMulligan(hand: QCard[]): boolean {
  const subset = largestCompatibleSubset(hand);
  if (subset <= 2) return true;
  if (subset === 3) {
    // 양립 3장의 최대 합 계산
    let bestSum = 0;
    for (let mask = 0; mask < 16; mask++) {
      const sub = hand.filter((_, i) => mask & (1 << i));
      if (sub.length !== 3) continue;
      const colors = new Set(sub.map((c) => c.color));
      const nums = new Set(sub.map((c) => c.num));
      if (colors.size === 3 && nums.size === 3) bestSum = Math.max(bestSum, cardSum(sub));
    }
    return bestSum < 12;
  }
  return isQuattro(hand) ? false : cardSum(hand) < 12;
}

/** 오픈할 카드: 목표 콰트로에 포함되는 카드 중 가장 높은 숫자 (0은 최후순위) */
export function aiChooseOpen(s: QState, me: PlayerId): number {
  const hand = s.hands[me];
  const opens = s.opens[me];
  // 오픈과 양립하며 손패에서 함께 콰트로를 노릴 수 있는 최선 조합 탐색
  let bestCombo: QCard[] = [];
  let bestScore = -Infinity;
  for (let mask = 1; mask < 1 << hand.length; mask++) {
    const sub = hand.filter((_, i) => mask & (1 << i));
    const all = [...opens, ...sub];
    const colors = new Set(all.map((c) => c.color));
    const nums = new Set(all.map((c) => c.num));
    if (colors.size !== all.length || nums.size !== all.length) continue;
    const score = all.length * 100 + cardSum(all);
    if (score > bestScore) {
      bestScore = score;
      bestCombo = sub;
    }
  }
  const pickFrom = bestCombo.length > 0 ? bestCombo : hand;
  // 0 카드는 되도록 오픈하지 않는다 (합계 손해 고정)
  const nonZero = pickFrom.filter((c) => c.color !== 'K');
  const pool = nonZero.length > 0 ? nonZero : pickFrom;
  return [...pool].sort((a, b) => b.num - a.num)[0].id;
}

export type AiAction =
  | { type: 'decline' }
  | { type: 'exchange'; virtualIdx: number; giveCardId: number };

export function aiChooseAction(s: QState, me: PlayerId): AiAction {
  if (currentActor(s) !== me) throw new Error('not AI turn');
  const know = virtualKnowledgeFor(s, me);
  const pool = candidatePool(s, me, know);
  const opp = (1 - me) as PlayerId;
  const curEval = evalFour(finalFour(s, me));
  const oppOpenColors = new Set(s.opens[opp].map((c) => c.color));
  const oppOpenNums = new Set(s.opens[opp].map((c) => c.num));

  let best: AiAction = { type: 'decline' };
  let bestScore = -Infinity;

  for (let v = 0; v < 6; v++) {
    if (s.exchanged[me][v]) continue;
    const responses = sampleResponses(s, me, v, know, pool);
    if (responses.length === 0) continue;
    for (const give of s.hands[me]) {
      // 교환 후 기대 평가
      let evSum = 0;
      for (const r of responses) {
        const newFour = [
          ...s.opens[me],
          ...s.hands[me].filter((c) => c.id !== give.id),
          r,
        ];
        evSum += evalFour(newFour);
      }
      let score = evSum / responses.length - curEval;

      // 0 주입: 상대가 아직 방문 안 한 가상에게 0을 넘기면 상대가 0을 받을 위험 생성
      if (give.color === 'K' && !s.exchanged[opp][v]) score += 60;
      // 상대 오픈과 양립하는 고득점 카드를 건네는 건 상대를 돕는 일 —
      // 단, 내 완성(부분집합 개선)을 막을 만큼 크면 안 되므로 소폭만 감점
      if (!oppOpenColors.has(give.color) && !oppOpenNums.has(give.num) && give.num >= 4) {
        score -= give.num * 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { type: 'exchange', virtualIdx: v, giveCardId: give.id };
      }
    }
  }

  const unvisited = s.exchanged[me].filter((x) => !x).length;
  if (best.type === 'exchange') {
    // 방문 의무가 남았으면 다소 손해라도 소화, 아니면 이득일 때만
    const threshold = unvisited > 0 ? -30 : 5;
    if (bestScore >= threshold) return best;
  }
  if (canDecline(s, me)) return { type: 'decline' };
  return best.type === 'exchange' ? best : { type: 'decline' };
}
