/**
 * 블라인드 홀덤 AI.
 *
 * 사용 가능한 정보 (사람과 동일 — docs/GAME_RULES.md §15):
 *  - 공유 카드 2장 (항상 공개) → **상대 족보는 정확히 계산 가능**
 *  - 상대 이마 카드 (항상 보임)
 *  - 공개된 과거 카드 (공유·상대 이마·공개된 내 이마) → 잔량 카운팅
 *  - 내 이마 카드는 **읽지 않는다**. s.cards[me]에 접근하지 않는 것이 이 파일의 불변식.
 *
 * 이 게임의 구조적 특징은 §3(블라인드 포커)과 정반대의 비대칭이다:
 *  블라인드 포커 = "상대 카드만 안다"  /  블라인드 홀덤 = "상대 족보를 알고 내 족보만 모른다".
 * 그래서 승률을 **내 이마 카드에 대한 사후분포로 정확히 적분**할 수 있고,
 * 폴드 페널티 위험(스트레이트/트리플)도 같은 분포에서 바로 나온다.
 */

import type { BhAction, BhState, PlayerId } from './engine.ts';
import { COMBO_PENALTY, RANK_STRAIGHT, legalInfo, potSize, riskProfile } from './engine.ts';
import { winOdds } from './odds.ts';
import type { WinOdds } from './odds.ts';
import { infoKey, toAction } from './infoset.ts';
import { lookupPolicy } from './policy.ts';

export { winOdds };
export type { WinOdds };

export interface AiContext {
  me: PlayerId;
}

// ---------- 상대 성향 학습 (공개 정보만 누적) ----------

const STORAGE_KEY = 'mm-blind-holdem-model';

export interface OpponentModel {
  /** 관찰한 핸드 수 */
  hands: number;
  /** 사람이 폴드한 횟수 */
  folds: number;
  /** 사람이 레이즈한 횟수 */
  raises: number;
  /** 레이즈 총량 (평균 폭 계산용) */
  raiseSum: number;
  /** 안전한 보드(페널티 위험 없음)에서 폴드한 횟수 */
  safeFolds: number;
  /** 안전한 보드에서 결정을 내린 횟수 */
  safeDecisions: number;
  games: number;
}

function emptyModel(): OpponentModel {
  return { hands: 0, folds: 0, raises: 0, raiseSum: 0, safeFolds: 0, safeDecisions: 0, games: 0 };
}

export function loadOpponentModel(): OpponentModel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyModel();
    return { ...emptyModel(), ...(JSON.parse(raw) as Partial<OpponentModel>) };
  } catch {
    return emptyModel();
  }
}

function save(m: OpponentModel): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    /* 저장 실패는 무시 (시크릿 모드 등) */
  }
}

/** 핸드가 끝날 때 사람의 행동을 기록 (공개 정보만) */
export function recordHandObservations(s: BhState, human: PlayerId): void {
  const h = s.history[s.history.length - 1];
  if (!h) return;
  const m = loadOpponentModel();
  m.hands += 1;
  const safe = riskProfile(h.community) === 'safe';
  let decided = false;
  for (const a of s.actions) {
    if (a.player !== human) continue;
    decided = true;
    if (a.action.type === 'raise') {
      m.raises += 1;
      m.raiseSum += a.action.amount ?? 0;
    }
  }
  if (h.outcome === 'fold' && h.folder === human) {
    m.folds += 1;
    if (safe) m.safeFolds += 1;
  }
  if (safe && decided) m.safeDecisions += 1;
  save(m);
}

export function recordGameEnd(): void {
  const m = loadOpponentModel();
  m.games += 1;
  save(m);
}

// ---------- 행동 선택 ----------

/** 성향 기반 보정값 */
function tendency(m: OpponentModel) {
  const foldRate = m.hands > 0 ? m.folds / m.hands : 0.25;
  const avgRaise = m.raises > 0 ? m.raiseSum / m.raises : 2;
  // 안전한 보드에서도 잘 접는 상대 = 압박에 약함
  const safeFoldRate = m.safeDecisions >= 4 ? m.safeFolds / m.safeDecisions : foldRate;
  return { foldRate, avgRaise, safeFoldRate, samples: m.hands };
}

