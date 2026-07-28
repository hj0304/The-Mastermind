import { useEffect, useRef, useState } from 'react';
import type { BpAction, BpState, PlayerId } from './engine.ts';
import {
  act,
  createGame,
  gameWinner,
  legalInfo,
  nextHand,
  potSize,
} from './engine.ts';
import { chooseAiAction, recordGameEnd, recordHandObservations } from './ai.ts';
import { loadPolicy } from './policy.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { RuleBookButton } from '../shared/RuleBook.tsx';
import { SurrenderButton } from '../shared/Surrender.tsx';
import PokerLayout, { BetSlider, PkCard, PkOverlay, PkResult, useMood } from '../shared/pokerui.tsx';
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
  /** 레이즈 총액 (상대 베팅 + 증분) — 렌더 시 범위로 클램프 */
  const [raiseTo, setRaiseTo] = useState(1);
  const [mood, setMood] = useMood();
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
    setRaiseTo(1);
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
    setRaiseTo(1);
  }

  function proceedNextHand() {
    if (!state || state.phase !== 'result') return;
    setState(nextHand(state));
    setRaiseTo(1);
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

  const oppBet = state.invested[AI];
  const minTo = oppBet + 1;
  const maxTo = info ? oppBet + info.maxRaise : minTo;
  const rv = Math.min(Math.max(raiseTo, minTo), Math.max(minTo, maxTo));
  const noRaise = !info || info.maxRaise < 1;

  const panel = (
    <>
      {state.phase === 'betting' && state.toAct === AI && (
        <div className="pk-thinking">AI가 고민 중…</div>
      )}
      {myTurn && info && (
        <>
          <div className="pk-status">
            {info.callCost > 0
              ? `콜하려면 ${info.callCost} 필요 · 10을 들고 폴드하면 −10`
              : '베팅 동액 — 콜하면 즉시 공개됩니다'}
          </div>
          {!noRaise && <BetSlider value={rv} min={minTo} max={maxTo} onChange={setRaiseTo} />}
          <div className="pk-actions three">
            <button className="pk-btn fold" onClick={() => humanAct({ type: 'fold' })}>
              폴드
            </button>
            <button className="pk-btn solid" onClick={() => humanAct({ type: 'call' })}>
              {info.callCost > 0 ? `콜 ${info.callCost}` : '콜 (공개)'}
            </button>
            <button
              className="pk-btn ac"
              disabled={noRaise}
              onClick={() => humanAct({ type: 'raise', amount: rv - oppBet })}
            >
              레이즈 {rv}
            </button>
          </div>
        </>
      )}
      {state.phase === 'result' && lastHand && (
        <PkResult
          left={String(lastHand.cards[AI])}
          right={
            lastHand.outcome !== 'fold' || lastHand.folder === HUMAN
              ? String(lastHand.cards[HUMAN])
              : '?'
          }
          text={
            lastHand.outcome === 'draw'
              ? '무승부 — 팟이 다음 핸드로 이월됩니다'
              : lastHand.outcome === 'showdown'
                ? lastHand.winner === HUMAN
                  ? `승리! +${lastHand.potWon}칩`
                  : `패배 −${lastHand.potWon}칩`
                : lastHand.folder === HUMAN
                  ? `폴드 — AI가 팟을 가져갑니다${lastHand.penalty ? ' (10 페널티 −10칩)' : ''}`
                  : `AI 폴드 — +${lastHand.potWon}칩${lastHand.penalty ? ' (AI 10 페널티)' : ''}`
          }
          onNext={proceedNextHand}
        />
      )}
    </>
  );

  return (
    <PokerLayout
      mood={mood}
      onMood={setMood}
      header={
        <GameHeader onExit={onExit} surrender={phase === 'playing' && state.phase !== 'gameover'} />
      }
      handNo={state.handNo}
      opp={{ name: 'AI', turn: state.phase === 'betting' && state.toAct === AI, stack: state.stacks[AI] }}
      me={{ name: '나', turn: state.phase === 'betting' && state.toAct === HUMAN, stack: state.stacks[HUMAN] }}
      oppCard={<PkCard value={state.cards[AI]} caption="내게만 보임" />}
      myCard={<PkCard hidden caption="나만 못 봄" captionAccent />}
      oppBet={state.invested[AI]}
      myBet={state.invested[HUMAN]}
      pot={state.phase === 'betting' ? potSize(state) : lastHand?.potWon ?? 0}
      carried={state.carried}
      panel={panel}
    >
      {phase === 'done' && (
        <PkOverlay
          title={gameWinner(state) === HUMAN ? '🏆 승리!' : '파산…'}
          sub={`최종 칩 — 나 ${state.stacks[HUMAN]} : AI ${state.stacks[AI]}`}
        >
          <div className="end-actions">
            <button className="primary-btn" onClick={startGame}>
              다시 대전
            </button>
            <button className="ghost-btn" onClick={onExit}>
              로비로
            </button>
          </div>
        </PkOverlay>
      )}
    </PokerLayout>
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
