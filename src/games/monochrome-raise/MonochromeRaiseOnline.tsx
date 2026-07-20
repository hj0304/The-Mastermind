import { useEffect, useRef, useState } from 'react';
import type { PlayerId, RaiseSetup, RaiseState } from './engine.ts';
import {
  TOTAL_CHIPS,
  createGame,
  decide,
  maxCallable,
  nextRound,
  randomSetup,
} from './engine.ts';
import { viewFor } from './view.ts';
import { TrackRow, tileColor } from './track.tsx';
import type { NetRoom } from '../../net/room.ts';
import './raise.css';
import '../../net/online.css';

/**
 * 모노크롬 레이즈 온라인 대전 — 호스트 권위 방식.
 *
 * 배치 단계가 있어 흐름이 두 층이다: 양쪽이 각자 타일 순서와 칩 배분을 설계해
 * 호스트에게 보내고, 둘 다 준비되면 호스트가 대국을 시작한다.
 * 칩 배분은 공개 정보이고, 상대의 타일 순서만 관점 뷰에서 가려진다(view.ts).
 */

type RAction = { k: 'decide'; action: 'call' | 'fold' } | { k: 'next' };

type NetMsg =
  | { t: 'ready' }
  | { t: 'setup'; s: RaiseSetup }
  | { t: 'view'; v: RaiseState }
  | { t: 'act'; a: RAction };

