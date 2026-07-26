/**
 * 히든 포뮬러 규칙 은행 — 숨은 연산 `?`의 후보 목록.
 *
 * 원작(더 지니어스 그랜드 파이널 미스터리 사인)의 출제 규칙을 뼈대로,
 * 같은 계열을 매개변수로 넓혀 200종 이상을 갖췄다. 한 판에 11개만 쓰이므로
 * 여러 판을 이어 해도 같은 규칙이 거의 겹치지 않는다.
 *
 * 규칙의 조건:
 * - 두 양의 정수(1~999999)에 대해 결정적이고, 사람이 몇 개의 예시로 알아챌 수 있을 것
 * - 계산 결과가 안전한 정수 범위를 넘지 않을 것 (세제곱·계승 등은 제외)
 * - 서로 다른 규칙끼리 출력이 완전히 같지 않을 것
 *   (scripts/rules/audit-hidden-formula.ts 가 중복·판별 가능성을 검사한다)
 *
 * AI는 이 은행을 후보 소거로 좁혀 추론하므로, 규칙을 추가하면 자동으로 대응한다.
 */

export interface Rule {
  id: string;
  /** 라운드 종료 후 공개되는 설명 */
  desc: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  fn: (a: number, b: number) => string;
}

// ---------- 공용 헬퍼 ----------

const digitsOf = (n: number): number[] => String(n).split('').map(Number);
/** 자릿수 합 */
const ds = (n: number): number => digitsOf(n).reduce((s, d) => s + d, 0);
/** 자릿수 곱 */
const dp = (n: number): number => digitsOf(n).reduce((s, d) => s * d, 1);
/** 디지털 루트 — 한 자리가 될 때까지 자릿수 합을 반복 */
const dr = (n: number): number => (n <= 0 ? 0 : 1 + ((n - 1) % 9));
/** 뒤집기 (선행 0은 사라진다: 120 → 21) */
const rev = (n: number): number => Number(String(n).split('').reverse().join(''));
const big = (a: number, b: number): number => Math.max(a, b);
const small = (a: number, b: number): number => Math.min(a, b);
const gcd2 = (a: number, b: number): number => (b === 0 ? a : gcd2(b, a % b));
const lcm2 = (a: number, b: number): number => (a / gcd2(a, b)) * b;
const cat = (x: number | string, y: number | string): string => `${x}${y}`;

/** 자릿수를 정렬해 이어 쓴 수 */
const sortDigits = (n: number, desc: boolean): number =>
  Number(
    digitsOf(n)
      .sort((x, y) => (desc ? y - x : x - y))
      .join(''),
  );

/** 약수 개수 (메모이제이션 — AI가 후보를 훑을 때 반복 호출된다) */
const divCountMemo = new Map<number, number>();
function divCount(n: number): number {
  const hit = divCountMemo.get(n);
  if (hit !== undefined) return hit;
  let c = 0;
  for (let i = 1; i * i <= n; i++) {
    if (n % i === 0) c += i * i === n ? 1 : 2;
  }
  if (divCountMemo.size < 50000) divCountMemo.set(n, c);
  return c;
}

/** 약수의 합 */
const divSumMemo = new Map<number, number>();
function divSum(n: number): number {
  const hit = divSumMemo.get(n);
  if (hit !== undefined) return hit;
  let s = 0;
  for (let i = 1; i * i <= n; i++) {
    if (n % i === 0) {
      s += i;
      if (i * i !== n) s += n / i;
    }
  }
  if (divSumMemo.size < 50000) divSumMemo.set(n, s);
  return s;
}

const primeMemo = new Map<number, boolean>();
function isPrime(n: number): boolean {
  if (n < 2) return false;
  const hit = primeMemo.get(n);
  if (hit !== undefined) return hit;
  let p = true;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) {
      p = false;
      break;
    }
  }
  if (primeMemo.size < 50000) primeMemo.set(n, p);
  return p;
}

/** 서로 다른 소인수의 개수 */
function primeFactorKinds(n: number): number {
  let x = n;
  let c = 0;
  for (let i = 2; i * i <= x; i++) {
    if (x % i === 0) {
      c += 1;
      while (x % i === 0) x /= i;
    }
  }
  if (x > 1) c += 1;
  return c;
}

/** 이진수 1의 개수 */
const popcount = (n: number): number => n.toString(2).split('').filter((c) => c === '1').length;

