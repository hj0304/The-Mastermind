/**
 * 히든 포뮬러의 표시 요소 — AI 대전과 온라인 대전이 공유한다.
 * 문제·힌트 목록·답변 제한 시계는 규칙 그 자체를 보여주는 부분이라
 * 두 화면이 어긋나면 안 된다.
 */

import type { Hint } from './engine.ts';
import { ANSWER_SECONDS } from './engine.ts';

export function ProblemBar({ X, Y }: { X: number; Y: number }) {
  return (
    <div className="hf-problem">
      <span className="num">{X}</span>
      <span className="q">?</span>
      <span className="num">{Y}</span>
    </div>
  );
}

export function HintList({ hints }: { hints: Hint[] }) {
  return (
    <div className="hf-hints">
      {hints.length === 0 && <p className="hf-empty">첫 힌트를 만들 수를 제시하세요</p>}
      {hints.map((h, i) => (
        <div key={i} className={`hf-hint ${i === hints.length - 1 ? 'latest' : ''}`}>
          <span className="idx">{i + 1}</span>
          <span className="expr">{h.a} ? {h.b} = <b>{h.c}</b></span>
        </div>
      ))}
    </div>
  );
}

/** 버저 후 답변 제한 시간 — 막판 3초는 붉게 경고 */
export function AnswerClock({ remain }: { remain: number }) {
  const pct = Math.max(0, Math.min(100, (remain / ANSWER_SECONDS) * 100));
  return (
    <div className={`hf-answer-clock ${remain <= 3 ? 'urgent' : ''}`}>
      <div className="hf-answer-bar" style={{ width: `${pct}%` }} />
      <span className="hf-answer-num">{Math.ceil(remain)}초 안에 답하세요</span>
    </div>
  );
}
