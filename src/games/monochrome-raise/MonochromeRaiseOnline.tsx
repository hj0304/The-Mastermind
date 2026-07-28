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
import { viewFor } from './view.ts';
import { MoodPills, MoodScope, PkOverlay, useMood } from '../shared/pokerui.tsx';
import { ArrangeBoard, RaiseTileFace, RaiseTileFlip, TrackStrip } from './raiseui.tsx';
import type { NetRoom } from '../../net/room.ts';
import { makeDataCommitment, verifyDataCommitment } from '../../net/commit.ts';
import ChatPanel from '../../net/ChatPanel.tsx';
import './raise.css';
import '../../net/online.css';

/**
 * 모노크롬 레이즈 온라인 대전 — 호스트 권위 + 설계 커밋-리빌.
 *
 * 배치 단계가 있어 흐름이 두 층이다: 양쪽이 각자 타일 순서와 칩 배분을 설계하고,
 * 둘 다 준비되면 호스트가 대국을 시작한다.
 *
 * 설계(특히 타일 순서)는 은닉 정보라 평문으로 보내면 호스트가 상대 설계를 본 뒤
 * 자기 설계를 맞출 수 있다. 그래서 커밋-리빌(net/commit.ts)로 진행한다:
 *   1) 각자 설계를 확정하면 해시만 서로 보낸다
 *   2) 게스트는 호스트의 커밋을 받은 뒤에야 설계를 공개한다 (호스트가 검증 후 시작)
 *   3) 호스트의 설계는 대국 내내 비공개이므로, 게임이 끝날 때 공개한다 —
 *      게스트가 해시를 검증해 호스트가 시작 전에 설계를 고정했음을 확인한다
 */

type RAction = { k: 'decide'; action: 'call' | 'fold' } | { k: 'next' };

type NetMsg =
  | { t: 'ready' }
  /** 설계 커밋 — 설계 내용 대신 해시만 */
  | { t: 'scommit'; who: 'host' | 'guest'; hash: string }
  /** 설계 리빌 — 게스트는 시작 전(호스트 커밋 후), 호스트는 게임 종료 시 */
  | { t: 'sreveal'; who: 'host' | 'guest'; s: RaiseSetup; salt: string }
  | { t: 'view'; v: RaiseState }
  | { t: 'act'; a: RAction };

