/**
 * 블라인드 포커 (원작: 인디언 포커) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §3):
 * - 1~10 카드 × 2장 = 20장 덱. 각자 1장씩 받아 자신만 못 보게 이마에 부착.
 * - 핸드 시작 시 기본 베팅(안테) 1칩씩. 선부터 행동: 레이즈 / 콜(양쪽 베팅이 같아지면 즉시 쇼다운) / 폴드.
 * - 폴드하면 상대 승리. 단 10을 들고 폴드하면 페널티로 칩 10개를 추가로 상대에게 지급.
 * - 쇼다운: 높은 카드가 팟 획득. 무승부면 팟은 다음 핸드 승자에게 이월.
 * - 덱이 소진되면(10핸드) 새 20장 덱으로 교체 → 카드 카운팅 요소.
 * - 한 명이 칩을 모두 잃으면 패배.
 *
 * 공개 정보 규칙(카운팅의 비대칭성):
 * - 각자 "상대의 카드"는 매 핸드 항상 본다.
 * - 자기 카드는 쇼다운 때, 그리고 자기가 폴드했을 때(10 페널티 확인)만 공개된다.
 *   상대가 폴드해서 이긴 핸드의 내 카드는 나에게 영원히 비공개.
 */

export type PlayerId = 0 | 1;

export const STARTING_STACK = 30;
export const ANTE = 1;
export const TEN_PENALTY = 10;

export type HandOutcome = 'showdown' | 'fold' | 'draw';

export interface HandRecord {
  /** [p0 카드, p1 카드] */
  cards: [number, number];
  outcome: HandOutcome;
  /** fold일 때 폴드한 사람 */
  folder?: PlayerId;
  /** showdown/fold의 승자 (draw면 없음) */
  winner?: PlayerId;
  /** 승자가 가져간 칩 (이월 포함, 페널티 포함) */
  potWon: number;
  /** 10 폴드 페널티가 발생했는가 */
  penalty: boolean;
}

export type BpPhase = 'betting' | 'result' | 'gameover';

export interface BpAction {
  type: 'fold' | 'call' | 'raise';
  /** raise일 때: 상대 베팅액보다 얼마나 더 올릴지 */
  amount?: number;
}

export interface BpState {
  deck: number[];
  stacks: [number, number];
  /** 현재 핸드의 카드 */
  cards: [number, number];
  /** 이번 핸드에 각자 낸 칩(안테 포함) */
  invested: [number, number];
  /** 무승부로 이월된 칩 */
  carried: number;
  /** 이번 핸드의 선 */
  firstActor: PlayerId;
  toAct: PlayerId;
  phase: BpPhase;
  handNo: number;
  /** 현재 덱이 시작된 핸드 번호 (카운팅은 이 핸드부터 유효) */
  deckStartHand: number;
  history: HandRecord[];
  /** 이번 핸드의 행동 로그 (AI 추론용): [행위자, 행동] */
  actions: Array<{ player: PlayerId; action: BpAction }>;
}

