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

export function D10Overlay({
  mine,
  value,
  oppLabel,
}: {
  mine: boolean;
  value: number;
  oppLabel: string;
}) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 900);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="d10-overlay">
      <div className={`d10 ${settled ? 'settled' : 'rolling'} ${!mine ? 'hidden-face' : ''}`}>
        {settled ? (mine ? VALUE_NAME[value] : '?') : ''}
      </div>
      {mine ? (
        <>
          <span className="d10-secret-tag">나만 볼 수 있는 결과</span>
          <div className="d10-caption">
            10면체 주사위를 굴렸습니다 — 이제 <b>원하는 대로</b> 선언하세요
          </div>
        </>
      ) : (
        <div className="d10-caption">
          {oppLabel}가 주사위를 굴렸습니다
          <br />
          결과는 <b>{oppLabel}만</b> 확인했습니다
        </div>
      )}
    </div>
  );
}
