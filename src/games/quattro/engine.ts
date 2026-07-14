/**
 * 콰트로 (원작: 콰트로 시즌4 ver.) 게임 엔진 — 순수 로직, UI 무관.
 * 룰 상세: docs/GAME_RULES.md §2
 *
 * 핵심 구조:
 * - 최종 4장 = 오픈된 카드(잠김·공개) + 손패(비공개). 승패는 최종 4장으로 판정.
 * - 가상 플레이어 6명은 고정 규칙으로 교환에 응한다 (0 우선 → 오픈 양립 최적 → 최고 숫자 → 색 우선).
 * - 내가 준 카드는 전체 공개, 받은 카드는 본인만 확인.
 */

export type PlayerId = 0 | 1;
export type QColor = 'R' | 'B' | 'Y' | 'G' | 'K'; // K = 검정(0 카드)

export interface QCard {
  id: number;
  color: QColor;
  num: number; // K는 0
}

export const COLOR_ORDER: QColor[] = ['R', 'B', 'Y', 'G']; // 가상 플레이어 동수 우선순위

export function fullDeck(): QCard[] {
  const deck: QCard[] = [];
  let id = 0;
  for (const color of COLOR_ORDER) {
    for (let n = 1; n <= 6; n++) deck.push({ id: id++, color, num: n });
  }
  deck.push({ id: id++, color: 'K', num: 0 });
  deck.push({ id: id++, color: 'K', num: 0 });
  return deck;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type QPhase = 'mulligan' | 'opening' | 'exchange' | 'done';

export interface ExchangeLog {
  player: PlayerId;
  virtualIdx: number;
  /** 준 카드 (전체 공개) */
  given: QCard;
  /** 받은 카드 — 교환 당사자만 아는 정보. UI는 상대 것을 표시하면 안 됨. */
  received: QCard;
}

export interface QResult {
  winner: PlayerId | null;
  detail: string;
}

export interface QState {
  phase: QPhase;
  deck: QCard[];
  /** 멀리건으로 버린 카드 (가상 배분 시 합류) */
  discard: QCard[];
  /** 비공개 손패 */
  hands: [QCard[], QCard[]];
  /** 오픈(잠김) 카드 */
  opens: [QCard[], QCard[]];
  mulligansUsed: [number, number];
  mulliganDone: [boolean, boolean];
  virtuals: QCard[][]; // 6 × 3
  /** 플레이어별 가상 플레이어 교환 완료 여부 */
  exchanged: [boolean[], boolean[]];
  /** 교환 페이즈 행동 카운터 (A-B-B-A-A-B 턴 순서 계산용) */
  actionIdx: number;
  /** 선 플레이어 */
  first: PlayerId;
  /** 연속 패스 추적 */
  declined: [boolean, boolean];
  /** opening 단계에서 아직 오픈해야 하는 플레이어 목록 */
  pendingOpen: PlayerId[];
  log: ExchangeLog[];
  result: QResult | null;
}

export function createGame(first: PlayerId): QState {
  const deck = shuffle(fullDeck());
  return {
    phase: 'mulligan',
    deck: deck.slice(8),
    discard: [],
    hands: [deck.slice(0, 4), deck.slice(4, 8)],
    opens: [[], []],
    mulligansUsed: [0, 0],
    mulliganDone: [false, false],
    virtuals: [],
    exchanged: [
      [false, false, false, false, false, false],
      [false, false, false, false, false, false],
    ],
    actionIdx: 0,
    first,
    declined: [false, false],
    pendingOpen: [],
    log: [],
    result: null,
  };
}

// ---------- 멀리건 ----------

export function mulligan(s: QState, p: PlayerId): QState {
  if (s.phase !== 'mulligan') throw new Error('not mulligan phase');
  if (s.mulliganDone[p] || s.mulligansUsed[p] >= 2) throw new Error('mulligan not allowed');
  if (s.deck.length < 4) throw new Error('deck exhausted');
  const hands: [QCard[], QCard[]] = [[...s.hands[0]], [...s.hands[1]]];
  const discard = [...s.discard, ...hands[p]];
  hands[p] = s.deck.slice(0, 4);
  const used: [number, number] = [...s.mulligansUsed];
  used[p] += 1;
  const next = { ...s, hands, discard, deck: s.deck.slice(4), mulligansUsed: used };
  // 2회를 다 쓰면 자동 확정
  if (used[p] >= 2) return keepHand(next, p);
  return next;
}

export function keepHand(s: QState, p: PlayerId): QState {
  if (s.phase !== 'mulligan') throw new Error('not mulligan phase');
  const done: [boolean, boolean] = [...s.mulliganDone];
  done[p] = true;
  let next: QState = { ...s, mulliganDone: done };
  if (done[0] && done[1]) {
    // 가상 플레이어 6명에게 3장씩 배분 (남은 덱 + 멀리건 버림패 셔플)
    const pool = shuffle([...next.deck, ...next.discard]);
    const virtuals = Array.from({ length: 6 }, (_, i) => pool.slice(i * 3, i * 3 + 3));
    next = {
      ...next,
      deck: [],
      discard: [],
      virtuals,
      phase: 'opening',
      pendingOpen: [next.first, (1 - next.first) as PlayerId],
    };
  }
  return next;
}

// ---------- 오픈 ----------

export function openCard(s: QState, p: PlayerId, cardId: number): QState {
  if (s.phase !== 'opening') throw new Error('not opening phase');
  if (s.pendingOpen[0] !== p) throw new Error('not your open turn');
  const hand = s.hands[p];
  const i = hand.findIndex((c) => c.id === cardId);
  if (i < 0) throw new Error('card not in hand');
  const hands: [QCard[], QCard[]] = [[...s.hands[0]], [...s.hands[1]]];
  const opens: [QCard[], QCard[]] = [[...s.opens[0]], [...s.opens[1]]];
  opens[p].push(hand[i]);
  hands[p] = hand.filter((c) => c.id !== cardId);
  let next: QState = {
    ...s,
    hands,
    opens,
    pendingOpen: s.pendingOpen.slice(1),
    declined: [false, false],
  };
  if (next.pendingOpen.length === 0) {
    if (next.opens[0].length >= 4 && next.opens[1].length >= 4) {
      next = finishGame(next);
    } else {
      next = { ...next, phase: 'exchange' };
    }
  }
  return next;
}

// ---------- 교환 ----------

/** A-B-B-A-A-B… 패턴에서 actionIdx번째 행동자 */
export function currentActor(s: QState): PlayerId {
  const a = s.first;
  const b = (1 - a) as PlayerId;
  return ((s.actionIdx + 1) >> 1) & 1 ? b : a;
}

/**
 * 가상 플레이어의 응답 카드 선택 (교환 규칙):
 * ① 0 카드 보유 시 무조건 0 ② 교환자의 오픈과 양립하는 콰트로 최적(최고 숫자) 카드
 * ③ 없으면 최고 숫자 ④ 동수면 빨>파>노>초
 */
export function virtualResponse(virtualHand: QCard[], exchangerOpens: QCard[]): QCard {
  const zero = virtualHand.find((c) => c.color === 'K');
  if (zero) return zero;
  const colors = new Set(exchangerOpens.map((c) => c.color));
  const nums = new Set(exchangerOpens.map((c) => c.num));
  const pick = (cands: QCard[]): QCard =>
    [...cands].sort(
      (a, b) => b.num - a.num || COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color),
    )[0];
  const compatible = virtualHand.filter((c) => !colors.has(c.color) && !nums.has(c.num));
  if (compatible.length > 0) return pick(compatible);
  return pick(virtualHand);
}

