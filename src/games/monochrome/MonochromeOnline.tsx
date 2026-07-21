import { useEffect, useRef, useState } from 'react';
import type { MonoState, PlayerId } from './engine.ts';
import { createGame, currentPlayer, play, tileColor } from './engine.ts';
import type { MonoView } from './view.ts';
import { viewFor } from './view.ts';
import type { NetRoom } from '../../net/room.ts';
import CoinToss from '../shared/CoinToss.tsx';
import './monochrome.css';
import '../../net/online.css';

/**
 * 모노크롬 온라인 대전 — 호스트 권위 방식.
 * 호스트(좌석 0)가 엔진을 실행하고, 게스트(좌석 1)에게는 관점 뷰(viewFor)만 전송한다.
 * 게스트의 입력은 액션 메시지로 호스트에 전달되어 엔진 검증을 거친다.
 */

type NetMsg =
  /** 선공 동전 결과 (호스트가 정해 알린다) */
  | { t: 'toss'; first: PlayerId }
  | { t: 'ready' }
  | { t: 'view'; v: MonoView }
  | { t: 'act'; tile: number };

export default function MonochromeOnline({ room, onExit }: { room: NetRoom; onExit: () => void }) {
  const me: PlayerId = room.isHost ? 0 : 1;
  // 호스트 전용 전체 상태 (게스트는 null 유지)
  const stateRef = useRef<MonoState | null>(null);
  const [view, setView] = useState<MonoView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [oppLeft, setOppLeft] = useState(false);
  /** 선공 동전 - 양쪽이 같은 결과를 본다 */
  const [toss, setToss] = useState<PlayerId | null>(null);
  /** 마지막 동전 결과 — 게스트가 늦게 들어오면 다시 보낸다 */
  const lastToss = useRef<PlayerId | null>(null);
  const prevHistLen = useRef(0);

  // 라운드 결과 플래시
  function maybeFlash(v: MonoView) {
    if (v.history.length > prevHistLen.current && v.history.length > 0) {
      const r = v.history[v.history.length - 1];
      setFlash(r.result === 'draw' ? '무승부!' : r.result === 'win' ? '라운드 승리!' : '라운드 패배');
      setTimeout(() => setFlash(null), 1200);
    }
    prevHistLen.current = v.history.length;
  }

  function hostApply(next: MonoState) {
    stateRef.current = next;
    const myView = viewFor(next, 0);
    maybeFlash(myView);
    setView(myView);
    room.send({ t: 'view', v: viewFor(next, 1) } satisfies NetMsg);
  }

  // 연결/메시지 배선
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
          room.send({ t: 'view', v: viewFor(stateRef.current, 1) } satisfies NetMsg);
        }
        if (msg.t === 'act' && stateRef.current) {
          const s = stateRef.current;
          try {
            if (currentPlayer(s) === 1) hostApply(play(s, msg.tile));
          } catch {
            // 무효 액션 무시 (엔진 검증)
          }
        }
      } else {
        if (msg.t === 'view') {
          maybeFlash(msg.v);
          setView(msg.v);
        }
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

    // StrictMode 이중 마운트에서 방이 죽지 않도록 leave()는 명시적 나가기에서만 호출
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

  function playTile(tile: number) {
    if (!view || !view.myTurn) return;
    if (room.isHost) {
      const s = stateRef.current;
      if (!s || currentPlayer(s) !== 0) return;
      try {
        hostApply(play(s, tile));
      } catch {
        // 무효 클릭 무시
      }
    } else {
      room.send({ t: 'act', tile } satisfies NetMsg);
    }
  }

  function rematch() {
    if (!room.isHost) return;
    prevHistLen.current = 0;
    hostApply(createGame(tossFirst()));
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

  if (!view) {
    return (
      <div className="mono-root">
        <GameHeader onExit={exit} />
        <p className="online-wait" style={{ justifyContent: 'center', marginTop: 40 }}>
          <span className="online-spinner" /> 게임 시작을 기다리는 중…
        </p>
      </div>
    );
  }

  const oppPendingShown = view.pending !== null && view.pending.value === null;

  return (
    <div className="mono-root">
      <GameHeader onExit={exit} />

      <div className="online-status">
        <span className={`dot ${oppLeft ? 'off' : ''}`} />
        방 {room.code} · {room.isHost ? '호스트' : '게스트'}
      </div>

      <div className="mono-scoreboard">
        <div className="score me">나 <b>{view.myScore}</b></div>
        <div className="round-info">
          {view.overtime > 0 && <span className="overtime">연장 {view.overtime}</span>}
          라운드 {view.round}/9
        </div>
        <div className="score ai"><b>{view.oppScore}</b> 상대</div>
      </div>

      {/* 상대 영역 */}
      <div className="mono-opponent">
        <div className="label">
          상대 타일 {view.oppHandCount}장
          {!view.iAmLeader && <span className="leader-mark"> · 선</span>}
        </div>
        <div className="tile-backs">
          {Array.from({ length: view.oppHandCount }, (_, i) => (
            <div key={i} className="tile back neutral" />
          ))}
        </div>
      </div>

      {/* 중앙 대결 영역 */}
      <div className="mono-table">
        {oppPendingShown ? (
          <div className={`tile back ${view.pending!.color}`}>
            <span className="q">?</span>
          </div>
        ) : view.pending !== null ? (
          <div className={`tile face ${view.pending.color}`}>{view.pending.value}</div>
        ) : (
          <div className="table-hint">
            {view.terminal
              ? ''
              : view.myTurn
                ? view.iAmLeader
                  ? '당신이 선입니다 — 타일을 내세요'
                  : ''
                : '상대가 고민 중…'}
          </div>
        )}
        {flash && <div className="result-flash">{flash}</div>}
      </div>

      {/* 내 손패 */}
      <div className="mono-hand">
        <div className="label">
          내 타일{view.iAmLeader && <span className="leader-mark"> · 선</span>}
          {oppPendingShown && view.myTurn && ' — 상대가 낸 타일의 색을 보고 응수하세요'}
        </div>
        <div className="tiles">
          {view.myHand.map((t) => (
            <button
              key={t}
              className={`tile face ${tileColor(t)} playable`}
              disabled={!view.myTurn}
              onClick={() => playTile(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 히스토리 */}
      <div className="mono-history">
        {view.history.map((r, i) => (
          <div key={i} className={`hist-row ${r.result === 'win' ? 'win' : r.result === 'lose' ? 'lose' : 'draw'}`}>
            <span className="hist-round">R{i + 1}</span>
            <span className={`hist-tile ${tileColor(r.myTile)}`}>{r.myTile}</span>
            <span className="hist-vs">vs</span>
            <span className={`hist-tile ${r.oppColor}`}>{r.oppTile ?? '?'}</span>
            <span className="hist-result">
              {r.result === 'win' ? '승' : r.result === 'lose' ? '패' : '무'}
            </span>
          </div>
        ))}
      </div>

      {view.terminal && (
        <div className="mono-overlay">
          <div className="mono-endcard">
            <h2>{view.iWon ? '🏆 승리!' : '패배…'}</h2>
            <p>{view.myScore} : {view.oppScore}</p>
            <div className="end-actions">
              {room.isHost ? (
                <button className="primary-btn" onClick={rematch}>다시 대전</button>
              ) : (
                <p className="online-hint">호스트가 재대결을 시작할 수 있습니다</p>
              )}
              <button className="ghost-btn" onClick={exit}>로비로</button>
            </div>
          </div>
        </div>
      )}

      {oppLeft && !view.terminal && (
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
      <span className="game-title">모노크롬 · 온라인</span>
    </header>
  );
}
