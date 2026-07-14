/**
 * 모노크롬 AI — 3단계 난이도.
 *
 * - easy   : 약한 휴리스틱 + 큰 무작위성
 * - normal : 사후확률 기반 근시안 플레이 (마진 경제 적용, 실수 섞임)
 * - hard   : 베이지안 손패 추적 + 상대 신념 모델링(상대가 내 색 정보로 무엇을 아는지까지 계산)
 *            + 마진 경제("이길 땐 작게, 질 땐 크게") + 종반 완전 탐색
 *            + 플레이어 성향 학습(라운드별 랭크 분포, localStorage 누적)
 *
 * AI는 상대 손패를 절대 직접 보지 않는다 — 공개 정보(색, 승패, 무승부)로만 추론한다.
 */

import type { MonoState, PlayerId, TileColor, OppHandCandidate } from './engine.ts';
import {
  currentPlayer,
  legalMoves,
  opponentHandDistribution,
  opponentTileProbabilities,
  tileColor,
} from './engine.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';

// ---------- 플레이어 성향 학습 (hard 전용) ----------

/** 라운드 인덱스(0~8)별로 사람이 낸 타일 랭크(0~8)의 빈도. */
interface TendencyModel {
  /** counts[roundIdx][tile] */
  counts: number[][];
  games: number;
}

const STORAGE_KEY = 'mastermind.monochrome.tendency.v1';

export function loadTendency(): TendencyModel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TendencyModel;
  } catch { /* localStorage 불가 환경이면 무시 */ }
  return { counts: Array.from({ length: 9 }, () => new Array(9).fill(0)), games: 0 };
}