export function chooseAiAction(s: BhState, ctx: AiContext): BhAction {
  // 학습된 균형 전략이 이 정보집합을 알고 있으면 그것을 따른다 (없으면 아래 휴리스틱)
  const learned = policyAction(s, ctx.me);
  if (learned) return learned;
  return heuristicAction(s, ctx);
}

/** 학습 정책 조회 — 미로드/미적중이면 null */
function policyAction(s: BhState, me: PlayerId): BhAction | null {
  const entry = lookupPolicy(infoKey(s, me));
  if (!entry) return null;
  let r = Math.random();
  let pick = 'c';
  for (const [code, p] of Object.entries(entry)) {
    r -= p;
    if (r <= 0) {
      pick = code;
      break;
    }
  }
  return toAction(s, pick) as BhAction;
}

/**
 * 학습 정책을 쓰지 않는 순수 휴리스틱 — 평가에서 "학습 전 AI"를 상대로 세울 때 쓴다.
 * 승/무/패·페널티 확률을 정확히 적분해 기대값으로 판단한다.
 */
export function heuristicAction(s: BhState, ctx: AiContext): BhAction {
  const me = ctx.me;
  const opp = (1 - me) as PlayerId;
  const info = legalInfo(s);
  const odds = winOdds(s, me);
  const pot = potSize(s);
  const c = info.callCost;

  // 기대값 — 현재 스택 기준의 상대 변화량
  // 폴드: 추가 지출은 없지만 스트레이트/트리플이면 페널티
  const evFold = -COMBO_PENALTY * odds.penalty;
  // 콜: c를 내고 쇼다운. 무승부는 팟이 이월되므로 절반 회수로 근사
  const evCall = -c + odds.win * (pot + c) + odds.draw * ((pot + c) / 2);

  const t = tendency(loadOpponentModel());

  // 상대가 이미 강한 족보(스트레이트/트리플)를 들고 있으면 승률이 낮아 콜이 손해다.
  // 반대로 안전한 보드에서는 폴드가 공짜라 접기 쉬워진다 — 이 게임의 핵심 긴장.
  const foldIsFree = odds.penalty < 0.02;

  // 레이즈 판단: 승률이 충분히 높거나, 잘 접는 상대에게 압박
  const canRaise = info.maxRaise >= 1;
  const strong = odds.win > 0.6;
  const veryStrong = odds.win > 0.75;

  // 블러프: 안전한 보드에서 상대가 접기 쉬운 걸 알기에 압박 가치가 있다
  const bluffUrge = t.safeFoldRate > 0.3 ? 0.22 : 0.12;

  if (canRaise) {
    if (veryStrong) {
      const size = Math.max(1, Math.min(info.maxRaise, Math.round(pot * 0.7)));
      return { type: 'raise', amount: size };
    }
    if (strong && Math.random() < 0.7) {
      const size = Math.max(1, Math.min(info.maxRaise, Math.round(pot * 0.4)));
      return { type: 'raise', amount: size };
    }
    // 상대가 강한 족보를 들고 있는데 내가 안전 보드에서 밀리는 상황이면 블러프는 자제
    if (odds.win > 0.42 && Math.random() < bluffUrge) {
      const size = Math.max(1, Math.min(info.maxRaise, 1 + Math.floor(Math.random() * 3)));
      return { type: 'raise', amount: size };
    }
  }

  if (c <= 0) {
    // 추가 비용 없음 — 콜(즉시 쇼다운)이 항상 폴드보다 낫다
    return { type: 'call' };
  }

  // 폴드가 공짜인 보드에서는 기대값 비교를 그대로 따르고,
  // 페널티 위험이 있으면 그 비용이 이미 evFold에 반영되어 콜 쪽으로 기운다.
  if (evCall >= evFold) return { type: 'call' };

  // 근소한 차이는 혼합해서 읽히지 않게
  const margin = evFold - evCall;
  if (margin < 0.6 && Math.random() < 0.35) return { type: 'call' };

  // 페널티 위험이 큰데 폴드가 유일하게 나은 선택이면, 상대 족보가 확정적으로 강할 때만
  if (!foldIsFree && odds.oppRank < RANK_STRAIGHT && Math.random() < 0.3) {
    return { type: 'call' };
  }

  void opp;
  return { type: 'fold' };
}
