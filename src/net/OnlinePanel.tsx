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
  const roomRef = useRef<NetRoom | null>(null);
  const readyRef = useRef(false);

  // 패널을 떠날 때 미연결 방 정리
  useEffect(() => {
    return () => {
      if (!readyRef.current) roomRef.current?.leave();
    };
  }, []);

  function watchPeers(room: NetRoom) {
    roomRef.current = room;
    const off = room.onPeers((count) => {
      if (count > 0 && !readyRef.current) {
        readyRef.current = true;
        off();
        onReady(room);
      }
    });
    if (room.peerCount() > 0 && !readyRef.current) {
      readyRef.current = true;
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
          <button className="online-cancel" onClick={onCancel}>취소</button>
        </>
      )}
      {mode === 'joining' && (
        <>
          <p className="online-hint">방 <b>{code}</b></p>
          <p className="online-wait">
            <span className="online-spinner" /> 연결 중… (코드가 맞는지 확인하세요)
          </p>
          <button className="online-cancel" onClick={onCancel}>취소</button>
        </>
      )}
    </div>
  );
}
