/**
 * 베팅 테이블 — A 시안(Blind Poker Betting UI.dc.html 1a) 충실 이식.
 *
 * 자체 다크 스코프(#08080A 캔버스 · 인디고 #6366F1 · 골드 #D9AE5A · 모노 숫자)가
 * 이 보드의 정체성이라 앱 테마와 무관하게 고정 팔레트를 쓴다.
 * 구조: 보드 헤더 → 3컬럼(좌 레일 252px | 중앙 수직 축 | 우 레일 252px)
 *       → 하단 액션 바(상태 라인 + 4버튼 그리드 | 컨트롤 존 420px).
 * 렌더 전용 — 엔진 상태·레일·액션은 게임 쪽에서 내려준다.
 */

import type { ReactNode } from 'react';
import NumberStepper from './NumberStepper.tsx';
import './betting.css';

export type Tone = 'accent' | 'warning' | 'error' | 'neutral';

export interface SeatBadge {
  label: string;
  tone: Tone;
}

export interface SeatInfo {
  name: string;
  stack: number;
  badge?: SeatBadge | null;
}

/** 액면 4단 래더 — 회색 1 · 슬레이트 5 · 인디고 10 · 골드 25 (시안 DEN 그대로) */
const DEN = [
  { v: 25, f: '#6E551A', r: '#C79A3E' },
  { v: 10, f: '#2C2E86', r: '#6366F1' },
  { v: 5, f: '#2B4253', r: '#88AFCD' },
  { v: 1, f: '#28282C', r: '#9C9CA1' },
] as const;

type Denom = (typeof DEN)[number];

function split(amount: number): Denom[] {
  let rem = Math.max(0, Math.round(amount));
  const out: Denom[] = [];
  for (const d of DEN) {
    const c = Math.floor(rem / d.v);
    rem -= c * d.v;
    for (let i = 0; i < c; i++) out.push(d);
  }
  return out;
}

/** 레이어 높이는 금액에 비례(1단 = unit 칩), 색은 실제 액면 분해를 아래에서부터 매핑 */
function bands(amount: number, unit: number, cap: number): Denom[] {
  const n = Math.min(cap, Math.max(amount > 0 ? 1 : 0, Math.ceil(Math.max(0, amount) / unit)));
  const parts = split(amount);
  let acc = 0;
  const cum: { top: number; d: Denom }[] = [];
  for (const d of parts) {
    acc += d.v;
    cum.push({ top: acc, d });
  }
  const at = (v: number): Denom => {
    for (const c of cum) if (v < c.top) return c.d;
    return parts.length ? parts[parts.length - 1] : DEN[3];
  };
  return Array.from({ length: n }, (_, i) => at(i * unit));
}

/** 매트 디스크 칩 스택 — 타원 레이어, 1단 = 칩 4개, 높이가 곧 금액 */
export function ChipStack({ amount }: { amount: number }) {
  const layers = bands(amount, 4, 10);
  return (
    <div
      className="bta-chips"
      style={{ height: Math.max(20, (layers.length - 1) * 6 + 15) }}
      aria-hidden="true"
    >
      {layers.map((d, i) => (
        <span
          key={i}
          className="bta-chip"
          style={{ bottom: i * 6, background: d.f, borderColor: d.r }}
        />
      ))}
    </div>
  );
}

export function ABadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`bta-badge ${tone}`}>{children}</span>;
}

/** 이마 카드 — 상대: 인디고 링+글로우 / 나: 대시 보더 물음표 */
export function PlayCard({
  value,
  hidden = false,
  caption,
}: {
  value?: number | string;
  hidden?: boolean;
  caption: string;
}) {
  return (
    <div className="bta-cardwrap">
      <div className={`bta-card ${hidden ? 'hidden' : ''}`}>{hidden ? '?' : value}</div>
      <span className={`bta-card-caption ${hidden ? '' : 'accent'}`}>{caption}</span>
    </div>
  );
}

function SeatCard({ seat, side, card }: { seat: SeatInfo; side: 'opp' | 'me'; card: ReactNode }) {
  const avatar = side === 'opp' ? 'AI' : '나';
  const body = (
    <>
      <div className="bta-seat-divider" />
      <ChipStack amount={seat.stack} />
      <div className="bta-seat-info">
        <div className="bta-seat-name">
          {seat.name}
          {seat.badge && <ABadge tone={seat.badge.tone}>{seat.badge.label}</ABadge>}
        </div>
        <div className="bta-seat-stack">
          <span className="k">보유</span>
          <span className="v">{seat.stack}</span>
        </div>
      </div>
    </>
  );
  return (
    <div className={`bta-seat ${side}`}>
      {side === 'opp' ? (
        <>
          <div className="bta-avatar">{avatar}</div>
          <div className="bta-seat-info">
            <div className="bta-seat-name">
              {seat.name}
              {seat.badge && <ABadge tone={seat.badge.tone}>{seat.badge.label}</ABadge>}
            </div>
            <div className="bta-seat-stack">
              <span className="k">보유</span>
              <span className="v">{seat.stack}</span>
            </div>
          </div>
          <div className="bta-seat-divider" />
          <ChipStack amount={seat.stack} />
          {card}
        </>
      ) : (
        <>
          {card}
          {body}
        </>
      )}
    </div>
  );
}

function BetRow({ label, amount, mine }: { label: string; amount: number; mine?: boolean }) {
  return (
    <div className="bta-betrow">
      <ChipStack amount={amount} />
      <div className="bta-betrow-info">
        <span className={`bta-betrow-label ${mine ? 'accent' : ''}`}>{label}</span>
        <span className="bta-betrow-amt">{amount}</span>
      </div>
    </div>
  );
}

