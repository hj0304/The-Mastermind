/**
 * 윷과 거짓말의 표시 요소 — AI 대전과 온라인 대전이 공유한다.
 *
 * 트레이(대기·완주·제거 수)는 승패 조건과 직결되고, 결과 배너와 주사위 연출은
 * "무엇이 공개됐고 무엇이 감춰졌는지"를 알리는 장치라 양쪽이 어긋나면 안 된다.
 * 그래서 복사하지 않고 이 모듈을 함께 쓴다.
 */

import { useEffect, useState } from 'react';
import type { BState, PlayerId, RoundRec } from './engine.ts';
import { DEAD, GOAL, HOME, VALUE_NAME } from './engine.ts';
import { PowerGauge, usePower } from '../shared/PowerGauge.tsx';

export function PlayerTray({
  state,
  p,
  label,
  movable,
  selected,
  onEnter,
}: {
  state: BState;
  p: PlayerId;
  label: string;
  movable?: boolean;
  selected?: boolean;
  onEnter?: () => void;
}) {
  const home = state.pieces[p].filter((x) => x === HOME).length;
  const dead = state.pieces[p].filter((x) => x === DEAD).length;
  const done = state.pieces[p].filter((x) => x === GOAL).length;
  return (
    <div className={`yb-tray pl${p}`}>
      <span className="yb-label">{label}</span>
      <button
        className={`yb-home ${movable ? 'movable' : ''} ${selected ? 'picked' : ''}`}
        disabled={!movable}
        onClick={onEnter}
      >
        {Array.from({ length: home }, (_, i) => (
          <span key={i} className={`tray-token pl${p}`} />
        ))}
        <span>대기 {home}</span>
      </button>
      <span className="yb-counts">
        완주 <b>{done}</b>/2{dead > 0 && <em> · 제거 {dead}</em>}
      </span>
    </div>
  );
}

/** 라운드 결과 배너 — 상대가 믿었는지/의심했는지를 크게 표시 */
export function OutcomeBanner({
  rec,
  me,
  oppLabel,
}: {
  rec: RoundRec;
  me: PlayerId;
  oppLabel: string;
}) {
  const rollerName = rec.roller === me ? '나' : oppLabel;
  const responderName = rec.roller === me ? oppLabel : '나';
  let icon = '';
  let title = '';
  let desc = '';
  let tone: 'good' | 'bad' | 'neutral' = 'neutral';

  if (rec.outcome === 'moved') {
    icon = rec.caught ? '💥' : '🤝';
    title = `${responderName}는 믿었습니다`;
    desc = `${rollerName}의 「${VALUE_NAME[rec.declared]}」 — ${rec.declared}칸 전진${
      rec.caught ? ' · 잡았습니다!' : ''
    }${rec.extra ? ' · 한 번 더' : ''}`;
    tone = rec.caught ? (rec.roller === me ? 'good' : 'bad') : 'neutral';
  } else if (rec.outcome === 'liar-caught') {
    icon = '🔥';
    title = `${responderName}의 의심 적중!`;
    desc = `「${VALUE_NAME[rec.declared]}」 선언은 거짓 — 실제는 「${VALUE_NAME[rec.roll]}」. ${rollerName}의 말 제거!`;
    tone = rec.roller === me ? 'bad' : 'good';
  } else if (rec.outcome === 'wrong-challenge') {
    icon = '💦';
    title = `${responderName}의 의심 실패…`;
    desc = `「${VALUE_NAME[rec.declared]}」은 진실이었습니다. ${responderName}의 말 제거, 이동은 그대로${
      rec.caught ? ' (잡음!)' : ''
    }`;
    tone = rec.roller === me ? 'good' : 'bad';
  } else {
    icon = '🕳️';
    title = `${rollerName} — 「꽝」 인정`;
    desc = `${rollerName}의 말 1개가 제거됩니다`;
    tone = rec.roller === me ? 'bad' : 'good';
  }

  return (
    <div className="yb-banner-overlay">
      <div className={`yb-banner ${tone}`}>
        <span className="yb-banner-icon">{icon}</span>
        <span className="yb-banner-title">{title}</span>
        <span className="yb-banner-desc">{desc}</span>
      </div>
    </div>
  );
}

