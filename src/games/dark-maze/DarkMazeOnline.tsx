import { useEffect, useRef, useState } from 'react';
import type { DMState, PlayerId } from './engine.ts';
import {
  CHIPS_TO_WIN,
  SIZE,
  START,
  applyRoll,
  applyStep,
  applyStop,
  createGame,
  edgeCells,
  neighbors,
  rollDie,
} from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
import './darkmaze.css';
import '../../net/online.css';

/**
 * 암전 미궁 온라인 대전 — 호스트 권위 방식.
 * 숨은 벽 배치(walls)와 목표 주머니(bag)는 게스트에게 절대 전송하지 않는다.
 * 주사위도 호스트에서만 굴려 조작을 차단한다.
 */

/** 게스트에게 전송되는 관점 뷰 — 은닉 정보(walls/bag) 제외 */
type DMView = Omit<DMState, 'walls' | 'bag'> & { bagLeft: number };

type DMAction = { kind: 'roll' } | { kind: 'step'; dest: number } | { kind: 'stop' };
type NetMsg = { t: 'ready' } | { t: 'view'; v: DMView } | { t: 'act'; a: DMAction };

function viewOf(s: DMState): DMView {
  const { walls: _walls, bag, ...rest } = s;
  return { ...rest, bagLeft: bag.length };
}

const SYMBOL_LIST = [
  '🌙', '⭐', '🔥', '💧', '🍀', '👑', '🗝️', '🦉', '🐍', '🌹', '⚡', '🍄',
  '🔔', '🎭', '🧭', '⚗️', '📜', '🕸️', '🪶', '🦋', '🐚', '🎲', '⏳', '🕯️',
  '💎', '🌈', '🪄', '🐸', '🗿', '🍎', '☂️', '🎈',
];
const CORNERS = [0, SIZE - 1, SIZE * SIZE - SIZE, SIZE * SIZE - 1];
const CELL_SYMBOL: (string | null)[] = (() => {
  const out: (string | null)[] = [];
  let i = 0;
  for (let c = 0; c < SIZE * SIZE; c++) out.push(CORNERS.includes(c) ? null : SYMBOL_LIST[i++]);
  return out;
})();
const PCT = 100 / SIZE;

