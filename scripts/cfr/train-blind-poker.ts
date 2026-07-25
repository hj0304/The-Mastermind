/**
 * 블라인드 포커 CFR+ 자가학습기.
 *
 * 단일 핸드를 불완전정보 게임으로 정확히 모델링해 CFR+(regret matching+,
 * 선형 가중 평균 전략)로 내시 균형에 수렴시킨다. 결과(평균 전략)는
 * src/games/blind-poker/policy.json 으로 저장되어 게임 AI가 조회한다.
 *
 * 모델링 (엔진 engine.ts와 동일한 수치):
 * - 덱 1~10 × 2 = 20장에서 두 장을 뽑는 모든 순서쌍을 가중 열거 (chance).
 * - 각자 상대 카드만 본다. 정보집합 = (보이는 상대 카드, 베팅 히스토리).
 * - 안테 1, 스택 30. 레이즈 증가량 {1, 3, 5, 올인} — 엔진의 raiseOptions와 동일.
 * - 폴드: 팟 포기 + 내 카드가 10이면 페널티 min(10, 남은 스택). 콜: 쇼다운.
 * - 무승부는 팟 이월이지만 선이 교대라 기대값 중립으로 근사(0).
 *
 * 실행: npm run cfr:train  (esbuild 번들 후 node 실행)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STACK = 30;
const ANTE = 1;
const TEN_PENALTY = 10;
const RAISE_CAP = 6; // 한 핸드 최대 레이즈 횟수 (초과는 콜/폴드만 — 실전에서 도달 희박)
const ITERATIONS = 6000;

// ---------- 게임 트리 ----------

interface Node {
  inv: [number, number]; // 포지션별 투자액 (안테 포함)
  toAct: 0 | 1;
  raises: number;
  hist: string; // 레이즈 토큰 나열 ('1','3','5','a')
}

type ActionToken = 'f' | 'c' | '1' | '3' | '5' | 'a';

/** 현재 노드에서 가능한 행동 (엔진 legalInfo와 동일한 규칙) */
function legalTokens(n: Node): ActionToken[] {
  const p = n.toAct;
  const o = (1 - p) as 0 | 1;
  const callCost = n.inv[o] - n.inv[p];
  const out: ActionToken[] = [];
  if (callCost > 0) out.push('f'); // 공짜 콜이 가능한데 폴드하는 것은 지배당하는 수 — 제외
  out.push('c');
  if (n.raises < RAISE_CAP) {
    const maxRaise = Math.min(STACK - n.inv[p] - callCost, STACK - n.inv[o]);
    for (const s of [1, 3, 5]) if (s < maxRaise) out.push(String(s) as ActionToken);
    if (maxRaise > 0) out.push('a');
  }
  return out;
}

/** 행동 적용. 종단이면 null 대신 페이오프 계산은 호출부에서 */
function applyToken(n: Node, t: ActionToken): Node {
  const p = n.toAct;
  const o = (1 - p) as 0 | 1;
  if (t === 'f' || t === 'c') throw new Error('terminal token');
  const callCost = n.inv[o] - n.inv[p];
  const maxRaise = Math.min(STACK - n.inv[p] - callCost, STACK - n.inv[o]);
  const amount = t === 'a' ? maxRaise : Math.min(Number(t), maxRaise);
  const inv: [number, number] = [...n.inv];
  inv[p] = inv[o] + amount;
  return { inv, toAct: o, raises: n.raises + 1, hist: n.hist + t };
}

/** 포지션 0 기준 페이오프 (칩). cards = [pos0 카드, pos1 카드] */
function terminalValue(n: Node, t: 'f' | 'c', cards: [number, number]): number {
  const p = n.toAct;
  if (t === 'f') {
    const penalty = cards[p] === 10 ? Math.min(TEN_PENALTY, STACK - n.inv[p]) : 0;
    const loss = n.inv[p] + penalty;
    return p === 0 ? -loss : loss;
  }
  // 콜 → 쇼다운 (콜 후 투자액은 상대와 동일해짐)
  const o = (1 - p) as 0 | 1;
  const matched = n.inv[o]; // 양쪽 모두 이만큼 투자
  if (cards[0] === cards[1]) return 0; // 무승부 — 이월은 기대값 중립 근사
  const winner = cards[0] > cards[1] ? 0 : 1;
  return winner === 0 ? matched : -matched;
}

// ---------- CFR+ ----------

interface InfoSet {
  actions: ActionToken[];
  regret: number[]; // CFR+: 음수 없음
  strategySum: number[];
}

const infoSets = new Map<string, InfoSet>();

