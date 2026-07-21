import { useEffect, useRef, useState } from 'react';
import type { HFState, PlayerId } from './engine.ts';
import {
  ANSWER_SECONDS,
  ROUNDS,
  WINDOW_SECONDS,
  advanceHint,
  answerTimeout,
  buzz,
  createGame,
  nextRound,
  numTurn,
  submitAnswer,
  submitNum,
} from './engine.ts';
import { viewFor } from './view.ts';
import { AnswerClock, HintList, ProblemBar } from './parts.tsx';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import './hiddenformula.css';
import '../../net/online.css';

/**
 * 히든 포뮬러 온라인 대전 — 호스트 권위 + **버저 선점 중재**.
 *
 * 지금까지의 게임과 달리 이것은 실시간이다. 턴을 기다려주지 않는 두 가지가 있다:
 *
 * 1) **시간** — 힌트 창 60초, 버저 후 답변 10초. 시계는 호스트 것만 진짜로 치고,
 *    상태를 보낼 때 "남은 밀리초"를 함께 보낸다. 게스트는 받은 순간을 기준으로
 *    자기 화면의 카운트다운을 그린다(표시용). 실제 시간 초과 판정은 호스트가 한다.
 *
 * 2) **버저 선점** — 누가 먼저 눌렀는지가 점수를 가른다. 그냥 "호스트에 먼저 도착한
 *    쪽"으로 정하면 릴레이를 거치지 않는 호스트가 항상 유리하다(편도 지연만큼 공짜).
 *    그래서 호스트는 주기적인 핑으로 왕복 시간을 재두고, 게스트의 버저가 도착하면
 *    **편도 지연을 빼서 실제로 누른 시각을 복원**한다. 그리고 첫 버저가 들어와도
 *    곧바로 확정하지 않고 짧은 중재 창(BUZZ_GRACE) 동안 반대쪽 버저를 기다렸다가
 *    복원된 시각이 이른 쪽에게 준다. 게스트가 시각을 스스로 신고하지 않으므로
 *    (호스트가 도착 시각에서 계산한다) 시간을 앞당겨 속일 수도 없다.
 *
 * 비공개 정보는 규칙 목록뿐이라 view.ts에서 ruleOrder만 지워 보낸다.
 */

/** 버저 중재 창 — 반대쪽 버저가 릴레이를 건너올 시간을 준다 */
const BUZZ_GRACE = 350;
/** 라운드 결과를 보여주고 다음 라운드로 넘어가기까지 */
const ROUNDEND_MS = 6000;
const PING_MS = 3000;

type NetMsg =
  /** 선공 동전 결과 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' }
  /** endsInMs: 지금 단계의 남은 시간 (없으면 null) */
  | { t: 'state'; s: HFState; endsInMs: number | null }
  | { t: 'num'; n: number }
  | { t: 'buzz' }
  | { t: 'answer'; text: string }
  /** 양쪽이 모두 원할 때만 힌트를 넘긴다 */
  | { t: 'skip'; on: boolean }
  | { t: 'skipstate'; want: [boolean, boolean] }
  /** 게스트 화면의 시간이 다 됐다 — 호스트를 깨운다 */
  | { t: 'tick' }
  | { t: 'ping'; id: number }
  | { t: 'pong'; id: number };

