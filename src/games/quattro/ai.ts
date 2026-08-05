/**
 * 테트라 AI — 공개 정보 기반 가상 플레이어 손패 추적 + 교환 기대값 평가.
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
import type { MetaCode } from './infoset.ts';
import { largestCompatibleSubset, mullKey, openKey, xchgKey, xchgMetas } from './infoset.ts';
import { lookupPolicy } from './policy.ts';

// ---------- 손패 평가 ----------

/** 최종 4장 후보 평가: 테트라 여부 > 양립 부분집합 크기 > 합계 */
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

/** 오픈 후보 풀: 목표 테트라 조합의 카드들 (0 카드는 최후순위로 제외) */
function bestOpenPool(s: QState, me: PlayerId): QCard[] {
  const hand = s.hands[me];
  const opens = s.opens[me];
  // 오픈과 양립하며 손패에서 함께 테트라를 노릴 수 있는 최선 조합 탐색
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
  return nonZero.length > 0 ? nonZero : pickFrom;
}

/** 오픈할 카드: 목표 테트라에 포함되는 카드 중 가장 높은 숫자 (0은 최후순위) */
export function aiChooseOpen(s: QState, me: PlayerId): number {
  const pool = bestOpenPool(s, me);
  return [...pool].sort((a, b) => b.num - a.num)[0].id;
}

/** 오픈 변형: 같은 후보 풀에서 가장 낮은 숫자 — 높은 패를 손에 숨기는 선택 */
export function aiChooseOpenLow(s: QState, me: PlayerId): number {
  const pool = bestOpenPool(s, me);
  return [...pool].sort((a, b) => a.num - b.num)[0].id;
}

export type AiAction =
  | { type: 'decline' }
  | { type: 'exchange'; virtualIdx: number; giveCardId: number };

export interface ExchangeChoice {
  virtualIdx: number;
  giveCardId: number;
  score: number;
}

/**
 * 미방문 가상 × 줄 카드 전수 스캔으로 기대값 최선의 교환을 찾는다.
 * zeroBonus: 0 주입 가산점(기존 휴리스틱의 성향) 적용 여부.
 * zeroInject: true면 "0 카드를 상대 미방문 가상에게" 조합만 스캔 (메타 z 전용).
 * samples: 가상 응답 분포 표본 수 — 학습·실전의 메타 해석은 같은 값을 쓴다.
 */
export function scanExchanges(
  s: QState,
  me: PlayerId,
  opts: { zeroBonus: boolean; zeroInject?: boolean; samples?: number },
): ExchangeChoice | null {
  const know = virtualKnowledgeFor(s, me);
  const pool = candidatePool(s, me, know);
  const opp = (1 - me) as PlayerId;
  const curEval = evalFour(finalFour(s, me));
  const oppOpenColors = new Set(s.opens[opp].map((c) => c.color));
  const oppOpenNums = new Set(s.opens[opp].map((c) => c.num));

  let best: ExchangeChoice | null = null;

  for (let v = 0; v < 6; v++) {
    if (s.exchanged[me][v]) continue;
    if (opts.zeroInject && s.exchanged[opp][v]) continue;
    const responses = sampleResponses(s, me, v, know, pool, opts.samples ?? 40);
    if (responses.length === 0) continue;
    for (const give of s.hands[me]) {
      if (opts.zeroInject && give.color !== 'K') continue;
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
      if (opts.zeroBonus && give.color === 'K' && !s.exchanged[opp][v]) score += 60;
      // 상대 오픈과 양립하는 고득점 카드를 건네는 건 상대를 돕는 일 —
      // 단, 내 완성(부분집합 개선)을 막을 만큼 크면 안 되므로 소폭만 감점
      if (!oppOpenColors.has(give.color) && !oppOpenNums.has(give.num) && give.num >= 4) {
        score -= give.num * 3;
      }
      if (!best || score > best.score) {
        best = { virtualIdx: v, giveCardId: give.id, score };
      }
    }
  }
  return best;
}

