/**
 * 윷과 거짓말 결과 표집 MCCFR 자가학습기 — **라운드 단위 스테이지 게임**으로 학습.
 *
 * 이 게임은 한 판이 최대 400라운드다. 판 전체를 하나의 경로로 순회하면 결과 표집의
 * 중요도 가중치(1/∏p)가 경로 길이에 지수적으로 커져 수치가 무너진다(블라인드 홀덤에서
 * 핸드 단위로 끊은 것과 같은 이유, 다만 여기는 훨씬 길다).
 *
 * 그래서 **매 라운드를 독립된 3×2 스테이지 게임으로 본다**:
 *   롤러의 선언 카테고리(진실/낮게 거짓/높게 거짓 또는 꽝 신고) × 응답자의 믿기/의심.
 * 보상 = 그 라운드가 만든 국면 평가 변화(ai.ts의 evaluate, 진행도·말 여유·잡힘 위협을
 * 모두 반영) + 판이 끝났다면 승패 보너스. 경로 길이가 1이라 가중치가 유계이고,
 * 블러핑의 균형 빈도는 본래 이 스테이지 게임의 보수로 결정되므로 이 추상화가 맞다.
 *
 * 정보집합 키·행동 집합·메타 해석은 src/games/yut-bluff/{infoset,ai}.ts 를 공유한다
 * (모델 불일치 차단 — 학습·평가·실전이 같은 추상화를 쓴다).
 *
 * 실행: npm run cfr:train:bluff   (ITER 환경변수로 판 수 조정)
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { createGame, declare, respond } from '../../src/games/yut-bluff/engine.ts';
import type { BState, PlayerId } from '../../src/games/yut-bluff/engine.ts';
import {
  declKey,
  declMetas,
  labelsFromKey,
  respKey,
  respMetas,
} from '../../src/games/yut-bluff/infoset.ts';
import type { MetaCode } from '../../src/games/yut-bluff/infoset.ts';
import {
  canWinByDeclaring,
  declarationWins,
  evaluate,
  resolveDeclMeta,
} from '../../src/games/yut-bluff/ai.ts';

const GAMES = Number(process.env.ITER ?? 200_000);
const EPSILON = 0.6;
/** 국면 평가 → 보상 스케일 (라운드 델타를 대략 ±1 범위로) */
const SCALE = 40;
/** 승패 보너스 — 라운드 보상보다 크게 */
const WIN_BONUS = 3;

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

// ---------- 한 판 진행 ----------

interface Node {
  is: InfoSet;
  aIdx: number;
  sigma: number[];
  /** 표집에 실제로 쓴 확률 (ε 혼합) */
  pSample: number;
}

let roundCounter = 0;

/**
 * 결정 하나를 뽑는다. traverser면 ε-탐색으로 뽑고 노드를 반환한다.
 * @returns [고른 메타, 기록할 노드 또는 null]
 */
function pick(
  key: string,
  metas: MetaCode[],
  isTraverser: boolean,
  iter: number,
): [MetaCode, Node | null] {
  const is = getInfoSet(key, metas.length);
  const sigma = currentStrategy(is);
  if (!isTraverser) return [metas[sampleIndex(sigma)], null];

  const n = metas.length;
  const mixed = sigma.map((x) => (1 - EPSILON) * x + EPSILON / n);
  const aIdx = sampleIndex(mixed);
  for (let i = 0; i < n; i++) is.strat[i] += iter * sigma[i]; // 선형 가중 평균 전략
  return [metas[aIdx], { is, aIdx, sigma, pSample: mixed[aIdx] }];
}

/** 라운드 하나의 보상으로 노드의 리그렛을 갱신 (경로 길이 1) */
function update(node: Node, u: number): void {
  if (u === 0) return;
  const { is, aIdx, sigma, pSample } = node;
  const v = u / pSample;
  for (let i = 0; i < sigma.length; i++) {
    const delta = i === aIdx ? v * (1 - sigma[aIdx]) : -v * sigma[aIdx];
    is.regret[i] = Math.max(0, is.regret[i] + delta); // regret matching+
  }
}

function playGame(iter: number, traverser: PlayerId, first: PlayerId): void {
  let s: BState = createGame(first);
  let guard = 0;

  while (s.phase !== 'gameover' && guard++ < 500) {
    const roller = s.turn;
    const responder = (1 - roller) as PlayerId;
    const before = evaluate(s.pieces, traverser);
    let node: Node | null = null;

    // 롤러의 선언
    const [dCode, dNode] = pick(
      declKey(s, roller, canWinByDeclaring(s, roller)),
      declMetas(s.roll),
      roller === traverser,
      iter,
    );
    if (dNode) node = dNode;
    s = declare(s, resolveDeclMeta(s, roller, dCode));

    // 응답자의 믿기·의심 (꽝 신고는 respond 단계가 없다)
    if (s.phase === 'respond') {
      const [rCode, rNode] = pick(
        respKey(s, responder, declarationWins(s, roller)),
        respMetas(),
        responder === traverser,
        iter,
      );
      if (rNode) node = rNode;
      s = respond(s, rCode === 'c');
    }

    roundCounter++;
    if (!node) continue;

    let u = (evaluate(s.pieces, traverser) - before) / SCALE;
    if (s.phase === 'gameover' && s.result) {
      u += s.result.winner === null ? 0 : s.result.winner === traverser ? WIN_BONUS : -WIN_BONUS;
    }
    update(node, u);
  }
}

// ---------- 학습 루프 ----------

console.log('윷과 거짓말 라운드 단위 MCCFR 학습 시작 — 판', GAMES);
const t0 = performance.now();

for (let g = 1; g <= GAMES; g++) {
  playGame(g, (g % 2) as PlayerId, ((g >> 1) % 2) as PlayerId);
  if (g % 10_000 === 0) {
    const sec = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`game ${g} — 정보집합 ${infoSets.size}개 · 라운드 ${roundCounter} (${sec}s)`);
  }
}

const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`완료 (${elapsed}s) — 정보집합 ${infoSets.size}개 · 학습 라운드 ${roundCounter}`);

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

const outPath = join(process.cwd(), 'src', 'games', 'yut-bluff', 'policy.json');
writeFileSync(
  outPath,
  JSON.stringify({
    meta: { games: GAMES, rounds: roundCounter, infoSets: infoSets.size, kept },
    policy,
  }),
);
console.log(`저장: ${outPath} — 전체 ${rows.length}개 중 ${kept}개 유지`);
