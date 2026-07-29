/**
 * 블라인드 홀덤 정보집합 키 + 행동 사다리 — **학습기·평가기·게임 AI가 공유**한다.
 *
 * 이 프로젝트의 "모델 불일치 차단" 원칙: 학습할 때 쓴 추상화와 실제 플레이할 때 쓰는
 * 추상화가 조금이라도 다르면 학습한 전략이 엉뚱한 상황에 적용된다(모노크롬 레이즈에서
 * 실제로 겪은 실패). 그래서 키 계산은 이 파일 하나에만 둔다.
 *
 * 키에 담는 것 — 모두 사람이 알 수 있는 정보에서만 계산된다:
 *  - risk    : 공유 카드의 폴드 위험 프로필 (safe / straight / triple)
 *  - oppRank : 상대 족보 등급 (공유 카드가 공개이므로 확정)
 *  - win     : 내 승률 버킷 (내 이마 사후분포로 적분한 값)
 *  - pen     : 폴드 시 페널티를 낼 확률 버킷
 *  - call    : 콜 비용 버킷
 *  - pot     : 팟 크기 버킷
 *  - hist    : 이번 핸드의 레이즈 시퀀스 (추상화)
 */

import type { BhState, PlayerId } from './engine.ts';
import { legalInfo, potSize, riskProfile } from './engine.ts';
import { winOdds } from './odds.ts';

/** 행동 사다리 — 레이즈 증가량. 'f'=폴드, 'c'=콜, 'A'=올인(최대) */
export const ACTIONS: Record<string, number> = { '1': 1, '3': 3, '5': 5, '9': 9 };
export const ALL_ACTIONS = ['f', 'c', '1', '3', '5', '9', 'A'] as const;
export type ActionCode = (typeof ALL_ACTIONS)[number];

const RISK_CODE: Record<string, number> = { safe: 0, straight: 1, triple: 2 };

/** 이번 핸드의 레이즈 시퀀스 → 추상 토큰 (최근 3수) */
export function histOf(s: BhState): string {
  let h = '';
  for (const { action } of s.actions) {
    if (action.type !== 'raise') continue;
    const amt = action.amount ?? 1;
    if (amt <= 1) h += '1';
    else if (amt <= 3) h += '3';
    else if (amt <= 5) h += '5';
    else if (amt <= 9) h += '9';
    else h += 'A';
  }
  return h.slice(-3);
}

/** 현재 액터(me) 관점의 정보집합 키 */
export function infoKey(s: BhState, me: PlayerId): string {
  const o = winOdds(s, me);
  const info = legalInfo(s);
  const pot = potSize(s);

  const risk = RISK_CODE[riskProfile(s.community)] ?? 0;
  const win = Math.min(7, Math.floor(o.win * 8));
  const pen = o.penalty <= 0 ? 0 : Math.min(3, Math.ceil(o.penalty * 3));
  const call = info.callCost <= 0 ? 0 : Math.min(5, Math.ceil(info.callCost / 2));
  const potB = Math.min(6, Math.floor(pot / 5));

  return `${risk}${o.oppRank}${win}${pen}${call}${potB}|${histOf(s)}`;
}

const WITH_FOLD: ActionCode[] = ['f', 'c', '1', '3', '5', '9', 'A'];
const NO_FOLD: ActionCode[] = ['c', '1', '3', '5', '9', 'A'];

/**
 * 행동 코드 집합. 레이즈 상한 초과는 실행 시 절삭하므로 집합 크기는 **콜 비용 유무만으로
 * 결정된다** — 키의 call 자리(0이면 비용 없음)로 복원 가능해야 학습/실행이 어긋나지 않는다.
 * (콜 비용이 0이면 폴드는 순손실이라 후보에서 제외한다.)
 */
export function actionCodes(s: BhState): ActionCode[] {
  return legalInfo(s).callCost > 0 ? WITH_FOLD : NO_FOLD;
}

/** 정보집합 키에서 행동 라벨을 복원 (학습 결과 저장용) */
export function labelsFromKey(key: string): ActionCode[] {
  return key[4] === '0' ? NO_FOLD : WITH_FOLD;
}

/** 행동 코드 → 엔진 액션 */
export function toAction(s: BhState, code: string): { type: 'fold' | 'call' | 'raise'; amount?: number } {
  const info = legalInfo(s);
  if (code === 'f') return info.callCost > 0 ? { type: 'fold' } : { type: 'call' };
  if (code === 'c') return { type: 'call' };
  if (info.maxRaise < 1) return { type: 'call' };
  const amt = code === 'A' ? info.maxRaise : Math.min(ACTIONS[code] ?? 1, info.maxRaise);
  return { type: 'raise', amount: amt };
}
