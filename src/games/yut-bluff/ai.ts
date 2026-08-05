/**
 * 윷과 거짓말 AI — 베이지안 거짓말 추정 + 윷판 이동 평가 + 성향 학습.
 *
 * AI가 쓰는 공개 정보 (사람과 동일):
 * - 말 위치, 선언 내역, **의심으로 공개된** 주사위 값만 (믿어준 선언의 실제 값은
 *   영원히 비공개 — AI도 절대 읽지 않는다. respond 결정은 s.roll에 접근 금지)
 * - 학습: 공개된 사람의 거짓말 빈도·거짓 선언 값 분포, 사람의 의심률(선언 값별)
 */

import type { BState, Declaration, PlayerId } from './engine.ts';
import {
  DEAD,
  GOAL,
  HOME,
  branchOptions,
  kkangTargets,
  movableFroms,
  remainToGoal,
  walkBluff,
} from './engine.ts';
import type { MetaCode } from './infoset.ts';
import { declKey, declMetas, respKey } from './infoset.ts';
import { lookupPolicy } from './policy.ts';

// ---------- 성향 학습 ----------

interface BluffTendency {
  reveals: number;
  lies: number;
  voluntaryReveals: number; // 실제 값이 꽝이 아니었던 공개
  voluntaryLies: number;
  /** 공개된 거짓 선언의 값 분포 (인덱스 1~5) */
  lieDeclCounts: number[];
  /** AI 선언 값별: 사람이 응답한 횟수 / 의심한 횟수 (인덱스 1~5) */
  faced: number[];
  challenged: number[];
  games: number;
}

const STORAGE_KEY = 'mastermind.yut-bluff.tendency.v1';

export function loadTendency(): BluffTendency {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as BluffTendency;
  } catch { /* 무시 */ }
  return {
    reveals: 0,
    lies: 0,
    voluntaryReveals: 0,
    voluntaryLies: 0,
    lieDeclCounts: [0, 0, 0, 0, 0, 0],
    faced: [0, 0, 0, 0, 0, 0],
    challenged: [0, 0, 0, 0, 0, 0],
    games: 0,
  };
}

function save(t: BluffTendency): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch { /* 무시 */ }
}

/** 사람의 선언이 의심으로 공개됐을 때 기록 (공개 정보) */
export function recordHumanReveal(declared: number, actualRoll: number): void {
  const t = loadTendency();
  t.reveals += 1;
  const lie = actualRoll !== declared;
  if (lie) {
    t.lies += 1;
    t.lieDeclCounts[declared] += 1;
  }
  if (actualRoll !== 0) {
    t.voluntaryReveals += 1;
    if (lie) t.voluntaryLies += 1;
  }
  save(t);
}

/** AI 선언에 대한 사람의 응답 기록 (공개 정보) */
export function recordHumanResponse(aiDeclared: number, challenged: boolean): void {
  const t = loadTendency();
  t.faced[aiDeclared] += 1;
  if (challenged) t.challenged[aiDeclared] += 1;
  save(t);
}

export function recordGameEnd(): void {
  const t = loadTendency();
  t.games += 1;
  save(t);
}

// ---------- 평가 ----------

const PROB: Record<number, number> = { 0: 0.2, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.1, 5: 0.1 };

function countAlive(pieces: number[]): number {
  return pieces.filter((x) => x !== DEAD).length;
}

/**
 * 말 하나의 가치 (미래 잠재력 + 진행도 + 희소성).
 * 말은 승리의 화폐(6개로 2완주) — 기본 가치를 이동 이득과 같은 스케일로 크게 잡아야
 * 거짓말 남발로 말을 소모하는 퇴화를 막는다 (시뮬레이션으로 확인).
 */
export function pieceValue(pos: number, aliveCount: number): number {
  const scarcity = aliveCount <= 2 ? 5 : aliveCount === 3 ? 2.2 : aliveCount === 4 ? 1.4 : 1;
  const base = pos === GOAL ? 150 : pos === HOME ? 60 : 60 + (21 - remainToGoal(pos)) * 6;
  return base * scarcity;
}

