import { useEffect, useRef, useState } from 'react';
import type { Face, JPState, PlayerId } from './engine.ts';
import {
  applyAction,
  callCost,
  createGame,
  maxLevel,
  nextHand,
} from './engine.ts';
import {
  chooseAiAction,
  recordBackReveal,
  recordGameEnd,
  recordResponse,
} from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import JanusPokerOnline from './JanusPokerOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './janus.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

const FACE_NAME: Record<Face, string> = { front: '앞면', back: '뒷면', both: '양면' };

export default function JanusPokerGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<JPState | null>(null);
  const [pickedFace, setPickedFace] = useState<Face | null>(null);
  const [level, setLevel] = useState(1);
  const [peek, setPeek] = useState(false);
  const [aiActing, setAiActing] = useState(false);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);
  const learnedHand = useRef(0);

  function startGame() {
    setState(createGame(Math.random() < 0.5 ? HUMAN : AI));
    setPickedFace(null);
    setLevel(1);
    setPeek(false);
    recorded.current = false;
    learnedHand.current = 0;
    setPhase('playing');
  }

  // AI 자동 진행
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result) return;
    if (state.phase === 'act' && state.turn === AI) {
      setAiActing(true);
      const timer = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'act' || s.turn !== AI) return s;
          try {
            return applyAction(s, chooseAiAction(s, AI));
          } catch {
            return applyAction(s, { kind: 'fold' });
          }
        });
        setAiActing(false);
      }, 1000 + Math.random() * 600);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  // 핸드 종료 학습 + 게임 종료 감지
  useEffect(() => {
    if (phase !== 'playing' || !state) return;
    if (state.lastResult && state.handNo > learnedHand.current && state.phase !== 'act') {
      learnedHand.current = state.handNo;
      const r = state.lastResult;
      // 사람이 뒷면 선택으로 공개된 경우 (블러핑 학습 — 공개 정보)
      if (r.reason !== 'fold' && r.faces[HUMAN] === 'back') {
        recordBackReveal(state.cards[HUMAN].front, state.cards[HUMAN].back);
      }
    }
    if (state.result && !recorded.current) {
      recorded.current = true;
      recordGameEnd();
      recordResult('janus-poker', state.result.winner === HUMAN);
      const timer = setTimeout(() => setPhase('done'), 1600);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  const myTurn =
    !!state && state.phase === 'act' && state.turn === HUMAN && !state.result && !aiActing;
  const firstAction = myTurn && state.faces[HUMAN] === null;
  const cap = state && myTurn ? maxLevel(state, HUMAN) : 0;
  const minL = state ? Math.max(1, state.level) : 1;

  // 레벨 입력 보정
  useEffect(() => {
    if (!state) return;
    setLevel((l) => Math.min(Math.max(l, minL), Math.max(cap, minL)));
  }, [state, minL, cap]);

  function humanAct(action: Parameters<typeof applyAction>[1]) {
    setState((s) => {
      if (!s || s.phase !== 'act' || s.turn !== HUMAN) return s;
      // AI의 공격(레이즈/양면)에 대한 반응 학습 (공개 정보)
      const aiAggro = s.faces[AI] === 'both' || (s.faces[AI] !== null && s.level >= 2);
      if (aiAggro && (action.kind === 'fold' || action.kind === 'call')) {
        recordResponse(s.faces[AI] === 'both', action.kind === 'fold');
      }
      try {
        return applyAction(s, action);
      } catch {
        return s;
      }
    });
    setPickedFace(null);
  }

  if (online !== null && online !== 'panel') {
    return <JanusPokerOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="jp-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel
          gameName="야누스 포커"
          onReady={(room) => setOnline(room)}
          onCancel={() => setOnline(null)}
        />
      </div>
    );
  }

  if (phase === 'setup') {
    const rec = getRecord('janus-poker');
    return (
      <div className="jp-root">
        <GameHeader onExit={onExit} />
        <div className="jp-setup">
          <h2>야누스 포커</h2>
          <p className="jp-rule-summary">
            앞뒤에 다른 숫자(홀짝 상이)가 적힌 양면 카드 — <b>앞면은 서로 공개, 뒷면은
            나만</b> 봅니다. 베팅할 면을 선언하고 칩을 걸어, 콜이 나오면 선택한 면끼리
            승부합니다. 내 양면이 모두 이길 것 같다면 <b>양면베팅</b>(2배 지불) — 성공 시
            상대 칩 <b>10개를 추가로</b> 뺏고, 상대는 폴드해도 10개를 내야 합니다. 상대
            칩 40개를 모두 털면 승리!
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 공개된 카드를 카운팅하고 당신의 면 선택·폴드 성향을 학습합니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>AI 대전 시작</button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>⚔️ 온라인 대전</button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const my = state.cards[HUMAN];
  const oppCard = state.cards[AI];
  const r = state.lastResult;
  const showResult = state.phase !== 'act' && r !== null;
  const oppBackRevealed = showResult && r!.reason !== 'fold' && state.faces[AI] !== 'front';

  return (
    <div className="jp-root">
      <GameHeader onExit={onExit} />

      <div className="jp-status">
        <div className="jp-stack me">나 <b>{state.stacks[HUMAN]}</b>칩</div>
        <div className="jp-pot">
          <span className="pot-label">팟</span>
          <b>{state.phase === 'act' ? state.paid[0] + state.paid[1] + state.carry : state.carry}</b>
          {state.carry > 0 && <span className="carry">이월 {state.carry} 포함</span>}
          <span className="hand-no">#{state.handNo} · 선 {state.first === HUMAN ? '나' : 'AI'}</span>
        </div>
        <div className="jp-stack ai">AI <b>{state.stacks[AI]}</b>칩</div>
      </div>

      {/* AI 카드 */}
      <div className="jp-side ai-side">
        <JanusCard
          key={`ai-${state.handNo}`}
          front={oppCard.front}
          back={oppBackRevealed ? oppCard.back : null}
          flipped={!!oppBackRevealed}
          owner="ai"
        />
        <div className="jp-side-info">
          <span className="side-name">AI</span>
          {state.faces[AI] && (
            <span className={`face-badge ${state.faces[AI] === 'both' ? 'both' : ''}`}>
              {FACE_NAME[state.faces[AI]!]} 베팅
              {state.faces[AI] === 'front' && ` (${oppCard.front})`}
            </span>
          )}
          {aiActing && <span className="thinking">고민 중…</span>}
        </div>
      </div>

      {/* 내 카드 */}
      <div className="jp-side my-side">
        <JanusCard
          key={`my-${state.handNo}`}
          front={my.front}
          back={my.back}
          flipped={peek}
          owner="me"
        />
        <div className="jp-side-info">
          <span className="side-name">나</span>
          <button className="peek-btn" onClick={() => setPeek((p) => !p)}>
            {peek ? '앞면 보기' : '뒷면 확인 (비밀)'}
          </button>
          {state.faces[HUMAN] && (
            <span className={`face-badge ${state.faces[HUMAN] === 'both' ? 'both' : ''}`}>
              {FACE_NAME[state.faces[HUMAN]!]} 베팅
            </span>
          )}
        </div>
      </div>

      {/* 조작/결과 패널 */}
      <div className="jp-panel">
        {myTurn && firstAction && (
          <>
            <span className="jp-note">
              {state.faces[AI]
                ? `AI: ${FACE_NAME[state.faces[AI]!]}에 레벨 ${state.level} 베팅 — 응수하세요`
                : '베팅할 면을 고르세요 (선언은 공개됩니다)'}
            </span>
            <div className="jp-face-btns">
              <button
                className={`jp-face ${pickedFace === 'front' ? 'on' : ''}`}
                onClick={() => setPickedFace('front')}
              >
                앞면 <b>{my.front}</b>
              </button>
              <button
                className={`jp-face ${pickedFace === 'back' ? 'on' : ''}`}
                onClick={() => setPickedFace('back')}
              >
                뒷면 <b>{my.back}</b> <small>비밀</small>
              </button>
              {state.faces[AI] !== 'both' && (
                <button
                  className={`jp-face both ${pickedFace === 'both' ? 'on' : ''}`}
                  onClick={() => setPickedFace('both')}
                >
                  양면베팅 <small>2배 지불</small>
                </button>
              )}
            </div>
            {pickedFace && cap >= minL && (
              <LevelPicker level={level} setLevel={setLevel} min={minL} max={cap} both={pickedFace === 'both'} />
            )}
            <div className="jp-btns">
              <button className="action-btn fold" onClick={() => humanAct({ kind: 'fold' })}>
                포기{state.faces[AI] === 'both' && ' (−10)'}
              </button>
              <button
                className="action-btn call"
                disabled={!pickedFace || cap < minL}
                onClick={() => pickedFace && humanAct({ kind: 'bet', face: pickedFace, level })}
              >
                {state.faces[AI] !== null && level === state.level ? '콜' : '베팅'} ({level}
                {pickedFace === 'both' ? '×2' : ''})
              </button>
            </div>
          </>
        )}
        {myTurn && !firstAction && (
          <>
            <span className="jp-note">
              AI가 레벨 {state.level}(으)로 올렸습니다 — 콜 비용 <b>{callCost(state, HUMAN)}</b>
            </span>
            {cap > state.level && (
              <LevelPicker level={level} setLevel={setLevel} min={state.level + 1} max={cap} both={state.faces[HUMAN] === 'both'} />
            )}
            <div className="jp-btns">
              <button className="action-btn fold" onClick={() => humanAct({ kind: 'fold' })}>
                폴드{state.faces[AI] === 'both' && ' (−10)'}
              </button>
              <button
                className="action-btn call"
                disabled={callCost(state, HUMAN) > state.stacks[HUMAN]}
                onClick={() => humanAct({ kind: 'call' })}
              >
                콜 (+{callCost(state, HUMAN)})
              </button>
              {cap > state.level && (
                <button
                  className="action-btn raise"
                  disabled={level <= state.level}
                  onClick={() => humanAct({ kind: 'raise', level })}
                >
                  레이즈 ({level})
                </button>
              )}
            </div>
          </>
        )}
        {showResult && (
          <>
            <span className="jp-result-line">
              {r!.reason === 'fold' &&
                (r!.folder === HUMAN
                  ? `폴드 — AI가 팟 ${r!.pot}칩 획득${r!.penalty ? ` + 양면 페널티 ${r!.penalty}` : ''}`
                  : `AI 폴드 — 팟 ${r!.pot}칩 획득!${r!.penalty ? ` + 양면 페널티 ${r!.penalty}` : ''}`)}
              {r!.reason === 'showdown' &&
                (r!.winner === null
                  ? `무승부 (${r!.values[HUMAN]} : ${r!.values[AI]}) — 팟 ${r!.pot}칩 이월`
                  : `${r!.values[HUMAN]} : ${r!.values[AI]} — ${r!.winner === HUMAN ? '승리! 팟' : 'AI가 팟'} ${r!.pot}칩`)}
              {r!.reason === 'both-win' &&
                (r!.winner === HUMAN
                  ? `양면베팅 성공! 팟 ${r!.pot}칩 + 페널티 ${r!.penalty}칩`
                  : `AI 양면베팅 성공… 팟 ${r!.pot}칩 + 페널티 ${r!.penalty}칩`)}
              {r!.reason === 'both-lose' &&
                (r!.winner === HUMAN
                  ? `AI 양면베팅 실패! 팟 ${r!.pot}칩 획득`
                  : `양면베팅 실패… AI가 팟 ${r!.pot}칩 획득`)}
            </span>
            {state.phase === 'handover' && (
              <button className="primary-btn" onClick={() => { setState(nextHand(state)); setPeek(false); setPickedFace(null); }}>
                다음 핸드
              </button>
            )}
          </>
        )}
        {!myTurn && !showResult && (
          <span className="jp-note dim">{aiActing ? 'AI가 고민 중…' : ' '}</span>
        )}
      </div>

      {phase === 'done' && state.result && (
        <div className="jp-overlay">
          <div className="jp-endcard">
            <h2>{state.result.winner === HUMAN ? '🏆 승리!' : '패배…'}</h2>
            <p>
              {state.result.winner === HUMAN
                ? 'AI의 칩을 모두 털었습니다'
                : '칩을 모두 잃었습니다'}
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

/** 양면 카드 — 3D 플립 */
function JanusCard({
  front,
  back,
  flipped,
  owner,
}: {
  front: number;
  back: number | null;
  flipped: boolean;
  owner: 'me' | 'ai';
}) {
  return (
    <div className={`jcard ${owner}`}>
      <div className={`jcard-inner ${flipped ? 'flipped' : ''}`}>
        <div className="jcard-face jcard-front">
          <span className="corner">앞</span>
          <span className="val">{front}</span>
        </div>
        <div className={`jcard-face jcard-back ${back === null ? 'hidden-back' : ''}`}>
          <span className="corner">뒤</span>
          <span className="val">{back === null ? '?' : back}</span>
        </div>
      </div>
    </div>
  );
}

function LevelPicker({
  level,
  setLevel,
  min,
  max,
  both,
}: {
  level: number;
  setLevel: (fn: (l: number) => number) => void;
  min: number;
  max: number;
  both: boolean;
}) {
  return (
    <div className="jp-level">
      <button onClick={() => setLevel((l) => Math.max(min, l - 1))}>−</button>
      <span className="level-num">
        레벨 <b>{level}</b>
        {both && <small> (지불 {level * 2})</small>}
      </span>
      <button onClick={() => setLevel((l) => Math.min(max, l + 1))}>＋</button>
      <div className="quick">
        {[min, min + 2, min + 5]
          .filter((v, i, arr) => v <= max && arr.indexOf(v) === i)
          .map((v) => (
            <button key={v} className={v === level ? 'on' : ''} onClick={() => setLevel(() => v)}>
              {v}
            </button>
          ))}
        <button className={level === max ? 'on' : ''} onClick={() => setLevel(() => max)}>
          맥스
        </button>
      </div>
    </div>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">야누스 포커</span>
    </header>
  );
}
