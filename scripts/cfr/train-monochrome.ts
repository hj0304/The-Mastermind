/**
 * 모노크롬(흑과 백) 외부 표집 MCCFR 자가학습기.
 *
 * 게임 특성: 기회(chance) 노드가 없고 은닉 정보가 "상대가 낸 숫자"뿐인
 * 불완전정보 게임. 정확한 정보집합(내 손패 + 전체 공개 신호 이력)은 조합 폭발하므로
 * 공개정보 추상화로 압축해 리그렛을 공유한다.
 *
 * 추상화 키 = 내 잔여 손패(정확, 비트마스크) × 상대 잔여 흑/백 장수(공개 정보)
 *            × 점수차 × 역할(선 / 후+상대 제시 색)
 * 잃는 정보: 승패 비교로 좁혀지는 상대 손패의 세부 분포(무승부로 드러난 숫자 등).
 *
 * 학습: 외부 표집 MCCFR — 순회자(traverser)의 행동은 전 분기, 상대 행동은
 * 현재 전략에서 표집. regret matching+ 와 선형 가중 평균 전략 사용.
 * 엔진 규칙 재현: 0이 8을 이김, 무승부 시 선 유지, 역전 불가 시 조기 종료,
 * 세트 종료 동점(연장전)은 기대값 0으로 근사.
 *
 * 실행: npm run cfr:train:mono
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ITERATIONS = 6000;
const BLACK = 0b101010101; // 0,2,4,6,8
const FULL = 0b111111111;

// ---------- 유틸 ----------

function popcount(x: number): number {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/** mask → 오름차순 타일 배열 (전 마스크 사전 계산) */
const TILES: number[][] = new Array(512);
for (let m = 0; m < 512; m++) {
  const t: number[] = [];
  for (let n = 0; n < 9; n++) if (m & (1 << n)) t.push(n);
  TILES[m] = t;
}

/** 엔진 compareTiles와 동일 — 0이 8을 잡는다 */
function compare(a: number, b: number): number {
  if (a === b) return 0;
  if (a === 0 && b === 8) return 1;
  if (a === 8 && b === 0) return -1;
  return a > b ? 1 : -1;
}

/** 추상 정보집합 키 (정수 인코딩) */
function keyOf(myMask: number, oppMask: number, myScore: number, oppScore: number, role: number): number {
  const oppB = popcount(oppMask & BLACK);
  const oppW = popcount(oppMask & ~BLACK & FULL);
  return myMask | (oppB << 9) | (oppW << 12) | ((myScore - oppScore + 9) << 15) | (role << 20);
}

// ---------- 정보집합 저장소 ----------

interface InfoSet {
  regret: Float64Array;
  strat: Float64Array; // 선형 가중 평균 전략 누적
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

function currentStrategy(is: InfoSet): Float64Array {
  const n = is.regret.length;
  const out = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) total += is.regret[i];
  if (total <= 0) {
    out.fill(1 / n);
  } else {
    for (let i = 0; i < n; i++) out[i] = is.regret[i] / total;
  }
  return out;
}

// ---------- 외부 표집 MCCFR ----------

/**
 * 반환: 플레이어 0 기준 기대 결과 (+1 승 / 0 무 / -1 패).
 * pending < 0 이면 선의 제시 대기 상태(= 선 차례).
 */
