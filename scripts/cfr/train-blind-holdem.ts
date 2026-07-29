/**
 * 블라인드 홀덤 결과 표집(outcome sampling) MCCFR 자가학습기.
 *
 * 다른 게임의 학습기와 다른 점: **한 게임을 끝까지 진행하며 핸드마다 갱신**한다.
 * 이 게임은 잔량 카운팅(덱 소모)·스택 변화·이월 팟이 정보집합 키에 영향을 주므로,
 * 매번 새 딜에서 한 핸드만 뽑으면 "덱이 막 시작된 상태"만 학습하게 된다.
 * 게임을 통째로 굴리면 그 상태들이 자연스럽게 분포에 들어온다.
 *
 * 정보집합 키와 행동 집합은 src/games/blind-holdem/infoset.ts 하나에서만 계산한다
 * (모델 불일치 차단 — 학습·평가·실전이 같은 추상화를 쓴다).
 *
 * 보상: 핸드 단위 칩 델타 / 시작 스택. 무승부(이월)는 기대값 0으로 근사.
 *
 * 실행: npm run cfr:train:holdem   (ITER 환경변수로 게임 수 조정)
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { STARTING_STACK, act, createGame, nextHand } from '../../src/games/blind-holdem/engine.ts';
import type { BhState, PlayerId } from '../../src/games/blind-holdem/engine.ts';
import { actionCodes, infoKey, labelsFromKey, toAction } from '../../src/games/blind-holdem/infoset.ts';

const GAMES = Number(process.env.ITER ?? 1_500_000);
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

// ---------- 한 핸드 순회 ----------

interface PathNode {
  is: InfoSet;
  aIdx: number;
  sigma: number[];
}

let handCounter = 0;

/**
 * s(베팅 단계)에서 핸드가 끝날 때까지 진행하고, traverser 관점으로 리그렛을 갱신한다.
 * @returns 핸드가 끝난 상태
 */
function playHand(s: BhState, traverser: PlayerId): BhState {
  const path: PathNode[] = [];
  let pTotal = 1;
  let realPrefix = 1;
  let samplePrefix = 1;
  const before = s.stacks[traverser] + s.invested[traverser];
  const iter = ++handCounter;
  let guard = 0;

  while (s.phase === 'betting' && guard++ < 40) {
    const p = s.toAct;
    const codes = actionCodes(s);
    const is = getInfoSet(infoKey(s, p), codes.length);
    const sigma = currentStrategy(is);
    let aIdx: number;
    if (p === traverser) {
      const n = codes.length;
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
    s = act(s, toAction(s, codes[aIdx]));
  }

  const rec = s.history[s.history.length - 1];
  if (!rec || path.length === 0) return s;

  // 무승부는 팟이 이월되므로 기대값 0으로 근사 (다른 게임의 학습기와 동일)
  if (rec.outcome === 'draw') return s;

  const after = s.stacks[traverser];
  const u = (after - before) / STARTING_STACK;
  if (u === 0) return s;

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
  return s;
}

// ---------- 학습 루프 ----------

console.log('블라인드 홀덤 outcome-sampling MCCFR 학습 시작 — 게임', GAMES);
const t0 = performance.now();

for (let g = 1; g <= GAMES; g++) {
  const traverser = (g % 2) as PlayerId;
  let s = createGame(((g >> 1) % 2) as PlayerId);
  let hands = 0;
  while (s.phase !== 'gameover' && hands++ < 40) {
    s = playHand(s, traverser);
    if (s.phase !== 'result') break;
    s = nextHand(s);
  }
  if (g % 50_000 === 0) {
    const sec = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`game ${g} — 정보집합 ${infoSets.size}개 · 핸드 ${handCounter} (${sec}s)`);
  }
}

const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`완료 (${elapsed}s) — 정보집합 ${infoSets.size}개 · 학습 핸드 ${handCounter}`);

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

const outPath = join(process.cwd(), 'src', 'games', 'blind-holdem', 'policy.json');
writeFileSync(
  outPath,
  JSON.stringify({
    meta: { games: GAMES, hands: handCounter, infoSets: infoSets.size, kept },
    policy,
  }),
);
console.log(`저장: ${outPath} — 전체 ${rows.length}개 중 ${kept}개 유지`);
