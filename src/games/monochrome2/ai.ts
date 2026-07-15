/**
 * 모노크롬 II AI — 잔여 포인트 구간 추적 + 점수 압박 기반 입찰.
 *
 * AI가 쓰는 공개 정보 (사람과 동일):
 * - 상대 제시의 자릿수(흑=0~9 / 백=10~99), 라운드 승패(부등호), 무승부(값 확정)
 * - 상대 잔여 포인트의 5단계 게이지 (제시 직후 갱신되므로 선의 지출 폭도 단서)
 *
 * 전략 핵심:
 * - 상대 잔여 상한이 낮으면 "상한+1" 입찰로 확정승 (게이지 스퀴즈)
 * - 이길 땐 싸게(흑 상대 10), 버릴 땐 0 — 포인트 효율 관리
 * - 승점 4 상황(양쪽 모두)에서는 라운드 가치가 게임 전체가 된다
 */

import type { M2State, PlayerId } from './engine.ts';
import { bidColor, currentPlayer, gaugeTier } from './engine.ts';

// ---------- 상대 잔여 포인트 구간 추적 ----------

export interface Bounds {
  lo: number;
  hi: number;
}

/**
 * me 시점에서 상대의 잔여 포인트 구간을 계산.
 * 히스토리의 각 상대 제시에 대해: 자릿수 범위 ∩ 승패 부등호 ∩ (무승부면 정확값)
 * 그리고 매 시점 게이지 밴드와 교차.
 */
export function opponentPointBounds(s: M2State, me: PlayerId): Bounds {
  const opp = (1 - me) as PlayerId;
  let lo = 99;
  let hi = 99;
  // 세트 전환(연장) 시 포인트 리셋 — 현재 세트의 히스토리만 계산
  const setRounds = s.history.slice(s.history.length - s.roundInSet);
  if (s.overtime > 0) {
    lo = 33;
    hi = 33;
  }
  for (const r of setRounds) {
    const oppBid = r.bids[opp];
    const myBid = r.bids[me];
    // 상대 제시의 가능 범위
    let bLo = bidColor(oppBid) === 'black' ? 0 : 10;
    let bHi = bidColor(oppBid) === 'black' ? 9 : 99;
    if (r.winner === null) {
      bLo = bHi = myBid; // 무승부 = 값 확정
    } else if (r.winner === opp) {
      bLo = Math.max(bLo, myBid + 1);
    } else {
      bHi = Math.min(bHi, myBid - 1);
    }
    lo = Math.max(0, lo - bHi);
    hi = Math.max(0, hi - bLo);
  }
  // 현재 게이지 밴드와 교차 (pending 지출도 이미 반영된 실제 게이지)
  const oppPointsNow = s.points[opp]; // 게이지는 이 값에서 파생 — AI는 티어만 사용
  const tier = gaugeTier(oppPointsNow);
  lo = Math.max(lo, tier * 20);
  hi = Math.min(hi, tier * 20 + 19);
  if (lo > hi) {
    // 추적 모순(이론상 없음) — 게이지 밴드로 폴백
    lo = tier * 20;
    hi = Math.min(tier * 20 + 19, 99);
  }
  return { lo, hi };
}

/**
 * 후공 시점: 선이 엎어둔 제시의 가능 구간.
 * 자릿수 범위 ∩ (제시 직전 잔여 구간 − 제시 직후 게이지 밴드)
 */
export function pendingBidBounds(s: M2State, me: PlayerId): Bounds {
  if (s.pending === null) throw new Error('no pending bid');
  const color = bidColor(s.pending);
  let lo = color === 'black' ? 0 : 10;
  let hi = color === 'black' ? 9 : 99;
  // 선의 제시 직후 게이지: points에는 이미 차감돼 있음
  const opp = (1 - me) as PlayerId;
  const before = opponentBoundsBeforePending(s, me);
  const tierNow = gaugeTier(s.points[opp]);
  const remainLo = tierNow * 20;
  const remainHi = tierNow * 20 + 19;
  // bid = before - now → bid ∈ [beforeLo - remainHi, beforeHi - remainLo]
  lo = Math.max(lo, before.lo - remainHi);
  hi = Math.min(hi, before.hi - remainLo);
  if (lo > hi) {
    lo = color === 'black' ? 0 : 10;
    hi = color === 'black' ? 9 : 99;
  }
  return { lo, hi };
}

/** pending 차감 전 시점의 상대 잔여 구간 (히스토리만 반영) */
function opponentBoundsBeforePending(s: M2State, me: PlayerId): Bounds {
  const opp = (1 - me) as PlayerId;
  let lo = s.overtime > 0 ? 33 : 99;
  let hi = lo;
  const setRounds = s.history.slice(s.history.length - s.roundInSet);
  for (const r of setRounds) {
    const oppBid = r.bids[opp];
    const myBid = r.bids[me];
    let bLo = bidColor(oppBid) === 'black' ? 0 : 10;
    let bHi = bidColor(oppBid) === 'black' ? 9 : 99;
    if (r.winner === null) bLo = bHi = myBid;
    else if (r.winner === opp) bLo = Math.max(bLo, myBid + 1);
    else bHi = Math.min(bHi, myBid - 1);
    lo = Math.max(0, lo - bHi);
    hi = Math.max(0, hi - bLo);
  }
  return { lo, hi };
}

// ---------- 사람 성향 학습 ----------

