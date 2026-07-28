/**
 * 포커류 베팅 게임 공용 UI — "포커 리디자인" 시안 충실 이식.
 *
 * 철학: 포커가 기본적으로 가져야 할 요소(카드 · 팟 · 베팅 · 액션)만 남긴 미니멀
 * 단일 컬럼(≤470px). 좌우 레일/카운팅/성향/로그 없음. 수직 축: 상대 좌석 →
 * 상대 카드 → 베팅 → 팟 → 내 베팅 → 내 카드 → 내 좌석 → 액션 패널.
 * 무드 3종(느와르/펠트/아이보리)은 화면 하단 필로 전환하고 localStorage에 기억.
 */

import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import './pokerui.css';

export type Mood = 'noir' | 'felt' | 'ivory';

const MOOD_NAME: Record<Mood, string> = { noir: '느와르', felt: '펠트', ivory: '아이보리' };

/** 시안의 3무드 팔레트 그대로 + 앱 공용 변수(--text 등) 리매핑 */
const MOODS: Record<Mood, Record<string, string>> = {
  noir: {
    '--bg': '#08080B', '--glow': 'rgba(124,92,255,.16)', '--panel': 'rgba(255,255,255,.045)',
    '--line': 'rgba(255,255,255,.1)', '--ink': '#F2F2F5', '--dim': '#86868F',
    '--ac': '#7C5CFF', '--acInk': '#FFFFFF', '--gold': '#E8B45A', '--danger': '#FF6B7A',
    '--solid': '#F2F2F5', '--solidInk': '#0B0B0D',
    '--cardBg': '#14141C', '--cardInk': '#F2F2F5', '--cardLine': 'rgba(124,92,255,.6)',
    '--cardGlow': '0 0 30px -8px rgba(124,92,255,.7)', '--cardBack': '#0E0E14',
  },
  felt: {
    '--bg': '#0B1B13', '--glow': 'rgba(217,177,92,.14)', '--panel': 'rgba(255,255,255,.05)',
    '--line': 'rgba(255,255,255,.12)', '--ink': '#F0EDE0', '--dim': '#7F9488',
    '--ac': '#D9B15C', '--acInk': '#241A05', '--gold': '#D9B15C', '--danger': '#E56D5D',
    '--solid': '#F0EDE0', '--solidInk': '#122A1D',
    '--cardBg': '#F6F1E1', '--cardInk': '#1B2A21', '--cardLine': '#FFFDF0',
    '--cardGlow': '0 10px 26px rgba(0,0,0,.45)', '--cardBack': '#0F241A',
  },
  ivory: {
    '--bg': '#F1EEE6', '--glow': 'rgba(195,59,46,.09)', '--panel': '#FFFFFF',
    '--line': 'rgba(23,23,15,.13)', '--ink': '#191910', '--dim': '#8B8779',
    '--ac': '#C33B2E', '--acInk': '#FFFFFF', '--gold': '#A6812F', '--danger': '#C33B2E',
    '--solid': '#191910', '--solidInk': '#FFFFFF',
    '--cardBg': '#FFFFFF', '--cardInk': '#191910', '--cardLine': 'rgba(23,23,15,.25)',
    '--cardGlow': '0 12px 28px rgba(23,23,15,.14)', '--cardBack': '#E7E2D4',
  },
};

const MOOD_KEY = 'mm-poker-mood';

export function useMood(): [Mood, (m: Mood) => void] {
  const [mood, setMoodRaw] = useState<Mood>(() => {
    const v = localStorage.getItem(MOOD_KEY);
    return v === 'noir' || v === 'felt' || v === 'ivory' ? v : 'felt';
  });
  const setMood = (m: Mood) => {
    localStorage.setItem(MOOD_KEY, m);
    setMoodRaw(m);
  };
  return [mood, setMood];
}

