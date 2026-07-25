/**
 * 항복 버튼 — 기세가 넘어간 대국을 포기한다.
 * 확인 모달을 거쳐 패배로 기록하고 로비로 돌아간다. 솔로(AI) 대국 전용.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { recordResult } from '../../stats.ts';
import './surrender.css';

export function SurrenderButton({ gameId, onExit }: { gameId: string; onExit: () => void }) {
  const [confirm, setConfirm] = useState(false);

  function surrender() {
    recordResult(gameId, false);
    onExit();
  }

  return (
    <>
      <button className="surrender-btn" onClick={() => setConfirm(true)}>
        🏳️ 항복
      </button>
      {confirm &&
        createPortal(
          <div className="sr-overlay" onClick={() => setConfirm(false)}>
            <div className="sr-panel" onClick={(e) => e.stopPropagation()}>
              <h3>항복하시겠습니까?</h3>
              <p>이번 대국은 패배로 기록되고 로비로 돌아갑니다.</p>
              <div className="sr-actions">
                <button className="sr-yes" onClick={surrender}>항복</button>
                <button className="sr-no" onClick={() => setConfirm(false)}>계속 대국</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
