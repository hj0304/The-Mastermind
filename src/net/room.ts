/**
 * 온라인 멀티플레이 전송 계층의 공용 인터페이스와 방 코드 유틸.
 *
 * 실제 전송은 relayRoom.ts(공개 nostr 릴레이 경유)가 담당한다.
 * 처음에는 WebRTC P2P(Trystero)를 썼지만, 서로 다른 네트워크의 두 사람은
 * NAT 때문에 직결이 자주 실패했다(같은 기기의 두 탭만 항상 성공). 이를
 * 해결하려면 TURN 중계 서버가 필요한데 쓸 만한 TURN은 전부 계정이 필요해,
 * 가입 없이 동작하는 릴레이 방식으로 전환했다. 자세한 배경은 relayRoom.ts 참조.
 *
 * 설계: 방을 만든 쪽이 호스트(좌석 0, 엔진 실행 권위), 참가자가 게스트(좌석 1).
 */

import { openRelayRoom } from './relayRoom.ts';

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
  return openRelayRoom(code, isHost);
}