/** 숫자 모양의 동그라미 개수 (원작 규칙) */
const CIRCLES = [1, 0, 0, 0, 0, 0, 1, 0, 2, 1];
/** 7세그먼트 표시기에서 켜지는 획 수 */
const SEGMENTS = [6, 2, 5, 5, 4, 5, 6, 3, 7, 6];
/** 영어 이름의 글자 수 (zero=4, one=3, …) */
const ENG_LEN = [4, 3, 3, 5, 4, 4, 3, 5, 5, 4];

/** 주어진 수들의 모든 자리에 대해 모양 표(table) 값을 더한다 */
const shapeSum = (table: number[], ...nums: number[]): number =>
  nums.flatMap(digitsOf).reduce((s, d) => s + table[d], 0);

/** 처음 나온 순서대로 (숫자, 그 숫자의 총 개수)를 이어 쓴다 — 원작 5라운드 규칙 */
function digitFreq(s: string): string {
  const order: string[] = [];
  const count = new Map<string, number>();
  for (const d of s) {
    if (!count.has(d)) order.push(d);
    count.set(d, (count.get(d) ?? 0) + 1);
  }
  return order.map((d) => d + String(count.get(d))).join('');
}

/** 두 수의 모든 자릿수를 한 줄로 */
const allDigits = (a: number, b: number): number[] => [...digitsOf(a), ...digitsOf(b)];

// ---------- 규칙 등록 ----------

const BANK: Rule[] = [];
const r = (id: string, desc: string, difficulty: Rule['difficulty'], fn: Rule['fn']): void => {
  BANK.push({ id, desc, difficulty, fn });
};

// --- A. 사칙 기본 ---
r('sum', '두 수의 합', 1, (a, b) => String(a + b));
r('diff', '두 수의 차', 1, (a, b) => String(Math.abs(a - b)));
r('prod', '두 수의 곱', 2, (a, b) => String(a * b));
r('sum-plus-1', '(두 수의 합) + 1', 2, (a, b) => String(a + b + 1));
r('sum-minus-1', '(두 수의 합) − 1', 2, (a, b) => String(a + b - 1));
r('sum-plus-10', '(두 수의 합) + 10', 2, (a, b) => String(a + b + 10));
r('sum-plus-100', '(두 수의 합) + 100', 2, (a, b) => String(a + b + 100));
r('sum-x2', '(두 수의 합) × 2', 2, (a, b) => String((a + b) * 2));
r('sum-x3', '(두 수의 합) × 3', 2, (a, b) => String((a + b) * 3));
r('sum-x10', '(두 수의 합) × 10', 2, (a, b) => String((a + b) * 10));
r('avg-floor', '두 수의 평균 (소수점 버림)', 2, (a, b) => String(Math.floor((a + b) / 2)));
r('avg-ceil', '두 수의 평균 (올림)', 3, (a, b) => String(Math.ceil((a + b) / 2)));
r('a-plus-2b', '(앞의 수) + (뒤의 수) × 2', 3, (a, b) => String(a + b * 2));
r('2a-plus-b', '(앞의 수) × 2 + (뒤의 수)', 3, (a, b) => String(a * 2 + b));
r('2a-plus-3b', '(앞의 수) × 2 + (뒤의 수) × 3', 4, (a, b) => String(a * 2 + b * 3));
r('3a-plus-2b', '(앞의 수) × 3 + (뒤의 수) × 2', 4, (a, b) => String(a * 3 + b * 2));
r('sum-times-a', '(두 수의 합) × (앞의 수)', 3, (a, b) => String((a + b) * a));
r('sum-times-b', '(두 수의 합) × (뒤의 수)', 2, (a, b) => String((a + b) * b));
r('sum-times-diff', '(두 수의 합) × (두 수의 차)', 4, (a, b) => String((a + b) * Math.abs(a - b)));
r('prod-plus-sum', '(두 수의 곱) + (두 수의 합)', 3, (a, b) => String(a * b + a + b));
r('prod-minus-sum', '(두 수의 곱) − (두 수의 합)', 3, (a, b) => String(Math.abs(a * b - a - b)));
r('prod-plus-1', '(두 수의 곱) + 1', 2, (a, b) => String(a * b + 1));
r('sum-sq', '(두 수의 합)의 제곱', 3, (a, b) => String((a + b) * (a + b)));
r('diff-sq', '(두 수의 차)의 제곱', 3, (a, b) => String((a - b) * (a - b)));
r('sq-sum', '각 수를 제곱해 더한 값', 3, (a, b) => String(a * a + b * b));
r('a-sq-plus-b', '(앞의 수)의 제곱 + (뒤의 수)', 3, (a, b) => String(a * a + b));
r('a-plus-b-sq', '(앞의 수) + (뒤의 수)의 제곱', 3, (a, b) => String(a + b * b));