export default function BettingTable(p: {
  /** 보드 헤더 크럼: 게임명 */
  title: string;
  handNo: number;
  /** 덱 잔량 표기 (예: "13/20") — 없으면 미표시 */
  deckInfo?: string;
  /** 헤더 우측 턴 배지 */
  turn?: SeatBadge;
  opp: SeatInfo;
  me: SeatInfo;
  oppBet: number;
  myBet: number;
  /** 총 팟 (본 라운드 + 이월) */
  pot: number;
  carried: number;
  oppCard: ReactNode;
  myCard: ReactNode;
  /** 좌 레일 (핸드 로그 · 이월 팟) */
  leftRail?: ReactNode;
  /** 우 레일 (카운팅 · 성향 · 페널티) */
  rightRail?: ReactNode;
  /** 액션 바 상단 상태 라인 */
  statusLine?: string;
  /** 액션 바 본문 — 버튼 그리드 + 컨트롤 존, 또는 핸드 결과 */
  actionBar?: ReactNode;
}) {
  const live = p.oppBet + p.myBet;
  return (
    <div className="bta-board">
      <div className="bta-header">
        <div className="bta-header-left">
          <span className="brand">THE MASTERMIND</span>
          <span className="bta-vr" />
          <span className="crumb">{p.title}</span>
          <span className="sep">&gt;</span>
          <span className="round">HAND {String(p.handNo).padStart(2, '0')}</span>
        </div>
        <div className="bta-header-right">
          {p.deckInfo && (
            <>
              <span className="k">덱 잔량</span>
              <span className="v">{p.deckInfo}</span>
              <span className="bta-vr" />
            </>
          )}
          {p.turn && <ABadge tone={p.turn.tone}>{p.turn.label}</ABadge>}
        </div>
      </div>

      <div className="bta-grid">
        {p.leftRail && <div className="bta-rail left">{p.leftRail}</div>}

        <div className="bta-center">
          <SeatCard seat={p.opp} side="opp" card={p.oppCard} />
          <BetRow label={`${p.opp.name} 베팅`} amount={p.oppBet} />
          <div className="bta-pot">
            <div className="bta-pot-label">
              <span className="dot" />총 팟<span className="dot" />
            </div>
            {/* key로 금액 변경 시 pop 애니메이션 재생 */}
            <span key={p.pot} className="bta-pot-num">
              {p.pot}
            </span>
            {(live > 0 || p.carried > 0) && (
              <span className="bta-pot-sub">
                본 라운드 {live} · <span className="gold">이월 {p.carried}</span>
              </span>
            )}
          </div>
          <BetRow label="내 베팅" amount={p.myBet} mine />
          <SeatCard seat={p.me} side="me" card={p.myCard} />
        </div>

        {p.rightRail && <div className="bta-rail right">{p.rightRail}</div>}
      </div>

      <div className="bta-actionbar">
        {p.statusLine && <div className="bta-status">{p.statusLine}</div>}
        {p.actionBar}
      </div>
    </div>
  );
}

/** 액션 버튼 — Qurie 필 버튼 근사 (54px 필, 하단 캡션) */
export function ActionBtn({
  variant,
  caption,
  captionTone,
  onClick,
  disabled,
  children,
}: {
  variant: 'accent' | 'primary' | 'secondary' | 'gold';
  caption?: string;
  captionTone?: 'gold';
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="bta-abtn-wrap">
      <button className={`bta-abtn ${variant}`} onClick={onClick} disabled={disabled}>
        {children}
      </button>
      {caption && <span className={`bta-abtn-caption ${captionTone ?? ''}`}>{caption}</span>}
    </div>
  );
}

/**
 * 칩 트레이 — 실물 칩을 집어 미는 동작의 디지털 번역.
 * 액면 칩(+1/+5/+10/+25)을 탭해 레이즈 총액을 쌓고, MAX/초기화 + 숫자 직접 입력 병행.
 * value는 "레이즈 총액"(내 베팅 목표 총량) 기준.
 */
export function ChipTray({
  value,
  min,
  max,
  onChange,
  onEnter,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (total: number) => void;
  onEnter?: () => void;
}) {
  return (
    <div className="bta-tray">
      <div className="bta-tray-head">
        <span className="k">칩 트레이 — 탭해서 쌓기</span>
        <span className="v">{value}</span>
      </div>
      <div className="bta-tray-row">
        {[...DEN].reverse().map((d) => (
          <button
            key={d.v}
            className="bta-tray-chip"
            style={{ background: d.f, borderColor: d.r }}
            disabled={value + d.v > max}
            onClick={() => onChange(Math.min(max, value + d.v))}
            aria-label={`칩 ${d.v} 추가`}
          >
            +{d.v}
          </button>
        ))}
        <button className="bta-tray-pill strong" onClick={() => onChange(max)}>
          MAX
        </button>
        <button className="bta-tray-pill" onClick={() => onChange(min)}>
          초기화
        </button>
        <div className="bta-tray-stepper">
          <NumberStepper value={value} min={min} max={max} onChange={onChange} onEnter={onEnter} />
        </div>
      </div>
    </div>
  );
}

/** 우/좌 레일 섹션 타이틀 */
export function RailTitle({ children }: { children: ReactNode }) {
  return <div className="bta-rail-title">{children}</div>;
}
