/**
 * 야누스 포커 결과 표집(outcome sampling) MCCFR 자가학습기.
 *
 * 블라인드 포커처럼 "단일 핸드"를 칩 EV 게임으로 학습한다 (무승부 이월은
 * 기대값 0 근사, 스택은 시작값 40 기준 — 실전에서는 상한만 잘라 적용).
 * 딜은 엔진의 실제 셔플을 그대로 쓴다 (기회 표집).
 *
 * 정보집합 키 = 내 앞면 × 내 뒷면 × 상대 앞면 × 내/상대 선언 면
 *   × 베팅 레벨 버킷 × 콜 비용 버킷  (모두 실전 상태에서 복원 가능)
 * 행동 토큰:
 *   첫 액션(면 미선언): f, {F,B,W}×{c(현재 레벨), r(+2), R(+6)}  (W=양면)
 *   이후: f, c, r(+2), R(+6)  — 상한 초과는 실행 시 절삭
 *
 * 실행: npm run cfr:train:janus  (ITER 환경변수로 조정)
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyAction, createGame, callCost, maxLevel, maxLevelFor } from '../../src/games/janus-poker/engine.ts';
import type { Face, JPAction, JPState, PlayerId } from '../../src/games/janus-poker/engine.ts';

const ITERATIONS = Number(process.env.ITER ?? 30_000_000);
const EPSILON = 0.6;
const ROOT_CHIPS = 40;

// ---------- 키/토큰 (ai.ts 와 동일 규약) ----------

function faceCode(f: Face | null): number {
  return f === null ? 0 : f === 'front' ? 1 : f === 'back' ? 2 : 3;
}

function levelBucket(l: number): number {
  return l <= 0 ? 0 : l <= 3 ? l : l <= 5 ? 4 : l <= 9 ? 5 : 6;
}

function facingBucket(c: number): number {
  return c <= 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : 3;
}

export function janusKey(s: JPState, me: PlayerId): number {
  const opp = (1 - me) as PlayerId;
  return (
    s.cards[me].front |
    (s.cards[me].back << 4) |
    (s.cards[opp].front << 8) |
    (faceCode(s.faces[me]) << 12) |
    (faceCode(s.faces[opp]) << 14) |
    (levelBucket(s.level) << 16) |
    (facingBucket(callCost(s, me)) << 19)
  );
}

export function janusTokens(s: JPState, me: PlayerId): string[] {
  if (s.faces[me] === null) {
    const out = ['f'];
    for (const f of ['F', 'B', 'W']) {
      if (f === 'W' && s.faces[1 - me] === 'both') continue;
      out.push(`${f}c`, `${f}r`, `${f}R`);
    }
    return out;
  }
  return ['f', 'c', 'r', 'R'];
}

/** 토큰 → 실제 행동 (상한 절삭 포함 — 학습/실전 동일) */
export function janusTokenToAction(s: JPState, me: PlayerId, tok: string): JPAction {
  if (tok === 'f') return { kind: 'fold' };
  if (s.faces[me] === null) {
    const face: Face = tok[0] === 'F' ? 'front' : tok[0] === 'B' ? 'back' : 'both';
    const base = Math.max(1, s.level);
    const want = tok[1] === 'c' ? base : tok[1] === 'r' ? base + 2 : base + 6;
    const level = Math.min(want, maxLevelFor(s, me, face));
    if (level < base) return { kind: 'fold' }; // 콜 레벨조차 커버 불가
    return { kind: 'bet', face, level };
  }
  if (tok === 'c') return { kind: 'call' };
  const want = tok === 'r' ? s.level + 2 : s.level + 6;
  const level = Math.min(want, maxLevel(s, me));
  if (level <= s.level) return { kind: 'call' };
  return { kind: 'raise', level };
}

// ---------- 정보집합 저장소 ----------

interface InfoSet {
  regret: Float64Array;
  strat: Float64Array;
}

const infoSets = new Map<number, InfoSet>();

function getInfoSet(key: number, n: number): InfoSet {
  let is = infoSets.get(key);
  if (!is) {
    is = { regret: new Float64Array(n), strat: new Float64Array(n) };
    infoSets.set(key, is);
  }
  return is;
}

function currentStrategy(is: InfoSet): number[] {
  const n = is.regret.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += is.regret[i];
  if (total <= 0) return new Array(n).fill(1 / n);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = is.regret[i] / total;
  return out;
}

function sampleIndex(probs: number[]): number {
  let r = Math.random();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
}

// ---------- Outcome sampling ----------

interface PathNode {
  is: InfoSet;
  aIdx: number;
  sigma: number[];
}

