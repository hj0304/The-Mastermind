import { useEffect, useRef, useState } from 'react';
import type { M2State, PlayerId } from './engine.ts';
import { bidColor, createGame, gaugeTier, play } from './engine.ts';
import { viewFor } from './view.ts';
import type { NetRoom } from '../../net/room.ts';
import { makeCommitment, verifyCommitment } from '../../net/commit.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { Gauge } from './gauge.tsx';
import './monochrome2.css';
import '../../net/online.css';

/**
 * 모노크롬 II 온라인 대전 — 호스트 권위 + 커밋-리빌 입찰.
 *
 * 이 게임의 은닉 정보는 제시액이다. 선(先)의 제시는 색(흑/백 = 자릿수)만 공개되고
 * 값은 라운드가 끝나도 비공개인데, 호스트 권위 방식에서 제시 값을 평문으로 보내면
 * 호스트가 개발자 도구로 상대 제시를 엿본 뒤 자기 제시를 정할 수 있다.
 *
 * 그래서 매 라운드 입찰을 커밋-리빌(net/commit.ts)로 진행한다:
 *   1) 선이 제시값을 해시로 커밋하고 **색만** 공개한다 (원작 규칙 그대로)
 *   2) 후는 색을 보고 자기 제시를 해시로 커밋한다
 *   3) 양쪽 커밋이 모이면 서로 값+salt를 공개하고 해시를 검증한다
 *   4) 호스트가 검증된 두 값을 엔진에 순서대로 적용해 라운드를 정산한다
 * 어느 쪽도 상대 값을 본 뒤 자기 값을 바꿀 수 없다.
 */

type NetMsg =
  /** 선공 동전 결과 + 판 번호 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId; g: number }
  | { t: 'ready' }
  | { t: 'view'; v: M2State }
  /**
   * 입찰 커밋 — 선(L)은 색과 지출 후 게이지 단계를 함께 공개, 후(F)는 해시만.
   * 게이지 단계는 원작의 공개 정보다: "포인트를 입력한 순간 표시등이 갱신되므로,
   * 선이 낮은 포인트를 쓰면 후공이 결정하기 전에 표시등이 꺼진다."
   * 신고된 단계는 라운드 정산 후 실제 뷰의 단계와 대조해 검증한다.
   */
  | { t: 'bcommit'; k: string; role: 'L' | 'F'; hash: string; color: 'black' | 'white' | null; tier: number | null }
  /** 입찰 리빌 — 양쪽 커밋이 모인 뒤에만 보낸다 */
  | { t: 'breveal'; k: string; value: number; salt: string };

/** 라운드별 커밋-리빌 진행 상태. k = `판번호#라운드`로 판을 넘긴 지연 메시지를 차단 */
interface Duel {
  k: string;
  myValue: number | null;
  mySalt: string | null;
  myHash: string | null;
  myRevealed: boolean;
  oppHash: string | null;
  oppColor: 'black' | 'white' | null;
  /** 선(상대)이 신고한 지출 후 게이지 단계 — 정산 후 검증 */
  oppTier: number | null;
  oppValue: number | null;
  /** 커밋보다 먼저 도착한 리빌 보관 (전송 순서 뒤집힘 대비) */
  pendingReveal: { value: number; salt: string } | null;
}

const emptyDuel = (k: string): Duel => ({
  k,
  myValue: null,
  mySalt: null,
  myHash: null,
  myRevealed: false,
  oppHash: null,
  oppColor: null,
  oppTier: null,
  oppValue: null,
  pendingReveal: null,
});

