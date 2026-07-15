/**
 * 윷 대전 AI — 행렬게임 혼합전략 + 사람 선택 성향 학습 + 이동 평가.
 *
 * AI가 쓰는 공개 정보 (사람과 동일):
 * - 판 위 말 위치, 매 던지기에서 공개된 양측의 앞면 수 선택 기록
 * - 사람의 선택 분포를 역할별(내 차례/상대 차례)로 학습 — 선택은 공개 정보
 *
 * 매 던지기: 현재 국면에서 결과(모/뒷도/개/걸/윷)별 가치를 이동 평가로 계산해
 * 3×3 제로섬 행렬을 만들고, 후회 매칭으로 혼합 내시균형을 근사한다.
 * 사람 표본이 쌓이면 학습된 분포에 대한 최선응수를 섞어 착취한다.
 */

import type { MoveOption, PlayerId, YState } from './engine.ts';
import {
  GOAL,
  HOME,
  JUNCTIONS,
  applyMove,
  moveOptions,
  resolveThrow,
  totalToSteps,
  walkForward,
} from './engine.ts';

// ---------- 사람 성향 학습 ----------

interface YutTendency {
  /** [역할][앞면 수] 카운트 — mover: 자기 말이 움직일 때, blocker: 상대 말일 때 */
  moverPicks: [number, number, number];
  blockerPicks: [number, number, number];
  games: number;
}

const STORAGE_KEY = 'mastermind.yut-tactics.tendency.v1';

export function loadTendency(): YutTendency {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as YutTendency;
  } catch { /* 무시 */ }
  return { moverPicks: [0, 0, 0], blockerPicks: [0, 0, 0], games: 0 };
}

