/**
 * 수의 진 AI — 불완전정보(은폐 기물) 확률 추론 + 위협 분석.
 *
 * AI는 상대 기물의 정체를 절대 직접 보지 않는다. 사용하는 추론:
 * - 공개 정보(대결로 공개된 기물, 죽은 기물)로 미공개 기물의 정체 분포를 계산
 * - "움직인 기물은 지뢰가 아니다" — 이동 이력 기반 지뢰 추론 (원작의 핵심 전략)
 * - 후보 수마다: 즉시 대결 기대값 + 다음 턴 상대 위협(왕 피습 등) + 전진 가치 평가
 * - 왕 대결 즉사 규칙 때문에 왕 주변 위협은 승패급 가중치로 처리
 */

import type { NMove, NPiece, NState, NType, PlayerId } from './engine.ts';
import {
  N_COLS,
  N_ROWS,
  FULL_SET,
  battleOutcome,
  cellIdx,
  enemyBackRow,
  isMinusEdge,
  legalMoves,
  movesOnBoard,
  reviveCells,
  reviveOptions,
} from './engine.ts';

const WIN = 100000;

/** 기물 가치 (원작 승률표 기반) */
function value(t: NType): number {
  if (t === 'K') return 0; // 승패 조건으로 별도 처리
  if (t === 'M') return 55;
  const map: Record<number, number> = {
    1: 95, 2: 80, 3: 65, 4: 50, 5: 40, 6: 45, 7: 50, 8: 55, 9: 62, 10: 65,
  };
  return map[t as number];
}

/** 미공개 적 기물의 정체 분포 계산 */
function beliefFor(s: NState, me: PlayerId): (piece: NPiece) => Array<[NType, number]> {
  const opp = (1 - me) as PlayerId;
  // 남은 미지 타입 = 전체 - (죽은 기물) - (공개된 생존 기물)
  const unknown: NType[] = [...FULL_SET];
  const consume = (t: NType) => {
    const i = unknown.indexOf(t);
    if (i >= 0) unknown.splice(i, 1);
  };
  for (const d of s.dead[opp]) consume(d.type);
  for (const c of s.board) {
    if (c && c.owner === opp && c.revealed) consume(c.type);
  }

  return (piece: NPiece) => {
    if (piece.revealed) return [[piece.type, 1]];
    const support = unknown.filter((t) => !(piece.hasMoved && t === 'M'));
    if (support.length === 0) return [[piece.type, 1]]; // 방어적 폴백
    const counts = new Map<NType, number>();
    for (const t of support) counts.set(t, (counts.get(t) ?? 0) + 1);
    const total = support.length;
    return [...counts.entries()].map(([t, c]) => [t, c / total] as [NType, number]);
  };
}

/** 대결 기대값 (mover = 내 기물, 정체 확실 / other = 적 기물, 분포) */
function battleEV(
  mover: NPiece,
  other: NPiece,
  minus: boolean,
  belief: (p: NPiece) => Array<[NType, number]>,
): number {
  let ev = 0;
  for (const [t, prob] of belief(other)) {
    const o = battleOutcome(mover, { ...other, type: t }, minus);
    if (o.instantWinner !== null) {
      ev += prob * (o.instantWinner === mover.owner ? WIN : -WIN);
      continue;
    }
    let delta = 0;
    if (o.removeOther) delta += value(t);
    if (o.removeMover) delta -= value(mover.type);
    ev += prob * delta;
  }
  return ev;
}

/** cell 주변 상하좌우 좌표 */
function orthAdj(cell: number): number[] {
  const row = Math.floor(cell / N_COLS);
  const col = cell % N_COLS;
  const out: number[] = [];
  if (row > 0) out.push(cellIdx(row - 1, col));
  if (row < N_ROWS - 1) out.push(cellIdx(row + 1, col));
  if (col > 0) out.push(cellIdx(row, col - 1));
  if (col < N_COLS - 1) out.push(cellIdx(row, col + 1));
  return out;
}

/**
 * 가상 보드에서 상대의 다음 턴 위협 평가 (내 관점의 감점).
 * - 내 왕 옆으로 이동 가능한 적 기물 → 왕 즉사 위협 (적 왕일 확률만큼 감쇄)
 * - 공개된 내 기물이 필패 대결에 노출 → 기물 가치 감점
 */
