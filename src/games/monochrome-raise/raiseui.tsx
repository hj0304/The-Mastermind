/**
 * 모노크롬 레이즈 UI 조각 — 미니멀 톤(pokerui 무드) 위에 이 게임만의 정체성을 얹는다.
 *
 * - 흑백 타일이 소재: 짝수 흑 · 홀수 백, 무드가 바뀌어도 타일은 항상 무채색.
 *   뒷면은 흑백 대각 분할 — 한눈에 이 게임임이 보인다.
 * - 10칸 배치 트랙: 상대/내 칩 분배가 한 줄에, 현재 라운드 하이라이트 +
 *   지난 라운드 승/패/무/F 마크.
 * - 배치 보드: 탭→탭으로 슬롯(타일+칩) 교환, 선택 후 ±로 칩 분배.
 */

import { useState } from 'react';
import type { PlayerId, RaiseSetup, RaiseState } from './engine.ts';
import { TOTAL_CHIPS } from './engine.ts';
import './raise.css';

export const tileColor = (v: number) => (v % 2 === 0 ? 'black' : 'white');

/** 상대 타일 — 흑백 분할 뒷면, 공개 시 플립. value<0(비공개 뷰)이면 절대 뒤집히지 않는다 */
export function RaiseTileFlip({ value, revealed }: { value: number; revealed: boolean }) {
  const show = revealed && value >= 0;
  return (
    <div className="rz-flip">
      <div className={`rz-flip-inner ${show ? 'flipped' : ''}`}>
        <div className="rz-tf back">
          <span className="q">?</span>
        </div>
        <div className={`rz-tf face ${show ? tileColor(value) : ''}`}>{show ? value : ''}</div>
      </div>
    </div>
  );
}

/** 내 타일 — 항상 앞면 (상대에겐 비공개) */
export function RaiseTileFace({ value }: { value: number }) {
  return <div className={`rz-tile-face ${tileColor(value)}`}>{value}</div>;
}

/** 10칸 배치 트랙 — 위 = 상대 칩, 아래 = 내 칩 */
export function TrackStrip({ state, me }: { state: RaiseState; me: PlayerId }) {
  const opp = (1 - me) as PlayerId;
  const cur = state.phase === 'gameover' ? -1 : state.round;
  const mkTxt = { w: '승', l: '패', d: '무', f: 'F' } as const;
  return (
    <div className="rz-track">
      {Array.from({ length: 10 }, (_, i) => {
        const h = state.history.find((r) => r.round === i);
        const mark = !h
          ? null
          : h.outcome === 'fold'
            ? 'f'
            : h.outcome === 'draw'
              ? 'd'
              : h.winner === me
                ? 'w'
                : 'l';
        return (
          <div key={i} className={`rz-cell ${i === cur ? 'cur' : ''} ${h ? 'done' : ''}`}>
            {mark && <span className={`rz-mk ${mark}`}>{mkTxt[mark]}</span>}
            <span className="a">{h ? h.finalBets[opp] : state.bets[opp][i]}</span>
            <span className="sep" />
            <span className="m">{h ? h.finalBets[me] : state.bets[me][i]}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 배치 보드 — 순서·칩 편집. 슬롯 탭→탭 교환(타일+칩 함께), 선택 슬롯은 ±로 칩 조절.
 * 남은 칩 계산·시작 버튼은 게임 쪽 몫.
 */
export function ArrangeBoard({
  setup,
  onChange,
  disabled = false,
}: {
  setup: RaiseSetup;
  onChange: (s: RaiseSetup) => void;
  disabled?: boolean;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const used = setup.bets.reduce((a, b) => a + b, 0);
  const left = TOTAL_CHIPS - used;

  function tap(pos: number) {
    if (disabled) return;
    if (sel === null) {
      setSel(pos);
      return;
    }
    if (sel !== pos) {
      const order = [...setup.order];
      const bets = [...setup.bets];
      [order[sel], order[pos]] = [order[pos], order[sel]];
      [bets[sel], bets[pos]] = [bets[pos], bets[sel]];
      onChange({ order, bets });
    }
    setSel(null);
  }

  function adj(delta: number) {
    if (disabled || sel === null) return;
    const next = setup.bets[sel] + delta;
    if (next < 1) return;
    if (delta > 0 && left <= 0) return;
    const bets = [...setup.bets];
    bets[sel] = next;
    onChange({ ...setup, bets });
  }

  function shuffleOrder() {
    if (disabled) return;
    const order = [...setup.order];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    setSel(null);
    onChange({ ...setup, order });
  }

  return (
    <div className="rz-arrange">
      <div className="rz-grid">
        {setup.order.map((v, pos) => (
          <button
            key={pos}
            className={`rz-slot ${sel === pos ? 'sel' : ''}`}
            disabled={disabled}
            onClick={() => tap(pos)}
          >
            <span className="pos">{pos + 1}번</span>
            <span className={`mini ${tileColor(v)}`}>{v}</span>
            <span className="chips">●{setup.bets[pos]}</span>
          </button>
        ))}
      </div>
      <div className="rz-left-line">
        남은 칩 <b>{left}</b> / 타일당 최소 1개 · 총 {TOTAL_CHIPS}개
      </div>
      {sel !== null && !disabled && (
        <div className="rz-stepper">
          <button onClick={() => adj(-1)}>−</button>
          <span className="cv">{setup.bets[sel]}</span>
          <button onClick={() => adj(1)} disabled={left <= 0}>
            +
          </button>
          <span className="lbl">
            {sel + 1}번 타일 [{setup.order[sel]}] 칩
          </span>
        </div>
      )}
      {!disabled && (
        <div className="rz-tools">
          <button className="rz-minor" onClick={shuffleOrder}>
            순서 섞기
          </button>
        </div>
      )}
    </div>
  );
}
