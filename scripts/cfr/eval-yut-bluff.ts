/**
 * 학습된 윷과 거짓말 정책 vs 기존 휴리스틱 AI — 실제 엔진으로 전체 판 대결.
 *
 * 정책 좌석: 정보집합 적중 시 메타 표집(resolveDeclMeta로 실행), 미적중이면 휴리스틱 폴백.
 * 휴리스틱 좌석: chooseAiDeclaration / chooseAiResponse (정책 미사용).
 *
 * 공정성 검사: 응답 결정에서 정책 좌석이 주사위 값을 보지 않는다는 것은
 * respKey가 s.roll을 참조하지 않는다는 사실로 보장된다(infoset.ts).
 *
 * 실행: npm run cfr:eval:bluff
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { createGame, declare, respond } from '../../src/games/yut-bluff/engine.ts';
import type { BState, PlayerId } from '../../src/games/yut-bluff/engine.ts';
import {
  declKey,
  declMetas,
  respKey,
  respMetas,
} from '../../src/games/yut-bluff/infoset.ts';
import type { MetaCode } from '../../src/games/yut-bluff/infoset.ts';
import {
  canWinByDeclaring,
  chooseAiDeclaration,
  chooseAiResponse,
  declarationWins,
  resolveDeclMeta,
} from '../../src/games/yut-bluff/ai.ts';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'games', 'yut-bluff', 'policy.json'), 'utf8'),
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

/** 학습 정책의 블러프·의심 빈도 계측 (실측 통계) */
const stats = { decls: 0, lies: 0, faced: 0, challenges: 0 };

function playGame(policySeat: PlayerId, first: PlayerId): PlayerId | null {
  let s: BState = createGame(first);
  let guard = 0;

  while (s.phase !== 'gameover' && guard++ < 500) {
    const roller = s.turn;
    const responder = (1 - roller) as PlayerId;

    if (roller === policySeat) {
      const code = sampleCode(declKey(s, roller, canWinByDeclaring(s, roller)), declMetas(s.roll));
      const d = code ? resolveDeclMeta(s, roller, code) : chooseAiDeclaration(s, roller);
      if (d.value !== 0) {
        stats.decls++;
        if (d.value !== s.roll) stats.lies++;
      }
      s = declare(s, d);
    } else {
      s = declare(s, chooseAiDeclaration(s, roller));
    }

    if (s.phase === 'respond') {
      let challenge: boolean;
      if (responder === policySeat) {
        const code = sampleCode(respKey(s, responder, declarationWins(s, roller)), respMetas());
        challenge = code ? code === 'c' : chooseAiResponse(s, responder);
        stats.faced++;
        if (challenge) stats.challenges++;
      } else {
        challenge = chooseAiResponse(s, responder);
      }
      s = respond(s, challenge);
    }
  }
  return s.result?.winner ?? null;
}

const GAMES = Number(process.env.EVAL_GAMES ?? 2000);
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
console.log(`판 ${GAMES} (${sec}s) — 정책 ${policyWins}승 / 휴리스틱 ${heuristicWins}승 / 무 ${draws}`);
console.log(
  `정책 승률(무승부 제외): ${((policyWins / decided) * 100).toFixed(1)}%  (정보집합 적중률 ${((hit / (hit + miss)) * 100).toFixed(1)}%, 폴백 ${miss}회)`,
);
console.log(
  `학습 정책의 실측 빈도 — 거짓 선언 ${((stats.lies / stats.decls) * 100).toFixed(1)}% (${stats.lies}/${stats.decls}) · 의심 ${((stats.challenges / stats.faced) * 100).toFixed(1)}% (${stats.challenges}/${stats.faced})`,
);
