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
import { getRecord, recordResult } from '../../stats.ts';
import { TrackRow, tileColor } from './track.tsx';
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
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [state, setState] = useState<RaiseState | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);
  const learned = useRef(0);

  const chipsUsed = mySetup.bets.reduce((a, b) => a + b, 0);

  function enterArrange() {
    setMySetup(randomSetup());
    setSwapFrom(null);
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
      setAiThinking(true);
      const timer = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'decision' || s.toDecide !== AI) return s;
          return decide(s, aiDecide(s, AI));
        });
        setAiThinking(false);
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

  // ---------- 배치 편집 ----------

  function onArrangeTileClick(pos: number) {
    if (swapFrom === null) {
      setSwapFrom(pos);
      return;
    }
    if (swapFrom !== pos) {
      setMySetup((st) => {
        const order = [...st.order];
        [order[swapFrom], order[pos]] = [order[pos], order[swapFrom]];
        const bets = [...st.bets];
        [bets[swapFrom], bets[pos]] = [bets[pos], bets[swapFrom]];
        return { order, bets };
      });
    }
    setSwapFrom(null);
  }

  function adjustChip(pos: number, delta: number) {
    setMySetup((st) => {
      const bets = [...st.bets];
      const next = bets[pos] + delta;
      if (next < 1) return st;
      if (delta > 0 && chipsUsed >= TOTAL_CHIPS) return st;
      bets[pos] = next;
      return { ...st, bets };
    });
  }

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
            <span className="memory-line">AI는 쇼다운마다 당신의 베팅 크기와 실제 타일을 대조해 블러핑을 학습합니다</span>
          </div>
          <button className="primary-btn" onClick={enterArrange}>AI 대전 — 배치 설계하기</button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>⚔️ 온라인 대전</button>
        </div>
      </div>
    );
  }

  if (phase === 'arrange') {
    return (
      <div className="rz-root">
        <GameHeader onExit={onExit} />
        <p className="rz-hint">
          타일 두 개를 클릭하면 순서를 바꿉니다. +/−로 칩을 분배하세요. (남은 칩{' '}
          <b>{TOTAL_CHIPS - chipsUsed}</b>)
        </p>
        <div className="rz-arrange">
          {mySetup.order.map((v, pos) => (
            <div key={pos} className="rz-slot">
              <span className="slot-no">{pos + 1}</span>
              <button
                className={`rz-tile ${tileColor(v)} ${swapFrom === pos ? 'selected' : ''}`}
                onClick={() => onArrangeTileClick(pos)}
              >
                {v}
              </button>
              <div className="chip-ctl">
                <button onClick={() => adjustChip(pos, -1)}>−</button>
                <span className="chip-n">{mySetup.bets[pos]}</span>
                <button onClick={() => adjustChip(pos, 1)}>＋</button>
              </div>
            </div>
          ))}
        </div>
        <div className="rz-actions">
          <button className="ghost-btn" onClick={enterArrange}>🎲 다시 섞기</button>
          <button className="primary-btn" disabled={chipsUsed !== TOTAL_CHIPS} onClick={startGame}>
            {chipsUsed === TOTAL_CHIPS ? '이 설계로 대전 시작' : `칩 ${TOTAL_CHIPS - chipsUsed}개 더 분배`}
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const r = state.round;
  const last = state.history[state.history.length - 1];
  const myDecision = state.phase === 'decision' && state.toDecide === HUMAN;
  const need = myDecision ? state.bets[AI][r] - state.bets[HUMAN][r] : 0;

  return (
    <div className="rz-root">
      <GameHeader onExit={onExit} />

      <div className="rz-scoreboard">
        <div className="stack me">나 <b>{state.stash[HUMAN]}</b>칩</div>
        <div className="round-info">라운드 {Math.min(r + 1, 10)}/10</div>
        <div className="stack ai">AI (EXTREME) <b>{state.stash[AI]}</b>칩</div>
      </div>

      {/* 트랙: 양쪽 배분 공개, 타일은 공개된 것만 */}
      <TrackRow label="AI" state={state} p={AI} current={r} />
      <TrackRow label="나" state={state} p={HUMAN} current={r} mine />

      {/* 결정/결과 패널 */}
      <div className="rz-panel">
        {state.phase === 'decision' && state.toDecide === AI && (
          <span className="rz-note">{aiThinking ? 'AI가 콜/폴드를 고민 중…' : ''}</span>
        )}
        {myDecision && (
          <>
            <span className="rz-note">
              내 타일 <b>{state.order[HUMAN][r]}</b> · 내 베팅 {state.bets[HUMAN][r]} vs AI{' '}
              {state.bets[AI][r]} — 콜 비용 <b>{need}</b>
              {need > state.stash[HUMAN] && ' (부족분은 이후 타일에서 차출)'}
            </span>
            <div className="rz-btns">
              <button className="action-btn fold" onClick={() => setState(decide(state, 'fold'))}>
                폴드
              </button>
              <button
                className="action-btn call"
                disabled={maxCallable(state, HUMAN) < need}
                onClick={() => setState(decide(state, 'call'))}
              >
                콜 (+{need})
              </button>
            </div>
          </>
        )}
        {state.phase === 'result' && last && (
          <>
            <span className="rz-note">
              {last.outcome === 'draw' && `무승부 — 각자 베팅 회수 (${last.tiles[HUMAN]} vs ${last.tiles[AI]})`}
              {last.outcome === 'showdown' &&
                `${last.tiles[HUMAN]} vs ${last.tiles[AI]} — ${last.winner === HUMAN ? '팟 획득!' : '패배'} (${last.pot}칩)`}
              {last.outcome === 'fold' &&
                (last.folder === HUMAN
                  ? `폴드 — AI가 ${last.pot}칩 획득 (타일 비공개)`
                  : `AI 폴드 — ${last.pot}칩 획득! (타일 비공개)`)}
            </span>
            <button className="primary-btn" onClick={() => setState(nextRound(state))}>
              {state.round >= 9 ? '결과 보기' : '다음 라운드'}
            </button>
          </>
        )}
      </div>

      {phase === 'done' && state.result && (
        <div className="rz-overlay">
          <div className="rz-endcard">
            <h2>{state.result.winner === null ? '무승부' : state.result.winner === HUMAN ? '🏆 승리!' : '패배…'}</h2>
            <p>최종 칩 — 나 {state.stash[HUMAN]} : AI {state.stash[AI]}</p>
            <div className="end-actions">
              <button className="primary-btn" onClick={enterArrange}>다시 대전</button>
              <button className="ghost-btn" onClick={onExit}>로비로</button>
            </div>
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
      <span className="game-title">모노크롬 레이즈</span>
    </header>
  );
}
