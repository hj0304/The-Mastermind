/**
 * 모노크롬 (원작: 흑과 백) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §7):
 * - 각자 0~8 타일 9장. 짝수(0,2,4,6,8)=흑, 홀수(1,3,5,7)=백.
 * - 선이 타일을 엎어 제시(상대에겐 색만 보임) → 후가 제시 → 높은 숫자가 승점 1.
 * - 숫자는 승패 후에도 비공개. 단 무승부는 서로 같은 숫자를 냈다는 정보가 드러난다.
 * - 라운드 승자가 다음 선. 무승부면 선 유지.
 * - 9라운드 후 승점 多 승리. 동점이면 타일을 새로 받아 연장전.
 * - 남은 라운드로 뒤집을 수 없으면 조기 종료.
 */

export type PlayerId = 0 | 1;
export type TileColor = 'black' | 'white';

export const ALL_TILES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export function tileColor(n: number): TileColor {
  return n % 2 === 0 ? 'black' : 'white';
}

/**
 * 타일 승부 비교 — a가 이기면 1, 지면 -1, 같으면 0.
 *
 * 기본은 큰 숫자가 이기지만, **최약체 0이 최강자 8을 잡는다**(구룡투의 순환 상성).
 * 8을 무적이 아니게 만들어 0을 버리는 패가 아니라 노림수로 바꾸는 규칙.
 */
export function compareTiles(a: number, b: number): number {
  if (a === b) return 0;
  if (a === 0 && b === 8) return 1;
  if (a === 8 && b === 0) return -1;
  return a > b ? 1 : -1;
}

export interface RoundRecord {
  leader: PlayerId;
  /** [플레이어0 타일, 플레이어1 타일] */
  tiles: [number, number];
  /** null = 무승부 */
  winner: PlayerId | null;
}

export interface MonoState {
  hands: [number[], number[]];
  scores: [number, number];
  /** 현재 라운드의 선 */
  leader: PlayerId;
  /** 선이 제시해 둔 타일 (후 제시 대기 중), 없으면 null */
  pending: number | null;
  history: RoundRecord[];
  /** 진행 중인 세트가 몇 번째 연장전인지 (0 = 본선) */
  overtime: number;
}

export function createGame(firstLeader: PlayerId): MonoState {
  return {
    hands: [[...ALL_TILES], [...ALL_TILES]],
    scores: [0, 0],
    leader: firstLeader,
    pending: null,
    history: [],
    overtime: 0,
  };
}

export function currentPlayer(s: MonoState): PlayerId {
  return s.pending === null ? s.leader : ((1 - s.leader) as PlayerId);
}

export function legalMoves(s: MonoState): number[] {
  return [...s.hands[currentPlayer(s)]];
}

/** 승부가 수학적으로 확정됐는지 (남은 라운드로 역전 불가) */
function isDecided(s: MonoState): boolean {
  const remaining = Math.min(s.hands[0].length, s.hands[1].length);
  return Math.abs(s.scores[0] - s.scores[1]) > remaining;
}

export function isTerminal(s: MonoState): boolean {
  if (s.pending !== null) return false;
  if (isDecided(s)) return true;
  // 세트 종료 + 비동점이면 종료 (동점이면 연장전 상태로 이미 전환됨)
  return s.hands[0].length === 0 && s.scores[0] !== s.scores[1];
}

export function winner(s: MonoState): PlayerId | null {
  if (!isTerminal(s)) return null;
  return s.scores[0] > s.scores[1] ? 0 : 1;
}

