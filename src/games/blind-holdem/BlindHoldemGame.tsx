import { useEffect, useRef, useState } from 'react';
import type { BhAction, BhState, PlayerId } from './engine.ts';
import {
  RANK_NAME,
  act,
  createGame,
  gameWinner,
  handRank,
  legalInfo,
  nextHand,
  potSize,
  riskProfile,
} from './engine.ts';
import { chooseAiAction, recordGameEnd, recordHandObservations } from './ai.ts';
import { loadPolicy } from './policy.ts';
import { getRecord, recordResult } from '../../stats.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { RuleBookButton } from '../shared/RuleBook.tsx';
import { SurrenderButton } from '../shared/Surrender.tsx';
import {
  BetSlider,
  MoodPills,
  MoodScope,
  PkCard,
  PkOverlay,
  useMood,
} from '../shared/pokerui.tsx';
import { CommunityCards, RankTag, RiskBadge, riskNote } from './holdemui.tsx';
import BlindHoldemOnline from './BlindHoldemOnline.tsx';
import OnlinePanel from '../../net/OnlinePanel.tsx';
import type { NetRoom } from '../../net/room.ts';
import './holdem.css';

const HUMAN: PlayerId = 0;
const AI: PlayerId = 1;

type Phase = 'setup' | 'playing' | 'done';

