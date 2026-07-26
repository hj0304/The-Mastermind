/**
 * 히든 포뮬러 규칙 은행 감사.
 *
 * 규칙을 대량으로 늘리면 세 가지가 망가질 수 있다. 이 스크립트가 전부 검사한다.
 * 1) 중복  — 출력이 완전히 같은 규칙 쌍 (은행 크기만 부풀리고 재미가 없다)
 * 2) 불량  — NaN·Infinity·빈 문자열·지나치게 긴 출력 (엔진이 문자열 비교를 하므로 치명적)
 * 3) 판별 불가 — 16힌트를 다 써도 정답이 하나로 좁혀지지 않는 라운드
 *               (규칙이 많아질수록 늘어난다 — 실측해서 허용 범위인지 본다)
 *
 * 실행: npm run rules:audit
 */

import { RULES } from '../../src/games/hidden-formula/rules.ts';
import type { Rule } from '../../src/games/hidden-formula/rules.ts';

const MAX_HINTS = 16;

// ---------- 1. 불량 출력 ----------

/** 사람이 실제로 낼 법한 수 + 경계값 */
const PROBE_PAIRS: Array<[number, number]> = [];
for (const a of [1, 2, 3, 5, 7, 9, 10, 11, 12, 17, 23, 40, 56, 99, 100, 123, 500, 999, 1234, 9999, 54321, 999999]) {
  for (const b of [1, 2, 4, 6, 8, 10, 13, 19, 24, 47, 88, 100, 101, 256, 777, 1000, 4321, 12345, 999999]) {
    PROBE_PAIRS.push([a, b]);
  }
}

interface Bad {
  id: string;
  a: number;
  b: number;
  out: string;
  why: string;
}

const bad: Bad[] = [];
for (const rule of RULES) {
  for (const [a, b] of PROBE_PAIRS) {
    let out: string;
    try {
      out = rule.fn(a, b);
    } catch (e) {
      bad.push({ id: rule.id, a, b, out: String(e), why: '예외 발생' });
      break;
    }
    if (typeof out !== 'string') {
      bad.push({ id: rule.id, a, b, out: String(out), why: '문자열이 아님' });
      break;
    }
    if (out === '' || out.includes('NaN') || out.includes('Infinity') || out.includes('e+')) {
      bad.push({ id: rule.id, a, b, out, why: '빈 값/NaN/Infinity/지수표기' });
      break;
    }
    if (out.length > 24) {
      bad.push({ id: rule.id, a, b, out, why: `출력이 너무 김 (${out.length}자)` });
      break;
    }
    if (out.startsWith('-')) {
      bad.push({ id: rule.id, a, b, out, why: '음수 출력' });
      break;
    }
  }
}

// ---------- 2. 중복 (행동 서명) ----------

const signature = (rule: Rule): string => PROBE_PAIRS.map(([a, b]) => rule.fn(a, b)).join('|');

const bySig = new Map<string, string[]>();
for (const rule of RULES) {
  const sig = signature(rule);
  const list = bySig.get(sig);
  if (list) list.push(rule.id);
  else bySig.set(sig, [rule.id]);
}
const dupGroups = [...bySig.values()].filter((g) => g.length > 1);

/** 출력이 항상 같은(입력과 무관한) 규칙 = 퀴즈로서 무의미 */
const constants = RULES.filter((rule) => new Set(PROBE_PAIRS.map(([a, b]) => rule.fn(a, b))).size === 1);

// ---------- 3. 판별 가능성 시뮬레이션 ----------

/** 게임과 동일한 문제 생성 (4~24, 서로 다름) */
function makeProblem(rand: () => number): [number, number] {
  const x = 4 + Math.floor(rand() * 21);
  let y = 4 + Math.floor(rand() * 21);
  while (y === x) y = 4 + Math.floor(rand() * 21);
  return [x, y];
}

/** 사람이 실제로 던질 법한 수 (작은 수 위주, 가끔 큰 수) */
function playerNumber(rand: () => number): number {
  const roll = rand();
  if (roll < 0.5) return 1 + Math.floor(rand() * 20);
  if (roll < 0.8) return 10 + Math.floor(rand() * 90);
  if (roll < 0.95) return 100 + Math.floor(rand() * 900);
  return 1000 + Math.floor(rand() * 9000);
}