function runIteration(traverser: PlayerId, first: PlayerId, iter: number): void {
  let s = createGame(first); // 실제 셔플 딜 = 기회 표집 (단일 핸드만 사용)
  const path: PathNode[] = [];
  let pTotal = 1;
  let realPrefix = 1;
  let samplePrefix = 1;
  let guard = 0;

  while (s.phase === 'act' && guard++ < 30) {
    const p = s.turn;
    const tokens = janusTokens(s, p);
    const is = getInfoSet(janusKey(s, p), tokens.length);
    const sigma = currentStrategy(is);
    let aIdx: number;
    if (p === traverser) {
      const n = tokens.length;
      const mixed = sigma.map((x) => (1 - EPSILON) * x + EPSILON / n);
      aIdx = sampleIndex(mixed);
      const w = (iter * realPrefix) / samplePrefix;
      for (let i = 0; i < n; i++) is.strat[i] += w * sigma[i];
      path.push({ is, aIdx, sigma });
      pTotal *= mixed[aIdx];
      realPrefix *= sigma[aIdx];
      samplePrefix *= mixed[aIdx];
    } else {
      aIdx = sampleIndex(sigma);
    }
    s = applyAction(s, janusTokenToAction(s, p, tokens[aIdx]));
  }
  if (s.phase === 'act' || !s.lastResult) return;

  // 칩 EV (무승부 이월은 0 근사) — 스케일은 시작 칩으로 정규화
  const u = s.lastResult.winner === null ? 0 : (s.stacks[traverser] - ROOT_CHIPS) / ROOT_CHIPS;
  if (u === 0) return;

  let suffix = 1;
  for (let d = path.length - 1; d >= 0; d--) {
    const { is, aIdx, sigma } = path[d];
    const v = (u * suffix) / pTotal;
    for (let i = 0; i < sigma.length; i++) {
      const delta = i === aIdx ? v * (1 - sigma[aIdx]) : -v * sigma[aIdx];
      is.regret[i] = Math.max(0, is.regret[i] + delta); // CFR+
    }
    suffix *= sigma[aIdx];
  }
}

console.log('야누스 포커 outcome-sampling MCCFR 학습 시작 — 반복', ITERATIONS);
const t0 = performance.now();
for (let iter = 1; iter <= ITERATIONS; iter++) {
  runIteration((iter % 2) as PlayerId, ((iter >> 1) % 2) as PlayerId, iter);
  if (iter % 500_000 === 0) {
    const sec = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`iter ${iter} — 정보집합 ${infoSets.size}개 (${sec}s)`);
  }
}
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`완료 (${elapsed}s) — 정보집합 ${infoSets.size}개`);

// ---------- 저장 ----------

interface Row {
  key: number;
  weight: number;
  probs: number[];
  n: number;
}
const rows: Row[] = [];
let grandTotal = 0;
for (const [key, is] of infoSets) {
  let total = 0;
  for (let i = 0; i < is.strat.length; i++) total += is.strat[i];
  if (total <= 0) continue;
  rows.push({ key, weight: total, probs: Array.from(is.strat, (x) => x / total), n: is.strat.length });
  grandTotal += total;
}
rows.sort((a, b) => b.weight - a.weight);

// 토큰 라벨은 키의 면 선언 필드로 복원한다
function labelsOf(key: number): string[] {
  const myFace = (key >> 12) & 0x3;
  const oppFace = (key >> 14) & 0x3;
  if (myFace === 0) {
    const out = ['f'];
    for (const f of ['F', 'B', 'W']) {
      if (f === 'W' && oppFace === 3) continue;
      out.push(`${f}c`, `${f}r`, `${f}R`);
    }
    return out;
  }
  return ['f', 'c', 'r', 'R'];
}

const policy: Record<string, Record<string, number>> = {};
let cum = 0;
let kept = 0;
for (const row of rows) {
  if (cum / grandTotal >= 0.999) break;
  cum += row.weight;
  const labels = labelsOf(row.key);
  if (labels.length !== row.n) continue; // 방어
  let probs = row.probs.map((x) => (x < 0.02 ? 0 : x));
  const norm = probs.reduce((a, b) => a + b, 0);
  if (norm <= 0) continue;
  const entry: Record<string, number> = {};
  for (let i = 0; i < labels.length; i++) {
    if (probs[i] > 0) entry[labels[i]] = Number((probs[i] / norm).toFixed(3));
  }
  policy[row.key.toString(36)] = entry;
  kept++;
}

const outPath = join(process.cwd(), 'src', 'games', 'janus-poker', 'policy.json');
writeFileSync(
  outPath,
  JSON.stringify({ meta: { iterations: ITERATIONS, infoSets: infoSets.size, kept }, policy }),
);
console.log(`저장: ${outPath} — 전체 ${rows.length}개 중 ${kept}개 유지`);
