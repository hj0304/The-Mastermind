/**
 * 백두 밀림 기물 표기 — 솔로·온라인 뷰가 공유한다. (엔진 코드 K/G/E/C/H는 불변)
 *
 * 디자인 킥: 원작 십이장기는 원류(동물장기)의 동물과 "말에 인쇄된 이동 방향"을 지우고
 * 한자 왕·장·상·자로 바꿨다. 본 구현은 그 발명을 백두 밀림의 짐승들로 되살린다 —
 * 타일 가장자리의 점(핍)이 곧 그 짐승의 이동 방향이라 룰 암기 없이 첫 판이 가능하다.
 */
import type { PieceType } from './engine.ts';

export const PIECE_GLYPH: Record<PieceType, string> = {
  K: '🐅', // 호랑이 — 밀림의 왕, 8방향
  G: '🐻', // 곰 — 직선 저돌, 상하좌우
  E: '🐆', // 표범 — 대각 침투
  C: '🐯', // 새끼범 — 앞으로 한 칸
  H: '🐯', // 큰범 — 적진에서 살아남은 새끼범 (금빛 테 + 핍 6개로 구분)
};

export const PIECE_NAME: Record<PieceType, string> = {
  K: '호랑이',
  G: '곰',
  E: '표범',
  C: '새끼범',
  H: '큰범',
};

/** 기물별 이동 방향(본인 시점, 위가 전방) — 상대 기물은 타일째 180° 회전되므로 그대로 맞는다 */
const DIRS: Record<PieceType, readonly string[]> = {
  K: ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'],
  G: ['n', 'e', 's', 'w'],
  E: ['ne', 'se', 'sw', 'nw'],
  C: ['n'],
  H: ['n', 'ne', 'e', 'w', 's', 'nw'], // 금장형: 대각 뒤 2방향 제외
};

/** 타일 가장자리에 이동 방향 핍을 새긴다 */
export function PiecePips({ type }: { type: PieceType }) {
  return (
    <>
      {DIRS[type].map((d) => (
        <i key={d} className={`jj-pip ${d}`} />
      ))}
    </>
  );
}
