/**
 * 블라인드 홀덤 (원작: 인디언 홀덤) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §15):
 * - 1~10 × 4세트 = 40장. 매 핸드 2장 버닝(끝까지 비공개) + 공유 카드 2장 공개 +
 *   각자 1장을 자신만 못 보게 이마에 부착. 남은 카드 6장 미만이면 새 덱.
 * - 핸드 = 공유 2장 + 내 이마 1장. 공유 카드가 같으므로 두 사람의 핸드는 이마 하나만 다르다.
 * - 족보: 트리플 > 스트레이트 > 더블 > 하이카드. 스트레이트는 1~10 원형(9-10-1, 10-1-2 포함).
 * - 폴드하면 상대가 팟 획득. 단 **스트레이트/트리플을 들고 폴드하면 칩 10개 추가 지급**
 *   (인디언 포커의 "10 폴드 페널티"가 족보 기준으로 바뀐 것 — 원작의 핵심 차이).
 * - 같은 족보끼리는 이마 카드가 높은 쪽 승리, 그마저 같으면 무승부(팟 이월).
 * - 칩을 모두 잃으면 패배.
 *
 * 공개 정보 규칙:
 * - 공유 카드 2장은 항상 양쪽 공개 → **상대 족보는 계산 가능**하지만 내 족보는 모른다.
 * - 자기 이마는 쇼다운 때, 그리고 자기가 폴드했을 때(페널티 확인)만 공개된다.
 * - 버닝 2장은 영구 비공개 → 카운팅은 불완전 정보로 남는다.
 */

export type PlayerId = 0 | 1;

export const STARTING_STACK = 30;
export const ANTE = 1;
export const COMBO_PENALTY = 10;
/** 한 핸드에 소비되는 카드 수 (버닝 2 + 공유 2 + 이마 2) */
export const CARDS_PER_HAND = 6;

/** 족보 등급 — 높을수록 강하다 */
export const RANK_HIGH = 0;
export const RANK_DOUBLE = 1;
export const RANK_STRAIGHT = 2;
export const RANK_TRIPLE = 3;

export type HandOutcome = 'showdown' | 'fold' | 'draw';

export interface HandRecord {
  /** 이 핸드의 공유 카드 */
  community: [number, number];
  /** [p0 이마, p1 이마] */
  cards: [number, number];
  outcome: HandOutcome;
  folder?: PlayerId;
  winner?: PlayerId;
  potWon: number;
  /** 스트레이트/트리플 폴드 페널티가 발생했는가 */
  penalty: boolean;
  /** 폴드한 쪽의 족보 등급 (페널티 사유 표시용) */
  folderRank?: number;
}

export type BhPhase = 'betting' | 'result' | 'gameover';

export interface BhAction {
  type: 'fold' | 'call' | 'raise';
  /** raise일 때: 상대 베팅액보다 얼마나 더 올릴지 */
  amount?: number;
}

export interface BhState {
  deck: number[];
  stacks: [number, number];
  /** 이번 핸드의 공유 카드 (항상 공개) */
  community: [number, number];
  /** 이번 핸드의 이마 카드 */
  cards: [number, number];
  invested: [number, number];
  carried: number;
  firstActor: PlayerId;
  toAct: PlayerId;
  phase: BhPhase;
  handNo: number;
  /** 현재 덱이 시작된 핸드 번호 (카운팅은 이 핸드부터 유효) */
  deckStartHand: number;
  history: HandRecord[];
  /** 이번 핸드의 행동 로그 (AI 추론용) */
  actions: Array<{ player: PlayerId; action: BhAction }>;
}

// ---------- 족보 판정 ----------

const wrap = (x: number): number => ((x - 1 + 10) % 10) + 1;

/** 세 값이 1~10 원형에서 연속 3장인가 (9-10-1, 10-1-2 포함) */
export function isCircularRun(a: number, b: number, c: number): boolean {
  if (a === b || b === c || a === c) return false;
  const set = [a, b, c].sort((x, y) => x - y).join(',');
  for (let s = 1; s <= 10; s++) {
    const run = [s, wrap(s + 1), wrap(s + 2)].sort((x, y) => x - y).join(',');
    if (run === set) return true;
  }
  return false;
}

