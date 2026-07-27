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
import { chooseAiAction, recordGameEnd, recordHandObservations } from './ai.ts';
import { loadPolicy } from './policy.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { RuleBookButton } from '../shared/RuleBook.tsx';
import { SurrenderButton } from '../shared/Surrender.tsx';
import BlindPokerOnline from './BlindPokerOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import BettingTable, { ActionBtn, ChipTray, PlayCard, RailTitle } from '../shared/BettingTable.tsx';
import { accumulateTendency, emptyTendency, seatBadge, TendencyPanel } from './insight.tsx';
import type { Tendency } from './insight.tsx';
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
  const [raiseAmt, setRaiseAmt] = useState(1);
  const [tend, setTend] = useState<Tendency>(emptyTendency);
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recordedHands = useRef(0);
  const gameRecorded = useRef(false);

  /** 동전이 떨어지면 begin()으로 실제 대국을 시작한다 */
  const [toss, setToss] = useState<PlayerId | null>(null);

  // CFR 자가학습 정책(코드 분할 청크)을 화면 진입 시 미리 로드
  useEffect(() => {
    void loadPolicy();
  }, []);

  function startGame() {
    setToss(0); // 값은 의미 없다 — 선공은 동전을 던져 정해진다
  }

  function begin(first: PlayerId) {
    setState(createGame(first));
    recordedHands.current = 0;
    gameRecorded.current = false;
    setTend(emptyTendency());
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
      setTend((t) => {
        const next = { ...t };
        accumulateTendency(next, state, AI);
        return next;
      });
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
            <span className="memory-line">
              AI는 자가대국 강화학습(CFR+)으로 수렴한 균형 전략으로 베팅합니다 — 패턴이 읽히지 않습니다
            </span>
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

  // 레이즈는 "총액" 개념 — raiseAmt(증분)을 저장하되 표시는 총액(상대 베팅 + 증분)
  const amt = info ? Math.max(1, Math.min(raiseAmt, info.maxRaise)) : 1;
  const oppBet = state.invested[AI];
  const raiseTo = oppBet + amt;
  const minTo = oppBet + 1;
  const maxTo = info ? oppBet + info.maxRaise : minTo;
  const raiseNow = () => humanAct({ type: 'raise', amount: amt });

  const lastAiRaise = [...state.actions]
    .reverse()
    .find((a) => a.player === AI && a.action.type === 'raise')?.action.amount;

  const leftRail = (
    <>
      <RailTitle>핸드 로그</RailTitle>
      {state.history.length === 0 ? (
        <p className="bta-rail-note">아직 기록이 없습니다</p>
      ) : (
        <div className="bta-log">
          {state.history.slice(-8).map((h, i) => {
            const idx = state.history.length - Math.min(8, state.history.length) + i;
            const myCardKnown = h.outcome !== 'fold' || h.folder === HUMAN;
            const what =
              h.outcome === 'draw'
                ? '무승부 이월'
                : h.outcome === 'fold'
                  ? `${h.folder === HUMAN ? '나' : 'AI'} 폴드${h.penalty ? ' ⚠' : ''}`
                  : '쇼다운';
            return (
              <div key={idx} className="bta-log-row">
                <span className="no">#{idx + 1}</span>
                <span className="what">
                  나 {myCardKnown ? h.cards[HUMAN] : '?'} · AI {h.cards[AI]} · {what}
                </span>
                <span
                  className={`amt ${h.winner === HUMAN ? 'win' : h.winner === AI ? 'lose' : ''}`}
                >
                  {h.winner !== undefined ? `${h.winner === HUMAN ? '+' : '−'}${h.potWon}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="bta-rail-card">
        <div className="head">이월 팟</div>
        <span className="gold-num">{state.carried}</span>
        <span className="cap">지난 무승부 이월</span>
      </div>
    </>
  );

  const rightRail = (
    <>
      <RailTitle>카드 카운팅</RailTitle>
      <div className="bta-count">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <div key={n} className={`bta-count-cell c${seenCount[n]}`}>
            {n}
          </div>
        ))}
      </div>
      <p className="bta-rail-note">
        밝은 칸 = 이미 나온 숫자 (진할수록 2장 모두 소진). 남은 {20 - seen.length}장 + 내 이마,
        20장 소진 시 새 덱으로 리셋됩니다.
      </p>
      <div className="bta-rail-hr" />
      <RailTitle>상대 성향</RailTitle>
      <TendencyPanel t={tend} />
      <div className="bta-rail-card gold">
        <div className="head">폴드 페널티</div>
        <p>
          10을 들고 폴드하면 칩 <strong>10개</strong>를 추가로 잃습니다. 내 카드는 볼 수 없습니다.
        </p>
      </div>
    </>
  );

  const statusLine =
    state.phase === 'betting' && myTurn && info
      ? lastAiRaise !== undefined
        ? `AI가 ${lastAiRaise} 레이즈. 응답하세요.`
        : info.callCost > 0
          ? `콜하려면 ${info.callCost} 필요합니다.`
          : '베팅이 같습니다 — 콜하면 즉시 공개됩니다.'
      : undefined;

  const actionBar =
    state.phase === 'betting' ? (
      state.toAct === AI ? (
        <div className="bta-thinking">AI가 고민 중…</div>
      ) : myTurn && info ? (
        <div className="bta-actions">
          <div className="bta-btn-grid">
            <ActionBtn
              variant="secondary"
              caption="10 보유 시 −10"
              captionTone="gold"
              onClick={() => humanAct({ type: 'fold' })}
            >
              폴드
            </ActionBtn>
            <ActionBtn
              variant={info.callCost > 0 ? 'primary' : 'secondary'}
              caption={info.callCost > 0 ? `총 ${oppBet}까지` : '즉시 쇼다운'}
              onClick={() => humanAct({ type: 'call' })}
            >
              {info.callCost > 0 ? `콜 ${info.callCost}` : '콜 (공개)'}
            </ActionBtn>
            <ActionBtn
              variant="accent"
              caption={`최소 ${minTo}`}
              onClick={raiseNow}
              disabled={info.maxRaise < 1}
            >
              레이즈 {raiseTo}
            </ActionBtn>
            <ActionBtn
              variant="gold"
              caption={`최대 ${maxTo}`}
              onClick={() => humanAct({ type: 'raise', amount: info.maxRaise })}
              disabled={info.maxRaise < 1}
            >
              올인
            </ActionBtn>
          </div>
          {info.maxRaise >= 1 && (
            <ChipTray
              value={raiseTo}
              min={minTo}
              max={maxTo}
              onChange={(t) => setRaiseAmt(t - oppBet)}
              onEnter={raiseNow}
            />
          )}
        </div>
      ) : undefined
    ) : state.phase === 'result' && lastHand ? (
      <div className="bta-result">
        <HandResultView hand={lastHand} />
        <button className="primary-btn" onClick={proceedNextHand}>
          다음 핸드
        </button>
      </div>
    ) : undefined;

  const turnBadge =
    state.phase === 'betting'
      ? state.toAct === HUMAN
        ? { label: '내 차례', tone: 'accent' as const }
        : { label: '대기', tone: 'neutral' as const }
      : { label: '핸드 종료', tone: 'neutral' as const };

  return (
    <div className="bp-root bp-wide">
      <GameHeader onExit={onExit} surrender={phase === 'playing' && state.phase !== 'gameover'} />

      {/* A안 테이블 보드: 헤더 → 3컬럼(핸드 로그 | 중앙 축 | 카운팅·성향) → 액션 바 */}
      <BettingTable
        title="블라인드 포커"
        handNo={state.handNo}
        deckInfo={`${20 - seen.length}/20`}
        turn={turnBadge}
        opp={{ name: 'EXTREME AI', stack: state.stacks[AI], badge: seatBadge(state, AI) }}
        me={{ name: '나', stack: state.stacks[HUMAN], badge: seatBadge(state, HUMAN) }}
        oppBet={state.invested[AI]}
        myBet={state.invested[HUMAN]}
        pot={state.phase === 'betting' ? potSize(state) : lastHand?.potWon ?? 0}
        carried={state.carried}
        oppCard={<PlayCard value={state.cards[AI]} caption="내게만 보임" />}
        myCard={<PlayCard hidden caption="나만 못 봄" />}
        leftRail={leftRail}
        rightRail={rightRail}
        statusLine={statusLine}
        actionBar={actionBar}
      />

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

function GameHeader({ onExit, surrender = false }: { onExit: () => void; surrender?: boolean }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>
        ← 로비
      </button>
      <span className="game-title">블라인드 포커</span>
      {surrender && <SurrenderButton gameId="blind-poker" onExit={onExit} />}
      <RuleBookButton gameId="blind-poker" gameName="블라인드 포커" className="rb-btn header-rb" />
    </header>
  );
}
