import { useEffect, useRef, useState } from 'react';
import type { BState, PlayerId } from './engine.ts';
import {
  DEAD,
  GOAL,
  HOME,
  TRACK_LEN,
  VALUE_NAME,
  createGame,
  declarablePieces,
  declare,
  respond,
} from './engine.ts';
import {
  chooseAiDeclaration,
  chooseAiResponse,
  recordGameEnd,
  recordHumanResponse,
  recordHumanReveal,
} from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import './bluff.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

export default function YutBluffGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<BState | null>(null);
  const [pickedPiece, setPickedPiece] = useState<number | null>(null);
  const [aiActing, setAiActing] = useState(false);
  const recorded = useRef(false);

  function startGame() {
    setState(createGame(Math.random() < 0.5 ? HUMAN : AI));
    setPickedPiece(null);
    recorded.current = false;
    setPhase('playing');
  }

  // AI 자동 진행 (선언 또는 응답)
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result) return;
    const aiDeclares = state.phase === 'declare' && state.turn === AI;
    const aiResponds = state.phase === 'respond' && state.turn === HUMAN;
    if (!aiDeclares && !aiResponds) return;
    setAiActing(true);
    const timer = setTimeout(() => {
      setState((s) => {
        if (!s || s.result) return s;
        if (s.phase === 'declare' && s.turn === AI) {
          const d = chooseAiDeclaration(s, AI);
          return declare(s, d.value, d.fromPos);
        }
        if (s.phase === 'respond' && s.turn === HUMAN) {
          // AI가 사람 선언에 응답 — 의심으로 공개되면 학습
          const challenge = chooseAiResponse(s, AI);
          if (challenge) recordHumanReveal(s.declaration!.value, s.roll);
          return respond(s, challenge);
        }
        return s;
      });
      setAiActing(false);
    }, 1000 + Math.random() * 500);
    return () => clearTimeout(timer);
  }, [phase, state]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state?.result) {
      if (!recorded.current) {
        recorded.current = true;
        recordGameEnd();
        if (state.result.winner !== null) {
          recordResult('yut-bluff', state.result.winner === HUMAN);
        }
      }
      const timer = setTimeout(() => setPhase('done'), 1000);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  function onDeclare(value: number) {
    if (!state || state.phase !== 'declare' || state.turn !== HUMAN || pickedPiece === null) return;
    setState(declare(state, value, pickedPiece));
    setPickedPiece(null);
  }

  function onRespond(challenge: boolean) {
    if (!state || state.phase !== 'respond' || state.turn !== AI) return;
    recordHumanResponse(state.declaration!.value, challenge);
    setState(respond(state, challenge));
  }

  if (phase === 'setup') {
    const rec = getRecord('yut-bluff');
    return (
      <div className="yb-root">
        <GameHeader onExit={onExit} />
        <div className="yb-setup">
          <h2>윷과 거짓말</h2>
          <p className="yb-rule-summary">
            10면체 주사위(도·개·걸 각 2면, 윷·모 각 1면, <b>꽝 2면</b>)를 굴려{' '}
            <b>결과는 나만 확인</b>하고 선언합니다 — 꽝은 선언할 수 없으니 거짓말을 해야 하고,
            좋은 결과도 부풀릴 수 있습니다. 상대는 <b>믿거나 의심</b>합니다. 들키면 그 말이
            제거되고, 억울한 의심이면 의심한 쪽이 말을 잃습니다. 말 4개 중 <b>2개를 먼저
            다리 건너편으로</b> 보내면 승리!
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 들킨 거짓말의 빈도·크기와 당신의 의심 패턴을 학습합니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>대전 시작</button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const humanDeclaring = state.phase === 'declare' && state.turn === HUMAN && !state.result;
  const humanResponding = state.phase === 'respond' && state.turn === AI && !state.result;
  const pieces = humanDeclaring ? declarablePieces(state) : [];
  const last = state.history[state.history.length - 1];

  return (
    <div className="yb-root">
      <GameHeader onExit={onExit} />

      <div className="yb-status">
        <span>
          {state.result
            ? state.result.winner === null
              ? '무승부'
              : state.result.winner === HUMAN
                ? '승리!'
                : 'AI 승리'
            : humanDeclaring
              ? '내 차례 — 주사위를 확인하고 선언하세요'
              : humanResponding
                ? 'AI의 선언 — 믿을까요, 의심할까요?'
                : aiActing
                  ? 'AI가 고민 중…'
                  : ''}
        </span>
        {last && (
          <span className="yb-last">
            지난 라운드: {last.roller === HUMAN ? '나' : 'AI'}가 「{VALUE_NAME[last.declared]}」 선언 →{' '}
            {last.outcome === 'moved' && '믿음 · 전진'}
            {last.outcome === 'liar-caught' && `의심 적중! 실제는 「${VALUE_NAME[last.roll]}」 — 말 제거`}
            {last.outcome === 'wrong-challenge' && `의심 실패 (진실 「${VALUE_NAME[last.roll]}」) — 의심자 말 손실`}
          </span>
        )}
      </div>

      <BridgeRow state={state} p={AI} label="AI" />
      <BridgeRow
        state={state}
        p={HUMAN}
        label="나"
        selectable={humanDeclaring ? pieces : []}
        picked={pickedPiece}
        onPick={setPickedPiece}
      />

      <div className="yb-panel">
        {humanDeclaring && (
          <>
            <div className="yb-secret">
              <span className="yb-secret-label">내 주사위 (비밀)</span>
              <span className={`yb-die ${state.roll === 0 ? 'blank' : ''}`}>
                {VALUE_NAME[state.roll]}
              </span>
              {state.roll === 0 && <span className="yb-must-lie">꽝! 거짓 선언을 해야 합니다</span>}
            </div>
            <span className="yb-note">
              {pickedPiece === null
                ? '움직일 말을 먼저 선택하세요 (대기 말 또는 다리 위 말)'
                : '선언할 값을 고르세요 — 실제와 달라도 됩니다'}
            </span>
            <div className="yb-btns">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  className={`yb-declare ${v === state.roll ? 'truth' : ''}`}
                  disabled={pickedPiece === null}
                  onClick={() => onDeclare(v)}
                >
                  {VALUE_NAME[v]} <small>{v}칸</small>
                </button>
              ))}
            </div>
          </>
        )}
        {humanResponding && state.declaration && (
          <>
            <span className="yb-note">
              AI: 「<b>{VALUE_NAME[state.declaration.value]}</b>」 선언 —{' '}
              {state.declaration.fromPos === HOME
                ? '새 말 진입'
                : `${state.declaration.fromPos}칸 말 전진`}{' '}
              ({state.declaration.value}칸)
            </span>
            <div className="yb-btns">
              <button className="yb-respond accept" onClick={() => onRespond(false)}>
                믿는다
              </button>
              <button className="yb-respond challenge" onClick={() => onRespond(true)}>
                의심한다!
              </button>
            </div>
          </>
        )}
        {!humanDeclaring && !humanResponding && !state.result && (
          <span className="yb-note dim">{aiActing ? 'AI가 고민 중…' : ' '}</span>
        )}
      </div>

      {phase === 'done' && state.result && (
        <div className="yb-overlay">
          <div className="yb-endcard">
            <h2>
              {state.result.winner === null
                ? '무승부'
                : state.result.winner === HUMAN
                  ? '🏆 승리!'
                  : '패배…'}
            </h2>
            <p>
              {state.result.winner === HUMAN
                ? '두 말이 무사히 다리를 건넜습니다'
                : state.result.winner === AI
                  ? 'AI의 두 말이 먼저 다리를 건넜습니다'
                  : '승부를 가리지 못했습니다'}
            </p>
            <div className="end-actions">
              <button className="primary-btn" onClick={startGame}>다시 대전</button>
              <button className="ghost-btn" onClick={onExit}>로비로</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BridgeRow({
  state,
  p,
  label,
  selectable = [],
  picked = null,
  onPick,
}: {
  state: BState;
  p: PlayerId;
  label: string;
  selectable?: number[];
  picked?: number | null;
  onPick?: (pos: number) => void;
}) {
  const home = state.pieces[p].filter((x) => x === HOME).length;
  const dead = state.pieces[p].filter((x) => x === DEAD).length;
  const crossed = state.pieces[p].filter((x) => x === GOAL).length;
  const declFrom = state.phase === 'respond' && state.turn === p ? state.declaration?.fromPos : null;

  return (
    <div className={`yb-bridge pl${p}`}>
      <div className="yb-bridge-head">
        <span className="yb-label">{label}</span>
        <button
          className={`yb-home ${selectable.includes(HOME) ? 'selectable' : ''} ${picked === HOME ? 'picked' : ''}`}
          disabled={!selectable.includes(HOME)}
          onClick={() => onPick?.(HOME)}
        >
          대기 {home}
        </button>
        <span className="yb-counts">
          완주 <b>{crossed}</b>/2{dead > 0 && <em> · 제거 {dead}</em>}
        </span>
      </div>
      <div className="yb-track">
        {Array.from({ length: TRACK_LEN }, (_, i) => {
          const cell = i + 1;
          const count = state.pieces[p].filter((x) => x === cell).length;
          const sel = selectable.includes(cell);
          return (
            <button
              key={cell}
              className={`yb-cell ${sel ? 'selectable' : ''} ${picked === cell ? 'picked' : ''} ${
                declFrom === cell ? 'declared' : ''
              }`}
              disabled={!sel}
              onClick={() => onPick?.(cell)}
            >
              {count > 0 && (
                <span className="yb-token">{count > 1 ? count : ''}</span>
              )}
            </button>
          );
        })}
        <div className="yb-goal">🏁</div>
      </div>
    </div>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">윷과 거짓말</span>
    </header>
  );
}