export default function MonochromeRaiseOnline({
  room,
  onExit,
}: {
  room: NetRoom;
  onExit: () => void;
}) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;

  const [mySetup, setMySetup] = useState<RaiseSetup>(randomSetup);
  const [submitted, setSubmitted] = useState(false);
  const [view, setView] = useState<RaiseState | null>(null);
  const [mood, setMood] = useMood();
  const [oppLeft, setOppLeft] = useState(false);
  /** 상대 리빌이 커밋 해시와 불일치 — 조작된 클라이언트 */
  const [cheat, setCheat] = useState(false);

  const stateRef = useRef<RaiseState | null>(null);
  const setups = useRef<{ host: RaiseSetup | null; guest: RaiseSetup | null }>({
    host: null,
    guest: null,
  });
  /** 커밋-리빌 진행 상태 (메시지 핸들러에서 접근하므로 ref) */
  const mySubmitted = useRef<RaiseSetup | null>(null);
  const mySalt = useRef<string | null>(null);
  const myHash = useRef<string | null>(null);
  const oppHash = useRef<string | null>(null);
  const myRevealed = useRef(false);

  const chipsUsed = mySetup.bets.reduce((a, b) => a + b, 0);

  function hostApply(next: RaiseState) {
    stateRef.current = next;
    setView(viewFor(next, 0));
    room.send({ t: 'view', v: viewFor(next, 1) } satisfies NetMsg);
    // 게임 종료 — 호스트 설계를 공개해 시작 전에 고정돼 있었음을 증명한다
    if (next.result && !myRevealed.current && room.isHost && mySubmitted.current && mySalt.current) {
      myRevealed.current = true;
      room.send({ t: 'sreveal', who: 'host', s: mySubmitted.current, salt: mySalt.current } satisfies NetMsg);
    }
  }

  /** (게스트) 내 커밋을 보냈고 호스트 커밋도 받았으면 설계를 공개한다 */
  function guestMaybeReveal() {
    if (room.isHost || myRevealed.current) return;
    if (mySubmitted.current && mySalt.current && oppHash.current) {
      myRevealed.current = true;
      room.send({ t: 'sreveal', who: 'guest', s: mySubmitted.current, salt: mySalt.current } satisfies NetMsg);
    }
  }

  function hostTryStart() {
    const { host, guest } = setups.current;
    if (!host || !guest || stateRef.current) return;
    hostApply(createGame(host, guest));
  }

  function hostAct(s: RaiseState, actor: PlayerId, a: RAction): RaiseState | null {
    try {
      if (a.k === 'next') {
        return s.phase === 'result' ? nextRound(s) : null;
      }
      if (s.phase !== 'decision' || s.toDecide !== actor) return null;
      return decide(s, a.action);
    } catch {
      return null;
    }
  }

  useEffect(() => {
    const offMsg = room.onMsg((raw) => {
      const msg = raw as NetMsg;
      if (msg.t === 'scommit') {
        const fromOpp = room.isHost ? msg.who === 'guest' : msg.who === 'host';
        if (fromOpp && oppHash.current === null) {
          oppHash.current = msg.hash;
          guestMaybeReveal();
        }
        return;
      }
      if (msg.t === 'sreveal') {
        void (async () => {
          if (!oppHash.current) return; // 커밋 없이 온 리빌 — 검증 불가
          const ok = await verifyDataCommitment(oppHash.current, JSON.stringify(msg.s), msg.salt);
          if (!ok) {
            setCheat(true);
            return;
          }
          if (room.isHost && msg.who === 'guest') {
            setups.current.guest = msg.s;
            hostTryStart();
          }
          // 게스트가 받는 호스트 리빌은 검증만으로 충분 (설계가 시작 전 고정이었음을 확인)
        })();
        return;
      }
      if (room.isHost) {
        if (msg.t === 'ready') {
          if (stateRef.current) {
            room.send({ t: 'view', v: viewFor(stateRef.current, 1) } satisfies NetMsg);
          }
          // 게스트가 내 커밋을 못 받은 채 입장했을 수 있으니 다시 알린다
          if (myHash.current) {
            room.send({ t: 'scommit', who: 'host', hash: myHash.current } satisfies NetMsg);
          }
        }
        if (msg.t === 'act' && stateRef.current) {
          const next = hostAct(stateRef.current, 1, msg.a);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'view') {
        setView(msg.v);
      }
    });
    const offPeers = room.onPeers((c) => {
      if (c === 0) setOppLeft(true);
    });
    if (!room.isHost) room.send({ t: 'ready' } satisfies NetMsg);
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

  async function submitSetup() {
    if (chipsUsed !== TOTAL_CHIPS || mySubmitted.current) return;
    setSubmitted(true);
    mySubmitted.current = mySetup;
    const c = await makeDataCommitment(JSON.stringify(mySetup));
    mySalt.current = c.salt;
    myHash.current = c.hash;
    room.send({ t: 'scommit', who: room.isHost ? 'host' : 'guest', hash: c.hash } satisfies NetMsg);
    if (room.isHost) {
      setups.current.host = mySetup;
      hostTryStart();
    } else {
      guestMaybeReveal();
    }
  }

  function act(a: RAction) {
    if (room.isHost) {
      const s = stateRef.current;
      if (!s) return;
      const next = hostAct(s, 0, a);
      if (next) hostApply(next);
    } else {
      room.send({ t: 'act', a } satisfies NetMsg);
    }
  }

  const notices = (
    <>
      {cheat && (
        <div className="online-notice-overlay">
          <div className="online-notice">
            <p>상대 설계의 검증에 실패했습니다 — 조작된 클라이언트일 수 있습니다</p>
            <button className="primary-btn" onClick={exit}>로비로</button>
          </div>
        </div>
      )}
      {oppLeft && !cheat && !view?.result && (
        <div className="online-notice-overlay">
          <div className="online-notice">
            <p>상대의 연결이 끊어졌습니다</p>
            <button className="primary-btn" onClick={exit}>로비로</button>
          </div>
        </div>
      )}
    </>
  );

  // ---------- 배치 단계 ----------
  if (!view) {
    return (
      <MoodScope mood={mood}>
        <div className="pk-col">
          <GameHeader onExit={exit} />
          <div className="online-status">
            <span className={`dot ${oppLeft ? 'off' : ''}`} />
            방 {room.code} · {room.isHost ? '호스트' : '게스트'}
          </div>
          <div className="pk-handrow">SETUP</div>
          <ArrangeBoard setup={mySetup} onChange={setMySetup} disabled={submitted} />
          <div className="pk-panel">
            {!submitted ? (
              <>
                <div className="pk-status">
                  타일을 탭해 선택하고, 다른 타일을 탭하면 순서(칩 포함)를 교환합니다.
                  <br />
                  배치는 커밋-리빌로 고정됩니다 — 상대는 시작 전 내 설계를 볼 수 없습니다.
                </div>
                <div className="pk-actions" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
                  <button className="pk-btn fold" onClick={() => setMySetup(randomSetup())}>
                    다시 섞기
                  </button>
                  <button
                    className="pk-btn ac"
                    disabled={chipsUsed !== TOTAL_CHIPS}
                    onClick={() => void submitSetup()}
                  >
                    {chipsUsed === TOTAL_CHIPS ? '이 설계로 대전 시작' : `칩 ${TOTAL_CHIPS - chipsUsed}개 더 분배`}
                  </button>
                </div>
              </>
            ) : (
              <div className="pk-thinking">상대가 설계를 마치면 시작합니다…</div>
            )}
          </div>
          <MoodPills mood={mood} onMood={setMood} />
          {notices}
          <ChatPanel room={room} />
        </div>
      </MoodScope>
    );
  }

  // ---------- 대국 ----------
  const state = view;
  const r = Math.min(state.round, 9);
  const last = state.history[state.history.length - 1];
  const showResult = state.phase === 'result' && last;
  const myDecision = state.phase === 'decision' && state.toDecide === me;
  const oppDeciding = state.phase === 'decision' && state.toDecide === opp;
  const need = myDecision ? state.bets[opp][r] - state.bets[me][r] : 0;
  const oppBet = showResult ? last.finalBets[opp] : state.bets[opp][r];
  const myBet = showResult ? last.finalBets[me] : state.bets[me][r];
  const revealNow = !!showResult && last.revealed && last.round === r;

  const panel = (
    <>
      {oppDeciding && <div className="pk-thinking">상대가 콜/폴드를 고민 중…</div>}
      {myDecision && (
        <>
          <div className="pk-status">
            상대가 <b>{state.bets[opp][r]}</b>개를 걸었습니다 — 콜하려면 <b>+{need}</b> (스태시{' '}
            {Math.min(state.stash[me], need)}
            {need > state.stash[me] ? ` + 뒤 타일 차출 ${need - state.stash[me]}` : ''})
            <br />
            폴드하면 타일을 공개하지 않고 베팅 칩을 내줍니다
          </div>
          <div className="pk-actions two">
            <button className="pk-btn fold" onClick={() => act({ k: 'decide', action: 'fold' })}>
              폴드
            </button>
            <button
              className="pk-btn ac"
              disabled={maxCallable(state, me) < need}
              onClick={() => act({ k: 'decide', action: 'call' })}
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
              `무승부 (${last.tiles[me]} : ${last.tiles[opp]}) — 각자 회수`}
            {last.outcome === 'showdown' &&
              (last.winner === me
                ? `승리! ${last.tiles[me]} > ${last.tiles[opp]} — 팟 ${last.pot}개`
                : `패배… ${last.tiles[me]} < ${last.tiles[opp]} — 상대가 ${last.pot}개`)}
            {last.outcome === 'fold' &&
              (last.folder === me
                ? `폴드 — 상대가 ${last.pot}개 획득 (타일 비공개)`
                : `상대 폴드 — ${last.pot}개 획득! (타일 비공개)`)}
          </div>
          <button className="pk-btn ac next" onClick={() => act({ k: 'next' })}>
            {state.round >= 9 ? '최종 결과' : '다음 라운드'}
          </button>
        </div>
      )}
    </>
  );

  return (
    <MoodScope mood={mood}>
      <div className="pk-col">
        <GameHeader onExit={exit} />
        <div className="online-status">
          <span className={`dot ${oppLeft ? 'off' : ''}`} />
          방 {room.code} · {room.isHost ? '호스트' : '게스트'}
        </div>
        <div className="pk-handrow">ROUND {String(r + 1).padStart(2, '0')}/10</div>

        <div className="pk-seat">
          <div className="pk-seat-left">
            {oppDeciding && <span className="pk-dot" />}
            <span className="pk-seat-name">상대</span>
          </div>
          <div className="pk-seat-right">
            <span className="k">스태시</span>
            <span className="v">{state.stash[opp]}</span>
            <span className="rz-goal">/31 목표</span>
          </div>
        </div>

        <TrackStrip state={state} me={me} />

        <div className="rz-duel">
          <div className="rz-zone">
            <RaiseTileFlip value={state.order[opp][r]} revealed={revealNow} />
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
            <RaiseTileFace value={state.order[me][r]} />
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
            <span className="v">{state.stash[me]}</span>
            <span className="rz-goal">/31 목표</span>
          </div>
        </div>

        <div className="pk-panel">{panel}</div>
        <MoodPills mood={mood} onMood={setMood} />

        {state.result && (
          <PkOverlay
            title={state.result.winner === null ? '무승부' : state.result.winner === me ? '🏆 승리!' : '패배…'}
            sub={`최종 스태시 — 나 ${state.stash[me]} : 상대 ${state.stash[opp]}`}
          >
            <div className="end-actions">
              <button className="ghost-btn" onClick={exit}>로비로</button>
            </div>
          </PkOverlay>
        )}
        {notices}
        <ChatPanel room={room} />
      </div>
    </MoodScope>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">모노크롬 레이즈 · 온라인</span>
    </header>
  );
}
