/**
 * 야누스 포커 MCCFR 자가학습 정책 로더 — scripts/cfr/train-janus.ts 가 생성한
 * policy.json(평균 전략, 단일 핸드 칩 EV 균형 근사)을 지연 로드해 조회한다.
 *
 * 키/토큰 규약은 ai.ts policyKey()·tokenToAction()이 학습기와 공유한다.
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
