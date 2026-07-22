import { useEffect, useRef, useState } from 'react';
import type { JState, Move, PieceType, PlayerId } from './engine.ts';
import { COLS, ROWS, applyMove, createGame, idx, legalMoves } from './engine.ts';
import { chooseAiMove } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { RuleBookButton } from '../shared/RuleBook.tsx';
import JungleJanggiOnline from './JungleJanggiOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './jungle.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

const PIECE_CHAR: Record<PieceType, string> = {
  K: '王',
  G: '將',
  E: '相',
  C: '子',
  H: '侯',
};
const PIECE_NAME: Record<PieceType, string> = {
  K: '왕',
  G: '장',
  E: '상',
  C: '자',
  H: '후',
};

type Phase = 'setup' | 'playing' | 'done';
type Selection = { kind: 'cell'; cell: number } | { kind: 'hand'; piece: PieceType } | null;

export default function JungleJanggiGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<JState | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiInfo, setAiInfo] = useState<string | null>(null);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  function startGame() {
    setToss(0); // 값은 의미 없다 — 선공은 동전을 던져 정해진다
  }

  function begin(first: PlayerId) {
    // 선공 랜덤 (원류인 동물장기는 후공 필승이 알려져 있어, 선공 배정은 곧 난이도 요소)
    setState(createGame(first));
    setSelection(null);
    setAiInfo(null);
    recorded.current = false;
    setPhase('playing');
  }

  // AI 턴
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result || state.turn !== AI) return;
    setAiThinking(true);
    const timer = setTimeout(() => {
      setState((s) => {
        if (!s || s.result || s.turn !== AI) return s;
        const r = chooseAiMove(s, 900);
        setAiInfo(`탐색 깊이 ${r.depth} · ${(r.nodes / 1000).toFixed(0)}k 노드`);
        return applyMove(s, r.move);
      });
      setAiThinking(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [phase, state]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state?.result) {
      if (!recorded.current) {
        recorded.current = true;
        if (state.result.winner !== null) {
          recordResult('jungle-janggi', state.result.winner === HUMAN);
        }
      }
      const timer = setTimeout(() => setPhase('done'), 800);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  const myTurn = phase === 'playing' && !!state && !state.result && state.turn === HUMAN && !aiThinking;

  // 선택된 기물의 이동 가능 칸
  const targets = new Set<number>();
  if (state && myTurn && selection) {
    for (const m of legalMoves(state)) {
      if (selection.kind === 'cell' && m.kind === 'move' && m.from === selection.cell) targets.add(m.to);
      if (selection.kind === 'hand' && m.kind === 'drop' && m.piece === selection.piece) targets.add(m.to);
    }
  }

  function onCellClick(cell: number) {
    if (!state || !myTurn) return;
    const piece = state.board[cell];
    if (selection && targets.has(cell)) {
      const move: Move =
        selection.kind === 'cell'
          ? { kind: 'move', from: selection.cell, to: cell }
          : { kind: 'drop', piece: selection.piece, to: cell };
      setState(applyMove(state, move));
      setSelection(null);
      return;
    }
    if (piece && piece.owner === HUMAN) {
      setSelection({ kind: 'cell', cell });
      return;
    }
    setSelection(null);
  }

  function onHandClick(piece: PieceType) {
    if (!myTurn) return;
    setSelection((sel) =>
      sel?.kind === 'hand' && sel.piece === piece ? null : { kind: 'hand', piece },
    );
  }

  if (online !== null && online !== 'panel') {
    return <JungleJanggiOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="jj-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel
          gameName="밀림장기"
          onReady={(room) => setOnline(room)}
          onCancel={() => setOnline(null)}
        />
      </div>
    );
  }

  if (toss !== null) {
    return (
      <CoinToss
        mode="call"
        labels={['나', 'AI']}
        onDone={(winner) => {
          begin(winner === 0 ? HUMAN : AI);
          setToss(null);
        }}
      />
    );
  }

  if (phase === 'setup') {
    const rec = getRecord('jungle-janggi');
    return (
      <div className="jj-root">
        <GameHeader onExit={onExit} />
        <div className="jj-setup">
          <h2>밀림장기</h2>
          <p className="jj-rule-summary">
            3×4 초소형 장기. <b>왕(王)</b>은 8방향, <b>장(將)</b>은 상하좌우, <b>상(相)</b>은 대각,
            <b> 자(子)</b>는 앞으로 한 칸 — 상대 진영에 닿으면 <b>후(侯)</b>로 승격합니다. 잡은
            기물은 포로가 되어 빈 칸에 다시 놓을 수 있습니다(상대 진영 제외). 상대 왕을 잡거나, 내
            왕이 상대 진영에서 한 턴을 버티면 승리!
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">완전정보 게임 — AI는 수십만 수를 앞서 읽습니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>
            AI 대전 시작
          </button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>
            ⚔️ 온라인 대전
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const lastFrom = state.lastMove?.kind === 'move' ? state.lastMove.from : -1;
  const lastTo = state.lastMove?.to ?? -1;

  return (
    <div className="jj-root">
      <GameHeader onExit={onExit} />

      <div className="jj-status">
        <span>
          {state.result
            ? '대국 종료'
            : aiThinking
              ? 'AI가 수를 읽는 중…'
              : state.turn === HUMAN
                ? '당신의 차례'
                : 'AI 차례'}
        </span>
        {aiInfo && <span className="ai-info">{aiInfo}</span>}
      </div>

      {/* AI 포로 */}
      <HandRow
        label="AI 포로"
        pieces={state.hands[AI]}
        owner={AI}
        selected={null}
        onClick={() => {}}
      />

      {/* 보드: 위 = AI 진영(row 3), 아래 = 내 진영(row 0) */}
      <div className="jj-board">
        {Array.from({ length: ROWS }, (_, ri) => {
          const row = ROWS - 1 - ri; // 화면 위가 row 3
          return Array.from({ length: COLS }, (_, col) => {
            const cell = idx(row, col);
            const piece = state.board[cell];
            const isSel = selection?.kind === 'cell' && selection.cell === cell;
            const isTarget = targets.has(cell);
            const isLast = cell === lastFrom || cell === lastTo;
            return (
              <button
                key={cell}
                className={`jj-cell ${row === 0 ? 'home-me' : ''} ${row === ROWS - 1 ? 'home-ai' : ''} ${isSel ? 'selected' : ''} ${isTarget ? 'target' : ''} ${isLast ? 'last-move' : ''}`}
                onClick={() => onCellClick(cell)}
              >
                {piece && (
                  <span className={`jj-piece p${piece.owner} ${piece.type === 'K' ? 'king' : ''}`}>
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
        pieces={state.hands[HUMAN]}
        owner={HUMAN}
        selected={selection?.kind === 'hand' ? selection.piece : null}
        onClick={onHandClick}
      />

      {phase === 'done' && state.result && (
        <div className="jj-overlay">
          <div className="jj-endcard">
            <h2>
              {state.result.winner === null
                ? '무승부'
                : state.result.winner === HUMAN
                  ? '🏆 승리!'
                  : '패배…'}
            </h2>
            <p>
              {state.result.reason === 'capture' && '왕이 잡혔습니다'}
              {state.result.reason === 'territory' && '왕이 상대 진영에서 살아남았습니다'}
              {state.result.reason === 'repetition' && '동일 국면 3회 반복'}
            </p>
            <div className="end-actions">
              <button className="primary-btn" onClick={startGame}>
                다시 대전
              </button>
              <button className="ghost-btn" onClick={onExit}>
                로비로
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HandRow({
  label,
  pieces,
  owner,
  selected,
  onClick,
}: {
  label: string;
  pieces: PieceType[];
  owner: PlayerId;
  selected: PieceType | null;
  onClick: (p: PieceType) => void;
}) {
  return (
    <div className="jj-hand">
      <span className="label">{label}</span>
      <div className="hand-pieces">
        {pieces.length === 0 && <span className="empty">없음</span>}
        {pieces.map((p, i) => (
          <button
            key={i}
            className={`jj-piece hand p${owner} ${selected === p ? 'selected' : ''}`}
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
      <button className="back-btn" onClick={onExit}>
        ← 로비
      </button>
      <span className="game-title">밀림장기</span>
      <RuleBookButton gameId="jungle-janggi" gameName="밀림장기" className="rb-btn header-rb" />
    </header>
  );
}
