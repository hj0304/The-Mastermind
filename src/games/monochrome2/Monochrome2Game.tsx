import { useEffect, useRef, useState } from 'react';
import type { M2State, PlayerId } from './engine.ts';
import { bidColor, createGame, currentPlayer, play } from './engine.ts';
import { chooseAiBid, recordContestForLearning, recordGameEnd } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { RuleBookButton } from '../shared/RuleBook.tsx';
import { Gauge } from './gauge.tsx';
import Monochrome2Online from './Monochrome2Online.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './monochrome2.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

export default function Monochrome2Game({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<M2State | null>(null);
  const [bidInput, setBidInput] = useState(0);
  const [aiThinking, setAiThinking] = useState(false);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const recorded = useRef(false);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  function startGame() {
    setToss(0); // 값은 의미 없다 — 선공은 동전을 던져 정해진다
  }

  function begin(first: PlayerId) {
    setState(createGame(first));
    setBidInput(0);
    recorded.current = false;
    setPhase('playing');
  }

  // AI 턴
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result) return;
    if (currentPlayer(state) !== AI) return;
    setAiThinking(true);
    const timer = setTimeout(() => {
      setState((s) => {
        if (!s || s.result || currentPlayer(s) !== AI) return s;
        const next = play(s, chooseAiBid(s, AI));
        flashRound(s, next);
        return next;
      });
      setAiThinking(false);
    }, 700 + Math.random() * 700);
    return () => clearTimeout(timer);
  }, [phase, state]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state?.result) {
      if (!recorded.current) {
        recorded.current = true;
        recordGameEnd();
        if (state.result.winner !== null) {
          recordResult('monochrome-2', state.result.winner === HUMAN);
        }
      }
      const timer = setTimeout(() => setPhase('done'), 900);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  function flashRound(prev: M2State, next: M2State) {
    if (next.history.length > prev.history.length) {
      const r = next.history[next.history.length - 1];
      // 학습: AI가 흑으로 선공한 라운드의 사람 응수 색 (공개 정보)
      recordContestForLearning(
        r.leader === AI && bidColor(r.bids[AI]) === 'black',
        bidColor(r.bids[HUMAN]) === 'white',
      );
      const msg = r.winner === null ? '무승부!' : r.winner === HUMAN ? '라운드 승리!' : '라운드 패배';
      setFlash(msg);
      setTimeout(() => setFlash(null), 1100);
    }
  }

  function submitBid() {
    if (!state || state.result || currentPlayer(state) !== HUMAN || aiThinking) return;
    const bid = Math.max(0, Math.min(bidInput, state.points[HUMAN]));
    const next = play(state, bid);
    flashRound(state, next);
    setState(next);
    setBidInput(0);
  }

  if (online !== null && online !== 'panel') {
    return <Monochrome2Online room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="m2-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel gameName="모노크롬 II" onReady={(room) => setOnline(room)} onCancel={() => setOnline(null)} />
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
    const rec = getRecord('monochrome-2');
    return (
      <div className="m2-root">
        <GameHeader onExit={onExit} />
        <div className="m2-setup">
          <h2>모노크롬 II</h2>
          <p className="m2-rule-summary">
            <b>99포인트</b>를 아홉 라운드에 나눠 겁니다. 상대에겐 <b>자릿수만</b> 보입니다 — 한
            자릿수(0~9)는 흑, 두 자릿수(10~99)는 백. 높은 쪽이 승점 1점, <b>5점 선취 즉시
            승리</b>. 남은 포인트는 5단계 게이지로 서로 공개됩니다. 쓴 포인트는 돌아오지 않습니다
            — 이길 땐 싸게, 버릴 땐 0으로.
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 게이지와 승패에서 당신의 잔여 포인트 구간을 계산합니다</span>
          </div>
          <button className="primary-btn" onClick={startGame}>AI 대전 시작</button>
          <button className="ghost-btn" onClick={() => setOnline('panel')}>⚔️ 온라인 대전</button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const myTurn = !state.result && currentPlayer(state) === HUMAN && !aiThinking;
  const iAmLeader = state.leader === HUMAN;
  const aiPending = state.pending !== null && currentPlayer(state) === HUMAN;
  const roundNo = Math.min(state.roundInSet + 1, state.maxRounds);

  return (
    <div className="m2-root">
      <GameHeader onExit={onExit} />

      <div className="m2-scoreboard">
        <div className="score me">나 <b>{state.scores[HUMAN]}</b></div>
        <div className="round-info">
          {state.overtime > 0 && <span className="overtime">연장 {state.overtime}</span>}
          라운드 {roundNo}/{state.maxRounds} · 5점 선취
        </div>
        <div className="score ai"><b>{state.scores[AI]}</b> AI (EXTREME)</div>
      </div>

      {/* 게이지 */}
      <div className="m2-gauges">
        <Gauge label="내 포인트" points={state.points[HUMAN]} exact />
        <Gauge label="AI 포인트" points={state.points[AI]} />
      </div>

      {/* 테이블 */}
      <div className="m2-table">
        {aiPending ? (
          <div className={`m2-bid-card ${bidColor(state.pending!)}`}>
            <span className="q">?</span>
            <span className="color-name">{bidColor(state.pending!) === 'black' ? '흑 (한 자릿수)' : '백 (두 자릿수)'}</span>
          </div>
        ) : state.pending !== null ? (
          <div className={`m2-bid-card ${bidColor(state.pending)}`}>
            <span>{state.pending}</span>
            <span className="color-name">내 제시 — 상대 응수 대기</span>
          </div>
        ) : (
          <div className="table-hint">
            {aiThinking ? 'AI가 고민 중…' : iAmLeader ? '당신이 선입니다 — 포인트를 제시하세요' : ''}
          </div>
        )}
        {flash && <div className="result-flash">{flash}</div>}
      </div>

      {/* 입찰 입력 */}
      {myTurn && (
        <div className="m2-bid-input">
          <div className="quick-bids">
            {[0, 1, 5, 9, 10, 11, 15, 20].filter((v) => v <= state.points[HUMAN]).map((v) => (
              <button key={v} className={`quick ${bidInput === v ? 'active' : ''}`} onClick={() => setBidInput(v)}>
                {v}
              </button>
            ))}
          </div>
          <div className="bid-row">
            <input
              type="range"
              min={0}
              max={state.points[HUMAN]}
              value={bidInput}
              onChange={(e) => setBidInput(+e.target.value)}
            />
            <span className={`bid-preview ${bidInput <= 9 ? 'black' : 'white'}`}>{bidInput}</span>
            <button className="primary-btn" onClick={submitBid}>제시</button>
          </div>
          <p className="bid-note">
            {bidInput <= 9 ? '흑으로 표시됩니다 (0~9)' : '백으로 표시됩니다 (10~99)'}
          </p>
        </div>
      )}

      {/* 히스토리: 상대 숫자는 비공개 (색만) */}
      <div className="m2-history">
        {state.history.slice(state.history.length - state.roundInSet).map((r, i) => (
          <div key={i} className={`hist-row ${r.winner === HUMAN ? 'win' : r.winner === AI ? 'lose' : 'draw'}`}>
            <span className="hist-round">R{i + 1}</span>
            <span className={`hist-bid ${bidColor(r.bids[HUMAN])}`}>{r.bids[HUMAN]}</span>
            <span className="hist-vs">vs</span>
            <span className={`hist-bid ${bidColor(r.bids[AI])}`}>
              {r.winner === null ? r.bids[AI] : '?'}
            </span>
            <span className="hist-result">{r.winner === HUMAN ? '승' : r.winner === AI ? '패' : '무'}</span>
          </div>
        ))}
      </div>

      {phase === 'done' && state.result && (
        <div className="m2-overlay">
          <div className="m2-endcard">
            <h2>{state.result.winner === null ? '무승부' : state.result.winner === HUMAN ? '🏆 승리!' : '패배…'}</h2>
            <p>{state.scores[HUMAN]} : {state.scores[AI]}</p>
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


function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">모노크롬 II</span>
      <RuleBookButton gameId="monochrome-2" gameName="모노크롬 II" className="rb-btn header-rb" />
    </header>
  );
}
