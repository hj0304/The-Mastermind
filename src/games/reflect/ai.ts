/**
 * 리플렉트 AI — 반복 심화 알파베타 탐색 + 치환표.
 *
 * 완전정보 게임: 숨은 정보가 없으므로 AI의 강함은 순수 수읽기 깊이에서 나온다.
 * - 평가: 재료 + "내 레이저 빔이 상대 왕에 얼마나 가까이 지나가는가" (전진 동기 —
 *   재료만으로는 양쪽이 수를 왕복하다 반복 무승부가 되는 것을 시뮬레이션으로 확인)
 * - 수 정렬: 자식을 먼저 전개해 즉시 평가차로 정렬 (자식 캐시로 이중 적용 방지)
 * - 탐색 내부는 applyMoveLite(반복국면 추적 생략), 루트만 실제 applyMove로
 *   반복 무승부를 인지한다.
 */

import type { Move, PieceType, PlayerId, RfState } from './engine.ts';
import { applyMove, applyMoveLite, colOf, legalMoves, rowOf, traceLaser } from './engine.ts';

const WIN = 100000;

const MATERIAL: Record<PieceType, number> = {
  king: 0, // 승패는 result로 처리
  laser: 0,
  split: 0, // 파괴 불가
  tri: 34,
  sq: 45,
};

/** owner의 빔 경로가 지나는 칸들과 target 칸의 최소 체비쇼프 거리 */
function beamDistanceTo(board: RfState['board'], owner: PlayerId, target: number): number {
  const tr = rowOf(target);
  const tc = colOf(target);
  let min = 99;
  const fire = traceLaser(board, owner);
  for (const line of fire.beams) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [r1, c1] = line[i];
      const [r2, c2] = line[i + 1];
      const steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1));
      const dr = Math.sign(r2 - r1);
      const dc = Math.sign(c2 - c1);
      for (let k = 0; k <= steps; k++) {
        const d = Math.max(Math.abs(r1 + dr * k - tr), Math.abs(c1 + dc * k - tc));
        if (d < min) min = d;
      }
    }
  }
  return min;
}

function evaluate(s: RfState, me: PlayerId): number {
  let score = 0;
  let myKing = -1;
  let oppKing = -1;
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (!p) continue;
    score += p.owner === me ? MATERIAL[p.type] : -MATERIAL[p.type];
    if (p.type === 'king') {
      if (p.owner === me) myKing = i;
      else oppKing = i;
    }
  }
  // 빔 압박: 왕 근처를 지나는 빔일수록 가치 (거리 8 이내부터 가산)
  if (oppKing >= 0) {
    const d = beamDistanceTo(s.board, me, oppKing);
    score += Math.max(0, 8 - d) * 4;
  }
  if (myKing >= 0) {
    const d = beamDistanceTo(s.board, (1 - me) as PlayerId, myKing);
    score -= Math.max(0, 8 - d) * 4;
  }
  return score;
}

interface TTEntry {
  depth: number;
  value: number;
  flag: 0 | 1 | 2; // exact | lower | upper
}

interface SearchCtx {
  me: PlayerId;
  deadline: number;
  nodes: number;
  tt: Map<string, TTEntry>;
}

class TimeUp extends Error {}

/** 자식 전개 + 즉시 재료차 정렬 (내림차순: 두는 쪽에 유리한 순) */
function expandChildren(
  s: RfState,
  real: boolean,
): { move: Move; child: RfState; quick: number }[] {
  const mover = s.turn;
  const out: { move: Move; child: RfState; quick: number }[] = [];
  for (const move of legalMoves(s)) {
    const child = real ? applyMove(s, move) : applyMoveLite(s, move);
    let quick = 0;
    if (child.result) {
      quick = child.result.winner === null ? 0 : child.result.winner === mover ? WIN : -WIN;
    } else if (child.lastFire) {
      for (const d of child.lastFire.destroyed) {
        quick += d.piece.owner === mover ? -MATERIAL[d.piece.type] : MATERIAL[d.piece.type];
      }
    }
    out.push({ move, child, quick });
  }
  out.sort((a, b) => b.quick - a.quick);
  return out;
}

function posKeyLite(s: RfState): string {
  let key = String(s.turn);
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (p) key += `${i}${p.type[0]}${p.owner}${p.dir}`;
  }
  return key;
}

function negamax(
  s: RfState,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx,
  ply: number,
): number {
  if ((ctx.nodes & 127) === 0 && performance.now() > ctx.deadline) throw new TimeUp();
  ctx.nodes++;

  if (s.result) {
    if (s.result.winner === null) return 0;
    // s.turn 관점: 이미 끝났으니 직전 수를 둔 쪽 기준으로 부호 결정
    return s.result.winner === s.turn ? WIN - ply : -WIN + ply;
  }
  if (depth === 0) return evaluate(s, s.turn as PlayerId);

  const key = posKeyLite(s);
  const hit = ctx.tt.get(key);
  if (hit && hit.depth >= depth) {
    if (hit.flag === 0) return hit.value;
    if (hit.flag === 1 && hit.value >= beta) return hit.value;
    if (hit.flag === 2 && hit.value <= alpha) return hit.value;
  }

  const alphaOrig = alpha;
  let best = -Infinity;
  for (const { child } of expandChildren(s, false)) {
    const v = -negamax(child, depth - 1, -beta, -alpha, ctx, ply + 1);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }

  const flag: 0 | 1 | 2 = best <= alphaOrig ? 2 : best >= beta ? 1 : 0;
  const prev = ctx.tt.get(key);
  if (!prev || prev.depth <= depth) ctx.tt.set(key, { depth, value: best, flag });
  return best;
}

export function chooseAiMove(
  s: RfState,
  timeMs: number,
): { move: Move; depth: number; nodes: number } {
  const ctx: SearchCtx = {
    me: s.turn,
    deadline: performance.now() + timeMs,
    nodes: 0,
    tt: new Map(),
  };

  // 루트는 실제 applyMove — 반복 무승부를 결과로 인지
  const roots = expandChildren(s, true);
  if (roots.length === 0) throw new Error('no legal moves');
  const instant = roots.find((r) => r.child.result && r.child.result.winner === s.turn);
  if (instant) return { move: instant.move, depth: 0, nodes: roots.length };

  // 동률 수 사이 셔플 방지용 지터 (반복 왕복 억제)
  const jitter = roots.map(() => Math.random() * 3);

  let bestMove = roots[0].move;
  let completedDepth = 0;

  for (let depth = 1; depth <= 12; depth++) {
    try {
      let best = -Infinity;
      let bestAtDepth = roots[0].move;
      let alpha = -Infinity;
      for (let i = 0; i < roots.length; i++) {
        const { move, child } = roots[i];
        const raw = child.result
          ? child.result.winner === null
            ? 0
            : child.result.winner === s.turn
              ? WIN
              : -WIN
          : -negamax(child, depth - 1, -Infinity, -alpha, ctx, 1);
        const v = Math.abs(raw) >= WIN - 100 ? raw : raw + jitter[i];
        if (v > best) {
          best = v;
          bestAtDepth = move;
        }
        if (v > alpha) alpha = v;
      }
      bestMove = bestAtDepth;
      completedDepth = depth;
      if (best >= WIN - 100) break; // 승리 확정
    } catch (e) {
      if (e instanceof TimeUp) break;
      throw e;
    }
  }
  return { move: bestMove, depth: completedDepth, nodes: ctx.nodes };
}
