/**
 * 나포전(拿捕戰) 기물 표기 — 솔로·온라인 뷰가 공유한다. (엔진 코드 K/G/E/C/H는 불변,
 * 게임 id·라우트·전적 키도 'jungle-janggi' 유지 — 표기만 해적단으로 교체)
 *
 * 디자인 킥: 원작 십이장기는 원류(동물장기)의 "말에 인쇄된 이동 방향" 발명을 지우고
 * 한자 왕·장·상·자로 바꿨다. 본 구현은 그 발명을 해적선 선원들로 되살린다 —
 * 타일 가장자리의 점(핍)이 곧 그 선원의 이동 방향이라 룰 암기 없이 첫 판이 가능하다.
 *
 * 관계도: 선장 아래 무력(갑판장)과 지략(항해사), 막내 노잡이는 적함에 올라
 * 살아남으면 칼잡이로 인정받는다. 잡은 선원은 나포되어 한 배를 탄다(드롭).
 */
import type { PieceType } from './engine.ts';

export const PIECE_GLYPH: Record<PieceType, string> = {
  K: '🏴‍☠️', // 선장 — 깃발의 주인, 8방향. 잡히면 패배, 적함에 깃발을 꽂으면 승리
  G: '⚓', // 갑판장 — 갑판을 직선으로 누빈다, 상하좌우
  E: '🧭', // 항해사 — 바람을 비껴 타는 대각 항로
  C: '🛶', // 노잡이 — 노는 앞으로만 젓는다, 앞 1칸
  H: '⚔️', // 칼잡이 — 적함에서 살아남은 노잡이가 칼을 받았다 (금빛 테 + 핍 6개)
};

export const PIECE_NAME: Record<PieceType, string> = {
  K: '선장',
  G: '갑판장',
  E: '항해사',
  C: '노잡이',
  H: '칼잡이',
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