// --- B. 대소 관계 ---
r('bigger', '두 수 중 큰 수', 1, (a, b) => String(big(a, b)));
r('smaller', '두 수 중 작은 수', 1, (a, b) => String(small(a, b)));
r('big-plus-diff', '(큰 수) + (두 수의 차)', 2, (a, b) => String(big(a, b) + Math.abs(a - b)));
r('big-minus-2small', '|(큰 수) − (작은 수) × 2|', 3, (a, b) => String(Math.abs(big(a, b) - small(a, b) * 2)));
r('big-x2-plus-small', '(큰 수) × 2 + (작은 수)', 3, (a, b) => String(big(a, b) * 2 + small(a, b)));
r('big-plus-small-x3', '(큰 수) + (작은 수) × 3', 3, (a, b) => String(big(a, b) + small(a, b) * 3));
r('big-div-small', '(큰 수) ÷ (작은 수) (버림)', 3, (a, b) => String(Math.floor(big(a, b) / small(a, b))));
r('mod-big-small', '(큰 수) ÷ (작은 수)의 나머지', 2, (a, b) => String(big(a, b) % small(a, b)));
r('big-sq-minus-small', '(큰 수)의 제곱 − (작은 수)', 4, (a, b) => String(big(a, b) ** 2 - small(a, b)));
r('big-times-diff', '(큰 수) × (두 수의 차)', 3, (a, b) => String(big(a, b) * Math.abs(a - b)));

// --- C. 나머지 계열 (매개변수) ---
// 7·10·12는 아래 weekday·last-digit-sum·clock과 출력이 같으므로 제외한다
for (const k of [3, 4, 5, 6, 8, 9, 11, 13, 20, 24, 100]) {
  r(`sum-mod-${k}`, `(두 수의 합) ÷ ${k}의 나머지`, k <= 5 ? 2 : 3, (a, b) => String((a + b) % k));
}
for (const k of [3, 5, 7, 9, 12, 100]) {
  r(`prod-mod-${k}`, `(두 수의 곱) ÷ ${k}의 나머지`, 3, (a, b) => String((a * b) % k));
}
for (const k of [3, 4, 5, 7, 10]) {
  r(`diff-mod-${k}`, `(두 수의 차) ÷ ${k}의 나머지`, 3, (a, b) => String(Math.abs(a - b) % k));
}
r('a-mod-b', '(앞의 수) ÷ (뒤의 수)의 나머지', 3, (a, b) => String(a % b));
r('b-mod-a', '(뒤의 수) ÷ (앞의 수)의 나머지', 3, (a, b) => String(b % a));
r('clock', '(두 수의 합) ÷ 12의 나머지 — 시계', 3, (a, b) => String((a + b) % 12));
r('weekday', '(두 수의 합) ÷ 7의 나머지 — 요일', 3, (a, b) => String((a + b) % 7));
r('minute', '(두 수의 합) ÷ 60의 나머지 — 분침', 3, (a, b) => String((a + b) % 60));
r('angle', '(두 수의 합) × 6 을 360으로 나눈 나머지 — 각도', 5, (a, b) => String(((a + b) * 6) % 360));
r('sum-quot-10', '(두 수의 합) ÷ 10 (버림)', 2, (a, b) => String(Math.floor((a + b) / 10)));
r('sum-quot-3', '(두 수의 합) ÷ 3 (버림)', 3, (a, b) => String(Math.floor((a + b) / 3)));
r('prod-quot-10', '(두 수의 곱) ÷ 10 (버림)', 3, (a, b) => String(Math.floor((a * b) / 10)));

