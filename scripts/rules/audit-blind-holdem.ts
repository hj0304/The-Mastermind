/**
 * 블라인드 홀덤 룰 정합성 감사 — `npm run rules:audit:holdem`
 *
 * 이 게임은 원작 자료가 "공유 두 장의 차가 0이면 트리플, 1·9 또는 2·8이면 스트레이트,
 * 3~7이면 페널티 위험 없음"이라는 **판독표**를 명시한다. 이 표는 스트레이트를
 * 1~10 원형으로 이어 판정할 때만 성립하므로(차 9 = 원형 거리 1, 차 8 = 원형 거리 2),
 * 구현이 그 해석을 정확히 따르는지 100쌍 전수로 검증한다.
 *
 * 더불어 족보·비교 규칙과 진행 불변식(칩 보존, 페널티 조건, 정보 은닉)을 확인한다.
 */

import {
  RANK_DOUBLE,
  RANK_HIGH,
  RANK_STRAIGHT,
  RANK_TRIPLE,
  act,
  compareHands,
  createGame,
  handRank,
  isCircularRun,
  legalInfo,
  nextHand,
  penaltyCards,
  riskProfile,
  seenCards,
} from '../../src/games/blind-holdem/engine.ts';

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    console.log('  ✗ ' + msg);
    fail++;
  }
};

console.log('블라인드 홀덤 룰 감사\n');

// ---------- 1. 원형 스트레이트 ----------
console.log('[1] 원형 스트레이트 판정');
ok(isCircularRun(1, 2, 3), '1-2-3');
ok(isCircularRun(8, 9, 10), '8-9-10');
ok(isCircularRun(9, 10, 1), '9-10-1 (원형)');
ok(isCircularRun(10, 1, 2), '10-1-2 (원형)');
ok(!isCircularRun(1, 2, 4), '1-2-4는 아님');
ok(!isCircularRun(8, 10, 1), '8-10-1은 아님 (구멍)');
ok(!isCircularRun(4, 4, 5), '중복이 있으면 스트레이트 아님');
{
  // 원형 스트레이트는 정확히 10가지
  let runs = 0;
  for (let a = 1; a <= 10; a++)
    for (let b = a + 1; b <= 10; b++)
      for (let c = b + 1; c <= 10; c++) if (isCircularRun(a, b, c)) runs++;
  ok(runs === 10, `원형 스트레이트 조합 수 = ${runs} (기대 10)`);
}

// ---------- 2. 원작 판독표 전수 대조 ----------
console.log('[2] 원작 판독표 100쌍 전수 대조');
let tripleCells = 0;
let straightCells = 0;
let safeCells = 0;
for (let a = 1; a <= 10; a++) {
  for (let b = 1; b <= 10; b++) {
    const diff = Math.abs(a - b);
    // 원작 표기: 차 0 → 트리플 / 1·9 또는 2·8 → 스트레이트 / 3~7 → 위험 없음
    const expect =
      diff === 0
        ? 'triple'
        : diff === 1 || diff === 9 || diff === 2 || diff === 8
          ? 'straight'
          : 'safe';
    const got = riskProfile([a, b]);
    ok(got === expect, `공유 ${a},${b} (차 ${diff}) → 기대 ${expect} / 실제 ${got}`);

    // 판독표가 실제 페널티 가능성과 모순되지 않는지 교차 검증
    const pens = penaltyCards([a, b]);
    if (expect === 'safe') {
      ok(pens.length === 0, `공유 ${a},${b}는 안전인데 페널티 카드 존재: ${pens}`);
      safeCells++;
    } else {
      ok(pens.length > 0, `공유 ${a},${b}는 위험인데 페널티 카드 없음`);
      if (expect === 'triple') tripleCells++;
      else straightCells++;
    }
  }
}
console.log(`  트리플 위험 ${tripleCells}칸 · 스트레이트 위험 ${straightCells}칸 · 안전 ${safeCells}칸`);

// ---------- 3. 족보 ----------
console.log('[3] 족보 판정');
ok(handRank([4, 4], 4) === RANK_TRIPLE, '4,4 + 4 = 트리플');
ok(handRank([4, 5], 6) === RANK_STRAIGHT, '4,5 + 6 = 스트레이트');
ok(handRank([4, 6], 5) === RANK_STRAIGHT, '4,6 + 5 = 스트레이트 (구멍 메움)');
ok(handRank([10, 1], 9) === RANK_STRAIGHT, '10,1 + 9 = 9-10-1');
ok(handRank([10, 1], 2) === RANK_STRAIGHT, '10,1 + 2 = 10-1-2');
ok(handRank([4, 4], 7) === RANK_DOUBLE, '4,4 + 7 = 더블');
ok(handRank([4, 9], 4) === RANK_DOUBLE, '4,9 + 4 = 더블');
ok(handRank([4, 9], 7) === RANK_HIGH, '4,9 + 7 = 하이카드');
{
  // 공유가 페어면 양쪽 모두 최소 더블이 확정된다
  let allDouble = true;
  for (let v = 1; v <= 10; v++) if (handRank([6, 6], v) < RANK_DOUBLE) allDouble = false;
  ok(allDouble, '공유가 페어면 어떤 이마여도 최소 더블');
}

