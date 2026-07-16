import { useEffect, useRef, useState } from 'react';
import type { BState, PlayerId } from './engine.ts';
import {
  DEAD,
  GOAL,
  HOME,
  VALUE_NAME,
  branchOptions,
  createGame,
  declare,
  kkangTargets,
  movableFroms,
  respond,
  walkBluff,
} from './engine.ts';
import {
  chooseAiDeclaration,
  chooseAiResponse,
  recordGameEnd,
  recordHumanResponse,
  recordHumanReveal,
} from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import YutBoard from '../shared/YutBoard.tsx';
import type { BoardPiece } from '../shared/YutBoard.tsx';
import './bluff.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

export default function YutBluffGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<BState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [pendingValue, setPendingValue] = useState<number | null>(null);
  const [rollAnim, setRollAnim] = useState<'mine' | 'ai' | null>(null);
  const [aiActing, setAiActing] = useState(false);
  const recorded = useRef(false);
  const animShownForRound = useRef(-1);

  function startGame() {
    setState(createGame(Math.random() < 0.5 ? HUMAN : AI));
    setSelected(null);
    setPendingValue(null);
    recorded.current = false;
    animShownForRound.current = -1;
    setPhase('playing');
  }

  // 굴림 연출: declare 단계 진입 시 1회
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result) return;
    if (state.phase === 'declare' && animShownForRound.current !== state.round) {
      animShownForRound.current = state.round;
      setRollAnim(state.turn === HUMAN ? 'mine' : 'ai');
      const timer = setTimeout(() => setRollAnim(null), state.turn === HUMAN ? 2000 : 1500);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  // AI 자동 진행 (선언 또는 응답)
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result || rollAnim) return;
    const aiDeclares = state.phase === 'declare' && state.turn === AI;
    const aiResponds = state.phase === 'respond' && state.turn === HUMAN;
    if (!aiDeclares && !aiResponds) return;
    setAiActing(true);
    const timer = setTimeout(() => {
      setState((s) => {
        if (!s || s.result) return s;
        if (s.phase === 'declare' && s.turn === AI) {
          return declare(s, chooseAiDeclaration(s, AI));
        }
        if (s.phase === 'respond' && s.turn === HUMAN) {
          const challenge = chooseAiResponse(s, AI);
          if (challenge) recordHumanReveal(s.declaration!.value, s.roll);
          return respond(s, challenge);
        }
        return s;
      });
      setAiActing(false);
    }, 1100 + Math.random() * 500);
    return () => clearTimeout(timer);
  }, [phase, state, rollAnim]);

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
      const timer = setTimeout(() => setPhase('done'), 1100);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  const humanDeclaring =
    !!state && state.phase === 'declare' && state.turn === HUMAN && !state.result && !rollAnim;
  const humanResponding =
    !!state && state.phase === 'respond' && state.turn === AI && !state.result && !rollAnim;

  const froms = humanDeclaring ? movableFroms(state, HUMAN) : [];
  const kkang = humanDeclaring ? kkangTargets(state, HUMAN) : [];

  function onSelect(pos: number) {
    if (!humanDeclaring) return;
    if (!froms.includes(pos)) {
      setSelected(null);
      setPendingValue(null);
      return;
    }
    setSelected(pos === selected ? null : pos);
    setPendingValue(null);
  }

  function onValue(v: number) {
    if (!state || selected === null) return;
    if (v === 0) {
      setState(declare(state, { value: 0, from: selected, branch: 0 }));
      setSelected(null);
      setPendingValue(null);
      return;
    }
    const branches = branchOptions(selected);
    if (branches.length === 1) {
      setState(declare(state, { value: v, from: selected, branch: 0 }));
      setSelected(null);
      setPendingValue(null);
    } else {
      setPendingValue(v); // 분기 선택 대기
    }
  }

  function onBranch(branch: 0 | 1) {
    if (!state || selected === null || pendingValue === null) return;
    setState(declare(state, { value: pendingValue, from: selected, branch }));
    setSelected(null);
    setPendingValue(null);
  }

  function onRespond(challenge: boolean) {
    if (!state || !humanResponding) return;
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
            윷판 위의 진짜 윷놀이 — 단, 윷가락 대신 <b>10면체 주사위</b>(도·개·걸 2면, 윷·모
            1면, <b>꽝 2면</b>)를 굴리고 <b>결과는 굴린 사람만 확인</b>합니다. 꽝이면 말
            하나를 잃으니, 거짓말을 하게 됩니다. 상대의 선언이 의심스러우면{' '}
            <b>의심</b>하세요 — 적중하면 그 말이 제거되고, 억울한 의심이면 당신의 말이
            제거됩니다. 잡기·업기·지름길·한 번 더 모두 그대로! 말 6개 중 <b>2개를 먼저
            완주</b>시키면 승리합니다.
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
  const last = state.history[state.history.length - 1];
  const d = state.declaration;
  const declDest = d && d.value > 0 ? walkBluff(d.from, d.value, d.branch) : null;

  const boardPieces: BoardPiece[] = [];
  for (const pl of [0, 1] as PlayerId[]) {
    state.pieces[pl].forEach((pos, i) => {
      if (pos >= 0 && pos !== GOAL) boardPieces.push({ id: `p${pl}-${i}`, player: pl, node: pos });
    });
  }

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
              ? selected === null
                ? '내 차례 — 움직일(또는 꽝이면 제거할) 말을 고르세요'
                : pendingValue !== null
                  ? '경로를 선택하세요'
                  : '선언할 결과를 고르세요 — 거짓도 됩니다'
              : humanResponding
                ? 'AI의 선언 — 믿을까요, 의심할까요?'
                : aiActing
                  ? 'AI가 고민 중…'
                  : ''}
        </span>
        {last && (
          <span className="yb-last">
            {last.roller === HUMAN ? '나' : 'AI'}:{' '}
            {last.outcome === 'kkang' && '「꽝」 선언 — 말 1개 제거'}
            {last.outcome === 'moved' &&
              `「${VALUE_NAME[last.declared]}」 믿음 · 전진${last.caught ? ' · 잡음!' : ''}${last.extra ? ' · 한 번 더' : ''}`}
            {last.outcome === 'liar-caught' &&
              `「${VALUE_NAME[last.declared]}」 의심 적중! 실제 「${VALUE_NAME[last.roll]}」 — 말 제거`}
            {last.outcome === 'wrong-challenge' &&
              `「${VALUE_NAME[last.declared]}」 의심 실패 (진실) — 의심한 쪽 말 제거${last.caught ? ' · 잡음' : ''}`}
          </span>
        )}
      </div>

      <PlayerTray state={state} p={AI} label="AI" />

      <YutBoard
        pieces={boardPieces}
        movableNodes={new Set(froms.filter((n) => n >= 0))}
        selectedNode={selected}
        lastDest={last?.dest !== GOAL ? last?.dest ?? null : null}
        markedNode={humanResponding && d ? (d.from >= 0 ? d.from : null) : null}
        onNodeClick={onSelect}
      />

      <PlayerTray
        state={state}
        p={HUMAN}
        label="나"
        movable={humanDeclaring && froms.includes(HOME)}
        selected={selected === HOME}
        onEnter={() => onSelect(HOME)}
      />

      {/* 조작 패널 */}
      <div className="yb-panel">
        {humanDeclaring && (
          <>
            <div className="yb-secret">
              <span className="yb-secret-label">내 주사위 (비밀)</span>
              <span className={`yb-die-chip ${state.roll === 0 ? 'blank' : ''}`}>
                {VALUE_NAME[state.roll]}
              </span>
              {state.roll === 0 && (
                <span className="yb-must-lie">꽝! 인정하고 말을 버리거나, 거짓말하세요</span>
              )}
            </div>
            {pendingValue === null ? (
              <div className="yb-btns">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    className={`yb-declare ${v === state.roll ? 'truth' : ''}`}
                    disabled={selected === null}
                    onClick={() => onValue(v)}
                  >
                    {VALUE_NAME[v]} <small>{v}칸</small>
                  </button>
                ))}
                <button
                  className="yb-declare kkang"
                  disabled={selected === null || !kkang.includes(selected)}
                  onClick={() => onValue(0)}
                >
                  꽝 <small>말 제거</small>
                </button>
              </div>
            ) : (
              <div className="yb-btns">
                {branchOptions(selected!).map((b) => {
                  const dest = walkBluff(selected!, pendingValue, b);
                  return (
                    <button key={b} className="yb-declare" onClick={() => onBranch(b)}>
                      {b === 1 ? (selected === 22 ? '횡단길' : '지름길') : selected === 22 ? '출구' : '바깥길'}{' '}
                      <small>{dest === GOAL ? '완주!' : '전진'}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
        {humanResponding && d && (
          <>
            <span className="yb-note">
              AI: 「<b>{VALUE_NAME[d.value]}</b>」 선언 —{' '}
              {d.from === HOME ? '새 말 진입' : '판 위 말 이동'}
              {declDest === GOAL && ' (완주!)'}
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

      {/* 주사위 굴림 연출 */}
      {rollAnim && (
        <D10Overlay
          mine={rollAnim === 'mine'}
          value={state.roll}
        />
      )}

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
                ? '두 말이 먼저 완주했습니다'
                : state.result.winner === AI
                  ? 'AI에게 승리를 내주었습니다'
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

function D10Overlay({ mine, value }: { mine: boolean; value: number }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 900);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="d10-overlay">
      <div
        className={`d10 ${settled ? 'settled' : 'rolling'} ${!mine ? 'hidden-face' : ''}`}
      >
        {settled ? (mine ? VALUE_NAME[value] : '?') : ''}
      </div>
      {mine ? (
        <>
          <span className="d10-secret-tag">나만 볼 수 있는 결과</span>
          <div className="d10-caption">
            10면체 주사위를 굴렸습니다 — 이제 <b>원하는 대로</b> 선언하세요
          </div>
        </>
      ) : (
        <div className="d10-caption">
          AI가 주사위를 굴렸습니다
          <br />
          결과는 <b>AI만</b> 확인했습니다
        </div>
      )}
    </div>
  );
}

function PlayerTray({
  state,
  p,
  label,
  movable,
  selected,
  onEnter,
}: {
  state: BState;
  p: PlayerId;
  label: string;
  movable?: boolean;
  selected?: boolean;
  onEnter?: () => void;
}) {
  const home = state.pieces[p].filter((x) => x === HOME).length;
  const dead = state.pieces[p].filter((x) => x === DEAD).length;
  const done = state.pieces[p].filter((x) => x === GOAL).length;
  return (
    <div className={`yb-tray pl${p}`}>
      <span className="yb-label">{label}</span>
      <button
        className={`yb-home ${movable ? 'movable' : ''} ${selected ? 'picked' : ''}`}
        disabled={!movable}
        onClick={onEnter}
      >
        {Array.from({ length: home }, (_, i) => (
          <span key={i} className={`tray-token pl${p}`} />
        ))}
        <span>대기 {home}</span>
      </button>
      <span className="yb-counts">
        완주 <b>{done}</b>/2{dead > 0 && <em> · 제거 {dead}</em>}
      </span>
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
