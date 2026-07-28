import { useEffect, useRef, useState } from 'react';
import type { Face, JPState, PlayerId } from './engine.ts';
import {
  applyAction,
  callCost,
  createGame,
  maxLevelFor,
  nextHand,
} from './engine.ts';
import {
  chooseAiAction,
  recordBackReveal,
  recordGameEnd,
  recordResponse,
} from './ai.ts';
import { loadPolicy } from './policy.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { RuleBookButton } from '../shared/RuleBook.tsx';
import { SurrenderButton } from '../shared/Surrender.tsx';
import PokerLayout, { BetSlider, PkFlipCard, PkOverlay, PkResult, useMood } from '../shared/pokerui.tsx';
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
  const [mood, setMood] = useMood();
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);
  const learnedHand = useRef(0);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  // MCCFR 자가학습 정책(코드 분할 청크)을 화면 진입 시 미리 로드
  useEffect(() => {
    void loadPolicy();
  }, []);

  function startGame() {
    setToss(0); // 값은 의미 없다 — 선공은 동전을 던져 정해진다
  }

  function begin(first: PlayerId) {
    setState(createGame(first));
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
  const firstAction = myTurn && state!.faces[HUMAN] === null;
  const minL = state ? (firstAction ? Math.max(1, state.level) : state.level + 1) : 1;
  const cap =
    state && myTurn
      ? maxLevelFor(state, HUMAN, pickedFace ?? state.faces[HUMAN] ?? 'front')
      : 0;
  const lv = Math.min(Math.max(level, minL), Math.max(cap, minL));

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
    setLevel(1);
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
            <span className="memory-line">AI는 자가대국 강화학습으로 수렴한 균형 전략으로 면을 선언하고 베팅합니다</span>
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

  const resultText = !r
    ? ''
    : r.reason === 'fold'
      ? r.folder === HUMAN
        ? `폴드 — AI가 팟 ${r.pot}칩 획득${r.penalty ? ` + 양면 페널티 ${r.penalty}` : ''}`
        : `AI 폴드 — 팟 ${r.pot}칩 획득!${r.penalty ? ` + 양면 페널티 ${r.penalty}` : ''}`
      : r.reason === 'showdown'
        ? r.winner === null
          ? `무승부 (${r.values[HUMAN]} : ${r.values[AI]}) — 팟 ${r.pot}칩 이월`
          : `${r.values[HUMAN]} : ${r.values[AI]} — ${r.winner === HUMAN ? '승리! 팟' : 'AI가 팟'} ${r.pot}칩`
        : r.reason === 'both-win'
          ? r.winner === HUMAN
            ? `양면베팅 성공! 팟 ${r.pot}칩 + 페널티 ${r.penalty}칩`
            : `AI 양면베팅 성공… 팟 ${r.pot}칩 + 페널티 ${r.penalty}칩`
          : r.winner === HUMAN
            ? `AI 양면베팅 실패! 팟 ${r.pot}칩 획득`
            : `양면베팅 실패… AI가 팟 ${r.pot}칩 획득`;

  const panel = (
    <>
      {state.phase === 'act' && state.turn === AI && !state.result && (
        <div className="pk-thinking">AI가 고민 중…</div>
      )}
      {myTurn && firstAction && (
        <>
          <div className="pk-status">
            {state.faces[AI]
              ? `AI가 ${FACE_NAME[state.faces[AI]!]}에 레벨 ${state.level} 베팅 — 응수하세요`
              : '베팅할 면을 선언하고 칩을 거세요'}
          </div>
          <div className="pk-faces">
            <button
              className={`pk-seg ${pickedFace === 'front' ? 'on' : ''}`}
              onClick={() => setPickedFace('front')}
            >
              앞면 {my.front}
            </button>
            <button
              className={`pk-seg ${pickedFace === 'back' ? 'on' : ''}`}
              onClick={() => setPickedFace('back')}
            >
              뒷면 {my.back}
            </button>
            <button
              className={`pk-seg gold ${pickedFace === 'both' ? 'on' : ''}`}
              disabled={state.faces[AI] === 'both'}
              onClick={() => setPickedFace('both')}
            >
              양면 ×2
            </button>
          </div>
          {pickedFace !== null && cap >= minL && (
            <BetSlider
              value={lv}
              min={minL}
              max={cap}
              onChange={setLevel}
              times2={pickedFace === 'both'}
            />
          )}
          <div className="pk-actions two">
            <button className="pk-btn fold" onClick={() => humanAct({ kind: 'fold' })}>
              포기{state.faces[AI] === 'both' && ' (−10)'}
            </button>
            <button
              className="pk-btn ac"
              disabled={!pickedFace || cap < minL}
              onClick={() => pickedFace && humanAct({ kind: 'bet', face: pickedFace, level: lv })}
            >
              {state.faces[AI] !== null && lv === state.level
                ? '콜'
                : `베팅 ${lv}${pickedFace === 'both' ? ' ×2' : ''}`}
            </button>
          </div>
        </>
      )}
      {myTurn && !firstAction && (
        <>
          <div className="pk-status">
            AI가 레벨 {state.level}(으)로 올렸습니다 — 콜 비용 {callCost(state, HUMAN)}
          </div>
          {cap > state.level && (
            <BetSlider
              value={lv}
              min={minL}
              max={cap}
              onChange={setLevel}
              times2={state.faces[HUMAN] === 'both'}
            />
          )}
          <div className="pk-actions three">
            <button className="pk-btn fold" onClick={() => humanAct({ kind: 'fold' })}>
              폴드{state.faces[AI] === 'both' && ' (−10)'}
            </button>
            <button
              className="pk-btn solid"
              disabled={callCost(state, HUMAN) > state.stacks[HUMAN]}
              onClick={() => humanAct({ kind: 'call' })}
            >
              콜 +{callCost(state, HUMAN)}
            </button>
            <button
              className="pk-btn ac"
              disabled={cap <= state.level}
              onClick={() => humanAct({ kind: 'raise', level: lv })}
            >
              레이즈 {lv}
            </button>
          </div>
        </>
      )}
      {showResult && (
        <PkResult
          left={r!.values[AI] !== null ? String(r!.values[AI]) : '?'}
          right={r!.values[HUMAN] !== null ? String(r!.values[HUMAN]) : '?'}
          text={resultText}
          onNext={
            state.phase === 'handover'
              ? () => {
                  setState(nextHand(state));
                  setPeek(false);
                  setPickedFace(null);
                  setLevel(1);
                }
              : undefined
          }
        />
      )}
    </>
  );

  const badgeOf = (f: Face | null, gold: boolean) =>
    f ? { text: `${FACE_NAME[f]} 베팅`, gold: gold || f === 'both' } : null;

  return (
    <PokerLayout
      mood={mood}
      onMood={setMood}
      header={<GameHeader onExit={onExit} surrender={phase === 'playing' && !state.result} />}
      handNo={state.handNo}
      opp={{
        name: 'AI',
        turn: state.phase === 'act' && state.turn === AI,
        stack: state.stacks[AI],
        badge: badgeOf(state.faces[AI], false),
      }}
      me={{
        name: '나',
        turn: state.phase === 'act' && state.turn === HUMAN,
        stack: state.stacks[HUMAN],
        badge: badgeOf(state.faces[HUMAN], true),
      }}
      oppCard={
        <PkFlipCard
          key={`ai-${state.handNo}`}
          front={oppCard.front}
          back={oppBackRevealed ? oppCard.back : null}
          flipped={!!oppBackRevealed}
          caption="앞면 공개 · 뒷면 비밀"
        />
      }
      myCard={
        <PkFlipCard
          key={`my-${state.handNo}`}
          front={my.front}
          back={my.back}
          flipped={peek}
          onClick={() => setPeek((p) => !p)}
          caption="카드를 탭해 뒷면 확인"
          captionAccent
        />
      }
      oppBet={state.paid[AI]}
      myBet={state.paid[HUMAN]}
      pot={state.phase === 'act' ? state.paid[0] + state.paid[1] + state.carry : r?.pot ?? 0}
      carried={state.carry}
      panel={panel}
    >
      {phase === 'done' && state.result && (
        <PkOverlay
          title={state.result.winner === HUMAN ? '🏆 승리!' : '패배…'}
          sub={state.result.winner === HUMAN ? 'AI의 칩을 모두 털었습니다' : '칩을 모두 잃었습니다'}
        >
          <div className="end-actions">
            <button className="primary-btn" onClick={startGame}>다시 대전</button>
            <button className="ghost-btn" onClick={onExit}>로비로</button>
          </div>
        </PkOverlay>
      )}
    </PokerLayout>
  );
}

function GameHeader({ onExit, surrender = false }: { onExit: () => void; surrender?: boolean }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">야누스 포커</span>
      {surrender && <SurrenderButton gameId="janus-poker" onExit={onExit} />}
      <RuleBookButton gameId="janus-poker" gameName="야누스 포커" className="rb-btn header-rb" />
    </header>
  );
}
