/**
 * 블라인드 홀덤 평가 — 실제 엔진으로 전체 게임 대결, 좌석 교대.
 *
 * 실행:
 *   npm run cfr:eval:holdem            # 학습 정책 vs 휴리스틱 AI (기본)
 *   OPP=random npm run cfr:eval:holdem # 휴리스틱 AI vs 무작위 (기준선 측정)
 *
 * 승률의 절대값은 상대가 누구냐에 따라 의미가 달라지므로, 기준선을 함께 측정한다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ai.ts가 localStorage를 사용하므로 Node에서 스텁 제공 (성향 학습은 기본값으로 동작)
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import {
  act,
  createGame,
  gameWinner,
  legalInfo,
  nextHand,
} from '../../src/games/blind-holdem/engine.ts';
import type { BhAction, BhState, PlayerId } from '../../src/games/blind-holdem/engine.ts';
import { heuristicAction } from '../../src/games/blind-holdem/ai.ts';
import { infoKey, toAction } from '../../src/games/blind-holdem/infoset.ts';

const MODE = process.env.OPP ?? 'policy';
const GAMES = Number(process.env.GAMES ?? 2000);

let policy: Record<string, Record<string, number>> = {};
if (MODE === 'policy') {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), 'src', 'games', 'blind-holdem', 'policy.json'), 'utf8'),
  );
  policy = raw.policy ?? {};
}

let hit = 0;
let miss = 0;

/** 학습 정책 에이전트 — 정보집합 조회 후 확률 표집, 없으면 휴리스틱 폴백 */
function policyAction(s: BhState, me: PlayerId): BhAction {
  const key = infoKey(s, me);
  const entry = policy[key];
  if (!entry) {
    miss++;
    return heuristicAction(s, { me });
  }
  hit++;
  let r = Math.random();
  let pick = 'c';
  for (const [a, p] of Object.entries(entry)) {
    r -= p;
    if (r <= 0) {
      pick = a;
      break;
    }
  }
  return toAction(s, pick) as BhAction;
}

/** 무작위 상대 — 기준선 */
function randomAction(s: BhState): BhAction {
  const info = legalInfo(s);
  const r = Math.random();
  if (r < 0.15 && info.callCost > 0) return { type: 'fold' };
  if (r < 0.5 && info.maxRaise >= 1) {
    return { type: 'raise', amount: 1 + Math.floor(Math.random() * 3) };
  }
  return { type: 'call' };
}

function agentA(s: BhState, me: PlayerId): BhAction {
  return MODE === 'policy' ? policyAction(s, me) : heuristicAction(s, { me });
}
function agentB(s: BhState, me: PlayerId): BhAction {
  return MODE === 'random' ? randomAction(s) : heuristicAction(s, { me });
}

let winsA = 0;
let handTotal = 0;
let bankrupt = 0;

for (let g = 0; g < GAMES; g++) {
  // 좌석 교대 — 선공 이점을 상쇄
  const seatA: PlayerId = g % 2 === 0 ? 0 : 1;
  const seatB: PlayerId = (1 - seatA) as PlayerId;
  let s = createGame(g % 2 === 0 ? 0 : 1);
  let guard = 0;
  while (s.phase !== 'gameover' && guard++ < 4000) {
    if (s.phase === 'betting') {
      const actor = s.toAct;
      const a = actor === seatA ? agentA(s, seatA) : agentB(s, seatB);
      s = act(s, a);
    } else {
      handTotal++;
      s = nextHand(s);
    }
  }
  if (guard >= 4000) {
    bankrupt++;
    continue;
  }
  if (gameWinner(s) === seatA) winsA++;
}

const played = GAMES - bankrupt;
const rate = played > 0 ? (winsA / played) * 100 : 0;
const label = MODE === 'policy' ? '학습 정책' : '휴리스틱 AI';
const oppLabel = MODE === 'random' ? '무작위' : '휴리스틱 AI';

console.log(`\n블라인드 홀덤 평가 — ${label} vs ${oppLabel}`);
console.log(`  게임 ${played}판 (평균 ${(handTotal / Math.max(1, played)).toFixed(1)}핸드)`);
console.log(`  ${label} 승률: ${rate.toFixed(1)}%  (${winsA}승 ${played - winsA}패)`);
if (MODE === 'policy') {
  const total = hit + miss;
  console.log(`  정책 적중률: ${((hit / Math.max(1, total)) * 100).toFixed(1)}% (${hit}/${total})`);
}
if (bankrupt > 0) console.log(`  ⚠️ 미종료 ${bankrupt}판 제외`);