export function recordPickForLearning(humanWasMover: boolean, humanPick: number): void {
  try {
    const t = loadTendency();
    (humanWasMover ? t.moverPicks : t.blockerPicks)[humanPick] += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch { /* 무시 */ }
}

export function recordGameEnd(): void {
  try {
    const t = loadTendency();
    t.games += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch { /* 무시 */ }
}

// ---------- 위치 평가 ----------

/** 노드별 완주까지 최단 스텝 (지름길 최선 선택 가정) */
const DIST: Record<number, number> = (() => {
  const d: Record<number, number> = { [GOAL]: 0 };
  // 완주 직전 경로들부터 역산 (0 도달 = 완주)
  d[19] = 1; d[28] = 1; d[27] = 2;
  d[18] = 2; d[17] = 3; d[16] = 4; d[15] = 5;
  d[24] = 6; d[23] = 7;
  d[22] = 3; // 22→27→28→완주
  d[26] = 4; d[25] = 5;
  d[21] = 4; d[20] = 5;
  d[14] = 6; d[13] = 7; d[12] = 8; d[11] = 9;
  d[10] = 6; // 10→25→26→22→27→28→완주
  d[9] = 7; d[8] = 8; d[7] = 9; d[6] = 10;
  d[5] = 8; // 5→20→21→22→27→28→완주
  d[4] = 9; d[3] = 10; d[2] = 11; d[1] = 12;
  d[HOME] = 13; // 진입(0에서 출발) 기준 근사
  return d;
})();

function pieceScore(pos: number): number {
  if (pos === GOAL) return 300;
  return (13 - DIST[pos]) * 14;
}

/** me 관점 국면 평가 */
export function evaluate(s: YState, me: PlayerId): number {
  const opp = (1 - me) as PlayerId;
  let score = 0;
  for (const p of s.pieces[me]) score += pieceScore(p.pos);
  for (const p of s.pieces[opp]) score -= pieceScore(p.pos);

  // 잡힘 위협: 상대가 만들 수 있는 결과(뒷도/개/걸/윷/모)로 내 말에 정확히 닿는가
  score -= threatPenalty(s, me);
  score += threatPenalty(s, opp);

  // 분기점 점유 보너스 (다음 이동에서 지름길)
  for (const p of s.pieces[me]) if (JUNCTIONS.has(p.pos)) score += 10;
  for (const p of s.pieces[opp]) if (JUNCTIONS.has(p.pos)) score -= 10;
  return score;
}

function threatPenalty(s: YState, victim: PlayerId): number {
  const attacker = (1 - victim) as PlayerId;
  let pen = 0;
  const myNodes = new Map<number, number>(); // pos → 말 수
  for (const p of s.pieces[victim]) {
    if (p.pos >= 0 && p.pos !== GOAL) myNodes.set(p.pos, (myNodes.get(p.pos) ?? 0) + 1);
  }
  if (myNodes.size === 0) return 0;

  const reach = new Set<number>();
  for (const ap of s.pieces[attacker]) {
    if (ap.pos === GOAL) continue;
    for (const m of [-1, 2, 3, 4, 5]) {
      if (m === -1) {
        if (ap.pos === HOME) continue;
        const back = ap.cameFrom ?? 0;
        if (back > 0) reach.add(back);
        continue;
      }
      const branches: (0 | 1)[] = ap.pos !== HOME && JUNCTIONS.has(ap.pos) ? [0, 1] : [0];
      for (const b of branches) {
        const w = walkDest(ap.pos, m, b);
        if (w >= 0) reach.add(w);
      }
    }
  }
  for (const [node, count] of myNodes) {
    if (reach.has(node)) pen += count >= 2 ? 90 : 34;
  }
  return pen;
}

// walkForward의 얇은 래퍼 (GOAL이면 -1)
function walkDest(from: number, m: number, branch: 0 | 1): number {
  const { dest } = walkForward(from, m, branch);
  return dest === GOAL ? -1 : dest;
}

// ---------- 이동 선택 ----------

export function chooseAiMove(s: YState, me: PlayerId): MoveOption {
  const opts = moveOptions(s);
  if (opts.length === 0) throw new Error('no move options');
  let best = opts[0];
  let bestV = -Infinity;
  for (const o of opts) {
    const after = applyMove(s, o);
    let v = evaluate(after, me);
    if (o.catches) v += 30; // 잡기 = 한 번 더
    v += Math.random() * 4;
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  return best;
}

// ---------- 윷가락 선택 (행렬게임) ----------

/** total(0~4)의 결과가 s에서 실현될 때 me 관점 가치 */
function outcomeValue(s: YState, me: PlayerId, total: number): number {
  const steps = totalToSteps(total);
  const mover = s.turn;
  // 가상 적용: resolveThrow → (이동 가능하면) 무버 최선 이동
  const picks: [number, number] = [0, 0];
  picks[0] = Math.min(2, total);
  picks[1] = total - picks[0];
  const afterThrow = resolveThrow({ ...s, throwCount: 0 }, picks);
  if (afterThrow.phase !== 'move') {
    return evaluate(afterThrow, me); // 패스
  }
  let bestV = mover === me ? -Infinity : Infinity;
  for (const o of moveOptions(afterThrow)) {
    const after = applyMove(afterThrow, o);
    let v = evaluate(after, me);
    // 한 번 더의 가치: 잡기/윷/모로 턴 유지 시 보정
    if (after.turn === mover && !after.result) v += mover === me ? 26 : -26;
    if (after.result) v = after.result.winner === me ? 10000 : after.result.winner === null ? 0 : -10000;
    bestV = mover === me ? Math.max(bestV, v) : Math.min(bestV, v);
  }
  void steps;
  return bestV;
}

/** 후회 매칭으로 3×3 제로섬 게임의 혼합전략 근사 (me = 행 플레이어, 가치 최대화) */
function solveMixed(payoff: number[][]): number[] {
  const n = 3;
  const regretRow = [0, 0, 0];
  const regretCol = [0, 0, 0];
  const sumRow = [0, 0, 0];
  const strat = (regret: number[]): number[] => {
    const pos = regret.map((r) => Math.max(0, r));
    const tot = pos[0] + pos[1] + pos[2];
    return tot > 0 ? pos.map((p) => p / tot) : [1 / 3, 1 / 3, 1 / 3];
  };
  const sample = (p: number[]): number => {
    let r = Math.random();
    for (let i = 0; i < n; i++) {
      r -= p[i];
      if (r <= 0) return i;
    }
    return n - 1;
  };
  for (let it = 0; it < 800; it++) {
    const pr = strat(regretRow);
    const pc = strat(regretCol);
    for (let i = 0; i < n; i++) sumRow[i] += pr[i];
    const a = sample(pr);
    const b = sample(pc);
    const u = payoff[a][b];
    for (let i = 0; i < n; i++) {
      regretRow[i] += payoff[i][b] - u;
      regretCol[i] += -(payoff[a][i]) + u; // 열은 최소화
    }
  }
  const tot = sumRow[0] + sumRow[1] + sumRow[2];
  return sumRow.map((x) => x / tot);
}

/** AI의 앞면 수 선택 (0~2). aiIsP0: AI가 pieces[0]인지 */
export function chooseAiSticks(s: YState, me: PlayerId): number {
  // 3×3 가치 행렬: payoff[aiPick][humanPick] (me 관점)
  const payoff: number[][] = [];
  const cache = new Map<number, number>();
  for (let a = 0; a <= 2; a++) {
    payoff.push([]);
    for (let h = 0; h <= 2; h++) {
      const total = a + h;
      if (!cache.has(total)) cache.set(total, outcomeValue(s, me, total));
      payoff[a].push(cache.get(total)!);
    }
  }

  const nash = solveMixed(payoff);

  // 사람 성향 착취: 표본이 충분하면 학습 분포에 대한 최선응수를 섞는다
  const t = loadTendency();
  const humanIsMover = s.turn !== me;
  const counts = humanIsMover ? t.moverPicks : t.blockerPicks;
  const nSamples = counts[0] + counts[1] + counts[2];
  let final = nash;
  if (nSamples >= 8) {
    const hDist = counts.map((c) => (c + 1) / (nSamples + 3));
    const ev = [0, 1, 2].map((a) =>
      hDist.reduce((acc, ph, h) => acc + ph * payoff[a][h], 0),
    );
    const brIdx = ev.indexOf(Math.max(...ev));
    const exploit = Math.min(0.55, nSamples / 60);
    final = nash.map((p, i) => p * (1 - exploit) + (i === brIdx ? exploit : 0));
  }

  let r = Math.random();
  for (let i = 0; i < 3; i++) {
    r -= final[i];
    if (r <= 0) return i;
  }
  return 2;
}
