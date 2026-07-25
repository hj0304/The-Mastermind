/**
 * 모노크롬 레이즈 MCCFR 자가학습 정책 로더 — scripts/cfr/train-monochrome-raise.ts 가
 * 생성한 policy.json(평균 전략)을 지연 로드해 조회한다.
 *
 * 루트 키(1<<28)는 배치 템플릿(templates.ts) 위의 혼합 전략,
 * 나머지 키는 콜/폴드('c'/'f') 전략이다. 키 계산은 ai.ts policyKey().
 */

export type PolicyEntry = Record<string, number>;

export const ROOT_KEY = (1 << 28).toString(36);

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
