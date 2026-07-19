/**
 * 히든 포뮬러 (원작: 더 지니어스 미스터리 사인 / 모티브: 파라오코드) 게임 엔진.
 * 룰 상세: docs/GAME_RULES.md §14
 *
 * 11라운드. 라운드마다 X ? Y 문제(?는 숨은 규칙). 번갈아 수를 제시해
 * A ? B = C 힌트를 얻고, 버저 → 정답 +1 / 오답 −1(기회는 상대에게).
 * 힌트 16개까지, 이후 다음 라운드. 최종 승점 승부(동점 시 연장).
 */

export type PlayerId = 0 | 1;

export const ROUNDS = 11;
export const MAX_HINTS = 16;
export const WINDOW_SECONDS = 60;
/** 버저를 누른 뒤 정답을 말해야 하는 제한 시간 — 넘기면 오답 처리 */
export const ANSWER_SECONDS = 10;
export const MAX_NUM = 999999;

// ---------- 규칙 은행 ----------

export interface Rule {
  id: string;
  /** 라운드 종료 후 공개되는 설명 */
  desc: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  fn: (a: number, b: number) => string;
}

const ds = (n: number): number => String(n).split('').reduce((s, d) => s + Number(d), 0);
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const CIRCLE: Record<string, number> = { '0': 1, '6': 1, '8': 2, '9': 1 };

/** 처음 나온 순서대로 (숫자, 그 숫자의 총 개수)를 이어 쓴다 — 원작 5라운드 규칙 */
function digitFreq(s: string): string {
  const order: string[] = [];
  const count = new Map<string, number>();
  for (const d of s) {
    if (!count.has(d)) order.push(d);
    count.set(d, (count.get(d) ?? 0) + 1);
  }
  return order.map((d) => d + String(count.get(d))).join('');
}

/** 원작(그랜드 파이널 결승) 출제 규칙 + 동계열 확장 */
export const RULES: Rule[] = [
  { id: 'sum', desc: '두 수의 합', difficulty: 1, fn: (a, b) => String(a + b) },
  { id: 'diff', desc: '두 수의 차', difficulty: 1, fn: (a, b) => String(Math.abs(a - b)) },
  { id: 'prod', desc: '두 수의 곱', difficulty: 2, fn: (a, b) => String(a * b) },
  { id: 'big-plus-diff', desc: '(큰 수) + (두 수의 차)', difficulty: 2, fn: (a, b) => String(Math.max(a, b) + Math.abs(a - b)) },
  { id: 'concat-sum-diff', desc: '(두 수의 합)(두 수의 차)를 이어 쓴 수', difficulty: 3, fn: (a, b) => `${a + b}${Math.abs(a - b)}` },
  { id: 'mod-big-small', desc: '(큰 수) ÷ (작은 수)의 나머지', difficulty: 2, fn: (a, b) => String(Math.max(a, b) % Math.min(a, b)) },
  { id: 'digitsum-prod', desc: '(앞 수의 자릿수 합) × (뒤 수의 자릿수 합)', difficulty: 3, fn: (a, b) => String(ds(a) * ds(b)) },
  { id: 'digitsum-all', desc: '모든 자리 숫자의 합', difficulty: 2, fn: (a, b) => String(ds(a) + ds(b)) },
  { id: 'clock', desc: '(두 수의 합) ÷ 12의 나머지 — 시계', difficulty: 3, fn: (a, b) => String((a + b) % 12) },
  { id: 'sum-times-b', desc: '(두 수의 합) × (뒤의 수)', difficulty: 2, fn: (a, b) => String((a + b) * b) },
  { id: 'circles', desc: '두 수에 포함된 동그라미 개수 (0·6·9=1, 8=2)', difficulty: 4, fn: (a, b) => String((String(a) + String(b)).split('').reduce((s, d) => s + (CIRCLE[d] ?? 0), 0)) },
  { id: 'digit-freq', desc: '두 수를 이어 쓰고 처음 나온 순서대로 (숫자, 그 숫자의 개수)를 표기', difficulty: 5, fn: (a, b) => digitFreq(String(a) + String(b)) },
  { id: 'gcd', desc: '두 수의 최대공약수', difficulty: 3, fn: (a, b) => String(gcd(Math.max(a, b), Math.min(a, b))) },
  { id: 'digit-count', desc: '두 수의 자릿수 개수의 합', difficulty: 2, fn: (a, b) => String(String(a).length + String(b).length) },
  { id: 'last-digit-prod', desc: '(두 수의 곱)의 일의 자리', difficulty: 3, fn: (a, b) => String((a * b) % 10) },
];

// ---------- 상태 ----------

export interface Hint {
  a: number;
  b: number;
  c: string;
}

