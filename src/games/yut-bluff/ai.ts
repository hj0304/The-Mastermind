/**
 * 윷과 거짓말 AI — 베이지안 거짓말 추정 + 선언 EV + 성향 학습.
 *
 * AI가 쓰는 공개 정보 (사람과 동일):
 * - 말 위치, 선언 내역, **의심으로 공개된** 주사위 값만 (믿어준 선언의 실제 값은
 *   영원히 비공개 — AI도 절대 읽지 않는다. respond 결정은 s.roll에 접근 금지)
 * - 학습: 공개된 사람의 거짓말 빈도·거짓 선언 값 분포, 사람의 의심률(선언 값별)
 *
 * 롤러일 때: 사람의 의심률 모델로 진실/거짓 선언의 EV를 비교.
 * 응답자일 때: 주사위 구성(사전확률) × 학습된 거짓말 성향으로 P(거짓) 베이즈 추정.
 */

import type { BState, PlayerId } from './engine.ts';
import { GOAL, HOME, TRACK_LEN, declarablePieces } from './engine.ts';

// ---------- 성향 학습 ----------

interface BluffTendency {
  /** 사람 선언이 의심으로 공개된 횟수 / 그중 거짓 (꽝 제외 자발적 거짓 별도) */
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

// ---------- 가치 함수 ----------

const PROB: Record<number, number> = { 0: 0.2, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.1, 5: 0.1 };

/**
 * 말 하나의 가치 (진행도 + 희소성).
 * 살아있는 말이 2개뿐이면 하나만 잃어도 즉시 패배 — 가치가 게임 전체에 수렴한다.
 */
function pieceValue(pos: number, aliveCount: number): number {
  const scarcity = aliveCount <= 2 ? 4 : aliveCount === 3 ? 1.8 : 1;
  const base = pos === GOAL ? 100 : pos === HOME ? 22 : 22 + pos * 8;
  return base * scarcity;
}

function countAlive(pieces: number[]): number {
  return pieces.filter((p) => p !== -99).length;
}

/** fromPos에서 v칸 전진하는 이동의 가치 증가분 */
function moveGain(fromPos: number, v: number): number {
  const cur = fromPos === HOME ? 0 : fromPos;
  const dest = cur + v;
  if (dest > TRACK_LEN) return 60 + 30; // 완주 전환 + 보너스
  return v * 8;
}

/** 값별 의심률 사전값 — 큰 선언일수록 의심받기 쉽다 */
const CH_PRIOR: Record<number, number> = { 1: 0.15, 2: 0.2, 3: 0.28, 4: 0.45, 5: 0.55 };

/** 사람의 의심률 추정 (AI가 value를 선언했을 때) — 사전값 + 학습 블렌딩 */
function humanChallengeRate(value: number): number {
  const t = loadTendency();
  const f = t.faced[value];
  const c = t.challenged[value];
  const priorWeight = 6;
  return (c + CH_PRIOR[value] * priorWeight) / (f + priorWeight);
}

// ---------- 롤러(선언) ----------

export interface AiDeclaration {
  value: number;
  fromPos: number;
}

export function chooseAiDeclaration(s: BState, me: PlayerId): AiDeclaration {
  if (s.turn !== me || s.phase !== 'declare') throw new Error('not AI declare');
  const roll = s.roll; // 자기 주사위는 봐도 된다
  const pieces = declarablePieces(s);
  const crossed = s.pieces[me].filter((x) => x === GOAL).length;
  const myAlive = countAlive(s.pieces[me]);
  const oppAlive = countAlive(s.pieces[1 - me]);

  let best: AiDeclaration = { value: Math.max(1, roll), fromPos: pieces[0] };
  let bestEv = -Infinity;

  for (const fromPos of pieces) {
    for (let v = 1; v <= 5; v++) {
      const isLie = v !== roll;
      const pCh = humanChallengeRate(v);
      const gain = moveGain(fromPos, v);
      // 마지막 완주가 걸린 이동은 가치 증폭
      const winBoost =
        crossed === 1 && (fromPos === HOME ? 0 : fromPos) + v > TRACK_LEN ? 60 : 0;
      let ev: number;
      if (!isLie) {
        // 진실: 의심당하면 상대 말 제거 보너스 + 이동
        ev = gain + winBoost + pCh * 12 * (5 - oppAlive + 1);
      } else {
        // 거짓: 의심당하면 지정 말 제거 — 희소할수록 치명적
        ev = (1 - pCh) * (gain + winBoost) - pCh * pieceValue(fromPos, myAlive);
        ev -= 6; // 진실 대비 블러핑 보수성 마진
      }
      ev += Math.random() * 5; // 예측 불가성
      if (ev > bestEv) {
        bestEv = ev;
        best = { value: v, fromPos };
      }
    }
  }
  return best;
}

// ---------- 응답자(믿기/의심) ----------

/**
 * P(사람의 선언이 거짓 | 선언 값) — 베이즈.
 * 진실 경로: P(roll=v) × (1 - 자발적 거짓률)
 * 거짓 경로: [P(꽝)=0.2 (강제 거짓) + Σ_{r≠v,r>0} P(r) × 자발적 거짓률] × P(그 거짓이 v를 고름)
 */
export function estimateLieProb(declared: number): number {
  const t = loadTendency();
  const volLieRate = (t.voluntaryLies + 1) / (t.voluntaryReveals + 4); // 기본 0.25
  // 거짓일 때 v를 고를 확률 (학습 분포, 라플라스)
  const lieTot = t.lieDeclCounts.reduce((a, b) => a + b, 0);
  const pPickV = (t.lieDeclCounts[declared] + 1) / (lieTot + 5);

  const pTruth = PROB[declared] * (1 - volLieRate);
  let pLiePath = PROB[0]; // 꽝은 무조건 거짓
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
  const { value, fromPos } = s.declaration;
  const pLie = estimateLieProb(value);

  const theirAlive = countAlive(s.pieces[s.turn]);
  const myAlive = countAlive(s.pieces[me]);
  const theirGain = moveGain(fromPos, value);
  const crossed = s.pieces[s.turn].filter((x) => x === GOAL).length;
  const winThreat =
    crossed === 1 && (fromPos === HOME ? 0 : fromPos) + value > TRACK_LEN ? 100 : 0;

  // 내 페널티 대상 가치 (희소성 반영 — 잘못 의심하면 내가 위험해진다)
  const myPieces = s.pieces[me];
  const target = myPieces.includes(HOME)
    ? HOME
    : Math.min(...myPieces.filter((p) => p >= 1 && p <= TRACK_LEN), Infinity);
  const myPenalty = target === Infinity ? 0 : pieceValue(target as number, myAlive);

  // 믿기: 상대가 gain 획득. 의심: 거짓이면 지정 말 제거 + 이동 무산, 진실이면 이동 + 내 말 손실
  const evAccept = -(theirGain + winThreat);
  const evChallenge =
    pLie * (pieceValue(fromPos, theirAlive) + winThreat) -
    (1 - pLie) * (theirGain + winThreat + myPenalty);

  return evChallenge + (Math.random() - 0.5) * 8 > evAccept;
}
