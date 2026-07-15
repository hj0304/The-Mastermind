/**
 * 모노크롬 레이즈 AI — 배치 설계(블로토식) + 칩 신호 기반 타일 추론 + 콜/폴드 EV.
 *
 * AI가 쓰는 공개 정보 (사람과 동일):
 * - 양쪽 칩 배분(공개), 쇼다운으로 공개된 타일, 폴드로 소모된(비공개) 라운드 수
 * - 쇼다운 때마다 "베팅 크기 대비 실제 타일 값"을 대조해 블러핑 성향 학습
 *
 * AI는 폴드로 비공개 처리된 타일 값을 절대 읽지 않는다 (revealed=false 기록 무시).
 */

import type { PlayerId, RaiseSetup, RaiseState } from './engine.ts';
import { maxCallable } from './engine.ts';

// ---------- 상대(사람) 성향 학습 ----------

interface RaiseTendency {
  /** 큰 베팅(자기 배분 상위 30%)이 쇼다운에서 낮은 타일(≤3)이었던 횟수 → 블러핑 */
  bigBetLowTile: number;
  bigBetShowdowns: number;
  games: number;
}

const STORAGE_KEY = 'mastermind.monochrome-raise.tendency.v1';

export function loadTendency(): RaiseTendency {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as RaiseTendency;
  } catch { /* 무시 */ }
  return { bigBetLowTile: 0, bigBetShowdowns: 0, games: 0 };
}

export function recordShowdownForLearning(humanBet: number, humanTile: number): void {
  try {
    if (humanBet < 4) return; // 큰 베팅만 신호로 취급
    const t = loadTendency();
    t.bigBetShowdowns += 1;
    if (humanTile <= 3) t.bigBetLowTile += 1;
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

function bluffRate(): number {
  const t = loadTendency();
  return (t.bigBetLowTile + 1) / (t.bigBetShowdowns + 4); // 라플라스, 기본 0.25
}

// ---------- 배치 생성 ----------

/** EXTREME 배치: 정석/블러프/밸런스 아키타입 중 무작위 + 변주 */
export function aiSetup(): RaiseSetup {
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const order = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const bets = new Array(10).fill(1);
  let left = 20;
  const posOf = (v: number) => order.indexOf(v);
  const add = (pos: number, n: number) => {
    const x = Math.min(left, n);
    bets[pos] += x;
    left -= x;
  };

  const style = Math.random();
  if (style < 0.45) {
    // 정석: 9/8/7 집중
    add(posOf(9), 7 + Math.floor(Math.random() * 2));
    add(posOf(8), 5);
    add(posOf(7), 3);
  } else if (style < 0.75) {
    // 블러프: 낮은 타일 하나에 대량 베팅 (9처럼 보이게)
    const decoy = [0, 1, 2][Math.floor(Math.random() * 3)];
    add(posOf(decoy), 8 + Math.floor(Math.random() * 3));
    add(posOf(9), 4);
    add(posOf(8), 3);
  } else {
    // 밸런스: 상위 4개에 분산
    add(posOf(9), 4);
    add(posOf(8), 4);
    add(posOf(7), 3);
    add(posOf(6), 3);
  }
  while (left > 0) {
    bets[Math.floor(Math.random() * 10)] += 1;
    left -= 1;
  }
  return { order, bets };
}

// ---------- 타일 추론 ----------

/**
 * me 시점에서 상대의 현재 라운드 타일 확률 분포 (0~9 인덱스).
 * 후보 = 0~9 − 쇼다운으로 공개된 상대 타일. 폴드 소모분은 후보 중 무엇인지 모름 → 균등.
 * 칩 신호: 상대의 현재 베팅이 (남은 배분 대비) 클수록 높은 타일 가중 — 블러핑률로 감쇄.
 */
export function opponentTileDist(s: RaiseState, me: PlayerId): number[] {
  const opp = (1 - me) as PlayerId;
  const candidates = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  let consumedHidden = 0;
  for (const h of s.history) {
    if (h.revealed) candidates.delete(h.tiles[opp]);
    else consumedHidden += 1;
  }
  void consumedHidden; // 균등 가정에서는 후보 축소에 영향 없음

  const bet = s.bets[opp][s.round];
  const futureBets = s.bets[opp].slice(s.round).sort((a, b) => b - a);
  const rank = futureBets.indexOf(bet); // 0 = 남은 것 중 최대 베팅
  const signal = rank <= 1 ? 1 : rank <= 3 ? 0.4 : -0.4; // 신호 강도
  const br = bluffRate();
  const lambda = Math.max(0.15, 0.9 * (1 - 2 * br)); // 블러퍼 상대면 신호 무시

  const probs = new Array<number>(10).fill(0);
  let total = 0;
  for (const v of candidates) {
    const w = Math.exp(lambda * signal * ((v - 4.5) / 4.5));
    probs[v] = w;
    total += w;
  }
  for (let v = 0; v < 10; v++) probs[v] /= total;
  return probs;
}

// ---------- 콜/폴드 결정 ----------

export function aiDecide(s: RaiseState, me: PlayerId): 'call' | 'fold' {
  if (s.toDecide !== me) throw new Error('not AI decision');
  const opp = (1 - me) as PlayerId;
  const r = s.round;
  const myTile = s.order[me][r];
  const myBet = s.bets[me][r];
  const oppBet = s.bets[opp][r];
  const need = oppBet - myBet;

  if (maxCallable(s, me) < need) return 'fold';

  const dist = opponentTileDist(s, me);
  let pWin = 0;
  let pTie = 0;
  for (let v = 0; v < 10; v++) {
    if (myTile > v) pWin += dist[v];
    else if (myTile === v) pTie += dist[v];
  }
  const pLose = 1 - pWin - pTie;

  // 콜: 이기면 +oppBet, 지면 -oppBet(콜 후 내 총 베팅). 폴드: -myBet.
  const evCall = pWin * oppBet - pLose * oppBet;
  const evFold = -myBet;

  // 차출 페널티: 스태시 초과분은 미래 타일을 약화시킨다
  const pulled = Math.max(0, need - s.stash[me]);
  const pullPenalty = pulled * 0.35;

  // 종반 필사 콜: 남은 라운드로 뒤집어야 하면 폴드 EV를 나쁘게 본다
  const myTotal = s.stash[me] + s.bets[me].slice(r).reduce((a, b) => a + b, 0);
  const desperation = myTotal < 24 ? 1.5 : 0;

  return evCall - pullPenalty + desperation > evFold + (Math.random() - 0.5) * 0.8
    ? 'call'
    : 'fold';
}
