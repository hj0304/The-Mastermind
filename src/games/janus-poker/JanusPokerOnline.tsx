import { useEffect, useRef, useState } from 'react';
import type { Face, JPAction, JPState, PlayerId } from './engine.ts';
import { applyAction, callCost, createGame, maxLevelFor, nextHand } from './engine.ts';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import './janus.css';
import '../../net/online.css';

/**
 * 야누스 포커 온라인 대전 — 호스트 권위 방식.
 * 게스트에게는 덱을 비우고 상대 뒷면을 가린(공개 조건 충족 전) 뷰만 전송한다.
 */

const FACE_NAME: Record<Face, string> = { front: '앞면', back: '뒷면', both: '양면' };

/** 관점 뷰: 덱 제거 + 상대 뒷면은 공개 조건 충족 시에만 실값 */
interface JPView {
  s: JPState;
  oppBackRevealed: boolean;
}

type NetMsg =
  /** 선공 동전 결과 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' }
  | { t: 'view'; v: JPView }
  | { t: 'act'; a: JPAction | { kind: 'next' } };

function viewOf(s: JPState, seat: PlayerId): JPView {
  const opp = (1 - seat) as PlayerId;
  const revealed =
    s.phase !== 'act' &&
    s.lastResult !== null &&
    s.lastResult.reason !== 'fold' &&
    s.faces[opp] !== 'front';
  const cards = [s.cards[0], s.cards[1]] as JPState['cards'];
  cards[opp] = { front: cards[opp].front, back: revealed ? cards[opp].back : 0 };
  return { s: { ...s, deck: [], cards }, oppBackRevealed: revealed };
}

export default function JanusPokerOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  const opp: PlayerId = (1 - me) as PlayerId;
  const stateRef = useRef<JPState | null>(null);
  const [view, setView] = useState<JPView | null>(null);
  const [pickedFace, setPickedFace] = useState<Face | null>(null);
  const [level, setLevel] = useState(1);
  const [peek, setPeek] = useState(false);
  const [oppLeft, setOppLeft] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);
  const handRef = useRef(0);

  function hostApply(next: JPState) {
    stateRef.current = next;
    setView(viewOf(next, 0));
    room.send({ t: 'view', v: viewOf(next, 1) } satisfies NetMsg);
  }

  function hostAct(s: JPState, actor: PlayerId, a: JPAction | { kind: 'next' }): JPState | null {
    try {
      if (a.kind === 'next') {
        return s.phase === 'handover' ? nextHand(s) : null;
      }
      if (s.phase !== 'act' || s.turn !== actor || s.result) return null;
      return applyAction(s, a);
    } catch {
      return null;
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
      if (room.isHost) {
        if (msg.t === 'ready' && stateRef.current) {
          room.send({ t: 'view', v: viewOf(stateRef.current, 1) } satisfies NetMsg);
        }
        if (msg.t === 'act' && stateRef.current) {
          const next = hostAct(stateRef.current, 1, msg.a);
          if (next) hostApply(next);
        }
      } else if (msg.t === 'view') {
        setView(msg.v);
      }
    });
    const offPeers = room.onPeers((count) => {
      if (count === 0) setOppLeft(true);
    });
    if (room.isHost) {
      hostApply(createGame(tossFirst()));
    } else {
      room.send({ t: 'ready' } satisfies NetMsg);
    }
    return () => {
      offMsg();
      offPeers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 새 핸드 → 로컬 UI 상태 초기화
  useEffect(() => {
    if (!view) return;
    if (view.s.handNo !== handRef.current) {
      handRef.current = view.s.handNo;
      setPickedFace(null);
      setPeek(false);
      setLevel(1);
    }
  }, [view]);

  const s = view?.s ?? null;
  const myTurn = !!s && s.phase === 'act' && s.turn === me && !s.result;
  const firstAction = myTurn && s!.faces[me] === null;
  const minL = s ? Math.max(1, s.level) : 1;
  const cap = s && myTurn ? maxLevelFor(s, me, pickedFace ?? s.faces[me] ?? 'front') : 0;

  useEffect(() => {
    if (!s) return;
    setLevel((l) => Math.min(Math.max(l, minL), Math.max(cap, minL)));
  }, [s, minL, cap]);

  function exit() {
    room.leave();
    onExit();
  }

  function act(a: JPAction | { kind: 'next' }) {
    if (room.isHost) {
      const cur = stateRef.current;
      if (!cur) return;
      const next = hostAct(cur, 0, a);
      if (next) hostApply(next);
    } else {
      room.send({ t: 'act', a } satisfies NetMsg);
    }
    if (a.kind !== 'next') setPickedFace(null);
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

  if (!s) {
    return (
      <div className="jp-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const my = s.cards[me];
  const oppCard = s.cards[opp];
  const r = s.lastResult;
  const showResult = s.phase !== 'act' && r !== null;
  const oppBackRevealed = view!.oppBackRevealed;

  return (
    <div className="jp-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="jp-status">
        <div className="jp-stack me">나 <b>{s.stacks[me]}</b>칩</div>
        <div className="jp-pot">
          <span className="pot-label">팟</span>
          <b>{s.phase === 'act' ? s.paid[0] + s.paid[1] + s.carry : s.carry}</b>
          {s.carry > 0 && <span className="carry">이월 {s.carry} 포함</span>}
          <span className="hand-no">#{s.handNo} · 선 {s.first === me ? '나' : '상대'}</span>
        </div>
        <div className="jp-stack ai">상대 <b>{s.stacks[opp]}</b>칩</div>
      </div>

      {/* 상대 카드 */}
      <div className="jp-side ai-side">
        <JanusCard
          key={`opp-${s.handNo}`}
          front={oppCard.front}
          back={oppBackRevealed ? oppCard.back : null}
          flipped={oppBackRevealed}
          owner="ai"
        />
        <div className="jp-side-info">
          <span className="side-name">상대</span>
          {s.faces[opp] && (
            <span className={`face-badge ${s.faces[opp] === 'both' ? 'both' : ''}`}>
              {FACE_NAME[s.faces[opp]!]} 베팅
              {s.faces[opp] === 'front' && ` (${oppCard.front})`}
            </span>
          )}
          {!myTurn && s.phase === 'act' && !s.result && <span className="thinking">고민 중…</span>}
        </div>
      </div>

      {/* 내 카드 */}
      <div className="jp-side my-side">
        <JanusCard
          key={`my-${s.handNo}`}
          front={my.front}
          back={my.back}
          flipped={peek}
          owner="me"
        />
        <div className="jp-side-info">
          <span className="side-name">나</span>
          <button className="peek-btn" onClick={() => setPeek((p) => !p)}>
            {peek ? '앞면 보기' : '뒷면 확인 (비밀)'}
          </button>
          {s.faces[me] && (
            <span className={`face-badge ${s.faces[me] === 'both' ? 'both' : ''}`}>
              {FACE_NAME[s.faces[me]!]} 베팅
            </span>
          )}
        </div>
      </div>

      {/* 조작/결과 패널 */}
      <div className="jp-panel">
        {myTurn && firstAction && (
          <>
            <span className="jp-note">
              {s.faces[opp]
                ? `상대: ${FACE_NAME[s.faces[opp]!]}에 레벨 ${s.level} 베팅 — 응수하세요`
                : '베팅할 면을 고르세요 (선언은 공개됩니다)'}
            </span>
            <div className="jp-face-btns">
              <button
                className={`jp-face ${pickedFace === 'front' ? 'on' : ''}`}
                onClick={() => setPickedFace('front')}
              >
                앞면 <b>{my.front}</b>
              </button>
              <button
                className={`jp-face ${pickedFace === 'back' ? 'on' : ''}`}
                onClick={() => setPickedFace('back')}
              >
                뒷면 <b>{my.back}</b> <small>비밀</small>
              </button>
              {s.faces[opp] !== 'both' && (
                <button
                  className={`jp-face both ${pickedFace === 'both' ? 'on' : ''}`}
                  onClick={() => setPickedFace('both')}
                >
                  양면베팅 <small>2배 지불</small>
                </button>
              )}
            </div>
            {pickedFace && cap >= minL && (
              <LevelPicker level={level} setLevel={setLevel} min={minL} max={cap} both={pickedFace === 'both'} />
            )}
            <div className="jp-btns">
              <button className="action-btn fold" onClick={() => act({ kind: 'fold' })}>
                포기{s.faces[opp] === 'both' && ' (−10)'}
              </button>
              <button
                className="action-btn call"
                disabled={!pickedFace || cap < minL}
                onClick={() => pickedFace && act({ kind: 'bet', face: pickedFace, level })}
              >
                {s.faces[opp] !== null && level === s.level ? '콜' : '베팅'} ({level}
                {pickedFace === 'both' ? '×2' : ''})
              </button>
            </div>
          </>
        )}
        {myTurn && !firstAction && (
          <>
            <span className="jp-note">
              상대가 레벨 {s.level}(으)로 올렸습니다 — 콜 비용 <b>{callCost(s, me)}</b>
            </span>
            {cap > s.level && (
              <LevelPicker level={level} setLevel={setLevel} min={s.level + 1} max={cap} both={s.faces[me] === 'both'} />
            )}
            <div className="jp-btns">
              <button className="action-btn fold" onClick={() => act({ kind: 'fold' })}>
                폴드{s.faces[opp] === 'both' && ' (−10)'}
              </button>
              <button
                className="action-btn call"
                disabled={callCost(s, me) > s.stacks[me]}
                onClick={() => act({ kind: 'call' })}
              >
                콜 (+{callCost(s, me)})
              </button>
              {cap > s.level && (
                <button
                  className="action-btn raise"
                  disabled={level <= s.level}
                  onClick={() => act({ kind: 'raise', level })}
                >
                  레이즈 ({level})
                </button>
              )}
            </div>
          </>
        )}
        {showResult && (
          <>
            <span className="jp-result-line">
              {r!.reason === 'fold' &&
                (r!.folder === me
                  ? `폴드 — 상대가 팟 ${r!.pot}칩 획득${r!.penalty ? ` + 양면 페널티 ${r!.penalty}` : ''}`
                  : `상대 폴드 — 팟 ${r!.pot}칩 획득!${r!.penalty ? ` + 양면 페널티 ${r!.penalty}` : ''}`)}
              {r!.reason === 'showdown' &&
                (r!.winner === null
                  ? `무승부 (${r!.values[me]} : ${r!.values[opp]}) — 팟 ${r!.pot}칩 이월`
                  : `${r!.values[me]} : ${r!.values[opp]} — ${r!.winner === me ? '승리! 팟' : '상대가 팟'} ${r!.pot}칩`)}
              {r!.reason === 'both-win' &&
                (r!.winner === me
                  ? `양면베팅 성공! 팟 ${r!.pot}칩 + 페널티 ${r!.penalty}칩`
                  : `상대 양면베팅 성공… 팟 ${r!.pot}칩 + 페널티 ${r!.penalty}칩`)}
              {r!.reason === 'both-lose' &&
                (r!.winner === me
                  ? `상대 양면베팅 실패! 팟 ${r!.pot}칩 획득`
                  : `양면베팅 실패… 상대가 팟 ${r!.pot}칩 획득`)}
            </span>
            {s.phase === 'handover' && (
              <button className="primary-btn" onClick={() => act({ kind: 'next' })}>
                다음 핸드
              </button>
            )}
          </>
        )}
        {!myTurn && !showResult && <span className="jp-note dim"> </span>}
      </div>

      {s.result && (
        <div className="jp-overlay">
          <div className="jp-endcard">
            <h2>{s.result.winner === me ? '🏆 승리!' : '패배…'}</h2>
            <p>
              {s.result.winner === me ? '상대의 칩을 모두 털었습니다' : '칩을 모두 잃었습니다'}
            </p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={() => hostApply(createGame(tossFirst()))}>
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

      {oppLeft && !s.result && (
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

function JanusCard({
  front,
  back,
  flipped,
  owner,
}: {
  front: number;
  back: number | null;
  flipped: boolean;
  owner: 'me' | 'ai';
}) {
  return (
    <div className={`jcard ${owner}`}>
      <div className={`jcard-inner ${flipped ? 'flipped' : ''}`}>
        <div className="jcard-face jcard-front">
          <span className="corner">앞</span>
          <span className="val">{front}</span>
        </div>
        <div className={`jcard-face jcard-back ${back === null ? 'hidden-back' : ''}`}>
          <span className="corner">뒤</span>
          <span className="val">{back === null ? '?' : back}</span>
        </div>
      </div>
    </div>
  );
}

function LevelPicker({
  level,
  setLevel,
  min,
  max,
  both,
}: {
  level: number;
  setLevel: (fn: (l: number) => number) => void;
  min: number;
  max: number;
  both: boolean;
}) {
  return (
    <div className="jp-level">
      <button onClick={() => setLevel((l) => Math.max(min, l - 1))}>−</button>
      <span className="level-num">
        레벨 <b>{level}</b>
        {both && <small> (지불 {level * 2})</small>}
      </span>
      <button onClick={() => setLevel((l) => Math.min(max, l + 1))}>＋</button>
      <div className="quick">
        {[min, min + 2, min + 5]
          .filter((v, i, arr) => v <= max && arr.indexOf(v) === i)
          .map((v) => (
            <button key={v} className={v === level ? 'on' : ''} onClick={() => setLevel(() => v)}>
              {v}
            </button>
          ))}
        <button className={level === max ? 'on' : ''} onClick={() => setLevel(() => max)}>
          맥스
        </button>
      </div>
    </div>
  );
}

function GameHeader({ onExit }: { onExit: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" onClick={onExit}>← 로비</button>
      <span className="game-title">야누스 포커 · 온라인</span>
    </header>
  );
}
