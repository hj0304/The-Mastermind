/**
 * 블라인드 포커 AI — 3단계 난이도.
 *
 * - easy   : 카운팅 없음, 상대 카드만 보고 단순 반응 + 무작위성
 * - normal : 정확한 카드 카운팅 기반 승률 + 팟 오즈 의사결정
 * - hard   : normal에 더해
 *            ① 상대 행동으로 "자기 이마 카드"를 베이지안 역추론
 *               (상대는 내 카드를 보고 행동하므로, 상대의 레이즈/콜/폴드가 내 카드의 단서다)
 *            ② 쇼다운 때마다 상대의 실제 카드와 행동을 대조해 블러핑 성향·폴드 성향을 학습
 *            ③ 학습된 성향으로 블러프/밸류 베팅 비율을 조절 (localStorage 누적)
 *
 * AI는 자기 카드를 절대 보지 않는다 — 사람과 동일한 정보만 사용한다.
 */

import type { BpAction, BpState, PlayerId } from './engine.ts';
import { legalInfo, potSize, unseenCounts } from './engine.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface AiContext {
  difficulty: Difficulty;
  me: PlayerId;
}

// ---------- 상대(사람) 성향 학습 ----------

interface OpponentModel {
  /** 상대가 낮은 카드(≤5)를 들고 레이즈한 횟수 / 낮은 카드로 행동한 횟수 → 블러핑 성향 */
  bluffRaises: number;
  weakActions: number;
  /** 상대가 레이즈에 폴드한 횟수 / 레이즈를 마주한 횟수 → 폴드 성향 */
  foldsToRaise: number;
  facedRaises: number;
  games: number;
}

const STORAGE_KEY = 'mastermind.blindpoker.opponent.v1';

export function loadOpponentModel(): OpponentModel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as OpponentModel;
  } catch { /* 무시 */ }
  return { bluffRaises: 0, weakActions: 0, foldsToRaise: 0, facedRaises: 0, games: 0 };
}

function saveOpponentModel(m: OpponentModel): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch { /* 무시 */ }
}

/**
 * 핸드 종료 시 호출: 이번 핸드에서 관찰된 사람(human)의 행동을 성향 모델에 반영.
 * humanCard는 쇼다운/무승부/사람 폴드로 공개된 경우에만 전달된다.
 */
export function recordHandObservations(
  s: BpState,
  human: PlayerId,
  humanCardRevealed: number | null,
): void {
  const m = loadOpponentModel();
  let humanFacedRaise = false;
  for (let i = 0; i < s.actions.length; i++) {
    const { player, action } = s.actions[i];
    if (player !== human) {
      if (action.type === 'raise') humanFacedRaise = true;
      continue;
    }
    if (humanFacedRaise) {
      m.facedRaises += 1;
      if (action.type === 'fold') m.foldsToRaise += 1;
      humanFacedRaise = false;
    }
    if (humanCardRevealed !== null && humanCardRevealed <= 5) {
      m.weakActions += 1;
      if (action.type === 'raise') m.bluffRaises += 1;
    }
  }
  saveOpponentModel(m);
}

export function recordGameEnd(): void {
  const m = loadOpponentModel();
  m.games += 1;
  saveOpponentModel(m);
}

/** 라플라스 평활된 성향 추정 */
function tendencies(m: OpponentModel): { bluffRate: number; foldRate: number } {
  return {
    bluffRate: (m.bluffRaises + 1) / (m.weakActions + 4), // 기본 ~0.25
    foldRate: (m.foldsToRaise + 1.5) / (m.facedRaises + 4), // 기본 ~0.38
  };
}

// ---------- 자기 카드 베이지안 역추론 (hard 전용) ----------

/**
 * 상대의 행동 모델: 상대가 (내 이마 카드 = c)를 보고 있을 때 각 행동을 할 확률.
 * 상대의 승리 신념 ≈ (자기 카드가 c보다 높을 가능성) ≈ (10.5 - c) / 10.
 */
function humanActionLikelihood(
  actionType: BpAction['type'],
  myCard: number,
  facingRaise: boolean,
  bluffRate: number,
): number {
  const belief = (10.5 - myCard) / 10; // 상대가 이길 것이라 느끼는 정도
  let pRaise = 0.15 + 0.6 * belief;
  pRaise = pRaise * (1 - bluffRate) + bluffRate * 0.5; // 블러퍼는 카드와 무관하게 레이즈 섞음
  let pFold = facingRaise ? Math.max(0, 0.75 - belief) : 0.02;
  let pCall = Math.max(0.05, 1 - pRaise - pFold);
  const total = pRaise + pFold + pCall;
  pRaise /= total; pFold /= total; pCall /= total;
  return actionType === 'raise' ? pRaise : actionType === 'fold' ? pFold : pCall;
}

/**
 * hard: 내 이마 카드의 사후 분포.
 * 사전 = 카운팅 잔여 분포, 우도 = 이번 핸드 상대 행동들.
 */