// --- D. 자릿수 계열 ---
r('digitsum-all', '모든 자리 숫자의 합', 2, (a, b) => String(ds(a) + ds(b)));
r('digitsum-prod', '(앞 수의 자릿수 합) × (뒤 수의 자릿수 합)', 3, (a, b) => String(ds(a) * ds(b)));
r('digitsum-diff', '|(앞 수의 자릿수 합) − (뒤 수의 자릿수 합)|', 3, (a, b) => String(Math.abs(ds(a) - ds(b))));
r('digitsum-of-sum', '(두 수의 합)의 자릿수 합', 3, (a, b) => String(ds(a + b)));
r('digitsum-of-prod', '(두 수의 곱)의 자릿수 합', 4, (a, b) => String(ds(a * b)));
r('digitsum-of-diff', '(두 수의 차)의 자릿수 합', 3, (a, b) => String(ds(Math.abs(a - b))));
r('digitsum-sq', '(모든 자리 숫자의 합)의 제곱', 4, (a, b) => String((ds(a) + ds(b)) ** 2));
r('digitsum-x2', '(모든 자리 숫자의 합) × 2', 3, (a, b) => String((ds(a) + ds(b)) * 2));
r('digit-prod', '모든 자리 숫자의 곱', 3, (a, b) => String(dp(a) * dp(b)));
r('digitprod-sum', '(앞 수의 자릿수 곱) + (뒤 수의 자릿수 곱)', 4, (a, b) => String(dp(a) + dp(b)));
r('digital-root', '(두 수의 합)의 디지털 루트 (한 자리가 될 때까지 자릿수 합)', 4, (a, b) => String(dr(a + b)));
r('digital-root-prod', '(두 수의 곱)의 디지털 루트', 5, (a, b) => String(dr(a * b)));
r('digital-root-pair', '(앞 수의 디지털 루트) + (뒤 수의 디지털 루트)', 4, (a, b) => String(dr(a) + dr(b)));
r('digit-count', '두 수의 자릿수 개수의 합', 2, (a, b) => String(String(a).length + String(b).length));
r('digit-count-prod', '(앞 수의 자릿수 개수) × (뒤 수의 자릿수 개수)', 3, (a, b) => String(String(a).length * String(b).length));
r('max-digit', '모든 자리 중 가장 큰 숫자', 2, (a, b) => String(Math.max(...allDigits(a, b))));
r('min-digit', '모든 자리 중 가장 작은 숫자', 3, (a, b) => String(Math.min(...allDigits(a, b))));
r('digit-range', '(가장 큰 자릿수) − (가장 작은 자릿수)', 4, (a, b) => String(Math.max(...allDigits(a, b)) - Math.min(...allDigits(a, b))));
r('distinct-digits', '서로 다른 숫자의 개수', 3, (a, b) => String(new Set(allDigits(a, b)).size));
r('odd-count', '두 수의 홀수 자리 숫자 개수', 3, (a, b) => String(allDigits(a, b).filter((d) => d % 2 === 1).length));
r('even-count', '두 수의 짝수 자리 숫자 개수', 3, (a, b) => String(allDigits(a, b).filter((d) => d % 2 === 0).length));
for (const d of [0, 1, 2, 3, 5, 7, 9]) {
  r(`count-digit-${d}`, `두 수에 등장하는 숫자 ${d}의 개수`, 4, (a, b) => String(allDigits(a, b).filter((x) => x === d).length));
}
r('first-digits-sum', '두 수의 첫 자리 숫자의 합', 2, (a, b) => String(digitsOf(a)[0] + digitsOf(b)[0]));
r('first-digits-prod', '두 수의 첫 자리 숫자의 곱', 3, (a, b) => String(digitsOf(a)[0] * digitsOf(b)[0]));
r('last-digits-sum', '두 수의 끝자리 숫자의 합', 2, (a, b) => String((a % 10) + (b % 10)));
r('last-digits-prod', '두 수의 끝자리 숫자의 곱', 2, (a, b) => String((a % 10) * (b % 10)));
r('last-digit-sum', '(두 수의 합)의 일의 자리', 2, (a, b) => String((a + b) % 10));
r('last-digit-prod', '(두 수의 곱)의 일의 자리', 3, (a, b) => String((a * b) % 10));
r('first-last', '(앞 수의 첫 자리) × 10 + (뒤 수의 끝자리)', 4, (a, b) => String(digitsOf(a)[0] * 10 + (b % 10)));
r('alt-digit-sum', '모든 자리를 뒤에서부터 +, −, +, … 로 번갈아 더한 값', 5, (a, b) => {
  const ds2 = allDigits(a, b).reverse();
  return String(Math.abs(ds2.reduce((s, d, i) => s + (i % 2 === 0 ? d : -d), 0)));
});
r('reverse-sum', '각 수를 거꾸로 뒤집어 더한 값', 4, (a, b) => String(rev(a) + rev(b)));
r('reverse-diff', '각 수를 거꾸로 뒤집어 뺀 값의 절댓값', 4, (a, b) => String(Math.abs(rev(a) - rev(b))));
r('reverse-prod', '각 수를 거꾸로 뒤집어 곱한 값', 5, (a, b) => String(rev(a) * rev(b)));
r('sum-reversed', '(두 수의 합)을 거꾸로 뒤집은 수', 4, (a, b) => String(rev(a + b)));
r('prod-reversed', '(두 수의 곱)을 거꾸로 뒤집은 수', 5, (a, b) => String(rev(a * b)));
r('sorted-asc', '모든 자리 숫자를 작은 것부터 늘어놓은 수', 4, (a, b) => allDigits(a, b).sort((x, y) => x - y).join(''));
r('sorted-desc', '모든 자리 숫자를 큰 것부터 늘어놓은 수', 4, (a, b) => allDigits(a, b).sort((x, y) => y - x).join(''));
r('sort-each-asc', '각 수의 자릿수를 오름차순으로 정렬해 더한 값', 5, (a, b) => String(sortDigits(a, false) + sortDigits(b, false)));
r('sort-each-desc', '각 수의 자릿수를 내림차순으로 정렬해 더한 값', 5, (a, b) => String(sortDigits(a, true) + sortDigits(b, true)));
r('digit-freq', '두 수를 이어 쓰고 처음 나온 순서대로 (숫자, 그 숫자의 개수)를 표기', 5, (a, b) => digitFreq(cat(a, b)));
r('digit-freq-sum', '(두 수의 합)에 대해 (숫자, 개수)를 순서대로 표기', 5, (a, b) => digitFreq(String(a + b)));
r('digitsum-until-prime', '(모든 자리 숫자의 합)이 소수면 1, 아니면 0', 5, (a, b) => String(isPrime(ds(a) + ds(b)) ? 1 : 0));