interface M2Tendency {
  /** AI의 흑 리드에 사람이 백(10+)으로 응수한 비율 — 자릿수는 공개 정보라 학습 가능 */
  contested: number;
  blackLeadsFaced: number;
  games: number;
}

const STORAGE_KEY = 'mastermind.monochrome2.tendency.v1';

export function loadTendency(): M2Tendency {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as M2Tendency;
  } catch { /* 무시 */ }
  return { contested: 0, blackLeadsFaced: 0, games: 0 };
}

/** AI가 흑으로 선공했을 때 사람의 응수 색(공개 정보)을 기록 */
export function recordContestForLearning(aiLedBlack: boolean, humanRespondedWhite: boolean): void {
  try {
    if (!aiLedBlack) return;
    const t = loadTendency();
    t.blackLeadsFaced += 1;
    if (humanRespondedWhite) t.contested += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch { /* 무시 */ }
}

export function recordGameEnd(): void {
  try {
    const t = loadTendency();
    t.games += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch { /* 무시 */ }
}

// ---------- 의사결정 ----------

/** 이번 라운드 승점 1점의 가치(포인트 환산) */
function roundValue(s: M2State, me: PlayerId): number {
  const opp = (1 - me) as PlayerId;
  const myScore = s.scores[me];
  const oppScore = s.scores[opp];
  const roundsLeft = s.maxRounds - s.roundInSet;
  // 승부처: 어느 쪽이든 이번 라운드로 5점 도달 가능하면 전 재산 가치
  if (myScore === 4 || oppScore === 4) return 200;
  // 종반 동점권일수록 가치 상승
  const base = s.points[me] / Math.max(5 - myScore, 1);
  const urgency = roundsLeft <= 2 ? 1.6 : roundsLeft <= 4 ? 1.25 : 1;
  const behind = oppScore > myScore ? 1.3 : 1;
  return Math.min(base * urgency * behind, 120);
}

function pickWeighted(cands: Array<{ bid: number; ev: number }>, temp: number): number {
  cands.sort((a, b) => b.ev - a.ev);
  const top = cands[0].ev;
  const ws = cands.map((c) => Math.exp((c.ev - top) / temp));
  const total = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < cands.length; i++) {
    r -= ws[i];
    if (r <= 0) return cands[i].bid;
  }
  return cands[0].bid;
}

export function chooseAiBid(s: M2State, me: PlayerId): number {
  if (currentPlayer(s) !== me) throw new Error('not AI turn');
  const myPoints = s.points[me];
  if (myPoints === 0) return 0;
  const V = roundValue(s, me);
  const t = loadTendency();

  if (s.pending !== null) {
    // ---------- 후공 ----------
    const b = pendingBidBounds(s, me);
    const candidates = new Set<number>([0]);
    // 확정승 후보: 상한+1
    if (b.hi + 1 <= myPoints) candidates.add(b.hi + 1);
    // 흑 상대 최소 백
    if (bidColor(s.pending) === 'black' && myPoints >= 10) candidates.add(10);
    // 중앙값+α 도박 (백 상대)
    const mid = Math.floor((b.lo + b.hi) / 2);
    for (const k of [mid + 1, mid + 4]) {
      if (k > 0 && k <= myPoints) candidates.add(k);
    }
    if (b.lo <= myPoints && b.lo > 0) candidates.add(b.lo); // 최소 무승부/저격
    const evals = [...candidates].map((bid) => {
      // P(win) = P(pending < bid), 구간 균등 가정
      const span = b.hi - b.lo + 1;
      const winP = Math.max(0, Math.min(bid - b.lo, span)) / span;
      const drawP = bid >= b.lo && bid <= b.hi ? 1 / span : 0;
      return { bid, ev: winP * V + drawP * V * 0.1 - bid };
    });
    return pickWeighted(evals, 4);
  }

  // ---------- 선공 ----------
  const opp = opponentPointBounds(s, me);
  const oppScore = s.scores[1 - me];
  const contestRate =
    t.blackLeadsFaced >= 3 ? t.contested / t.blackLeadsFaced : 0.6; // 흑 리드에 백 응수할 확률
  const candidates = new Set<number>([0]);
  if (myPoints >= 1) candidates.add(1);
  if (myPoints >= 9) candidates.add(9);
  if (myPoints >= 10) candidates.add(10);
  if (myPoints >= 11) candidates.add(11);
  // 상대 전액 초과 입찰 = 확정승
  if (opp.hi + 1 <= myPoints) candidates.add(opp.hi + 1);
  // 상대 4점이면 흑 리드는 10에 따이는 자충수 → 백 위주
  const evals = [...candidates].map((bid) => {
    let winP: number;
    if (bid <= 9) {
      // 흑 리드: 상대가 응수(10+)하면 패배, 포기(0)하면 승리
      winP = 1 - contestRate;
      if (opp.hi < 10) winP = bid > opp.hi ? 1 : 0.5; // 상대가 10을 못 냄
    } else {
      // 백 리드: 상대의 전형적 응수는 잔여 구간의 절반 수준이라고 근사
      const oppTypical = Math.min(20, Math.max(10, opp.hi / 2));
      winP = bid > oppTypical ? 0.75 : 0.35;
      if (bid > opp.hi) winP = 1; // 상대 전액보다 큼 = 확정승
    }
    let ev = winP * V - bid;
    if (oppScore === 4 && bid <= 9) ev -= 40; // 상대 매치포인트에 흑 리드는 위험
    return { bid, ev };
  });
  return pickWeighted(evals, 4);
}
