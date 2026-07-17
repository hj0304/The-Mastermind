/**
 * 야누스 포커 AI — 카드 카운팅 + 홀짝 추론 + 베이지안 뒷면 추정 + EV 베팅.
 *
 * AI가 쓰는 공개 정보 (사람과 동일):
 * - 양쪽 앞면, 자기 카드의 양면, 공개된 카드 기록(s.seen — 폴드 판 뒷면은 null),
 *   상대의 면 선언·베팅 액션
 * - **상대 카드의 뒷면(s.cards[상대].back)은 절대 읽지 않는다**
 *
 * 추정: 남은 덱 분포(카운팅) × 상대의 면 선택 성향(뒷면 선택 = 뒷면이 앞면보다
 * 높을 가능성, 학습된 블러핑률로 보정)으로 상대 선택 면 값의 사후분포를 만든다.
 */

import type { Face, JPAction, JPState, PlayerId } from './engine.ts';
import { BOTH_PENALTY, callCost, maxLevel, maxLevelFor } from './engine.ts';

// ---------- 성향 학습 ----------

interface JanusTendency {
  /** 사람이 뒷면을 선택해 공개된 횟수 / 그중 뒷면이 앞면보다 낮았던(블러핑) 횟수 */
  backReveals: number;
  backBluffs: number;
  /** AI 레이즈에 사람이 응답한 횟수 / 폴드한 횟수 */
  raisesFaced: number;
  foldsVsRaise: number;
  /** AI 양면베팅에 사람이 응답한 횟수 / 폴드한 횟수 */
  bothFaced: number;
  foldsVsBoth: number;
  games: number;
}

const STORAGE_KEY = 'mastermind.janus-poker.tendency.v1';

export function loadTendency(): JanusTendency {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as JanusTendency;
  } catch { /* 무시 */ }
  return {
    backReveals: 0,
    backBluffs: 0,
    raisesFaced: 0,
    foldsVsRaise: 0,
    bothFaced: 0,
    foldsVsBoth: 0,
    games: 0,
  };
}

function save(t: JanusTendency): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch { /* 무시 */ }
}

/** 쇼다운에서 사람의 뒷면 선택이 공개됐을 때 */
export function recordBackReveal(front: number, back: number): void {
  const t = loadTendency();
  t.backReveals += 1;
  if (back < front) t.backBluffs += 1;
  save(t);
}

/** AI의 레이즈/양면베팅에 대한 사람의 반응 */
export function recordResponse(vsBoth: boolean, folded: boolean): void {
  const t = loadTendency();
  if (vsBoth) {
    t.bothFaced += 1;
    if (folded) t.foldsVsBoth += 1;
  } else {
    t.raisesFaced += 1;
    if (folded) t.foldsVsRaise += 1;
  }
  save(t);
}

export function recordGameEnd(): void {
  const t = loadTendency();
  t.games += 1;
  save(t);
}

// ---------- 카운팅 ----------

/**
 * 남은 덱의 (앞,뒤) 분포 추정. 완전 공개 카드는 정확히 제거, 뒷면 비공개 카드는
 * 해당 앞면의 5가지 뒷면에 균등 분할로 제거(분수 카운트).
 */
export function remainingCounts(s: JPState, me: PlayerId): Map<string, number> {
  const pool = new Map<string, number>();
  for (let f = 1; f <= 10; f++) {
    for (let b = 1; b <= 10; b++) {
      if ((f + b) % 2 === 1) pool.set(`${f},${b}`, 4);
    }
  }
  const sub = (f: number, b: number | null) => {
    if (b !== null) {
      const k = `${f},${b}`;
      pool.set(k, Math.max(0, (pool.get(k) ?? 0) - 1));
    } else {
      for (let bb = 1; bb <= 10; bb++) {
        if ((f + bb) % 2 === 1) {
          const k = `${f},${bb}`;
          pool.set(k, Math.max(0, (pool.get(k) ?? 0) - 0.2));
        }
      }
    }
  };
  for (const r of s.seen) sub(r.front, r.back);
  // 내 현재 카드는 완전히 안다
  sub(s.cards[me].front, s.cards[me].back);
  return pool;
}

/** 상대 뒷면의 사후분포 P(back) — 앞면 조건 + (뒷면 선택 시) 면 선택 성향 반영 */
export function oppBackDist(s: JPState, me: PlayerId): Map<number, number> {
  const opp = (1 - me) as PlayerId;
  const front = s.cards[opp].front;
  const pool = remainingCounts(s, me);
  const t = loadTendency();
  const bluffRate = (t.backBluffs + 1) / (t.backReveals + 4); // 기본 0.25

  const dist = new Map<number, number>();
  let total = 0;
  for (let b = 1; b <= 10; b++) {
    if ((front + b) % 2 !== 1) continue;
    let w = Math.max(0, pool.get(`${front},${b}`) ?? 0);
    if (w <= 0) w = 0.01; // 카운팅 고갈 시 미세 확률
    // 면 선택 정보: 뒷면 선택은 back>front일 가능성이 높다
    if (s.faces[opp] === 'back') {
      w *= b > front ? 1 - bluffRate : bluffRate;
    } else if (s.faces[opp] === 'both') {
      // 양면 선언 = min(front,back) 승부 — back이 클수록 그럴듯
      w *= b > front ? 1 : 0.35;
    }
    dist.set(b, w);
    total += w;
  }
  for (const [k, v] of dist) dist.set(k, v / total);
  return dist;
}

