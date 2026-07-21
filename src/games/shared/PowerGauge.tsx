/**
 * 던지는 세기 게이지 — 동전 던지기와 10면체 주사위가 함께 쓴다.
 *
 * 세기는 **결과에 전혀 영향을 주지 않는다**. 실물로 던지는 감각을 주는 장치이고,
 * 회전 수와 굴러가는 시간만 달라진다. (그래서 결과를 정하는 쪽 코드와 분리해 둔다)
 */

import { useEffect, useState } from 'react';
import './power.css';

/** active인 동안 0~100을 오르내리는 값 */
export function usePower(active: boolean): number {
  const [power, setPower] = useState(0);
  useEffect(() => {
    if (!active) return;
    let dir = 1;
    const iv = setInterval(() => {
      setPower((p) => {
        const next = p + dir * 4;
        if (next >= 100) dir = -1;
        else if (next <= 0) dir = 1;
        return Math.max(0, Math.min(100, next));
      });
    }, 16);
    return () => clearInterval(iv);
  }, [active]);
  return power;
}

export function PowerGauge({ value }: { value: number }) {
  return (
    <div className="power-gauge">
      <div className="power-fill" style={{ width: `${value}%` }} />
      <span className="power-label">세기</span>
    </div>
  );
}