export default function MonochromeRaiseOnline({
  room,
  onExit,
}: {
  room: NetRoom;
  onExit: () => void;
}) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;

  const [mySetup, setMySetup] = useState<RaiseSetup>(randomSetup);
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [view, setView] = useState<RaiseState | null>(null);
  const [oppLeft, setOppLeft] = useState(false);

  const stateRef = useRef<RaiseState | null>(null);
  const setups = useRef<{ host: RaiseSetup | null; guest: RaiseSetup | null }>({
    host: null,
    guest: null,
  });

  const chipsUsed = mySetup.bets.reduce((a, b) => a + b, 0);

  function hostApply(next: RaiseState) {
    stateRef.current = next;
    setView(viewFor(next, 0));
    room.send({ t: 'view', v: viewFor(next, 1) } satisfies NetMsg);
  }

  function hostTryStart() {
    const { host, guest } = setups.current;
    if (!host || !guest || stateRef.current) return;
    hostApply(createGame(host, guest));
  }

  function hostAct(s: RaiseState, actor: PlayerId, a: RAction): RaiseState | null {
    try {
      if (a.k === 'next') {
        return s.phase === 'result' ? nextRound(s) : null;
      }
      if (s.phase !== 'decision' || s.toDecide !== actor) return null;
      return decide(s, a.action);
    } catch {
      return null;
    }
  }

  useEffect(() => {
    const offMsg = room.onMsg((raw) => {
      const msg = raw as NetMsg;
      if (room.isHost) {
        if (msg.t === 'ready' && stateRef.current) {
          room.send({ t: 'view', v: viewFor(stateRef.current, 1) } satisfies NetMsg);
        }
        if (msg.t === 'setup') {
          setups.current.guest = msg.s;
          hostTryStart();
        }
        if (msg.t === 'act' && stateRef.current) {
          const next = hostAct(stateRef.current, 1, msg.a);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'view') {
        setView(msg.v);
      }
    });
    const offPeers = room.onPeers((c) => {
      if (c === 0) setOppLeft(true);
    });
    if (!room.isHost) room.send({ t: 'ready' } satisfies NetMsg);
    return () => {
      offMsg();
      offPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exit() {
    room.leave();
    onExit();
  }

  function submitSetup() {
    if (chipsUsed !== TOTAL_CHIPS) return;
    setSubmitted(true);
    if (room.isHost) {
      setups.current.host = mySetup;
      hostTryStart();
    } else {
      room.send({ t: 'setup', s: mySetup } satisfies NetMsg);
    }
  }

  function act(a: RAction) {
    if (room.isHost) {
      const s = stateRef.current;
      if (!s) return;
      const next = hostAct(s, 0, a);
      if (next) hostApply(next);
    } else {
      room.send({ t: 'act', a } satisfies NetMsg);
    }
  }

  function onArrangeTileClick(pos: number) {
    if (submitted) return;
    if (swapFrom === null) {
      setSwapFrom(pos);
      return;
    }
    if (swapFrom !== pos) {
      setMySetup((s) => {
        const order = [...s.order];
        [order[swapFrom], order[pos]] = [order[pos], order[swapFrom]];
        return { ...s, order };
      });
    }
    setSwapFrom(null);
  }

  function adjustChip(pos: number, delta: number) {
    if (submitted) return;
    setMySetup((s) => {
      const bets = [...s.bets];
      const next = bets[pos] + delta;
      if (next < 1) return s;
      const total = bets.reduce((a, b) => a + b, 0) - bets[pos] + next;
      if (total > TOTAL_CHIPS) return s;
      bets[pos] = next;
      return { ...s, bets };
    });
  }

  // ---------- 배치 단계 ----------
  if (!view) {
    return (
      <div className="rz-root">
        <GameHeader onExit={exit} />
        <div className="online-status">
          <span className={`dot ${oppLeft ? 'off' : ''}`} />
          방 {room.code} · {room.isHost ? '호스트' : '게스트'}
        </div>
        <p className="rz-hint">
          {submitted
            ? '상대의 설계를 기다리는 중…'
            : <>타일 두 개를 클릭하면 순서를 바꿉니다. +/−로 칩을 분배하세요. (남은 칩 <b>{TOTAL_CHIPS - chipsUsed}</b>)</>}
        </p>
        <div className="rz-arrange">
          {mySetup.order.map((v, pos) => (
            <div key={pos} className="rz-slot">
              <span className="slot-no">{pos + 1}</span>
              <button
                className={`rz-tile ${tileColor(v)} ${swapFrom === pos ? 'selected' : ''}`}
                onClick={() => onArrangeTileClick(pos)}
              >
                {v}
              </button>
              <div className="chip-ctl">
                <button onClick={() => adjustChip(pos, -1)}>−</button>
                <span className="chip-n">{mySetup.bets[pos]}</span>
                <button onClick={() => adjustChip(pos, 1)}>＋</button>
              </div>
            </div>
          ))}
        </div>
        <div className="rz-actions">
          {!submitted ? (
            <>
              <button
                className="ghost-btn"
                onClick={() => {
                  setMySetup(randomSetup());
                  setSwapFrom(null);
                }}
              >
                🎲 다시 섞기
              </button>
              <button
                className="primary-btn"
                disabled={chipsUsed !== TOTAL_CHIPS}
                onClick={submitSetup}
              >
                {chipsUsed === TOTAL_CHIPS ? '이 설계로 대전 시작' : `칩 ${TOTAL_CHIPS - chipsUsed}개 더 분배`}
              </button>
            </>
          ) : (
            <p className="online-wait">
              <span className="online-spinner" /> 상대가 설계를 마치면 시작합니다
            </p>
          )}
        </div>
        {oppLeft && (
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

  // ---------- 대국 ----------
  const state = view;
  const r = state.round;
  const last = state.history[state.history.length - 1];
  const myDecision = state.phase === 'decision' && state.toDecide === me;
  const need = myDecision ? state.bets[opp][r] - state.bets[me][r] : 0;

  return (
    <div className="rz-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="rz-scoreboard">
        <div className="stack me">나 <b>{state.stash[me]}</b>칩</div>
        <div className="round-info">라운드 {Math.min(r + 1, 10)}/10</div>
        <div className="stack ai">상대 <b>{state.stash[opp]}</b>칩</div>
      </div>

      <TrackRow label="상대" state={state} p={opp} current={r} />
      <TrackRow label="나" state={state} p={me} current={r} mine />

      <div className="rz-panel">
        {state.phase === 'decision' && state.toDecide === opp && (
          <span className="rz-note">상대가 콜/폴드를 고민 중…</span>
        )}
        {myDecision && (
          <>
            <span className="rz-note">
              내 타일 <b>{state.order[me][r]}</b> · 내 베팅 {state.bets[me][r]} vs 상대{' '}
              {state.bets[opp][r]} — 콜 비용 <b>{need}</b>
              {need > state.stash[me] && ' (부족분은 이후 타일에서 차출)'}
            </span>
            <div className="rz-btns">
              <button
                className="action-btn fold"
                onClick={() => act({ k: 'decide', action: 'fold' })}
              >
                폴드
              </button>
              <button
                className="action-btn call"
                disabled={maxCallable(state, me) < need}
                onClick={() => act({ k: 'decide', action: 'call' })}
              >
                콜 (+{need})
              </button>
            </div>
          </>
        )}
        {state.phase === 'result' && last && (
          <>
            <span className="rz-note">
              {last.outcome === 'draw' &&
                `무승부 — 각자 베팅 회수 (${last.tiles[me]} vs ${last.tiles[opp]})`}
              {last.outcome === 'showdown' &&
                `${last.tiles[me]} vs ${last.tiles[opp]} — ${last.winner === me ? '팟 획득!' : '패배'} (${last.pot}칩)`}
              {last.outcome === 'fold' &&
                (last.folder === me
                  ? `폴드 — 상대가 ${last.pot}칩 획득 (타일 비공개)`
                  : `상대 폴드 — ${last.pot}칩 획득! (타일 비공개)`)}
            </span>
            <button className="primary-btn" onClick={() => act({ k: 'next' })}>
              {state.round >= 9 ? '결과 보기' : '다음 라운드'}
            </button>
          </>
        )}
      </div>

      {state.result && (
        <div className="rz-overlay">
          <div className="rz-endcard">
            <h2>
              {state.result.winner === null
                ? '무승부'
                : state.result.winner === me
                  ? '🏆 승리!'
                  : '패배…'}
            </h2>
            <p>최종 칩 — 나 {state.stash[me]} : 상대 {state.stash[opp]}</p>
            <div className="end-actions">
              <button className="ghost-btn" onClick={exit}>로비로</button>
            </div>
          </div>
        </div>
      )}

      {oppLeft && !state.result && (
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
      <span className="game-title">모노크롬 레이즈 · 온라인</span>
    </header>
  );
}