export interface HFState {
  round: number; // 1-based
  scores: [number, number];
  /** 이번 게임의 라운드별 규칙 인덱스 — UI/AI는 절대 직접 읽지 않는다 */
  ruleOrder: number[];
  X: number;
  Y: number;
  hints: Hint[];
  /** 이번 라운드 선 (힌트의 앞 수 제시) */
  first: PlayerId;
  phase: 'num1' | 'num2' | 'window' | 'answer' | 'roundend' | 'gameover';
  num1: number | null;
  answerer: PlayerId | null;
  /** 현재 힌트에서 이미 오답을 낸 플레이어 (버저 불가) */
  wrongBuzzed: [boolean, boolean];
  lastRound: { winner: PlayerId | null; answer: string; ruleDesc: string } | null;
  result: { winner: PlayerId } | null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeProblem(): [number, number] {
  const x = 4 + Math.floor(Math.random() * 21); // 4~24
  let y = 4 + Math.floor(Math.random() * 21);
  while (y === x) y = 4 + Math.floor(Math.random() * 21);
  return [x, y];
}

export function createGame(first: PlayerId): HFState {
  const order = shuffle(RULES.map((_, i) => i)).slice(0, ROUNDS);
  const [X, Y] = makeProblem();
  return {
    round: 1,
    scores: [0, 0],
    ruleOrder: order,
    X,
    Y,
    hints: [],
    first,
    phase: 'num1',
    num1: null,
    answerer: null,
    wrongBuzzed: [false, false],
    lastRound: null,
    result: null,
  };
}

function currentRule(s: HFState): Rule {
  return RULES[s.ruleOrder[s.round - 1]];
}

/** 이번 라운드 정답 (검증용 — UI는 라운드 종료 전 호출 금지) */
export function roundAnswer(s: HFState): string {
  return currentRule(s).fn(s.X, s.Y);
}

function validNum(s: HFState, n: number, other: number | null): boolean {
  if (!Number.isInteger(n) || n < 1 || n > MAX_NUM) return false;
  // 문제의 두 수를 동시에 다 쓰는 것 금지 (순서 무관)
  if (other !== null) {
    const pair = new Set([n, other]);
    if (pair.has(s.X) && pair.has(s.Y) && pair.size === 2) return false;
  }
  return true;
}

/** 수 제시 (num1: 선, num2: 후) */
export function submitNum(s: HFState, n: number): HFState {
  if (s.phase === 'num1') {
    if (!validNum(s, n, null)) throw new Error('bad num');
    return { ...s, phase: 'num2', num1: n };
  }
  if (s.phase === 'num2') {
    if (!validNum(s, n, s.num1)) throw new Error('bad num');
    const a = s.num1!;
    const b = n;
    const c = currentRule(s).fn(a, b);
    return {
      ...s,
      phase: 'window',
      num1: null,
      hints: [...s.hints, { a, b, c }],
      wrongBuzzed: [false, false],
    };
  }
  throw new Error('bad phase');
}

export function buzz(s: HFState, p: PlayerId): HFState {
  if (s.phase !== 'window') throw new Error('bad phase');
  if (s.wrongBuzzed[p]) throw new Error('already wrong');
  return { ...s, phase: 'answer', answerer: p };
}

function endRound(s: HFState, winner: PlayerId | null, scores: [number, number]): HFState {
  return {
    ...s,
    scores,
    phase: 'roundend',
    answerer: null,
    lastRound: { winner, answer: roundAnswer(s), ruleDesc: currentRule(s).desc },
  };
}

export function submitAnswer(s: HFState, ans: string): HFState {
  if (s.phase !== 'answer' || s.answerer === null) throw new Error('bad phase');
  const p = s.answerer;
  const correct = ans.trim() === roundAnswer(s);
  const scores: [number, number] = [...s.scores];
  if (correct) {
    scores[p] += 1;
    return endRound(s, p, scores);
  }
  scores[p] -= 1;
  const wrongBuzzed: [boolean, boolean] = [...s.wrongBuzzed];
  wrongBuzzed[p] = true;
  // 기회는 상대에게 — 상대도 이미 틀렸다면 다음 힌트로
  if (wrongBuzzed[0] && wrongBuzzed[1]) {
    const timedOut = advanceHint({ ...s, scores, wrongBuzzed, phase: 'window', answerer: null });
    return timedOut;
  }
  return { ...s, scores, wrongBuzzed, phase: 'window', answerer: null };
}

/**
 * 버저를 누르고 제한 시간 안에 답하지 못함 → 오답과 동일 처리
 * (-1점, 기회는 상대에게).
 */
export function answerTimeout(s: HFState): HFState {
  if (s.phase !== 'answer' || s.answerer === null) throw new Error('bad phase');
  // 빈 답은 어떤 규칙의 결과와도 같을 수 없으므로 오답 경로를 그대로 탄다
  return submitAnswer(s, ' timeout');
}

/** 제한 시간 종료(또는 양쪽 오답) → 다음 힌트 또는 라운드 종료 */
export function advanceHint(s: HFState): HFState {
  if (s.phase !== 'window') throw new Error('bad phase');
  if (s.hints.length >= MAX_HINTS) {
    return endRound(s, null, [...s.scores]);
  }
  return { ...s, phase: 'num1', num1: null, answerer: null };
}

/** 다음 라운드로 (roundend에서 호출) */
export function nextRound(s: HFState): HFState {
  if (s.phase !== 'roundend') throw new Error('bad phase');
  if (s.round >= ROUNDS && s.scores[0] !== s.scores[1]) {
    return {
      ...s,
      phase: 'gameover',
      result: { winner: s.scores[0] > s.scores[1] ? 0 : 1 },
    };
  }
  // 동점 연장: 규칙이 모자라면 재셔플로 보충
  let ruleOrder = s.ruleOrder;
  if (s.round >= ruleOrder.length) {
    const used = new Set(ruleOrder.slice(-4));
    const pool = shuffle(RULES.map((_, i) => i).filter((i) => !used.has(i)));
    ruleOrder = [...ruleOrder, ...pool];
  }
  const [X, Y] = makeProblem();
  return {
    ...s,
    round: s.round + 1,
    ruleOrder,
    X,
    Y,
    hints: [],
    first: (1 - s.first) as PlayerId,
    phase: 'num1',
    num1: null,
    answerer: null,
    wrongBuzzed: [false, false],
    lastRound: null,
    result: null,
  };
}

/** 현재 수를 제시할 차례인 플레이어 */
export function numTurn(s: HFState): PlayerId {
  return s.phase === 'num1' ? s.first : ((1 - s.first) as PlayerId);
}
