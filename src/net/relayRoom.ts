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
 *
 * 신뢰성 설계 (공개 릴레이는 유실·중복·순서 뒤바뀜·연결 끊김이 모두 일어난다):
 * - 재연결: 소켓이 닫히면 지수 백오프로 다시 연결하고 재구독한다.
 * - 순서 보장: 게임 메시지마다 송신 순번(n)을 붙이고, 수신측은 순번대로만
 *   전달한다. 빠진 번호는 버퍼에 보관했다가 채워지면 순서대로 배출한다.
 * - 유실 복구: 최근 게임 메시지를 하트비트마다 재전송한다. 이미 받은 쪽은
 *   이벤트 id/순번으로 무시하므로 안전한 재전송이다. 재전송으로도 오래
 *   못 채운 갭(진짜 유실)은 건너뛰고 이후 메시지를 배출한다.
 * - 좌석 고정: 처음 만난 상대에게 좌석을 고정하고 제3자의 개입을 무시한다.
 * - 이탈 통지: 명시적 나가기 외에 탭 닫기/새로고침(pagehide)에도 bye를 보낸다.
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
async function deriveKey(scopedCode: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(`mm-key-${scopedCode}`), 'PBKDF2', false, [
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
  /** 게임 메시지 송신 순번 — 수신측 순서 보장·중복 제거용 */
  n?: number;
}

/** 상대가 이 시간 동안 소식이 없으면 끊긴 것으로 본다 */
const PEER_TIMEOUT_MS = 25000;
const HEARTBEAT_MS = 8000;
/** 재연결 백오프 상한 */
const RETRY_MAX_MS = 15000;
/** 재전송으로도 이 시간 동안 못 채운 순번 갭은 진짜 유실로 보고 건너뛴다 */
const GAP_SKIP_MS = 20000;
/** 하트비트마다 재전송할 최근 게임 메시지 개수 */
const RESEND_WINDOW = 4;

/**
 * @param scope 방 코드 네임스페이스(보통 게임 이름) — 다른 게임의 같은 코드와
 *              키·구독 태그가 모두 달라져, 다른 게임끼리 잘못 연결되는 것을 막는다.
 */
export function openRelayRoom(code: string, isHost: boolean, scope = ''): NetRoom {
  const selfId = toHex(crypto.getRandomValues(new Uint8Array(8)));
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const scopedCode = scope ? `${scope}:${code}` : code;

  const msgCbs = new Set<(msg: unknown) => void>();
  const chatCbs = new Set<(text: string) => void>();
  const peerCbs = new Set<(count: number) => void>();
  /** url → 현재 소켓 (재연결 시 교체) */
  const sockets = new Map<string, WebSocket>();
  const retryDelay = new Map<string, number>();
  /** 상대 id → 마지막 소식 시각 */
  const peers = new Map<string, number>();
  /** 이 방의 상대 좌석 — 처음 만난 피어로 고정, 제3자 개입 차단 */
  let lockedPeer: string | null = null;

  /** 수신 이벤트 id 중복 필터 — 오래된 것부터 밀어내는 FIFO */
  const seenEvents = new Set<string>();
  const rememberEvent = (id: string) => {
    seenEvents.add(id);
    if (seenEvents.size > 1000) {
      const it = seenEvents.values();
      for (let i = 0; i < 200; i++) seenEvents.delete(it.next().value as string);
    }
  };

  /** 송신 순번 (게임 메시지 전용) */
  let seqOut = 0;
  /** 최근 발행한 게임 메시지 프레임 — 하트비트 재전송용 */
  const lastMsgFrames: string[] = [];
  /** 발신자별 수신 순서 상태 */
  interface Inbound {
    last: number;
    buf: Map<number, unknown>;
    gapSince: number;
  }
  const inbound = new Map<string, Inbound>();

  let keyPromise: Promise<CryptoKey> | null = null;
  let roomTag = '';
  let closed = false;
  /** 열린 소켓이 하나도 없는 동안 발행된 프레임 — 연결 복구 시 전송 */
  const outbox: string[] = [];

  const key = () => (keyPromise ??= deriveKey(scopedCode));

  const notifyPeers = () => {
    for (const cb of peerCbs) cb(peers.size);
  };

  /** 열린 모든 소켓으로 프레임 전송. 하나라도 보냈으면 true */
  const sendFrame = (frame: string): boolean => {
    let sent = false;
    for (const ws of sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
        sent = true;
      }
    }
    return sent;
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
    if (env.t === 'msg') {
      lastMsgFrames.push(frame);
      if (lastMsgFrames.length > RESEND_WINDOW) lastMsgFrames.shift();
    }
    if (!sendFrame(frame) && outbox.length < 50) outbox.push(frame);
  };

  const deliver = (d: unknown) => {
    // 채팅 사이드채널 — 게임 메시지와 같은 순서 보장·재전송 파이프라인을 타되,
    // 게임 핸들러 대신 채팅 콜백으로 배달한다 (게임별 프로토콜과 완전 분리)
    const chat = (d as { __mmChat?: unknown } | null)?.__mmChat;
    if (typeof chat === 'string') {
      for (const cb of chatCbs) cb(chat);
      return;
    }
    for (const cb of msgCbs) cb(d);
  };

  /** 순번 기반 순서 보장 수신 — 중복은 버리고, 갭은 버퍼에 보관 */
  const acceptMsg = (from: string, n: number | undefined, d: unknown) => {
    if (n === undefined) {
      deliver(d);
      return;
    }
    let st = inbound.get(from);
    if (!st) {
      // 첫 수신을 기준점으로 삼는다 (그 이전 순번은 입장 전에 흘러간 것)
      st = { last: n, buf: new Map(), gapSince: 0 };
      inbound.set(from, st);
      deliver(d);
      return;
    }
    if (n <= st.last) return; // 중복 또는 과거 메시지
    if (n === st.last + 1) {
      st.last = n;
      deliver(d);
      while (st.buf.has(st.last + 1)) {
        st.last += 1;
        const next = st.buf.get(st.last)!;
        st.buf.delete(st.last);
        deliver(next);
      }
      if (st.buf.size === 0) st.gapSince = 0;
      return;
    }
    st.buf.set(n, d); // 갭 — 재전송이 채워줄 때까지 대기
    if (!st.gapSince) st.gapSince = Date.now();
  };

  const handleEvent = async (ev: { id: string; pubkey: string; content: string }) => {
    if (ev.pubkey === pk) return; // 내 이벤트
    if (seenEvents.has(ev.id)) return; // 릴레이 중복 수신
    rememberEvent(ev.id);
    let env: Envelope;
    try {
      env = (await decryptJson(await key(), ev.content)) as Envelope;
    } catch {
      return; // 다른 방(키 불일치) — 무시
    }
    if (!env || env.from === selfId) return;

    // 좌석 고정: 처음 만난 상대만 인정 — 코드가 새어도 제3자가 끼어들 수 없다
    if (lockedPeer === null) lockedPeer = env.from;
    else if (env.from !== lockedPeer) return;

    if (env.t === 'bye') {
      if (peers.delete(env.from)) {
        lockedPeer = null;
        notifyPeers();
      }
      return;
    }
    const isNew = !peers.has(env.from);
    peers.set(env.from, Date.now());
    if (isNew) {
      notifyPeers();
      // 늦게 들어온 쪽이 내 존재를 알 수 있도록 즉시 응답
      void publish({ from: selfId, t: 'hi' });
    }
    if (env.t === 'msg') acceptMsg(env.from, env.n, env.d);
  };

  const subId = 'r' + selfId.slice(0, 6);
  /** since를 넉넉히 잡는 이유: 상대 기기의 시계가 뒤로 틀어져 있어도 이벤트가 걸러지지 않게 */
  const mkFilter = () => ({ kinds: [KIND], '#d': [roomTag], since: Math.floor(Date.now() / 1000) - 60 });

  const connect = (url: string) => {
    if (closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect(url);
      return;
    }
    sockets.set(url, ws);
    ws.onopen = () => {
      if (closed) {
        ws.close();
        return;
      }
      retryDelay.set(url, 1000);
      ws.send(JSON.stringify(['REQ', subId, mkFilter()]));
      if (outbox.length) {
        for (const frame of outbox) ws.send(frame);
        outbox.length = 0;
      }
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
    ws.onclose = () => {
      if (!closed) scheduleReconnect(url);
    };
    ws.onerror = () => {
      // onclose가 뒤따르므로 재연결은 거기서 처리
    };
  };

  const scheduleReconnect = (url: string) => {
    const d = retryDelay.get(url) ?? 1000;
    retryDelay.set(url, Math.min(d * 2, RETRY_MAX_MS));
    setTimeout(() => {
      if (!closed) connect(url);
    }, d);
  };

  /**
   * 퇴장 프레임은 미리 만들어 둔다 — pagehide(탭 닫기/새로고침) 시점에는 비동기
   * 암호화·서명이 완료되지 못하므로, 완성된 프레임을 동기로 send하는 수밖에 없다.
   * created_at이 오래되면 상대 구독 필터(since)에 걸리므로 하트비트마다 갱신한다.
   */
  let byeFrame: string | null = null;
  const prepareBye = async () => {
    try {
      const content = await encryptJson(await key(), { from: selfId, t: 'bye' } satisfies Envelope);
      const event = finalizeEvent(
        { kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['d', roomTag]], content },
        sk,
      );
      byeFrame = JSON.stringify(['EVENT', event]);
    } catch {
      // 무시 — 다음 갱신 주기에 재시도
    }
  };

  // 릴레이 연결
  void (async () => {
    roomTag = (await sha256Hex(`mm-room-${scopedCode}`)).slice(0, 32);
    if (closed) return;
    for (const url of RELAYS) connect(url);
    void prepareBye();
  })();

  // 생존 신호 + 유실 복구 재전송 + 이탈/갭 정리
  let beatCount = 0;
  const beat = setInterval(() => {
    if (closed) return;
    void publish({ from: selfId, t: 'hi' });
    void prepareBye();
    // 격 하트비트마다 최근 게임 메시지 재전송 — 받은 쪽은 id/순번으로 무시하므로 안전
    if (++beatCount % 2 === 0) {
      for (const frame of lastMsgFrames) sendFrame(frame);
    }
    const now = Date.now();
    let dropped = false;
    for (const [id, last] of peers) {
      if (now - last > PEER_TIMEOUT_MS) {
        peers.delete(id);
        if (id === lockedPeer) lockedPeer = null;
        dropped = true;
      }
    }
    if (dropped) notifyPeers();
    // 재전송 주기를 여러 번 넘겨도 못 채운 갭 = 진짜 유실 — 건너뛰고 이후를 배출
    for (const st of inbound.values()) {
      if (st.gapSince && now - st.gapSince > GAP_SKIP_MS && st.buf.size > 0) {
        const ns = [...st.buf.keys()].sort((a, b) => a - b);
        for (const gn of ns) {
          const d = st.buf.get(gn)!;
          st.buf.delete(gn);
          st.last = gn;
          deliver(d);
        }
        st.gapSince = 0;
      }
    }
  }, HEARTBEAT_MS);

  const leave = () => {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    window.removeEventListener('pagehide', onPagehide);
    // 퇴장 알림은 소켓을 닫기 전에 — 미리 만들어 둔 프레임을 동기 전송 (언로드 중에도 동작)
    if (byeFrame) sendFrame(byeFrame);
    setTimeout(() => {
      for (const ws of sockets.values()) {
        try {
          ws.close();
        } catch {
          // 무시
        }
      }
    }, 250);
  };

  /**
   * 탭 닫기/새로고침/다른 사이트로 이동 시 상대에게 퇴장을 알린다.
   * persisted(bfcache 보존) 상태는 제외 — 뒤로가기로 잠시 떠났다 돌아오는 경우는
   * 소켓 재연결로 살아나므로 방을 죽이지 않는다.
   */
  const onPagehide = (e: PageTransitionEvent) => {
    if (!e.persisted) leave();
  };
  window.addEventListener('pagehide', onPagehide);

  return {
    code,
    isHost,
    send: (msg) => {
      // 순번은 호출 시점에 동기적으로 확정 — 암호화 지연으로 인한 발행 순서 역전과 무관하게
      // 수신측이 원래 순서를 복원할 수 있다
      void publish({ from: selfId, t: 'msg', d: msg, n: ++seqOut });
    },
    onMsg: (cb) => {
      msgCbs.add(cb);
      return () => msgCbs.delete(cb);
    },
    sendChat: (text) => {
      void publish({ from: selfId, t: 'msg', d: { __mmChat: text }, n: ++seqOut });
    },
    onChat: (cb) => {
      chatCbs.add(cb);
      return () => chatCbs.delete(cb);
    },
    onPeers: (cb) => {
      peerCbs.add(cb);
      return () => peerCbs.delete(cb);
    },
    peerCount: () => peers.size,
    leave,
  };
}