export function aiChooseAction(s: QState, me: PlayerId): AiAction {
  if (currentActor(s) !== me) throw new Error('not AI turn');
  const best = scanExchanges(s, me, { zeroBonus: true });

  const unvisited = s.exchanged[me].filter((x) => !x).length;
  if (best) {
    // 방문 의무가 남았으면 다소 손해라도 소화, 아니면 이득일 때만
    const threshold = unvisited > 0 ? -30 : 5;
    if (best.score >= threshold) {
      return { type: 'exchange', virtualIdx: best.virtualIdx, giveCardId: best.giveCardId };
    }
  }
  if (canDecline(s, me)) return { type: 'decline' };
  return best
    ? { type: 'exchange', virtualIdx: best.virtualIdx, giveCardId: best.giveCardId }
    : { type: 'decline' };
}

// ---------- 메타 행동 해석 (학습·평가·실전 공용 — 모델 불일치 차단) ----------

/** 메타 해석의 가상 응답 표본 수 — 학습·실전이 같은 값을 써야 한다 */
export const META_SAMPLES = 16;

/** 오픈 메타 → 오픈할 카드 id */
export function resolveOpenMeta(s: QState, me: PlayerId, code: MetaCode): number {
  return code === 'l' ? aiChooseOpenLow(s, me) : aiChooseOpen(s, me);
}

/** 교환 메타 → 엔진 행동 */
export function resolveXchgMeta(s: QState, me: PlayerId, code: MetaCode): AiAction {
  if (code === 'p') return { type: 'decline' };
  if (code === 'z') {
    const z = scanExchanges(s, me, { zeroBonus: false, zeroInject: true, samples: META_SAMPLES });
    if (z) return { type: 'exchange', virtualIdx: z.virtualIdx, giveCardId: z.giveCardId };
    // z가 키 플래그상 가능했는데 스캔이 비면(이론상 없음) e로 폴백
  }
  const e = scanExchanges(s, me, { zeroBonus: false, samples: META_SAMPLES });
  if (e) return { type: 'exchange', virtualIdx: e.virtualIdx, giveCardId: e.giveCardId };
  return { type: 'decline' };
}

// ---------- 정책 우선 선택 (게임 화면이 쓰는 진입점) ----------

function samplePolicyCode(key: string, legal: MetaCode[]): MetaCode | null {
  const entry = lookupPolicy(key);
  if (!entry) return null;
  // 저장 항목 중 현재 합법 메타만 남기고 재정규화
  const pairs = Object.entries(entry).filter(([c]) => legal.includes(c as MetaCode));
  const total = pairs.reduce((a, [, p]) => a + p, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [c, p] of pairs) {
    r -= p;
    if (r <= 0) return c as MetaCode;
  }
  return pairs[pairs.length - 1][0] as MetaCode;
}

/** 멀리건 결정 — 학습 정책 우선, 미적중이면 기존 휴리스틱 */
export function chooseMulligan(s: QState, me: PlayerId): boolean {
  const code = samplePolicyCode(mullKey(s.hands[me], s.mulligansUsed[me]), ['k', 'm']);
  if (code) return code === 'm';
  return aiWantsMulligan(s.hands[me]);
}

/** 오픈 결정 — 학습 정책 우선 */
export function chooseOpen(s: QState, me: PlayerId): number {
  const code = samplePolicyCode(openKey(s, me), ['h', 'l']);
  return resolveOpenMeta(s, me, code ?? 'h');
}

/** 교환 결정 — 학습 정책 우선 */
export function chooseExchange(s: QState, me: PlayerId): AiAction {
  const metas = xchgMetas(s, me);
  if (metas.length === 1) {
    // 강제수 — 학습기와 동일하게 정책 조회 없이 바로 실행
    return metas[0] === 'p' ? { type: 'decline' } : resolveXchgMeta(s, me, metas[0]);
  }
  const code = samplePolicyCode(xchgKey(s, me), metas);
  if (code) return resolveXchgMeta(s, me, code);
  return aiChooseAction(s, me);
}
