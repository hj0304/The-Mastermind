/**
 * 온라인 멀티플레이 전송 계층 — 서버리스 WebRTC (Trystero, nostr 시그널링).
 * GitHub Pages 정적 배포 그대로 사용 가능. 방 코드로 1:1 연결.
 *
 * 설계: 방을 만든 쪽이 호스트(좌석 0, 엔진 실행 권위), 참가자가 게스트(좌석 1).
 * 게임별 메시지는 msg 채널 하나로 주고받는다(JSON 직렬화 가능해야 함).
 */

import { joinRoom } from 'trystero';
import type { JsonValue, Room } from 'trystero';

const APP_ID = 'the-mastermind-nan2026';

/** 헷갈리는 문자(0/O, 1/I) 제외 */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface NetRoom {
  code: string;
  isHost: boolean;
  /** 상대에게 메시지 전송 (연결 전이면 무시됨) */
  send: (msg: unknown) => void;
  /** 수신 콜백 등록 — 해제 함수 반환 */
  onMsg: (cb: (msg: unknown) => void) => () => void;
  /** 피어 입장/퇴장 콜백 등록 — 해제 함수 반환 */
  onPeers: (cb: (count: number) => void) => () => void;
  peerCount: () => number;
  leave: () => void;
}

export function openRoom(code: string, isHost: boolean): NetRoom {
  const room: Room = joinRoom({ appId: APP_ID }, `mm-${code}`);
  const action = room.makeAction<JsonValue>('m');

  const peers = new Set<string>();
  const msgCbs = new Set<(msg: unknown) => void>();
  const peerCbs = new Set<(count: number) => void>();

  action.onMessage = (data) => {
    for (const cb of msgCbs) cb(data);
  };
  room.onPeerJoin = (id) => {
    peers.add(id);
    for (const cb of peerCbs) cb(peers.size);
  };
  room.onPeerLeave = (id) => {
    peers.delete(id);
    for (const cb of peerCbs) cb(peers.size);
  };

  return {
    code,
    isHost,
    send: (msg) => {
      action.send(msg as JsonValue).catch(() => {
        // 연결 전/전송 실패는 무시 (view 재전송 경로가 복구)
      });
    },
    onMsg: (cb) => {
      msgCbs.add(cb);
      return () => msgCbs.delete(cb);
    },
    onPeers: (cb) => {
      peerCbs.add(cb);
      return () => peerCbs.delete(cb);
    },
    peerCount: () => peers.size,
    leave: () => {
      room.leave().catch(() => {
        // ignore
      });
    },
  };
}
