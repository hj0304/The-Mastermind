/**
 * 모노크롬 II MCCFR 자가학습 정책 로더 — scripts/cfr/train-monochrome2.ts 가 생성한
 * policy.json(평균 전략, 균형 근사)을 지연 로드해 조회한다.
 *
 * 키(36진수 정수)는 ai.ts 의 policyKey()가 계산한다 (공개 정보만 사용):
 * 내 잔여 포인트 | 상대 잔여 상한 버킷 | 승점 | 남은 라운드 | 역할 | 연장 여부.
 * 값: 입찰액 → 확률.
 */

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

export function lookupPolicy(key: string): PolicyEntry | null {
  return table?.[key] ?? null;
}
