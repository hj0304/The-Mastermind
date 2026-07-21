import { useEffect, useRef, useState } from 'react';
import type { MoveOption, PlayerId, YState } from './engine.ts';
import {
  GOAL,
  HOME,
  STEP_NAME,
  applyMove,
  createGame,
  moveOptions,
  resolveThrow,
} from './engine.ts';
import { PlayerTray } from './tray.tsx';
import YutBoard from '../shared/YutBoard.tsx';
import type { BoardPiece } from '../shared/YutBoard.tsx';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { makeCommitment, verifyCommitment } from '../../net/commit.ts';
import './yut.css';
import '../../net/online.css';

/**
 * 윷 대전 온라인 대전 — 호스트 권위 + 커밋-리빌.
 *
 * 이 게임은 **동시 선택**이다: 양쪽이 각자 앞면 0~2개를 고르고 그 합으로 윷 결과가
 * 정해진다. 그런데 호스트 권위만으로는 게스트의 선택 메시지가 호스트에게 먼저
 * 도착하므로, 호스트가 그 값을 보고 자기 선택을 정할 수 있다(동시성 파괴).
 *
 * 그래서 선택은 커밋-리빌로 주고받는다(net/commit.ts):
 *   1) 각자 선택을 해시로 커밋해 전송 — 값은 알 수 없다
 *   2) 양쪽 커밋이 모이면 각자 값과 salt를 공개하고 해시를 검증
 *   3) 호스트가 검증된 두 값으로 resolveThrow를 실행하고 결과를 동기화
 *
 * 이동은 turn인 쪽만 수행하며, 판 상태는 전부 공개 정보라 그대로 복제 전송한다.
 */

interface Reveal {
  picks: [number, number];
  steps: number;
  again: boolean;
  mover: PlayerId;
}

type YAction = { k: 'move'; opt: MoveOption };

type NetMsg =
  /** 선공 동전 결과 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' }
  | { t: 'state'; s: YState }
  /** 선택 해시 (값은 감춰져 있다) */
  | { t: 'commit'; h: string }
  /** 양쪽 커밋이 모인 뒤의 값 공개 */
  | { t: 'open'; n: number; salt: string }
  /** 결과 연출 동기화 — 그 뒤 상태가 따라온다 */
  | { t: 'reveal'; r: Reveal }
  | { t: 'act'; a: YAction };

