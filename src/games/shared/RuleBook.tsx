/**
 * 게임 설명서 — 규칙만 담은 모달. 로비 카드·시작 화면·게임 중 어디서든 연다.
 * 데이터는 rulebook.ts, 여는 버튼은 RuleBookButton.
 */

import { useEffect, useState } from 'react';
import { RULEBOOK } from './rulebook.ts';
import './rulebook.css';

export function RuleBook({
  gameId,
  gameName,
  onClose,
}: {
  gameId: string;
  gameName: string;
  onClose: () => void;
}) {
  const rules = RULEBOOK[gameId];

  // ESC로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="rb-overlay" onClick={onClose}>
      <div className="rb-panel" onClick={(e) => e.stopPropagation()}>
        <header className="rb-head">
          <h2>{gameName} 설명서</h2>
          <button className="rb-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        {rules ? (
          <div className="rb-body">
            <p className="rb-origin">{rules.origin}</p>
            <p className="rb-intro">{rules.intro}</p>
            {rules.sections.map((s, i) => (
              <section key={i} className="rb-section">
                <h3>{s.title}</h3>
                {Array.isArray(s.body) ? (
                  <ol className="rb-list">
                    {s.body.map((line, j) => (
                      <li key={j}>{line}</li>
                    ))}
                  </ol>
                ) : (
                  <p>{s.body}</p>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="rb-body">
            <p className="rb-empty">이 게임의 설명서는 곧 추가됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** 설명서를 여는 버튼 — 자체적으로 모달 상태를 들고 있다 */
export function RuleBookButton({
  gameId,
  gameName,
  className = 'rb-btn',
  label = '📖 설명서',
}: {
  gameId: string;
  gameName: string;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && <RuleBook gameId={gameId} gameName={gameName} onClose={() => setOpen(false)} />}
    </>
  );
}
