/**
 * 콰트로 카드 렌더링 — AI 대전(QuattroGame)과 온라인 대전(QuattroOnline)이 공유한다.
 * 카드 표시는 색·숫자·공개 여부가 곧 규칙이므로 중복 구현하지 않는다.
 */

import type { QCard } from './engine.ts';

export const COLOR_NAME: Record<QCard['color'], string> = {
  R: '빨강', B: '파랑', Y: '노랑', G: '초록', K: '검정',
};

export function CardView({
  card,
  opened,
  selectable,
  selected,
  small,
  onClick,
}: {
  card: QCard;
  opened?: boolean;
  selectable?: boolean;
  selected?: boolean;
  small?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`qt-card c-${card.color} ${opened ? 'opened' : ''} ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''} ${small ? 'small' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      {card.num}
      {opened && <span className="open-mark">공개</span>}
    </button>
  );
}

export function CardBack() {
  return <span className="qt-card back" />;
}