function myCardPosterior(s: BpState, ctx: AiContext, bluffRate: number): number[] {
  const counts = unseenCounts(s, ctx.me);
  const weights = new Array<number>(11).fill(0);
  for (let c = 1; c <= 10; c++) weights[c] = counts[c];

  if (ctx.difficulty === 'hard') {
    let myRaisePending = false; // 내(AI) 레이즈에 상대가 아직 응답하지 않은 상태인가
    for (const { player, action } of s.actions) {
      if (player === ctx.me) {
        if (action.type === 'raise') myRaisePending = true;
        continue;
      }
      // 상대(사람)의 행동 — 내 카드 c에 대한 우도 갱신
      for (let c = 1; c <= 10; c++) {
        if (weights[c] <= 0) continue;
        weights[c] *= humanActionLikelihood(action.type, c, myRaisePending, bluffRate);
      }
      myRaisePending = false;
    }
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    const c2 = unseenCounts(s, ctx.me);
    const t2 = c2.reduce((a, b) => a + b, 0);
    return c2.map((x) => x / Math.max(t2, 1));
  }
  return weights.map((w) => w / total);
}

// ---------- 의사결정 ----------

export function chooseAiAction(s: BpState, ctx: AiContext): BpAction {
  if (s.toAct !== ctx.me || s.phase !== 'betting') throw new Error('not AI turn');
  const info = legalInfo(s);
  const oppCard = s.cards[1 - ctx.me]; // 상대 카드는 보인다

  if (ctx.difficulty === 'easy') return chooseEasy(oppCard, info);

  const model = loadOpponentModel();
  const { bluffRate, foldRate } = tendencies(model);

  // 승률 계산: P(내 카드 > 상대 카드)
  const posterior = myCardPosterior(s, ctx, bluffRate);
  let winP = 0;
  let tieP = 0;
  for (let c = 1; c <= 10; c++) {
    if (c > oppCard) winP += posterior[c];
    if (c === oppCard) tieP += posterior[c];
  }
  const pTenFoldPenalty = posterior[10]; // 폴드 시 10 페널티를 맞을 확률

  const pot = potSize(s); // 현재 팟 (양쪽 기투자 + 이월 포함)
  const callCost = info.callCost;

  // 순이익 기준 기대값:
  // 콜: 이기면 +pot (상대 기투자 포함), 지면 -callCost
  const evCall = winP * pot - (1 - winP - tieP) * callCost;
  // 폴드: 추가 손실은 10 페널티 기대값뿐 (기투자는 매몰)
  const evFold = -(pTenFoldPenalty * 10);
  // 레이즈 R: 상대 폴드 시 +pot, 콜 받으면 이기면 +(pot+R), 지면 -(callCost+R)
  const pFoldToUs = Math.min(0.8, foldRate * (ctx.difficulty === 'hard' ? 1.1 : 1));
  let bestRaise = 0;
  let evRaise = -Infinity;
  for (const r of info.raiseOptions) {
    const ev =
      pFoldToUs * pot +
      (1 - pFoldToUs) * (winP * (pot + r) - (1 - winP - tieP) * (callCost + r));
    if (ev > evRaise) {
      evRaise = ev;
      bestRaise = r;
    }
  }

  // 소량의 무작위 편차 (normal은 실수 섞임)
  const jitter = ctx.difficulty === 'hard' ? 0.2 : 0.8;
  const jCall = evCall + (Math.random() - 0.5) * jitter;
  const jFold = evFold + (Math.random() - 0.5) * jitter;
  let jRaise = evRaise + (Math.random() - 0.5) * jitter;

  // 레이즈 전쟁 무한루프 방지: 같은 핸드에서 내가 이미 3번 레이즈했으면 콜/폴드만
  const myRaises = s.actions.filter((a) => a.player === ctx.me && a.action.type === 'raise').length;
  if (myRaises >= 3) jRaise = -Infinity;

  // hard: 밸런싱 블러프 — 승률이 낮아도 가끔 최소 레이즈로 압박 (상대 폴드 성향에 비례)
  if (
    ctx.difficulty === 'hard' &&
    winP < 0.35 &&
    myRaises === 0 &&
    info.raiseOptions.length > 0 &&
    Math.random() < 0.12 + 0.25 * foldRate
  ) {
    return { type: 'raise', amount: info.raiseOptions[0] };
  }

  if (jRaise >= jCall && jRaise >= jFold && bestRaise > 0) {
    return { type: 'raise', amount: bestRaise };
  }
  if (jFold > jCall && callCost > 0) return { type: 'fold' };
  return { type: 'call' };
}

function chooseEasy(oppCard: number, info: ReturnType<typeof legalInfo>): BpAction {
  // 상대 카드가 낮으면 "내가 이기겠지"라고 착각하고 공격적으로 (초보자 흉내)
  const r = Math.random();
  if (oppCard <= 4) {
    if (r < 0.5 && info.raiseOptions.length > 0) return { type: 'raise', amount: info.raiseOptions[0] };
    return { type: 'call' };
  }
  if (oppCard >= 8) {
    if (r < 0.35 && info.callCost > 0) return { type: 'fold' };
    if (r < 0.85) return { type: 'call' };
    return info.raiseOptions.length > 0 ? { type: 'raise', amount: info.raiseOptions[0] } : { type: 'call' };
  }
  if (r < 0.2 && info.raiseOptions.length > 0) return { type: 'raise', amount: info.raiseOptions[0] };
  if (r < 0.3 && info.callCost > 2) return { type: 'fold' };
  return { type: 'call' };
}
