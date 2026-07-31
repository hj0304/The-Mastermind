/**
 * 블라인드 포커 "블랙 핸드" 변형 킥 감사 — 실제 엔진으로 불변식을 전수 검증한다.
 *
 * 검증 항목:
 *  [1] 완주한 덱(10핸드)마다 블랙 핸드가 정확히 2회 발생
 *  [2] 블랙 핸드 카드는 seenCards에 절대 들어가지 않는다
 *      (유일한 예외: 10 폴드 페널티 — 칩 이동으로 공개되는 그 카드만 편입)
 *  [3] 블랙 핸드 베팅 중 seenCards에 현재 핸드 카드가 없다 (상대 카드 은닉)
 *  [4] 정상 핸드의 공개 규칙은 기존과 동일 (회귀 방지)
 *  [5] unseenCounts 합 = 20 − seen (분포 무결성)
 *  [6] 블랙 핸드의 1인 총 베팅 ≤ 안테 + BLACK_MAX_RAISE (올인 동전던지기 차단)
 *
 * 실행: npm run rules:audit:black
 */

import {
  ANTE,
  BLACK_MAX_RAISE,
  act,
  createGame,
  gameWinner,
  legalInfo,
  nextHand,
  seenCards,
  unseenCounts,
} from '../../src/games/blind-poker/engine.ts';
import type { BpAction, BpState, PlayerId } from '../../src/games/blind-poker/engine.ts';

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error('  ❌', msg);
  }
}

/** 무작위지만 합법인 행동 (레이즈 전쟁 방지 캡 포함) */
function randomAction(s: BpState): BpAction {
  const info = legalInfo(s);
  const myRaises = s.actions.filter((a) => a.player === s.toAct && a.action.type === 'raise').length;
  const r = Math.random();
  if (r < 0.15 && info.callCost > 0) return { type: 'fold' };
  if (r < 0.55 || myRaises >= 3 || info.raiseOptions.length === 0) return { type: 'call' };
  return { type: 'raise', amount: info.raiseOptions[Math.floor(Math.random() * info.raiseOptions.length)] };
}

const GAMES = 3000;
let totalHands = 0;
let blackHands = 0;
let fullDecks = 0;
let blackPenalties = 0;

for (let g = 0; g < GAMES; g++) {
  let s = createGame((g % 2) as PlayerId);
  let deckBlackCount = 0;
  let deckStart = s.deckStartHand;
  let guard = 0;

  while (s.phase !== 'gameover' && guard++ < 5000) {
    if (s.phase === 'betting') {
      totalHands += s.actions.length === 0 ? 1 : 0;
      if (s.actions.length === 0) {
        // 새 덱 경계: 직전 덱이 10핸드를 완주했으면 블랙 2회를 검증
        if (s.deckStartHand !== deckStart) {
          check(deckBlackCount === 2, `[1] 완주 덱의 블랙 핸드 수 ${deckBlackCount} ≠ 2 (game ${g})`);
          fullDecks++;
          deckBlackCount = 0;
          deckStart = s.deckStartHand;
        }
        if (s.isBlack) {
          blackHands++;
          deckBlackCount++;
        }
        // [3] 블랙 핸드 베팅 중: 현재 핸드의 두 카드 모두 은닉되어야 한다
        for (const viewer of [0, 1] as PlayerId[]) {
          const seen = seenCards(s, viewer);
          const past = s.history.slice(s.deckStartHand - 1);
          // 과거 핸드에서 나올 수 있는 공개 카드 수의 상한과 비교하는 대신,
          // "현재 핸드 상대 카드 포함 여부"를 카드 제거로 정확히 판정한다
          const expectedCurrent = s.isBlack ? 0 : 1;
          let pastCount = 0;
          for (const h of past) {
            if (h.black) pastCount += h.penalty ? 1 : 0;
            else pastCount += h.outcome !== 'fold' || h.folder === viewer ? 2 : 1;
          }
          check(
            seen.length === pastCount + expectedCurrent,
            `[3] seen 크기 불일치 viewer=${viewer} black=${s.isBlack} (game ${g})`,
          );
          // [5] 분포 무결성
          const counts = unseenCounts(s, viewer);
          const total = counts.reduce((a, b) => a + b, 0);
          check(total === 20 - seen.length, `[5] unseen 합 ${total} ≠ ${20 - seen.length} (game ${g})`);
        }
      }
      s = act(s, randomAction(s));
      // [6] 블랙 핸드 베팅 캡 — 어떤 행동 뒤에도 1인 투자액이 안테+3을 못 넘는다
      if (s.isBlack && s.phase === 'betting') {
        check(
          s.invested[0] <= ANTE + BLACK_MAX_RAISE && s.invested[1] <= ANTE + BLACK_MAX_RAISE,
          `[6] 블랙 베팅 캡 초과 ${s.invested} (game ${g})`,
        );
      }
    } else if (s.phase === 'result') {
      const h = s.history[s.history.length - 1];
      if (h.black && h.penalty) blackPenalties++;
      // [2]/[4] 방금 끝난 핸드의 공개 규칙
      for (const viewer of [0, 1] as PlayerId[]) {
        const seen = seenCards(s, viewer);
        const cnt = (v: number) => seen.filter((x) => x === v).length;
        if (h.black) {
          // 블랙 핸드 카드는 페널티(=10) 말고는 seen에 기여하면 안 된다.
          // 페널티 없는 블랙 핸드 직후 seen에 이번 핸드 카드가 섞였는지는 [3]의
          // 크기 검증이 다음 딜에서 잡아낸다 — 여기서는 페널티 공개만 확인.
          if (h.penalty && h.folder !== undefined) {
            check(h.cards[h.folder] === 10, `[2] 페널티인데 카드가 10이 아님 (game ${g})`);
            check(cnt(10) >= 1, `[2] 페널티 10이 seen에 없음 (game ${g})`);
          }
        }
      }
      s = nextHand(s);
    }
  }
  check(guard < 5000, `가드 초과 (game ${g})`);
  check(s.phase !== 'gameover' || gameWinner(s) !== null, `승자 판정 실패 (game ${g})`);
}

console.log(`[감사] 게임 ${GAMES}판 · 핸드 ${totalHands} · 완주 덱 ${fullDecks}`);
console.log(
  `  블랙 핸드 ${blackHands} (${((blackHands / totalHands) * 100).toFixed(1)}% — 기대 ~20%) · 블랙 10페널티 ${blackPenalties}`,
);
if (failures === 0) console.log('✅ 전부 통과');
else {
  console.error(`❌ 실패 ${failures}건`);
  process.exit(1);
}
