import { useEffect, useRef, useState } from 'react';
import type { NetRoom } from './room.ts';
import { makeRoomCode, normalizeCode, openRoom } from './room.ts';
import './online.css';

/**
 * 방 만들기/참가 공용 패널. 상대와 연결되면 onReady(room)을 호출한다.
 * 방을 만든 쪽이 호스트(좌석 0), 참가한 쪽이 게스트(좌석 1).
 */
export default function OnlinePanel({
  gameName,
  onReady,
  onCancel,
}: {
  gameName: string;
  onReady: (room: NetRoom) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'hosting' | 'joining'>('menu');
  const [code, setCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [copied, setCopied] = useState(false);
  /** 오래 기다려도 안 붙을 때 원인 안내 (무한 스피너 방지) */
  const [slow, setSlow] = useState(false);
  const roomRef = useRef<NetRoom | null>(null);
  const readyRef = useRef(false);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 패널을 떠날 때 미연결 방 정리
  useEffect(() => {
    return () => {
      if (slowTimer.current) clearTimeout(slowTimer.current);
      if (!readyRef.current) roomRef.current?.leave();
    };
  }, []);

  function watchPeers(room: NetRoom) {
    roomRef.current = room;
    setSlow(false);
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => {
      if (!readyRef.current) setSlow(true);
    }, 20000);
    const off = room.onPeers((count) => {
      if (count > 0 && !readyRef.current) {
        readyRef.current = true;
        if (slowTimer.current) clearTimeout(slowTimer.current);
        off();
        onReady(room);
      }
    });
    if (room.peerCount() > 0 && !readyRef.current) {
      readyRef.current = true;
      if (slowTimer.current) clearTimeout(slowTimer.current);
      onReady(room);
    }
  }

  function host() {
    const c = makeRoomCode();
    setCode(c);
    setMode('hosting');
    watchPeers(openRoom(c, true));
  }

  function join() {
    const c = normalizeCode(joinInput);
    if (c.length < 4) return;
    setCode(c);
    setMode('joining');
    watchPeers(openRoom(c, false));
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 미지원 — 코드가 화면에 있으므로 무시
    }
  }

  return (
    <div className="online-panel">
      <h3>온라인 대전 — {gameName}</h3>
      {mode === 'menu' && (
        <>
          <button className="primary-btn" onClick={host}>방 만들기</button>
          <div className="online-join-row">
            <input
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="방 코드 입력"
              maxLength={6}
            />
            <button className="ghost-btn" onClick={join} disabled={normalizeCode(joinInput).length < 4}>
              참가
            </button>
          </div>
          <button className="online-cancel" onClick={onCancel}>← 돌아가기</button>
        </>
      )}
      {mode === 'hosting' && (
        <>
          <p className="online-hint">친구에게 이 코드를 알려주세요</p>
          <button className="online-code" onClick={copyCode} title="눌러서 복사">
            {code}{copied && <span className="copied">복사됨!</span>}
          </button>
          <p className="online-wait">
            <span className="online-spinner" /> 상대 입장을 기다리는 중…
          </p>
          {slow && <SlowNotice />}
          <button className="online-cancel" onClick={onCancel}>취소</button>
        </>
      )}
      {mode === 'joining' && (
        <>
          <p className="online-hint">방 <b>{code}</b></p>
          <p className="online-wait">
            <span className="online-spinner" /> 연결 중… (코드가 맞는지 확인하세요)
          </p>
          {slow && <SlowNotice />}
          <button className="online-cancel" onClick={onCancel}>취소</button>
        </>
      )}
    </div>
  );
}

/** 연결이 오래 걸릴 때의 원인 안내 — 대부분 방 코드 오타 아니면 네트워크 제약이다 */
function SlowNotice() {
  return (
    <div className="online-slow">
      <b>연결이 오래 걸리네요</b>
      <ul>
        <li>방 코드가 정확한지 확인해 주세요 (대소문자 무관)</li>
        <li>두 사람 모두 같은 게임에서 방을 열어야 합니다</li>
        <li>회사·학교 와이파이나 VPN은 P2P 연결을 막는 경우가 있습니다 — 둘 중 한 명이 다른 네트워크(예: 휴대폰 핫스팟)로 바꿔보세요</li>
      </ul>
    </div>
  );
}
