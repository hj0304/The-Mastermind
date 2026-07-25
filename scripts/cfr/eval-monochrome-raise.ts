/**
 * 모노크롬 레이즈 학습 정책 vs 기존 휴리스틱 AI — 실제 엔진으로 전체 게임 대결.
 *
 * 실행: npm run cfr:eval:raise
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { createGame, decide, maxCallable, nextRound } from '../../src/games/monochrome-raise/engine.ts';
import type { PlayerId, RaiseState } from '../../src/games/monochrome-raise/engine.ts';
import { aiDecide, aiSetup } from '../../src/games/monochrome-raise/ai.ts';
import { raiseTemplates } from '../../src/games/monochrome-raise/templates.ts';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'games', 'monochrome-raise', 'policy.json'), 'utf8'),
);
const policy: Record<string, Record<string, number>> = raw.policy;
const TEMPLATES = raiseTemplates();
const ROOT_KEY = (1 << 28).toString(36);

/** 학습기 raiseKey와 동일 */
function chipBucket(x: number): number {
  return x <= 1 ? 0 : x <= 2 ? 1 : x <= 3 ? 2 : x <= 5 ? 3 : x <= 8 ? 4 : 5;
}

function keyOf(s: RaiseState, me: PlayerId): string {
  const opp = (1 - me) as PlayerId;
  const r = s.round;
  const myTile = s.order[me][r];
  const myBetB = chipBucket(s.bets[me][r]);
  const needB = chipBucket(s.bets[opp][r] - s.bets[me][r]);
  const sdiff = Math.max(0, Math.min(Math.round((s.stash[me] - s.stash[opp]) / 8) + 4, 8));
  const unseen = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const h of s.history) if (h.revealed) unseen.delete(h.tiles[opp]);
  let higher = 0;
  for (const v of unseen) if (v > myTile) higher++;
  const oppBet = s.bets[opp][r];
  let oppRank = 0;
  for (let i = r + 1; i < 10; i++) if (s.bets[opp][i] > oppBet) oppRank++;
  oppRank = Math.min(oppRank, 3);
  const key =
    r | (myTile << 4) | (myBetB << 8) | (needB << 11) | (sdiff << 14) | (higher << 18) | (oppRank << 22);
  return key.toString(36);
}

function sampleEntry(entry: Record<string, number>): string {
  let r = Math.random();
  let picked = Object.keys(entry)[0];
  for (const [k, p] of Object.entries(entry)) {
    r -= p;
    if (r <= 0) {
      picked = k;
      break;
    }
  }
  return picked;
}

let hit = 0;
let miss = 0;

function policySetup() {
  const entry = policy[ROOT_KEY];
  if (!entry) return TEMPLATES[0];
  return TEMPLATES[Number(sampleEntry(entry))];
}

function policyDecide(s: RaiseState, me: PlayerId): 'call' | 'fold' {
  const entry = policy[keyOf(s, me)];
  if (!entry) {
    miss++;
    return aiDecide(s, me);
  }
  hit++;
  return sampleEntry(entry) === 'c' ? 'call' : 'fold';
}

function playGame(policySeat: PlayerId, templateSetup: boolean): PlayerId | null {
  const setups: [ReturnType<typeof aiSetup>, ReturnType<typeof aiSetup>] = [aiSetup(), aiSetup()];
  if (templateSetup) setups[policySeat] = policySetup();
  let s = createGame(setups[0], setups[1]);
  let guard = 0;
  while (s.phase !== 'gameover' && guard++ < 40) {
    if (s.phase === 'result') {
      s = nextRound(s);
      continue;
    }
    const p = s.toDecide!;
    const opp = (1 - p) as PlayerId;
    const need = s.bets[opp][s.round] - s.bets[p][s.round];
    if (maxCallable(s, p) < need) {
      s = decide(s, 'fold');
      continue;
    }
    s = decide(s, p === policySeat ? policyDecide(s, p) : aiDecide(s, p));
  }
  return s.result?.winner ?? null;
}

const GAMES = 2000;
for (const templateSetup of [true, false]) {
  hit = 0;
  miss = 0;
  let policyWins = 0;
  let heuristicWins = 0;
  let draws = 0;
  for (let g = 0; g < GAMES; g++) {
    const seat = (g % 2) as PlayerId;
    const w = playGame(seat, templateSetup);
    if (w === seat) policyWins++;
    else if (w !== null) heuristicWins++;
    else draws++;
  }
  const label = templateSetup ? '템플릿 배치 + 학습 결정' : '휴리스틱 배치 + 학습 결정';
  const rate = ((policyWins / (policyWins + heuristicWins)) * 100).toFixed(1);
  const hitRate = ((hit / (hit + miss)) * 100).toFixed(1);
  console.log(`[${label}] ${GAMES}판 — ${policyWins}승 / ${heuristicWins}패 / 무승부 ${draws}`);
  console.log(`[${label}] 승률 ${rate}%  (결정 적중률 ${hitRate}%, 폴백 ${miss}회)`);
}