function moodVars(mood: Mood): CSSProperties {
  const m = MOODS[mood];
  // 무드 스코프 안의 앱 공통 컴포넌트(게임 헤더·룰북·버튼)도 무드를 따르게 리매핑
  return {
    ...m,
    '--text': m['--ink'],
    '--text-dim': m['--dim'],
    '--bg-card': m['--panel'],
    '--bg-card-hover': m['--panel'],
    '--border': m['--line'],
    '--accent': m['--ac'],
    '--accent-2': m['--ac'],
  } as CSSProperties;
}

export interface SeatProps {
  name: string;
  /** 지금 이 좌석 차례인가 — 글로우 도트 표시 */
  turn: boolean;
  stack: number;
  /** 면 선언 등 상태 필 (gold: 금색 톤) */
  badge?: { text: string; gold?: boolean } | null;
}

function SeatRow({ seat }: { seat: SeatProps }) {
  return (
    <div className="pk-seat">
      <div className="pk-seat-left">
        {seat.turn && <span className="pk-dot" />}
        <span className="pk-seat-name">{seat.name}</span>
        {seat.badge && (
          <span className={`pk-face-badge ${seat.badge.gold ? 'gold' : ''}`}>{seat.badge.text}</span>
        )}
      </div>
      <div className="pk-seat-right">
        <span className="k">칩</span>
        <span className="v">{seat.stack}</span>
      </div>
    </div>
  );
}

/** 무드 스코프 — 전체 화면 배경 + 무드/앱 변수 주입. 포커 외 베팅류 게임도 재사용 */
export function MoodScope({ mood, children }: { mood: Mood; children: ReactNode }) {
  return (
    <div className="pk-scope" style={moodVars(mood)}>
      <div className="pk-bg">{children}</div>
    </div>
  );
}

/** 무드 전환 필 (느와르/펠트/아이보리) */
export function MoodPills({ mood, onMood }: { mood: Mood; onMood: (m: Mood) => void }) {
  return (
    <div className="pk-moods">
      {(['noir', 'felt', 'ivory'] as Mood[]).map((m) => (
        <button key={m} className={`pk-mood ${mood === m ? 'on' : ''}`} onClick={() => onMood(m)}>
          {MOOD_NAME[m]}
        </button>
      ))}
    </div>
  );
}

/** 전체 화면 레이아웃 — header(게임 헤더)는 무드 스코프 안에서 렌더된다 */
export default function PokerLayout(p: {
  mood: Mood;
  onMood: (m: Mood) => void;
  header: ReactNode;
  handNo: number;
  opp: SeatProps;
  me: SeatProps;
  /** 카드 + 캡션 노드 */
  oppCard: ReactNode;
  myCard: ReactNode;
  oppBet: number;
  myBet: number;
  pot: number;
  carried: number;
  /** 하단 액션 패널 내용 */
  panel: ReactNode;
  /** 오버레이 등 부가 노드 */
  children?: ReactNode;
}) {
  return (
    <MoodScope mood={p.mood}>
      <div className="pk-col">
        {p.header}
          <div className="pk-handrow">HAND {String(p.handNo).padStart(2, '0')}</div>

          <SeatRow seat={p.opp} />

          <div className="pk-center">
            <div className="pk-zone">
              {p.oppCard}
              <span className="pk-bet-pill">
                베팅 <b>{p.oppBet}</b>
              </span>
            </div>
            <div className="pk-pot">
              <span className="pk-pot-label">팟</span>
              <span className="pk-pot-num">{p.pot}</span>
              {p.carried > 0 && <span className="pk-pot-carry">이월 +{p.carried}</span>}
            </div>
            <div className="pk-zone">
              <span className="pk-bet-pill">
                내 베팅 <b>{p.myBet}</b>
              </span>
              {p.myCard}
            </div>
          </div>

          <SeatRow seat={p.me} />

          <div className="pk-panel">{p.panel}</div>

          <MoodPills mood={p.mood} onMood={p.onMood} />

          {p.children}
      </div>
    </MoodScope>
  );
}