/** 공유 2장 + 이마 1장의 족보 등급 */
export function handRank(community: [number, number], forehead: number): number {
  const [a, b] = community;
  if (a === b && b === forehead) return RANK_TRIPLE;
  if (isCircularRun(a, b, forehead)) return RANK_STRAIGHT;
  if (a === b || a === forehead || b === forehead) return RANK_DOUBLE;
  return RANK_HIGH;
}

export const RANK_NAME = ['하이카드', '더블', '스트레이트', '트리플'] as const;

/** 폴드 페널티 대상 족보인가 (스트레이트 이상) */
export function isPenaltyRank(rank: number): boolean {
  return rank >= RANK_STRAIGHT;
}

/** 공유 카드가 만드는 폴드 위험 프로필 — 원작의 판독표 그대로 */
export type RiskProfile = 'triple' | 'straight' | 'safe';

export function riskProfile(community: [number, number]): RiskProfile {
  const [a, b] = community;
  if (a === b) return 'triple';
  const raw = Math.abs(a - b);
  const circular = Math.min(raw, 10 - raw);
  return circular <= 2 ? 'straight' : 'safe';
}

/** 이 공유 카드에서 페널티를 유발하는 이마 카드 값들 */
export function penaltyCards(community: [number, number]): number[] {
  const out: number[] = [];
  for (let v = 1; v <= 10; v++) {
    if (isPenaltyRank(handRank(community, v))) out.push(v);
  }
  return out;
}

/**
 * 두 핸드 비교 — 족보 등급 우선, 같으면 이마 카드가 높은 쪽.
 * 공유 카드가 동일하므로 이마 비교가 스트레이트 높낮이·페어 킥커 비교와 일치한다.
 * @returns 양수 = 0번이 승, 음수 = 1번이 승, 0 = 무승부
 */
export function compareHands(
  community: [number, number],
  f0: number,
  f1: number,
): number {
  const r0 = handRank(community, f0);
  const r1 = handRank(community, f1);
  if (r0 !== r1) return r0 - r1;
  return f0 - f1;
}

// ---------- 진행 ----------

