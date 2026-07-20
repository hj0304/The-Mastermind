/**
 * 모노크롬 II 관점 뷰 — 좌석별로 보아도 되는 정보만 남긴다.
 *
 * 비공개 정보:
 * - 상대의 정확한 잔여 포인트 (5단계 게이지만 공개)
 * - 상대가 제시해 둔 포인트 (색=자릿수만 공개)
 * - 과거 라운드에서 상대가 낸 액수 (무승부일 때만 서로 같은 값이므로 공개)
 *
 * 게이지 단계는 gaugeTier로 계산되므로, 같은 단계 안의 대푯값으로 치환하면
 * 화면 표시는 그대로면서 정확한 값은 감춰진다.
 */

import type { M2State, PlayerId } from './engine.ts';
import { gaugeTier } from './engine.ts';

/** 같은 게이지 단계를 유지하는 대푯값 (단계 중앙) */
function maskPoints(points: number): number {
  return gaugeTier(points) * 20 + 10;
}

/** 색(한 자릿수/두 자릿수)만 유지하는 대푯값 */
function maskBid(bid: number): number {
  return bid <= 9 ? 5 : 50;
}

export function viewFor(s: M2State, seat: PlayerId): M2State {
  const opp = (1 - seat) as PlayerId;
  const revealAll = s.result !== null;

  const points: [number, number] = [s.points[0], s.points[1]];
  if (!revealAll) points[opp] = maskPoints(s.points[opp]);

  // 상대가 선으로 제시해 둔 값은 색만 보여야 한다
  const pending =
    s.pending !== null && s.leader === opp && !revealAll ? maskBid(s.pending) : s.pending;

  const history = s.history.map((r) => {
    if (revealAll || r.winner === null) return r; // 무승부는 양쪽 값이 같아 이미 공개
    const bids: [number, number] = [r.bids[0], r.bids[1]];
    bids[opp] = maskBid(r.bids[opp]);
    return { ...r, bids };
  });

  return { ...s, points, pending, history };
}
