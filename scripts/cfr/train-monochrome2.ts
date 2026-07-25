/**
 * 모노크롬 II (흑과백 II) 결과 표집(outcome sampling) MCCFR 자가학습기.
 *
 * 모노크롬과 달리 한 대국이 최대 18라운드(본선 9 + 연장 3×3)이고 라운드마다
 * 입찰 후보가 ~12개라, 순회자 전 분기(외부 표집)는 지수 폭발한다.
 * 대신 반복마다 궤적 하나만 표집하는 outcome sampling MCCFR을 쓴다
 * (순회자 ε-탐험, 중요도 가중 리그렛 추정, regret matching+).
 *
 * 모델 불일치를 없애기 위해 시뮬레이션은 실제 엔진(engine.ts)을 그대로 쓰고,
 * 정보집합 키의 "상대 잔여 포인트 상한"도 게임 AI와 같은 공개정보 추적
 * (ai.ts opponentPointBounds)을 사용한다.
 *
 * 추상 정보집합 키 = 역할(선/후+상대 제시 색) × 내 잔여 포인트(정확)
 *   × 상대 잔여 상한 버킷(10단위) × 내/상대 승점 × 남은 라운드 × 연장 여부
 * 행동 추상화 = {0, 1, 5, 9, 10, 11, 15, 21, 30, 45, 스퀴즈(상한 버킷 초과), 올인}
 *
 * 실행: npm run cfr:train:m2  (ITER=백만단위 반복 수 환경변수로 조정 가능)
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ai.ts가 localStorage를 참조하므로 Node 스텁
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { createGame, currentPlayer, play } from '../../src/games/monochrome2/engine.ts';
import type { M2State, PlayerId } from '../../src/games/monochrome2/engine.ts';
import { opponentPointBounds } from '../../src/games/monochrome2/ai.ts';

const ITERATIONS = Number(process.env.ITER ?? 2_000_000);
const EPSILON = 0.6; // 순회자 탐험률

// ---------- 추상화 ----------

/** 상대 잔여 상한 → 10단위 버킷 (0..10). 버킷×10 이상 입찰 = 확정 우위 */
function hiBucket(hi: number): number {
  return Math.min(10, Math.ceil((hi + 1) / 10));
}

/** 학습기/게임 공용 정보집합 키 (공개 정보만 사용) */
export function m2Key(s: M2State, me: PlayerId): number {
  const p = s.points[me];
  const oppHiB = hiBucket(opponentPointBounds(s, me).hi);
  const role = s.pending === null ? 0 : s.pending <= 9 ? 1 : 2;
  const roundsLeft = s.maxRounds - s.roundInSet;
  const ot = s.overtime > 0 ? 1 : 0;
  return (
    p |
    (oppHiB << 7) |
    (s.scores[me] << 11) |
    (s.scores[1 - me] << 14) |
    (roundsLeft << 17) |
    (role << 21) |
    (ot << 23)
  );
}

const LADDER = [1, 5, 9, 10, 11, 15, 21, 30, 45];

/** 키 필드만으로 결정되는 입찰 후보 (리그렛 공유 일관성) */
export function m2Candidates(p: number, oppHiB: number, isLeader: boolean): number[] {
  const set = new Set<number>([0]);
  for (const v of LADDER) if (v <= p) set.add(v);
  if (isLeader) {
    const sq = oppHiB * 10; // 상대 잔여 상한 초과 입찰 = 게이지 스퀴즈
    if (sq >= 10 && sq <= p) set.add(sq);
  }
  if (p > 0) set.add(p); // 올인
  return [...set].sort((a, b) => a - b);
}