/**
 * 10면체 주사위 연출.
 *
 * 내 차례에는 **직접 던진다**: 세기를 맞추고 버튼을 누르면 주사위가 굴러가
 * 멈춘다. 세기는 굴러가는 시간과 회전만 바꿀 뿐 **결과에는 영향이 없다**
 * (결과는 이미 정해져 넘어온 value다 — 온라인에서는 분산 주사위로 합의된 값이라
 * 여기서 다시 뽑으면 안 된다).
 *
 * 상대 차례에는 굴러가는 모습만 보이고 눈은 가린다.
 */
export function D10Overlay({
  mine,
  value,
  oppLabel,
  onDone,
}: {
  mine: boolean;
  value: number;
  oppLabel: string;
  /** 내가 던진 주사위가 멈춘 뒤 (없으면 자동 진행) */
  onDone?: () => void;
}) {
  const [stage, setStage] = useState<'ready' | 'rolling' | 'settled'>(mine ? 'ready' : 'rolling');
  const power = usePower(stage === 'ready');
  const [flick, setFlick] = useState(0);
  // 세기에 따라 0.7초(살살)에서 2.6초(힘껏)까지 — 결과는 그대로고 구르는 시간만 달라진다
  const rollMs = 700 + Math.round(power * 19);

  // 굴러가는 동안 눈이 계속 바뀐다
  useEffect(() => {
    if (stage !== 'rolling') return;
    const iv = setInterval(() => setFlick((n) => n + 1), 90);
    const t = setTimeout(() => setStage('settled'), mine ? rollMs : 900);
    return () => {
      clearInterval(iv);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // 멈춘 뒤 결과를 잠깐 보여주고 넘어간다
  useEffect(() => {
    if (stage !== 'settled' || !onDone) return;
    const t = setTimeout(onDone, 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const spins = 1 + Math.round((power / 100) * 4);
  const face = stage === 'settled' ? (mine ? VALUE_NAME[value] : '?') : FLICK_FACES[flick % FLICK_FACES.length];

  return (
    <div className="d10-overlay" onClick={stage === 'settled' && onDone ? onDone : undefined}>
      <div
        className={`d10 ${stage} ${!mine ? 'hidden-face' : ''}`}
        style={{ ['--spin' as string]: spins, ['--roll' as string]: `${mine ? rollMs : 900}ms` }}
      >
        {stage === 'ready' ? '?' : face}
      </div>

      {stage === 'ready' && (
        <>
          <PowerGauge value={power} />
          <button className="primary-btn" onClick={() => setStage('rolling')}>
            🎲 주사위 던지기
          </button>
          <div className="d10-caption">세기는 결과에 영향을 주지 않습니다</div>
        </>
      )}

      {stage !== 'ready' &&
        (mine ? (
          <>
            <span className="d10-secret-tag">나만 볼 수 있는 결과</span>
            <div className="d10-caption">
              {stage === 'settled' ? (
                <>
                  10면체 주사위가 멈췄습니다 — 이제 <b>원하는 대로</b> 선언하세요
                </>
              ) : (
                '주사위가 구르는 중…'
              )}
            </div>
          </>
        ) : (
          <div className="d10-caption">
            {oppLabel}가 주사위를 굴렸습니다
            <br />
            결과는 <b>{oppLabel}만</b> 확인했습니다
          </div>
        ))}
    </div>
  );
}

/** 굴러가는 동안 스쳐 지나가는 눈들 */
const FLICK_FACES = ['도', '개', '걸', '윷', '모', '꽝'];