// ---------- 4. 비교 규칙 ----------
console.log('[4] 비교 규칙 (등급 우선 → 이마 카드)');
ok(compareHands([4, 5], 6, 3) > 0, '4-5-6 > 3-4-5');
ok(compareHands([4, 4], 4, 10) > 0, '트리플 > 더블 (등급이 이마보다 우선)');
ok(compareHands([4, 9], 9, 4) > 0, '페어 9 > 페어 4');
ok(compareHands([4, 9], 7, 2) > 0, '하이 7 > 하이 2');
ok(compareHands([4, 9], 7, 7) === 0, '완전 동일 → 무승부');
{
  // 비교는 반대칭이어야 한다
  let antisym = true;
  for (let a = 1; a <= 10; a++)
    for (let b = 1; b <= 10; b++)
      for (let f0 = 1; f0 <= 10; f0++)
        for (let f1 = 1; f1 <= 10; f1++) {
          const x = compareHands([a, b], f0, f1);
          const y = compareHands([a, b], f1, f0);
          if (Math.sign(x) !== -Math.sign(y)) antisym = false;
        }
  ok(antisym, '비교 함수가 반대칭이 아님');
}

// ---------- 5. 진행 불변식 ----------
console.log('[5] 진행 시뮬레이션 (400판)');
let penaltySeen = 0;
let drawSeen = 0;
let foldSeen = 0;
let showdownSeen = 0;
let handsPlayed = 0;
for (let g = 0; g < 400; g++) {
  let s = createGame(0);
  let guard = 0;
  while (s.phase !== 'gameover' && guard++ < 3000) {
    if (s.phase === 'betting') {
      const info = legalInfo(s);
      const r = Math.random();
      if (r < 0.2 && info.callCost > 0) s = act(s, { type: 'fold' });
      else if (r < 0.6 && info.maxRaise >= 1)
        s = act(s, { type: 'raise', amount: 1 + Math.floor(Math.random() * 3) });
      else s = act(s, { type: 'call' });
    } else {
      const h = s.history[s.history.length - 1];
      handsPlayed++;
      if (h.penalty) penaltySeen++;
      if (h.outcome === 'draw') drawSeen++;
      if (h.outcome === 'fold') foldSeen++;
      if (h.outcome === 'showdown') showdownSeen++;

      const total = s.stacks[0] + s.stacks[1] + s.carried;
      ok(total === 60, `칩 보존 위반: ${total} (핸드 ${s.handNo})`);

      if (h.outcome === 'fold') {
        const rank = handRank(h.community, h.cards[h.folder!]);
        ok(
          h.penalty === (rank >= RANK_STRAIGHT),
          `페널티 조건 불일치 (등급 ${rank}, penalty ${h.penalty})`,
        );
      }
      if (h.outcome === 'showdown') {
        const cmp = compareHands(h.community, h.cards[0], h.cards[1]);
        ok(cmp !== 0, '쇼다운인데 동점 (무승부로 분류되어야 함)');
        ok(h.winner === (cmp > 0 ? 0 : 1), '쇼다운 승자 불일치');
      }
      s = nextHand(s);
    }
  }
  ok(guard < 3000, '게임이 종료되지 않음 (무한 루프)');
}
console.log(
  `  핸드 ${handsPlayed} · 쇼다운 ${showdownSeen} · 폴드 ${foldSeen} · 무승부 ${drawSeen} · 페널티 ${penaltySeen}`,
);
ok(penaltySeen > 0, '페널티 경로가 한 번도 발생하지 않음');
ok(drawSeen > 0, '무승부(이월) 경로가 한 번도 발생하지 않음');

// ---------- 6. 정보 은닉 ----------
console.log('[6] 정보 은닉 (상대가 폴드한 핸드의 내 이마는 영구 비공개)');
{
  let s = createGame(0);
  let checked = 0;
  let leak = 0;
  for (let i = 0; i < 400 && s.phase !== 'gameover'; i++) {
    if (s.phase === 'betting') {
      if (s.toAct === 0) s = act(s, { type: 'raise', amount: 1 });
      else s = act(s, { type: 'fold' });
    } else {
      const h = s.history[s.history.length - 1];
      if (h.outcome === 'fold' && h.folder === 1) {
        // 좌석1은 자기가 폴드했으므로 자기 이마를 본다
        ok(seenCards(s, 1).includes(h.cards[1]), '폴드한 본인 이마는 공개되어야 함');
        checked++;
      }
      s = nextHand(s);
    }
  }
  // 좌석0 관점: 상대(1)만 폴드했으므로 좌석0의 이마는 어떤 핸드에서도 공개되지 않았어야 한다
  const seen0 = seenCards(s, 0);
  for (const h of s.history) {
    if (h.outcome === 'fold' && h.folder === 1) {
      // 이 핸드의 좌석0 이마가 seen에 기여했는지 직접 확인은 값 중복 때문에 어려우므로
      // 총량으로 검증: 공개 카드 수 = (공유2 + 상대이마1) × 핸드수
      void h;
    }
  }
  const foldByOpp = s.history.filter((h) => h.outcome === 'fold' && h.folder === 1).length;
  const others = s.history.length - foldByOpp;
  const expected = s.history.length * 3 + others * 1 + (s.phase === 'betting' ? 3 : 0);
  ok(
    seen0.length === expected,
    `좌석0 공개 카드 수 ${seen0.length} ≠ 기대 ${expected} (내 이마 누출 의심)`,
  );
  leak = seen0.length - expected;
  console.log(`  폴드 은닉 검사 ${checked}건 · 누출 ${leak}`);
}

console.log(fail === 0 ? '\n✅ 전부 통과' : `\n❌ 실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
