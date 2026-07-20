/**
 * 모노크롬 II 포인트 게이지 — AI 대전과 온라인 대전이 공유한다.
 * 잔여 포인트를 5단계로만 공개하는 것이 이 게임의 핵심 규칙이라 중복 구현하지 않는다.
 */

import { GAUGE_LABELS, gaugeTier } from './engine.ts';

export function Gauge({ label, points, exact }: { label: string; points: number; exact?: boolean }) {
  const tier = gaugeTier(points);
  return (
    <div className="m2-gauge">
      <span className="g-label">
        {label} {exact ? <b>{points}</b> : <b>{GAUGE_LABELS[tier]}</b>}
      </span>
      <div className="g-lights">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`light ${i <= tier ? 'on' : ''}`} title={GAUGE_LABELS[i]} />
        ))}
      </div>
    </div>
  );
}
