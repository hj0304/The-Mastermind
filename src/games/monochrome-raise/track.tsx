/**
 * 모노크롬 레이즈 트랙 렌더링 — AI 대전과 온라인 대전이 공유한다.
 * 타일 공개 여부 판정이 곧 규칙이라 중복 구현하지 않는다.
 */

import type { PlayerId, RaiseState } from './engine.ts';

export const tileColor = (n: number) => (n % 2 === 0 ? 'black' : 'white');

export function TrackRow({
  label,
  state,
  p,
  current,
  mine,
}: {
  label: string;
  state: RaiseState;
  p: PlayerId;
  current: number;
  mine?: boolean;
}) {
  return (
    <div className="rz-track">
      <span className="label">{label}</span>
      <div className="cells">
        {state.order[p].map((v, pos) => {
          const rec = state.history.find((h) => h.round === pos);
          const done = pos < current || state.phase === 'gameover';
          const revealed = mine || (rec?.revealed ?? false);
          const isCurrent = pos === current && state.phase !== 'gameover';
          return (
            <div key={pos} className={`rz-cell ${isCurrent ? 'current' : ''} ${done ? 'done' : ''}`}>
              <span className={`rz-tile small ${revealed ? tileColor(v) : 'back'}`}>
                {revealed ? v : '?'}
              </span>
              <span className="chips">{state.bets[p][pos]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
