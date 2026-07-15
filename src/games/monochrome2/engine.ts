/**
 * 모노크롬 II (원작: 흑과백 II) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §8):
 * - 각자 99포인트. 매 라운드 원하는 만큼 포인트를 사용(1회성 소모).
 * - 선이 먼저 제시 → 후 제시. 상대에게는 자릿수만 공개: 한 자릿수(0~9)=흑, 두 자릿수(10~99)=백.
 * - 높은 쪽이 승점 1, 승자가 다음 선. 무승부면 승점 없음·선 유지.
 * - 잔여 포인트는 5단계 게이지(0~19/20~39/40~59/60~79/80~99)로 상시 공개.
 *   선이 포인트를 쓰는 순간 게이지가 먼저 갱신된다 (후는 이를 보고 응수).
 * - 9라운드, 승점 5점 선취 시 즉시 승리. 9라운드 후 동점이면 33포인트·3라운드 연장.
 * - (안전장치) 연장 3회 반복 후에도 동점이면 무승부 처리.
 */

export type PlayerId = 0 | 1;

export interface M2Round {
  leader: PlayerId;
  /** [p0 제시, p1 제시] */
  bids: [number, number];
  winner: PlayerId | null;
}

export interface M2State {
  points: [number, number];
  scores: [number, number];
  leader: PlayerId;
  /** 선이 제시해 둔 포인트 (후 대기 중), 없으면 null */
  pending: number | null;
  /** 현재 세트에서 완료된 라운드 수 */
  roundInSet: number;
  /** 현재 세트의 총 라운드 (본선 9, 연장 3) */
  maxRounds: number;
  overtime: number;
  history: M2Round[];
  result: { winner: PlayerId | null } | null;
}

export const GAUGE_LABELS = ['0~19', '20~39', '40~59', '60~79', '80~99'];

/** 잔여 포인트의 공개 게이지 단계 (0~4) */
export function gaugeTier(points: number): number {
  return Math.min(4, Math.floor(points / 20));
}

export function bidColor(bid: number): 'black' | 'white' {
  return bid <= 9 ? 'black' : 'white';
}

export function createGame(firstLeader: PlayerId): M2State {
  return {
    points: [99, 99],
    scores: [0, 0],
    leader: firstLeader,
    pending: null,
    roundInSet: 0,
    maxRounds: 9,
    overtime: 0,
    history: [],
    result: null,
  };
}

export function currentPlayer(s: M2State): PlayerId {
  return s.pending === null ? s.leader : ((1 - s.leader) as PlayerId);
}

export function maxBid(s: M2State, p: PlayerId): number {
  return s.points[p];
}

export function play(s: M2State, bid: number): M2State {
  if (s.result) throw new Error('game over');
  const p = currentPlayer(s);
  if (!Number.isInteger(bid) || bid < 0 || bid > s.points[p]) throw new Error('illegal bid');

  const points: [number, number] = [...s.points];
  points[p] -= bid;

  if (s.pending === null) {
    return { ...s, points, pending: bid };
  }

  const leaderBid = s.pending;
  const bids: [number, number] = s.leader === 0 ? [leaderBid, bid] : [bid, leaderBid];
  const winner: PlayerId | null = bids[0] === bids[1] ? null : bids[0] > bids[1] ? 0 : 1;

  const scores: [number, number] = [...s.scores];
  if (winner !== null) scores[winner] += 1;

  let next: M2State = {
    ...s,
    points,
    scores,
    leader: winner ?? s.leader,
    pending: null,
    roundInSet: s.roundInSet + 1,
    history: [...s.history, { leader: s.leader, bids, winner }],
  };

  // 5점 선취 즉시 승리
  if (scores[0] >= 5 || scores[1] >= 5) {
    return { ...next, result: { winner: scores[0] >= 5 ? 0 : 1 } };
  }

  // 세트 종료
  if (next.roundInSet >= next.maxRounds) {
    if (scores[0] !== scores[1]) {
      return { ...next, result: { winner: scores[0] > scores[1] ? 0 : 1 } };
    }
    if (next.overtime >= 3) {
      return { ...next, result: { winner: null } }; // 안전장치: 무승부
    }
    // 연장전: 33포인트·3라운드 (승점은 유지, 선도 유지)
    next = {
      ...next,
      points: [33, 33],
      roundInSet: 0,
      maxRounds: 3,
      overtime: next.overtime + 1,
    };
  }
  return next;
}