export default function Monochrome2Online({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<M2State | null>(null);
  const [view, setView] = useState<M2State | null>(null);
  const [bidInput, setBidInput] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [oppLeft, setOppLeft] = useState(false);
  /** 상대 리빌이 커밋 해시와 불일치 — 조작된 클라이언트 */
  const [cheat, setCheat] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);
  const prevHist = useRef(0);
  /** 현재 판 번호 (재대결마다 증가) — 라운드 키에 사용 */
  const gameNo = useRef(1);
  const duel = useRef<Duel>(emptyDuel(''));
  /** duel(ref) 변경을 화면에 반영하기 위한 트리거 */
  const [, setDuelTick] = useState(0);
  const bump = () => setDuelTick((x) => x + 1);

  function hostApply(next: M2State) {
    stateRef.current = next;
    setView(viewFor(next, 0));
    room.send({ t: 'view', v: viewFor(next, 1) } satisfies NetMsg);
  }

  /** (호스트) 선공을 뽑아 양쪽에 동전을 띄운다 */
  function tossFirst(): PlayerId {
    const first: PlayerId = Math.random() < 0.5 ? 0 : 1;
    lastToss.current = first;
    room.send({ t: 'toss', first, g: gameNo.current } satisfies NetMsg);
    setToss(first);
    return first;
  }

  /** 양쪽 커밋이 모였으면 내 값을 공개한다 */
  function maybeReveal() {
    const d = duel.current;
    if (d.myHash && d.oppHash && !d.myRevealed && d.myValue !== null && d.mySalt) {
      d.myRevealed = true;
      room.send({ t: 'breveal', k: d.k, value: d.myValue, salt: d.mySalt } satisfies NetMsg);
    }
  }

  /** (호스트) 검증된 양쪽 값을 선→후 순서로 엔진에 적용 */
  function hostTryResolve() {
    if (!room.isHost) return;
    const d = duel.current;
    const s = stateRef.current;
    if (!s || s.result || d.myValue === null || d.oppValue === null) return;
    const leaderVal = s.leader === 0 ? d.myValue : d.oppValue;
    const followerVal = s.leader === 0 ? d.oppValue : d.myValue;
    try {
      hostApply(play(play(s, leaderVal), followerVal));
    } catch {
      // 해시는 맞지만 엔진 검증 실패(보유 포인트 초과 등) — 조작된 값
      setCheat(true);
    }
  }

  async function onOppReveal(value: number, salt: string) {
    const d = duel.current;
    if (d.oppValue !== null || !d.oppHash) return;
    if (!(await verifyCommitment(d.oppHash, value, salt))) {
      setCheat(true);
      return;
    }
    d.oppValue = value;
    hostTryResolve();
    bump();
  }

  useEffect(() => {
    const offMsg = room.onMsg((raw) => {
      const msg = raw as NetMsg;
      if (msg.t === 'toss') {
        gameNo.current = msg.g;
        setToss(msg.first);
        bump();
        return;
      }
      // 호스트가 게스트 입장 전에 보낸 동전은 버려지므로 다시 알린다
      if (room.isHost && msg.t === 'ready' && lastToss.current !== null) {
        room.send({ t: 'toss', first: lastToss.current, g: gameNo.current } satisfies NetMsg);
      }
      if (room.isHost && msg.t === 'ready' && stateRef.current) {
        room.send({ t: 'view', v: viewFor(stateRef.current, 1) } satisfies NetMsg);
      }
      if (msg.t === 'bcommit') {
        const d = duel.current;
        if (msg.k !== d.k || d.oppHash !== null) return;
        d.oppHash = msg.hash;
        d.oppColor = msg.color;
        d.oppTier = msg.tier;
        if (d.pendingReveal) {
          const { value, salt } = d.pendingReveal;
          d.pendingReveal = null;
          void onOppReveal(value, salt);
        }
        maybeReveal();
        bump();
        return;
      }
      if (msg.t === 'breveal') {
        const d = duel.current;
        if (msg.k !== d.k) return;
        if (!d.oppHash) {
          d.pendingReveal = { value: msg.value, salt: msg.salt };
          return;
        }
        void onOppReveal(msg.value, msg.salt);
        return;
      }
      if (!room.isHost && msg.t === 'view') {
        setView(msg.v);
      }
    });
    const offPeers = room.onPeers((c) => {
      if (c === 0) setOppLeft(true);
    });
    if (room.isHost) hostApply(createGame(tossFirst()));
    else room.send({ t: 'ready' } satisfies NetMsg);
    return () => {
      offMsg();
      offPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 라운드가 바뀌면 커밋-리빌 상태를 새로 시작
  useEffect(() => {
    if (!view) return;
    const k = `${gameNo.current}#${view.history.length}`;
    if (duel.current.k !== k) {
      const d = duel.current;
      // 직전 라운드에 선(상대)이 신고했던 게이지 단계를 정산된 실제 단계와 대조
      if (
        d.oppTier !== null &&
        view.history.length > 0 &&
        d.k === `${gameNo.current}#${view.history.length - 1}` &&
        gaugeTier(view.points[opp]) !== d.oppTier
      ) {
        setCheat(true);
      }
      duel.current = emptyDuel(k);
      bump();
    }
  });

  // 라운드 결과 플래시
  useEffect(() => {
    if (!view) return;
    if (view.history.length > prevHist.current) {
      const r = view.history[view.history.length - 1];
      setFlash(r.winner === null ? '무승부!' : r.winner === me ? '라운드 승리!' : '라운드 패배');
      const t = setTimeout(() => setFlash(null), 1200);
      prevHist.current = view.history.length;
      return () => clearTimeout(t);
    }
    prevHist.current = view.history.length;
  }, [view, me]);

  function exit() {
    room.leave();
    onExit();
  }

  async function submitBid() {
    if (!view || view.result) return;
    const d = duel.current;
    if (d.myHash !== null) return; // 이미 제출
    const iAmLeader = view.leader === me;
    if (!iAmLeader && d.oppHash === null) return; // 후공은 선의 커밋(색 공개)을 기다린다
    const bid = Math.max(0, Math.min(bidInput, view.points[me]));
    const c = await makeCommitment(bid);
    d.myValue = bid;
    d.mySalt = c.salt;
    d.myHash = c.hash;
    room.send({
      t: 'bcommit',
      k: d.k,
      role: iAmLeader ? 'L' : 'F',
      hash: c.hash,
      color: iAmLeader ? bidColor(bid) : null,
      // 선의 지출 후 게이지 단계 공개 (원작: 제시 즉시 표시등 갱신)
      tier: iAmLeader ? gaugeTier(view.points[me] - bid) : null,
    } satisfies NetMsg);
    maybeReveal();
    setBidInput(0);
    bump();
  }

  if (toss !== null) {
    return (
      <CoinToss
        mode="show"
        first={toss === me ? 0 : 1}
        labels={['나', '상대']}
        onDone={() => setToss(null)}
      />
    );
  }

  if (!view) {
    return (
      <div className="m2-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const state = view;
  const d = duel.current;
  const iAmLeader = state.leader === me;
  /** 내가 지금 제시할 수 있는가 — 선은 즉시, 후는 선의 커밋을 받은 뒤 */
  const myTurn = !state.result && d.myHash === null && (iAmLeader || d.oppHash !== null);
  const roundNo = Math.min(state.roundInSet + 1, state.maxRounds);

  return (
    <div className="m2-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="m2-scoreboard">
        <div className="score me">나 <b>{state.scores[me]}</b></div>
        <div className="round-info">
          {state.overtime > 0 && <span className="overtime">연장 {state.overtime}</span>}
          라운드 {roundNo}/{state.maxRounds} · 5점 선취
        </div>
        <div className="score ai"><b>{state.scores[opp]}</b> 상대</div>
      </div>

      <div className="m2-gauges">
        <Gauge label="내 포인트" points={state.points[me]} exact />
        {/* 선(상대)이 제시한 순간 신고된 게이지 단계를 즉시 반영 — 원작 공개 정보 */}
        <Gauge
          label="상대 포인트"
          points={d.oppTier !== null ? d.oppTier * 20 + 10 : state.points[opp]}
        />
      </div>

      <div className="m2-table">
        {!state.result && !iAmLeader && d.oppColor !== null && d.myHash === null ? (
          <div className={`m2-bid-card ${d.oppColor}`}>
            <span className="q">?</span>
            <span className="color-name">
              {d.oppColor === 'black' ? '흑 (한 자릿수)' : '백 (두 자릿수)'}
            </span>
          </div>
        ) : !state.result && d.myHash !== null && d.myValue !== null ? (
          <div className={`m2-bid-card ${bidColor(d.myValue)}`}>
            <span>{d.myValue}</span>
            <span className="color-name">
              내 제시 — {d.oppHash === null ? '상대 응수 대기' : '정산 중…'}
            </span>
          </div>
        ) : (
          <div className="table-hint">
            {state.result ? '' : myTurn ? (iAmLeader ? '당신이 선입니다 — 포인트를 제시하세요' : '') : '상대가 고민 중…'}
          </div>
        )}
        {flash && <div className="result-flash">{flash}</div>}
      </div>

      {myTurn && !state.result && (
        <div className="m2-bid-input">
          <div className="quick-bids">
            {[0, 1, 5, 9, 10, 11, 15, 20].filter((v) => v <= state.points[me]).map((v) => (
              <button key={v} className={`quick ${bidInput === v ? 'active' : ''}`} onClick={() => setBidInput(v)}>
                {v}
              </button>
            ))}
          </div>
          <div className="bid-row">
            <input
              type="range"
              min={0}
              max={state.points[me]}
              value={bidInput}
              onChange={(e) => setBidInput(+e.target.value)}
            />
            <span className={`bid-preview ${bidInput <= 9 ? 'black' : 'white'}`}>{bidInput}</span>
            <button className="primary-btn" onClick={() => void submitBid()}>제시</button>
          </div>
          <p className="bid-note">
            {bidInput <= 9 ? '흑으로 표시됩니다 (0~9)' : '백으로 표시됩니다 (10~99)'}
          </p>
        </div>
      )}

      {/* 히스토리: 상대 숫자는 비공개 (무승부만 공개) */}
      <div className="m2-history">
        {state.history.slice(state.history.length - state.roundInSet).map((r, i) => (
          <div key={i} className={`hist-row ${r.winner === me ? 'win' : r.winner === opp ? 'lose' : 'draw'}`}>
            <span className="hist-round">R{i + 1}</span>
            <span className={`hist-bid ${bidColor(r.bids[me])}`}>{r.bids[me]}</span>
            <span className="hist-vs">vs</span>
            <span className={`hist-bid ${bidColor(r.bids[opp])}`}>
              {r.winner === null ? r.bids[opp] : '?'}
            </span>
            <span className="hist-result">{r.winner === me ? '승' : r.winner === opp ? '패' : '무'}</span>
          </div>
        ))}
      </div>

      {state.result && (
        <div className="m2-overlay">
          <div className="m2-endcard">
            <h2>
              {state.result.winner === null ? '무승부' : state.result.winner === me ? '🏆 승리!' : '패배…'}
            </h2>
            <p>{state.scores[me]} : {state.scores[opp]}</p>
            <div className="end-actions">
              {room.isHost ? (
                <button
                  className="primary-btn"
                  onClick={() => {
                    prevHist.current = 0;
                    gameNo.current += 1;
                    hostApply(createGame(tossFirst()));
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

      {cheat && (
        <div className="online-notice-overlay">
          <div className="online-notice">
            <p>상대 제시의 검증에 실패했습니다 — 조작된 클라이언트일 수 있습니다</p>
            <button className="primary-btn" onClick={exit}>로비로</button>
          </div>
        </div>
      )}

      {oppLeft && !state.result && !cheat && (
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
      <span className="game-title">모노크롬 II · 온라인</span>
    </header>
  );
}