export function canDecline(s: QState, p: PlayerId): boolean {
  // 3장 오픈 상태(마지막 오픈 전)에서 미방문 가상 플레이어가 남았다면 패스 불가
  const unvisited = s.exchanged[p].filter((v) => !v).length;
  if (unvisited === 0) return true;
  return s.opens[p].length < 3;
}

export function exchange(s: QState, p: PlayerId, virtualIdx: number, giveCardId: number): QState {
  if (s.phase !== 'exchange') throw new Error('not exchange phase');
  if (currentActor(s) !== p) throw new Error('not your turn');
  if (s.exchanged[p][virtualIdx]) throw new Error('already exchanged with this virtual');
  const hand = s.hands[p];
  const gi = hand.findIndex((c) => c.id === giveCardId);
  if (gi < 0) throw new Error('card not in hand');

  const given = hand[gi];
  const vHand = s.virtuals[virtualIdx];
  const received = virtualResponse(vHand, s.opens[p]);

  const hands: [QCard[], QCard[]] = [[...s.hands[0]], [...s.hands[1]]];
  hands[p] = [...hand.filter((c) => c.id !== giveCardId), received];
  const virtuals = s.virtuals.map((v, i) =>
    i === virtualIdx ? [...v.filter((c) => c.id !== received.id), given] : v,
  );
  const exchanged: [boolean[], boolean[]] = [[...s.exchanged[0]], [...s.exchanged[1]]];
  exchanged[p] = [...exchanged[p]];
  exchanged[p][virtualIdx] = true;

  return {
    ...s,
    hands,
    virtuals,
    exchanged,
    actionIdx: s.actionIdx + 1,
    declined: [false, false],
    log: [...s.log, { player: p, virtualIdx, given, received }],
  };
}

