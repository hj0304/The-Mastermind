/**
 * 야누스 포커 (원작: 양면포커, 그랜드 파이널 룰) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §9):
 * - 양면 카드: 1~10, 앞뒤 홀짝이 반드시 다름 — 50종 × 4세트 = 200장. 칩 40개씩.
 * - 각자 1장: 앞면 공개, 뒷면 본인만. 기본 베팅 1개씩.
 * - 선부터 베팅할 면(앞/뒤)을 공개 선언 후 베팅. 면은 이후 변경 불가.
 *   같은 개수(콜) → 즉시 종료, 선택 면 공개, 높은 숫자 승. 더 많이(레이즈) → 지속.
 * - 선은 베팅 없이 포기 가능. 포기하면 상대 승리, 포기 판의 뒷면은 공개되지 않음.
 * - 무승부: 팟이 다음 판 승자에게 이월.
 * - 양면베팅: 양면 모두에 같은 금액(항상 2배 지불). 양면 모두 상대 선택 면보다
 *   높아야 승리(+상대 칩 10개). 한 면이라도 같거나 낮으면 패배(단 10개 페널티 없음).
 *   상대는 양면베팅에 폴드해도 10개를 내야 한다. 양면 선언은 첫 액션에서만,
 *   상대가 이미 양면이면 불가.
 * - 칩을 모두 잃으면 패배. (안전장치) 500번째 핸드 이후 칩 많은 쪽 승리.
 */

export type PlayerId = 0 | 1;
export type Face = 'front' | 'back' | 'both';

export interface JCard {
  front: number;
  back: number;
}

/** 카운팅용 공개 기록 — back이 null이면 뒷면 영구 비공개 */
export interface RevealRec {
  front: number;
  back: number | null;
}

export interface HandResult {
  winner: PlayerId | null; // null = 무승부(이월)
  reason: 'showdown' | 'fold' | 'both-win' | 'both-lose';
  folder: PlayerId | null;
  /** 공개된 선택 면 값 (미공개 null) */
  values: [number | null, number | null];
  faces: [Face | null, Face | null];
  pot: number;
  penalty: number; // 양면 관련 추가 이동 칩 (10 또는 잔여)
  penaltyTo: PlayerId | null;
}

export type JPAction =
  | { kind: 'fold' }
  | { kind: 'bet'; face: Face; level: number } // 첫 액션 (면 확정)
  | { kind: 'call' }
  | { kind: 'raise'; level: number };

export interface JPState {
  stacks: [number, number];
  deck: JCard[];
  seen: RevealRec[];
  cards: [JCard, JCard];
  first: PlayerId;
  turn: PlayerId;
  faces: [Face | null, Face | null];
  /** 단면 기준 현재 베팅 레벨 (양면은 2배 지불) */
  level: number;
  /** 이번 핸드에 낸 칩 (앤티 포함) */
  paid: [number, number];
  carry: number;
  handNo: number;
  lastResult: HandResult | null;
  phase: 'act' | 'handover' | 'gameover';
  result: { winner: PlayerId } | null;
}

export const START_CHIPS = 40;
export const BOTH_PENALTY = 10;

