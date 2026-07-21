/**
 * 선공을 정하는 동전 던지기 — 모든 게임이 공유한다.
 *
 * 원작의 데스매치는 선후공을 동전 던지기로 정하고, 그 장면 자체가 긴장의 일부다.
 * 그래서 두 가지 모드로 나눈다.
 *
 * - `call` (AI 대전): **플레이어가 앞/뒤를 부르고 직접 던진다.** 부른 면이 나오면
 *   플레이어가 선공. 결과는 던지는 순간 정해지므로 이 컴포넌트가 뽑는다.
 * - `show` (온라인): 결과는 호스트가 이미 정해 넘긴다(양쪽이 같은 결과를 봐야 하므로
 *   각자 던지게 할 수 없다). 동전의 두 면에 '나'와 '상대'가 적혀 있고,
 *   **위로 나온 면의 주인이 선공**이다.
 *
 * 어느 쪽이든 onDone(first)로 labels 기준 선공 인덱스를 돌려준다.
 */

import { useEffect, useState } from 'react';
import { PowerGauge, usePower } from './PowerGauge.tsx';
import './coin.css';

type Side = 0 | 1;

export default function CoinToss({
  mode = 'show',
  first,
  labels,
  onDone,
  holdMs = 1300,
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
  /** 실제로 위로 나온 면 */
  const [face, setFace] = useState<Side | null>(mode === 'show' ? (first ?? 0) : null);
  const [landed, setLanded] = useState(false);
  const [done, setDone] = useState(false);
  /** 던지는 세기 — 결과에는 영향이 없고 회전 수만 달라진다 */
  const power = usePower(mode === 'call' && called !== null && face === null);

  /** 체공 시간 — 세게 던질수록 오래 돈다 (결과와 무관) */
  const flyMs = mode === 'call' ? 900 + Math.round(power * 14) : 1500;

  // 던져진 뒤: 착지 → 결과 표시 → 종료
  useEffect(() => {
    if (face === null) return;
    const t = setTimeout(() => setLanded(true), flyMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function throwCoin() {
    if (face !== null) return;
    setFace(Math.random() < 0.5 ? 0 : 1);
  }

  const winner: Side | null =
    face === null ? null : mode === 'call' ? (face === called ? 0 : 1) : face;

  // ---- 부르기 ----
  if (mode === 'call' && called === null) {
    return (
      <div className="coin-overlay">
        <p className="coin-title">동전을 던져 선공을 정합니다</p>
        <div className="coin idle">
          <span className="coin-face front">앞</span>
        </div>
        <p className="coin-legend">어느 면이 나올지 부르세요 — 맞히면 내가 선공입니다</p>
        <div className="coin-call">
          <button className="coin-call-btn" onClick={() => setCalled(0)}>앞면</button>
          <button className="coin-call-btn tails" onClick={() => setCalled(1)}>뒷면</button>
        </div>
      </div>
    );
  }

  // ---- 세기 조절 후 던지기 ----
  if (mode === 'call' && face === null) {
    return (
      <div className="coin-overlay">
        <p className="coin-title">
          <b>{called === 0 ? '앞면' : '뒷면'}</b>을 불렀습니다
        </p>
        <div className="coin idle">
          <span className="coin-face front">{called === 0 ? '앞' : '뒤'}</span>
        </div>
        <PowerGauge value={power} />
        <p className="coin-legend">세기는 결과에 영향을 주지 않습니다</p>
        <button className="primary-btn" onClick={throwCoin}>던지기!</button>
      </div>
    );
  }

  // ---- 던지는 중 / 결과 ----
  const spin = 1 + Math.round((power / 100) * 3); // 세게 던질수록 더 돈다(결과와 무관)
  return (
    <div className="coin-overlay" onClick={finish}>
      <p className="coin-title">
        {mode === 'call' ? `${called === 0 ? '앞면' : '뒷면'}을 불렀습니다` : '선공을 정합니다'}
      </p>
      <div
        className={`coin ${face === 0 ? 'to-heads' : 'to-tails'}`}
        style={{ ['--spin' as string]: spin, ['--fly' as string]: `${flyMs}ms` }}
      >
        <span className="coin-face front">{mode === 'call' ? '앞' : labels[0]}</span>
        <span className="coin-face back">{mode === 'call' ? '뒤' : labels[1]}</span>
      </div>
      {landed && winner !== null ? (
        <p className="coin-result">
          <b>{face === 0 ? '앞면' : '뒷면'}</b> — {labels[winner]} 선공!
        </p>
      ) : (
        <p className="coin-legend">
          {mode === 'call' ? ' ' : `위로 나온 면의 주인이 선공입니다`}
        </p>
      )}
      <p className="coin-skip">{landed ? '' : '화면을 누르면 건너뜁니다'}</p>
    </div>
  );
}