function freshDeck(): number[] {
  const deck: number[] = [];
  for (let n = 1; n <= 10; n++) deck.push(n, n);
  // Fisher–Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** first를 주면 그 쪽이 첫 핸드의 선 (동전 던지기 결과) */
export function createGame(first?: PlayerId): BpState {
  const base: BpState = {
    deck: freshDeck(),
    stacks: [STARTING_STACK, STARTING_STACK],
    cards: [0, 0],
    invested: [0, 0],
    carried: 0,
    firstActor: first ?? (Math.random() < 0.5 ? 0 : 1),
    toAct: 0,
    phase: 'betting',
    handNo: 0,
    deckStartHand: 1,
    history: [],
    actions: [],
  };
  return dealHand(base);
}

function dealHand(s: BpState): BpState {
  // 파산 체크 (안테를 낼 수 없으면 패배)
  if (s.stacks[0] < ANTE || s.stacks[1] < ANTE) {
    return { ...s, phase: 'gameover' };
  }
  let deck = s.deck;
  let deckStartHand = s.deckStartHand;
  if (deck.length < 2) {
    deck = freshDeck();
    deckStartHand = s.handNo + 1; // 새 덱 → 카운팅 리셋
  }
  const cards: [number, number] = [deck[0], deck[1]];
  const firstActor = s.handNo === 0 ? s.firstActor : ((1 - s.firstActor) as PlayerId);
  return {
    ...s,
    deck: deck.slice(2),
    cards,
    invested: [ANTE, ANTE],
    stacks: [s.stacks[0] - ANTE, s.stacks[1] - ANTE],
    firstActor,
    toAct: firstActor,
    phase: 'betting',
    handNo: s.handNo + 1,
    deckStartHand,
    actions: [],
  };
}

/** 현재 팟 (양쪽 투자 + 이월) */
export function potSize(s: BpState): number {
  return s.invested[0] + s.invested[1] + s.carried;
}

export interface LegalInfo {
  canFold: boolean;
  /** 콜에 필요한 추가 칩 (0이면 체크성 콜 → 즉시 쇼다운) */
  callCost: number;
  /** 가능한 레이즈 증가량 목록 (양쪽 스택 한도 내) */
  raiseOptions: number[];
  /** 최대 레이즈 증가량 (올인 캡) */
  maxRaise: number;
}

export function legalInfo(s: BpState): LegalInfo {
  const p = s.toAct;
  const o = (1 - p) as PlayerId;
  const callCost = Math.min(s.invested[o] - s.invested[p], s.stacks[p]);
  // 레이즈 상한: 내가 낼 수 있는 만큼 + 상대가 따라올 수 있는 만큼
  const maxRaise = Math.max(
    0,
    Math.min(s.stacks[p] - callCost, s.stacks[o]),
  );
  const raiseOptions = [1, 3, 5, maxRaise]
    .filter((x, i, arr) => x > 0 && x <= maxRaise && arr.indexOf(x) === i)
    .sort((a, b) => a - b);
  return { canFold: true, callCost, raiseOptions, maxRaise };
}

export function act(s: BpState, a: BpAction): BpState {
  if (s.phase !== 'betting') throw new Error('not in betting phase');
  const p = s.toAct;
  const o = (1 - p) as PlayerId;
  const next: BpState = {
    ...s,
    stacks: [...s.stacks] as [number, number],
    invested: [...s.invested] as [number, number],
    actions: [...s.actions, { player: p, action: a }],
  };

  if (a.type === 'fold') {
    const penalty = s.cards[p] === 10;
    const penaltyChips = penalty ? Math.min(TEN_PENALTY, next.stacks[p]) : 0;
    next.stacks[p] -= penaltyChips;
    const potWon = potSize(s) + penaltyChips;
    next.stacks[o] += potWon;
    next.carried = 0;
    next.invested = [0, 0];
    next.history = [
      ...s.history,
      { cards: s.cards, outcome: 'fold', folder: p, winner: o, potWon, penalty },
    ];
    next.phase = 'result';
    return next;
  }

  if (a.type === 'call') {
    const cost = Math.min(s.invested[o] - s.invested[p], next.stacks[p]);
    next.stacks[p] -= cost;
    next.invested[p] += cost;
    // 베팅 동액 → 쇼다운
    return showdown(next);
  }

  // raise
  const info = legalInfo(s);
  const amount = Math.min(a.amount ?? 1, info.maxRaise);
  if (amount <= 0) return act(s, { type: 'call' });
  const target = s.invested[o] + amount;
  const cost = target - s.invested[p];
  next.stacks[p] -= cost;
  next.invested[p] = target;
  next.toAct = o;
  return next;
}

function showdown(s: BpState): BpState {
  const [c0, c1] = s.cards;
  const next = { ...s };
  if (c0 === c1) {
    // 무승부 — 팟 이월
    next.carried = potSize(s);
    next.invested = [0, 0];
    next.history = [
      ...s.history,
      { cards: s.cards, outcome: 'draw', potWon: 0, penalty: false },
    ];
  } else {
    const winner: PlayerId = c0 > c1 ? 0 : 1;
    const potWon = potSize(s);
    next.stacks = [...s.stacks] as [number, number];
    next.stacks[winner] += potWon;
    next.carried = 0;
    next.invested = [0, 0];
    next.history = [
      ...s.history,
      { cards: s.cards, outcome: 'showdown', winner, potWon, penalty: false },
    ];
  }
  next.phase = 'result';
  return next;
}

/** result 화면에서 다음 핸드로 진행 */
export function nextHand(s: BpState): BpState {
  if (s.phase !== 'result') throw new Error('not in result phase');
  return dealHand(s);
}

export function gameWinner(s: BpState): PlayerId | null {
  if (s.phase !== 'gameover') return null;
  return s.stacks[0] > s.stacks[1] ? 0 : 1;
}

/**
 * `viewer`가 지금까지 본 카드들 (카운팅용).
 * - 상대의 카드: 모든 핸드에서 항상 봄 (현재 핸드 포함)
 * - 자기 카드: 쇼다운/무승부 핸드 + 자기가 폴드한 핸드에서만 봄
 */
export function seenCards(s: BpState, viewer: PlayerId): number[] {
  const seen: number[] = [];
  // 현재 덱에서 진행된 핸드만 카운팅 대상 (history[i]는 핸드 i+1)
  for (const h of s.history.slice(s.deckStartHand - 1)) {
    seen.push(h.cards[1 - viewer]); // 상대 카드는 항상 봤음
    if (h.outcome !== 'fold' || h.folder === viewer) {
      seen.push(h.cards[viewer]); // 쇼다운·무승부·본인 폴드 시 내 카드 공개
    }
  }
  if (s.phase === 'betting') {
    seen.push(s.cards[1 - viewer]); // 현재 핸드 상대 카드
  }
  return seen;
}

/**
 * `viewer` 시점에서 "내 이마 카드일 수 있는" 카드들의 잔여 분포.
 * 현재 덱에 남은 카드 + 내 이마 카드 = 20 - seen. (내 카드는 그 안에서 균등)
 */
export function unseenCounts(s: BpState, viewer: PlayerId): number[] {
  const counts = new Array<number>(11).fill(0); // index 1..10
  for (let n = 1; n <= 10; n++) counts[n] = 2;
  for (const c of seenCards(s, viewer)) counts[c] -= 1;
  return counts;
}
