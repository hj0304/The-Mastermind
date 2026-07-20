/**
 * 히든 포뮬러의 관점 뷰.
 *
 * 이 게임의 비공개 정보는 단 하나, **이번 게임의 라운드별 규칙 목록**이다.
 * ruleOrder만 있으면 RULES에서 정답 함수를 바로 꺼내 쓸 수 있으므로
 * 게스트에게 보내는 상태에서는 반드시 지운다. 나머지(X·Y·힌트·점수·오답 여부)는
 * 양쪽이 화면으로 보는 공개 정보다.
 *
 * 규칙 설명과 정답은 라운드가 끝난 뒤 lastRound에 담겨 공개된다.
 */

import type { HFState } from './engine.ts';

export function viewFor(s: HFState): HFState {
  return { ...s, ruleOrder: [] };
}
