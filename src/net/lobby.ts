/**
 * 공개 방 목록 — nostr 릴레이를 게시판처럼 사용한다.
 *
 * 호스트는 대기 중 주기적으로 방 공고(게임·코드)를 로비 태그에 발행하고,
 * 목록을 보는 쪽은 같은 태그를 구독해 최근 공고를 모은다. 공고가 끊기면
 * (호스트 퇴장/상대 입장) 목록에서 자동으로 사라진다.
 *
 * 공개 방은 코드가 공개되므로 암호화의 의미가 없어 평문 JSON을 쓴다.
 * 비공개로 하고 싶으면 기존처럼 코드를 직접 공유하면 된다 (공고 안 함).
 */

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const KIND = 20808; // relayRoom과 같은 임시(ephemeral) 대역

const enc = new TextEncoder();
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

async function lobbyTag(game: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`mm-lobby-${game}`));
  return toHex(new Uint8Array(digest)).slice(0, 32);
}

/** 공고 유효 시간 — 이 안에 재공고가 없으면 목록에서 제거 */
const ROOM_TTL_MS = 25000;
const ANNOUNCE_MS = 8000;

export interface LobbyRoom {
  code: string;
  /** 공고 수신 시각 (만료 판정용) */
  at: number;
}

/**
 * 방 공고 발행 시작 — 반환 함수를 호출하면 중단.
 * (상대가 입장하거나 패널을 떠날 때 반드시 중단할 것)
 */
export function announceRoom(game: string, code: string): () => void {
  const sk = generateSecretKey();
  const sockets: WebSocket[] = [];
  let tag = '';
  let stopped = false;

  const publish = () => {
    if (stopped || !tag) return;
    const event = finalizeEvent(
      {
        kind: KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', tag]],
        content: JSON.stringify({ mm: 'room', code }),
      },
      sk,
    );
    const frame = JSON.stringify(['EVENT', event]);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
  };

  void (async () => {
    tag = await lobbyTag(game);
    if (stopped) return;
    for (const url of RELAYS) {
      try {
        const ws = new WebSocket(url);
        ws.onopen = () => publish();
        sockets.push(ws);
      } catch {
        // 이 릴레이는 포기 — 나머지로 충분
      }
    }
  })();

  const timer = setInterval(publish, ANNOUNCE_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    for (const ws of sockets) {
      try {
        ws.close();
      } catch {
        // 무시
      }
    }
  };
}

/**
 * 방 목록 구독 — cb로 현재 유효한 방 목록(최신 공고 순)을 반복 전달.
 * 반환 함수를 호출하면 구독 해제.
 */
export function watchLobby(game: string, cb: (rooms: LobbyRoom[]) => void): () => void {
  const sockets: WebSocket[] = [];
  const rooms = new Map<string, LobbyRoom>(); // code → 최신 공고
  let stopped = false;
  const subId = 'lobby' + Math.random().toString(36).slice(2, 8);

  const emit = () => {
    const now = Date.now();
    for (const [c, r] of rooms) {
      if (now - r.at > ROOM_TTL_MS) rooms.delete(c);
    }
    cb([...rooms.values()].sort((a, b) => b.at - a.at));
  };

  void (async () => {
    const tag = await lobbyTag(game);
    if (stopped) return;
    const filter = { kinds: [KIND], '#d': [tag], since: Math.floor(Date.now() / 1000) - 30 };
    for (const url of RELAYS) {
      try {
        const ws = new WebSocket(url);
        ws.onopen = () => ws.send(JSON.stringify(['REQ', subId, filter]));
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data as string);
            if (m[0] !== 'EVENT' || m[1] !== subId) return;
            const data = JSON.parse(m[2].content as string) as { mm?: string; code?: string };
            if (data.mm !== 'room' || typeof data.code !== 'string' || !/^[A-Z2-9]{6}$/.test(data.code)) return;
            rooms.set(data.code, { code: data.code, at: Date.now() });
            emit();
          } catch {
            // 로비와 무관한 이벤트(암호화된 게임 트래픽 등) — 무시
          }
        };
        sockets.push(ws);
      } catch {
        // 무시
      }
    }
  })();

  const prune = setInterval(emit, 5000);
  return () => {
    stopped = true;
    clearInterval(prune);
    for (const ws of sockets) {
      try {
        ws.close();
      } catch {
        // 무시
      }
    }
  };
}