// --- E. 이어쓰기(연결) 계열 ---
r('concat-ab', '두 수를 순서대로 이어 쓴 수', 1, (a, b) => cat(a, b));
r('concat-ba', '두 수를 뒤에서부터 이어 쓴 수', 2, (a, b) => cat(b, a));
r('concat-big-small', '(큰 수)(작은 수)를 이어 쓴 수', 2, (a, b) => cat(big(a, b), small(a, b)));
r('concat-small-big', '(작은 수)(큰 수)를 이어 쓴 수', 2, (a, b) => cat(small(a, b), big(a, b)));
r('concat-sum-diff', '(두 수의 합)(두 수의 차)를 이어 쓴 수', 3, (a, b) => cat(a + b, Math.abs(a - b)));
r('concat-diff-sum', '(두 수의 차)(두 수의 합)를 이어 쓴 수', 3, (a, b) => cat(Math.abs(a - b), a + b));
r('concat-sum-prod', '(두 수의 합)(두 수의 곱)를 이어 쓴 수', 4, (a, b) => cat(a + b, a * b));
r('concat-prod-sum', '(두 수의 곱)(두 수의 합)를 이어 쓴 수', 4, (a, b) => cat(a * b, a + b));
r('concat-a-sum', '(앞의 수)(두 수의 합)를 이어 쓴 수', 3, (a, b) => cat(a, a + b));
r('concat-sum-b', '(두 수의 합)(뒤의 수)를 이어 쓴 수', 3, (a, b) => cat(a + b, b));
r('concat-digitsums', '(앞 수의 자릿수 합)(뒤 수의 자릿수 합)를 이어 쓴 수', 4, (a, b) => cat(ds(a), ds(b)));
r('concat-revs', '각 수를 뒤집어 순서대로 이어 쓴 수', 4, (a, b) => cat(rev(a), rev(b)));
r('concat-ab-reversed', '두 수를 이어 쓴 뒤 전체를 뒤집은 수', 4, (a, b) => cat(a, b).split('').reverse().join(''));
r('concat-counts', '(앞 수의 자릿수 개수)(뒤 수의 자릿수 개수)를 이어 쓴 수', 3, (a, b) => cat(String(a).length, String(b).length));
r('concat-mods', '(합을 3으로 나눈 나머지)(합을 5로 나눈 나머지)를 이어 쓴 수', 5, (a, b) => cat((a + b) % 3, (a + b) % 5));
r('concat-half', '(앞의 수)(뒤의 수)를 이어 쓴 뒤 2로 나눈 몫', 5, (a, b) => String(Math.floor(Number(cat(a, b)) / 2)));
r('concat-lasts', '(앞 수의 끝자리)(뒤 수의 끝자리)를 이어 쓴 수', 3, (a, b) => cat(a % 10, b % 10));
r('concat-firsts', '(앞 수의 첫 자리)(뒤 수의 첫 자리)를 이어 쓴 수', 3, (a, b) => cat(digitsOf(a)[0], digitsOf(b)[0]));
r('concat-maxmin-digit', '(가장 큰 자릿수)(가장 작은 자릿수)를 이어 쓴 수', 4, (a, b) => cat(Math.max(...allDigits(a, b)), Math.min(...allDigits(a, b))));
r('interleave', '두 수의 자릿수를 앞에서부터 번갈아 이어 쓴 수', 5, (a, b) => {
  const x = digitsOf(a);
  const y = digitsOf(b);
  let out = '';
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (i < x.length) out += x[i];
    if (i < y.length) out += y[i];
  }
  return out;
});

