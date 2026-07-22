/**
 * 선공을 정하는 동전 던지기 — 모든 게임이 공유한다.
 *
 * 원작의 데스매치는 선후공을 동전 던지기로 정하고, 그 장면 자체가 긴장의 일부다.
 * 그래서 두 가지 모드로 나눈다.
 *
 * - `call` (AI 대전): **플레이어가 앞/뒤를 부르면 그 자리에서 동전이 튀어오른다.**
 *   부른 면이 나오면 플레이어가 선공. 결과는 이 컴포넌트가 뽑는다.
 * - `show` (온라인): 결과는 호스트가 이미 정해 넘긴다(양쪽이 같은 결과를 봐야 하므로
 *   각자 던지게 할 수 없다). 동전의 두 면에 '나'와 '상대'가 적혀 있고,
 *   **위로 나온 면의 주인이 선공**이다.
 *
 * 어느 쪽이든 onDone(first)로 labels 기준 선공 인덱스를 돌려준다.
 */

import { useEffect, useState } from 'react';
import './coin.css';

type Side = 0 | 1;

export default function CoinToss({
  mode = 'show',
  first,
  labels,
  onDone,
  holdMs = 1400,
}: {
  mode?: 'call' | 'show';
  /** show 모드에서 위로 나올 면 (0 = 앞면) */
  first?: Side;
  /** [앞면 쪽, 뒷면 쪽] */
  labels: [string, string];
  onDone: (first: Side) => void;
  holdMs?: number;
}) {
  /** call 모드에서 플레이어가 부른 면 */
  const [called, setCalled] = useState<Side | null>(null);
  /** 실제로 위로 나온 면 — null이면 아직 안 던진 상태 */
  const [face, setFace] = useState<Side | null>(mode === 'show' ? (first ?? 0) : null);
  const [landed, setLanded] = useState(false);
  const [done, setDone] = useState(false);

  // 던져진 뒤: 착지 → 결과 표시 → 종료
  useEffect(() => {
    if (face === null) return;
    const t = setTimeout(() => setLanded(true), 1750);
    return () => clearTimeout(t);
  }, [face]);

  useEffect(() => {
    if (!landed || face === null) return;
    const t = setTimeout(() => finish(), holdMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);

  function finish() {
    if (done || face === null) return;
    setDone(true);
    // call 모드: 부른 면이 나오면 부른 사람(labels[0])이 선공
    onDone(mode === 'call' ? (face === called ? 0 : 1) : face);
  }

  function call(side: Side) {
    setCalled(side);
    setFace(Math.random() < 0.5 ? 0 : 1);
  }

  const winner: Side | null =
    face === null ? null : mode === 'call' ? (face === called ? 0 : 1) : face;
  const headText = mode === 'call' ? '앞' : labels[0];
  const tailText = mode === 'call' ? '뒤' : labels[1];

  // ---- 부르기 (call 모드, 아직 안 던짐) ----
  if (mode === 'call' && face === null) {
    return (
      <div className="coin-overlay">
        <p className="coin-title">동전을 던져 선공을 정합니다</p>
        <div className="coin-stage">
          <div className="coin idle">
            <span className="coin-face front">{headText}</span>
            <span className="coin-edge" />
            <span className="coin-face back">{tailText}</span>
          </div>
          <div className="coin-shadow" />
        </div>
        <p className="coin-legend">어느 면이 나올지 부르세요 — 맞히면 내가 선공입니다</p>
        <div className="coin-call">
          <button className="coin-call-btn" onClick={() => call(0)}>앞면</button>
          <button className="coin-call-btn tails" onClick={() => call(1)}>뒷면</button>
        </div>
      </div>
    );
  }

  // ---- 던지는 중 / 결과 ----
  return (
    <div className="coin-overlay" onClick={landed ? finish : undefined}>
      <p className="coin-title">
        {mode === 'call'
          ? `${called === 0 ? '앞면' : '뒷면'}을 불렀습니다`
          : '선공을 정합니다'}
      </p>
      <div className="coin-stage">
        <div className={`coin flip ${face === 0 ? 'to-heads' : 'to-tails'} ${landed ? 'done' : ''}`}>
          <span className="coin-face front">{headText}</span>
          <span className="coin-edge" />
          <span className="coin-face back">{tailText}</span>
        </div>
        <div className={`coin-shadow ${landed ? '' : 'flying'}`} />
      </div>
      {landed && winner !== null ? (
        <p className="coin-result">
          <b>{face === 0 ? '앞면' : '뒷면'}</b> — {labels[winner]} 선공!
        </p>
      ) : (
        <p className="coin-legend">
          {mode === 'call' ? ' ' : '위로 나온 면의 주인이 선공입니다'}
        </p>
      )}
      <p className="coin-skip">{landed ? '탭하여 계속' : ' '}</p>
    </div>
  );
}
