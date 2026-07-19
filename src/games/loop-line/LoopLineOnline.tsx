import { useEffect, useRef, useState } from 'react';
import type { LLState, PlayerId } from './engine.ts';
import {
  STATIONS,
  TILES,
  W,
  applyDeclare,
  applyGiveUp,
  applyPlace,
  createGame,
  isValidLine,
  placedSet,
} from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
import { RailTile, StationTile, TrainOnLoop, openDirs } from './rail.tsx';
import './loopline.css';
import '../../net/online.css';

/**
 * 순환선 온라인 대전 — 완전 공개 정보 게임이라 호스트가 전체 상태를 복제 전송한다.
 * 액션 검증은 호스트 엔진에서 수행(호스트 권위).
 */

type LLAction = { kind: 'place'; line: number[] } | { kind: 'declare' } | { kind: 'giveup' };
type NetMsg = { t: 'ready' } | { t: 'state'; s: LLState } | { t: 'act'; a: LLAction };


export default function LoopLineOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<LLState | null>(null);
  const [state, setState] = useState<LLState | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [oppLeft, setOppLeft] = useState(false);

  function moverOf(s: LLState): PlayerId | null {
    if (s.result) return null;
    if (s.phase === 'play') return s.turn;
    if (s.phase === 'attempt') return s.attempter;
    return null;
  }

  function hostApply(next: LLState) {
    stateRef.current = next;
    setState(next);
    room.send({ t: 'state', s: next } satisfies NetMsg);
  }

  function hostAct(s: LLState, actor: PlayerId, a: LLAction): LLState | null {
    if (moverOf(s) !== actor) return null;
    try {
      if (a.kind === 'place') return applyPlace(s, a.line);
      if (a.kind === 'declare' && s.phase === 'play') return applyDeclare(s);
      if (a.kind === 'giveup' && s.phase === 'attempt') return applyGiveUp(s);
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
          room.send({ t: 'state', s: stateRef.current } satisfies NetMsg);
        }
        if (msg.t === 'act' && stateRef.current) {
          const next = hostAct(stateRef.current, 1, msg.a);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'state') {
        setState(msg.s);
        setPicks([]);
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

  function exit() {
    room.leave();
    onExit();
  }

  function act(a: LLAction) {
    if (!state) return;
    if (room.isHost) {
      const next = hostAct(state, 0, a);
      if (next) {
        hostApply(next);
        setPicks([]);
      }
    } else {
      room.send({ t: 'act', a } satisfies NetMsg);
    }
  }

  if (!state) {
    return (
      <div className="ll-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const myActs = moverOf(state) === me;
  const set = placedSet(state);
  const railSet = new Set([...set, ...picks]);
  const loopIndex = new Map<number, number>();
  if (state.loop) state.loop.forEach((c, i) => loopIndex.set(c, i));
  const picksValid = picks.length > 0 && isValidLine(set, picks, state.tilesLeft);
  const canPick = (cell: number) =>
    myActs && !set.has(cell) &&
    (picks.includes(cell) || (picks.length < Math.min(3, state.tilesLeft) && isValidLine(set, [...picks, cell], state.tilesLeft)));
  const usedTiles = TILES - state.tilesLeft;

  return (
    <div className="ll-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="ll-status">
        <span className={`ll-turn ${myActs ? 'me' : 'ai'}`}>
          {state.result
            ? '게임 종료'
            : state.phase === 'attempt'
              ? state.attempter === me ? '완성 시도: 나' : '완성 시도: 상대'
              : state.turn === me ? '내 차례' : '상대 차례'}
        </span>
        <span className="ll-tiles">
          철로 타일 <b>{state.tilesLeft}</b>/{TILES}
          <span className="tile-dots">
            {Array.from({ length: TILES }, (_, i) => (
              <i key={i} className={i < usedTiles ? 'used' : ''} />
            ))}
          </span>
        </span>
      </div>

      <div className="ll-board-wrap">
        <div className="ll-board" style={{ gridTemplateColumns: `repeat(${W}, 1fr)` }}>
          {Array.from({ length: W * 9 }, (_, cell) => {
            const isStation = STATIONS.includes(cell as never);
            const isPlaced = set.has(cell);
            const isPick = picks.includes(cell);
            const pickable = canPick(cell);
            const inLoop = loopIndex.has(cell);
            const isLast = state.lastMove?.includes(cell);
            return (
              <button
                key={cell}
                className={[
                  'll-cell',
                  isStation ? 'station' : '',
                  isPlaced && !isStation ? 'placed' : '',
                  isPick ? 'pick' : '',
                  pickable && !isPick ? 'pickable' : '',
                  inLoop ? 'loop' : '',
                  isLast && !inLoop ? 'last' : '',
                ].join(' ')}
                style={inLoop ? { animationDelay: `${(loopIndex.get(cell) ?? 0) * 60}ms` } : undefined}
                disabled={!pickable}
                onClick={() => setPicks((p) => (p.includes(cell) ? p.filter((c) => c !== cell) : [...p, cell]))}
              >
                {isStation ? (
                  <StationTile />
                ) : isPlaced ? (
                  <RailTile dirs={openDirs(cell, railSet)} variant={inLoop ? 'loop' : 'placed'} />
                ) : isPick ? (
                  <RailTile dirs={openDirs(cell, railSet)} variant="preview" />
                ) : null}
              </button>
            );
          })}
          {state.loop && <TrainOnLoop loop={state.loop} cellPct={100 / W} />}
        </div>
      </div>

      <div className="ll-controls">
        {state.result ? (
          <p className="ll-msg end">
            {state.result.reason === 'complete'
              ? state.result.winner === me
                ? '🚂 순환선 완성! 승리!'
                : '상대가 순환선을 완성했습니다…'
              : state.result.winner === me
                ? '불가능 판정 적중! 승리!'
                : '상대의 불가능 선언이 적중했습니다…'}
          </p>
        ) : myActs ? (
          <div className="ll-actions">
            {state.phase === 'attempt' && (
              <p className="ll-msg notice">상대의 불가능 선언! 남은 타일로 완성하면 승리합니다</p>
            )}
            <div className="ll-btn-row">
              <button className="primary-btn" disabled={!picksValid} onClick={() => act({ kind: 'place', line: picks })}>
                배치 확정 ({picks.length})
              </button>
              {picks.length > 0 && (
                <button className="ghost-btn" onClick={() => setPicks([])}>선택 취소</button>
              )}
              {state.phase === 'play' && picks.length === 0 && (
                <button className="danger-btn" onClick={() => act({ kind: 'declare' })}>불가능 선언</button>
              )}
              {state.phase === 'attempt' && (
                <button className="danger-btn" onClick={() => act({ kind: 'giveup' })}>포기</button>
              )}
            </div>
            <p className="ll-hint">
              {state.phase === 'attempt'
                ? `남은 타일 ${state.tilesLeft}개로 순환선을 완성하세요 (1~3개씩 일렬)`
                : '빈 칸을 눌러 타일 1~3개를 일렬로 선택하세요'}
            </p>
          </div>
        ) : (
          <p className="ll-msg">
            {state.phase === 'attempt' ? '상대가 완성을 시도하는 중…' : '상대 차례…'}
          </p>
        )}
      </div>

      {state.result && (
        <div className="ll-endcard-overlay">
          <div className="ll-endcard">
            <h3>{state.result.winner === me ? '승리!' : '패배…'}</h3>
            <p>
              {state.result.reason === 'complete'
                ? state.result.winner === me
                  ? '마지막 타일로 순환선을 완성했습니다'
                  : '상대가 마지막 타일로 순환선을 완성했습니다'
                : state.result.winner === me
                  ? state.attempter === opp
                    ? '불가능 선언이 적중했습니다'
                    : '상대의 불가능 선언을 뒤집고 완성했습니다'
                  : state.attempter === me
                    ? '남은 타일로 완성하지 못했습니다'
                    : '상대가 남은 타일로 완성해냈습니다'}
            </p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={() => { setPicks([]); hostApply(createGame(Math.random() < 0.5 ? 0 : 1)); }}>
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
      <span className="game-title">순환선 · 온라인</span>
    </header>
  );
}
