/**
 * 모노크롬 레이즈 (원작: 베팅! 흑과 백) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §12):
 * - 각자 숫자 타일 0~9 (짝수 흑, 홀수 백) 10개 + 칩 30개.
 * - 시작 전 비공개로 타일 10개의 대결 순서를 정하고 칩 30개를 각 타일에 분배
 *   (타일당 최소 1개, 전부 배정).
 * - 가림막 제거 후 1번 타일부터 순서대로 대결. 칩 배분은 서로 공개, 타일은 뒷면.
 * - 각 대결에서 칩을 적게 건 쪽이 선택:
 *   · 콜 — 칩 개수를 맞춘다 (획득 칩(스태시) 우선, 부족하면 이후 타일 배정분에서
 *     차출 가능. 단 각 타일에 최소 1개는 남아야 한다)
 *   · 폴드 — 두 타일 모두 공개하지 않고, 베팅된 칩 전부를 상대가 획득
 * - 동액이면 즉시 공개. 높은 숫자가 팟 획득, 무승부면 각자 회수.
 * - 10라운드 종료 후 칩이 많은 쪽 승리 (총 60개 중 31개 이상).
 *
 * 차출 정책: 콜 시 부족분은 "마지막 포지션부터, 배정 많은 순"으로 자동 차출한다.
 * (원작은 자유 선택이지만 UI 단순화를 위한 결정적 정책 — 양쪽 동일 적용)
 */

export type PlayerId = 0 | 1;

export interface RaiseSetup {
  /** 타일 대결 순서 (0~9의 순열) */
  order: number[];
  /** 포지션별 배정 칩 (min 1, 합 30) */
  bets: number[];
}

export type RaisePhase = 'decision' | 'result' | 'gameover';

export interface RoundRec {
  round: number;
  /** 최종 베팅액 [p0, p1] */
  finalBets: [number, number];
  outcome: 'showdown' | 'fold' | 'draw';
  folder?: PlayerId;
  winner?: PlayerId;
  pot: number;
  /** 공개 여부 — fold면 양쪽 타일 모두 비공개 */
  revealed: boolean;
  /** 타일 값 (revealed=false면 UI/AI에 노출 금지) */
  tiles: [number, number];
}

export interface RaiseState {
  order: [number[], number[]];
  /** 남은 포지션별 배정 칩 (차출로 감소 가능) */
  bets: [number[], number[]];
  stash: [number, number];
  round: number; // 0-based
  phase: RaisePhase;
  toDecide: PlayerId | null;
  history: RoundRec[];
  result: { winner: PlayerId | null } | null;
}

export const TOTAL_CHIPS = 30;

export function validateSetup(setup: RaiseSetup): void {
  const sorted = [...setup.order].sort((a, b) => a - b);
  if (sorted.join(',') !== '0,1,2,3,4,5,6,7,8,9') throw new Error('order must be permutation of 0-9');
  if (setup.bets.length !== 10) throw new Error('bets length');
  if (setup.bets.some((b) => b < 1)) throw new Error('min 1 chip per tile');
  if (setup.bets.reduce((a, b) => a + b, 0) !== TOTAL_CHIPS) throw new Error('bets must sum to 30');
}

export function createGame(setup0: RaiseSetup, setup1: RaiseSetup): RaiseState {
  validateSetup(setup0);
  validateSetup(setup1);
  const s: RaiseState = {
    order: [[...setup0.order], [...setup1.order]],
    bets: [[...setup0.bets], [...setup1.bets]],
    stash: [0, 0],
    round: 0,
    phase: 'decision',
    toDecide: null,
    history: [],
    result: null,
  };
  return prepareRound(s);
}

function prepareRound(s: RaiseState): RaiseState {
  if (s.round >= 10) {
    const winner = s.stash[0] === s.stash[1] ? null : s.stash[0] > s.stash[1] ? 0 : 1;
    return { ...s, phase: 'gameover', toDecide: null, result: { winner } };
  }
  const b0 = s.bets[0][s.round];
  const b1 = s.bets[1][s.round];
  if (b0 === b1) return showdown(s);
  return { ...s, phase: 'decision', toDecide: b0 < b1 ? 0 : 1 };
}