/** 상대가 선택한 면 값의 분포 (앞면이면 확정값) */
function oppValueDist(s: JPState, me: PlayerId): Map<number, number> {
  const opp = (1 - me) as PlayerId;
  if (s.faces[opp] === 'front') {
    return new Map([[s.cards[opp].front, 1]]);
  }
  return oppBackDist(s, me); // back 또는 both(상대 min은 아래서 별도 처리)
}

// ---------- 승률 계산 ----------

interface Odds {
  win: number;
  tie: number;
  lose: number;
}

function oddsFor(myVal: number, dist: Map<number, number>): Odds {
  let win = 0;
  let tie = 0;
  let lose = 0;
  for (const [v, p] of dist) {
    if (myVal > v) win += p;
    else if (myVal === v) tie += p;
    else lose += p;
  }
  return { win, tie, lose };
}

/** 상대(양면 선언자)를 이길 확률: 상대 min(front,back) < myVal이어야 상대 실패 */
function oddsVsBoth(s: JPState, me: PlayerId, myVal: number): Odds {
  const opp = (1 - me) as PlayerId;
  const front = s.cards[opp].front;
  const dist = oppBackDist(s, me);
  let win = 0;
  for (const [b, p] of dist) {
    const lo = Math.min(front, b);
    if (lo <= myVal) win += p; // 한 면이라도 같거나 낮으면 내가 승리
  }
  return { win, tie: 0, lose: 1 - win };
}

// ---------- 의사결정 ----------

function humanFoldRate(vsBoth: boolean): number {
  const t = loadTendency();
  // 양면에 폴드하면 10칩 벌금이라 실제 폴드는 드묾 — 사전값을 낮게 시작
  if (vsBoth) return (t.foldsVsBoth + 0.5) / (t.bothFaced + 10);
  return (t.foldsVsRaise + 1) / (t.raisesFaced + 3);
}

/**
 * AI 행동 선택. 상대 카드의 뒷면은 절대 참조하지 않는다.
 */