/** me 관점 국면 평가 (진행도 + 잡힘 위협) */
export function evaluate(pieces: [number[], number[]], me: PlayerId): number {
  const opp = (1 - me) as PlayerId;
  let score = 0;
  for (const pos of pieces[me]) {
    if (pos === DEAD) continue;
    score += pos === GOAL ? 130 : pos === HOME ? 4 : (21 - remainToGoal(pos)) * 6;
  }
  for (const pos of pieces[opp]) {
    if (pos === DEAD) continue;
    score -= pos === GOAL ? 130 : pos === HOME ? 4 : (21 - remainToGoal(pos)) * 6;
  }
  score -= 0.35 * catchThreat(pieces, me);
  score += 0.35 * catchThreat(pieces, opp);
  // 말 여유 차이 (제거전 견제)
  score += (countAlive(pieces[me]) - countAlive(pieces[opp])) * 14;
  return score;
}

/** victim의 말이 상대 사거리(1~5)에 있는 정도 */
function catchThreat(pieces: [number[], number[]], victim: PlayerId): number {
  const attacker = (1 - victim) as PlayerId;
  const myNodes = new Map<number, number>();
  for (const pos of pieces[victim]) {
    if (pos >= 0 && pos !== GOAL) myNodes.set(pos, (myNodes.get(pos) ?? 0) + 1);
  }
  if (myNodes.size === 0) return 0;
  let threat = 0;
  for (const apos of pieces[attacker]) {
    if (apos < 0 || apos === GOAL) continue;
    for (let v = 1; v <= 5; v++) {
      for (const b of branchOptions(apos)) {
        const dest = walkBluff(apos, v, b);
        const cnt = myNodes.get(dest);
        if (cnt) threat += PROB[v] * cnt * 30;
      }
    }
  }
  return threat;
}

/** 값별 의심률 사전값 — 합리적 응답자는 윷/모 선언을 강하게 의심한다 */
const CH_PRIOR: Record<number, number> = { 1: 0.15, 2: 0.2, 3: 0.3, 4: 0.65, 5: 0.75 };

function humanChallengeRate(value: number): number {
  const t = loadTendency();
  const priorWeight = 6;
  return (t.challenged[value] + CH_PRIOR[value] * priorWeight) / (t.faced[value] + priorWeight);
}

/** 선언 이동을 가상 실행했을 때의 평가 이득 (+한 번 더 보너스) */
function moveEvalGain(s: BState, me: PlayerId, d: Declaration): number {
  const opp = (1 - me) as PlayerId;
  const dest = walkBluff(d.from, d.value, d.branch);
  const mine = [...s.pieces[me]];
  const theirs = [...s.pieces[opp]];
  if (d.from === HOME) mine[mine.indexOf(HOME)] = dest;
  else for (let i = 0; i < mine.length; i++) if (mine[i] === d.from) mine[i] = dest;
  let caught = false;
  if (dest !== GOAL) {
    for (let i = 0; i < theirs.length; i++) {
      if (theirs[i] === dest) {
        theirs[i] = HOME;
        caught = true;
      }
    }
  }
  const after: [number[], number[]] = me === 0 ? [mine, theirs] : [theirs, mine];
  let gain = evaluate(after, me) - evaluate(s.pieces, me);
  if (caught || d.value >= 4) gain += 18; // 한 번 더
  const myGoals = s.pieces[me].filter((x) => x === GOAL).length;
  if (dest === GOAL && myGoals === 1) gain += 400; // 승리 확정
  return gain;
}

// ---------- 롤러(선언) ----------

