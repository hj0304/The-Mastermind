/**
 * 선공을 정하는 동전 던지기 — 모든 게임이 공유한다.
 *
 * 원작의 데스매치는 선후공을 동전 던지기로 정하고, 그 장면 자체가 긴장의 일부다.
 * 결과(first)는 호출하는 쪽이 이미 정해서 넘기고, 여기서는 그 결과로 떨어지는
 * 연출만 담당한다 — 온라인에서는 호스트가 정한 값을 양쪽이 같이 봐야 하기 때문이다.
 *
 * 앞면 = labels[0]이 선공, 뒷면 = labels[1]이 선공. 던지기 전에 이 대응을 먼저
 * 보여줘야 결과가 납득된다.
 */

import { useEffect, useState } from 'react';
import './coin.css';

export default function CoinToss({
  first,
  labels,
  onDone,
  holdMs = 1200,
}: {
  /** 0이면 앞면, 1이면 뒷면으로 떨어진다 */
  first: 0 | 1;
  /** [앞면이 나왔을 때 선공, 뒷면이 나왔을 때 선공] */
  labels: [string, string];
  onDone: () => void;
  /** 결과를 보여주는 시간 */
  holdMs?: number;
}) {
  const [landed, setLanded] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLanded(true), 1500);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    if (!landed) return;
    const t2 = setTimeout(() => {
      setDone(true);
      onDone();
    }, holdMs);
    return () => clearTimeout(t2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);

  /** 연출을 기다리지 않고 넘기기 */
  function skip() {
    if (done) return;
    setDone(true);
    onDone();
  }

  return (
    <div className="coin-overlay" onClick={skip}>
      <p className="coin-title">선공을 정합니다</p>
      <div className={`coin ${first === 0 ? 'to-heads' : 'to-tails'}`}>
        <span className="coin-face front">앞</span>
        <span className="coin-face back">뒤</span>
      </div>
      {landed ? (
        <p className="coin-result">
          <b>{first === 0 ? '앞면' : '뒷면'}</b> — {labels[first]} 선공!
        </p>
      ) : (
        <p className="coin-legend">
          앞면 = {labels[0]} 선공 · 뒷면 = {labels[1]} 선공
        </p>
      )}
      <p className="coin-skip">{landed ? '' : '화면을 누르면 건너뜁니다'}</p>
    </div>
  );
}
