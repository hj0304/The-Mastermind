/**
 * 베팅 테이블 — 1v1 베팅류 게임 공용 레이아웃 (A안: 테이블 연출).
 *
 * 좌측 테이블 컬럼은 상대 좌석 패널 → 상대 베팅 → 프레임 팟 → 내 베팅 → 내 좌석 패널의
 * 수직 축 하나로 정렬되고, 데스크톱(≥880px)에서는 우측에 정보 레일이 붙는다.
 * 화면에서 링을 두르고 빛나는 것은 총 팟 프레임 하나뿐이다.
 * 렌더 전용: 엔진 상태·레일 내용·독 내용은 게임 쪽에서 내려준다.
 */

import type { ReactNode } from 'react';
import NumberStepper from './NumberStepper.tsx';
import './betting.css';

export interface SeatInfo {
  name: string;
  /** 좌석 옆 고정 뱃지 (예: EXTREME) */
  tag?: string;
  /** 남은 칩 */
  stack: number;
  /** 상태 뱃지 (ACTIVE / RAISED / CALLED …) — 없으면 미표시 */
  badge?: string | null;
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
    <div className="bt-chips" style={{ height: Math.max(20, discs.length * 7 + 13) }} aria-hidden="true">
      {discs.map((d, i) => (
        <span key={i} className={`bt-chip d${d}`} style={{ bottom: i * 7 }} />
      ))}
    </div>
  );
}

function SeatPanel({ seat, side, card }: { seat: SeatInfo; side: 'opp' | 'me'; card?: ReactNode }) {
  return (
    <div className={`bt-seat ${side}`}>
      <div className="bt-who">
        <div className={`bt-avatar ${side}`}>{seat.name.slice(0, 2)}</div>
        <div>
          <div className="bt-name">
            {seat.name}
            {seat.tag && <span className="bt-tag">{seat.tag}</span>}
            {seat.badge && <span className={`bt-state ${seat.badge.toLowerCase()}`}>{seat.badge}</span>}
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

function BetLane({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="bt-lane">
      <ChipStack amount={amount} />
      <div className="bt-lane-info">
        <span className="bt-lane-label">{label}</span>
        <span className="bt-lane-amt">{amount}</span>
      </div>
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
  /** 팟 프레임 하단 보조 설명 (예: 본 라운드 4 · 이월 +2) */
  potSub?: string;
  /** 좌석 우측 카드 슬롯 (라벨 포함해 게임 쪽에서 구성) */
  oppCard?: ReactNode;
  myCard?: ReactNode;
  /** 우측 정보 레일 (데스크톱) / 테이블 아래 (모바일) */
  rail?: ReactNode;
  /** 하단 액션 독 — 모바일에서 화면 하단에 고정 */
  dock?: ReactNode;
}) {
  return (
    <div className="bt-layout">
      <div className="bt-main">
        <SeatPanel seat={p.opp} side="opp" card={p.oppCard} />
        <BetLane label={`${p.opp.name} 베팅`} amount={p.oppBet} />
        <div className="bt-pot-frame">
          <div className="bt-pot-head">
            <span className="bt-pot-label">총 팟</span>
            {p.handNo !== undefined && <span className="bt-badge">핸드 #{p.handNo}</span>}
          </div>
          <div className="bt-pot-amt">{p.pot}</div>
          {p.potSub && <div className="bt-pot-sub">{p.potSub}</div>}
        </div>
        <BetLane label="내 베팅" amount={p.myBet} />
        <SeatPanel seat={p.me} side="me" card={p.myCard} />
      </div>
      {p.rail && <aside className="bt-rail">{p.rail}</aside>}
      {p.dock && <div className="bt-dock">{p.dock}</div>}
    </div>
  );
}

/**
 * 칩 트레이 — 실물 칩을 집어 미는 동작의 디지털 번역.
 * 액면 칩을 탭해 레이즈 총액을 쌓아 올리고, 숫자 직접 입력을 병행한다.
 */
export function ChipTray({
  value,
  min = 1,
  max,
  onChange,
  onEnter,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  onEnter?: () => void;
}) {
  const add = (d: number) => onChange(Math.min(max, value + d));
  return (
    <div className="bt-tray">
      <div className="bt-tray-chips">
        {[1, 5, 10].map((d) => (
          <button
            key={d}
            className={`bt-tray-chip d${d}`}
            disabled={value >= max}
            onClick={() => add(d)}
            aria-label={`칩 ${d} 추가`}
          >
            +{d}
          </button>
        ))}
        <button className="bt-tray-pill" onClick={() => onChange(min)}>
          초기화
        </button>
        <button className="bt-tray-pill allin" onClick={() => onChange(max)}>
          올인
        </button>
      </div>
      <div className="bt-tray-total">
        <span className="bt-tray-label">레이즈 총액</span>
        <NumberStepper value={value} min={min} max={max} onChange={onChange} onEnter={onEnter} />
      </div>
    </div>
  );
}
