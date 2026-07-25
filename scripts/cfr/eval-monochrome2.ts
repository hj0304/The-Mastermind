/**
 * 모노크롬 II 학습 정책 vs 기존 휴리스틱 AI — 실제 엔진으로 전체 게임 대결.
 *
 * 실행: npm run cfr:eval:m2
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { createGame, currentPlayer, play } from '../../src/games/monochrome2/engine.ts';
import type { M2State, PlayerId } from '../../src/games/monochrome2/engine.ts';
import { chooseAiBid, opponentPointBounds } from '../../src/games/monochrome2/ai.ts';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'games', 'monochrome2', 'policy.json'), 'utf8'),
);
const policy: Record<string, Record<string, number>> = raw.policy;

/** 학습기 m2Key와 동일한 키 계산 (공개 정보만 사용) */
function keyOf(s: M2State, me: PlayerId): string {
  const p = s.points[me];
  const oppHiB = Math.min(10, Math.ceil((opponentPointBounds(s, me).hi + 1) / 10));
  const role = s.pending === null ? 0 : s.pending <= 9 ? 1 : 2;
  const roundsLeft = s.maxRounds - s.roundInSet;
  const ot = s.overtime > 0 ? 1 : 0;
  const key =
    p |
    (oppHiB << 7) |
    (s.scores[me] << 11) |
    (s.scores[1 - me] << 14) |
    (roundsLeft << 17) |
    (role << 21) |
    (ot << 23);
  return key.toString(36);
}

let hit = 0;
let miss = 0;

function policyBid(s: M2State, me: PlayerId): number {
  const entry = policy[keyOf(s, me)];
  if (!entry) {
    miss++;
    return chooseAiBid(s, me);
  }
  hit++;
  let r = Math.random();
  let picked = 0;
  for (const [bid, prob] of Object.entries(entry)) {
    r -= prob;
    if (r <= 0) {
      picked = Number(bid);
      break;
    }
  }
  return Math.max(0, Math.min(picked, s.points[me]));
}

function playGame(policySeat: PlayerId): PlayerId | null {
  let s = createGame(Math.random() < 0.5 ? 0 : 1);
  let guard = 0;
  while (!s.result && guard++ < 60) {
    const p = currentPlayer(s);
    s = play(s, p === policySeat ? policyBid(s, p) : chooseAiBid(s, p));
  }
  return s.result?.winner ?? null;
}

const GAMES = 2000;
let policyWins = 0;
let heuristicWins = 0;
let draws = 0;
for (let g = 0; g < GAMES; g++) {
  const seat = (g % 2) as PlayerId;
  const w = playGame(seat);
  if (w === seat) policyWins++;
  else if (w !== null) heuristicWins++;
  else draws++;
}

const rate = ((policyWins / (policyWins + heuristicWins)) * 100).toFixed(1);
const hitRate = ((hit / (hit + miss)) * 100).toFixed(1);
console.log(`게임 ${GAMES}판 — CFR 정책 ${policyWins}승 / 휴리스틱 ${heuristicWins}승 / 무승부 ${draws}`);
console.log(`CFR 정책 승률: ${rate}%  (정보집합 적중률 ${hitRate}%, 폴백 ${miss}회)`);