export default function YutTacticsOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;

  const stateRef = useRef<YState | null>(null);
  const [state, setState] = useState<YState | null>(null);
  const [selectedStep, setSelectedStep] = useState(0);
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [myPickSent, setMyPickSent] = useState(false);
  const [oppLeft, setOppLeft] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);

  /** 이번 던지기의 커밋-리빌 진행 상황 */
  const round = useRef<{
    myPick: number | null;
    mySalt: string;
    myHash: string;
    oppHash: string | null;
    myOpened: boolean;
    oppPick: number | null;
  }>({ myPick: null, mySalt: '', myHash: '', oppHash: null, myOpened: false, oppPick: null });

  function resetRound() {
    round.current = {
      myPick: null,
      mySalt: '',
      myHash: '',
      oppHash: null,
      myOpened: false,
      oppPick: null,
    };
    setMyPickSent(false);
  }

  function hostSend(next: YState) {
    stateRef.current = next;
    setState(next);
    room.send({ t: 'state', s: next } satisfies NetMsg);
  }

  /** 내 커밋과 상대 커밋이 모두 준비되면 내 값을 공개한다 */
  function maybeOpen() {
    const r = round.current;
    if (r.myPick === null || r.oppHash === null || r.myOpened) return;
    r.myOpened = true;
    room.send({ t: 'open', n: r.myPick, salt: r.mySalt } satisfies NetMsg);
    hostTryResolve();
  }

  /** (호스트 전용) 양쪽 값이 공개되면 결과를 확정하고 연출을 동기화한다 */
  function hostTryResolve() {
    if (!room.isHost) return;
    const s = stateRef.current;
    if (!s || s.result || s.phase !== 'choose') return;
    const r = round.current;
    if (r.myPick === null || r.oppPick === null || !r.myOpened) return;
    const pickPair: [number, number] = [r.myPick, r.oppPick];
    let next: YState;
    try {
      next = resolveThrow(s, pickPair);
    } catch {
      return;
    }
    resetRound();
    const info = next.lastThrow!;
    const rv: Reveal = { picks: pickPair, steps: info.steps, again: info.again, mover: info.mover };
    // 연출을 먼저 양쪽에 띄우고, 같은 시간 뒤에 상태를 반영한다
    room.send({ t: 'reveal', r: rv } satisfies NetMsg);
    setReveal(rv);
    setTimeout(() => {
      hostSend(next);
      setReveal(null);
    }, 2100);
  }

  function hostAct(actor: PlayerId, a: YAction) {
    const s = stateRef.current;
    if (!s || s.result) return;
    if (s.phase !== 'move' || s.turn !== actor) return;
    const valid = moveOptions(s).some(
      (o) => o.stepIdx === a.opt.stepIdx && o.from === a.opt.from && o.dest === a.opt.dest,
    );
    if (!valid) return;
    try {
      hostSend(applyMove(s, a.opt));
    } catch {
      // 무효 이동 무시
    }
  }

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

      // 커밋-리빌은 양쪽이 대칭으로 처리한다
      if (msg.t === 'commit') {
        round.current.oppHash = msg.h;
        maybeOpen();
        return;
      }
      if (msg.t === 'open') {
        const expected = round.current.oppHash;
        if (expected === null) return; // 커밋 없는 공개는 무시
        void verifyCommitment(expected, msg.n, msg.salt).then((ok) => {
          if (!ok) return; // 커밋과 다른 값 — 위조 시도로 보고 버린다
          round.current.oppPick = msg.n;
          hostTryResolve();
        });
        return;
      }

      if (room.isHost) {
        if (msg.t === 'ready' && stateRef.current) {
          room.send({ t: 'state', s: stateRef.current } satisfies NetMsg);
        }
        if (msg.t === 'act') hostAct(1, msg.a);
      } else {
        if (msg.t === 'state') {
          setState(msg.s);
          setSelectedStep(0);
          setSelectedFrom(null);
          setReveal(null);
          resetRound();
        }
        if (msg.t === 'reveal') setReveal(msg.r);
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

  function act(a: YAction) {
    if (room.isHost) hostAct(0, a);
    else room.send({ t: 'act', a } satisfies NetMsg);
  }

  /** 선택을 해시로 커밋해 전송한다 — 상대는 값을 알 수 없다 */
  function onPick(n: number) {
    if (!state || state.phase !== 'choose' || state.result || reveal || myPickSent) return;
    setMyPickSent(true);
    setSelectedStep(0);
    setSelectedFrom(null);
    void makeCommitment(n).then(({ hash, salt }) => {
      round.current.myPick = n;
      round.current.mySalt = salt;
      round.current.myHash = hash;
      room.send({ t: 'commit', h: hash } satisfies NetMsg);
      maybeOpen();
    });
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
      <div className="yt-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const myMovePhase = state.phase === 'move' && state.turn === me && !state.result && !reveal;
  const allOpts = myMovePhase ? moveOptions(state) : [];
  const stepIdx = selectedStep < state.pending.length ? selectedStep : 0;
  const stepOpts = allOpts.filter((o) => o.stepIdx === stepIdx);
  const fromNodes = new Set(stepOpts.map((o) => o.from));
  const destOpts = selectedFrom !== null ? stepOpts.filter((o) => o.from === selectedFrom) : [];
  const targetNodes = new Set(destOpts.map((o) => o.dest).filter((d) => d !== GOAL));
  const goalOpt = destOpts.find((o) => o.dest === GOAL);

  function doMove(o: MoveOption) {
    act({ k: 'move', opt: o });
    setSelectedStep(0);
    setSelectedFrom(null);
  }

  function onNodeClick(n: number) {
    if (!myMovePhase) return;
    if (selectedFrom !== null) {
      const hit = destOpts.find((o) => o.dest === n);
      if (hit) {
        doMove(hit);
        return;
      }
    }
    // 도착지가 하나뿐이어도 바로 옮기지 않는다 — 먼저 보여주고 유저가 확정한다
    if (fromNodes.has(n)) {
      setSelectedFrom(n === selectedFrom ? null : n);
      return;
    }
    setSelectedFrom(null);
  }

  const boardPieces: BoardPiece[] = [];
  for (const pl of [0, 1] as PlayerId[]) {
    state.pieces[pl].forEach((p, i) => {
      if (p.pos >= 0 && p.pos !== GOAL) {
        boardPieces.push({ id: `p${pl}-${i}`, player: pl, node: p.pos });
      }
    });
  }

  const lt = state.lastThrow;
  const moverName = state.turn === me ? '내' : '상대';

  return (
    <div className="yt-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="yt-status">
        <span>
          {state.result
            ? state.result.winner === null
              ? '무승부'
              : state.result.winner === me
                ? '승리!'
                : '상대 승리'
            : state.phase === 'choose'
              ? state.extraThrow
                ? `${moverName} 말 — 잡았다! 보너스 던지기`
                : state.pending.length > 0
                  ? `${moverName} 말 — 윷·모! 한 번 더 던집니다`
                  : `${moverName} 말이 움직이는 던지기`
              : state.turn === me
                ? selectedFrom !== null
                  ? '초록 칸(도착지)을 눌러 이동하세요'
                  : '움직일 말(반짝이는 칸)을 선택하세요'
                : '상대가 말을 고르는 중…'}
        </span>
        {lt && !reveal && (
          <span className="yt-throw-info">
            나 앞{lt.picks[me]} + 상대 앞{lt.picks[opp]} = <b>{STEP_NAME[lt.steps]}</b>
            {lt.passed && ' (쓸 수 있는 결과 없음 — 차례 넘김)'}
          </span>
        )}
        {state.pending.length > 0 && !reveal && (
          <div className="yt-step-chips">
            <span className="chips-label">남은 결과:</span>
            {state.pending.map((st, i) => (
              <button
                key={i}
                className={`yt-step-chip ${myMovePhase && i === stepIdx ? 'active' : ''}`}
                disabled={!myMovePhase}
                onClick={() => {
                  setSelectedStep(i);
                  setSelectedFrom(null);
                }}
              >
                {STEP_NAME[st]}
              </button>
            ))}
          </div>
        )}
      </div>

      <PlayerTray state={state} p={opp} label="상대" />

      <YutBoard
        pieces={boardPieces}
        movableNodes={
          selectedFrom === null ? new Set([...fromNodes].filter((n) => n >= 0)) : undefined
        }
        targetNodes={targetNodes}
        selectedNode={selectedFrom}
        lastDest={state.lastMoveDest ?? null}
        onNodeClick={onNodeClick}
      />

      <PlayerTray
        state={state}
        p={me}
        label="나"
        movable={myMovePhase && fromNodes.has(HOME)}
        onEnter={() => onNodeClick(HOME)}
      />

      <div className="yt-panel">
        {state.phase === 'choose' && !state.result && !reveal && (
          <>
            <span className="yt-note">
              {state.turn === me
                ? '내 말이 움직입니다 — 크게 노리세요 (단 합계 1이면 뒷도)'
                : '상대 말이 움직입니다 — 뒷도(합계 1)를 노려보세요'}
            </span>
            {myPickSent ? (
              <p className="online-wait">
                <span className="online-spinner" /> 상대의 선택을 기다리는 중…
              </p>
            ) : (
              <div className="yt-pick-btns">
                {[0, 1, 2].map((n) => (
                  <button key={n} className="yt-pick" onClick={() => onPick(n)}>
                    <span className="mini-sticks">
                      <i className={n >= 1 ? 'f' : 'b'} />
                      <i className={n >= 2 ? 'f' : 'b'} />
                    </span>
                    앞 {n}개
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {myMovePhase && goalOpt && (
          <button className="primary-btn" onClick={() => doMove(goalOpt)}>
            🏁 완주!
          </button>
        )}
        {myMovePhase && selectedFrom !== null && !goalOpt && destOpts.length > 0 && (
          <span className="yt-note dim">
            {destOpts.length > 1
              ? '갈림길 — 초록으로 표시된 도착 칸 중 하나를 누르세요'
              : '초록으로 표시된 도착 칸을 눌러 이동을 확정하세요'}
          </span>
        )}
      </div>

      {/* 윷 던지기 연출 — 양쪽이 같은 시점에 본다 */}
      {reveal && (
        <div className="yut-throw-overlay">
          <div className="yut-sticks">
            {([0, 1, 2, 3] as const).map((i) => {
              const isMine = i < 2;
              const count = isMine ? reveal.picks[me] : reveal.picks[opp];
              const front = (isMine ? i : i - 2) < count;
              return (
                <div
                  key={i}
                  className={`yut-stick ${front ? 'front' : 'back'}`}
                  style={{ ['--tilt' as string]: `${(i - 1.5) * 5}deg` }}
                >
                  <span className="stick-mark">{isMine ? '나' : '상대'}</span>
                </div>
              );
            })}
          </div>
          <div className="yut-throw-result">{STEP_NAME[reveal.steps]}!</div>
          <div className="yut-throw-sub">
            {reveal.again
              ? '윷·모 — 한 번 더 던집니다!'
              : `${reveal.mover === me ? '내' : '상대'} 말이 결과를 사용합니다`}
          </div>
        </div>
      )}

      {state.result && (
        <div className="yt-overlay">
          <div className="yt-endcard">
            <h2>
              {state.result.winner === null
                ? '무승부'
                : state.result.winner === me
                  ? '🏆 승리!'
                  : '패배…'}
            </h2>
            <p>
              {state.result.winner === null
                ? '승부를 가리지 못했습니다'
                : state.result.winner === me
                  ? '두 말이 모두 완주했습니다'
                  : '상대의 두 말이 먼저 완주했습니다'}
            </p>
            <div className="end-actions">
              {room.isHost ? (
                <button
                  className="primary-btn"
                  onClick={() => {
                    resetRound();
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
      <span className="game-title">윷 대전 · 온라인</span>
    </header>
  );
}
