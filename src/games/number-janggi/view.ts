/**
 * 수의 진 관점 뷰 — 좌석별로 보아도 되는 정보만 남긴다.
 *
 * 이 게임의 비공개 정보는 **상대 기물의 정체**다. 대결이나 부활로 공개된
 * 기물(revealed)만 정체가 드러나고, 나머지는 종류를 알 수 없다.
 * 죽은 기물은 대결로 정체가 드러난 뒤 제거된 것이므로 양쪽 모두 볼 수 있다.
 */

import type { NPiece, NState, PlayerId } from './engine.ts';

/**
 * 정체를 가린 기물 — type만 무효값으로 바꾸고 소유·이동 이력은 유지한다.
 *
 * 주의: movesOnBoard는 지뢰(type 'M')를 이동 불가로 처리하므로, 마스킹된 상대
 * 기물은 이동 가능한 것처럼 계산된다. 이는 정보를 덜 주는 방향이라 안전하다
 * (지뢰 여부가 간접 노출되지 않는다). 실제 판정은 호스트 엔진이 원본 상태로 하고,
 * 게스트 UI는 자기 턴에 자기 기물의 이동만 계산하므로 영향이 없다.
 */
function maskPiece(p: NPiece): NPiece {
  return { ...p, type: 0 };
}

export function viewFor(s: NState, seat: PlayerId): NState {
  const revealAll = s.result !== null;
  const board = s.board.map((p) =>
    p === null || revealAll || p.owner === seat || p.revealed ? p : maskPiece(p),
  );
  return { ...s, board };
}