export default function BlindHoldemGame({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<BhState | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  /** 레이즈 총액 (상대 베팅 + 증분) — 렌더 시 범위로 클램프 */
  const [raiseTo, setRaiseTo] = useState(1);
  const [mood, setMood] = useMood();
  const [online, setOnline] = useState<'panel' | NetRoom | null>(null);
  const recordedHands = useRef(0);
  const gameRecorded = useRef(false);
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
        return act(s, chooseAiAction(s, { me: AI }));
      });
      setAiThinking(false);
    }, 700 + Math.random() * 800);
    return () => clearTimeout(timer);
  }, [phase, state]);

  // 핸드 종료 시 성향 기록 + 게임 종료 감지
  useEffect(() => {
    if (!state) return;
    if (state.phase === 'result' && state.history.length > recordedHands.current) {
      recordedHands.current = state.history.length;
      recordHandObservations(state, HUMAN);
    }
    if (state.phase === 'gameover' && !gameRecorded.current) {
      gameRecorded.current = true;
      recordGameEnd();
      recordResult('blind-holdem', gameWinner(state) === HUMAN);
      setPhase('done');
    }
  }, [state]);

  function humanAct(a: BhAction) {
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
    return <BlindHoldemOnline room={online} onExit={onExit} />;
  }
  if (online === 'panel') {
    return (
      <div className="bh-root">
        <GameHeader onExit={onExit} />
        <OnlinePanel
          gameName="블라인드 홀덤"
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
    const rec = getRecord('blind-holdem');
    return (
      <div className="bh-root">
        <GameHeader onExit={onExit} />
        <div className="bh-setup">
          <h2>블라인드 홀덤</h2>
          <p className="bh-rule-summary">
            바닥에 <b>공유 카드 2장</b>이 공개되고, 각자 1장을 <b>자신만 못 보게</b> 이마에
            붙입니다. 내 손은 <b>공유 2장 + 내 이마 1장</b> — 트리플 &gt; 스트레이트 &gt; 더블 &gt;
            하이카드로 겨룹니다. 공유 카드가 같으면 <b>이마 카드가 높은 쪽</b>이 승리.
            <br />
            폴드하면 팟을 내주는데, <b>스트레이트·트리플을 들고 폴드하면 칩 10개 페널티</b>입니다.
            자기 이마를 볼 수 없으니 폴드는 늘 도박 — 그 위험의 크기를 <b>공유 카드가 알려줍니다</b>
            (두 장의 차가 3~7이면 페널티 위험 없음).
          </p>
          <div className="setup-stats">
            <span className="extreme-tag">EXTREME AI</span>
            <span className="record-line">
              통산 전적 <b>{rec.wins}승 {rec.losses}패</b>
            </span>
            <span className="memory-line">
              AI는 자가대국 강화학습(MCCFR)으로 수렴한 균형 전략으로 베팅합니다 — 패턴이 읽히지 않습니다
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
  const last = state.history[state.history.length - 1];
  const showResult = state.phase === 'result' && last;

  const community = showResult ? last.community : state.community;
  const risk = riskProfile(community);
  const oppRank = handRank(community, state.cards[AI]);

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
            {riskNote(risk)}
            <br />
            {info.callCost > 0
              ? `콜하려면 ${info.callCost} 필요합니다.`
              : '베팅 동액 — 콜하면 즉시 공개됩니다.'}
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
      {showResult && (
        <div className="bh-result">
          <div className="txt">{resultText(last, HUMAN)}</div>
          <div className="sub">{resultDetail(last, HUMAN, AI)}</div>
          <button className="pk-btn ac next" onClick={proceedNextHand}>
            다음 핸드
          </button>
        </div>
      )}
    </>
  );

  // 내 이마는 쇼다운/무승부, 또는 내가 폴드했을 때만 공개된다
  const myRevealed = !!showResult && (last.outcome !== 'fold' || last.folder === HUMAN);

  return (
    <MoodScope mood={mood}>
      <div className="pk-col bh-col">
        <GameHeader onExit={onExit} surrender={phase === 'playing' && state.phase !== 'gameover'} />
        <div className="pk-handrow">HAND {String(state.handNo).padStart(2, '0')}</div>

        <div className="pk-seat">
          <div className="pk-seat-left">
            {state.phase === 'betting' && state.toAct === AI && <span className="pk-dot" />}
            <span className="pk-seat-name">AI</span>
            <RankTag rank={oppRank} label="AI" />
          </div>
          <div className="pk-seat-right">
            <span className="k">칩</span>
            <span className="v">{state.stacks[AI]}</span>
          </div>
        </div>

        <div className="pk-center">
          <div className="pk-zone">
            <PkCard value={state.cards[AI]} caption="AI의 이마 — 내게만 보임" />
            <span className="pk-bet-pill">
              베팅 <b>{state.invested[AI]}</b>
            </span>
          </div>

          <div className="bh-mid">
            <CommunityCards cards={community} />
            <RiskBadge risk={risk} />
            <div className="pk-pot">
              <span className="pk-pot-label">팟</span>
              <span className="pk-pot-num">
                {state.phase === 'betting' ? potSize(state) : (last?.potWon ?? 0)}
              </span>
              {state.carried > 0 && <span className="pk-pot-carry">이월 +{state.carried}</span>}
            </div>
          </div>

          <div className="pk-zone">
            <span className="pk-bet-pill">
              내 베팅 <b>{state.invested[HUMAN]}</b>
            </span>
            {myRevealed ? (
              <PkCard value={last.cards[HUMAN]} caption="내 이마 — 공개됨" />
            ) : (
              <PkCard hidden caption="내 이마 — 나만 못 봄" captionAccent />
            )}
          </div>
        </div>

        <div className="pk-seat">
          <div className="pk-seat-left">
            {myTurn && <span className="pk-dot" />}
            <span className="pk-seat-name">나</span>
          </div>
          <div className="pk-seat-right">
            <span className="k">칩</span>
            <span className="v">{state.stacks[HUMAN]}</span>
          </div>
        </div>

        <div className="pk-panel">{panel}</div>
        <MoodPills mood={mood} onMood={setMood} />

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
      </div>
    </MoodScope>
  );
}

/** 결과 한 줄 — 승패와 칩 이동 */
export function resultText(h: BhState['history'][number], me: PlayerId): string {
  if (h.outcome === 'draw') return '무승부 — 팟이 다음 핸드로 이월됩니다';
  if (h.outcome === 'fold') {
    const pen = h.penalty ? ` (${RANK_NAME[h.folderRank ?? 0]} 폴드 — 페널티 10칩!)` : '';
    return h.folder === me
      ? `폴드 — 상대가 ${h.potWon}칩 획득${pen}`
      : `상대 폴드 — ${h.potWon}칩 획득!${pen}`;
  }
  return h.winner === me ? `승리! +${h.potWon}칩` : `패배 −${h.potWon}칩`;
}

/** 결과 상세 — 어떤 족보로 갈렸는지 (폴드는 비공개) */
export function resultDetail(
  h: BhState['history'][number],
  me: PlayerId,
  opp: PlayerId,
): string {
  const oppRank = handRank(h.community, h.cards[opp]);
  if (h.outcome === 'fold') {
    // 폴드한 쪽의 족보만 공개된다 (페널티 판정 때문)
    if (h.folder === me) {
      return `공유 ${h.community.join('·')} · 내 이마 ${h.cards[me]} → ${RANK_NAME[h.folderRank ?? 0]}`;
    }
    return `공유 ${h.community.join('·')} · 상대 이마 ${h.cards[opp]} → ${RANK_NAME[h.folderRank ?? 0]} · 내 카드는 공개되지 않습니다`;
  }
  const myRank = handRank(h.community, h.cards[me]);
  return `공유 ${h.community.join('·')} · 나 ${h.cards[me]}(${RANK_NAME[myRank]}) vs 상대 ${h.cards[opp]}(${RANK_NAME[oppRank]})`;
}

function GameHeader({ onExit, surrender = false }: { onExit: () => void; surrender?: boolean }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>
        ← 로비
      </button>
      <span className="game-title">블라인드 홀덤</span>
      {surrender && <SurrenderButton gameId="blind-holdem" onExit={onExit} />}
      <RuleBookButton gameId="blind-holdem" gameName="블라인드 홀덤" className="rb-btn header-rb" />
    </header>
  );
}
