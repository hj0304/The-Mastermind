/**
 * 모노크롬 학습 정책 vs 기존 휴리스틱 AI(hard) — 실제 엔진으로 전체 게임 대결.
 *
 * 실행: npm run cfr:eval:mono
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ai.ts가 localStorage를 사용하므로 Node에서 스텁 제공 (성향 학습은 기본값으로 동작)
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { createGame, play, winner, isTerminal, currentPlayer, tileColor } from '../../src/games/monochrome/engine.ts';
import type { MonoState, PlayerId } from '../../src/games/monochrome/engine.ts';
import { chooseAiMove } from '../../src/games/monochrome/ai.ts';

const raw = JSON.parse(readFileSync(join(process.cwd(), 'src', 'games', 'monochrome', 'policy.json'), 'utf8'));
const policy: Record<string, Record<string, number>> = raw.policy;

const BLACK = 0b101010101;

function maskOf(hand: number[]): number {
  let m = 0;
  for (const t of hand) m |= 1 << t;
  return m;
}

function popcount(x: number): number {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/** 학습기와 동일한 추상 정보집합 키 */
function keyOf(s: MonoState, me: PlayerId): string {
  const myMask = maskOf(s.hands[me]);
  const oppMask = maskOf(s.hands[1 - me]);
  const oppB = popcount(oppMask & BLACK);
  const oppW = popcount(oppMask & ~BLACK & 0x1ff);
  const diff = s.scores[me] - s.scores[1 - me] + 9;
  const role = s.pending === null ? 0 : tileColor(s.pending) === 'black' ? 1 : 2;
  const key = myMask | (oppB << 9) | (oppW << 12) | (diff << 15) | (role << 20);
  return key.toString(36);
}

let hit = 0;
let miss = 0;

/** hybrid: 종반(6장 이하)은 기존 hard의 완전 탐색에 맡기고 초·중반만 정책 사용 */
function policyMove(s: MonoState, me: PlayerId, hybrid: boolean): number {
  if (hybrid && s.hands[me].length <= 6) {
    return chooseAiMove(s, { me, difficulty: 'hard' });
  }
  const entry = policy[keyOf(s, me)];
  if (!entry) {
    miss++;
    return chooseAiMove(s, { me, difficulty: 'hard' });
  }
  hit++;
  let r = Math.random();
  let picked = -1;
  for (const [tile, p] of Object.entries(entry)) {
    r -= p;
    if (r <= 0) { picked = Number(tile); break; }
  }
  if (picked < 0 || !s.hands[me].includes(picked)) {
    // 방어: 키가 손패 마스크를 포함하므로 도달하면 버그
    return s.hands[me][0];
  }
  return picked;
}

function playGame(policySeat: PlayerId, hybrid: boolean): PlayerId | null {
  let s = createGame(Math.random() < 0.5 ? 0 : 1);
  let guard = 0;
  while (!isTerminal(s) && guard++ < 600) {
    const p = currentPlayer(s);
    const tile = p === policySeat ? policyMove(s, p, hybrid) : chooseAiMove(s, { me: p, difficulty: 'hard' });
    s = play(s, tile);
  }
  return winner(s);
}

const GAMES = 2000;
for (const hybrid of [false, true]) {
  hit = 0;
  miss = 0;
  let policyWins = 0;
  let heuristicWins = 0;
  let unresolved = 0;
  const t0 = performance.now();
  const label = hybrid ? '하이브리드(정책+종반 완전탐색)' : '순수 정책';
  for (let g = 0; g < GAMES; g++) {
    const seat = (g % 2) as PlayerId; // 좌석 교대
    const w = playGame(seat, hybrid);
    if (w === seat) policyWins++;
    else if (w !== null) heuristicWins++;
    else unresolved++;
    if ((g + 1) % 500 === 0) {
      const sec = ((performance.now() - t0) / 1000).toFixed(0);
      console.log(`[${label}] ${g + 1}판 — 정책 ${policyWins}승 / 휴리스틱 ${heuristicWins}승 (${sec}s)`);
    }
  }
  const rate = ((policyWins / (policyWins + heuristicWins)) * 100).toFixed(1);
  const hitRate = ((hit / (hit + miss)) * 100).toFixed(1);
  console.log(`[${label}] ${GAMES}판 — ${policyWins}승 / ${heuristicWins}패 / 미종결 ${unresolved}`);
  console.log(`[${label}] 승률 ${rate}%  (정보집합 적중률 ${hitRate}%, 폴백 ${miss}회)`);
}
