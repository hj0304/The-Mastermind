/**
 * 모노크롬 레이즈 관점 뷰 — 좌석별로 보아도 되는 정보만 남긴다.
 *
 * 이 게임에서 **칩 배분(bets)과 스태시는 공개 정보**다(양쪽 트랙에 그대로 표시된다).
 * 비공개는 **상대의 타일 순서**뿐이며, 쇼다운·무승부로 공개된 라운드의 타일만 드러난다.
 * 폴드로 끝난 라운드는 양쪽 타일 모두 끝까지 비공개다(revealed=false).
 */

import type { RaiseState, PlayerId } from './engine.ts';

/** 아직 공개되지 않은 타일 자리 — UI는 revealed 판정으로 물음표를 그리므로 값은 쓰이지 않는다 */
const HIDDEN_TILE = -1;

export function viewFor(s: RaiseState, seat: PlayerId): RaiseState {
  const opp = (1 - seat) as PlayerId;
  const revealAll = s.result !== null;

  // 상대 타일: 공개된 라운드만 실제 값
  const oppOrder = s.order[opp].map((v, pos) => {
    if (revealAll) return v;
    const rec = s.history.find((h) => h.round === pos);
    return rec?.revealed ? v : HIDDEN_TILE;
  });
  const order: [number[], number[]] =
    seat === 0 ? [[...s.order[0]], oppOrder] : [oppOrder, [...s.order[1]]];

  // 폴드로 끝난 라운드의 상대 타일은 기록에서도 가린다
  const history = s.history.map((h) => {
    if (revealAll || h.revealed) return h;
    const tiles: [number, number] = [h.tiles[0], h.tiles[1]];
    tiles[opp] = HIDDEN_TILE;
    return { ...h, tiles };
  });

  return { ...s, order, history };
}