export function chooseAiDeclaration(s: BState, me: PlayerId): Declaration {
  if (s.turn !== me || s.phase !== 'declare') throw new Error('not AI declare');
  const roll = s.roll; // 자기 주사위는 봐도 된다
  const froms = movableFroms(s, me);
  const myAlive = countAlive(s.pieces[me]);

  let best: Declaration | null = null;
  let bestEv = -Infinity;

  // 이동 선언 후보 (진실/거짓)
  for (const from of froms) {
    for (const branch of branchOptions(from)) {
      for (let v = 1; v <= 5; v++) {
        const isLie = v !== roll;
        const pCh = humanChallengeRate(v);
        const gain = moveEvalGain(s, me, { value: v, from, branch });
        let ev: number;
        if (!isLie) {
          // 진실: 의심당하면 상대 말 제거 보너스 + 이동은 그대로
          ev = gain + pCh * 34;
        } else {
          ev = (1 - pCh) * gain - pCh * pieceValue(from, myAlive) - 8;
        }
        ev += Math.random() * 5;
        if (ev > bestEv) {
          bestEv = ev;
          best = { value: v, from, branch };
        }
      }
    }
  }

  // 꽝(진실) 선언 후보 — 꽝이 나왔을 때만 의미 있음
  if (roll === 0) {
    const targets = kkangTargets(s, me);
    for (const t of targets) {
      const ev = -pieceValue(t, myAlive) + 4;
      if (ev > bestEv) {
        bestEv = ev;
        best = { value: 0, from: t, branch: 0 };
      }
    }
  }

  if (!best) throw new Error('no declaration available');
  return best;
}

// ---------- 응답자(믿기/의심) ----------

/** P(사람의 선언이 거짓 | 선언 값) — 베이즈 */
export function estimateLieProb(declared: number): number {
  const t = loadTendency();
  const volLieRate = (t.voluntaryLies + 1) / (t.voluntaryReveals + 4); // 기본 0.25
  const lieTot = t.lieDeclCounts.reduce((a, b) => a + b, 0);
  const pPickV = (t.lieDeclCounts[declared] + 1) / (lieTot + 5);

  const pTruth = PROB[declared] * (1 - volLieRate);
  let pLiePath = PROB[0]; // 꽝은 이동 선언 시 무조건 거짓
  for (let r = 1; r <= 5; r++) {
    if (r === declared) continue;
    pLiePath += PROB[r] * volLieRate;
  }
  const pLie = pLiePath * pPickV;
  return pLie / (pLie + pTruth);
}

export function chooseAiResponse(s: BState, me: PlayerId): boolean {
  if (s.turn === me || s.phase !== 'respond' || !s.declaration) throw new Error('not AI respond');
  // 주의: s.roll은 비공개 — 절대 읽지 않는다
  const roller = s.turn;
  const d = s.declaration;
  const pLie = estimateLieProb(d.value);

  const theirAlive = countAlive(s.pieces[roller]);
  const myAlive = countAlive(s.pieces[me]);
  const theirGain = moveEvalGain(s, roller, d);
  const theirGoals = s.pieces[roller].filter((x) => x === GOAL).length;
  const dest = walkBluff(d.from, d.value, d.branch);
  const winThreat = theirGoals === 1 && dest === GOAL ? 250 : 0;

  const myPenaltyPos = s.pieces[me].includes(HOME)
    ? HOME
    : s.pieces[me].filter((x) => x >= 0 && x !== GOAL).sort((a, b) => remainToGoal(b) - remainToGoal(a))[0];
  const myPenalty = myPenaltyPos === undefined ? 0 : pieceValue(myPenaltyPos, myAlive);

  // 믿기: 상대가 gain 획득. 의심: 거짓이면 이동 무효 + 지정 말 제거, 진실이면 이동 + 내 말 손실
  const evAccept = -(theirGain + winThreat);
  const evChallenge =
    pLie * (pieceValue(d.from, theirAlive) + winThreat * 0.5) -
    (1 - pLie) * (theirGain + winThreat + myPenalty);

  return evChallenge + (Math.random() - 0.5) * 8 > evAccept;
}

// ---------- 메타 행동 해석 (학습·평가·실전 공용 — 모델 불일치 차단) ----------
//
// 학습이 담당하는 것은 "진실이냐 거짓이냐, 거짓이면 얼마나 크게" 라는 카테고리
// 선택뿐이다. 어느 말을 어디로 보낼지는 균형이 아니라 위치 최적화 문제이므로
// 아래 해석기가 기존 평가 함수(moveEvalGain)로 결정한다 — 난수를 쓰지 않는다.

/** 카테고리에 해당하는 선언 값 후보 */
function valuesForMeta(roll: number, code: MetaCode): number[] {
  if (code === 't') return [roll];
  if (code === 'l') return [1, 2, 3].filter((v) => v !== roll);
  if (code === 'h') return [4, 5].filter((v) => v !== roll);
  return [];
}

