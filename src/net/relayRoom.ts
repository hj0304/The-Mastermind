/**
 * 릴레이 기반 전송 계층 — 공개 nostr 릴레이를 데이터 통로로 사용한다.
 *
 * 왜 WebRTC가 아니라 릴레이인가:
 * WebRTC 직결은 양쪽이 서로의 공인 주소로 구멍을 뚫어야 하는데, 한쪽이라도
 * Symmetric NAT(회사·학교 와이파이, LTE 테더링, 일부 공유기) 뒤에 있으면 실패한다.
 * 이를 우회하려면 TURN 중계 서버가 필요하고, 쓸 만한 TURN은 전부 계정이 필요하다.
 * 반면 릴레이 방식은 양쪽 모두 서버로 "나가는" 연결만 쓰므로 NAT를 뚫을 일이 없다.
 * 턴제 게임이라 왕복 지연(수백 ms)도 체감되지 않는다.
 *
 * 보안: 방 코드에서 유도한 키로 페이로드를 AES-GCM 암호화하므로 릴레이 운영자나
 * 같은 릴레이를 구독하는 제3자는 게임 내용을 볼 수 없다.
 */

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { NetRoom } from './room.ts';

/** 여러 릴레이에 동시 발행·구독해 한 곳이 죽어도 이어지게 한다 */
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

/** 저장되지 않는 임시 이벤트(ephemeral) 대역 — 릴레이에 흔적을 남기지 않는다 */
const KIND = 20808;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return toHex(new Uint8Array(digest));
}

/** 방 코드 → 대칭키 (릴레이가 내용을 못 보게) */
async function deriveKey(code: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(`mm-key-${code}`), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('the-mastermind'), iterations: 100_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv);
  joined.set(ct, iv.length);
  return btoa(String.fromCharCode(...joined));
}

async function decryptJson(key: CryptoKey, payload: string): Promise<unknown> {
  const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(pt));
}

interface Envelope {
  /** 보낸 사람 식별자 (자기 메시지 무시용) */
  from: string;
  /** 'hi' = 접속 알림, 'msg' = 게임 데이터, 'bye' = 퇴장 */
  t: 'hi' | 'msg' | 'bye';
  d?: unknown;
}

/** 상대가 이 시간 동안 소식이 없으면 끊긴 것으로 본다 */
const PEER_TIMEOUT_MS = 20000;
const HEARTBEAT_MS = 5000;

export function openRelayRoom(code: string, isHost: boolean): NetRoom {
  const selfId = toHex(crypto.getRandomValues(new Uint8Array(8)));
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  const msgCbs = new Set<(msg: unknown) => void>();
  const peerCbs = new Set<(count: number) => void>();
  const sockets: WebSocket[] = [];
  /** 상대 id → 마지막 소식 시각 */
  const peers = new Map<string, number>();
  const seenEvents = new Set<string>();

  let keyPromise: Promise<CryptoKey> | null = null;
  let roomTag = '';
  let closed = false;
  const outbox: string[] = [];

  const key = () => (keyPromise ??= deriveKey(code));

  const notifyPeers = () => {
    for (const cb of peerCbs) cb(peers.size);
  };

  const publish = async (env: Envelope) => {
    if (closed) return;
    const content = await encryptJson(await key(), env);
    const event = finalizeEvent(
      {
        kind: KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', roomTag]],
        content,
      },
      sk,
    );
    const frame = JSON.stringify(['EVENT', event]);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      else if (ws.readyState === WebSocket.CONNECTING) outbox.push(frame);
    }
  };

  const handleEvent = async (ev: { id: string; pubkey: string; content: string }) => {
    if (ev.pubkey === pk) return; // 내 이벤트
    if (seenEvents.has(ev.id)) return; // 릴레이 중복 수신
    seenEvents.add(ev.id);
    if (seenEvents.size > 500) seenEvents.clear();
    let env: Envelope;
    try {
      env = (await decryptJson(await key(), ev.content)) as Envelope;
    } catch {
      return; // 다른 방(키 불일치) — 무시
    }
    if (!env || env.from === selfId) return;

    if (env.t === 'bye') {
      if (peers.delete(env.from)) notifyPeers();
      return;
    }
    const isNew = !peers.has(env.from);
    peers.set(env.from, Date.now());
    if (isNew) {
      notifyPeers();
      // 늦게 들어온 쪽이 내 존재를 알 수 있도록 즉시 응답
      void publish({ from: selfId, t: 'hi' });
    }
    if (env.t === 'msg') {
      for (const cb of msgCbs) cb(env.d);
    }
  };

  // 릴레이 연결
  void (async () => {
    roomTag = (await sha256Hex(`mm-room-${code}`)).slice(0, 32);
    if (closed) return;
    const subId = 'r' + selfId.slice(0, 6);
    const filter = { kinds: [KIND], '#d': [roomTag], since: Math.floor(Date.now() / 1000) - 5 };

    for (const url of RELAYS) {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        continue;
      }
      sockets.push(ws);
      ws.onopen = () => {
        if (closed) return;
        ws.send(JSON.stringify(['REQ', subId, filter]));
        for (const frame of outbox) ws.send(frame);
        void publish({ from: selfId, t: 'hi' });
      };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data as string);
          if (m[0] === 'EVENT' && m[1] === subId) void handleEvent(m[2]);
        } catch {
          // 파싱 불가 프레임 무시
        }
      };
      ws.onerror = () => {
        // 다른 릴레이가 살아 있으면 계속 진행
      };
    }
    outbox.length = 0;
  })();

  // 생존 신호 + 이탈 감지
  const beat = setInterval(() => {
    if (closed) return;
    void publish({ from: selfId, t: 'hi' });
    const now = Date.now();
    let dropped = false;
    for (const [id, last] of peers) {
      if (now - last > PEER_TIMEOUT_MS) {
        peers.delete(id);
        dropped = true;
      }
    }
    if (dropped) notifyPeers();
  }, HEARTBEAT_MS);

  return {
    code,
    isHost,
    send: (msg) => {
      void publish({ from: selfId, t: 'msg', d: msg });
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
      if (closed) return;
      closed = true;
      clearInterval(beat);
      // 퇴장 알림은 소켓을 닫기 전에
      void (async () => {
        try {
          const content = await encryptJson(await key(), { from: selfId, t: 'bye' } satisfies Envelope);
          const event = finalizeEvent(
            { kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['d', roomTag]], content },
            sk,
          );
          const frame = JSON.stringify(['EVENT', event]);
          for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send(frame);
        } catch {
          // 무시
        } finally {
          setTimeout(() => {
            for (const ws of sockets) {
              try {
                ws.close();
              } catch {
                // 무시
              }
            }
          }, 250);
        }
      })();
    },
  };
}
