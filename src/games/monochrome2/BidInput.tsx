/**
 * 모노크롬 II 입찰 입력 — 숫자 직접 입력 + ▲▼ 버튼 1씩 증감.
 * 솔로/온라인 공용. 제출하면 내부 값을 0으로 되돌린다.
 */

import { useState } from 'react';

export default function BidInput({ max, onSubmit }: { max: number; onSubmit: (bid: number) => void }) {
  const [text, setText] = useState('0');
  const parsed = parseInt(text, 10);
  const value = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, max));

  function setValue(v: number) {
    setText(String(Math.max(0, Math.min(v, max))));
  }
  function submit() {
    onSubmit(value);
    setText('0');
  }

  return (
    <div className="m2-bid-input">
      <div className="quick-bids">
        {[0, 1, 5, 9, 10, 11, 15, 20].filter((v) => v <= max).map((v) => (
          <button key={v} className={`quick ${value === v ? 'active' : ''}`} onClick={() => setValue(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="bid-row">
        <input
          className={`bid-number ${value <= 9 ? 'black' : 'white'}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText(String(value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <div className="stepper-col">
          <button className="step-btn" onClick={() => setValue(value + 1)} aria-label="1 올리기">▲</button>
          <button className="step-btn" onClick={() => setValue(value - 1)} aria-label="1 내리기">▼</button>
        </div>
        <button className="primary-btn" onClick={submit}>제시</button>
      </div>
      <p className="bid-note">
        {value <= 9 ? '흑으로 표시됩니다 (0~9)' : '백으로 표시됩니다 (10~99)'} · 잔여 {max}P
      </p>
    </div>
  );
}