function candidatesOf(s: M2State, me: PlayerId): number[] {
  return m2Candidates(s.points[me], hiBucket(opponentPointBounds(s, me).hi), s.pending === null);
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

// ---------- Outcome sampling MCCFR ----------

interface PathNode {
  is: InfoSet;
  aIdx: number;
  sigma: number[];
}

function runIteration(traverser: PlayerId, rootLeader: PlayerId, iter: number): void {
  let s = createGame(rootLeader);
  const path: PathNode[] = [];
  let pTotal = 1; // 순회자 표집확률 곱 (ε 포함)
  let realPrefix = 1; // 순회자 실제 정책확률 곱 (평균 전략 가중치용)
  let samplePrefix = 1;
  let guard = 0;

  while (!s.result && guard++ < 60) {
    const p = currentPlayer(s);
    const cands = candidatesOf(s, p);
    const is = getInfoSet(m2Key(s, p), cands.length);
    const sigma = currentStrategy(is);

    if (p === traverser) {
      // ε-탐험 혼합으로 표집
      const n = cands.length;
      const mixed = sigma.map((x) => (1 - EPSILON) * x + EPSILON / n);
      const aIdx = sampleIndex(mixed);
      // 평균 전략 누적 (중요도 보정 + 선형 가중)
      const w = (iter * realPrefix) / samplePrefix;
      for (let i = 0; i < n; i++) is.strat[i] += w * sigma[i];
      path.push({ is, aIdx, sigma });
      pTotal *= mixed[aIdx];
      realPrefix *= sigma[aIdx];
      samplePrefix *= mixed[aIdx];
      s = play(s, cands[aIdx]);
    } else {
      s = play(s, cands[sampleIndex(sigma)]);
    }
  }

  if (!s.result) return; // guard 초과 (이론상 없음)
  const w = s.result.winner;
  const u = w === null ? 0 : w === traverser ? 1 : -1;
  if (u === 0 && path.length === 0) return;

  // 역방향 리그렛 갱신
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

console.log('모노크롬 II outcome-sampling MCCFR 학습 시작 — 반복', ITERATIONS);
const t0 = performance.now();
for (let iter = 1; iter <= ITERATIONS; iter++) {
  runIteration((iter % 2) as PlayerId, ((iter >> 1) % 2) as PlayerId, iter);
  if (iter % 100_000 === 0) {
    const sec = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`iter ${iter} — 정보집합 ${infoSets.size}개 (${sec}s)`);
  }
}
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`완료 (${elapsed}s) — 정보집합 ${infoSets.size}개`);

// ---------- 평균 전략 저장 (도달 가중치 기반 가지치기) ----------

interface Row {
  key: number;
  weight: number;
  probs: number[];
}
const rows: Row[] = [];
let grandTotal = 0;
for (const [key, is] of infoSets) {
  let total = 0;
  for (let i = 0; i < is.strat.length; i++) total += is.strat[i];
  if (total <= 0) continue;
  rows.push({ key, weight: total, probs: Array.from(is.strat, (x) => x / total) });
  grandTotal += total;
}
rows.sort((a, b) => b.weight - a.weight);

const policy: Record<string, Record<string, number>> = {};
let cum = 0;
let kept = 0;
for (const row of rows) {
  if (cum / grandTotal >= 0.999) break; // 꼬리 키는 휴리스틱 폴백에 맡긴다 (파일 크기)
  cum += row.weight;
  // 후보 목록을 키 필드에서 복원
  const p = row.key & 0x7f;
  const oppHiB = (row.key >> 7) & 0xf;
  const role = (row.key >> 21) & 0x3;
  const cands = m2Candidates(p, oppHiB, role === 0);
  if (cands.length !== row.probs.length) continue; // 방어 (발생하면 버그)
  let probs = row.probs.map((x) => (x < 0.02 ? 0 : x));
  const norm = probs.reduce((a, b) => a + b, 0);
  if (norm <= 0) continue;
  const entry: Record<string, number> = {};
  for (let i = 0; i < cands.length; i++) {
    if (probs[i] > 0) entry[String(cands[i])] = Number((probs[i] / norm).toFixed(3));
  }
  policy[row.key.toString(36)] = entry;
  kept++;
}

const outPath = join(process.cwd(), 'src', 'games', 'monochrome2', 'policy.json');
writeFileSync(
  outPath,
  JSON.stringify({ meta: { iterations: ITERATIONS, infoSets: infoSets.size, kept }, policy }),
);
console.log(`저장: ${outPath} — 전체 ${rows.length}개 중 ${kept}개 유지`);
