import { useEffect, useRef, useState } from 'react';
import type { PlayerId, RaiseSetup, RaiseState } from './engine.ts';
import {
  TOTAL_CHIPS,
  createGame,
  decide,
  maxCallable,
  nextRound,
  randomSetup,
} from './engine.ts';
import { aiDecide, aiSetup, recordGameEnd, recordShowdownForLearning } from './ai.ts';
import { loadPolicy } from './policy.ts';
import { getRecord, recordResult } from '../../stats.ts';
import { RuleBookButton } from '../shared/RuleBook.tsx';
import { SurrenderButton } from '../shared/Surrender.tsx';
import { MoodPills, MoodScope, PkOverlay, useMood } from '../shared/pokerui.tsx';
import { ArrangeBoard, RaiseTileFace, RaiseTileFlip, TrackStrip } from './raiseui.tsx';
import MonochromeRaiseOnline from './MonochromeRaiseOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './raise.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'arrange' | 'playing' | 'done';

export default function MonochromeRaiseGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [mySetup, setMySetup] = useState<RaiseSetup>(randomSetup);
  const [state, setState] = useState<RaiseState | null>(null);
  const [mood, setMood] = useMood();
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);
  const learned = useRef(0);

  const chipsUsed = mySetup.bets.reduce((a, b) => a + b, 0);

  // MCCFR 자가학습 정책(코드 분할 청크)을 화면 진입 시 미리 로드
  useEffect(() => {
    void loadPolicy();
  }, []);

  function enterArrange() {
    setMySetup(randomSetup());
    setPhase('arrange');
  }

  function startGame() {
    if (chipsUsed !== TOTAL_CHIPS) return;
    setState(createGame(mySetup, aiSetup()));
    recorded.current = false;
    learned.current = 0;
    setPhase('playing');
  }

  // AI 결정 자동 진행
  useEffect(() => {
    if (phase !== 'playing' || !state) return;
    if (state.phase === 'decision' && state.toDecide === AI) {
      const timer = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'decision' || s.toDecide !== AI) return s;
          return decide(s, aiDecide(s, AI));
        });
      }, 900 + Math.random() * 700);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  // 쇼다운 학습 기록 + 종료 감지
  useEffect(() => {
    if (!state) return;
    if (state.history.length > learned.current) {
      for (const h of state.history.slice(learned.current)) {
        if (h.revealed) recordShowdownForLearning(h.finalBets[HUMAN], h.tiles[HUMAN]);
      }
      learned.current = state.history.length;
    }
    if (phase === 'playing' && state.phase === 'gameover' && !recorded.current) {
      recorded.current = true;
      recordGameEnd();
      if (state.result?.winner != null) recordResult('monochrome-raise', state.result.winner === HUMAN);
      setPhase('done');
    }
  }, [phase, state]);

  // ---------- 렌더 ----------

  if (online !== null && online !== 'panel') {
    return <MonochromeRaiseOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="rz-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel gameName="모노크롬 레이즈" onReady={(room) => setOnline(room)} onCancel={() => setOnline(null)} />
      </div>
    );
  }

  if (phase === 'setup') {
    const rec = getRecord('monochrome-raise');
    return (
      <div className="rz-root">
        <GameHeader onExit={onExit} />
        <div className="rz-setup">
          <h2>모노크롬 레이즈</h2>
          <p className="rz-rule-summary">
            0~9 타일 열 장의 <b>대결 순서</b>와 <b>칩 30개의 분배</b>를 미리 설계합니다(타일당
            최소 1개). 설계가 끝나면 칩 배분은 서로 공개되고, 1번 타일부터 대결 — 적게 건 쪽이{' '}
            <b>콜(칩 맞추기)</b> 또는 <b>폴드</b>를 선택합니다. 콜이 부족하면 이후 타일의 칩을
            차출합니다. 높은 숫자가 팟을 가져가고, 10라운드 뒤 칩이 많은 쪽이 승리합니다.
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">통산 전적 <b>{rec.wins}승 {rec.losses}패</b></span>
            <span className="memory-line">AI는 자가대국으로 학습한 배치 혼합 전략과 콜/폴드 균형 전략을 사용합니다</span>
          </div>
          <button className="primary-btn" onClick={enterArrange}>AI 대전 — 배치 설계하기</button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>⚔️ 온라인 대전</button>
        </div>
      </div>
    );
  }

  if (phase === 'arrange') {
    return (
      <MoodScope mood={mood}>
        <div className="pk-col">
          <GameHeader onExit={onExit} />
          <div className="pk-handrow">SETUP</div>
          <ArrangeBoard setup={mySetup} onChange={setMySetup} />
          <div className="pk-panel">
            <div className="pk-status">
              타일을 탭해 선택하고, 다른 타일을 탭하면 순서(칩 포함)를 교환합니다.
              <br />
              짝수는 <b>흑</b> · 홀수는 <b>백</b> — 배치는 상대에게 비공개, 칩 분배만 공개됩니다.
            </div>
            <div className="pk-actions" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
              <button className="pk-btn fold" onClick={enterArrange}>
                다시 섞기
              </button>
              <button className="pk-btn ac" disabled={chipsUsed !== TOTAL_CHIPS} onClick={startGame}>
                {chipsUsed === TOTAL_CHIPS ? '이 설계로 대전 시작' : `칩 ${TOTAL_CHIPS - chipsUsed}개 더 분배`}
              </button>
            </div>
          </div>
          <MoodPills mood={mood} onMood={setMood} />
        </div>
      </MoodScope>
    );
  }

  if (!state) return null;
  const r = Math.min(state.round, 9);
  const last = state.history[state.history.length - 1];
  const showResult = state.phase === 'result' && last;
  const myDecision = state.phase === 'decision' && state.toDecide === HUMAN;
  const aiDeciding = state.phase === 'decision' && state.toDecide === AI;
  const need = myDecision ? state.bets[AI][r] - state.bets[HUMAN][r] : 0;
  const oppBet = showResult ? last.finalBets[AI] : state.bets[AI][r];
  const myBet = showResult ? last.finalBets[HUMAN] : state.bets[HUMAN][r];
  const revealNow = !!showResult && last.revealed && last.round === r;

  const panel = (
    <>
      {aiDeciding && <div className="pk-thinking">AI가 콜/폴드를 고민 중…</div>}
      {myDecision && (
        <>
          <div className="pk-status">
            상대가 <b>{state.bets[AI][r]}</b>개를 걸었습니다 — 콜하려면 <b>+{need}</b> (스태시{' '}
            {Math.min(state.stash[HUMAN], need)}
            {need > state.stash[HUMAN] ? ` + 뒤 타일 차출 ${need - state.stash[HUMAN]}` : ''})
            <br />
            폴드하면 타일을 공개하지 않고 베팅 칩을 내줍니다
          </div>
          <div className="pk-actions two">
            <button className="pk-btn fold" onClick={() => setState(decide(state, 'fold'))}>
              폴드
            </button>
            <button
              className="pk-btn ac"
              disabled={maxCallable(state, HUMAN) < need}
              onClick={() => setState(decide(state, 'call'))}
            >
              콜 +{need}
            </button>
          </div>
        </>
      )}
      {showResult && (
        <div className="rz-result">
          <div className="txt">
            {last.outcome === 'draw' &&
              `무승부 (${last.tiles[HUMAN]} : ${last.tiles[AI]}) — 각자 회수`}
            {last.outcome === 'showdown' &&
              (last.winner === HUMAN
                ? `승리! ${last.tiles[HUMAN]} > ${last.tiles[AI]} — 팟 ${last.pot}개`
                : `패배… ${last.tiles[HUMAN]} < ${last.tiles[AI]} — 상대가 ${last.pot}개`)}
            {last.outcome === 'fold' &&
              (last.folder === HUMAN
                ? `폴드 — AI가 ${last.pot}개 획득 (타일 비공개)`
                : `AI 폴드 — ${last.pot}개 획득! (타일 비공개)`)}
          </div>
          <button className="pk-btn ac next" onClick={() => setState(nextRound(state))}>
            {state.round >= 9 ? '최종 결과' : '다음 라운드'}
          </button>
        </div>
      )}
    </>
  );

  return (
    <MoodScope mood={mood}>
      <div className="pk-col">
        <GameHeader onExit={onExit} surrender={phase === 'playing' && state.phase !== 'gameover'} />
        <div className="pk-handrow">ROUND {String(r + 1).padStart(2, '0')}/10</div>

        <div className="pk-seat">
          <div className="pk-seat-left">
            {aiDeciding && <span className="pk-dot" />}
            <span className="pk-seat-name">AI</span>
          </div>
          <div className="pk-seat-right">
            <span className="k">스태시</span>
            <span className="v">{state.stash[AI]}</span>
            <span className="rz-goal">/31 목표</span>
          </div>
        </div>

        <TrackStrip state={state} me={HUMAN} />

        <div className="rz-duel">
          <div className="rz-zone">
            <RaiseTileFlip value={state.order[AI][r]} revealed={revealNow} />
            <span className="pk-bet-pill">
              베팅 <b>{oppBet}</b>
            </span>
          </div>
          <div className="rz-pot">
            <span className="k">팟</span>
            <span className="n">{oppBet + myBet}</span>
          </div>
          <div className="rz-zone">
            <span className="pk-bet-pill">
              내 베팅 <b>{myBet}</b>
            </span>
            <RaiseTileFace value={state.order[HUMAN][r]} />
            <span className="pk-caption accent">내 타일 — 상대에겐 비공개</span>
          </div>
        </div>

        <div className="pk-seat">
          <div className="pk-seat-left">
            {myDecision && <span className="pk-dot" />}
            <span className="pk-seat-name">나</span>
          </div>
          <div className="pk-seat-right">
            <span className="k">스태시</span>
            <span className="v">{state.stash[HUMAN]}</span>
            <span className="rz-goal">/31 목표</span>
          </div>
        </div>

        <div className="pk-panel">{panel}</div>
        <MoodPills mood={mood} onMood={setMood} />

        {phase === 'done' && state.result && (
          <PkOverlay
            title={state.result.winner === null ? '무승부' : state.result.winner === HUMAN ? '🏆 승리!' : '패배…'}
            sub={`최종 스태시 — 나 ${state.stash[HUMAN]} : AI ${state.stash[AI]}`}
          >
            <div className="end-actions">
              <button className="primary-btn" onClick={enterArrange}>다시 대전</button>
              <button className="ghost-btn" onClick={onExit}>로비로</button>
            </div>
          </PkOverlay>
        )}
      </div>
    </MoodScope>
  );
}

function GameHeader({ onExit, surrender = false }: { onExit: () => void; surrender?: boolean }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">모노크롬 레이즈</span>
      {surrender && <SurrenderButton gameId="monochrome-raise" onExit={onExit} />}
      <RuleBookButton gameId="monochrome-raise" gameName="모노크롬 레이즈" className="rb-btn header-rb" />
    </header>
  );
}