export function decline(s: QState, p: PlayerId): QState {
  if (s.phase !== 'exchange') throw new Error('not exchange phase');
  if (currentActor(s) !== p) throw new Error('not your turn');
  if (!canDecline(s, p)) throw new Error('must exchange with remaining virtuals first');
  const declined: [boolean, boolean] = [...s.declined];
  declined[p] = true;
  let next: QState = { ...s, declined, actionIdx: s.actionIdx + 1 };
  if (declined[0] && declined[1]) {
    // 양쪽 모두 패스 → 각자 다음 카드 오픈
    next = {
      ...next,
      phase: 'opening',
      pendingOpen: [next.first, (1 - next.first) as PlayerId],
      declined: [false, false],
    };
  }
  return next;
}

// ---------- 판정 ----------

/** 최종 4장 (오픈 + 손패) */
export function finalFour(s: QState, p: PlayerId): QCard[] {
  return [...s.opens[p], ...s.hands[p]];
}

export function isQuattro(cards: QCard[]): boolean {
  if (cards.length !== 4) return false;
  const colors = new Set(cards.map((c) => c.color));
  const nums = new Set(cards.map((c) => c.num));
  return colors.size === 4 && nums.size === 4;
}

export function cardSum(cards: QCard[]): number {
  return cards.reduce((a, c) => a + c.num, 0);
}

function finishGame(s: QState): QState {
  const four: [QCard[], QCard[]] = [finalFour(s, 0), finalFour(s, 1)];
  const quat = [isQuattro(four[0]), isQuattro(four[1])];
  const sums = [cardSum(four[0]), cardSum(four[1])];

  let winner: PlayerId | null;
  let detail: string;
  if (quat[0] !== quat[1]) {
    winner = quat[0] ? 0 : 1;
    detail = '콰트로 완성 대 미완성';
  } else {
    if (sums[0] !== sums[1]) {
      winner = sums[0] > sums[1] ? 0 : 1;
      detail = `합계 ${sums[0]} : ${sums[1]}`;
    } else {
      // 동점 → 최고 카드부터 내림차순 비교
      const desc = (cards: QCard[]) => cards.map((c) => c.num).sort((a, b) => b - a);
      const d0 = desc(four[0]);
      const d1 = desc(four[1]);
      winner = null;
      detail = `합계 동점 ${sums[0]}`;
      for (let i = 0; i < 4; i++) {
        if (d0[i] !== d1[i]) {
          winner = d0[i] > d1[i] ? 0 : 1;
          detail = `합계 동점 — 최고 카드 비교 (${d0[i]} vs ${d1[i]})`;
          break;
        }
      }
    }
  }
  return { ...s, phase: 'done', result: { winner, detail } };
}
