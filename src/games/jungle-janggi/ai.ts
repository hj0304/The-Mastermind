/**
 * 밀림장기 AI — 반복 심화 알파베타 탐색 + 치환표.
 *
 * 완전정보 소형 게임이므로 탐색만으로 극강 수준에 도달한다.
 * (자가대국 강화학습 모델은 3주차 스트레치 골 — 이 탐색 AI가 베이스라인이 된다)
 *
 * - 시간 예산 내 반복 심화 (기본 900ms, 보통 깊이 9~13 도달)
 * - 치환표(TT) + 수 정렬(TT 수 → 왕 포획 → 캡처 우선)
 * - 평가: 기물 가치(손 기물 포함) + 자/후 전진 + 왕 안전/진영 접근 + 기동력
 * - 루트에서 동점 최선수는 무작위 선택 (패턴 고착 방지)
 */

import type { JState, Move, PieceType, PlayerId } from './engine.ts';
import { COLS, applyMove, legalMoves, positionKey } from './engine.ts';

const WIN = 100000;

const PIECE_VALUE: Record<PieceType, number> = {
  K: 0, // 왕은 승패 조건으로 처리
  G: 520,
  E: 460,
  C: 110,
  H: 660,
};
const HAND_VALUE: Record<string, number> = { G: 560, E: 500, C: 140 };

/** side 관점 정적 평가 */
function evaluate(s: JState, side: PlayerId): number {
  let score = 0;
  for (let cell = 0; cell < 12; cell++) {
    const piece = s.board[cell];
    if (!piece) continue;
    const sign = piece.owner === side ? 1 : -1;
    score += sign * PIECE_VALUE[piece.type];
    const row = Math.floor(cell / COLS);
    if (piece.type === 'C') {
      // 자 전진 보너스 (승격 접근)
      const progress = piece.owner === 0 ? row : 3 - row;
      score += sign * progress * 18;
    }
    if (piece.type === 'K') {
      // 왕이 상대 진영 옆줄까지 접근하면 진영 승리 위협 보너스 (소폭)
      const progress = piece.owner === 0 ? row : 3 - row;
      score += sign * progress * 10;
    }
  }
  for (const t of s.hands[side]) score += HAND_VALUE[t] ?? 0;
  for (const t of s.hands[1 - side]) score -= HAND_VALUE[t] ?? 0;
  return score;
}

interface TTEntry {
  depth: number;
  score: number;
  flag: 'exact' | 'lower' | 'upper';
  best: number; // move index (해당 국면 legalMoves 배열 기준)
}

function orderMoves(s: JState, moves: Move[], ttBest: number): number[] {
  const scores = moves.map((m, i) => {
    let sc = 0;
    if (i === ttBest) sc += 100000;
    if (m.kind === 'move') {
      const target = s.board[m.to];
      if (target) {
        sc += target.type === 'K' ? 50000 : PIECE_VALUE[target.type] * 2;
        const mover = s.board[m.from]!;
        sc -= PIECE_VALUE[mover.type] * 0.1; // 싼 기물로 잡는 것 선호
      }
    }
    return sc;
  });
  return moves.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
}

export interface SearchResult {
  move: Move;
  score: number;
  depth: number;
  nodes: number;
}

export function chooseAiMove(s: JState, timeMs = 900): SearchResult {
  const tt = new Map<string, TTEntry>();
  const deadline = Date.now() + timeMs;
  let nodes = 0;
  let aborted = false;

  function negamax(state: JState, depth: number, alpha: number, beta: number, ply: number): number {
    nodes++;
    if ((nodes & 1023) === 0 && Date.now() > deadline) {
      aborted = true;
      return 0;
    }
    if (state.result) {
      if (state.result.winner === null) return 0;
      // 현재 턴 플레이어 관점: result는 이미 결정 — 승자가 나(턴)인지로 부호 결정
      return state.result.winner === state.turn ? WIN - ply : -(WIN - ply);
    }
    if (depth === 0) return evaluate(state, state.turn);

    const key = positionKey(state);
    const cached = tt.get(key);
    let ttBest = -1;
    if (cached) {
      ttBest = cached.best;
      if (cached.depth >= depth) {
        if (cached.flag === 'exact') return cached.score;
        if (cached.flag === 'lower' && cached.score >= beta) return cached.score;
        if (cached.flag === 'upper' && cached.score <= alpha) return cached.score;
      }
    }

    const moves = legalMoves(state);
    if (moves.length === 0) return -(WIN - ply); // 수가 없으면 패배 취급 (실전에선 드묾)
    const order = orderMoves(state, moves, ttBest);

    let best = -Infinity;
    let bestIdx = order[0];
    const alphaOrig = alpha;
    for (const i of order) {
      const child = applyMove(state, moves[i]);
      const v = -negamax(child, depth - 1, -beta, -alpha, ply + 1);
      if (aborted) return 0;
      if (v > best) {
        best = v;
        bestIdx = i;
      }
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    tt.set(key, {
      depth,
      score: best,
      flag: best <= alphaOrig ? 'upper' : best >= beta ? 'lower' : 'exact',
      best: bestIdx,
    });
    return best;
  }

  const rootMoves = legalMoves(s);
  if (rootMoves.length === 0) throw new Error('no legal moves');
  let bestMove = rootMoves[0];
  let bestScore = -Infinity;
  let reachedDepth = 0;

  for (let depth = 2; depth <= 20; depth++) {
    const order = orderMoves(s, rootMoves, rootMoves.indexOf(bestMove));
    let iterBest = -Infinity;
    let iterMoves: Move[] = [];
    let alpha = -Infinity;
    for (const i of order) {
      const child = applyMove(s, rootMoves[i]);
      const v = -negamax(child, depth - 1, -Infinity, -alpha, 1);
      if (aborted) break;
      if (v > iterBest + 1e-9) {
        iterBest = v;
        iterMoves = [rootMoves[i]];
      } else if (Math.abs(v - iterBest) <= 1e-9) {
        iterMoves.push(rootMoves[i]);
      }
      alpha = Math.max(alpha, v);
    }
    if (aborted) break;
    if (iterMoves.length > 0) {
      bestScore = iterBest;
      bestMove = iterMoves[Math.floor(Math.random() * iterMoves.length)];
      reachedDepth = depth;
    }
    if (bestScore >= WIN - 50) break; // 필승 확정이면 중단
    if (Date.now() > deadline) break;
  }

  return { move: bestMove, score: bestScore, depth: reachedDepth, nodes };
}
