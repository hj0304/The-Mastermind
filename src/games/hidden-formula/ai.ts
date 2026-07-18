/**
 * 히든 포뮬러 AI.
 *
 * 공정성 원칙: 숨은 규칙(state.ruleOrder)은 절대 읽지 않는다.
 * AI는 공개 정보(문제 X?Y, 힌트 목록)만으로 규칙 은행 후보를 소거하고,
 * 후보가 하나로 확정되거나 모든 후보의 답이 일치할 때만 버저를 누른다.
 * 따라서 AI의 오답은 '자신이 고려한 규칙 폭이 진짜 규칙을 놓친 경우'에만 발생 —
 * 사람과 같은 방식의 귀납 추론 실수다.
 *
 * 난이도: 라운드마다 규칙 은행의 일부만 고려(추론 폭). 인간의 정답률을
 * 학습해 폭과 버저 속도를 보정한다.
 */

import type { Hint, PlayerId } from './engine.ts';
import { MAX_NUM, RULES } from './engine.ts';

/** AI가 보는 공개 정보 — 이 밖의 상태는 받지 않는다 */
export interface PublicView {
  X: number;
  Y: number;
  hints: Hint[];
}

// ---------- 성향 저장 ----------

const TENDENCY_KEY = 'mastermind.hidden-formula.tendency.v1';

interface Tendency {
  rounds: number;
  humanCorrect: number;
  games: number;
}

function loadTendency(): Tendency {
  try {
    const raw = localStorage.getItem(TENDENCY_KEY);
    if (raw) return { rounds: 0, humanCorrect: 0, games: 0, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { rounds: 0, humanCorrect: 0, games: 0 };
}

function saveTendency(t: Tendency) {
  try {
    localStorage.setItem(TENDENCY_KEY, JSON.stringify(t));
  } catch {
    // ignore
  }
}

export function recordRound(humanWon: boolean) {
  const t = loadTendency();
  t.rounds += 1;
  if (humanWon) t.humanCorrect += 1;
  saveTendency(t);
}

export function recordGameEnd() {
  const t = loadTendency();
  t.games += 1;
  saveTendency(t);
}

/** 인간 라운드 승률 추정 (사전값 0.25) */
function humanSkill(): number {
  const t = loadTendency();
  return (t.humanCorrect + 1) / (t.rounds + 4);
}

// ---------- 추론 ----------

/** 라운드 시작 시 AI가 고려할 규칙 폭 선택 (숨은 규칙과 무관하게 무작위) */
export function pickConsidered(): number[] {
  const ratio = Math.min(1, Math.max(0.55, 0.5 + humanSkill() * 0.6));
  const idx = RULES.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const n = Math.max(4, Math.round(RULES.length * ratio));
  return idx.slice(0, n);
}

function consistent(ruleIdx: number, hints: Hint[]): boolean {
  const r = RULES[ruleIdx];
  return hints.every((h) => r.fn(h.a, h.b) === h.c);
}

export interface AiStatus {
  candidates: number[];
  certain: boolean;
  answer: string | null;
}

/** 현재 공개 정보로 AI의 추론 상태 계산 */
export function aiStatus(view: PublicView, considered: number[]): AiStatus {
  let candidates = considered.filter((i) => consistent(i, view.hints));
  // 고려 폭이 진짜 규칙을 놓쳐 후보가 비면 — 전체 은행으로 '기억을 쥐어짠다'
  if (candidates.length === 0) {
    candidates = RULES.map((_, i) => i).filter((i) => consistent(i, view.hints));
  }
  if (view.hints.length === 0 || candidates.length === 0) {
    return { candidates, certain: false, answer: null };
  }
  const answers = new Set(candidates.map((i) => RULES[i].fn(view.X, view.Y)));
  if (answers.size === 1) {
    return { candidates, certain: true, answer: [...answers][0] };
  }
  return { candidates, certain: false, answer: null };
}

/**
 * 수 제시: 살아남은 후보 규칙들의 출력을 최대한 가르는 수를 고른다(능동 실험).
 * position 'first'면 상대 수를 모르므로 소수의 가정 파트너로 근사.
 */
export function aiPickNumber(
  view: PublicView,
  position: 'first' | 'second',
  other: number | null,
  considered: number[],
): number {
  const { candidates } = aiStatus(view, considered);
  const pool = new Set<number>([
    1, 2, 7, 12, 51,
    3 + Math.floor(Math.random() * 7),
    10 + Math.floor(Math.random() * 90),
    10 + Math.floor(Math.random() * 90),
    100 + Math.floor(Math.random() * 900),
  ]);
  const valid = (n: number): boolean => {
    if (n < 1 || n > MAX_NUM) return false;
    if (position === 'second' && other !== null) {
      const pair = new Set([n, other]);
      if (pair.has(view.X) && pair.has(view.Y) && pair.size === 2) return false;
    }
    return true;
  };
  const options = [...pool].filter(valid);
  if (options.length === 0) return 7;
  if (candidates.length <= 1) {
    // 이미 확정적 — 간단한 수로 시간만 끌지 않는다
    return options[Math.floor(Math.random() * options.length)];
  }
  let best = options[0];
  let bestScore = -1;
  for (const n of options) {
    let score = 0;
    if (position === 'second' && other !== null) {
      score = new Set(candidates.map((i) => RULES[i].fn(other, n))).size;
    } else {
      for (const partner of [view.Y, 7, 23]) {
        score += new Set(candidates.map((i) => RULES[i].fn(n, partner))).size;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** 버저까지의 지연(ms). 힌트가 쌓일수록, 인간이 강할수록 빨라진다 */
export function aiBuzzDelay(hintCount: number): number {
  const base = Math.max(2.2, 8.5 - hintCount * 1.4 - humanSkill() * 4);
  return (base + Math.random() * 3.5) * 1000;
}

export type { PlayerId };
