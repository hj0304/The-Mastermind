import { useEffect, useRef, useState } from 'react';
import type { BState, Declaration, PlayerId, RoundRec } from './engine.ts';
import {
  DIE_FACES,
  GOAL,
  HOME,
  VALUE_NAME,
  branchOptions,
  createGame,
  declare,
  kkangTargets,
  movableFroms,
  respond,
  walkBluff,
} from './engine.ts';
import { D10Overlay, OutcomeBanner, PlayerTray } from './parts.tsx';
import YutBoard from '../shared/YutBoard.tsx';
import type { BoardPiece } from '../shared/YutBoard.tsx';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import { makeCommitment, verifyCommitment } from '../../net/commit.ts';
import './bluff.css';
import '../../net/online.css';

/**
 * 윷과 거짓말 온라인 대전 — 호스트 권위 + **분산 주사위**.
 *
 * 이 게임의 은닉 정보는 판이 아니라 주사위다. 굴린 사람만 결과를 알아야 하는데,
 * 다른 게임처럼 호스트가 주사위를 굴리면 **게스트가 굴린 차례의 값을 호스트가 알게
 * 된다**. 그러면 호스트는 게스트의 선언이 거짓인지 보고 의심 여부를 정할 수 있어
 * 게임이 성립하지 않는다. 반대로 굴린 쪽이 혼자 정하게 두면 원하는 값을 고를 수 있다.
 *
 * 그래서 주사위를 두 사람이 나눠 만든다(net/commit.ts의 커밋-리빌 활용):
 *   1) 굴리는 쪽이 난수 a(0~9)를 **해시로 커밋**해 보낸다 — 값은 알 수 없다
 *   2) 상대는 커밋을 받은 뒤에야 난수 b(0~9)를 공개로 보낸다
 *   3) 굴린 쪽만 (a+b)%10 으로 눈을 계산할 수 있다 — 상대는 a를 모르니 알 수 없다
 *   4) 의심이 들어오면 a와 salt를 공개한다 → 상대가 해시를 검증하고 눈을 재계산
 * a는 b보다 먼저 고정되고 b는 a를 모른 채 정해지므로, 어느 쪽도 결과를 조작할 수 없다.
 *
 * 그래서 호스트가 들고 있는 상태의 roll은 항상 UNKNOWN이다. 의심으로 눈이 공개되는
 * 순간에만 검증된 값을 넣어 엔진을 돌린다. 판 위 정보는 전부 공개라 그대로 복제한다.
 */

/** 호스트도 모르는 주사위 — 공개된 순간에만 실제 값이 들어간다 */
const UNKNOWN = -1;

type BAction = { k: 'declare'; d: Declaration } | { k: 'respond'; challenge: boolean };

/**
 * 주사위 절차를 라운드에 묶는 키 — `판번호#라운드`.
 * 라운드 번호만으로는 부족하다: 재대결하면 라운드가 0부터 다시 시작해,
 * 지난 판의 늦게 도착한 메시지가 새 판의 절차에 섞여 들어간다.
 */
type NetMsg =
  /** 선공 동전 결과 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' }
  | { t: 'state'; s: BState; g: number }
  /** 굴리는 쪽의 난수 커밋 */
  | { t: 'dcommit'; k: string; h: string }
  /** 커밋을 받은 상대가 보내는 공개 난수 */
  | { t: 'dnonce'; k: string; n: number }
  /** 의심이 들어왔을 때의 난수 공개 */
  | { t: 'dopen'; k: string; a: number; salt: string }
  /** (의심한 쪽 → 굴린 쪽) 공개 요청 */
  | { t: 'want-open'; k: string }
  | { t: 'act'; a: BAction };

interface Dice {
  key: string;
  round: number;
  iAmRoller: boolean;
  /** 내 난수 (굴리는 쪽일 때만) */
  a: number;
  salt: string;
  hash: string;
  /** 상대 커밋 (받는 쪽일 때만) */
  oppHash: string | null;
  /** 공개 난수 — 양쪽이 같은 값을 갖는다 */
  nonce: number | null;
  /** 계산된 눈 (굴린 쪽은 즉시, 받는 쪽은 공개 검증 후) */
  roll: number | null;
}

