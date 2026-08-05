/**
 * CFR+ 자가학습 정책 로더 — scripts/cfr/train-blind-poker.ts 가 생성한
 * policy.json(평균 전략, 내시 균형 근사)을 지연 로드해 조회한다.
 *
 * 정보집합 키: `${내가 보는 상대 카드}|${이번 핸드 레이즈 토큰 나열}`
 * 블랙 핸드(아무 카드도 안 보임)는 카드 자리에 'B': `B|${히스토리}`.
 * 토큰: '1'·'3'·'5' = 해당 증가량 레이즈, 'a' = 올인(최대 레이즈).
 * 값: 행동 토큰('f'/'c'/'1'/'3'/'5'/'a') → 확률.
 */

import type { BpState } from './engine.ts';

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

/** 현재 핸드의 액션 로그 → 학습 추상화의 히스토리 토큰 */
export function policyHist(s: BpState): string {
  let h = '';
  for (const { action } of s.actions) {
    if (action.type !== 'raise') continue;
    const amt = action.amount ?? 1;
    h += amt === 1 || amt === 3 || amt === 5 ? String(amt) : 'a';
  }
  return h;
}

export function lookupPolicy(key: string): PolicyEntry | null {
  return table?.[key] ?? null;
}