export default function DarkMazeOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<DMState | null>(null);
  const [view, setView] = useState<DMView | null>(null);
  const [dieAnim, setDieAnim] = useState<{ value: number; by: PlayerId } | null>(null);
  const [flash, setFlash] = useState<{ kind: 'bump' | 'chip'; by: PlayerId; edge?: number; cell?: number } | null>(null);
  const [oppLeft, setOppLeft] = useState(false);
  const prevRolled = useRef<number | null>(null);
  const lastEventRef = useRef<DMView['lastEvent']>(null);

  function hostApply(next: DMState) {
    stateRef.current = next;
    const v = viewOf(next);
    setView(v);
    room.send({ t: 'view', v } satisfies NetMsg);
  }

  function hostAct(s: DMState, actor: PlayerId, a: DMAction): DMState | null {
    if (s.result || s.turn !== actor) return null;
    try {
      if (a.kind === 'roll' && s.phase === 'roll') return applyRoll(s, rollDie());
      if (a.kind === 'step' && s.phase === 'move') return applyStep(s, a.dest);
      if (a.kind === 'stop' && s.phase === 'move') return applyStop(s);
    } catch {
      // 무효 액션 무시
    }
    return null;
  }

  useEffect(() => {
    const offMsg = room.onMsg((raw) => {
      const msg = raw as NetMsg;
      if (room.isHost) {
        if (msg.t === 'ready' && stateRef.current) {
          room.send({ t: 'view', v: viewOf(stateRef.current) } satisfies NetMsg);
        }
        if (msg.t === 'act' && stateRef.current) {
          const next = hostAct(stateRef.current, 1, msg.a);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'view') {
        setView(msg.v);
      }
    });
    const offPeers = room.onPeers((count) => {
      if (count === 0) setOppLeft(true);
    });
    if (room.isHost) {
      hostApply(createGame(Math.random() < 0.5 ? 0 : 1));
    } else {
      room.send({ t: 'ready' } satisfies NetMsg);
    }
    return () => {
      offMsg();
      offPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 주사위 연출: rolled가 null → 값으로 바뀌는 전이를 양쪽에서 감지
  useEffect(() => {
    if (!view) return;
    if (view.rolled !== null && prevRolled.current === null) {
      setDieAnim({ value: view.rolled, by: view.turn });
      const t = setTimeout(() => setDieAnim(null), 1250);
      prevRolled.current = view.rolled;
      return () => clearTimeout(t);
    }
    if (view.rolled === null) prevRolled.current = null;
  }, [view]);

  // 충돌/획득 연출
  useEffect(() => {
    if (!view || view.lastEvent === lastEventRef.current) return;
    lastEventRef.current = view.lastEvent;
    if (!view.lastEvent) return;
    const ev = view.lastEvent;
    setFlash(
      ev.kind === 'bump'
        ? { kind: 'bump', by: ev.by, edge: ev.edge }
        : { kind: 'chip', by: ev.by, cell: ev.cell },
    );
    const t = setTimeout(() => setFlash(null), 1700);
    return () => clearTimeout(t);
  }, [view]);

  function exit() {
    room.leave();
    onExit();
  }

  function act(a: DMAction) {
    if (room.isHost) {
      const s = stateRef.current;
      if (!s) return;
      const next = hostAct(s, 0, a);
      if (next) hostApply(next);
    } else {
      room.send({ t: 'act', a } satisfies NetMsg);
    }
  }

  if (!view) {
    return (
      <div className="dm-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const myTurn = !view.result && view.turn === me && !dieAnim;
  const movable = myTurn && view.phase === 'move' ? neighbors(view.pos[me]) : [];

  return (
    <div className="dm-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="dm-status">
        <div className={`dm-side me ${view.turn === me && !view.result ? 'active' : ''}`}>
          <span className="who">나 🧙</span>
          <span className="tray">
            {view.collected[me].map((c) => (
              <i key={c}>{CELL_SYMBOL[c]}</i>
            ))}
            {Array.from({ length: CHIPS_TO_WIN - view.chips[me] }, (_, i) => (
              <i key={`e${i}`} className="empty">○</i>
            ))}
          </span>
        </div>
        <div className="dm-target">
          {view.target >= 0 ? (
            <>
              <span className="target-label">목표</span>
              <span className="target-chip">{CELL_SYMBOL[view.target]}</span>
            </>
          ) : (
            <span className="target-chip">—</span>
          )}
        </div>
        <div className={`dm-side ai ${view.turn === opp && !view.result ? 'active' : ''}`}>
          <span className="who">🦹 상대</span>
          <span className="tray">
            {view.collected[opp].map((c) => (
              <i key={c}>{CELL_SYMBOL[c]}</i>
            ))}
            {Array.from({ length: CHIPS_TO_WIN - view.chips[opp] }, (_, i) => (
              <i key={`e${i}`} className="empty">○</i>
            ))}
          </span>
        </div>
      </div>

      <div className="dm-board-wrap">
        <div className="dm-board">
          {Array.from({ length: SIZE * SIZE }, (_, c) => {
            const isTarget = c === view.target;
            const canMove = movable.includes(c);
            return (
              <button
                key={c}
                className={[
                  'dm-cell',
                  CORNERS.includes(c) ? 'corner' : '',
                  c === START[me] ? 'home-me' : '',
                  c === START[opp] ? 'home-ai' : '',
                  isTarget ? 'target' : '',
                  canMove ? 'movable' : '',
                  flash?.kind === 'chip' && flash.cell === c ? 'chip-pop' : '',
                ].join(' ')}
                disabled={!canMove}
                onClick={() => act({ kind: 'step', dest: c })}
              >
                <span className="sym">{CELL_SYMBOL[c] ?? (c === START[me] ? '🏠' : c === START[opp] ? '🏰' : '')}</span>
              </button>
            );
          })}

          {flash?.kind === 'bump' && flash.edge !== undefined && (() => {
            const [a, b] = edgeCells(flash.edge);
            const r = Math.floor(a / SIZE);
            const c = a % SIZE;
            const style =
              b === a + 1
                ? { left: `calc(${(c + 1) * PCT}% - 2px)`, top: `${r * PCT}%`, width: '4px', height: `${PCT}%` }
                : { left: `${c * PCT}%`, top: `calc(${(r + 1) * PCT}% - 2px)`, width: `${PCT}%`, height: '4px' };
            return <div className="dm-wall-flash" style={style} />;
          })()}

          {[0, 1].map((p) => {
            const cell = view.pos[p];
            const bumped = flash?.kind === 'bump' && flash.by === p;
            return (
              <div
                key={p}
                className={`dm-piece ${p === me ? 'me' : 'ai'} ${bumped ? 'bumped' : ''}`}
                style={{ left: `${(cell % SIZE) * PCT}%`, top: `${Math.floor(cell / SIZE) * PCT}%` }}
              >
                {p === me ? '🧙' : '🦹'}
              </div>
            );
          })}
        </div>
      </div>

      <div className="dm-controls">
        {view.result ? (
          <p className="dm-msg endmsg">
            {view.result.winner === me ? '🎉 승리! 심볼 5개를 모았습니다' : '상대가 심볼 5개를 먼저 모았습니다…'}
          </p>
        ) : flash?.kind === 'bump' ? (
          <p className="dm-msg bump">
            💥 {flash.by === me ? '보이지 않는 벽에 부딪혔습니다! 시작점으로…' : '상대가 벽에 부딪혔습니다! (위치를 기억하세요)'}
          </p>
        ) : flash?.kind === 'chip' ? (
          <p className="dm-msg chip">
            {flash.by === me ? '✨ 심볼 획득!' : '상대가 심볼을 가져갔습니다'}
          </p>
        ) : myTurn && view.phase === 'roll' ? (
          <button className="primary-btn" onClick={() => act({ kind: 'roll' })}>🎲 주사위 굴리기</button>
        ) : myTurn && view.phase === 'move' ? (
          <div className="dm-move-bar">
            <span className="steps">
              남은 걸음{' '}
              {Array.from({ length: view.steps }, (_, i) => (
                <i key={i} className="step-dot" />
              ))}
            </span>
            <button className="stop-btn" onClick={() => act({ kind: 'stop' })}>멈추기</button>
          </div>
        ) : (
          <p className="dm-msg">상대 차례…</p>
        )}
      </div>

      {dieAnim && (
        <div className="dm-die-overlay">
          <div className="dm-die-box">
            <p>{dieAnim.by === me ? '나' : '상대'}의 주사위</p>
            <div className="dm-die" key={`${dieAnim.by}-${dieAnim.value}`}>
              <span>{dieAnim.value}</span>
            </div>
          </div>
        </div>
      )}

      {view.result && (
        <div className="dm-endcard-overlay">
          <div className="dm-endcard">
            <h3>{view.result.winner === me ? '승리!' : '패배…'}</h3>
            <p>
              {view.chips[me]} : {view.chips[opp]}
              {view.result.winner === me ? ' — 미궁을 정복했습니다' : ' — 상대의 기억력이 앞섰습니다'}
            </p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={() => hostApply(createGame(Math.random() < 0.5 ? 0 : 1))}>
                  다시 대전
                </button>
              ) : (
                <p className="online-hint">호스트가 재대결을 시작할 수 있습니다</p>
              )}
              <button className="ghost-btn" onClick={exit}>로비로</button>
            </div>
          </div>
        </div>
      )}

      {oppLeft && !view.result && (
        <div className="online-notice-overlay">
          <div className="online-notice">
            <p>상대의 연결이 끊어졌습니다</p>
            <button className="primary-btn" onClick={exit}>로비로</button>
          </div>
        </div>
      )}
    </div>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">암전 미궁 · 온라인</span>
    </header>
  );
}