function showdown(s: RaiseState): RaiseState {
  const r = s.round;
  const t0 = s.order[0][r];
  const t1 = s.order[1][r];
  const finalBets: [number, number] = [s.bets[0][r], s.bets[1][r]];
  const pot = finalBets[0] + finalBets[1];
  const stash: [number, number] = [...s.stash];
  let rec: RoundRec;
  if (t0 === t1) {
    stash[0] += finalBets[0];
    stash[1] += finalBets[1];
    rec = { round: r, finalBets, outcome: 'draw', pot, revealed: true, tiles: [t0, t1] };
  } else {
    const winner: PlayerId = t0 > t1 ? 0 : 1;
    stash[winner] += pot;
    rec = { round: r, finalBets, outcome: 'showdown', winner, pot, revealed: true, tiles: [t0, t1] };
  }
  return { ...s, stash, phase: 'result', toDecide: null, history: [...s.history, rec] };
}

/** 콜에 동원 가능한 최대 칩 (스태시 + 이후 포지션 차출 가능분) */
export function maxCallable(s: RaiseState, p: PlayerId): number {
  let avail = s.stash[p];
  for (let i = s.round + 1; i < 10; i++) avail += Math.max(0, s.bets[p][i] - 1);
  return avail;
}

export function decide(s: RaiseState, action: 'call' | 'fold'): RaiseState {
  if (s.phase !== 'decision' || s.toDecide === null) throw new Error('no decision pending');
  const p = s.toDecide;
  const o = (1 - p) as PlayerId;
  const r = s.round;
  const need = s.bets[o][r] - s.bets[p][r];

  if (action === 'call') {
    if (maxCallable(s, p) < need) throw new Error('cannot cover call');
    const bets: [number[], number[]] = [[...s.bets[0]], [...s.bets[1]]];
    const stash: [number, number] = [...s.stash];
    let remaining = need;
    const fromStash = Math.min(stash[p], remaining);
    stash[p] -= fromStash;
    remaining -= fromStash;
    // 차출: 마지막 포지션부터, 배정 많은 순 (각 타일 최소 1개 유지)
    while (remaining > 0) {
      let pick = -1;
      let best = 1;
      for (let i = 9; i > r; i--) {
        if (bets[p][i] > best) {
          best = bets[p][i];
          pick = i;
        }
      }
      if (pick < 0) throw new Error('pull failed'); // maxCallable 검사로 도달 불가
      const take = Math.min(bets[p][pick] - 1, remaining);
      bets[p][pick] -= take;
      remaining -= take;
    }
    bets[p][r] += need;
    return showdown({ ...s, bets, stash });
  }

  // 폴드: 팟 전부 상대에게, 타일 비공개
  const finalBets: [number, number] = [s.bets[0][r], s.bets[1][r]];
  const pot = finalBets[0] + finalBets[1];
  const stash: [number, number] = [...s.stash];
  stash[o] += pot;
  const rec: RoundRec = {
    round: r,
    finalBets,
    outcome: 'fold',
    folder: p,
    winner: o,
    pot,
    revealed: false,
    tiles: [s.order[0][r], s.order[1][r]],
  };
  return { ...s, stash, phase: 'result', toDecide: null, history: [...s.history, rec] };
}

export function nextRound(s: RaiseState): RaiseState {
  if (s.phase !== 'result') throw new Error('not result phase');
  return prepareRound({ ...s, round: s.round + 1 });
}

/** 무작위 유효 배치 생성 (사람용 추천 배치) */
export function randomSetup(): RaiseSetup {
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const bets = new Array(10).fill(1);
  // 남은 20개: 높은 타일 위주 + 무작위
  let left = 20;
  const byValueDesc = order
    .map((v, pos) => ({ v, pos }))
    .sort((a, b) => b.v - a.v);
  for (const { pos } of byValueDesc.slice(0, 3)) {
    const add = Math.min(left, 3 + Math.floor(Math.random() * 4));
    bets[pos] += add;
    left -= add;
  }
  while (left > 0) {
    bets[Math.floor(Math.random() * 10)] += 1;
    left -= 1;
  }
  return { order, bets };
}