function threatPenalty(
  board: (NPiece | null)[],
  me: PlayerId,
  belief: (p: NPiece) => Array<[NType, number]>,
): number {
  let penalty = 0;
  const myKingCell = board.findIndex((c) => c?.type === 'K' && c.owner === me);
  const kingAdj = myKingCell >= 0 ? new Set(orthAdj(myKingCell)) : new Set<number>();

  for (let cell = 0; cell < 54; cell++) {
    const enemy = board[cell];
    if (!enemy || enemy.owner === me || enemy.type === 'M') continue;
    // 적 기물의 정체 분포에서 '왕이 아닐 확률' (왕끼리는 대결 무효이므로)
    const dist = belief(enemy);
    const pNotKing = dist.reduce((a, [t, p]) => a + (t === 'K' ? 0 : p), 0);
    for (const to of movesOnBoard(board, cell)) {
      if (kingAdj.has(to)) {
        // 적이 왕 옆에 붙으면 왕 즉사 — 최악의 위협
        penalty = Math.min(penalty, -WIN * 0.9 * pNotKing);
      }
    }
  }

  // 내 공개 기물이 다음 턴 필패 대결에 노출되는가
  for (let cell = 0; cell < 54; cell++) {
    const mine = board[cell];
    if (!mine || mine.owner !== me || !mine.revealed || mine.type === 'K') continue;
    for (let ec = 0; ec < 54; ec++) {
      const enemy = board[ec];
      if (!enemy || enemy.owner === me) continue;
      for (const to of movesOnBoard(board, ec)) {
        if (!orthAdj(to).includes(cell)) continue;
        // 적이 이 칸으로 와서 내 공개 기물과 대결하는 상황
        const minus = isMinusEdge(to, cell);
        let evForEnemy = 0;
        for (const [t, p] of belief(enemy)) {
          if (t === 'K' || t === 'M') continue;
          const o = battleOutcome({ ...enemy, type: t }, mine, minus);
          if (o.removeOther) evForEnemy += p * value(mine.type);
          if (o.removeMover) evForEnemy -= p * value(t);
        }
        if (evForEnemy > 20) penalty -= value(mine.type) * 0.45;
      }
    }
  }
  return penalty;
}

export function chooseAiMove(s: NState, me: PlayerId): NMove {
  const moves = legalMoves(s);
  if (moves.length === 0) throw new Error('no legal moves');
  const belief = beliefFor(s, me);
  const eBack = enemyBackRow(me);
  const forwardSign = me === 0 ? 1 : -1;

  // 남은 적 전력 (왕 돌진 타이밍 판단)
  const enemyFighters = s.board.filter(
    (c) => c && c.owner !== me && c.type !== 'K' && c.type !== 'M',
  ).length;

  let best: NMove = moves[0];
  let bestScore = -Infinity;

  for (const m of moves) {
    const mover = s.board[m.from]!;
    let score = Math.random() * 6; // 동점 무작위화

    const toRow = Math.floor(m.to / N_COLS);

    // 왕 끝줄 도달 = 승리
    if (mover.type === 'K' && toRow === eBack) {
      score += WIN;
    }

    // 즉시 대결 기대값
    let battleTotal = 0;
    let hasBattle = false;
    for (const c of orthAdj(m.to)) {
      const other = s.board[c];
      if (!other || other.owner === me) continue;
      if (c === m.from) continue;
      hasBattle = true;
      battleTotal += battleEV({ ...mover, hasMoved: true }, other, isMinusEdge(m.to, c), belief);
    }
    score += battleTotal;

    // 숫자 기물 끝줄 도달: 부활 교환 가치
    if (mover.type !== 'K' && mover.type !== 'M' && toRow === eBack && !hasBattle) {
      const deadOthers = s.dead[me];
      const bestDead = Math.max(0, ...deadOthers.map((d) => (d.type === 'K' ? 0 : value(d.type))));
      score += bestDead > 0 ? bestDead - value(mover.type) : -value(mover.type) * 0.8;
    }

    // 전진 가치 (숫자 기물만, 소폭)
    if (mover.type !== 'K') {
      const progress = (Math.floor(m.to / N_COLS) - Math.floor(m.from / N_COLS)) * forwardSign;
      score += progress * 4;
    } else {
      // 왕은 기본적으로 웅크린다 — 적 전력이 거의 소진되면 돌진 허용
      const progress = (Math.floor(m.to / N_COLS) - Math.floor(m.from / N_COLS)) * forwardSign;
      score += enemyFighters <= 2 ? progress * 30 : -60 - progress * 20;
    }

    // 가상 보드 구성 후 위협 평가 (대결 결과 근사: 기대값 부호로 단순화)
    const board = [...s.board];
    board[m.from] = null;
    board[m.to] = { ...mover, hasMoved: true };
    // 대결이 있고 크게 지는 수면 이미 battleTotal이 깎였으니 여기선 생존 가정
    score += threatPenalty(board, me, belief);

    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/** 부활 선택: 가장 가치 높은 기물을 되살리고 중앙 쪽 빈 끝줄 칸에 배치 */
export function chooseAiRevive(s: NState): { pieceId: number; cell: number } | null {
  if (s.pendingRevive === null) return null;
  const options = reviveOptions(s).filter((d) => d.type !== 'K');
  const cells = reviveCells(s, s.pendingRevive);
  if (options.length === 0 || cells.length === 0) return null;
  options.sort((a, b) => value(b.type) - value(a.type));
  cells.sort((a, b) => Math.abs((a % N_COLS) - 2.5) - Math.abs((b % N_COLS) - 2.5));
  return { pieceId: options[0].id, cell: cells[0] };
}