/** 단면 카드 (블라인드 포커) — hidden이면 대시 보더 물음표 */
export function PkCard({
  value,
  hidden = false,
  caption,
  captionAccent = false,
}: {
  value?: number | string;
  hidden?: boolean;
  caption: string;
  captionAccent?: boolean;
}) {
  return (
    <div className="pk-cardwrap">
      <div className={`pk-card ${hidden ? 'hidden' : ''}`}>{hidden ? '?' : value}</div>
      <span className={`pk-caption ${captionAccent ? 'accent' : ''}`}>{caption}</span>
    </div>
  );
}

/** 양면 카드 (야누스 포커) — 3D 플립. back이 null이면 '?' */
export function PkFlipCard({
  front,
  back,
  flipped,
  onClick,
  caption,
  captionAccent = false,
}: {
  front: number;
  back: number | null;
  flipped: boolean;
  onClick?: () => void;
  caption: string;
  captionAccent?: boolean;
}) {
  return (
    <div className="pk-cardwrap">
      <div className="pk-flip" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
        <div className={`pk-flip-inner ${flipped ? 'flipped' : ''}`}>
          <div className="pk-flip-face front">
            <span className="corner">앞</span>
            {front}
          </div>
          <div className="pk-flip-face back">
            <span className="corner">뒤</span>
            {back === null ? '?' : back}
          </div>
        </div>
      </div>
      <span className={`pk-caption ${captionAccent ? 'accent' : ''}`}>{caption}</span>
    </div>
  );
}

/** 베팅 슬라이더 — 포인터 드래그 + MAX/MIN. value는 클램프되어 표시된다 */
export function BetSlider({
  value,
  min,
  max,
  onChange,
  times2 = false,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  times2?: boolean;
}) {
  const dragging = useRef(false);
  const v = Math.min(Math.max(value, min), Math.max(min, max));
  const t = max > min ? (v - min) / (max - min) : 0;

  const setFromX = (el: HTMLElement, x: number) => {
    const r = el.getBoundingClientRect();
    const tt = Math.min(1, Math.max(0, (x - r.left - 14) / (r.width - 28)));
    onChange(Math.round(min + tt * (max - min)));
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromX(e.currentTarget, e.clientX);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) setFromX(e.currentTarget, e.clientX);
  };
  const up = () => {
    dragging.current = false;
  };

  return (
    <div className="pk-slider-row">
      <span className="pk-slider-readout">
        {v}
        {times2 && '×2'}
      </span>
      <div className="pk-slider" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <div className="track" />
        <div className="fill" style={{ width: `calc(14px + ${t.toFixed(3)}*(100% - 28px))` }} />
        <div className="thumb" style={{ left: `calc(${t.toFixed(3)}*(100% - 28px))` }} />
      </div>
      <div className="pk-slider-side">
        <button className="pk-minor" onClick={() => onChange(max)}>
          MAX
        </button>
        <button className="pk-minor" onClick={() => onChange(min)}>
          MIN
        </button>
      </div>
    </div>
  );
}

/** 핸드 결과 — 미니 카드 대결 + 문구 + 다음 핸드 */
export function PkResult({
  left,
  right,
  text,
  onNext,
}: {
  /** 상대 값 (미공개 '?') */
  left: string;
  /** 내 값 */
  right: string;
  text: string;
  onNext?: () => void;
}) {
  return (
    <div className="pk-result">
      <div className="pk-result-cards">
        <div className="pk-mini-card">{left}</div>
        <span className="vs">vs</span>
        <div className="pk-mini-card">{right}</div>
      </div>
      <div className="pk-result-text">{text}</div>
      {onNext && (
        <button className="pk-btn ac next" onClick={onNext}>
          다음 핸드
        </button>
      )}
    </div>
  );
}

/** 게임 종료 오버레이 */
export function PkOverlay({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <div className="pk-overlay">
      <div className="pk-endcard">
        <div className="pk-end-title">{title}</div>
        <div className="pk-end-sub">{sub}</div>
        {children}
      </div>
    </div>
  );
}