export function recordHumanPlay(roundIdx: number, tile: number): void {
  try {
    const m = loadTendency();
    m.counts[Math.min(roundIdx, 8)][tile] += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch { /* 무시 */ }
}

export function recordGameEnd(): void {
  try {
    const m = loadTendency();
    m.games += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch { /* 무시 */ }
}

/** 학습된 성향으로 손패 분포의 가중치를 보정한다 (관측이 쌓일수록 영향 증가, 상한 있음). */
function applyTendencyToHands(
  dist: OppHandCandidate[],
  roundIdx: number,
  model: TendencyModel,
): OppHandCandidate[] {
  const row = model.counts[Math.min(roundIdx, 8)];
  const totalObs = row.reduce((a, b) => a + b, 0);
  if (totalObs < 3) return dist;
  const strength = Math.min(totalObs / 25, 0.5);
  const smoothed = row.map((c) => (c + 1) / (totalObs + 9));
  // "이 라운드에 사람이 잘 내는 타일"이 아직 손에 남아있을 법한 손패는 가중치를 낮춘다
  // (= 이미 냈을 가능성이 높은 타일이 남아있는 가설은 약화)
  const reweighted = dist.map((c) => {
    const stillHolding = c.hand.reduce((a, n) => a + smoothed[n], 0) / Math.max(c.hand.length, 1);
    const factor = 1 - strength * stillHolding;
    return { hand: c.hand, weight: c.weight * Math.max(factor, 0.05) };
  });
  const total = reweighted.reduce((a, c) => a + c.weight, 0);
  return total > 0 ? reweighted.map((c) => ({ ...c, weight: c.weight / total })) : dist;
}

// ---------- 공용 유틸 ----------

interface AiContext {
  difficulty: Difficulty;
  /** AI의 PlayerId */
  me: PlayerId;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 주변확률 벡터에서 특정 색만 남기고 정규화 */
function conditionOnColor(probs: number[], color: TileColor): number[] {
  const masked = probs.map((p, n) => (tileColor(n) === color ? p : 0));
  const sum = masked.reduce((a, b) => a + b, 0);
  return sum > 0 ? masked.map((x) => x / sum) : masked;
}

/**
 * 합리적 후공 정책: 자신의 손패 hand와 "상대(=선) 타일 값에 대한 신념" belief가 주어졌을 때
 * 응수를 고른다. 이길 수 있으면 최소 마진으로, 가망 없으면 최저 타일 투척.
 */
function rationalFollowerResponse(hand: number[], belief: number[], threshold = 0.65): number {
  const sorted = [...hand].sort((a, b) => a - b);
  for (const t of sorted) {
    const winP = belief.reduce((acc, p, n) => acc + (t > n ? p : 0), 0);
    if (winP >= threshold) return t;
  }
  return sorted[0]; // 이길 가망 없음 → 최저 타일 버리기
}

// ---------- 종반 완전 탐색 (hard 전용) ----------

/**
 * 결정화(determinized) 미니맥스: 양쪽 손패를 확정해 두고 남은 라운드를 완전 탐색.
 * 반환: viewer(A) 기준 기대 결과 (+1 승 / 0 무 / -1 패).
 * 메모이제이션으로 손패 6장까지 실시간 탐색 가능.
 */
const mmMemo = new Map<number, number>();

function handMask(hand: number[]): number {
  let m = 0;
  for (const t of hand) m |= 1 << t;
  return m;
}

function minimaxValue(
  aHand: number[],
  bHand: number[],
  aIsLeader: boolean,
  diff: number, // A 점수 - B 점수
): number {
  if (aHand.length === 0) {
    return diff > 0 ? 1 : diff < 0 ? -1 : 0; // 동점(연장)은 중립 평가
  }
  // 남은 라운드로 승부가 이미 확정된 경우 조기 평가
  if (Math.abs(diff) > aHand.length) return diff > 0 ? 1 : -1;
  const key =
    handMask(aHand) | (handMask(bHand) << 9) | ((aIsLeader ? 1 : 0) << 18) | ((diff + 9) << 19);
  const cached = mmMemo.get(key);
  if (cached !== undefined) return cached;
  const result = minimaxCore(aHand, bHand, aIsLeader, diff);
  mmMemo.set(key, result);
  return result;
}

function minimaxCore(
  aHand: number[],
  bHand: number[],
  aIsLeader: boolean,
  diff: number,
): number {
  if (aIsLeader) {
    // A가 선: A는 자신에게 최선, 이후 B가 응수(B에게 최선 = A에게 최악)
    let best = -Infinity;
    for (const a of aHand) {
      let worst = Infinity;
      for (const b of bHand) {
        const roundDiff = a > b ? 1 : a < b ? -1 : 0;
        const nextALeader = roundDiff > 0 ? true : roundDiff < 0 ? false : aIsLeader;
        const v = minimaxValue(
          aHand.filter((x) => x !== a),
          bHand.filter((x) => x !== b),
          nextALeader,
          diff + roundDiff,
        );
        worst = Math.min(worst, v);
      }
      best = Math.max(best, worst);
    }
    return best;
  }
  // B가 선: B가 먼저 고르고(A에게 최악), A가 응수(A에게 최선)
  let worst = Infinity;
  for (const b of bHand) {
    let best = -Infinity;
    for (const a of aHand) {
      const roundDiff = a > b ? 1 : a < b ? -1 : 0;
      const nextALeader = roundDiff > 0 ? true : roundDiff < 0 ? false : false;
      const v = minimaxValue(
        aHand.filter((x) => x !== a),
        bHand.filter((x) => x !== b),
        nextALeader,
        diff + roundDiff,
      );
      best = Math.max(best, v);
    }
    worst = Math.min(worst, best);
  }
  return worst;
}

/** 종반: 가능한 상대 손패 전수에 대해 각 수의 기대값을 계산해 최선 수를 고른다. */
function chooseEndgameExact(
  s: MonoState,
  hand: number[],
  dist: OppHandCandidate[],
  ctx: AiContext,
): number {
  const me = ctx.me;
  const diff = s.scores[me] - s.scores[1 - me];
  const amFollower = s.pending !== null;

  let bestTile = hand[0];
  let bestEV = -Infinity;

  for (const t of hand) {
    let ev = 0;
    for (const cand of dist) {
      if (amFollower) {
        // 상대 손패 후보 중 pending 색과 일치하는 타일이 실제 pending — 균등 분기
        const pendingColor = tileColor(s.pending!);
        const options = cand.hand.filter((n) => tileColor(n) === pendingColor);
        if (options.length === 0) continue;
        for (const x of options) {
          const roundDiff = t > x ? 1 : t < x ? -1 : 0;
          const meLeadsNext = roundDiff > 0 ? true : roundDiff < 0 ? false : s.leader === me;
          const v = minimaxValue(
            hand.filter((y) => y !== t),
            cand.hand.filter((y) => y !== x),
            meLeadsNext,
            diff + roundDiff,
          );
          ev += (cand.weight / options.length) * v;
        }
      } else {
        // 내가 선: 상대는 합리적 후공(내 타일 값이 아니라 색 기반 신념으로) 응수한다고 모델링
        const oppBeliefAboutMe = conditionOnColor(
          opponentTileProbabilities(s, (1 - me) as PlayerId),
          tileColor(t),
        );
        const r = rationalFollowerResponse(cand.hand, oppBeliefAboutMe);
        const roundDiff = t > r ? 1 : t < r ? -1 : 0;
        const meLeadsNext = roundDiff > 0 ? true : roundDiff < 0 ? false : true;
        const v = minimaxValue(
          hand.filter((y) => y !== t),
          cand.hand.filter((y) => y !== r),
          meLeadsNext,
          diff + roundDiff,
        );
        ev += cand.weight * v;
      }
    }
    if (ev > bestEV) {
      bestEV = ev;
      bestTile = t;
    }
  }
  return bestTile;
}

// ---------- 메인 의사결정 ----------

export function chooseAiMove(s: MonoState, ctx: AiContext): number {
  const me = ctx.me;
  if (currentPlayer(s) !== me) throw new Error('not AI turn');
  const hand = legalMoves(s);
  if (hand.length === 1) return hand[0];

  if (ctx.difficulty === 'easy') return chooseEasy(s, hand);

  // 상대 잔여 손패 분포 (pending이 있으면 pending 타일 포함)
  let dist = opponentHandDistribution(s, me);
  if (ctx.difficulty === 'hard') {
    const roundIdx = s.history.length % 9;
    dist = applyTendencyToHands(dist, roundIdx, loadTendency());
  }

  // 종반(양쪽 6장 이하): 완전 탐색
  if (ctx.difficulty === 'hard' && hand.length <= 6) {
    return chooseEndgameExact(s, hand, dist, ctx);
  }

  const marginals = new Array<number>(9).fill(0);
  for (const c of dist) for (const n of c.hand) marginals[n] += c.weight;

  const amFollower = s.pending !== null;
  if (amFollower) {
    const pendingColor = tileColor(s.pending!);
    const belief = conditionOnColor(marginals, pendingColor);
    return chooseAsFollower(s, hand, belief, ctx);
  }
  return chooseAsLeader(s, hand, dist, ctx);
}

function chooseEasy(s: MonoState, hand: number[]): number {
  // 70% 무작위, 30% "상대 색을 보고 어중간하게 반응"하는 초심자 흉내
  if (s.pending !== null && Math.random() < 0.3) {
    const c = tileColor(s.pending);
    const guess = c === 'black' ? 5 : 4;
    const above = hand.filter((t) => t > guess);
    if (above.length > 0) return Math.min(...above);
  }
  return pickRandom(hand);
}

/** 승점 압박 지수: 지고 있고 남은 라운드가 적을수록 1에 가까움 */
function pressure(s: MonoState, me: PlayerId): number {
  const diff = s.scores[1 - me] - s.scores[me];
  const remaining = Math.max(s.hands[me].length, 1);
  if (diff <= 0) return 0;
  return Math.min(diff / remaining, 1);
}

/**
 * 후공: 기대효용 = P(승) + 0.15·P(무) − 타일비용.
 * 비용항 덕분에 "이길 수 있는 최소 타일"이 자연히 선택되고, 가망 없으면 최저 타일이 나온다.
 */
function chooseAsFollower(
  s: MonoState,
  hand: number[],
  belief: number[],
  ctx: AiContext,
): number {
  const costScale = 1 - 0.7 * pressure(s, ctx.me); // 몰리면 비용 무시하고 이기러 간다
  let best = hand[0];
  let bestU = -Infinity;
  for (const t of hand) {
    const winP = belief.reduce((acc, p, n) => acc + (t > n ? p : 0), 0);
    const drawP = belief[t] ?? 0;
    const cost = Math.pow(t / 8, 2) * 0.55 * costScale;
    const u = winP + 0.15 * drawP - cost;
    if (u > bestU) {
      bestU = u;
      best = t;
    }
  }
  return maybeNoise(best, hand, ctx);
}

/**
 * 선공: 각 후보 타일에 대해 "상대가 내 색을 보고 합리적으로 응수"하는 상황을
 * 상대 손패 후보 전수에 대해 시뮬레이션한다.
 * 상대의 신념(내 잔여 타일에 대한 상대의 사후확률)도 정확히 계산해 사용한다.
 */
function chooseAsLeader(
  s: MonoState,
  hand: number[],
  dist: OppHandCandidate[],
  ctx: AiContext,
): number {
  const me = ctx.me;
  // 상대가 나에 대해 가진 신념 (상대 시점의 내 잔여 타일 분포)
  const oppViewOfMe = opponentTileProbabilities(s, (1 - me) as PlayerId);
  const costScale = 1 - 0.7 * pressure(s, me);

  const evals = hand.map((t) => {
    const myColorBelief = conditionOnColor(oppViewOfMe, tileColor(t));
    let ev = 0;
    for (const cand of dist) {
      const r = rationalFollowerResponse(cand.hand, myColorBelief);
      const roundScore = t > r ? 1 : t < r ? -1 : 0;
      // 마진 경제: 내가 쓴 타일 대비 상대가 쓴 타일 (상대 고급 타일을 빼내면 이득)
      const economy = (r - t) * 0.06 * costScale;
      ev += cand.weight * (roundScore + economy);
    }
    return { t, score: ev };
  });

  evals.sort((a, b) => b.score - a.score);

  // 소프트맥스 믹싱으로 패턴 노출 방지 (hard는 낮은 온도)
  const temp = ctx.difficulty === 'hard' ? 0.12 : 0.4;
  const maxS = evals[0].score;
  const weights = evals.map((e) => Math.exp((e.score - maxS) / temp));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < evals.length; i++) {
    r -= weights[i];
    if (r <= 0) return evals[i].t;
  }
  return evals[0].t;
}

/** normal 난이도는 가끔 실수를 섞는다 */
function maybeNoise(choice: number, hand: number[], ctx: AiContext): number {
  const noise = ctx.difficulty === 'hard' ? 0.02 : 0.15;
  if (Math.random() < noise) return pickRandom(hand);
  return choice;
}