function freshDeck(): number[] {
  const deck: number[] = [];
  for (let n = 1; n <= 10; n++) for (let k = 0; k < 4; k++) deck.push(n);
  // Fisher–Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** first를 주면 그 쪽이 첫 핸드의 선 (동전 던지기 결과) */
export function createGame(first?: PlayerId): BhState {
  const base: BhState = {
    deck: freshDeck(),
    stacks: [STARTING_STACK, STARTING_STACK],
    community: [0, 0],
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

function dealHand(s: BhState): BhState {
  // 파산 체크 (앤티를 낼 수 없으면 패배)
  if (s.stacks[0] < ANTE || s.stacks[1] < ANTE) {
    return { ...s, phase: 'gameover' };
  }
  let deck = s.deck;
  let deckStartHand = s.deckStartHand;
  if (deck.length < CARDS_PER_HAND) {
    deck = freshDeck();
    deckStartHand = s.handNo + 1; // 새 덱 → 카운팅 리셋
  }
  // 버닝 2장(deck[0..1])은 끝까지 공개되지 않는다
  const community: [number, number] = [deck[2], deck[3]];
  const cards: [number, number] = [deck[4], deck[5]];
  const firstActor = s.handNo === 0 ? s.firstActor : ((1 - s.firstActor) as PlayerId);
  return {
    ...s,
    deck: deck.slice(CARDS_PER_HAND),
    community,
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
export function potSize(s: BhState): number {
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

export function legalInfo(s: BhState): LegalInfo {
  const p = s.toAct;
  const o = (1 - p) as PlayerId;
  const callCost = Math.min(s.invested[o] - s.invested[p], s.stacks[p]);
  // 레이즈 상한: 내가 낼 수 있는 만큼 + 상대가 따라올 수 있는 만큼
  const maxRaise = Math.max(0, Math.min(s.stacks[p] - callCost, s.stacks[o]));
  const raiseOptions = [1, 3, 5, maxRaise]
    .filter((x, i, arr) => x > 0 && x <= maxRaise && arr.indexOf(x) === i)
    .sort((a, b) => a - b);
  return { canFold: true, callCost, raiseOptions, maxRaise };
}

export function act(s: BhState, a: BhAction): BhState {
  if (s.phase !== 'betting') throw new Error('not in betting phase');
  const p = s.toAct;
  const o = (1 - p) as PlayerId;
  const next: BhState = {
    ...s,
    stacks: [...s.stacks] as [number, number],
    invested: [...s.invested] as [number, number],
    actions: [...s.actions, { player: p, action: a }],
  };

  if (a.type === 'fold') {
    const folderRank = handRank(s.community, s.cards[p]);
    const penalty = isPenaltyRank(folderRank);
    const penaltyChips = penalty ? Math.min(COMBO_PENALTY, next.stacks[p]) : 0;
    next.stacks[p] -= penaltyChips;
    const potWon = potSize(s) + penaltyChips;
    next.stacks[o] += potWon;
    next.carried = 0;
    next.invested = [0, 0];
    next.history = [
      ...s.history,
      {
        community: s.community,
        cards: s.cards,
        outcome: 'fold',
        folder: p,
        winner: o,
        potWon,
        penalty,
        folderRank,
      },
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

function showdown(s: BhState): BhState {
  const cmp = compareHands(s.community, s.cards[0], s.cards[1]);
  const next = { ...s };
  if (cmp === 0) {
    // 무승부 — 팟 이월
    next.carried = potSize(s);
    next.invested = [0, 0];
    next.history = [
      ...s.history,
      { community: s.community, cards: s.cards, outcome: 'draw', potWon: 0, penalty: false },
    ];
  } else {
    const winner: PlayerId = cmp > 0 ? 0 : 1;
    const potWon = potSize(s);
    next.stacks = [...s.stacks] as [number, number];
    next.stacks[winner] += potWon;
    next.carried = 0;
    next.invested = [0, 0];
    next.history = [
      ...s.history,
      { community: s.community, cards: s.cards, outcome: 'showdown', winner, potWon, penalty: false },
    ];
  }
  next.phase = 'result';
  return next;
}

/** result 화면에서 다음 핸드로 진행 */
export function nextHand(s: BhState): BhState {
  if (s.phase !== 'result') throw new Error('not in result phase');
  return dealHand(s);
}

export function gameWinner(s: BhState): PlayerId {
  return s.stacks[0] > s.stacks[1] ? 0 : 1;
}

/**
 * seat이 지금까지 본 카드 전부 (카운팅용).
 * 공유 카드는 항상 공개, 상대 이마는 항상 공개, 내 이마는 공개된 핸드만.
 * 버닝 카드는 영구 비공개이므로 포함하지 않는다.
 */
export function seenCards(s: BhState, seat: PlayerId): number[] {
  const opp = (1 - seat) as PlayerId;
  const out: number[] = [];
  const fromHand = (h: HandRecord) => {
    out.push(h.community[0], h.community[1]);
    out.push(h.cards[opp]);
    // 내 이마: 쇼다운/무승부는 공개, 폴드는 내가 폴드한 경우만 공개
    if (h.outcome !== 'fold' || h.folder === seat) out.push(h.cards[seat]);
  };
  for (const h of s.history) {
    if (h.community[0] === 0) continue;
    fromHand(h);
  }
  // 진행 중인 핸드
  if (s.phase === 'betting' && s.community[0] !== 0) {
    out.push(s.community[0], s.community[1], s.cards[opp]);
  }
  return out;
}

/** 현재 덱에서 아직 보지 못한 카드의 값별 잔량 (index 1..10) */
export function remainingCounts(s: BhState, seat: PlayerId): number[] {
  const counts = new Array<number>(11).fill(4);
  // 현재 덱이 시작된 이후의 관찰만 유효
  const since = s.history.filter((h) => h.community[0] !== 0);
  const opp = (1 - seat) as PlayerId;
  const startIdx = Math.max(0, s.deckStartHand - 1);
  for (let i = startIdx; i < since.length; i++) {
    const h = since[i];
    counts[h.community[0]] -= 1;
    counts[h.community[1]] -= 1;
    counts[h.cards[opp]] -= 1;
    if (h.outcome !== 'fold' || h.folder === seat) counts[h.cards[seat]] -= 1;
  }
  if (s.phase === 'betting' && s.community[0] !== 0) {
    counts[s.community[0]] -= 1;
    counts[s.community[1]] -= 1;
    counts[s.cards[opp]] -= 1;
  }
  for (let v = 1; v <= 10; v++) counts[v] = Math.max(0, counts[v]);
  return counts;
}
