import { useEffect, useRef, useState } from 'react';
import type { JState, Move, PieceType, PlayerId } from './engine.ts';
import { COLS, ROWS, applyMove, createGame, idx, legalMoves } from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import './jungle.css';
import '../../net/online.css';

/**
 * 밀림장기 온라인 대전 — 완전 공개 정보 게임이라 호스트가 전체 상태를 복제 전송한다.
 * 액션 검증은 호스트 엔진에서 수행(호스트 권위).
 * 보드는 좌석별로 뒤집어 렌더링해 양쪽 모두 자기 진영이 아래에 오게 한다.
 */

type NetMsg =
  /** 선공 동전 결과 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' } | { t: 'state'; s: JState } | { t: 'act'; m: Move };

const PIECE_CHAR: Record<PieceType, string> = { K: '王', G: '將', E: '相', C: '子', H: '侯' };
const PIECE_NAME: Record<PieceType, string> = { K: '왕', G: '장', E: '상', C: '자', H: '후' };

type Selection = { kind: 'cell'; cell: number } | { kind: 'hand'; piece: PieceType } | null;

export default function JungleJanggiOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<JState | null>(null);
  const [state, setState] = useState<JState | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [oppLeft, setOppLeft] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);

  function hostApply(next: JState) {
    stateRef.current = next;
    setState(next);
    room.send({ t: 'state', s: next } satisfies NetMsg);
  }

  function hostAct(s: JState, actor: PlayerId, m: Move): JState | null {
    if (s.result || s.turn !== actor) return null;
    // 합법수 검증 후 적용
    const legal = legalMoves(s).some((x) =>
      x.kind === m.kind &&
      x.to === m.to &&
      (x.kind === 'move' && m.kind === 'move' ? x.from === m.from : true) &&
      (x.kind === 'drop' && m.kind === 'drop' ? x.piece === m.piece : true),
    );
    if (!legal) return null;
    try {
      return applyMove(s, m);
    } catch {
      return null;
    }
  }

  /** (호스트) 선공을 뽑아 양쪽에 동전을 띄운다 */
  function tossFirst(): PlayerId {
    const first: PlayerId = Math.random() < 0.5 ? 0 : 1;
    lastToss.current = first;
    room.send({ t: 'toss', first } satisfies NetMsg);
    setToss(first);
    return first;
  }

  useEffect(() => {
    const offMsg = room.onMsg((raw) => {
      const msg = raw as NetMsg;
      if (msg.t === 'toss') {
        setToss(msg.first);
        return;
      }
      // 호스트가 게스트 입장 전에 보낸 동전은 버려지므로 다시 알린다
      if (room.isHost && msg.t === 'ready' && lastToss.current !== null) {
        room.send({ t: 'toss', first: lastToss.current } satisfies NetMsg);
      }
      if (room.isHost) {
        if (msg.t === 'ready' && stateRef.current) {
          room.send({ t: 'state', s: stateRef.current } satisfies NetMsg);
        }
        if (msg.t === 'act' && stateRef.current) {
          const next = hostAct(stateRef.current, 1, msg.m);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'state') {
        setState(msg.s);
        setSelection(null);
      }
    });
    const offPeers = room.onPeers((count) => {
      if (count === 0) setOppLeft(true);
    });
    if (room.isHost) {
      hostApply(createGame(tossFirst()));
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

  function act(m: Move) {
    if (!state) return;
    if (room.isHost) {
      const next = hostAct(state, 0, m);
      if (next) {
        hostApply(next);
        setSelection(null);
      }
    } else {
      room.send({ t: 'act', m } satisfies NetMsg);
      setSelection(null);
    }
  }

  if (toss !== null) {
    return (
      <CoinToss
        first={toss === me ? 0 : 1}
        labels={['나', '상대']}
        onDone={() => setToss(null)}
      />
    );
  }

  if (!state) {
    return (
      <div className="jj-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const myTurn = !state.result && state.turn === me;

  const targets = new Set<number>();
  if (myTurn && selection) {
    for (const m of legalMoves(state)) {
      if (selection.kind === 'cell' && m.kind === 'move' && m.from === selection.cell) targets.add(m.to);
      if (selection.kind === 'hand' && m.kind === 'drop' && m.piece === selection.piece) targets.add(m.to);
    }
  }

  function onCellClick(cell: number) {
    if (!state || !myTurn) return;
    const piece = state.board[cell];
    if (selection && targets.has(cell)) {
      act(
        selection.kind === 'cell'
          ? { kind: 'move', from: selection.cell, to: cell }
          : { kind: 'drop', piece: selection.piece, to: cell },
      );
      return;
    }
    if (piece && piece.owner === me) {
      setSelection({ kind: 'cell', cell });
      return;
    }
    setSelection(null);
  }

  const lastFrom = state.lastMove?.kind === 'move' ? state.lastMove.from : -1;
  const lastTo = state.lastMove?.to ?? -1;

  return (
    <div className="jj-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="jj-status">
        <span>
          {state.result ? '대국 종료' : myTurn ? '당신의 차례' : '상대 차례'}
        </span>
      </div>

      {/* 상대 포로 */}
      <HandRow label="상대 포로" pieces={state.hands[opp]} selected={null} onClick={() => {}} />

      {/* 보드: 내 진영이 항상 아래로 오도록 좌석별로 뒤집는다 */}
      <div className="jj-board">
        {Array.from({ length: ROWS }, (_, ri) => {
          // seat 0은 row 0이 자기 진영(아래) → 위에서부터 row 3,2,1,0
          // seat 1은 row 3이 자기 진영(아래) → 위에서부터 row 0,1,2,3
          const row = me === 0 ? ROWS - 1 - ri : ri;
          return Array.from({ length: COLS }, (_, ci) => {
            const col = me === 0 ? ci : COLS - 1 - ci;
            const cell = idx(row, col);
            const piece = state.board[cell];
            const isSel = selection?.kind === 'cell' && selection.cell === cell;
            const isTarget = targets.has(cell);
            const isLast = cell === lastFrom || cell === lastTo;
            const isMyHome = row === (me === 0 ? 0 : ROWS - 1);
            const isOppHome = row === (me === 0 ? ROWS - 1 : 0);
            return (
              <button
                key={cell}
                className={`jj-cell ${isMyHome ? 'home-me' : ''} ${isOppHome ? 'home-ai' : ''} ${isSel ? 'selected' : ''} ${isTarget ? 'target' : ''} ${isLast ? 'last-move' : ''}`}
                onClick={() => onCellClick(cell)}
              >
                {piece && (
                  <span className={`jj-piece p${piece.owner === me ? 0 : 1} ${piece.type === 'K' ? 'king' : ''}`}>
                    {PIECE_CHAR[piece.type]}
                  </span>
                )}
              </button>
            );
          });
        })}
      </div>

      {/* 내 포로 */}
      <HandRow
        label="내 포로 (클릭해서 배치)"
        pieces={state.hands[me]}
        selected={selection?.kind === 'hand' ? selection.piece : null}
        onClick={(p) => {
          if (!myTurn) return;
          setSelection((sel) => (sel?.kind === 'hand' && sel.piece === p ? null : { kind: 'hand', piece: p }));
        }}
        mine
      />

      {state.result && (
        <div className="jj-overlay">
          <div className="jj-endcard">
            <h2>
              {state.result.winner === null ? '무승부' : state.result.winner === me ? '🏆 승리!' : '패배…'}
            </h2>
            <p>
              {state.result.reason === 'capture' && '왕이 잡혔습니다'}
              {state.result.reason === 'territory' && '왕이 상대 진영에서 살아남았습니다'}
              {state.result.reason === 'repetition' && '동일 국면 3회 반복'}
            </p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={() => { setSelection(null); hostApply(createGame(tossFirst())); }}>
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

function HandRow({
  label,
  pieces,
  selected,
  onClick,
  mine,
}: {
  label: string;
  pieces: PieceType[];
  selected: PieceType | null;
  onClick: (p: PieceType) => void;
  mine?: boolean;
}) {
  return (
    <div className="jj-hand">
      <span className="label">{label}</span>
      <div className="hand-pieces">
        {pieces.length === 0 && <span className="empty">없음</span>}
        {pieces.map((p, i) => (
          <button
            key={i}
            className={`jj-piece hand p${mine ? 0 : 1} ${selected === p ? 'selected' : ''}`}
            onClick={() => onClick(p)}
            title={PIECE_NAME[p]}
          >
            {PIECE_CHAR[p]}
          </button>
        ))}
      </div>
    </div>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">밀림장기 · 온라인</span>
    </header>
  );
}