function freshDice(key: string, round: number, iAmRoller: boolean): Dice {
  return { key, round, iAmRoller, a: 0, salt: '', hash: '', oppHash: null, nonce: null, roll: null };
}

export default function YutBluffOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;

  const stateRef = useRef<BState | null>(null);
  const [state, setState] = useState<BState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [pendingValue, setPendingValue] = useState<number | null>(null);
  const [myRoll, setMyRoll] = useState<number | null>(null);
  const [rollAnim, setRollAnim] = useState<'mine' | 'opp' | null>(null);
  const [banner, setBanner] = useState<RoundRec | null>(null);
  const [awaitingOpen, setAwaitingOpen] = useState(false);
  const [cheat, setCheat] = useState<string | null>(null);
  const [oppLeft, setOppLeft] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);

  const dice = useRef<Dice>(freshDice('', -1, false));
  /** 몇 번째 판인지 — 호스트가 매기고 상태와 함께 보낸다 */
  const gen = useRef(0);
  /** 순서가 뒤바뀌어 먼저 도착한 메시지를 라운드가 맞을 때까지 보관 */
  const inbox = useRef<{
    commit: { k: string; h: string } | null;
    nonce: { k: string; n: number } | null;
    open: { k: string; a: number; salt: string } | null;
    want: string | null;
  }>({ commit: null, nonce: null, open: null, want: null });
  /** 의심 버튼을 누르고 상대의 공개를 기다리는 중인지 (호스트 전용) */
  const pendingChallenge = useRef(false);
  /** 공개 검증으로 알아낸 상대의 눈 — 확정된 기록과 대조한다 */
  const verified = useRef<{ round: number; roll: number } | null>(null);
  const animShownForRound = useRef(-1);
  const bannerShownForLen = useRef(0);

  function hostSend(next: BState) {
    // 호스트도 다음 주사위를 몰라야 한다 — 엔진이 굴린 값을 지운다
    const masked: BState = { ...next, roll: UNKNOWN };
    stateRef.current = masked;
    setState(masked);
    room.send({ t: 'state', s: masked, g: gen.current } satisfies NetMsg);
  }

  /** 새 라운드의 주사위 절차 시작 — 굴리는 쪽은 커밋부터 보낸다 */
  function startDiceRound(s: BState) {
    if (s.result || s.phase !== 'declare') return;
    const key = `${gen.current}#${s.round}`;
    if (dice.current.key === key) return;
    const iAmRoller = s.turn === me;
    dice.current = freshDice(key, s.round, iAmRoller);
    setMyRoll(null);
    if (iAmRoller) {
      const a = Math.floor(Math.random() * DIE_FACES.length);
      void makeCommitment(a).then(({ hash, salt }) => {
        if (dice.current.key !== key) return; // 그새 라운드가 지나갔다
        dice.current.a = a;
        dice.current.salt = salt;
        dice.current.hash = hash;
        room.send({ t: 'dcommit', k: key, h: hash } satisfies NetMsg);
        pump();
      });
    }
    pump();
  }

  /**
   * 이번 라운드에 내가 이미 보낸 것을 다시 보낸다.
   * 호스트는 게스트가 입장하기 전에 첫 커밋을 보내므로 그 메시지는 버려진다.
   */
  function resendDice() {
    const d = dice.current;
    if (d.iAmRoller && d.hash !== '') room.send({ t: 'dcommit', k: d.key, h: d.hash } satisfies NetMsg);
    if (!d.iAmRoller && d.nonce !== null) room.send({ t: 'dnonce', k: d.key, n: d.nonce } satisfies NetMsg);
  }

  /** 보관된 메시지 중 지금 처리할 수 있는 것을 처리한다 */
  function pump() {
    const d = dice.current;
    const inb = inbox.current;

    if (!d.iAmRoller) {
      // 받는 쪽: 커밋을 받은 뒤에야 난수를 공개한다 (순서가 바뀌면 상대가 결과를 조작할 수 있다)
      if (d.oppHash === null && inb.commit && inb.commit.k === d.key) {
        d.oppHash = inb.commit.h;
        const n = Math.floor(Math.random() * DIE_FACES.length);
        d.nonce = n;
        room.send({ t: 'dnonce', k: d.key, n } satisfies NetMsg);
      }
      // 상대가 눈을 공개했다 — 커밋과 대조해 검증한다
      if (inb.open && inb.open.k === d.key && d.oppHash !== null && d.nonce !== null && d.roll === null) {
        const { a, salt } = inb.open;
        const hash = d.oppHash;
        const nonce = d.nonce;
        const key = d.key;
        const round = d.round;
        void verifyCommitment(hash, a, salt).then((ok) => {
          if (dice.current.key !== key) return;
          if (!ok) {
            setCheat('상대가 공개한 주사위가 커밋과 일치하지 않습니다');
            return;
          }
          const roll = DIE_FACES[(a + nonce) % DIE_FACES.length];
          dice.current.roll = roll;
          verified.current = { round, roll };
          if (room.isHost && pendingChallenge.current) {
            pendingChallenge.current = false;
            setAwaitingOpen(false);
            hostResolveRespond(true, roll);
          }
        });
      }
    } else {
      // 굴리는 쪽: 공개 난수가 오면 비로소 내 눈이 정해진다
      if (d.nonce === null && d.hash !== '' && inb.nonce && inb.nonce.k === d.key) {
        d.nonce = inb.nonce.n;
        d.roll = DIE_FACES[(d.a + d.nonce) % DIE_FACES.length];
        setMyRoll(d.roll);
      }
      if (inb.want === d.key && d.roll !== null) {
        inbox.current.want = null;
        room.send({ t: 'dopen', k: d.key, a: d.a, salt: d.salt } satisfies NetMsg);
      }
    }
  }

  /** (호스트 전용) 검증된 눈을 넣어 응답을 확정한다 */
  function hostResolveRespond(challenge: boolean, roll: number) {
    const s = stateRef.current;
    if (!s || s.result || s.phase !== 'respond') return;
    try {
      hostSend(respond({ ...s, roll }, challenge));
    } catch {
      // 무효 응답 무시
    }
  }

  function hostAct(actor: PlayerId, a: BAction) {
    const s = stateRef.current;
    if (!s || s.result) return;
    if (a.k === 'declare') {
      if (s.phase !== 'declare' || s.turn !== actor) return;
      try {
        hostSend(declare(s, a.d));
      } catch {
        // 무효 선언 무시
      }
      return;
    }
    // 응답: 응답자는 롤러의 상대뿐이다
    if (s.phase !== 'respond' || s.turn === actor) return;
    if (!a.challenge) {
      hostResolveRespond(false, UNKNOWN);
      return;
    }
    // 의심 — 굴린 쪽이 호스트라면 자기 눈을 공개하고, 게스트라면 공개를 요청한다
    if (s.turn === me) {
      const d = dice.current;
      if (d.roll === null || d.round !== s.round) return;
      room.send({ t: 'dopen', k: d.key, a: d.a, salt: d.salt } satisfies NetMsg);
      hostResolveRespond(true, d.roll);
    }
  }

  /** 확정된 기록이 내가 검증한 눈과 같은지 대조 (호스트가 눈을 속이지 않았는지) */
  function auditRecord(s: BState) {
    const v = verified.current;
    if (!v) return;
    const rec = s.history[v.round];
    if (!rec || !rec.revealed) return;
    verified.current = null;
    if (rec.roll !== v.roll) setCheat('공개된 주사위와 판정에 쓰인 값이 다릅니다');
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
      switch (msg.t) {
        case 'dcommit':
          inbox.current.commit = { k: msg.k, h: msg.h };
          pump();
          return;
        case 'dnonce':
          inbox.current.nonce = { k: msg.k, n: msg.n };
          pump();
          return;
        case 'dopen':
          inbox.current.open = { k: msg.k, a: msg.a, salt: msg.salt };
          pump();
          return;
        case 'want-open':
          inbox.current.want = msg.k;
          pump();
          return;
      }
      if (room.isHost) {
        if (msg.t === 'ready' && stateRef.current) {
          room.send({ t: 'state', s: stateRef.current, g: gen.current } satisfies NetMsg);
          resendDice();
        }
        if (msg.t === 'act') hostAct(1, msg.a);
      } else if (msg.t === 'state') {
        auditRecord(msg.s);
        gen.current = msg.g;
        stateRef.current = msg.s;
        setState(msg.s);
        setSelected(null);
        setPendingValue(null);
        startDiceRound(msg.s);
      }
    });
    const offPeers = room.onPeers((c) => {
      if (c === 0) setOppLeft(true);
    });
    if (room.isHost) startNewGame();
    else room.send({ t: 'ready' } satisfies NetMsg);
    return () => {
      offMsg();
      offPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startNewGame() {
    const s = createGame(tossFirst(), UNKNOWN);
    gen.current += 1;
    dice.current = freshDice('', -1, false);
    inbox.current = { commit: null, nonce: null, open: null, want: null };
    pendingChallenge.current = false;
    verified.current = null;
    animShownForRound.current = -1;
    bannerShownForLen.current = 0;
    setBanner(null);
    setRollAnim(null);
    setAwaitingOpen(false);
    hostSend(s);
    startDiceRound(s);
  }

  // 호스트는 자기 상태 변화에서도 주사위 절차를 시작해야 한다
  useEffect(() => {
    if (room.isHost && state) startDiceRound(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // 연출 시퀀서: 결과 배너 → 주사위 굴림. 타이머는 취소하지 않는다
  // (의존성이 바뀔 때 취소하면 오버레이가 영영 안 사라지는 데드락이 생긴다)
  useEffect(() => {
    if (!state) return;
    let delay = 0;
    if (state.history.length > bannerShownForLen.current) {
      bannerShownForLen.current = state.history.length;
      setBanner(state.history[state.history.length - 1]);
      delay = 2000;
      setTimeout(() => setBanner(null), delay);
    }
    if (state.result || state.phase !== 'declare') return;
    if (animShownForRound.current === state.round) return;
    const mine = state.turn === me;
    if (mine && myRoll === null) return; // 내 눈이 정해질 때까지 기다린다
    animShownForRound.current = state.round;
    const dur = mine ? 2000 : 1500;
    setTimeout(() => setRollAnim(mine ? 'mine' : 'opp'), delay);
    setTimeout(() => setRollAnim(null), delay + dur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, myRoll]);

  function exit() {
    room.leave();
    onExit();
  }

  function act(a: BAction) {
    if (room.isHost) hostAct(0, a);
    else room.send({ t: 'act', a } satisfies NetMsg);
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
      <div className="yb-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const busy = !!rollAnim || !!banner || !!state.result;
  const myDeclaring = state.phase === 'declare' && state.turn === me && !busy && myRoll !== null;
  const myResponding = state.phase === 'respond' && state.turn === opp && !busy && !awaitingOpen;

  const froms = myDeclaring ? movableFroms(state, me) : [];
  const kkang = myDeclaring ? kkangTargets(state, me) : [];

  const branchDests =
    myDeclaring && selected !== null && pendingValue !== null
      ? branchOptions(selected).map((b) => ({ branch: b, dest: walkBluff(selected, pendingValue, b) }))
      : [];

  function onSelect(pos: number) {
    if (!myDeclaring) return;
    const hitBranch = branchDests.find((bd) => bd.dest === pos);
    if (hitBranch) {
      doDeclare(pendingValue!, selected!, hitBranch.branch);
      return;
    }
    if (!froms.includes(pos)) {
      setSelected(null);
      setPendingValue(null);
      return;
    }
    setSelected(pos === selected ? null : pos);
    setPendingValue(null);
  }

  function doDeclare(value: number, from: number, branch: 0 | 1) {
    act({ k: 'declare', d: { value, from, branch } });
    setSelected(null);
    setPendingValue(null);
  }

  function onValue(v: number) {
    if (selected === null) return;
    if (v === 0) {
      doDeclare(0, selected, 0);
      return;
    }
    if (branchOptions(selected).length === 1) doDeclare(v, selected, 0);
    else setPendingValue(v);
  }

  function onRespond(challenge: boolean) {
    if (!myResponding) return;
    if (room.isHost && challenge && state!.turn === opp) {
      // 게스트가 굴렸다 — 눈을 모르니 공개를 받아야 판정할 수 있다
      pendingChallenge.current = true;
      setAwaitingOpen(true);
      room.send({ t: 'want-open', k: dice.current.key } satisfies NetMsg);
      return;
    }
    act({ k: 'respond', challenge });
  }

  const last = state.history[state.history.length - 1];
  const d = state.declaration;
  const declDest = d && d.value > 0 ? walkBluff(d.from, d.value, d.branch) : null;

  const boardPieces: BoardPiece[] = [];
  for (const pl of [0, 1] as PlayerId[]) {
    state.pieces[pl].forEach((pos, i) => {
      if (pos >= 0 && pos !== GOAL) boardPieces.push({ id: `p${pl}-${i}`, player: pl, node: pos });
    });
  }

  return (
    <div className="yb-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="yb-status">
        <span>
          {state.result
            ? state.result.winner === null
              ? '무승부'
              : state.result.winner === me
                ? '승리!'
                : '상대 승리'
            : myDeclaring
              ? selected === null
                ? '내 차례 — 움직일(또는 꽝이면 제거할) 말을 고르세요'
                : pendingValue !== null
                  ? '경로를 선택하세요'
                  : '선언할 결과를 고르세요 — 거짓도 됩니다'
              : myResponding
                ? '상대의 선언 — 믿을까요, 의심할까요?'
                : awaitingOpen
                  ? '주사위 공개를 요청했습니다…'
                  : state.phase === 'respond'
                    ? '상대가 고민 중…'
                    : '상대가 주사위를 굴리는 중…'}
        </span>
        {last && (
          <span className="yb-last">
            {last.roller === me ? '나' : '상대'}:{' '}
            {last.outcome === 'kkang' && '「꽝」 선언 — 말 1개 제거'}
            {last.outcome === 'moved' &&
              `「${VALUE_NAME[last.declared]}」 믿음 · 전진${last.caught ? ' · 잡음!' : ''}${last.extra ? ' · 한 번 더' : ''}`}
            {last.outcome === 'liar-caught' &&
              `「${VALUE_NAME[last.declared]}」 의심 적중! 실제 「${VALUE_NAME[last.roll]}」 — 말 제거`}
            {last.outcome === 'wrong-challenge' &&
              `「${VALUE_NAME[last.declared]}」 의심 실패 (진실) — 의심한 쪽 말 제거${last.caught ? ' · 잡음' : ''}`}
          </span>
        )}
      </div>

      <PlayerTray state={state} p={opp} label="상대" />

      <YutBoard
        pieces={boardPieces}
        movableNodes={pendingValue === null ? new Set(froms.filter((n) => n >= 0)) : undefined}
        targetNodes={new Set(branchDests.map((bd) => bd.dest).filter((x) => x !== GOAL))}
        selectedNode={selected}
        lastDest={last?.dest !== GOAL ? last?.dest ?? null : null}
        markedNode={myResponding && d ? (d.from >= 0 ? d.from : null) : null}
        onNodeClick={onSelect}
      />

      <PlayerTray
        state={state}
        p={me}
        label="나"
        movable={myDeclaring && froms.includes(HOME)}
        selected={selected === HOME}
        onEnter={() => onSelect(HOME)}
      />

      <div className="yb-panel">
        {myDeclaring && myRoll !== null && (
          <>
            <div className="yb-secret">
              <span className="yb-secret-label">내 주사위 (비밀)</span>
              <span className={`yb-die-chip ${myRoll === 0 ? 'blank' : ''}`}>
                {VALUE_NAME[myRoll]}
              </span>
              {myRoll === 0 && (
                <span className="yb-must-lie">꽝! 인정하고 말을 버리거나, 거짓말하세요</span>
              )}
            </div>
            {pendingValue === null ? (
              <div className="yb-btns">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    className={`yb-declare ${v === myRoll ? 'truth' : ''}`}
                    disabled={selected === null}
                    onClick={() => onValue(v)}
                  >
                    {VALUE_NAME[v]} <small>{v}칸</small>
                  </button>
                ))}
                <button
                  className="yb-declare kkang"
                  disabled={selected === null || !kkang.includes(selected)}
                  onClick={() => onValue(0)}
                >
                  꽝 <small>말 제거</small>
                </button>
              </div>
            ) : (
              <>
                <span className="yb-note dim">갈림길 — 초록으로 표시된 도착 칸을 누르세요</span>
                {branchDests.some((bd) => bd.dest === GOAL) && (
                  <button
                    className="primary-btn"
                    onClick={() =>
                      doDeclare(
                        pendingValue,
                        selected!,
                        branchDests.find((bd) => bd.dest === GOAL)!.branch,
                      )
                    }
                  >
                    🏁 완주 선언!
                  </button>
                )}
              </>
            )}
          </>
        )}
        {myResponding && d && (
          <>
            <span className="yb-note">
              상대: 「<b>{VALUE_NAME[d.value]}</b>」 선언 —{' '}
              {d.from === HOME ? '새 말 진입' : '판 위 말 이동'}
              {declDest === GOAL && ' (완주!)'}
            </span>
            <div className="yb-btns">
              <button className="yb-respond accept" onClick={() => onRespond(false)}>
                믿는다
              </button>
              <button className="yb-respond challenge" onClick={() => onRespond(true)}>
                의심한다!
              </button>
            </div>
          </>
        )}
        {awaitingOpen && (
          <p className="online-wait">
            <span className="online-spinner" /> 상대의 주사위 공개를 검증하는 중…
          </p>
        )}
      </div>

      {banner && !rollAnim && <OutcomeBanner rec={banner} me={me} oppLabel="상대" />}

      {rollAnim && (
        <D10Overlay mine={rollAnim === 'mine'} value={myRoll ?? 0} oppLabel="상대" />
      )}

      {cheat && (
        <div className="online-notice-overlay">
          <div className="online-notice">
            <p>⚠️ {cheat}</p>
            <button className="primary-btn" onClick={exit}>로비로</button>
          </div>
        </div>
      )}

      {state.result && (
        <div className="yb-overlay">
          <div className="yb-endcard">
            <h2>
              {state.result.winner === null
                ? '무승부'
                : state.result.winner === me
                  ? '🏆 승리!'
                  : '패배…'}
            </h2>
            <p>{endReason(state, me)}</p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={startNewGame}>다시 대전</button>
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

function endReason(state: BState, me: PlayerId): string {
  const w = state.result?.winner;
  if (w == null) return '승부를 가리지 못했습니다';
  const crossed = state.pieces[w].filter((x) => x === GOAL).length;
  if (crossed >= 2) {
    return w === me ? '두 말이 먼저 완주했습니다!' : '상대의 두 말이 먼저 완주했습니다';
  }
  return w === me
    ? '상대의 남은 말이 2개 미만 — 전멸승입니다!'
    : '남은 말이 2개 미만이 되어 패배했습니다';
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">윷과 거짓말 · 온라인</span>
    </header>
  );
}
