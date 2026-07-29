/**
 * 블라인드 홀덤 승률 계산 — 게임 AI · CFR 학습기 · 평가기가 **공유**한다.
 *
 * 공유 카드가 공개이므로 상대 족보는 확정이고, 모르는 것은 내 이마 카드 하나뿐이다.
 * 그래서 승/무/패와 폴드 페널티 확률을 내 이마의 사후분포로 **정확히 적분**할 수 있다.
 * (분포는 아직 공개되지 않은 카드의 값별 잔량 — 버닝 2장이 섞여 완전 정보는 아니며,
 *  이는 사람이 쓸 수 있는 정보와 동일하다.)
 *
 * 이 파일은 s.cards[me](자기 이마)를 절대 읽지 않는다.
 */

import type { BhState, PlayerId } from './engine.ts';
import { RANK_STRAIGHT, compareHands, handRank, remainingCounts } from './engine.ts';

export interface WinOdds {
  win: number;
  draw: number;
  lose: number;
  /** 내 손이 스트레이트/트리플일 확률 = 폴드 시 페널티를 낼 확률 */
  penalty: number;
  /** 상대 족보 등급 (공개 정보로 확정) */
  oppRank: number;
}

export function winOdds(s: BhState, me: PlayerId): WinOdds {
  const opp = (1 - me) as PlayerId;
  const oppCard = s.cards[opp];
  const oppRank = handRank(s.community, oppCard);
  const counts = remainingCounts(s, me);

  let total = 0;
  for (let v = 1; v <= 10; v++) total += counts[v];
  if (total <= 0) {
    // 덱 교체가 먼저 일어나므로 도달하지 않지만, 안전하게 균등 분포로 폴백
    return { win: 0.5, draw: 0, lose: 0.5, penalty: 0.2, oppRank };
  }

  let win = 0;
  let draw = 0;
  let lose = 0;
  let penalty = 0;
  for (let v = 1; v <= 10; v++) {
    const w = counts[v] / total;
    if (w <= 0) continue;
    const cmp = compareHands(s.community, v, oppCard);
    if (cmp > 0) win += w;
    else if (cmp === 0) draw += w;
    else lose += w;
    if (handRank(s.community, v) >= RANK_STRAIGHT) penalty += w;
  }
  return { win, draw, lose, penalty, oppRank };
}
