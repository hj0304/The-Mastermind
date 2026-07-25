/**
 * 모노크롬 레이즈 결과 표집(outcome sampling) MCCFR 자가학습기.
 *
 * 두 층을 동시에 학습한다:
 * 1) 배치 층 — templates.ts 의 결정적 배치 48종 위의 혼합 전략 (루트 정보집합 1개,
 *    양쪽 공유: 게임이 대칭이고 배치 시점에 관측 정보가 없다)
 * 2) 콜/폴드 층 — 라운드 결정의 균형 전략
 *
 * 정보집합 키(공개 정보 + 내 타일만 사용):
 *   라운드 × 내 타일 × 내 베팅 버킷 × 콜 비용 버킷 × 스태시 차 버킷
 *   × 상대 미공개 타일 중 내 타일보다 높은 개수 × 미공개 총수
 * 콜 불가(need > maxCallable)는 강제 폴드로 처리하고 학습하지 않는다.
 *
 * 시뮬레이션은 실제 엔진(engine.ts) 그대로 — 차출 정책 포함 모델 불일치 없음.
 *
 * 실행: npm run cfr:train:raise  (ITER 환경변수로 반복 수 조정)
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createGame, decide, maxCallable, nextRound, randomSetup } from '../../src/games/monochrome-raise/engine.ts';
import type { PlayerId, RaiseSetup, RaiseState } from '../../src/games/monochrome-raise/engine.ts';
import { raiseTemplates } from '../../src/games/monochrome-raise/templates.ts';

// ai.ts(aiSetup 폴백 휴리스틱)가 localStorage를 참조하므로 Node 스텁
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
const { aiSetup } = await import('../../src/games/monochrome-raise/ai.ts');

const ITERATIONS = Number(process.env.ITER ?? 20_000_000);
const EPSILON = 0.6;
const TEMPLATES = raiseTemplates();
const ROOT_KEY = 1 << 28;

// ---------- 정보집합 키 ----------

/** 칩 수 → 굵은 버킷 (임의 배치에 대한 일반화) */
function chipBucket(x: number): number {
  return x <= 1 ? 0 : x <= 2 ? 1 : x <= 3 ? 2 : x <= 5 ? 3 : x <= 8 ? 4 : 5;
}

/**
 * 결정 시점 키 — 학습기/게임 공통 규약 (ai.ts policyKey와 동일 구현).
 * oppRank = 상대의 현재 베팅이 자기 잔여 배정 중 몇 번째로 큰가 (0=최대)
 * — 베팅 크기로 타일을 추론하는 핵심 공개 신호.
 */
export function raiseKey(s: RaiseState, me: PlayerId): number {
  const opp = (1 - me) as PlayerId;
  const r = s.round;
  const myTile = s.order[me][r];
  const myBetB = chipBucket(s.bets[me][r]);
  const needB = chipBucket(s.bets[opp][r] - s.bets[me][r]);
  const sdiff = Math.max(0, Math.min(Math.round((s.stash[me] - s.stash[opp]) / 8) + 4, 8));
  const unseen = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const h of s.history) if (h.revealed) unseen.delete(h.tiles[opp]);
  let higher = 0;
  for (const v of unseen) if (v > myTile) higher++;
  const oppBet = s.bets[opp][r];
  let oppRank = 0;
  for (let i = r + 1; i < 10; i++) if (s.bets[opp][i] > oppBet) oppRank++;
  oppRank = Math.min(oppRank, 3);
  return (
    r |
    (myTile << 4) |
    (myBetB << 8) |
    (needB << 11) |
    (sdiff << 14) |
    (higher << 18) |
    (oppRank << 22)
  );
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

function act(
  is: InfoSet,
  isTraverser: boolean,
  iter: number,
  ctx: { path: PathNode[]; pTotal: number; realPrefix: number; samplePrefix: number },
): number {
  const sigma = currentStrategy(is);
  if (!isTraverser) return sampleIndex(sigma);
  const n = sigma.length;
  const mixed = sigma.map((x) => (1 - EPSILON) * x + EPSILON / n);
  const aIdx = sampleIndex(mixed);
  const w = (iter * ctx.realPrefix) / ctx.samplePrefix;
  for (let i = 0; i < n; i++) is.strat[i] += w * sigma[i];
  ctx.path.push({ is, aIdx, sigma });
  ctx.pTotal *= mixed[aIdx];
  ctx.realPrefix *= sigma[aIdx];
  ctx.samplePrefix *= mixed[aIdx];
  return aIdx;
}

