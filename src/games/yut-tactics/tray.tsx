/**
 * 윷 대전 플레이어 트레이 — AI 대전과 온라인 대전이 공유한다.
 * 대기 말 수와 완주 수 표시가 승리 조건(두 말 완주)과 직결되므로 중복 구현하지 않는다.
 */

import type { PlayerId, YState } from './engine.ts';
import { GOAL, HOME } from './engine.ts';

export function PlayerTray({
  state,
  p,
  label,
  movable,
  onEnter,
}: {
  state: YState;
  p: PlayerId;
  label: string;
  movable?: boolean;
  onEnter?: () => void;
}) {
  const home = state.pieces[p].filter((x) => x.pos === HOME).length;
  const done = state.pieces[p].filter((x) => x.pos === GOAL).length;
  return (
    <div className={`yt-tray pl${p}`}>
      <span className="yt-tray-label">{label}</span>
      <button
        className={`yt-home ${movable ? 'movable' : ''}`}
        disabled={!movable}
        onClick={onEnter}
      >
        {Array.from({ length: home }, (_, i) => (
          <span key={i} className={`tray-token pl${p}`} />
        ))}
        <span>대기 {home}</span>
      </button>
      <span className="yt-done">
        완주 <b>{done}</b>/2
      </span>
    </div>
  );
}
