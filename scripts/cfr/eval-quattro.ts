/**
 * 학습된 테트라 MCCFR 정책 vs 기존 휴리스틱 AI — 실제 엔진으로 전체 게임 대결.
 *
 * 정책 좌석: 정보집합 적중 시 메타 표집(resolve*로 실행), 미적중이면 휴리스틱 폴백.
 * 휴리스틱 좌석: aiWantsMulligan / aiChooseOpen / aiChooseAction (정책 미사용).
 *
 * 실행: npm run cfr:eval:quattro
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import {
  createGame,
  currentActor,
  decline,
  exchange,
  keepHand,
  mulligan,
  openCard,
} from '../../src/games/quattro/engine.ts';
import type { PlayerId, QState } from '../../src/games/quattro/engine.ts';
import { mullKey, openKey, xchgKey, xchgMetas } from '../../src/games/quattro/infoset.ts';
import type { MetaCode } from '../../src/games/quattro/infoset.ts';
import {
  aiChooseAction,
  aiChooseOpen,
  aiWantsMulligan,
  resolveOpenMeta,
  resolveXchgMeta,
} from '../../src/games/quattro/ai.ts';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'games', 'quattro', 'policy.json'), 'utf8'),
);
const policy: Record<string, Record<string, number>> = raw.policy;

let hit = 0;
let miss = 0;

function sampleCode(key: string, legal: MetaCode[]): MetaCode | null {
  const entry = policy[key];
  if (!entry) {
    miss++;
    return null;
  }
  hit++;
  const pairs = Object.entries(entry).filter(([c]) => legal.includes(c as MetaCode));
  const total = pairs.reduce((a, [, p]) => a + p, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [c, p] of pairs) {
    r -= p;
    if (r <= 0) return c as MetaCode;
  }
  return pairs[pairs.length - 1][0] as MetaCode;
}

function playGame(policySeat: PlayerId, first: PlayerId): PlayerId | null {
  let s: QState = createGame(first);

  for (const p of [first, (1 - first) as PlayerId]) {
    let guard = 0;
    while (s.phase === 'mulligan' && !s.mulliganDone[p] && guard++ < 4) {
      if (s.mulligansUsed[p] >= 2) break;
      let mull: boolean;
      if (p === policySeat) {
        const code = sampleCode(mullKey(s.hands[p], s.mulligansUsed[p]), ['k', 'm']);
        mull = code ? code === 'm' : aiWantsMulligan(s.hands[p]);
      } else {
        mull = aiWantsMulligan(s.hands[p]);
      }
      s = mull ? mulligan(s, p) : keepHand(s, p);
    }
  }

  let guard = 0;
  while (s.phase !== 'done' && guard++ < 300) {
    if (s.phase === 'opening') {
      const p = s.pendingOpen[0];
      if (p === policySeat) {
        const code = sampleCode(openKey(s, p), ['h', 'l']);
        s = openCard(s, p, resolveOpenMeta(s, p, code ?? 'h'));
      } else {
        s = openCard(s, p, aiChooseOpen(s, p));
      }
    } else {
      const p = currentActor(s);
      const metas = xchgMetas(s, p);
      let a;
      if (metas.length === 1) {
        // 강제수 — 정책 조회 없음 (학습기도 이 지점을 학습하지 않는다)
        a = metas[0] === 'p' ? { type: 'decline' as const } : resolveXchgMeta(s, p, metas[0]);
      } else if (p === policySeat) {
        const code = sampleCode(xchgKey(s, p), metas);
        a = code ? resolveXchgMeta(s, p, code) : aiChooseAction(s, p);
      } else {
        a = aiChooseAction(s, p);
      }
      s = a.type === 'decline' ? decline(s, p) : exchange(s, p, a.virtualIdx, a.giveCardId);
    }
  }
  return s.result?.winner ?? null;
}

const GAMES = 2000;
let policyWins = 0;
let heuristicWins = 0;
let draws = 0;
const t0 = performance.now();
for (let g = 0; g < GAMES; g++) {
  const seat = (g % 2) as PlayerId;
  const w = playGame(seat, ((g >> 1) % 2) as PlayerId);
  if (w === null) draws++;
  else if (w === seat) policyWins++;
  else heuristicWins++;
}
const sec = ((performance.now() - t0) / 1000).toFixed(1);

const decided = policyWins + heuristicWins;
console.log(`게임 ${GAMES}판 (${sec}s) — 정책 ${policyWins}승 / 휴리스틱 ${heuristicWins}승 / 무 ${draws}`);
console.log(
  `정책 승률(무승부 제외): ${((policyWins / decided) * 100).toFixed(1)}%  (정보집합 적중률 ${((hit / (hit + miss)) * 100).toFixed(1)}%, 폴백 ${miss}회)`,
);
