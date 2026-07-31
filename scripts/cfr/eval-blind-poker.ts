/**
 * 학습된 CFR 정책 vs 기존 휴리스틱 AI(hard) — 실제 엔진으로 전체 게임 대결.
 *
 * 실행: npm run cfr:eval
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ai.ts가 localStorage를 사용하므로 Node에서 스텁 제공 (성향 학습은 기본값으로 동작)
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { createGame, act, legalInfo, nextHand, gameWinner } from '../../src/games/blind-poker/engine.ts';
import type { BpState, BpAction, PlayerId } from '../../src/games/blind-poker/engine.ts';
import { chooseAiAction } from '../../src/games/blind-poker/ai.ts';

// 저장소 루트에서 실행한다 (npm run cfr:eval)
const raw = JSON.parse(readFileSync(join(process.cwd(), 'src', 'games', 'blind-poker', 'policy.json'), 'utf8'));
const policy: Record<string, Record<string, number>> = raw.policy;

/** 현재 핸드의 액션 로그 → 추상화 히스토리 토큰 (레이즈만 기록) */
function histOf(s: BpState): string {
  let h = '';
  for (const { action } of s.actions) {
    if (action.type !== 'raise') continue;
    const amt = action.amount ?? 1;
    if (amt === 1 || amt === 3 || amt === 5) h += String(amt);
    else h += 'a';
  }
  return h;
}

let policyMiss = 0;
let policyHit = 0;

/** 학습 정책 에이전트 — 정보집합 조회 후 확률 표집, 없으면 휴리스틱 폴백 */
function policyAction(s: BpState, me: PlayerId): BpAction {
  // 블랙 핸드는 상대 카드도 안 보인다 — 키 접두 'B' (게임 AI와 동일)
  const key = s.isBlack ? `B|${histOf(s)}` : `${s.cards[1 - me]}|${histOf(s)}`;
  const entry = policy[key];
  if (!entry) {
    policyMiss++;
    return chooseAiAction(s, { me, difficulty: 'hard' });
  }
  policyHit++;
  const info = legalInfo(s);
  // 표집
  let r = Math.random();
  let picked = 'c';
  for (const [tok, p] of Object.entries(entry)) {
    r -= p;
    if (r <= 0) { picked = tok; break; }
  }
  if (picked === 'f') return info.callCost > 0 ? { type: 'fold' } : { type: 'call' };
  if (picked === 'c') return { type: 'call' };
  const amount = picked === 'a' ? info.maxRaise : Math.min(Number(picked), info.maxRaise);
  if (amount <= 0) return { type: 'call' };
  return { type: 'raise', amount };
}

function playGame(policySeat: PlayerId): PlayerId | null {
  let s = createGame(Math.random() < 0.5 ? 0 : 1);
  let guard = 0;
  while (s.phase !== 'gameover' && guard++ < 20000) {
    if (s.phase === 'betting') {
      const me = s.toAct;
      const a = me === policySeat ? policyAction(s, me) : chooseAiAction(s, { me, difficulty: 'hard' });
      s = act(s, a);
    } else if (s.phase === 'result') {
      s = nextHand(s);
    }
  }
  return gameWinner(s);
}

const GAMES = 4000;
let policyWins = 0;
let heuristicWins = 0;
for (let g = 0; g < GAMES; g++) {
  const seat: PlayerId = (g % 2) as PlayerId; // 좌석 교대
  const w = playGame(seat);
  if (w === seat) policyWins++;
  else if (w !== null) heuristicWins++;
}

const rate = ((policyWins / GAMES) * 100).toFixed(1);
const hitRate = ((policyHit / (policyHit + policyMiss)) * 100).toFixed(1);
console.log(`게임 ${GAMES}판 — CFR 정책 ${policyWins}승 / 휴리스틱 ${heuristicWins}승`);
console.log(`CFR 정책 승률: ${rate}%  (정보집합 적중률 ${hitRate}%, 폴백 ${policyMiss}회)`);
