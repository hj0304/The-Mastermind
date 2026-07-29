/**
 * 블라인드 홀덤 MCCFR 자가학습 정책 로더 — scripts/cfr/train-blind-holdem.ts 가 생성한
 * policy.json(평균 전략)을 지연 로드해 조회한다.
 *
 * 키/행동 규약은 infoset.ts 하나에서만 계산되며 학습기·평가기·게임이 공유한다.
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
