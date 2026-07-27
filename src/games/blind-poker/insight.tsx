/**
 * 블라인드 포커 좌석 상태 뱃지 + 상대 성향 집계.
 *
 * 성향은 이번 게임에서 관찰된 상대의 실제 행동만 집계한다 (은닉 정보 미사용).
 * 블러프 추정: 상대가 레이즈한 핸드가 쇼다운까지 갔을 때, 상대 카드가
 * 5 이하였던 비율 — "저 레이즈가 강함을 뜻하는가"의 경험적 신호.
 */

import type { BpState, PlayerId } from './engine.ts';
import type { SeatBadge } from '../shared/BettingTable.tsx';

/** 좌석 상태 뱃지 — 차례이면 ACTIVE, 아니면 이번 핸드 마지막 행동 */
export function seatBadge(s: BpState, seat: PlayerId): SeatBadge | null {
  if (s.phase !== 'betting') return null;
  if (s.toAct === seat) return { label: 'ACTIVE', tone: 'accent' };
  for (let i = s.actions.length - 1; i >= 0; i--) {
    const a = s.actions[i];
    if (a.player !== seat) continue;
    if (a.action.type === 'raise') return { label: 'RAISED', tone: 'warning' };
    if (a.action.type === 'call') return { label: 'CALLED', tone: 'neutral' };
    return null;
  }
  return null;
}

export interface Tendency {
  hands: number;
  folds: number;
  raises: number;
  raiseSum: number;
  raisedShowdowns: number;
  raisedLowShowdowns: number;
}

export function emptyTendency(): Tendency {
  return { hands: 0, folds: 0, raises: 0, raiseSum: 0, raisedShowdowns: 0, raisedLowShowdowns: 0 };
}

/** result 단계에서 호출 — 방금 끝난 핸드에서 opp의 행동을 t에 누적 */
export function accumulateTendency(t: Tendency, s: BpState, opp: PlayerId): void {
  const h = s.history[s.history.length - 1];
  if (!h) return;
  t.hands += 1;
  if (h.outcome === 'fold' && h.folder === opp) t.folds += 1;
  const raises = s.actions.filter((a) => a.player === opp && a.action.type === 'raise');
  t.raises += raises.length;
  for (const r of raises) t.raiseSum += r.action.amount ?? 0;
  if (h.outcome === 'showdown' && raises.length > 0) {
    t.raisedShowdowns += 1;
    if (h.cards[opp] <= 5) t.raisedLowShowdowns += 1;
  }
}

function Row({ label, val, ratio, color }: { label: string; val: string; ratio: number | null; color: string }) {
  const w = Math.round(Math.max(0, Math.min(1, ratio ?? 0)) * 100);
  return (
    <div className="bta-tend-row">
      <div className="line">
        <span>{label}</span>
        <span className="val">{val}</span>
      </div>
      <div className="bta-tend-bar">
        <span style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}

export function TendencyPanel({ t }: { t: Tendency }) {
  const foldRate = t.hands > 0 ? t.folds / t.hands : null;
  const avgRaise = t.raises > 0 ? t.raiseSum / t.raises : null;
  const bluff = t.raisedShowdowns >= 2 ? t.raisedLowShowdowns / t.raisedShowdowns : null;
  const bluffLabel = bluff === null ? '표본 부족' : bluff > 0.5 ? 'HIGH' : bluff >= 0.25 ? 'MID' : 'LOW';
  return (
    <div className="bta-tend">
      <Row
        label="폴드율"
        val={foldRate === null ? '—' : `${Math.round(foldRate * 100)}%`}
        ratio={foldRate}
        color="#88AFCD"
      />
      <Row
        label="평균 레이즈 폭"
        val={avgRaise === null ? '—' : `+${avgRaise.toFixed(1)}`}
        ratio={avgRaise === null ? null : avgRaise / 10}
        color="#6366F1"
      />
      <Row label="블러프 추정" val={bluffLabel} ratio={bluff} color="#D9AE5A" />
    </div>
  );
}