export function buildDeck(): JCard[] {
  const deck: JCard[] = [];
  for (let f = 1; f <= 10; f++) {
    for (let b = 1; b <= 10; b++) {
      if ((f + b) % 2 === 1) {
        for (let k = 0; k < 4; k++) deck.push({ front: f, back: b });
      }
    }
  }
  // 셔플
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createGame(first: PlayerId): JPState {
  const s: JPState = {
    stacks: [START_CHIPS, START_CHIPS],
    deck: buildDeck(),
    seen: [],
    cards: [
      { front: 0, back: 0 },
      { front: 0, back: 0 },
    ],
    first,
    turn: first,
    faces: [null, null],
    level: 0,
    paid: [0, 0],
    carry: 0,
    handNo: 0,
    lastResult: null,
    phase: 'act',
    result: null,
  };
  return deal(s);
}

function deal(s: JPState): JPState {
  let deck = s.deck;
  let seen = s.seen;
  if (deck.length < 2) {
    deck = buildDeck(); // 새 덱 — 카운팅 기록 초기화
    seen = [];
  }
  const cards: [JCard, JCard] = [deck[0], deck[1]];
  const stacks: [number, number] = [s.stacks[0] - 1, s.stacks[1] - 1]; // 앤티
  return {
    ...s,
    deck: deck.slice(2),
    seen,
    cards,
    stacks,
    turn: s.first,
    faces: [null, null],
    level: 0,
    paid: [1, 1],
    handNo: s.handNo + 1,
    phase: 'act',
  };
}

function mult(face: Face | null): number {
  return face === 'both' ? 2 : 1;
}

/** 특정 면으로 베팅할 때 actor가 갈 수 있는 최대 레벨 (양쪽 모두 지불 가능해야 함) */
export function maxLevelFor(s: JPState, actor: PlayerId, face: Face): number {
  const opp = (1 - actor) as PlayerId;
  // 각자 보유 = 스택 + 이미 낸 칩 - 앤티 1. 양면은 2배 지불이라 상한이 절반.
  const mine = Math.floor((s.stacks[actor] + s.paid[actor] - 1) / mult(face));
  // 상대는 아직 면 미선택이면 일반(1배) 기준으로 콜 가능해야 함
  const theirs = Math.floor((s.stacks[opp] + s.paid[opp] - 1) / mult(s.faces[opp]));
  return Math.max(0, Math.min(mine, theirs));
}

/** actor가 올릴 수 있는 최대 레벨 (이미 선택한 면 기준) */
export function maxLevel(s: JPState, actor: PlayerId): number {
  return maxLevelFor(s, actor, s.faces[actor] ?? 'front');
}

/** 현재 액터가 콜하는 데 필요한 추가 칩 */
export function callCost(s: JPState, actor: PlayerId): number {
  const target = 1 + s.level * mult(s.faces[actor] ?? 'front');
  return Math.max(0, target - s.paid[actor]);
}

function payTo(s: JPState, p: PlayerId, level: number, face: Face): { stacks: [number, number]; paid: [number, number] } {
  const target = 1 + level * mult(face);
  const add = target - s.paid[p];
  if (add < 0) throw new Error('cannot reduce bet');
  if (add > s.stacks[p]) throw new Error('not enough chips');
  const stacks: [number, number] = [...s.stacks];
  const paid: [number, number] = [...s.paid];
  stacks[p] -= add;
  paid[p] += add;
  return { stacks, paid };
}

export function applyAction(s: JPState, a: JPAction): JPState {
  if (s.phase !== 'act') throw new Error('not act phase');
  const p = s.turn;
  const o = (1 - p) as PlayerId;

  if (a.kind === 'fold') {
    return settleFold(s, p);
  }

  if (a.kind === 'bet') {
    if (s.faces[p] !== null) throw new Error('face already chosen');
    if (a.face === 'both' && s.faces[o] === 'both') throw new Error('both vs both not allowed');
    if (!Number.isInteger(a.level) || a.level < Math.max(1, s.level)) throw new Error('bad level');
    if (a.level > maxLevelFor(s, p, a.face)) throw new Error('level too high');
    const faces = withFace(s.faces, p, a.face);
    const { stacks, paid } = payTo({ ...s, faces } as JPState, p, a.level, a.face);
    const next: JPState = { ...s, faces, stacks, paid, level: a.level };
    // 상대가 이미 베팅했고 같은 레벨이면 콜 = 쇼다운
    if (s.faces[o] !== null && a.level === s.level) return showdown(next);
    return { ...next, turn: o };
  }

  if (s.faces[p] === null) throw new Error('choose face first');

  if (a.kind === 'call') {
    if (s.faces[o] === null || s.level < 1) throw new Error('nothing to call');
    const { stacks, paid } = payTo(s, p, s.level, s.faces[p]!);
    return showdown({ ...s, stacks, paid });
  }

  // raise
  if (!Number.isInteger(a.level) || a.level <= s.level) throw new Error('raise must exceed level');
  if (a.level > maxLevel(s, p)) throw new Error('level too high');
  const { stacks, paid } = payTo(s, p, a.level, s.faces[p]!);
  return { ...s, stacks, paid, level: a.level, turn: o };
}

function withFace(faces: [Face | null, Face | null], p: PlayerId, f: Face): [Face | null, Face | null] {
  const out: [Face | null, Face | null] = [...faces];
  out[p] = f;
  return out;
}

function faceValue(card: JCard, face: Face): number {
  return face === 'front' ? card.front : card.back;
}

function settleFold(s: JPState, folder: PlayerId): JPState {
  const winner = (1 - folder) as PlayerId;
  const pot = s.paid[0] + s.paid[1] + s.carry;
  const stacks: [number, number] = [...s.stacks];
  stacks[winner] += pot;
  // 상대의 양면베팅에 폴드하면 10개 추가 지급
  let penalty = 0;
  if (s.faces[winner] === 'both') {
    penalty = Math.min(BOTH_PENALTY, stacks[folder]);
    stacks[folder] -= penalty;
    stacks[winner] += penalty;
  }
  const rec: HandResult = {
    winner,
    reason: 'fold',
    folder,
    values: [null, null],
    faces: [...s.faces],
    pot,
    penalty,
    penaltyTo: penalty > 0 ? winner : null,
  };
  // 폴드 판: 양쪽 뒷면 모두 비공개
  const seen = [
    ...s.seen,
    { front: s.cards[0].front, back: null },
    { front: s.cards[1].front, back: null },
  ];
  return finishHand(s, stacks, 0, rec, seen);
}

function showdown(s: JPState): JPState {
  const stacks: [number, number] = [...s.stacks];
  const pot = s.paid[0] + s.paid[1] + s.carry;
  const f0 = s.faces[0]!;
  const f1 = s.faces[1]!;
  let winner: PlayerId | null;
  let reason: HandResult['reason'] = 'showdown';
  let penalty = 0;
  let penaltyTo: PlayerId | null = null;

  const bothP: PlayerId | null = f0 === 'both' ? 0 : f1 === 'both' ? 1 : null;
  const values: [number | null, number | null] = [null, null];

  if (bothP !== null) {
    const other = (1 - bothP) as PlayerId;
    const oppVal = faceValue(s.cards[other], s.faces[other]!);
    const lo = Math.min(s.cards[bothP].front, s.cards[bothP].back);
    values[other] = oppVal;
    values[bothP] = lo; // 표시용: 양면의 낮은 값
    if (lo > oppVal) {
      winner = bothP;
      reason = 'both-win';
      penalty = Math.min(BOTH_PENALTY, stacks[other]);
      stacks[other] -= penalty;
      stacks[bothP] += penalty;
      penaltyTo = bothP;
    } else {
      winner = other;
      reason = 'both-lose'; // 양면 실패 — 페널티 없음
    }
  } else {
    const v0 = faceValue(s.cards[0], f0);
    const v1 = faceValue(s.cards[1], f1);
    values[0] = v0;
    values[1] = v1;
    winner = v0 === v1 ? null : v0 > v1 ? 0 : 1;
  }

  let carry = 0;
  if (winner === null) {
    carry = pot; // 이월
  } else {
    stacks[winner] += pot;
  }

  const rec: HandResult = {
    winner,
    reason,
    folder: null,
    values,
    faces: [f0, f1],
    pot,
    penalty,
    penaltyTo,
  };
  // 공개 기록: 선택 면이 뒷면/양면이면 뒷면 공개, 앞면만 썼으면 뒷면 비공개
  const seen = [
    ...s.seen,
    { front: s.cards[0].front, back: f0 !== 'front' ? s.cards[0].back : null },
    { front: s.cards[1].front, back: f1 !== 'front' ? s.cards[1].back : null },
  ];
  return finishHand(s, stacks, carry, rec, seen);
}

function finishHand(
  s: JPState,
  stacks: [number, number],
  carry: number,
  rec: HandResult,
  seen: RevealRec[],
): JPState {
  const next: JPState = { ...s, stacks, carry, seen, lastResult: rec, phase: 'handover' };
  for (const p of [0, 1] as PlayerId[]) {
    if (stacks[p] <= 0) {
      return { ...next, phase: 'gameover', result: { winner: (1 - p) as PlayerId } };
    }
  }
  if (s.handNo >= 500) {
    return {
      ...next,
      phase: 'gameover',
      result: { winner: stacks[0] >= stacks[1] ? 0 : 1 },
    };
  }
  return next;
}

/** 다음 핸드 시작 (선 교대) */
export function nextHand(s: JPState): JPState {
  if (s.phase !== 'handover') throw new Error('not handover');
  return deal({ ...s, first: (1 - s.first) as PlayerId });
}
