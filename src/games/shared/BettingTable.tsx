/**
 * 베팅 테이블 — 1v1 베팅류 게임 공용 듀얼 레인 레이아웃.
 *
 * 상대 좌석 → 상대 베팅 레인 → 총 팟 → 내 베팅 레인 → 내 좌석을 수직 축 하나로
 * 정렬해 위에서 아래로 한 번 훑으면 판이 읽히게 한다. 화면에서 빛나는 것은
 * 총 팟 하나뿐 — 나머지는 무채색으로 눌러 위계를 만든다.
 * 렌더 전용: 엔진 상태는 게임 쪽에서 props로 내려준다.
 */

import type { ReactNode } from 'react';
import './betting.css';

export interface SeatInfo {
  name: string;
  /** 좌석 옆 뱃지 (예: EXTREME) */
  tag?: string;
  /** 남은 칩 */
  stack: number;
}

/** 칩 금액을 액면(10·5·1)으로 분해 — 스택 높이가 항상 금액에 비례한다 */
function decompose(amount: number): number[] {
  const out: number[] = [];
  let a = Math.max(0, Math.floor(amount));
  while (a >= 10 && out.length < 12) {
    out.push(10);
    a -= 10;
  }
  if (a >= 5 && out.length < 12) {
    out.push(5);
    a -= 5;
  }
  while (a >= 1 && out.length < 12) {
    out.push(1);
    a -= 1;
  }
  return out;
}

/** 옆에서 본 매트 칩 스택 — 정확한 값은 옆의 숫자가 주고, 칩은 "대략 얼마"만 준다 */
export function ChipStack({ amount }: { amount: number }) {
  const discs = decompose(amount);
  return (
    <div className="bt-chips" style={{ height: Math.max(18, discs.length * 6 + 12) }} aria-hidden="true">
      {discs.map((d, i) => (
        <span key={i} className={`bt-chip d${d}`} style={{ bottom: i * 6 }} />
      ))}
    </div>
  );
}

function SeatRow({ seat, side, card }: { seat: SeatInfo; side: 'opp' | 'me'; card?: ReactNode }) {
  return (
    <div className={`bt-seat ${side}`}>
      <div className="bt-who">
        <div className={`bt-avatar ${side}`}>{seat.name.slice(0, 2)}</div>
        <div>
          <div className="bt-name">
            {seat.name}
            {seat.tag && <span className="bt-tag">{seat.tag}</span>}
          </div>
          <div className="bt-stack">
            보유 <b>{seat.stack}</b>칩
          </div>
        </div>
      </div>
      {card}
    </div>
  );
}

export default function BettingTable(p: {
  opp: SeatInfo;
  me: SeatInfo;
  oppBet: number;
  myBet: number;
  pot: number;
  handNo?: number;
  carried?: number;
  /** 좌석 우측 카드 슬롯 (라벨 포함해 게임 쪽에서 구성) */
  oppCard?: ReactNode;
  myCard?: ReactNode;
}) {
  return (
    <div className="bt-wrap">
      <SeatRow seat={p.opp} side="opp" card={p.oppCard} />
      <div className="bt-lane">
        <div className="bt-lane-info">
          <span className="bt-lane-label">{p.opp.name} 베팅</span>
          <span className="bt-lane-amt">{p.oppBet}</span>
        </div>
        <ChipStack amount={p.oppBet} />
      </div>
      <div className="bt-pot">
        <div className="bt-pot-label">총 팟</div>
        <div className="bt-pot-amt">{p.pot}</div>
        <div className="bt-pot-badges">
          {p.handNo !== undefined && <span className="bt-badge">핸드 #{p.handNo}</span>}
          {(p.carried ?? 0) > 0 && <span className="bt-badge carried">이월 +{p.carried}</span>}
        </div>
      </div>
      <div className="bt-lane">
        <ChipStack amount={p.myBet} />
        <div className="bt-lane-info right">
          <span className="bt-lane-label">내 베팅</span>
          <span className="bt-lane-amt">{p.myBet}</span>
        </div>
      </div>
      <SeatRow seat={p.me} side="me" card={p.myCard} />
    </div>
  );
}

/** 하단 고정 액션 독 — 엄지 도달 영역에 조작을 모은다 */
export function ActionDock({ children }: { children: ReactNode }) {
  return <div className="bt-dock">{children}</div>;
}

/** 레이즈 프리셋 — 스텝퍼 값을 설정한다 (즉시 베팅하지 않음) */
export function BetPresets({
  presets,
  value,
  onPick,
}: {
  presets: { label: string; value: number }[];
  value: number;
  onPick: (v: number) => void;
}) {
  return (
    <div className="bt-presets">
      {presets.map((pr) => (
        <button
          key={pr.label}
          className={`bt-preset ${pr.value === value ? 'on' : ''}`}
          onClick={() => onPick(pr.value)}
        >
          {pr.label}
        </button>
      ))}
    </div>
  );
}

/** 고정 사다리 + 팟 비율 프리셋 목록 (라벨에 실제 칩 수를 함께 노출) */
export function raisePresets(pot: number, maxRaise: number): { label: string; value: number }[] {
  const half = Math.min(maxRaise, Math.max(1, Math.ceil(pot / 2)));
  const full = Math.min(maxRaise, Math.max(1, pot));
  const cands = [
    { label: '+1', value: 1 },
    { label: '+3', value: 3 },
    { label: '+5', value: 5 },
    { label: `½팟 ${half}`, value: half },
    { label: `팟 ${full}`, value: full },
    { label: `올인 ${maxRaise}`, value: maxRaise },
  ];
  const seen = new Set<number>();
  const out: { label: string; value: number }[] = [];
  for (const c of cands) {
    if (c.value < 1 || c.value > maxRaise || seen.has(c.value)) continue;
    seen.add(c.value);
    out.push(c);
  }
  return out;
}