/** 이 주사위로 완주해 승리를 확정할 수 있는가 (선언 키의 winReach 자리) */
export function canWinByDeclaring(s: BState, me: PlayerId): boolean {
  if (s.pieces[me].filter((x) => x === GOAL).length !== 1) return false;
  for (const from of movableFroms(s, me)) {
    for (const branch of branchOptions(from)) {
      for (let v = 1; v <= 5; v++) {
        if (walkBluff(from, v, branch) === GOAL) return true;
      }
    }
  }
  return false;
}

/** 이 선언을 믿어주면 상대가 그대로 승리하는가 (응답 키의 winThreat 자리) */
export function declarationWins(s: BState, roller: PlayerId): boolean {
  const d = s.declaration;
  if (!d || d.value === 0) return false;
  if (s.pieces[roller].filter((x) => x === GOAL).length !== 1) return false;
  return walkBluff(d.from, d.value, d.branch) === GOAL;
}

/** 선언 메타 → 실제 선언 (카테고리 안에서는 위치 이득 최대) */
export function resolveDeclMeta(s: BState, me: PlayerId, code: MetaCode): Declaration {
  const myAlive = countAlive(s.pieces[me]);

  if (code === 'k') {
    // 꽝 신고 — 잃는 말이 가장 싼 쪽
    let best: Declaration | null = null;
    let bestEv = -Infinity;
    for (const t of kkangTargets(s, me)) {
      const ev = -pieceValue(t, myAlive);
      if (ev > bestEv) {
        bestEv = ev;
        best = { value: 0, from: t, branch: 0 };
      }
    }
    if (best) return best;
  }

  const values = valuesForMeta(s.roll, code);
  let best: Declaration | null = null;
  let bestGain = -Infinity;
  for (const from of movableFroms(s, me)) {
    for (const branch of branchOptions(from)) {
      for (const v of values) {
        const cand: Declaration = { value: v, from, branch };
        let gain = moveEvalGain(s, me, cand);
        // 거짓이면 들켰을 때 잃을 말의 가치를 함께 본다 (어느 말을 걸지의 판단)
        if (v !== s.roll) gain -= pieceValue(from, myAlive) * 0.25;
        if (gain > bestGain) {
          bestGain = gain;
          best = cand;
        }
      }
    }
  }
  if (best) return best;
  // 카테고리가 비는 경우는 없지만(주사위 값별로 항상 후보가 남는다) 안전망
  return chooseAiDeclaration(s, me);
}

// ---------- 정책 우선 선택 (게임 화면이 쓰는 진입점) ----------

function samplePolicyCode(key: string, legal: MetaCode[]): MetaCode | null {
  const entry = lookupPolicy(key);
  if (!entry) return null;
  const pairs = Object.entries(entry).filter(([c]) => legal.includes(c as MetaCode));
  const total = pairs.reduce((a, [, p]) => a + p, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [c, p] of pairs) {
    r -= p;
    if (r <= 0) return c as MetaCode;
  }
  return pairs[pairs.length - 1][0] as MetaCode;
}

/** 선언 결정 — 학습된 균형 빈도 우선, 미적중이면 기존 휴리스틱 */
export function chooseDeclaration(s: BState, me: PlayerId): Declaration {
  if (s.turn !== me || s.phase !== 'declare') throw new Error('not AI declare');
  const code = samplePolicyCode(declKey(s, me, canWinByDeclaring(s, me)), declMetas(s.roll));
  if (code) return resolveDeclMeta(s, me, code);
  return chooseAiDeclaration(s, me);
}

/** 응답 결정 — 학습된 균형 빈도 우선. s.roll은 절대 읽지 않는다 */
export function chooseResponse(s: BState, me: PlayerId): boolean {
  if (s.turn === me || s.phase !== 'respond' || !s.declaration) throw new Error('not AI respond');
  const roller = s.turn;
  const code = samplePolicyCode(respKey(s, me, declarationWins(s, roller)), ['b', 'c']);
  if (code) return code === 'c';
  return chooseAiResponse(s, me);
}
