import { useEffect, useRef, useState } from 'react';
import type { NPiece, NState, PlayerId } from './engine.ts';
import {
  N_COLS,
  applyMove,
  createGame,
  legalMoves,
  pieceMoves,
  randomPlacement,
  resolveRevive,
  reviveCells,
  reviveOptions,
  territoryRows,
} from './engine.ts';
import { viewFor } from './view.ts';
import { Board, DeadTray, typeLabel } from './board.tsx';
import type { NetRoom } from '../../net/room.ts';
import './numberjanggi.css';
import '../../net/online.css';

/**
 * 수의 진 온라인 대전 — 호스트 권위 방식.
 *
 * 배치 단계가 있어 흐름이 두 층이다: 양쪽이 각자 진영에 기물을 배치해 호스트에게
 * 보내고, 둘 다 준비되면 호스트가 대국을 시작한다. 이후에는 상대 기물의 정체를
 * 가린 관점 뷰(view.ts)만 게스트에게 전달한다.
 */

type Placement = Array<{ cell: number; piece: NPiece }>;

type NAction = { k: 'move'; from: number; to: number } | { k: 'revive'; pieceId: number | null };

type NetMsg =
  | { t: 'ready' }
  | { t: 'placed'; p: Placement }
  | { t: 'view'; v: NState }
  | { t: 'act'; a: NAction };

