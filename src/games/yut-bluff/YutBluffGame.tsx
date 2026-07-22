import { useEffect, useRef, useState } from 'react';
import type { BState, PlayerId, RoundRec } from './engine.ts';
import {
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
import CoinToss from '../shared/CoinToss.tsx';
import { RuleBookButton } from '../shared/RuleBook.tsx';
import { D10Overlay, OutcomeBanner, PlayerTray } from './parts.tsx';
import YutBluffOnline from './YutBluffOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
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
  const [banner, setBanner] = useState<RoundRec | null>(null);
  const [aiActing, setAiActing] = useState(false);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);
  const animShownForRound = useRef(-1);
  const bannerShownForLen = useRef(0);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  function startGame() {
    setToss(0); // 값은 의미 없다 — 선공은 동전을 던져 정해진다
  }

  function begin(first: PlayerId) {
    setState(createGame(first));
    setSelected(null);
    setPendingValue(null);
    setBanner(null);
    recorded.current = false;
    animShownForRound.current = -1;
    bannerShownForLen.current = 0;
    setPhase('playing');
  }

  // 연출 시퀀서: 결과 배너 → 주사위 굴림을 한 이펙트에서 순차 예약.
  // (배너/굴림을 별도 이펙트로 두면 서로의 의존성 변경이 상대 타이머를
  // 취소해 주사위 오버레이가 영영 안 사라지는 데드락이 생긴다)
  useEffect(() => {
    if (phase !== 'playing' || !state) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let delay = 0;
    if (state.history.length > bannerShownForLen.current) {
      bannerShownForLen.current = state.history.length;
      setBanner(state.history[state.history.length - 1]);
      delay = 2000;
      timers.push(setTimeout(() => setBanner(null), delay));
    }
    if (!state.result && state.phase === 'declare' && animShownForRound.current !== state.round) {
      animShownForRound.current = state.round;
      const kind = state.turn === HUMAN ? 'mine' : 'ai';
      timers.push(setTimeout(() => setRollAnim(kind), delay));
      // 내 주사위는 직접 던지므로 오버레이가 스스로 닫는다(onDone). AI 것만 자동으로 걷는다
      if (kind === 'ai') timers.push(setTimeout(() => setRollAnim(null), delay + 1500));
    }
    if (timers.length === 0) return;
    return () => timers.forEach(clearTimeout);
  }, [phase, state]);

  // AI 자동 진행 (선언 또는 응답)
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result || rollAnim || banner) return;
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
  }, [phase, state, rollAnim, banner]);

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
      const timer = setTimeout(() => setPhase('done'), 2300);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  const humanDeclaring =
    !!state &&
    state.phase === 'declare' &&
    state.turn === HUMAN &&
    !state.result &&
    !rollAnim &&
    !banner;
  const humanResponding =
    !!state &&
    state.phase === 'respond' &&
    state.turn === AI &&
    !state.result &&
    !rollAnim &&
    !banner;

  const froms = humanDeclaring ? movableFroms(state, HUMAN) : [];
  const kkang = humanDeclaring ? kkangTargets(state, HUMAN) : [];

  // 갈림길 도착 후보 (분기 대기 중일 때 판에 초록으로 표시)
  const branchDests =
    humanDeclaring && selected !== null && pendingValue !== null
      ? branchOptions(selected).map((b) => ({ branch: b, dest: walkBluff(selected, pendingValue, b) }))
      : [];

  function onSelect(pos: number) {
    if (!humanDeclaring) return;
    // 분기 대기 중: 도착 칸 클릭으로 경로 확정
    const hitBranch = branchDests.find((bd) => bd.dest === pos);
    if (hitBranch) {
      onBranch(hitBranch.branch);
      return;
    }
    if (!froms.includes(pos)) {
      setSelected(null);
      setPendingValue(null);
      return;
    }
    setSelected(pos === selected ? null : pos);
    setPendingValue(null);
  }

  /** 함수형 업데이트 + 방어: 연속 클릭 등으로 상태가 이미 바뀌었으면 무시 */
  function safeDeclare(value: number, from: number, branch: 0 | 1) {
    setState((s) => {
      if (!s || s.phase !== 'declare' || s.result) return s;
      try {
        return declare(s, { value, from, branch });
      } catch {
        return s;
      }
    });
    setSelected(null);
    setPendingValue(null);
  }

  function onValue(v: number) {
    if (!state || selected === null) return;
    if (v === 0) {
      safeDeclare(0, selected, 0);
      return;
    }
    const branches = branchOptions(selected);
    if (branches.length === 1) {
      safeDeclare(v, selected, 0);
    } else {
      setPendingValue(v); // 분기 선택 대기
    }
  }

  function onBranch(branch: 0 | 1) {
    if (!state || selected === null || pendingValue === null) return;
    safeDeclare(pendingValue, selected, branch);
  }

  function onRespond(challenge: boolean) {
    if (!state || !humanResponding) return;
    recordHumanResponse(state.declaration!.value, challenge);
    setState((s) => {
      if (!s || s.phase !== 'respond' || s.result) return s;
      try {
        return respond(s, challenge);
      } catch {
        return s;
      }
    });
  }

  if (online !== null && online !== 'panel') {
    return <YutBluffOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="yb-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel
          gameName="윷과 거짓말"
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
          <button className="primary-btn" onClick={startGame}>AI 대전 시작</button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>⚔️ 온라인 대전</button>
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
        movableNodes={
          pendingValue === null ? new Set(froms.filter((n) => n >= 0)) : undefined
        }
        targetNodes={new Set(branchDests.map((bd) => bd.dest).filter((x) => x !== GOAL))}
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
              <>
                <span className="yb-note dim">갈림길 — 초록으로 표시된 도착 칸을 누르세요</span>
                {branchDests.some((bd) => bd.dest === GOAL) && (
                  <button
                    className="primary-btn"
                    onClick={() => onBranch(branchDests.find((bd) => bd.dest === GOAL)!.branch)}
                  >
                    🏁 완주 선언!
                  </button>
                )}
              </>
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

      {/* 라운드 결과 배너 (믿음/의심 결과) */}
      {banner && !rollAnim && <OutcomeBanner rec={banner} me={HUMAN} oppLabel="AI" />}

      {/* 주사위 굴림 연출 */}
      {rollAnim && (
        <D10Overlay
          mine={rollAnim === 'mine'}
          value={state.roll}
          oppLabel="AI"
          onDone={rollAnim === 'mine' ? () => setRollAnim(null) : undefined}
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
            <p>{endReason(state)}</p>
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

/** 승패 사유 — 완주 승리와 전멸 승리를 구분해 보여준다 */
function endReason(state: BState): string {
  const w = state.result?.winner;
  if (w == null) return '승부를 가리지 못했습니다';
  const crossed = state.pieces[w].filter((x) => x === GOAL).length;
  if (crossed >= 2) {
    return w === HUMAN ? '두 말이 먼저 완주했습니다!' : 'AI의 두 말이 먼저 완주했습니다';
  }
  return w === HUMAN
    ? 'AI의 남은 말이 2개 미만 — 전멸승입니다!'
    : '남은 말이 2개 미만이 되어 패배했습니다';
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">윷과 거짓말</span>
      <RuleBookButton gameId="yut-bluff" gameName="윷과 거짓말" className="rb-btn header-rb" />
    </header>
  );
}