// --- F. 수론 ---
r('gcd', '두 수의 최대공약수', 3, (a, b) => String(gcd2(big(a, b), small(a, b))));
r('lcm', '두 수의 최소공배수', 4, (a, b) => String(lcm2(a, b)));
r('gcd-plus-sum', '(최대공약수) + (두 수의 합)', 4, (a, b) => String(gcd2(big(a, b), small(a, b)) + a + b));
r('lcm-div-gcd', '(최소공배수) ÷ (최대공약수)', 5, (a, b) => String(lcm2(a, b) / gcd2(big(a, b), small(a, b))));
r('divcount-sum', '두 수의 약수 개수의 합', 4, (a, b) => String(divCount(a) + divCount(b)));
r('divcount-prod', '두 수의 약수 개수의 곱', 5, (a, b) => String(divCount(a) * divCount(b)));
r('divcount-of-sum', '(두 수의 합)의 약수 개수', 4, (a, b) => String(divCount(a + b)));
r('divsum-of-sum', '(두 수의 합)의 모든 약수의 합', 5, (a, b) => String(divSum(a + b)));
r('prime-flags', '두 수 중 소수인 것의 개수', 3, (a, b) => String((isPrime(a) ? 1 : 0) + (isPrime(b) ? 1 : 0)));
r('sum-is-prime', '(두 수의 합)이 소수면 1, 아니면 0', 4, (a, b) => String(isPrime(a + b) ? 1 : 0));
r('prime-kinds', '두 수의 서로 다른 소인수 개수의 합', 5, (a, b) => String(primeFactorKinds(a) + primeFactorKinds(b)));
r('prime-kinds-sum', '(두 수의 합)의 서로 다른 소인수 개수', 5, (a, b) => String(primeFactorKinds(a + b)));
r('sqrt-floor-sum', '각 수의 제곱근을 버림해 더한 값', 4, (a, b) => String(Math.floor(Math.sqrt(a)) + Math.floor(Math.sqrt(b))));
r('sqrt-floor-of-sum', '(두 수의 합)의 제곱근 (버림)', 4, (a, b) => String(Math.floor(Math.sqrt(a + b))));
r('sqrt-floor-of-prod', '(두 수의 곱)의 제곱근 (버림)', 5, (a, b) => String(Math.floor(Math.sqrt(a * b))));
r('triangular-small', '(작은 수)번째 삼각수 — 1부터 그 수까지의 합', 4, (a, b) => {
  const n = small(a, b);
  return String((n * (n + 1)) / 2);
});
r('triangular-diff', '(두 수의 차)번째 삼각수', 5, (a, b) => {
  const n = Math.abs(a - b);
  return String((n * (n + 1)) / 2);
});
r('fib-below-sum', '(두 수의 합) 이하의 가장 큰 피보나치 수', 5, (a, b) => {
  const n = a + b;
  let x = 1;
  let y = 1;
  while (y <= n) {
    const t = x + y;
    x = y;
    y = t;
  }
  return String(x);
});

// --- G. 이진수·비트 ---
r('popcount-sum', '두 수를 2진수로 썼을 때 1의 개수의 합', 5, (a, b) => String(popcount(a) + popcount(b)));
r('popcount-of-sum', '(두 수의 합)을 2진수로 썼을 때 1의 개수', 5, (a, b) => String(popcount(a + b)));
r('popcount-prod', '두 수의 2진수 1의 개수의 곱', 5, (a, b) => String(popcount(a) * popcount(b)));
r('xor', '두 수의 비트 XOR', 5, (a, b) => String(a ^ b));
r('and', '두 수의 비트 AND', 5, (a, b) => String(a & b));
r('or', '두 수의 비트 OR', 5, (a, b) => String(a | b));
r('binary-sum', '(두 수의 합)을 2진수로 쓴 수', 4, (a, b) => (a + b).toString(2));
r('popcount-concat', '(앞 수의 2진수 1 개수)(뒤 수의 2진수 1 개수)를 이어 쓴 수', 5, (a, b) => cat(popcount(a), popcount(b)));
r('binary-len-sum', '두 수를 2진수로 썼을 때 자릿수의 합', 5, (a, b) => String(a.toString(2).length + b.toString(2).length));
r('hex-sum', '(두 수의 합)을 16진수로 쓴 값', 5, (a, b) => (a + b).toString(16).toUpperCase());
r('base5-sum', '(두 수의 합)을 5진수로 쓴 값', 5, (a, b) => (a + b).toString(5));
r('shift-sum', '(두 수의 합) × 4 — 2진수로 두 칸 밀기', 4, (a, b) => String((a + b) * 4));