/** 결정적 난수 (재현 가능한 감사 결과) */
function mulberry(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimResult {
  determinedAt: number | null; // 정답이 하나로 좁혀진 힌트 수
  survivors: number; // 16힌트 후 살아남은 후보 수
}

function simulateRound(hidden: Rule, rand: () => number): SimResult {
  const [X, Y] = makeProblem(rand);
  const target = hidden.fn(X, Y);
  let alive = RULES.slice();
  const hints: Array<[number, number]> = [];

  for (let k = 1; k <= MAX_HINTS; k++) {
    let a = playerNumber(rand);
    let b = playerNumber(rand);
    // 엔진 규칙: 문제의 두 수를 그대로 쓰는 조합은 금지
    if ((a === X && b === Y) || (a === Y && b === X)) b = b === 1 ? 2 : b - 1;
    hints.push([a, b]);
    const c = hidden.fn(a, b);
    alive = alive.filter((rule) => rule.fn(a, b) === c);
    // 살아남은 후보 전부가 같은 답을 내면 정답이 확정된다
    const answers = new Set(alive.map((rule) => rule.fn(X, Y)));
    if (answers.size === 1) {
      if ([...answers][0] !== target) throw new Error(`정답 불일치: ${hidden.id}`);
      return { determinedAt: k, survivors: alive.length };
    }
  }
  return { determinedAt: null, survivors: alive.length };
}

const ROUNDS_PER_RULE = 12;
const rand = mulberry(20260726);
let totalRounds = 0;
let undetermined = 0;
let sumDetermined = 0;
const hardRules = new Map<string, number>(); // 규칙별 판별 실패 횟수

for (const rule of RULES) {
  for (let i = 0; i < ROUNDS_PER_RULE; i++) {
    const res = simulateRound(rule, rand);
    totalRounds += 1;
    if (res.determinedAt === null) {
      undetermined += 1;
      hardRules.set(rule.id, (hardRules.get(rule.id) ?? 0) + 1);
    } else {
      sumDetermined += res.determinedAt;
    }
  }
}

// ---------- 리포트 ----------

console.log(`\n===== 히든 포뮬러 규칙 은행 감사 =====`);
console.log(`규칙 수: ${RULES.length}종`);
const byDiff = new Map<number, number>();
for (const rule of RULES) byDiff.set(rule.difficulty, (byDiff.get(rule.difficulty) ?? 0) + 1);
console.log(`난이도 분포: ${[...byDiff.entries()].sort((x, y) => x[0] - y[0]).map(([d, n]) => `${d}★ ${n}개`).join(' / ')}`);

console.log(`\n--- 1. 불량 출력 ---`);
if (bad.length === 0) console.log('없음 ✅');
else for (const x of bad) console.log(`  ❌ ${x.id}: (${x.a}, ${x.b}) → "${x.out}" — ${x.why}`);

console.log(`\n--- 2. 중복 ---`);
if (dupGroups.length === 0) console.log('없음 ✅');
else for (const g of dupGroups) console.log(`  ⚠️ 동일 출력: ${g.join(' ≡ ')}`);
if (constants.length > 0) console.log(`  ⚠️ 상수 규칙: ${constants.map((c) => c.id).join(', ')}`);

console.log(`\n--- 3. 판별 가능성 (규칙당 ${ROUNDS_PER_RULE}라운드 시뮬레이션) ---`);
console.log(`총 ${totalRounds}라운드`);
console.log(`정답 확정 평균 힌트 수: ${(sumDetermined / (totalRounds - undetermined)).toFixed(2)}개`);
console.log(`16힌트로도 확정 실패: ${undetermined}회 (${((undetermined / totalRounds) * 100).toFixed(1)}%)`);
if (hardRules.size > 0) {
  const worst = [...hardRules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`  판별 어려운 규칙 상위: ${worst.map(([id, n]) => `${id}(${n}/${ROUNDS_PER_RULE})`).join(', ')}`);
}

const ok = bad.length === 0 && dupGroups.length === 0 && constants.length === 0;
console.log(`\n결과: ${ok ? '✅ 통과' : '⚠️ 위 항목 수정 필요'}\n`);