function traverse(
  h0: number, h1: number,
  s0: number, s1: number,
  leader: 0 | 1, pending: number,
  traverser: 0 | 1, w: number,
): number {
  if (pending < 0) {
    const rem = popcount(h0); // 라운드 경계에서는 양쪽 장수 동일
    const d = s0 - s1;
    if (Math.abs(d) > rem) return d > 0 ? 1 : -1; // 역전 불가 — 조기 종료
    if (rem === 0) return d > 0 ? 1 : d < 0 ? -1 : 0; // 동점 = 연장전, 기대값 0 근사
  }

  const actor: 0 | 1 = pending < 0 ? leader : ((1 - leader) as 0 | 1);
  const myMask = actor === 0 ? h0 : h1;
  const oppMask = actor === 0 ? h1 : h0;
  const role = pending < 0 ? 0 : pending % 2 === 0 ? 1 : 2; // 1=흑 제시받음, 2=백
  const key = keyOf(myMask, oppMask, actor === 0 ? s0 : s1, actor === 0 ? s1 : s0, role);
  const tiles = TILES[myMask];
  const is = getInfoSet(key, tiles.length);
  const sigma = currentStrategy(is);

  const child = (tile: number): number => {
    const nMy = myMask & ~(1 << tile);
    if (pending < 0) {
      // 선의 제시
      return actor === 0
        ? traverse(nMy, h1, s0, s1, leader, tile, traverser, w)
        : traverse(h0, nMy, s0, s1, leader, tile, traverser, w);
    }
    // 후의 제시 — 라운드 판정 (pending = 선의 타일)
    const cmp = compare(pending, tile);
    const roundWinner: -1 | 0 | 1 = cmp === 0 ? -1 : cmp > 0 ? leader : actor;
    const ns0 = s0 + (roundWinner === 0 ? 1 : 0);
    const ns1 = s1 + (roundWinner === 1 ? 1 : 0);
    const nLeader = roundWinner < 0 ? leader : roundWinner;
    return actor === 0
      ? traverse(nMy, h1, ns0, ns1, nLeader, -1, traverser, w)
      : traverse(h0, nMy, ns0, ns1, nLeader, -1, traverser, w);
  };

  if (actor === traverser) {
    // 전 분기 + 리그렛 갱신 (CFR+)
    const utils = new Array<number>(tiles.length);
    let node = 0;
    for (let i = 0; i < tiles.length; i++) {
      utils[i] = child(tiles[i]);
      node += sigma[i] * utils[i];
    }
    const sign = actor === 0 ? 1 : -1;
    for (let i = 0; i < tiles.length; i++) {
      is.regret[i] = Math.max(0, is.regret[i] + sign * (utils[i] - node));
    }
    return node;
  }

  // 상대 노드: 평균 전략 누적 후 표집
  for (let i = 0; i < tiles.length; i++) is.strat[i] += w * sigma[i];
  let r = Math.random();
  let picked = tiles[tiles.length - 1];
  for (let i = 0; i < tiles.length; i++) {
    r -= sigma[i];
    if (r <= 0) { picked = tiles[i]; break; }
  }
  return child(picked);
}

// ---------- 학습 루프 ----------

console.log('모노크롬 MCCFR 학습 시작 — 반복', ITERATIONS);
const t0 = performance.now();
for (let iter = 1; iter <= ITERATIONS; iter++) {
  const rootLeader = (iter % 2) as 0 | 1; // 선공 교대
  traverse(FULL, FULL, 0, 0, rootLeader, -1, 0, iter);
  traverse(FULL, FULL, 0, 0, rootLeader, -1, 1, iter);
  if (iter % 200 === 0) {
    const sec = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`iter ${iter} — 정보집합 ${infoSets.size}개 (${sec}s)`);
  }
}
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`완료 (${elapsed}s) — 정보집합 ${infoSets.size}개`);

// ---------- 평균 전략 저장 (도달 가중치 기반 가지치기) ----------

interface Row { key: number; weight: number; probs: number[]; tiles: number[] }
const rows: Row[] = [];
let grandTotal = 0;
for (const [key, is] of infoSets) {
  let total = 0;
  for (let i = 0; i < is.strat.length; i++) total += is.strat[i];
  if (total <= 0) continue;
  const probs = Array.from(is.strat, (s) => s / total);
  rows.push({ key, weight: total, probs, tiles: TILES[key & 0x1ff] });
  grandTotal += total;
}
rows.sort((a, b) => b.weight - a.weight);

// 누적 도달 가중치 99.99%까지만 유지 — 사실상 도달하지 않는 꼬리 키 제거
const policy: Record<string, Record<string, number>> = {};
let cum = 0;
let kept = 0;
for (const row of rows) {
  if (cum / grandTotal >= 0.9999) break;
  cum += row.weight;
  let probs = row.probs.map((p) => (p < 0.01 ? 0 : p));
  const norm = probs.reduce((a, b) => a + b, 0);
  if (norm <= 0) continue;
  const entry: Record<string, number> = {};
  for (let i = 0; i < row.tiles.length; i++) {
    if (probs[i] > 0) entry[String(row.tiles[i])] = Number((probs[i] / norm).toFixed(3));
  }
  policy[row.key.toString(36)] = entry;
  kept++;
}

const outPath = join(process.cwd(), 'src', 'games', 'monochrome', 'policy.json');
writeFileSync(
  outPath,
  JSON.stringify({ meta: { iterations: ITERATIONS, infoSets: infoSets.size, kept }, policy }),
);
console.log(`저장: ${outPath} — 전체 ${rows.length}개 중 ${kept}개 유지`);