// --- H. 숫자 모양·이름 ---
r('circles', '두 수에 포함된 동그라미 개수 (0·6·9=1, 8=2)', 4, (a, b) => String(shapeSum(CIRCLES, a, b)));
r('circles-sum', '(두 수의 합)에 포함된 동그라미 개수', 5, (a, b) => String(shapeSum(CIRCLES, a + b)));
r('segments', '전자시계 숫자로 썼을 때 켜지는 획의 수', 5, (a, b) => String(shapeSum(SEGMENTS, a, b)));
r('segments-sum', '(두 수의 합)을 전자시계 숫자로 썼을 때 켜지는 획의 수', 5, (a, b) => String(shapeSum(SEGMENTS, a + b)));
r('eng-letters', '각 자리 숫자의 영어 이름 글자 수의 합 (one=3, two=3…)', 5, (a, b) => String(shapeSum(ENG_LEN, a, b)));
r('eng-letters-sum', '(두 수의 합)의 각 자리 영어 이름 글자 수의 합', 5, (a, b) => String(shapeSum(ENG_LEN, a + b)));
r('symmetric-digits', '두 수에서 좌우 대칭인 숫자(0·1·8)의 개수', 5, (a, b) => String(allDigits(a, b).filter((d) => d === 0 || d === 1 || d === 8).length));
r('closed-loops', '동그라미가 있는 숫자(0·6·8·9)가 등장한 횟수', 4, (a, b) => String(allDigits(a, b).filter((d) => CIRCLES[d] > 0).length));

// --- I. 조건부 ---
r('if-bigger-sum-else-diff', '앞의 수가 더 크면 두 수의 합, 아니면 두 수의 차', 4, (a, b) => String(a > b ? a + b : Math.abs(a - b)));
r('if-bigger-prod-else-sum', '앞의 수가 더 크면 두 수의 곱, 아니면 두 수의 합', 4, (a, b) => String(a > b ? a * b : a + b));
r('if-both-even-sum-else-prod', '둘 다 짝수면 합, 아니면 곱', 4, (a, b) => String(a % 2 === 0 && b % 2 === 0 ? a + b : a * b));
r('if-sum-even-half-else-x2', '합이 짝수면 합의 절반, 홀수면 합의 2배', 4, (a, b) => String((a + b) % 2 === 0 ? (a + b) / 2 : (a + b) * 2));
r('if-same-parity', '두 수의 홀짝이 같으면 합, 다르면 차', 4, (a, b) => String(a % 2 === b % 2 ? a + b : Math.abs(a - b)));
r('parity-code', '둘 다 홀수면 1, 둘 다 짝수면 2, 섞였으면 3', 3, (a, b) => String(a % 2 === 1 && b % 2 === 1 ? 1 : a % 2 === 0 && b % 2 === 0 ? 2 : 3));
r('if-digits-equal', '자릿수 개수가 같으면 합, 다르면 곱', 4, (a, b) => String(String(a).length === String(b).length ? a + b : a * b));
r('if-multiple', '큰 수가 작은 수의 배수면 몫, 아니면 나머지', 5, (a, b) => {
  const B = big(a, b);
  const S = small(a, b);
  return String(B % S === 0 ? B / S : B % S);
});
r('if-prime-sum', '합이 소수면 합, 아니면 합의 2배', 5, (a, b) => String(isPrime(a + b) ? a + b : (a + b) * 2));
r('sign-code', '앞의 수가 크면 1, 뒤의 수가 크면 2, 같으면 0', 2, (a, b) => String(a > b ? 1 : a < b ? 2 : 0));
r('if-sum-over-50', '합이 50을 넘으면 합, 아니면 곱', 4, (a, b) => String(a + b > 50 ? a + b : a * b));
r('if-diff-over-10', '차가 10을 넘으면 차, 아니면 합', 4, (a, b) => String(Math.abs(a - b) > 10 ? Math.abs(a - b) : a + b));

