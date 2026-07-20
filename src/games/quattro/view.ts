/**
 * 콰트로 관점 뷰 — 좌석별로 보아도 되는 정보만 남긴다.
 *
 * 이 게임의 비공개 정보:
 * - 상대 손패 (장수만 공개)
 * - 가상 플레이어 6명의 손패 (장수만 공개)
 * - 교환에서 받은 카드(received) — 교환 당사자만 안다
 * - 덱과 멀리건 버린 카드
 *
 * 구현 방식: 상태 구조를 유지한 채 비공개 카드만 더미로 치환한다. 기존 UI가
 * 상대 손패·가상 카드를 어차피 뒷면으로만 그리므로 렌더링 코드를 그대로 쓸 수 있다.
 * 게임이 끝나면(result 확정) 양쪽 최종 4장이 공개되어야 하므로 마스킹을 풀어준다.
 */

import type { PlayerId, QCard, QState } from './engine.ts';

/** 내용이 가려진 카드 — id가 음수라 실제 카드와 절대 충돌하지 않는다 */
function maskedCard(seq: number): QCard {
  return { id: -1000 - seq, color: 'K', num: 0 };
}

function maskList(cards: QCard[], seed: number): QCard[] {
  return cards.map((_, i) => maskedCard(seed * 100 + i));
}

export function viewFor(s: QState, seat: PlayerId): QState {
  const opp = (1 - seat) as PlayerId;
  const revealAll = s.result !== null;

  const hands: [QCard[], QCard[]] = [[...s.hands[0]], [...s.hands[1]]];
  if (!revealAll) hands[opp] = maskList(s.hands[opp], 1);

  const virtuals = revealAll ? s.virtuals : s.virtuals.map((v, i) => maskList(v, 10 + i));

  const log = s.log.map((e) =>
    e.player === seat || revealAll ? e : { ...e, received: maskedCard(9000 + e.virtualIdx) },
  );

  return { ...s, deck: [], discard: [], hands, virtuals, log };
}
