/**
 * 온라인 대전 채팅 — 우하단 플로팅 버튼 + 접이식 패널. 모든 Online 화면 공용.
 * 전송은 NetRoom.sendChat (암호화·순서 보장은 전송 계층이 처리).
 */

import { useEffect, useRef, useState } from 'react';
import type { NetRoom } from './room.ts';
import './chat.css';

interface ChatMsg {
  mine: boolean;
  text: string;
}

const MAX_LEN = 200;

export default function ChatPanel({ room }: { room: NetRoom }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    return room.onChat((text) => {
      setMsgs((m) => [...m.slice(-99), { mine: false, text }]);
      if (!openRef.current) setUnread((u) => u + 1);
    });
  }, [room]);

  // 새 메시지 시 스크롤 하단 고정
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open]);

  function send() {
    const text = draft.trim().slice(0, MAX_LEN);
    if (!text) return;
    room.sendChat(text);
    setMsgs((m) => [...m.slice(-99), { mine: true, text }]);
    setDraft('');
  }

  function toggle() {
    setOpen((o) => {
      if (!o) setUnread(0);
      return !o;
    });
  }

  return (
    <>
      <button className="chat-fab" onClick={toggle} aria-label="채팅">
        💬
        {unread > 0 && <span className="chat-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="chat-panel">
          <div className="chat-head">
            <span>채팅</span>
            <button className="chat-close" onClick={toggle} aria-label="닫기">✕</button>
          </div>
          <div className="chat-list" ref={listRef}>
            {msgs.length === 0 && <p className="chat-empty">상대에게 한마디 건네보세요</p>}
            {msgs.map((m, i) => (
              <div key={i} className={`chat-msg ${m.mine ? 'mine' : 'theirs'}`}>{m.text}</div>
            ))}
          </div>
          <div className="chat-input-row">
            <input
              className="chat-input"
              value={draft}
              maxLength={MAX_LEN}
              placeholder="메시지 입력…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
            />
            <button className="chat-send" onClick={send}>전송</button>
          </div>
        </div>
      )}
    </>
  );
}
