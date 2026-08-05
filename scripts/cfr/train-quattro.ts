/**
 * 테트라 결과 표집(outcome sampling) MCCFR 자가학습기 — 메타 행동 위에서 학습.
 *
 * 테트라의 원시 행동은 조합적(가상 6명 × 줄 카드 + 패스)이라 원시 행동 위의
 * 균형 학습이 어렵다. 그래서 행동을 메타 옵션으로 추상화한다:
 *   멀리건 k/m · 오픈 h/l · 교환 p/e/z (정의: src/games/quattro/infoset.ts)
 * 옵션의 구체 실행(resolve*)과 정보집합 키는 게임 AI와 같은 모듈을 공유한다
 * (모델 불일치 차단). 실제 엔진으로 게임을 끝까지 굴리며 게임 단위로 갱신한다.
 *
 * 보상: 승 +1 / 무 0 / 패 -1.
 *
 * 실행: npm run cfr:train:quattro   (ITER 환경변수로 게임 수 조정)
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import {
  createGame,
  currentActor,
  decline,
  exchange,
  keepHand,
  mulligan,
  openCard,
} from '../../src/games/quattro/engine.ts';
import type { PlayerId, QState } from '../../src/games/quattro/engine.ts';
import {
  labelsFromKey,
  mullKey,
  openKey,
  xchgKey,
  xchgMetas,
} from '../../src/games/quattro/infoset.ts';
import type { MetaCode } from '../../src/games/quattro/infoset.ts';
import { resolveOpenMeta, resolveXchgMeta } from '../../src/games/quattro/ai.ts';

const GAMES = Number(process.env.ITER ?? 300_000);
const EPSILON = 0.6;

// ---------- 정보집합 저장소 ----------

interface InfoSet {
  regret: Float64Array;
  strat: Float64Array;
}

const infoSets = new Map<string, InfoSet>();

function getInfoSet(key: string, n: number): InfoSet {
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

// ---------- 한 게임 순회 ----------

interface PathNode {
  is: InfoSet;
  aIdx: number;
  sigma: number[];
}

interface Walk {
  path: PathNode[];
  pTotal: number;
  realPrefix: number;
  samplePrefix: number;
}

/** 정보집합에서 메타 하나를 뽑는다 — traverser면 ε-탐색 + 경로 기록 */
function pick(
  w: Walk,
  key: string,
  codes: MetaCode[],
  isTraverser: boolean,
  iter: number,
): MetaCode {
  const is = getInfoSet(key, codes.length);
  const sigma = currentStrategy(is);
  let aIdx: number;
  if (isTraverser) {
    const n = codes.length;
    const mixed = sigma.map((x) => (1 - EPSILON) * x + EPSILON / n);
    aIdx = sampleIndex(mixed);
    const weight = (iter * w.realPrefix) / w.samplePrefix;
    for (let i = 0; i < n; i++) is.strat[i] += weight * sigma[i];
    w.path.push({ is, aIdx, sigma });
    w.pTotal *= mixed[aIdx];
    w.realPrefix *= sigma[aIdx];
    w.samplePrefix *= mixed[aIdx];
  } else {
    aIdx = sampleIndex(sigma);
  }
  return codes[aIdx];
}

function playGame(iter: number, traverser: PlayerId, first: PlayerId): void {
  const w: Walk = { path: [], pTotal: 1, realPrefix: 1, samplePrefix: 1 };
  let s: QState = createGame(first);

  // 멀리건 (선 → 후 순서로 각자 확정까지)
  for (const p of [first, (1 - first) as PlayerId]) {
    let guard = 0;
    while (s.phase === 'mulligan' && !s.mulliganDone[p] && guard++ < 4) {
      if (s.mulligansUsed[p] >= 2) break; // 엔진이 자동 확정
      const code = pick(w, mullKey(s.hands[p], s.mulligansUsed[p]), ['k', 'm'], p === traverser, iter);
      s = code === 'm' ? mulligan(s, p) : keepHand(s, p);
    }
  }

  // 본 게임 (오픈 ↔ 교환)
  let guard = 0;
  while (s.phase !== 'done' && guard++ < 300) {
    if (s.phase === 'opening') {
      const p = s.pendingOpen[0];
      const code = pick(w, openKey(s, p), ['h', 'l'], p === traverser, iter);
      s = openCard(s, p, resolveOpenMeta(s, p, code));
    } else {
      const p = currentActor(s);
      const metas = xchgMetas(s, p);
      // 강제수(패스만 가능 또는 교환만 가능) — 정보집합 없음
      const code =
        metas.length === 1 ? metas[0] : pick(w, xchgKey(s, p), metas, p === traverser, iter);
      const a = code === 'p' ? { type: 'decline' as const } : resolveXchgMeta(s, p, code);
      s = a.type === 'decline' ? decline(s, p) : exchange(s, p, a.virtualIdx, a.giveCardId);
    }
  }

  if (w.path.length === 0 || !s.result) return;
  const u = s.result.winner === null ? 0 : s.result.winner === traverser ? 1 : -1;
  if (u === 0) return;

  let suffix = 1;
  for (let d = w.path.length - 1; d >= 0; d--) {
    const { is, aIdx, sigma } = w.path[d];
    const v = (u * suffix) / w.pTotal;
    for (let i = 0; i < sigma.length; i++) {
      const delta = i === aIdx ? v * (1 - sigma[aIdx]) : -v * sigma[aIdx];
      is.regret[i] = Math.max(0, is.regret[i] + delta); // regret matching+
    }
    suffix *= sigma[aIdx];
  }
}

// ---------- 학습 루프 ----------

console.log('테트라 outcome-sampling MCCFR 학습 시작 — 게임', GAMES);
const t0 = performance.now();

for (let g = 1; g <= GAMES; g++) {
  playGame(g, (g % 2) as PlayerId, ((g >> 1) % 2) as PlayerId);
  if (g % 10_000 === 0) {
    const sec = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`game ${g} — 정보집합 ${infoSets.size}개 (${sec}s)`);
  }
}

const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`완료 (${elapsed}s) — 정보집합 ${infoSets.size}개`);

// ---------- 저장 ----------

interface Row {
  key: string;
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

const policy: Record<string, Record<string, number>> = {};
let cum = 0;
let kept = 0;
for (const row of rows) {
  if (cum / grandTotal >= 0.999) break; // 도달 가중치 99.9%까지만 유지
  cum += row.weight;
  const labels = labelsFromKey(row.key);
  if (labels.length !== row.n) continue; // 방어 — 키/행동 집합 불일치
  const probs = row.probs.map((x) => (x < 0.02 ? 0 : x));
  const norm = probs.reduce((a, b) => a + b, 0);
  if (norm <= 0) continue;
  const entry: Record<string, number> = {};
  for (let i = 0; i < labels.length; i++) {
    if (probs[i] > 0) entry[labels[i]] = Number((probs[i] / norm).toFixed(3));
  }
  policy[row.key] = entry;
  kept++;
}

const outPath = join(process.cwd(), 'src', 'games', 'quattro', 'policy.json');
writeFileSync(
  outPath,
  JSON.stringify({
    meta: { games: GAMES, infoSets: infoSets.size, kept },
    policy,
  }),
);
console.log(`저장: ${outPath} — 전체 ${rows.length}개 중 ${kept}개 유지`);