export default function HiddenFormulaOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;

  const stateRef = useRef<HFState | null>(null);
  const [state, setState] = useState<HFState | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [numInput, setNumInput] = useState('');
  const [ansInput, setAnsInput] = useState('');
  const [skipWant, setSkipWant] = useState<[boolean, boolean]>([false, false]);
  const [oppLeft, setOppLeft] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);

  // 호스트 전용 — 진짜 시계와 버저 중재
  const windowEnd = useRef<number | null>(null);
  const answerEnd = useRef<number | null>(null);
  const roundEndAt = useRef<number | null>(null);
  const windowKey = useRef('');
  /** 편도 지연 추정 (왕복의 절반, 관측 최솟값) */
  const oneWay = useRef(0);
  const pingAt = useRef(new Map<number, number>());
  const buzzRace = useRef<{ seat: PlayerId; at: number }[]>([]);
  const buzzTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipRef = useRef<[boolean, boolean]>([false, false]);
  /** (게스트) 같은 마감으로 호스트를 두 번 깨우지 않기 위한 표시 */
  const tickSentFor = useRef<number | null>(null);

  /** 지금 단계의 마감 시각 (호스트 시계) */
  function currentEnd(s: HFState): number | null {
    if (s.phase === 'window') return windowEnd.current;
    if (s.phase === 'answer') return answerEnd.current;
    if (s.phase === 'roundend') return roundEndAt.current;
    return null;
  }

  function hostSend(next: HFState) {
    // 단계에 맞춰 마감 시각을 갱신한다. 힌트 창은 오답으로 되돌아와도 이어져야 하므로
    // (라운드-힌트수) 키가 바뀔 때만 새로 잡는다.
    if (next.phase === 'window') {
      const key = `${next.round}-${next.hints.length}`;
      if (windowKey.current !== key) {
        windowKey.current = key;
        windowEnd.current = Date.now() + WINDOW_SECONDS * 1000;
      }
      answerEnd.current = null;
    } else if (next.phase === 'answer') {
      answerEnd.current = Date.now() + ANSWER_SECONDS * 1000;
    } else if (next.phase === 'roundend') {
      roundEndAt.current = Date.now() + ROUNDEND_MS;
      answerEnd.current = null;
    } else {
      answerEnd.current = null;
    }
    if (next.phase !== 'window') {
      skipRef.current = [false, false];
      setSkipWant([false, false]);
    }
    stateRef.current = next;
    setState(next);
    const end = currentEnd(next);
    setDeadline(end);
    room.send({
      t: 'state',
      s: viewFor(next),
      endsInMs: end === null ? null : end - Date.now(),
    } satisfies NetMsg);
    if (next.phase === 'window') {
      room.send({ t: 'skipstate', want: skipRef.current } satisfies NetMsg);
    }
  }

  /** 버저 도착 — 곧바로 확정하지 않고 중재 창을 열어 이른 쪽을 고른다 */
  function hostBuzz(seat: PlayerId, at: number) {
    const s = stateRef.current;
    if (!s || s.phase !== 'window' || s.wrongBuzzed[seat]) return;
    buzzRace.current.push({ seat, at });
    if (buzzTimer.current) return;
    buzzTimer.current = setTimeout(() => {
      buzzTimer.current = null;
      const cands = buzzRace.current;
      buzzRace.current = [];
      const cur = stateRef.current;
      if (!cur || cur.phase !== 'window') return;
      const valid = cands.filter((c) => !cur.wrongBuzzed[c.seat]).sort((a, b) => a.at - b.at);
      if (valid.length === 0) return;
      try {
        hostSend(buzz(cur, valid[0].seat));
      } catch {
        // 이미 단계가 바뀌었다
      }
    }, BUZZ_GRACE);
  }

  function hostSkip(seat: PlayerId, on: boolean) {
    const s = stateRef.current;
    if (!s || s.phase !== 'window') return;
    const want: [boolean, boolean] = [...skipRef.current];
    want[seat] = on;
    skipRef.current = want;
    setSkipWant(want);
    room.send({ t: 'skipstate', want } satisfies NetMsg);
    if (want[0] && want[1]) {
      skipRef.current = [false, false];
      setSkipWant([false, false]);
      try {
        hostSend(advanceHint(s));
      } catch {
        // 무시
      }
    }
  }

  function hostNum(seat: PlayerId, n: number) {
    const s = stateRef.current;
    if (!s || (s.phase !== 'num1' && s.phase !== 'num2')) return;
    if (numTurn(s) !== seat) return;
    try {
      hostSend(submitNum(s, n));
    } catch {
      // 무효한 수 무시
    }
  }

  function hostAnswer(seat: PlayerId, text: string) {
    const s = stateRef.current;
    if (!s || s.phase !== 'answer' || s.answerer !== seat) return;
    try {
      hostSend(submitAnswer(s, text));
    } catch {
      // 무시
    }
  }

  /**
   * (호스트 전용) 마감이 지났으면 진행시킨다.
   *
   * 인터벌만으로는 부족하다 — 브라우저는 **백그라운드 탭의 타이머를 강하게 억제**하므로
   * 호스트가 다른 탭을 보고 있으면 양쪽 판이 멈춰버린다. 그래서 인터벌 외에
   * 메시지 수신·탭 복귀 때도 호출하고, 게스트도 자기 화면의 시간이 다 되면
   * 호스트를 깨운다(판정은 어디까지나 호스트 시계 기준).
   */
  function hostTick() {
    if (!room.isHost) return;
    const s = stateRef.current;
    if (!s || s.result) return;
    const t = Date.now();
    try {
      if (s.phase === 'window' && windowEnd.current && t >= windowEnd.current) {
        hostSend(advanceHint(s));
      } else if (s.phase === 'answer' && answerEnd.current && t >= answerEnd.current) {
        hostSend(answerTimeout(s));
      } else if (s.phase === 'roundend' && roundEndAt.current && t >= roundEndAt.current) {
        hostSend(nextRound(s));
      }
    } catch {
      /* 단계가 이미 바뀌었다 */
    }
  }

  useEffect(() => {
    if (!room.isHost) return;
    const iv = setInterval(hostTick, 200);
    const onVis = () => hostTick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 카운트다운 표시용 (양쪽). 게스트는 자기 시간이 다 되면 호스트를 한 번 깨운다
  useEffect(() => {
    const iv = setInterval(() => {
      setNow(Date.now());
      if (room.isHost) return;
      const d = deadline;
      if (d !== null && Date.now() >= d && tickSentFor.current !== d) {
        tickSentFor.current = d;
        room.send({ t: 'tick' } satisfies NetMsg);
      }
    }, 200);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  // 왕복 지연 측정 (호스트) — 버저 선점 보정에 쓴다
  useEffect(() => {
    if (!room.isHost) return;
    let id = 0;
    const iv = setInterval(() => {
      id += 1;
      pingAt.current.set(id, Date.now());
      room.send({ t: 'ping', id } satisfies NetMsg);
    }, PING_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** (호스트) 선공을 뽑아 양쪽에 동전을 띄운다 */
  function tossFirst(): PlayerId {
    const first: PlayerId = Math.random() < 0.5 ? 0 : 1;
    lastToss.current = first;
    room.send({ t: 'toss', first } satisfies NetMsg);
    setToss(first);
    return first;
  }

  useEffect(() => {
    const offMsg = room.onMsg((raw) => {
      const msg = raw as NetMsg;
      if (msg.t === 'toss') {
        setToss(msg.first);
        return;
      }
      // 호스트가 게스트 입장 전에 보낸 동전은 버려지므로 다시 알린다
      if (room.isHost && msg.t === 'ready' && lastToss.current !== null) {
        room.send({ t: 'toss', first: lastToss.current } satisfies NetMsg);
      }
      if (room.isHost) {
        // 어떤 메시지든 도착했다는 건 시계를 확인할 기회다 (탭 억제 대비)
        hostTick();
        switch (msg.t) {
          case 'ready':
            if (stateRef.current) {
              const end = currentEnd(stateRef.current);
              room.send({
                t: 'state',
                s: viewFor(stateRef.current),
                endsInMs: end === null ? null : end - Date.now(),
              } satisfies NetMsg);
            }
            return;
          case 'num':
            hostNum(1, msg.n);
            return;
          case 'buzz':
            // 도착 시각에서 편도 지연을 빼 실제로 누른 시각을 복원한다
            hostBuzz(1, Date.now() - oneWay.current);
            return;
          case 'answer':
            hostAnswer(1, msg.text);
            return;
          case 'skip':
            hostSkip(1, msg.on);
            return;
          case 'tick':
            return; // hostTick()은 이미 위에서 호출했다
          case 'pong': {
            const sent = pingAt.current.get(msg.id);
            if (sent === undefined) return;
            pingAt.current.delete(msg.id);
            const half = (Date.now() - sent) / 2;
            oneWay.current = oneWay.current === 0 ? half : Math.min(oneWay.current, half);
            return;
          }
        }
        return;
      }
      switch (msg.t) {
        case 'state':
          stateRef.current = msg.s;
          setState(msg.s);
          setDeadline(msg.endsInMs === null ? null : Date.now() + msg.endsInMs);
          if (msg.s.phase !== 'answer') setAnsInput('');
          return;
        case 'skipstate':
          setSkipWant(msg.want);
          return;
        case 'ping':
          room.send({ t: 'pong', id: msg.id } satisfies NetMsg);
          return;
      }
    });
    const offPeers = room.onPeers((c) => {
      if (c === 0) setOppLeft(true);
    });
    if (room.isHost) hostSend(createGame(tossFirst()));
    else room.send({ t: 'ready' } satisfies NetMsg);
    return () => {
      offMsg();
      offPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exit() {
    room.leave();
    onExit();
  }

  function myNum() {
    const n = parseInt(numInput, 10);
    if (!Number.isFinite(n)) return;
    if (room.isHost) hostNum(0, n);
    else room.send({ t: 'num', n } satisfies NetMsg);
    setNumInput('');
  }

  function myBuzz() {
    if (room.isHost) hostBuzz(0, Date.now());
    else room.send({ t: 'buzz' } satisfies NetMsg);
  }

  function myAnswer() {
    if (!ansInput.trim()) return;
    if (room.isHost) hostAnswer(0, ansInput);
    else room.send({ t: 'answer', text: ansInput } satisfies NetMsg);
    setAnsInput('');
  }

  function toggleSkip() {
    const on = !skipWant[me];
    if (room.isHost) hostSkip(0, on);
    else {
      setSkipWant((w) => {
        const n: [boolean, boolean] = [...w];
        n[me] = on;
        return n;
      });
      room.send({ t: 'skip', on } satisfies NetMsg);
    }
  }

  if (toss !== null) {
    return (
      <CoinToss
        first={toss === me ? 0 : 1}
        labels={['나', '상대']}
        onDone={() => setToss(null)}
      />
    );
  }

  if (!state) {
    return (
      <div className="hf-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const remainSec = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : WINDOW_SECONDS;
  const answerRemain = deadline ? Math.max(0, (deadline - now) / 1000) : ANSWER_SECONDS;
  const myNumTurn = (state.phase === 'num1' || state.phase === 'num2') && numTurn(state) === me;

  return (
    <div className="hf-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="hf-status">
        <div className={`hf-score me ${state.answerer === me ? 'answering' : ''}`}>
          나 <b>{state.scores[me]}</b>점
        </div>
        <div className="hf-round">
          라운드 {Math.min(state.round, ROUNDS)}/{ROUNDS}
          {state.round > ROUNDS && ' (연장)'}
        </div>
        <div className={`hf-score ai ${state.answerer === opp ? 'answering' : ''}`}>
          상대 <b>{state.scores[opp]}</b>점
        </div>
      </div>

      <ProblemBar X={state.X} Y={state.Y} />

      <HintList hints={state.hints} />

      <div className="hf-controls">
        {state.phase === 'gameover' ? null : state.phase === 'roundend' && state.lastRound ? (
          <div className="hf-roundend">
            <p className="hf-reveal">
              {state.lastRound.winner === null
                ? '아무도 규칙을 간파하지 못했습니다'
                : state.lastRound.winner === me
                  ? '🎉 정답! +1점'
                  : '상대가 정답을 맞혔습니다'}
            </p>
            <p className="hf-rule-reveal">
              규칙: <b>{state.lastRound.ruleDesc}</b> · 정답 <b>{state.lastRound.answer}</b>
            </p>
            <p className="hf-msg">{remainSec}초 뒤 다음 라운드…</p>
          </div>
        ) : state.phase === 'num1' || state.phase === 'num2' ? (
          myNumTurn ? (
            <div className="hf-numform">
              <p className="hf-prompt">
                {state.phase === 'num1' ? '힌트의 앞 수' : `힌트의 뒤 수 (${state.num1} ? □)`}를
                제시하세요 (0 제외)
              </p>
              <div className="hf-input-row">
                <input
                  type="number"
                  min={1}
                  value={numInput}
                  onChange={(e) => setNumInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && myNum()}
                  placeholder="1~999999"
                />
                <button className="primary-btn" onClick={myNum}>제시</button>
              </div>
            </div>
          ) : (
            <p className="hf-msg">
              상대가 수를 고르는 중…{state.num1 !== null && ` (${state.num1} ? □)`}
            </p>
          )
        ) : state.phase === 'window' ? (
          <div className="hf-window">
            <div className="hf-timer">
              <div
                className="hf-timer-bar"
                style={{ width: `${(remainSec / WINDOW_SECONDS) * 100}%` }}
              />
              <span className="hf-timer-num">{remainSec}s</span>
            </div>
            <div className="hf-btn-row">
              <button className="buzzer" disabled={state.wrongBuzzed[me]} onClick={myBuzz}>
                🔔 버저!
              </button>
              <button
                className={skipWant[me] ? 'primary-btn' : 'ghost-btn'}
                onClick={toggleSkip}
              >
                다음 힌트 {skipWant[me] ? '취소' : ''}
              </button>
            </div>
            {skipWant[opp] && !skipWant[me] && (
              <p className="hf-hint-msg">상대가 다음 힌트를 원합니다 — 동의하면 넘어갑니다</p>
            )}
            {skipWant[me] && !skipWant[opp] && (
              <p className="hf-hint-msg">상대의 동의를 기다리는 중…</p>
            )}
            {state.wrongBuzzed[me] && (
              <p className="hf-hint-msg">오답 — 이번 힌트에선 다시 누를 수 없습니다</p>
            )}
            {state.wrongBuzzed[opp] && <p className="hf-hint-msg">상대가 오답을 냈습니다! (−1점)</p>}
          </div>
        ) : state.phase === 'answer' ? (
          state.answerer === me ? (
            <div className="hf-numform">
              <p className="hf-prompt">정답: <b>{state.X} ? {state.Y}</b> = ?</p>
              <AnswerClock remain={answerRemain} />
              <div className="hf-input-row">
                <input
                  autoFocus
                  value={ansInput}
                  onChange={(e) => setAnsInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && myAnswer()}
                  placeholder="정답 입력"
                />
                <button className="primary-btn" onClick={myAnswer}>제출</button>
              </div>
            </div>
          ) : (
            <div className="hf-numform">
              <p className="hf-msg ai-buzz">🔔 상대가 먼저 버저를 눌렀습니다 — 답하는 중…</p>
              <AnswerClock remain={answerRemain} />
            </div>
          )
        ) : null}
      </div>

      {state.result && (
        <div className="hf-endcard-overlay">
          <div className="hf-endcard">
            <h3>{state.result.winner === me ? '승리!' : '패배…'}</h3>
            <p>
              최종 승점 {state.scores[me]} : {state.scores[opp]}
              {state.result.winner === me ? ' — 규칙을 지배했습니다' : ' — 상대의 추론이 앞섰습니다'}
            </p>
            <div className="end-actions">
              {room.isHost ? (
                <button
                  className="primary-btn"
                  onClick={() => {
                    windowKey.current = '';
                    hostSend(createGame(tossFirst()));
                  }}
                >
                  다시 대전
                </button>
              ) : (
                <p className="online-hint">호스트가 재대결을 시작할 수 있습니다</p>
              )}
              <button className="ghost-btn" onClick={exit}>로비로</button>
            </div>
          </div>
        </div>
      )}

      {oppLeft && !state.result && (
        <div className="online-notice-overlay">
          <div className="online-notice">
            <p>상대의 연결이 끊어졌습니다</p>
            <button className="primary-btn" onClick={exit}>로비로</button>
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
      <span className="game-title">히든 포뮬러 · 온라인</span>
    </header>
  );
}
