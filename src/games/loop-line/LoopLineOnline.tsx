import { useEffect, useRef, useState } from 'react';
import type { LLState, PlayerId } from './engine.ts';
import type { Tile } from './engine.ts';
import {
  TILES,
  applyDeclare,
  applyGiveUp,
  applyPlace,
  createGame,
  emptyBoard,
  isValidCells,
  isValidFreeform,
  isValidPlacement,
} from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
import { RailBoard, TileTray, usePlacer, workBoard } from './placer.tsx';
import './loopline.css';
import '../../net/online.css';

/**
 * 순환선 온라인 대전 — 완전 공개 정보 게임이라 호스트가 전체 상태를 복제 전송한다.
 * 액션 검증은 호스트 엔진에서 수행(호스트 권위).
 */

type LLAction = { kind: 'place'; tiles: Tile[] } | { kind: 'declare' } | { kind: 'giveup' };
type NetMsg = { t: 'ready' } | { t: 'state'; s: LLState } | { t: 'act'; a: LLAction };


export default function LoopLineOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<LLState | null>(null);
  const [state, setState] = useState<LLState | null>(null);
  const [oppLeft, setOppLeft] = useState(false);

  const myTurn =
    !!state && !state.result &&
    ((state.phase === 'play' && state.turn === me) ||
      (state.phase === 'attempt' && state.attempter === me));
  const attemptMode = state?.phase === 'attempt';
  const placer = usePlacer(state?.board ?? emptyBoard(), state?.tilesLeft ?? 0, myTurn, attemptMode);

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
      if (a.kind === 'place') return applyPlace(s, a.tiles);
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
        placer.clear();
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
        placer.clear();
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
  const picksValid =
    placer.pending.length > 0 &&
    isValidPlacement(state.board, placer.pending, state.tilesLeft, attemptMode);
  const canPlace = (cell: number) =>
    myActs &&
    (attemptMode
      ? isValidFreeform(state.board, [...placer.pending.map((t) => t.cell), cell], state.tilesLeft)
      : isValidCells(state.board, [...placer.pending.map((t) => t.cell), cell], state.tilesLeft)) &&
    workBoard(state.board, placer.pending)[cell] === 0;
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

      <RailBoard
        board={state.board}
        pending={placer.pending}
        loop={state.loop}
        lastMove={state.lastMove}
        canPlace={canPlace}
        onCell={placer.clickCell}
      />

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
            {placer.notice && <p className="ll-msg notice">{placer.notice}</p>}
            <TileTray
              held={placer.held}
              heldKind={placer.heldKind}
              onPick={placer.pickKind}
              onRotate={placer.rotate}
            />
            <div className="ll-btn-row">
              <button
                className="primary-btn"
                disabled={!picksValid}
                onClick={() => act({ kind: 'place', tiles: placer.pending })}
              >
                배치 확정 ({placer.pending.length})
              </button>
              {placer.pending.length > 0 && (
                <button className="ghost-btn" onClick={placer.clear}>선택 취소</button>
              )}
              {state.phase === 'play' && placer.pending.length === 0 && (
                <button className="danger-btn" onClick={() => act({ kind: 'declare' })}>불가능 선언</button>
              )}
              {state.phase === 'attempt' && (
                <button className="danger-btn" onClick={() => act({ kind: 'giveup' })}>포기</button>
              )}
            </div>
            <p className="ll-hint">
              {attemptMode ? (
                <>
                  혼자 완성하는 국면이라 <b>일렬·3개 제한이 없습니다</b> — 남은 타일{' '}
                  {state.tilesLeft}개로 이어지게만 놓으면 됩니다. 타일을 고르고{' '}
                  <b>회전</b>으로 방향을 맞추세요.
                </>
              ) : (
                <>
                  타일을 고르고 <b>회전</b>으로 방향을 정한 뒤 빈 칸에 놓으세요 (한 턴에
                  1~3개, 2개 이상이면 일렬). 놓아둔 타일을 다시 누르면 그 자리에서
                  돌아갑니다.
                </>
              )}
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
                <button className="primary-btn" onClick={() => { placer.clear(); hostApply(createGame(Math.random() < 0.5 ? 0 : 1)); }}>
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
