import { useEffect, useRef, useState } from 'react';
import type { BpAction, BpState, PlayerId } from './engine.ts';
import {
  act,
  createGame,
  gameWinner,
  legalInfo,
  nextHand,
  potSize,
  seenCards,
} from './engine.ts';
import { chooseAiAction, loadOpponentModel, recordGameEnd, recordHandObservations } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import BlindPokerOnline from './BlindPokerOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './blindpoker.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

/** 솔로 플레이는 단일 EXTREME 난이도 */
const DIFFICULTY = 'hard' as const;

type Phase = 'setup' | 'playing' | 'done';

export default function BlindPokerGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<BpState | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recordedHands = useRef(0);
  const gameRecorded = useRef(false);

  function startGame() {
    setState(createGame());
    recordedHands.current = 0;
    gameRecorded.current = false;
    setPhase('playing');
  }

  // AI 턴 자동 진행
  useEffect(() => {
    if (phase !== 'playing' || !state) return;
    if (state.phase !== 'betting' || state.toAct !== AI) return;
    setAiThinking(true);
    const timer = setTimeout(() => {
      setState((s) => {
        if (!s || s.phase !== 'betting' || s.toAct !== AI) return s;
        return act(s, chooseAiAction(s, { difficulty: DIFFICULTY, me: AI }));
      });
      setAiThinking(false);
    }, 700 + Math.random() * 800);
    return () => clearTimeout(timer);
  }, [phase, state]);

  // 핸드 종료 시 상대 성향 학습 기록 + 게임 종료 감지
  useEffect(() => {
    if (!state) return;
    if (state.phase === 'result' && state.history.length > recordedHands.current) {
      recordedHands.current = state.history.length;
      const h = state.history[state.history.length - 1];
      const humanRevealed =
        h.outcome !== 'fold' || h.folder === HUMAN ? h.cards[HUMAN] : h.cards[HUMAN];
      // 사람 카드는 AI가 항상 봤으므로(이마 공개) 관찰 기록에는 항상 전달
      recordHandObservations(state, HUMAN, humanRevealed);
    }
    if (state.phase === 'gameover' && !gameRecorded.current) {
      gameRecorded.current = true;
      recordGameEnd();
      recordResult('blind-poker', gameWinner(state) === HUMAN);
      setPhase('done');
    }
  }, [state]);

  function humanAct(a: BpAction) {
    if (!state || state.phase !== 'betting' || state.toAct !== HUMAN || aiThinking) return;
    setState(act(state, a));
  }

  function proceedNextHand() {
    if (!state || state.phase !== 'result') return;
    setState(nextHand(state));
  }

  if (online !== null && online !== 'panel') {
    return <BlindPokerOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="bp-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel
          gameName="블라인드 포커"
          onReady={(room) => setOnline(room)}
          onCancel={() => setOnline(null)}
        />
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <div className="bp-root">
        <GameHeader onExit={onExit} />
        <div className="bp-setup">
          <h2>블라인드 포커</h2>
          <p className="bp-rule-summary">
            1~10 카드 두 벌, 총 20장. 카드 한 장을 <b>자신만 못 보게</b> 이마에 붙입니다. 상대
            카드만 보고 베팅하세요 — 레이즈 / 콜(동액이면 공개) / 폴드. 높은 카드가 팟을
            가져갑니다. <b>10을 들고 폴드하면 칩 10개 페널티!</b> 상대의 칩을 모두 빼앗으면
            승리합니다.
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{getRecord('blind-poker').wins}승 {getRecord('blind-poker').losses}패</b>
            </span>
            {loadOpponentModel().games > 0 && (
              <span className="memory-line">
                AI가 당신과의 대국 {loadOpponentModel().games}판의 베팅 패턴을 기억하고 있습니다
              </span>
            )}
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
  const info = state.phase === 'betting' ? legalInfo(state) : null;
  const myTurn = state.phase === 'betting' && state.toAct === HUMAN && !aiThinking;
  const lastHand = state.history[state.history.length - 1];

  // 내가 본 카드들 (카운팅 보조 표시)
  const seen = seenCards(state, HUMAN);
  const seenCount = new Array<number>(11).fill(0);
  for (const c of seen) seenCount[c] += 1;

  return (
    <div className="bp-root">
      <GameHeader onExit={onExit} />

      <div className="bp-scoreboard">
        <div className="stack me">
          나 <b>{state.stacks[HUMAN]}</b>칩
        </div>
        <div className="pot-info">
          핸드 #{state.handNo}
          <div className="pot">팟 {state.phase === 'betting' ? potSize(state) : lastHand?.potWon ?? 0}</div>
          {state.carried > 0 && <div className="carried">이월 {state.carried}</div>}
        </div>
        <div className="stack ai">
          AI (EXTREME) <b>{state.stacks[AI]}</b>칩
        </div>
      </div>

      {/* 카드 테이블 */}
      <div className="bp-table">
        <div className="card-slot">
          <div className="slot-label">AI의 이마</div>
          <div className="pcard face">{state.cards[AI]}</div>
          <div className="bet-chips">베팅 {state.invested[AI]}</div>
        </div>
        <div className="vs">VS</div>
        <div className="card-slot">
          <div className="slot-label">내 이마 (나만 못 봄)</div>
          <div className="pcard hidden-card">?</div>
          <div className="bet-chips">베팅 {state.invested[HUMAN]}</div>
        </div>
      </div>

      {/* 액션 패널 */}
      {state.phase === 'betting' && (
        <div className="bp-actions">
          {aiThinking && <div className="thinking">AI가 고민 중…</div>}
          {myTurn && info && (
            <>
              <button className="action-btn fold" onClick={() => humanAct({ type: 'fold' })}>
                폴드
              </button>
              <button className="action-btn call" onClick={() => humanAct({ type: 'call' })}>
                {info.callCost > 0 ? `콜 (+${info.callCost})` : '콜 (공개)'}
              </button>
              {info.raiseOptions.map((r) => (
                <button
                  key={r}
                  className="action-btn raise"
                  onClick={() => humanAct({ type: 'raise', amount: r })}
                >
                  {r === info.maxRaise ? `올인 +${r}` : `레이즈 +${r}`}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* 핸드 결과 */}
      {state.phase === 'result' && lastHand && (
        <div className="bp-hand-result">
          <HandResultView hand={lastHand} />
          <button className="primary-btn" onClick={proceedNextHand}>
            다음 핸드
          </button>
        </div>
      )}

      {/* 카운팅 보조: 내가 본 카드 */}
      <div className="bp-seen">
        <div className="label">이번 덱에서 확인한 카드 (남은 {20 - seen.length}장 + 내 이마)</div>
        <div className="seen-grid">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <div key={n} className={`seen-cell c${seenCount[n]}`}>
              <span className="num">{n}</span>
              <span className="cnt">{2 - seenCount[n]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 핸드 히스토리 */}
      <div className="bp-history">
        {state.history.slice(-6).map((h, i) => {
          const idx = state.history.length - Math.min(6, state.history.length) + i;
          const myCardKnown = h.outcome !== 'fold' || h.folder === HUMAN;
          return (
            <div
              key={idx}
              className={`hist-row ${h.winner === HUMAN ? 'win' : h.winner === AI ? 'lose' : 'draw'}`}
            >
              <span className="hist-no">#{idx + 1}</span>
              <span>나 {myCardKnown ? h.cards[HUMAN] : '?'}</span>
              <span>AI {h.cards[AI]}</span>
              <span className="hist-outcome">
                {h.outcome === 'draw'
                  ? '무승부(이월)'
                  : h.outcome === 'fold'
                    ? `${h.folder === HUMAN ? '나' : 'AI'} 폴드${h.penalty ? ' ⚠10페널티' : ''}`
                    : '쇼다운'}
              </span>
              <span className="hist-pot">
                {h.winner !== undefined ? `${h.winner === HUMAN ? '+' : '-'}${h.potWon}` : ''}
              </span>
            </div>
          );
        })}
      </div>

      {phase === 'done' && (
        <div className="bp-overlay">
          <div className="bp-endcard">
            <h2>{gameWinner(state) === HUMAN ? '🏆 승리!' : '파산…'}</h2>
            <p>
              최종 칩 — 나 {state.stacks[HUMAN]} : AI {state.stacks[AI]}
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

function HandResultView({ hand }: { hand: BpState['history'][number] }) {
  const myCardKnown = hand.outcome !== 'fold' || hand.folder === HUMAN;
  return (
    <div className="hand-result-view">
      <div className="reveal">
        <div className="pcard face small">{hand.cards[AI]}</div>
        <span className="vs">vs</span>
        <div className={`pcard small ${myCardKnown ? 'face' : 'hidden-card'}`}>
          {myCardKnown ? hand.cards[HUMAN] : '?'}
        </div>
      </div>
      <p className="result-text">
        {hand.outcome === 'draw' && '무승부 — 팟이 다음 핸드로 이월됩니다'}
        {hand.outcome === 'showdown' &&
          (hand.winner === HUMAN ? `승리! +${hand.potWon}칩` : `패배 -${hand.potWon}칩`)}
        {hand.outcome === 'fold' &&
          (hand.folder === HUMAN
            ? `폴드 — AI가 팟을 가져갑니다${hand.penalty ? ' (10 페널티 -10칩!)' : ''}`
            : `AI 폴드 — 팟 획득! +${hand.potWon}칩${hand.penalty ? ' (AI 10 페널티 +10칩!)' : ''} · 내 카드는 공개되지 않습니다`)}
      </p>
    </div>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>
        ← 로비
      </button>
      <span className="game-title">블라인드 포커</span>
    </header>
  );
}