export default function NumberJanggiOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;

  const [myPlacement, setMyPlacement] = useState<Placement>(() =>
    randomPlacement(me, me === 0 ? 0 : 100),
  );
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [state, setState] = useState<NState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [oppLeft, setOppLeft] = useState(false);

  const stateRef = useRef<NState | null>(null);
  /** 호스트가 모아두는 양쪽 배치 */
  const placements = useRef<{ host: Placement | null; guest: Placement | null }>({
    host: null,
    guest: null,
  });

  function hostApply(next: NState) {
    stateRef.current = next;
    setState(viewFor(next, 0));
    room.send({ t: 'view', v: viewFor(next, 1) } satisfies NetMsg);
  }

  /** 양쪽 배치가 모이면 대국 시작 */
  function hostTryStart() {
    const { host, guest } = placements.current;
    if (!host || !guest || stateRef.current) return;
    hostApply(createGame(host, guest, Math.random() < 0.5 ? 0 : 1));
  }

  function hostAct(s: NState, actor: PlayerId, a: NAction): NState | null {
    try {
      if (a.k === 'move') {
        if (s.result || s.pendingRevive !== null || s.turn !== actor) return null;
        const ok = legalMoves(s).some((m) => m.from === a.from && m.to === a.to);
        if (!ok) return null;
        return applyMove(s, { from: a.from, to: a.to });
      }
      if (s.pendingRevive !== actor) return null;
      if (a.pieceId === null) return resolveRevive(s, null, null);
      const cells = reviveCells(s, actor);
      if (cells.length === 0) return resolveRevive(s, null, null);
      cells.sort((x, y) => Math.abs((x % N_COLS) - 2.5) - Math.abs((y % N_COLS) - 2.5));
      return resolveRevive(s, a.pieceId, cells[0]);
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
        if (msg.t === 'placed') {
          placements.current.guest = msg.p;
          hostTryStart();
        }
        if (msg.t === 'act' && stateRef.current) {
          const next = hostAct(stateRef.current, 1, msg.a);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'view') {
        setState(msg.v);
        setSelected(null);
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

  function submitPlacement() {
    setSubmitted(true);
    if (room.isHost) {
      placements.current.host = myPlacement;
      hostTryStart();
    } else {
      room.send({ t: 'placed', p: myPlacement } satisfies NetMsg);
    }
  }

  function act(a: NAction) {
    if (room.isHost) {
      const s = stateRef.current;
      if (!s) return;
      const next = hostAct(s, 0, a);
      if (next) hostApply(next);
    } else {
      room.send({ t: 'act', a } satisfies NetMsg);
    }
    setSelected(null);
  }

  // ---------- 배치 단계 ----------
  if (!state) {
    const rows = territoryRows(me);
    const placementBoard: (NPiece | null)[] = new Array(54).fill(null);
    for (const { cell, piece } of myPlacement) placementBoard[cell] = piece;

    return (
      <div className="nj-root">
        <GameHeader onExit={exit} />
        <div className="online-status">
          <span className={`dot ${oppLeft ? 'off' : ''}`} />
          방 {room.code} · {room.isHost ? '호스트' : '게스트'}
        </div>
        <div className="nj-status">
          <span>
            {submitted
              ? '상대의 배치를 기다리는 중…'
              : '기물 두 개를 눌러 자리를 바꿀 수 있습니다'}
          </span>
        </div>
        <Board
          board={placementBoard}
          me={me}
          onCellClick={(cell) => {
            if (submitted) return;
            if (!rows.includes(Math.floor(cell / N_COLS))) return;
            if (swapFrom === null) {
              setSwapFrom(cell);
              return;
            }
            if (swapFrom !== cell) {
              setMyPlacement((pl) =>
                pl.map((e) =>
                  e.cell === swapFrom ? { ...e, cell } : e.cell === cell ? { ...e, cell: swapFrom } : e,
                ),
              );
            }
            setSwapFrom(null);
          }}
          highlight={swapFrom !== null ? new Set([swapFrom]) : new Set()}
          targets={new Set()}
          lastMove={null}
          placementMode
        />
        <div className="nj-actions">
          {!submitted && (
            <>
              <button
                className="ghost-btn"
                onClick={() => {
                  setMyPlacement(randomPlacement(me, me === 0 ? 0 : 100));
                  setSwapFrom(null);
                }}
              >
                🎲 다시 섞기
              </button>
              <button className="primary-btn" onClick={submitPlacement}>
                이 배치로 대전 시작
              </button>
            </>
          )}
          {submitted && (
            <p className="online-wait">
              <span className="online-spinner" /> 상대가 배치를 마치면 시작합니다
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
  const myTurn = !state.result && state.pendingRevive === null && state.turn === me;
  const targets = new Set<number>(
    selected !== null && myTurn ? pieceMoves(state, selected) : [],
  );
  const lastBattle = state.lastBattles.length > 0 ? state.lastBattles : null;
  const myRevive = state.pendingRevive === me;

  return (
    <div className="nj-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="nj-status">
        <span>
          {state.result
            ? '대국 종료'
            : myRevive
              ? '부활할 기물을 선택하세요'
              : state.pendingRevive === opp
                ? '상대가 부활 기물을 고르는 중…'
                : myTurn
                  ? '당신의 차례'
                  : '상대 차례'}
        </span>
        <span className="nj-dead">
          상대 잃음 {state.dead[opp].length} · 나 잃음 {state.dead[me].length}
        </span>
      </div>

      <DeadTray label="상대가 잃은 기물" pieces={state.dead[opp]} mine={false} />

      <Board
        board={state.board}
        me={me}
        onCellClick={(cell) => {
          if (!myTurn) return;
          if (selected !== null && targets.has(cell)) {
            act({ k: 'move', from: selected, to: cell });
            return;
          }
          const piece = state.board[cell];
          setSelected(piece && piece.owner === me ? cell : null);
        }}
        highlight={selected !== null ? new Set([selected]) : new Set()}
        targets={targets}
        lastMove={state.lastMove}
        placementMode={false}
      />

      <DeadTray label="내가 잃은 기물" pieces={state.dead[me]} mine />

      {lastBattle && (
        <div className="nj-battles">
          {lastBattle.map((b, i) => (
            <div key={i} className="battle-line">
              ⚔️ {typeLabel(b.a.type)} vs {typeLabel(b.b.type)}
              {b.minus && <span className="minus-mark"> (차 대결)</span>}
              {' → '}
              {b.removedIds.length === 2
                ? '동시 제거'
                : b.removedIds.includes(b.a.id)
                  ? `${typeLabel(b.a.type)} 제거`
                  : `${typeLabel(b.b.type)} 제거`}
            </div>
          ))}
        </div>
      )}

      {myRevive && (
        <div className="nj-revive">
          <span className="label">부활시킬 기물을 고르세요</span>
          <div className="revive-options">
            {reviveOptions(state).map((p) => (
              <button
                key={p.id}
                className="nj-piece mine face revive-btn"
                onClick={() => act({ k: 'revive', pieceId: p.id })}
              >
                {typeLabel(p.type)}
              </button>
            ))}
            <button className="ghost-btn" onClick={() => act({ k: 'revive', pieceId: null })}>
              포기
            </button>
          </div>
        </div>
      )}

      {state.result && (
        <div className="nj-overlay">
          <div className="nj-endcard">
            <h2>
              {state.result.winner === null
                ? '무승부'
                : state.result.winner === me
                  ? '🏆 승리!'
                  : '패배…'}
            </h2>
            <p>
              {state.result.reason === 'king' && '왕이 잡혔습니다'}
              {state.result.reason === 'annihilation' && '기물이 전멸했습니다'}
              {state.result.reason === 'throne' && '왕이 상대 진영 끝줄에 도달했습니다'}
              {state.result.reason === 'stalemate' && '움직일 수 없어 무승부'}
            </p>
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
      <span className="game-title">수(數)의 진 · 온라인</span>
    </header>
  );
}