// --- J. 자릿수 자리 이동·조작 ---
r('drop-last-sum', '각 수의 끝자리를 떼고 더한 값', 4, (a, b) => String(Math.floor(a / 10) + Math.floor(b / 10)));
r('drop-first-sum', '각 수의 첫 자리를 떼고 더한 값', 5, (a, b) => {
  const cut = (n: number) => (String(n).length === 1 ? 0 : Number(String(n).slice(1)));
  return String(cut(a) + cut(b));
});
r('append-zero-a', '(앞의 수) 뒤에 0을 붙인 뒤 (뒤의 수)를 더한 값', 3, (a, b) => String(a * 10 + b));
r('swap-last-digits', '두 수의 끝자리를 서로 바꿔 곱한 값', 5, (a, b) => {
  const na = Math.floor(a / 10) * 10 + (b % 10);
  const nb = Math.floor(b / 10) * 10 + (a % 10);
  return String(na * nb);
});
r('big-digits-sum', '각 자리 숫자 중 4 이상인 것들의 합', 4, (a, b) => String(allDigits(a, b).filter((d) => d >= 4).reduce((s, d) => s + d, 0)));
r('square-each-digit', '각 자리 숫자를 제곱해서 모두 더한 값', 4, (a, b) => String(allDigits(a, b).reduce((s, d) => s + d * d, 0)));
r('digit-diff-sum', '이웃한 자리 숫자의 차를 모두 더한 값', 5, (a, b) => {
  const d = allDigits(a, b);
  let s = 0;
  for (let i = 1; i < d.length; i++) s += Math.abs(d[i] - d[i - 1]);
  return String(s);
});
r('nine-complement', '각 자리 숫자를 9에서 뺀 값들의 합', 4, (a, b) => String(allDigits(a, b).reduce((s, d) => s + (9 - d), 0)));

// --- K. 자릿수 × 값 혼합 ---
r('a-times-digitsum-b', '(앞의 수) × (뒤 수의 자릿수 합)', 4, (a, b) => String(a * ds(b)));
r('b-times-digitsum-a', '(뒤의 수) × (앞 수의 자릿수 합)', 4, (a, b) => String(b * ds(a)));
r('sum-times-digitsum', '(두 수의 합) × (모든 자리 숫자의 합)', 5, (a, b) => String((a + b) * (ds(a) + ds(b))));
r('sum-plus-digitsum', '(두 수의 합) + (모든 자리 숫자의 합)', 3, (a, b) => String(a + b + ds(a) + ds(b)));
r('sum-minus-digitsum', '(두 수의 합) − (모든 자리 숫자의 합)', 4, (a, b) => String(a + b - ds(a) - ds(b)));
r('prod-plus-digitsum', '(두 수의 곱) + (모든 자리 숫자의 합)', 4, (a, b) => String(a * b + ds(a) + ds(b)));
r('digitcount-times-sum', '(자릿수 개수의 합) × (두 수의 합)', 4, (a, b) => String((String(a).length + String(b).length) * (a + b)));
r('digitsum-mod-sum', '(모든 자리 숫자의 합) ÷ (두 수의 합)의 나머지', 5, (a, b) => String((ds(a) + ds(b)) % (a + b)));

// --- L. 반복·수열 ---
r('sum-of-range', '작은 수부터 큰 수까지 모두 더한 값', 4, (a, b) => {
  const s = small(a, b);
  const B = big(a, b);
  return String(((s + B) * (B - s + 1)) / 2);
});
r('count-between', '두 수 사이의 정수 개수 (양끝 제외)', 3, (a, b) => String(Math.max(0, Math.abs(a - b) - 1)));
r('count-evens-between', '작은 수부터 큰 수까지 중 짝수의 개수', 4, (a, b) => {
  const s = small(a, b);
  const B = big(a, b);
  return String(Math.floor(B / 2) - Math.floor((s - 1) / 2));
});
r('count-multiples-3', '작은 수부터 큰 수까지 중 3의 배수의 개수', 4, (a, b) => {
  const s = small(a, b);
  const B = big(a, b);
  return String(Math.floor(B / 3) - Math.floor((s - 1) / 3));
});
r('pow2-mod', '2를 (두 수의 합)번 곱한 값의 일의 자리', 5, (a, b) => {
  const cyc = [6, 2, 4, 8];
  return String(cyc[(a + b) % 4]);
});
r('sum-digits-repeat', '(두 수의 합)의 자릿수 합을 두 번 반복한 수', 5, (a, b) => {
  const x = ds(a + b);
  return cat(x, x);
});

export const RULES: Rule[] = BANK;
