/**
 * 야누스 포커 학습 정책 vs 기존 휴리스틱 AI — 실제 엔진으로 전체 게임(파산까지) 대결.
 *
 * 실행: npm run cfr:eval:janus
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { applyAction, callCost, createGame, maxLevel, maxLevelFor, nextHand } from '../../src/games/janus-poker/engine.ts';
import type { Face, JPAction, JPState, PlayerId } from '../../src/games/janus-poker/engine.ts';
import { chooseAiAction } from '../../src/games/janus-poker/ai.ts';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'games', 'janus-poker', 'policy.json'), 'utf8'),
);
const policy: Record<string, Record<string, number>> = raw.policy;

// ---------- 학습기와 동일한 키/토큰 ----------

function faceCode(f: Face | null): number {
  return f === null ? 0 : f === 'front' ? 1 : f === 'back' ? 2 : 3;
}
function levelBucket(l: number): number {
  return l <= 0 ? 0 : l <= 3 ? l : l <= 5 ? 4 : l <= 9 ? 5 : 6;
}
function facingBucket(c: number): number {
  return c <= 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : 3;
}
function keyOf(s: JPState, me: PlayerId): string {
  const opp = (1 - me) as PlayerId;
  const key =
    s.cards[me].front |
    (s.cards[me].back << 4) |
    (s.cards[opp].front << 8) |
    (faceCode(s.faces[me]) << 12) |
    (faceCode(s.faces[opp]) << 14) |
    (levelBucket(s.level) << 16) |
    (facingBucket(callCost(s, me)) << 19);
  return key.toString(36);
}

function tokenToAction(s: JPState, me: PlayerId, tok: string): JPAction {
  if (tok === 'f') return { kind: 'fold' };
  if (s.faces[me] === null) {
    const face: Face = tok[0] === 'F' ? 'front' : tok[0] === 'B' ? 'back' : 'both';
    const base = Math.max(1, s.level);
    const want = tok[1] === 'c' ? base : tok[1] === 'r' ? base + 2 : base + 6;
    const level = Math.min(want, maxLevelFor(s, me, face));
    if (level < base) return { kind: 'fold' };
    return { kind: 'bet', face, level };
  }
  if (tok === 'c') return { kind: 'call' };
  const want = tok === 'r' ? s.level + 2 : s.level + 6;
  const level = Math.min(want, maxLevel(s, me));
  if (level <= s.level) return { kind: 'call' };
  return { kind: 'raise', level };
}

let hit = 0;
let miss = 0;

function policyAction(s: JPState, me: PlayerId): JPAction {
  const entry = policy[keyOf(s, me)];
  if (!entry) {
    miss++;
    return chooseAiAction(s, me);
  }
  hit++;
  let r = Math.random();
  let picked = Object.keys(entry)[0];
  for (const [k, p] of Object.entries(entry)) {
    r -= p;
    if (r <= 0) {
      picked = k;
      break;
    }
  }
  // 양면 금지 상황 방어 (키에 상대 면이 포함되므로 이론상 불필요)
  const a = tokenToAction(s, me, picked);
  if (a.kind === 'bet' && a.face === 'both' && s.faces[1 - me] === 'both') return { kind: 'fold' };
  return a;
}

function playGame(policySeat: PlayerId): PlayerId | null {
  let s = createGame(Math.random() < 0.5 ? 0 : 1);
  let guard = 0;
  while (s.phase !== 'gameover' && guard++ < 5000) {
    if (s.phase === 'handover') {
      s = nextHand(s);
      continue;
    }
    const p = s.turn;
    s = applyAction(s, p === policySeat ? policyAction(s, p) : chooseAiAction(s, p));
  }
  return s.result?.winner ?? null;
}

const GAMES = 500;
let policyWins = 0;
let heuristicWins = 0;
let unresolved = 0;
const t0 = performance.now();
for (let g = 0; g < GAMES; g++) {
  const seat = (g % 2) as PlayerId;
  const w = playGame(seat);
  if (w === seat) policyWins++;
  else if (w !== null) heuristicWins++;
  else unresolved++;
  if ((g + 1) % 100 === 0) {
    const sec = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(`${g + 1}판 — 정책 ${policyWins}승 / 휴리스틱 ${heuristicWins}승 (${sec}s)`);
  }
}

const rate = ((policyWins / (policyWins + heuristicWins)) * 100).toFixed(1);
const hitRate = ((hit / (hit + miss)) * 100).toFixed(1);
console.log(`게임 ${GAMES}판(파산전) — CFR 정책 ${policyWins}승 / 휴리스틱 ${heuristicWins}승 / 미종결 ${unresolved}`);
console.log(`CFR 정책 승률: ${rate}%  (정보집합 적중률 ${hitRate}%, 폴백 ${miss}회)`);
