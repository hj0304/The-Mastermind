/**
 * 모노크롬 MCCFR 자가학습 정책 로더 — scripts/cfr/train-monochrome.ts 가 생성한
 * policy.json(평균 전략, 균형 근사)을 지연 로드해 조회한다.
 *
 * 추상 정보집합 키(36진수 정수): 내 잔여 손패 비트마스크 | 상대 잔여 흑/백 장수
 * | 점수차 | 역할(선 / 후+상대 제시 색). 값: 타일(0~8) → 확률.
 */

import type { MonoState, PlayerId } from './engine.ts';
import { tileColor } from './engine.ts';

export type PolicyEntry = Record<string, number>;

let table: Record<string, PolicyEntry> | null = null;
let loading: Promise<void> | null = null;

/** 게임 화면 진입 시 호출 — 정책 테이블(코드 분할 청크)을 미리 불러온다 */
export function loadPolicy(): Promise<void> {
  if (table) return Promise.resolve();
  loading ??= import('./policy.json').then((mod) => {
    table = (mod.default as { policy: Record<string, PolicyEntry> }).policy;
  });
  return loading;
}

const BLACK = 0b101010101;

function maskOf(hand: number[]): number {
  let m = 0;
  for (const t of hand) m |= 1 << t;
  return m;
}

function popcount(x: number): number {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/** 현재 상태 → 학습기와 동일한 추상 정보집합 키 (공개 정보만 사용) */
export function policyKey(s: MonoState, me: PlayerId): string {
  const myMask = maskOf(s.hands[me]);
  const oppMask = maskOf(s.hands[1 - me]); // 흑/백 장수만 쓴다 — 색 구성은 공개 정보
  const oppB = popcount(oppMask & BLACK);
  const oppW = popcount(oppMask & ~BLACK & 0x1ff);
  const diff = s.scores[me] - s.scores[1 - me] + 9;
  const role = s.pending === null ? 0 : tileColor(s.pending) === 'black' ? 1 : 2;
  const key = myMask | (oppB << 9) | (oppW << 12) | (diff << 15) | (role << 20);
  return key.toString(36);
}

export function lookupPolicy(key: string): PolicyEntry | null {
  return table?.[key] ?? null;
}