function getInfoSet(key: string, actions: ActionToken[]): InfoSet {
  let is = infoSets.get(key);
  if (!is) {
    is = { actions, regret: new Array(actions.length).fill(0), strategySum: new Array(actions.length).fill(0) };
    infoSets.set(key, is);
  }
  return is;
}

function currentStrategy(is: InfoSet): number[] {
  const total = is.regret.reduce((a, b) => a + b, 0);
  if (total <= 0) return is.actions.map(() => 1 / is.actions.length);
  return is.regret.map((r) => r / total);
}

/**
 * 기대값 CFR 재귀. reach0/reach1 = 각 플레이어의 도달 확률, w = 딜 확률.
 * 반환: 포지션 0 기준 기대 페이오프.
 */
function cfr(n: Node, cards: [number, number], reach: [number, number], w: number, iter: number): number {
  const p = n.toAct;
  const actions = legalTokens(n);
  const oppCard = cards[1 - p];
  const key = `${oppCard}|${n.hist}`;
  const is = getInfoSet(key, actions);
  const strat = currentStrategy(is);

  const utils: number[] = new Array(actions.length).fill(0);
  let nodeUtil = 0;
  for (let i = 0; i < actions.length; i++) {
    const t = actions[i];
    let u: number;
    if (t === 'f' || t === 'c') {
      u = terminalValue(n, t, cards);
    } else {
      const nextReach: [number, number] = [...reach];
      nextReach[p] *= strat[i];
      u = cfr(applyToken(n, t), cards, nextReach, w, iter);
    }
    utils[i] = u;
    nodeUtil += strat[i] * u;
  }

  // 리그렛/전략 누적 (행동자 기준 부호 보정)
  const sign = p === 0 ? 1 : -1;
  const oppReach = reach[1 - p];
  for (let i = 0; i < actions.length; i++) {
    const regretDelta = sign * (utils[i] - nodeUtil) * oppReach * w;
    is.regret[i] = Math.max(0, is.regret[i] + regretDelta); // CFR+
    is.strategySum[i] += reach[p] * strat[i] * w * iter; // 선형 가중 평균
  }
  return nodeUtil;
}

// ---------- 학습 루프 ----------

/** 20장 덱에서 두 장을 순서대로 뽑는 모든 조합과 확률 */
function deals(): Array<{ cards: [number, number]; w: number }> {
  const out: Array<{ cards: [number, number]; w: number }> = [];
  for (let a = 1; a <= 10; a++) {
    for (let b = 1; b <= 10; b++) {
      const ways = a === b ? 2 * 1 : 2 * 2;
      out.push({ cards: [a, b], w: ways / (20 * 19) });
    }
  }
  return out;
}

const allDeals = deals();
const root: Node = { inv: [ANTE, ANTE], toAct: 0, raises: 0, hist: '' };

console.log('CFR+ 학습 시작 — 반복', ITERATIONS);
const t0 = performance.now();
let ev = 0;
for (let iter = 1; iter <= ITERATIONS; iter++) {
  ev = 0;
  for (const d of allDeals) {
    ev += cfr(root, d.cards, [1, 1], d.w, iter) * 1; // w는 cfr 내부 누적에 사용
  }
  if (iter % 500 === 0) {
    console.log(`iter ${iter} — 정보집합 ${infoSets.size}개, 선(先) 기대값 ${ev.toFixed(4)}칩`);
  }
}
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`완료 (${elapsed}s) — 정보집합 ${infoSets.size}개, 균형 선 기대값 ${ev.toFixed(4)}칩/핸드`);

// ---------- 평균 전략 저장 ----------

const policy: Record<string, Record<string, number>> = {};
for (const [key, is] of infoSets) {
  const total = is.strategySum.reduce((a, b) => a + b, 0);
  if (total <= 0) continue;
  let probs = is.strategySum.map((s) => s / total);
  // 미세 확률 제거 후 재정규화 (파일 크기·안정성)
  probs = probs.map((p) => (p < 0.005 ? 0 : p));
  const norm = probs.reduce((a, b) => a + b, 0);
  if (norm <= 0) continue;
  const entry: Record<string, number> = {};
  for (let i = 0; i < is.actions.length; i++) {
    if (probs[i] > 0) entry[is.actions[i]] = Number((probs[i] / norm).toFixed(4));
  }
  policy[key] = entry;
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', '..', 'src', 'games', 'blind-poker', 'policy.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ meta: { iterations: ITERATIONS, infoSets: infoSets.size, evFirstActor: Number(ev.toFixed(4)) }, policy }),
);
console.log('저장:', outPath, `(${Object.keys(policy).length} 정보집합)`);