export function chooseAiAction(s: JPState, me: PlayerId): JPAction {
  if (s.turn !== me || s.phase !== 'act') throw new Error('not AI turn');
  const opp = (1 - me) as PlayerId;
  const my = s.cards[me];
  const cap = maxLevel(s, me);
  const pot = () => s.paid[0] + s.paid[1] + s.carry;

  interface Cand {
    action: JPAction;
    ev: number;
  }
  const cands: Cand[] = [];

  // 상대가 선택한 면 값 분포 (아직 미선택이면 뒷면 기준으로 보수 추정)
  const oppChose = s.faces[opp] !== null;
  const oppIsBoth = s.faces[opp] === 'both';

  const evShowdown = (myVal: number, myFace: Face, level: number): number => {
    // 내가 level까지 갔을 때 쇼다운 EV (내 순변화, 이미 낸 칩은 매몰로 보고 미래분만)
    const myMult = myFace === 'both' ? 2 : 1;
    const toPay = Math.max(0, 1 + level * myMult - s.paid[me]);
    const potAfter = s.paid[me] + toPay + Math.max(s.paid[opp], 1 + level) + s.carry;
    let odds: Odds;
    if (oppIsBoth) {
      odds = oddsVsBoth(s, me, myVal);
    } else if (myFace === 'both') {
      const lo = Math.min(my.front, my.back);
      const dist = oppValueDist(s, me);
      const base = oddsFor(lo, dist);
      odds = { win: base.win, tie: 0, lose: base.tie + base.lose };
    } else {
      odds = oddsFor(myVal, oppValueDist(s, me));
    }
    const bonus =
      myFace === 'both'
        ? Math.min(BOTH_PENALTY, s.stacks[opp])
        : oppIsBoth
          ? 0 // 상대 양면 실패 시 페널티 없음
          : 0;
    const winGain = potAfter - (s.paid[me] + toPay) + bonus; // 상대 몫 + 이월 + 보너스
    const loseCost = toPay + (oppIsBoth ? 0 : 0); // 이미 낸 것 제외 추가 손실
    const tieVal = -toPay * 0.4; // 이월 — 절반 이하 기대 회수
    return odds.win * winGain - odds.lose * (loseCost + s.paid[me]) + odds.tie * tieVal;
  };

  // ---------- 첫 액션 (면 선택 + 베팅) ----------
  if (s.faces[me] === null) {
    // 폴드 (선 봉쇄 포함)
    const foldPenalty = oppIsBoth ? Math.min(BOTH_PENALTY, s.stacks[me]) : 0;
    cands.push({ action: { kind: 'fold' }, ev: -s.paid[me] - foldPenalty });

    const minL = Math.max(1, s.level);
    for (const face of ['front', 'back'] as Face[]) {
      const myVal = face === 'front' ? my.front : my.back;
      if (cap >= minL) {
        // 콜 수준
        cands.push({ action: { kind: 'bet', face, level: minL }, ev: evShowdown(myVal, face, minL) });
        // 레이즈 후보
        for (const bump of [2, 4, 7]) {
          const L = minL + bump;
          if (L <= cap) {
            const pFold = oppChose ? humanFoldRate(false) : 0.25;
            const ev =
              pFold * (pot() - s.paid[me]) + (1 - pFold) * evShowdown(myVal, face, L);
            cands.push({ action: { kind: 'bet', face, level: L }, ev: ev - 0.5 });
          }
        }
      }
    }
    // 양면베팅 (상대가 양면이 아닐 때만) — 2배 지불이라 상한이 절반
    const bothCap = maxLevelFor(s, me, 'both');
    if (!oppIsBoth && bothCap >= minL) {
      const lo = Math.min(my.front, my.back);
      for (const L of [minL, Math.min(bothCap, minL + 3)]) {
        if (L > bothCap) continue;
        const dist = oppChose ? oppValueDist(s, me) : oppFrontOrTypical(s, me);
        const base = oddsFor(lo, dist);
        const pFold = oppChose ? 0 : humanFoldRate(true); // 상대 미선택이면 폴드 유도 가능
        const toPay = 1 + L * 2 - s.paid[me];
        const potAfter = toPay + s.paid[me] + Math.max(s.paid[opp], 1 + L) + s.carry;
        const winGain = potAfter - toPay - s.paid[me] + Math.min(BOTH_PENALTY, s.stacks[opp]);
        const evBoth =
          pFold * (pot() - s.paid[me] + Math.min(BOTH_PENALTY, s.stacks[opp])) +
          (1 - pFold) * (base.win * winGain - (1 - base.win) * toPay - (1 - base.win) * s.paid[me]);
        cands.push({ action: { kind: 'bet', face: 'both', level: L }, ev: evBoth - 1 });
      }
    }
  } else {
    // ---------- 후속 액션 ----------
    const myFace = s.faces[me]!;
    const myVal = myFace === 'front' ? my.front : myFace === 'back' ? my.back : Math.min(my.front, my.back);
    const foldPenalty = oppIsBoth ? Math.min(BOTH_PENALTY, s.stacks[me]) : 0;
    cands.push({ action: { kind: 'fold' }, ev: -s.paid[me] - foldPenalty });
    if (callCost(s, me) <= s.stacks[me]) {
      cands.push({ action: { kind: 'call' }, ev: evShowdown(myVal, myFace, s.level) });
    }
    for (const bump of [2, 5]) {
      const L = s.level + bump;
      if (L <= cap) {
        const pFold = humanFoldRate(myFace === 'both');
        const ev = pFold * (pot() - s.paid[me]) + (1 - pFold) * evShowdown(myVal, myFace, L);
        cands.push({ action: { kind: 'raise', level: L }, ev: ev - 0.5 });
      }
    }
  }

  let best = cands[0];
  for (const c of cands) {
    const jitter = Math.random() * 0.8;
    if (c.ev + jitter > best.ev) best = c;
  }
  return best.action;
}

/** 상대가 아직 면 미선택일 때의 근사 분포: 앞/뒷면 중 높은 쪽을 고른다고 가정 */
function oppFrontOrTypical(s: JPState, me: PlayerId): Map<number, number> {
  const opp = (1 - me) as PlayerId;
  const front = s.cards[opp].front;
  const backDist = oppBackDistNoChoice(s, me);
  const dist = new Map<number, number>();
  for (const [b, p] of backDist) {
    const v = Math.max(front, b); // 합리적 상대는 높은 면 선택
    dist.set(v, (dist.get(v) ?? 0) + p);
  }
  return dist;
}

/** 면 선택 정보 없이 순수 카운팅만으로 본 상대 뒷면 분포 */
function oppBackDistNoChoice(s: JPState, me: PlayerId): Map<number, number> {
  const opp = (1 - me) as PlayerId;
  const front = s.cards[opp].front;
  const pool = remainingCounts(s, me);
  const dist = new Map<number, number>();
  let total = 0;
  for (let b = 1; b <= 10; b++) {
    if ((front + b) % 2 !== 1) continue;
    const w = Math.max(0.01, pool.get(`${front},${b}`) ?? 0);
    dist.set(b, w);
    total += w;
  }
  for (const [k, v] of dist) dist.set(k, v / total);
  return dist;
}
