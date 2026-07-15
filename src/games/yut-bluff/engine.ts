/**
 * 윷과 거짓말 (원작: 의심 윷놀이 / 원류: 챠오챠오) 게임 엔진 — 순수 로직, UI 무관.
 *
 * 룰 (docs/GAME_RULES.md §5, 2인 대칭 변형):
 * - 10면체 주사위: 도×2(1칸)·개×2(2칸)·걸×2(3칸)·윷×1(4칸)·모×1(5칸)·꽝×2.
 * - 자기 차례: 주사위를 굴려 **본인만 확인** → 결과를 선언하며 움직일 말을 지정.
 *   꽝은 선언할 수 없다(꽝이 나오면 거짓 선언을 해야 한다). 진실이어도 거짓 선언 가능.
 * - 상대는 **믿기** 또는 **의심** 선택:
 *   · 믿기 — 지정 말이 "선언된 값"만큼 전진 (실제 값과 무관, 들통나지 않은 거짓말은 통한다)
 *   · 의심 — 주사위 공개. 거짓이면 지정 말 제거(해당 말 제거), 진실이면 의심자가
 *     말 1개를 잃고(대기 말 우선, 없으면 가장 뒤처진 말) 지정 말은 그대로 전진
 * - 말: 각자 4개. 다리(1~8칸)를 건너 9칸째 도달 시 완주. **2개 선입선승**.
 *   남은 말(대기+다리+완주)로 2완주가 불가능해지면 즉시 패배.
 * - 잡기·업기 없음(다리 위 공존 가능). 매 라운드 차례 교대. (안전장치) 300라운드 무승부.
 */

export type PlayerId = 0 | 1;

export const TRACK_LEN = 8;
export const HOME = -1;
export const DEAD = -99;
export const GOAL = 99;

/** 주사위 면: 값(칸수), 꽝=0 */
export const DIE_FACES = [1, 1, 2, 2, 3, 3, 4, 5, 0, 0];

export const VALUE_NAME: Record<number, string> = {
  0: '꽝',
  1: '도',
  2: '개',
  3: '걸',
  4: '윷',
  5: '모',
};

export interface RoundRec {
  roller: PlayerId;
  declared: number; // 1~5
  fromPos: number; // HOME 또는 다리 칸
  challenged: boolean;
  revealed: boolean;
  /** 실제 주사위 값 — revealed=false면 UI/AI에 노출 금지 */
  roll: number;
  wasLie: boolean | null; // 공개된 경우만
  outcome: 'moved' | 'liar-caught' | 'wrong-challenge';
}

export interface BState {
  /** pieces[p] = 말 4개의 위치 (HOME/1~8/GOAL/DEAD) */
  pieces: [number[], number[]];
  turn: PlayerId; // 현재 롤러
  phase: 'declare' | 'respond' | 'gameover';
  /** 현재 롤러의 비공개 주사위 값 (respond 단계까지 유지) */
  roll: number;
  declaration: { value: number; fromPos: number } | null;
  history: RoundRec[];
  round: number;
  result: { winner: PlayerId | null } | null;
}

export function rollDie(): number {
  return DIE_FACES[Math.floor(Math.random() * DIE_FACES.length)];
}

export function createGame(firstTurn: PlayerId, firstRoll?: number): BState {
  return {
    pieces: [
      [HOME, HOME, HOME, HOME],
      [HOME, HOME, HOME, HOME],
    ],
    turn: firstTurn,
    phase: 'declare',
    roll: firstRoll ?? rollDie(),
    declaration: null,
    history: [],
    round: 0,
    result: null,
  };
}

/** 지정 가능한 말 출발 위치 목록 (대기는 하나로 취급) */
export function declarablePieces(s: BState): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const pos of s.pieces[s.turn]) {
    if (pos === GOAL || pos === DEAD) continue;
    if (seen.has(pos)) continue;
    seen.add(pos);
    out.push(pos);
  }
  return out;
}

export function declare(s: BState, value: number, fromPos: number): BState {
  if (s.phase !== 'declare') throw new Error('not declare phase');
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('bad value');
  if (!declarablePieces(s).includes(fromPos)) throw new Error('bad piece');
  return { ...s, phase: 'respond', declaration: { value, fromPos } };
}

function movePiece(pieces: number[], fromPos: number, steps: number): number[] {
  const out = [...pieces];
  const i = out.indexOf(fromPos);
  const dest = (fromPos === HOME ? 0 : fromPos) + steps;
  out[i] = dest > TRACK_LEN ? GOAL : dest;
  return out;
}

function killPiece(pieces: number[], fromPos: number): number[] {
  const out = [...pieces];
  out[out.indexOf(fromPos)] = DEAD;
  return out;
}

/** 의심 실패 페널티 대상: 대기 말 우선, 없으면 가장 뒤처진 다리 말 */
function penaltyTarget(pieces: number[]): number | null {
  if (pieces.includes(HOME)) return HOME;
  const onTrack = pieces.filter((p) => p >= 1 && p <= TRACK_LEN);
  if (onTrack.length === 0) return null;
  return Math.min(...onTrack);
}

function aliveCount(pieces: number[]): number {
  return pieces.filter((p) => p !== DEAD).length;
}

export function respond(s: BState, challenge: boolean): BState {
  if (s.phase !== 'respond' || !s.declaration) throw new Error('not respond phase');
  const roller = s.turn;
  const responder = (1 - roller) as PlayerId;
  const { value, fromPos } = s.declaration;
  const wasLie = s.roll !== value;

  let rollerPieces = [...s.pieces[roller]];
  let respPieces = [...s.pieces[responder]];
  let outcome: RoundRec['outcome'];

  if (!challenge) {
    rollerPieces = movePiece(rollerPieces, fromPos, value);
    outcome = 'moved';
  } else if (wasLie) {
    rollerPieces = killPiece(rollerPieces, fromPos);
    outcome = 'liar-caught';
  } else {
    rollerPieces = movePiece(rollerPieces, fromPos, value);
    const target = penaltyTarget(respPieces);
    if (target !== null) respPieces = killPiece(respPieces, target);
    outcome = 'wrong-challenge';
  }

  const rec: RoundRec = {
    roller,
    declared: value,
    fromPos,
    challenged: challenge,
    revealed: challenge,
    roll: s.roll,
    wasLie: challenge ? wasLie : null,
    outcome,
  };

  const pieces: [number[], number[]] =
    roller === 0 ? [rollerPieces, respPieces] : [respPieces, rollerPieces];

  // 승패 판정
  let winner: PlayerId | null | undefined;
  for (const p of [0, 1] as PlayerId[]) {
    const crossed = pieces[p].filter((x) => x === GOAL).length;
    if (crossed >= 2) winner = p;
  }
  if (winner === undefined) {
    for (const p of [0, 1] as PlayerId[]) {
      if (aliveCount(pieces[p]) < 2) winner = (1 - p) as PlayerId;
    }
  }
  const round = s.round + 1;
  if (winner === undefined && round >= 300) winner = null;

  if (winner !== undefined) {
    return {
      ...s,
      pieces,
      phase: 'gameover',
      declaration: null,
      history: [...s.history, rec],
      round,
      result: { winner },
    };
  }

  return {
    ...s,
    pieces,
    turn: responder,
    phase: 'declare',
    roll: rollDie(),
    declaration: null,
    history: [...s.history, rec],
    round,
    result: null,
  };
}
