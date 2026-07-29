/**
 * 블라인드 홀덤 UI 조각 — 포커 미니멀 톤(shared/pokerui) 위에 이 게임의 고유 요소를 얹는다.
 *
 * 고유 요소는 둘이다:
 *  ① 공유 카드 2장 — 화면 중앙, 양쪽 좌석 사이. 두 사람이 함께 쓰는 카드임이 보여야 한다.
 *  ② 위험 판독 배지 — 공유 카드 두 장의 차이가 폴드 페널티 위험을 알려준다는 것이
 *     이 게임의 핵심 재미이므로, 그 판독을 UI가 직접 말해 준다.
 */

import type { RiskProfile } from './engine.ts';
import { RANK_NAME } from './engine.ts';
import './holdem.css';

/** 공유 카드 2장 — 항상 공개 */
export function CommunityCards({ cards }: { cards: [number, number] }) {
  return (
    <div className="bh-community">
      <span className="bh-community-label">공유 카드</span>
      <div className="bh-community-row">
        {cards.map((v, i) => (
          <div key={i} className="bh-ccard">
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}

const RISK_TEXT: Record<RiskProfile, { badge: string; note: string; tone: string }> = {
  triple: {
    badge: '트리플 위험',
    note: '공유 카드가 같은 숫자 — 양쪽 모두 최소 더블입니다. 폴드하면 페널티를 낼 확률이 큽니다.',
    tone: 'danger',
  },
  straight: {
    badge: '스트레이트 위험',
    note: '공유 카드가 이어집니다 — 내 이마가 연결되면 폴드 시 10칩 페널티입니다.',
    tone: 'warn',
  },
  safe: {
    badge: '폴드 안전',
    note: '이 공유 카드로는 스트레이트·트리플이 나올 수 없습니다 — 폴드해도 페널티가 없습니다.',
    tone: 'safe',
  },
};

/** 위험 판독 배지 — 원작의 판독표를 UI로 옮긴 것 */
export function RiskBadge({ risk }: { risk: RiskProfile }) {
  const r = RISK_TEXT[risk];
  return <span className={`bh-risk ${r.tone}`}>{r.badge}</span>;
}

export function riskNote(risk: RiskProfile): string {
  return RISK_TEXT[risk].note;
}

/** 상대 족보 표시 — 공유 카드가 공개이므로 상대 족보는 계산 가능하다 */
export function RankTag({ rank, label }: { rank: number; label: string }) {
  return (
    <span className={`bh-rank r${rank}`}>
      {label} {RANK_NAME[rank]}
    </span>
  );
}
