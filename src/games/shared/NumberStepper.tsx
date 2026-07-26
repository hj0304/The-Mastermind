/**
 * 숫자 스텝퍼 — 직접 입력 + ▲▼ 1씩 증감. 베팅류 UI 공용.
 * (모노크롬 II 입찰 입력에서 검증된 패턴의 범용판)
 */

import { useEffect, useState } from 'react';
import './stepper.css';

export default function NumberStepper({
  value,
  min,
  max,
  onChange,
  onEnter,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  /** Enter 키 제출 (선택) */
  onEnter?: () => void;
}) {
  const [text, setText] = useState(String(value));

  // 외부 값 변경(퀵 버튼, 범위 보정)을 입력 칸에 반영
  useEffect(() => {
    setText(String(value));
  }, [value]);

  function clamp(v: number): number {
    return Math.max(min, Math.min(v, max));
  }

  function commit(raw: string) {
    setText(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) onChange(clamp(parsed));
  }

  return (
    <div className="ns-wrap">
      <input
        className="ns-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setText(String(value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.();
        }}
      />
      <div className="ns-col">
        <button className="ns-btn" onClick={() => onChange(clamp(value + 1))} aria-label="1 올리기">▲</button>
        <button className="ns-btn" onClick={() => onChange(clamp(value - 1))} aria-label="1 내리기">▼</button>
      </div>
    </div>
  );
}
