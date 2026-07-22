import { useEffect, useRef, useState } from 'react';
import type { PlayerId, QState } from './engine.ts';
import {
  canDecline,
  cardSum,
  createGame,
  currentActor,
  decline,
  exchange,
  finalFour,
  isQuattro,
  keepHand,
  mulligan,
  openCard,
} from './engine.ts';
import { aiChooseAction, aiChooseOpen, aiWantsMulligan } from './ai.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { RuleBookButton } from '../shared/RuleBook.tsx';
import { CardBack, CardView, COLOR_NAME } from './cards.tsx';
import QuattroOnline from './QuattroOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './quattro.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

export default function QuattroGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<QState | null>(null);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recorded = useRef(false);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  function startGame() {
    setToss(0); // 값은 의미 없다 — 선공은 동전을 던져 정해진다
  }

  function begin(first: PlayerId) {
    setState(createGame(first));
    setSelectedCard(null);
    setNotice(null);
    recorded.current = false;
    setPhase('playing');
  }

  // AI 자동 진행 (멀리건 / 오픈 / 교환)
  useEffect(() => {
    if (phase !== 'playing' || !state || state.result) return;

    if (state.phase === 'mulligan' && !state.mulliganDone[AI]) {
      const timer = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'mulligan' || s.mulliganDone[AI]) return s;
          if (s.mulligansUsed[AI] < 2 && aiWantsMulligan(s.hands[AI])) return mulligan(s, AI);
          return keepHand(s, AI);
        });
      }, 500);
      return () => clearTimeout(timer);
    }

    if (state.phase === 'opening' && state.pendingOpen[0] === AI) {
      setAiThinking(true);
      const timer = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'opening' || s.pendingOpen[0] !== AI) return s;
          return openCard(s, AI, aiChooseOpen(s, AI));
        });
        setAiThinking(false);
      }, 800);
      return () => clearTimeout(timer);
    }

    if (state.phase === 'exchange' && currentActor(state) === AI) {
      setAiThinking(true);
      const timer = setTimeout(() => {
        setState((s) => {
          if (!s || s.phase !== 'exchange' || currentActor(s) !== AI) return s;
          const a = aiChooseAction(s, AI);
          return a.type === 'decline' ? decline(s, AI) : exchange(s, AI, a.virtualIdx, a.giveCardId);
        });
        setAiThinking(false);
      }, 800 + Math.random() * 600);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  // 종료 감지
  useEffect(() => {
    if (phase === 'playing' && state?.result) {
      if (!recorded.current) {
        recorded.current = true;
        if (state.result.winner !== null) recordResult('quattro', state.result.winner === HUMAN);
      }
      const timer = setTimeout(() => setPhase('done'), 700);
      return () => clearTimeout(timer);
    }
  }, [phase, state]);

  // ---------- 사람 행동 ----------

  function onMyCardClick(cardId: number) {
    if (!state) return;
    if (state.phase === 'opening' && state.pendingOpen[0] === HUMAN) {
      setState(openCard(state, HUMAN, cardId));
      setSelectedCard(null);
      return;
    }
    if (state.phase === 'exchange' && currentActor(state) === HUMAN && !aiThinking) {
      setSelectedCard((c) => (c === cardId ? null : cardId));
    }
  }

  function onVirtualClick(v: number) {
    if (!state || selectedCard === null) return;
    if (state.phase !== 'exchange' || currentActor(state) !== HUMAN || aiThinking) return;
    if (state.exchanged[HUMAN][v]) return;
    const next = exchange(state, HUMAN, v, selectedCard);
    const got = next.log[next.log.length - 1].received;
    setNotice(`가상 ${v + 1}에게서 받은 카드: ${COLOR_NAME[got.color]} ${got.num}`);
    setTimeout(() => setNotice(null), 2500);
    setState(next);
    setSelectedCard(null);
  }

  function onPass() {
    if (!state || state.phase !== 'exchange' || currentActor(state) !== HUMAN || aiThinking) return;
    if (!canDecline(state, HUMAN)) {
      setNotice('아직 교환하지 않은 가상 플레이어가 있어 패스할 수 없습니다');
      setTimeout(() => setNotice(null), 2500);
      return;
    }
    setState(decline(state, HUMAN));
    setSelectedCard(null);
  }

  // ---------- 렌더 ----------

  if (online !== null && online !== 'panel') {
    return <QuattroOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="qt-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel
          gameName="콰트로"
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
    const rec = getRecord('quattro');
    return (
      <div className="qt-root">
        <GameHeader onExit={onExit} />
        <div className="qt-setup">
          <h2>콰트로</h2>
          <p className="qt-rule-summary">
            <b>색과 숫자가 모두 다른 4장(콰트로)</b>을 상대보다 높은 합계로 완성하세요. 4색 1~6
            카드와 검정 0 두 장, 총 26장. <b>검정 0도 별개의 색·숫자로 인정</b>되므로 0을 끼워
            콰트로를 완성할 수 있습니다(대신 합계가 0만큼 손해). 멀리건 2회로 패를 바꿀 수 있고,
            남은 18장을 가진 <b>가상 플레이어 6명 전원과 한 번씩 교환</b>해야 합니다. 내가 준
            카드는 공개되고, 받는 카드는 나만 봅니다. 가상 플레이어는 0 카드가 있으면 무조건 0을
            줍니다 — 조심하세요!
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">AI는 공개된 교환 기록으로 가상 플레이어의 손패를 추적합니다</span>
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

  const statusText = state.result
    ? '게임 종료'
    : state.phase === 'mulligan'
      ? state.mulliganDone[HUMAN] ? 'AI가 패를 확정하는 중…' : '패를 확정하거나 멀리건하세요'
      : state.phase === 'opening'
        ? state.pendingOpen[0] === HUMAN ? '공개할 카드를 선택하세요' : 'AI가 카드를 공개하는 중…'
        : currentActor(state) === HUMAN && !aiThinking
          ? selectedCard !== null ? '교환할 가상 플레이어를 선택하세요' : '손패를 골라 교환하거나 패스하세요'
          : 'AI가 고민 중…';

  const myUnvisited = state.exchanged[HUMAN].filter((x) => !x).length;

  return (
    <div className="qt-root">
      <GameHeader onExit={onExit} />

      <div className="qt-status">
        <span>{statusText}</span>
        {state.phase === 'exchange' && (
          <span className="qt-sub">남은 의무 교환 {myUnvisited}곳</span>
        )}
      </div>

      {/* AI 영역 */}
      <div className="qt-player-row ai">
        <span className="label">AI</span>
        <div className="cards">
          {state.opens[AI].map((c) => <CardView key={c.id} card={c} />)}
          {state.hands[AI].map((c) => <CardBack key={c.id} />)}
        </div>
      </div>

      {/* 가상 플레이어 6명 */}
      <div className="qt-virtuals">
        {state.virtuals.length === 6
          ? state.virtuals.map((v, i) => (
              <button
                key={i}
                className={`qt-virtual ${state.exchanged[HUMAN][i] ? 'visited' : ''} ${selectedCard !== null && !state.exchanged[HUMAN][i] ? 'selectable' : ''}`}
                onClick={() => onVirtualClick(i)}
              >
                <span className="v-name">가상 {i + 1}</span>
                <div className="v-cards">
                  {v.map((c) => <span key={c.id} className="mini-back" />)}
                </div>
                <span className="v-marks">
                  {state.exchanged[HUMAN][i] && <em className="me">나✓</em>}
                  {state.exchanged[AI][i] && <em className="op">AI✓</em>}
                </span>
              </button>
            ))
          : <span className="qt-sub">멀리건이 끝나면 가상 플레이어에게 카드가 배분됩니다</span>}
      </div>

      {/* 교환 로그 */}
      {state.log.length > 0 && (
        <div className="qt-log">
          {state.log.slice(-3).map((e, i) => (
            <span key={i} className="log-line">
              {e.player === HUMAN ? '나' : 'AI'} → 가상{e.virtualIdx + 1}:{' '}
              <b className={`c-${e.given.color}`}>{COLOR_NAME[e.given.color]} {e.given.num}</b> 건넴
            </span>
          ))}
        </div>
      )}

      {/* 내 영역 */}
      <div className="qt-player-row me">
        <span className="label">나</span>
        <div className="cards">
          {state.opens[HUMAN].map((c) => <CardView key={c.id} card={c} opened />)}
          {state.hands[HUMAN].map((c) => (
            <CardView
              key={c.id}
              card={c}
              selectable
              selected={selectedCard === c.id}
              onClick={() => onMyCardClick(c.id)}
            />
          ))}
        </div>
      </div>

      {/* 액션 바 */}
      <div className="qt-actions">
        {state.phase === 'mulligan' && !state.mulliganDone[HUMAN] && (
          <>
            <button
              className="ghost-btn"
              disabled={state.mulligansUsed[HUMAN] >= 2}
              onClick={() => setState(mulligan(state, HUMAN))}
            >
              🎲 멀리건 ({2 - state.mulligansUsed[HUMAN]}회 남음)
            </button>
            <button className="primary-btn" onClick={() => setState(keepHand(state, HUMAN))}>
              이 패로 확정
            </button>
          </>
        )}
        {state.phase === 'exchange' && currentActor(state) === HUMAN && !aiThinking && (
          <button className="ghost-btn" onClick={onPass}>
            패스
          </button>
        )}
      </div>

      {notice && <div className="qt-notice">{notice}</div>}

      {phase === 'done' && state.result && (
        <div className="qt-overlay">
          <div className="qt-endcard">
            <h2>
              {state.result.winner === null ? '무승부' : state.result.winner === HUMAN ? '🏆 승리!' : '패배…'}
            </h2>
            <p className="qt-detail">{state.result.detail}</p>
            <div className="final-rows">
              {([HUMAN, AI] as PlayerId[]).map((p) => {
                const four = finalFour(state, p);
                return (
                  <div key={p} className="final-row">
                    <span className="who">{p === HUMAN ? '나' : 'AI'}</span>
                    {four.map((c) => <CardView key={c.id} card={c} small />)}
                    <span className={`verdict ${isQuattro(four) ? 'ok' : 'fail'}`}>
                      {isQuattro(four) ? `콰트로 ${cardSum(four)}` : `미완성 ${cardSum(four)}`}
                    </span>
                  </div>
                );
              })}
            </div>
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
      <span className="game-title">콰트로</span>
      <RuleBookButton gameId="quattro" gameName="콰트로" className="rb-btn header-rb" />
    </header>
  );
}