/** 현재 플레이어가 타일 하나를 제시한다. 불변 — 새 상태를 반환. */
export function play(s: MonoState, tile: number): MonoState {
  const p = currentPlayer(s);
  if (!s.hands[p].includes(tile)) {
    throw new Error(`illegal move: player ${p} has no tile ${tile}`);
  }
  const hands: [number[], number[]] = [
    p === 0 ? s.hands[0].filter((t) => t !== tile) : [...s.hands[0]],
    p === 1 ? s.hands[1].filter((t) => t !== tile) : [...s.hands[1]],
  ];

  // 선의 제시 — 후를 기다린다
  if (s.pending === null) {
    return { ...s, hands, pending: tile };
  }

  // 후의 제시 — 라운드 판정
  const leaderTile = s.pending;
  const followerTile = tile;
  const tiles: [number, number] =
    s.leader === 0 ? [leaderTile, followerTile] : [followerTile, leaderTile];
  const cmp = compareTiles(tiles[0], tiles[1]);
  const roundWinner: PlayerId | null = cmp === 0 ? null : cmp > 0 ? 0 : 1;

  const scores: [number, number] = [...s.scores];
  if (roundWinner !== null) scores[roundWinner] += 1;

  const next: MonoState = {
    hands,
    scores,
    leader: roundWinner ?? s.leader, // 승자가 다음 선, 무승부면 선 유지
    pending: null,
    history: [...s.history, { leader: s.leader, tiles, winner: roundWinner }],
    overtime: s.overtime,
  };

  // 세트 종료 시 동점이면 연장전: 타일 재지급 + 승점 초기화 (선 유지)
  if (next.hands[0].length === 0 && next.scores[0] === next.scores[1] && !isDecided(next)) {
    return {
      ...next,
      hands: [[...ALL_TILES], [...ALL_TILES]],
      scores: [0, 0],
      overtime: next.overtime + 1,
    };
  }
  return next;
}

export interface OppHandCandidate {
  /** 상대의 가능한 잔여 타일 집합 (선이 엎어둔 pending 타일이 있다면 그것도 포함) */
  hand: number[];
  weight: number;
}

/**
 * `viewer` 시점에서 상대의 가능한 잔여 손패 분포를 전수 열거한다.
 * 공개 정보: 상대가 라운드마다 낸 타일의 색 + viewer 타일과의 비교 결과(무승부는 숫자 확정).
 */
export function opponentHandDistribution(s: MonoState, viewer: PlayerId): OppHandCandidate[] {
  const opp = (1 - viewer) as PlayerId;
  const records = s.history.slice(9 * s.overtime);
  // 승패는 숫자 대소가 아니라 compareTiles 기준이다(0이 8을 이기므로).
  interface Constraint { color: TileColor; cmp: 'won' | 'lost' | 'eq'; ref: number }
  const constraints: Constraint[] = [];
  for (const r of records) {
    const oppTile = r.tiles[opp];
    const myTile = r.tiles[viewer];
    constraints.push({
      color: tileColor(oppTile),
      cmp: r.winner === null ? 'eq' : r.winner === opp ? 'won' : 'lost',
      ref: myTile,
    });
  }

  const byKey = new Map<string, OppHandCandidate>();
  const used = new Array<boolean>(9).fill(false);

  function assign(i: number): void {
    if (i === constraints.length) {
      const hand = ALL_TILES.filter((n) => !used[n]);
      const key = hand.join(',');
      const existing = byKey.get(key);
      if (existing) existing.weight += 1;
      else byKey.set(key, { hand, weight: 1 });
      return;
    }
    const c = constraints[i];
    for (let n = 0; n < 9; n++) {
      if (used[n]) continue;
      if (tileColor(n) !== c.color) continue;
      if (c.cmp === 'eq' && n !== c.ref) continue;
      if (c.cmp === 'won' && compareTiles(n, c.ref) <= 0) continue;
      if (c.cmp === 'lost' && compareTiles(n, c.ref) >= 0) continue;
      used[n] = true;
      assign(i + 1);
      used[n] = false;
    }
  }
  assign(0);

  const candidates = [...byKey.values()];
  const total = candidates.reduce((a, c) => a + c.weight, 0);
  if (total === 0) {
    // 제약 불일치(발생하면 버그) — 균등 폴백
    return [{ hand: [...s.hands[opp]], weight: 1 }];
  }
  for (const c of candidates) c.weight /= total;
  return candidates;
}

/**
 * `viewer` 시점에서 상대가 낼 수 있는 타일 후보의 사후 분포(주변확률)를 계산한다.
 * 반환: 상대의 남은 타일일 확률 P(n) (n=0..8).
 */
export function opponentTileProbabilities(s: MonoState, viewer: PlayerId): number[] {
  const dist = opponentHandDistribution(s, viewer);
  const probs = new Array<number>(9).fill(0);
  for (const c of dist) {
    for (const n of c.hand) probs[n] += c.weight;
  }
  return probs;
}