function runIteration(traverser: PlayerId, iter: number): void {
  const ctx = { path: [] as PathNode[], pTotal: 1, realPrefix: 1, samplePrefix: 1 };
  const rootIs = getInfoSet(ROOT_KEY, TEMPLATES.length);

  // 배치 선택 — 순회자는 템플릿(루트 정보집합, 양쪽 공유)에서, 상대는 75% 템플릿 +
  // 25% 임의/휴리스틱 배치(기회 노드 취급)로 뽑아 임의 배치에도 강건하게 만든다
  const tIdx = act(rootIs, true, iter, ctx);
  const roll = Math.random();
  const oppSetup: RaiseSetup =
    roll < 0.75 ? TEMPLATES[act(rootIs, false, iter, ctx)] : roll < 0.9 ? aiSetup() : randomSetup();
  const setups: [RaiseSetup, RaiseSetup] =
    traverser === 0 ? [TEMPLATES[tIdx], oppSetup] : [oppSetup, TEMPLATES[tIdx]];

  let s = createGame(setups[0], setups[1]);
  let guard = 0;
  while (s.phase !== 'gameover' && guard++ < 40) {
    if (s.phase === 'result') {
      s = nextRound(s);
      continue;
    }
    const p = s.toDecide!;
    const opp = (1 - p) as PlayerId;
    const need = s.bets[opp][s.round] - s.bets[p][s.round];
    if (maxCallable(s, p) < need) {
      s = decide(s, 'fold'); // 강제 폴드 — 학습 대상 아님
      continue;
    }
    const is = getInfoSet(raiseKey(s, p), 2); // [call, fold]
    const aIdx = act(is, p === traverser, iter, ctx);
    s = decide(s, aIdx === 0 ? 'call' : 'fold');
  }
  if (s.phase !== 'gameover' || !s.result) return;

  const w = s.result.winner;
  const u = w === null ? 0 : w === traverser ? 1 : -1;
  if (u === 0) return;

  // 역방향 리그렛 갱신
  let suffix = 1;
  for (let d = ctx.path.length - 1; d >= 0; d--) {
    const { is, aIdx, sigma } = ctx.path[d];
    const v = (u * suffix) / ctx.pTotal;
    for (let i = 0; i < sigma.length; i++) {
      const delta = i === aIdx ? v * (1 - sigma[aIdx]) : -v * sigma[aIdx];
      is.regret[i] = Math.max(0, is.regret[i] + delta); // CFR+
    }
    suffix *= sigma[aIdx];
  }
}

console.log('모노크롬 레이즈 outcome-sampling MCCFR 학습 시작 — 반복', ITERATIONS, '/ 템플릿', TEMPLATES.length);
const t0 = performance.now();
for (let iter = 1; iter <= ITERATIONS; iter++) {
  runIteration((iter % 2) as PlayerId, iter);
  if (iter % 500_000 === 0) {
    const sec = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`iter ${iter} — 정보집합 ${infoSets.size}개 (${sec}s)`);
  }
}
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`완료 (${elapsed}s) — 정보집합 ${infoSets.size}개`);

// 루트 혼합 전략 미리보기
{
  const rootIs = infoSets.get(ROOT_KEY)!;
  const total = [...rootIs.strat].reduce((a, b) => a + b, 0);
  const top = [...rootIs.strat]
    .map((x, i) => ({ i, p: x / total }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 8);
  console.log('배치 혼합 상위:', top.map((t) => `#${t.i}:${(t.p * 100).toFixed(1)}%`).join(' '));
}

// ---------- 저장 ----------

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
  if (cum / grandTotal >= 0.999 && row.key !== ROOT_KEY) break;
  cum += row.weight;
  const floor = row.key === ROOT_KEY ? 0.005 : 0.02;
  let probs = row.probs.map((x) => (x < floor ? 0 : x));
  const norm = probs.reduce((a, b) => a + b, 0);
  if (norm <= 0) continue;
  const entry: Record<string, number> = {};
  const labels = row.key === ROOT_KEY ? row.probs.map((_, i) => String(i)) : ['c', 'f'];
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] > 0) entry[labels[i]] = Number((probs[i] / norm).toFixed(3));
  }
  policy[row.key.toString(36)] = entry;
  kept++;
}

const outPath = join(process.cwd(), 'src', 'games', 'monochrome-raise', 'policy.json');
writeFileSync(
  outPath,
  JSON.stringify({ meta: { iterations: ITERATIONS, infoSets: infoSets.size, kept }, policy }),
);
console.log(`저장: ${outPath} — 전체 ${rows.length}개 중 ${kept}개 유지`);
