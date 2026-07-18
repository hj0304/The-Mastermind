/**
 * 모노크롬 관점 뷰 — 특정 좌석의 플레이어가 보아도 되는 정보만 담는다.
 * 온라인 대전에서 호스트가 게스트에게 전송하는 유일한 게임 데이터이므로,
 * 여기 없는 정보(상대 손패·상대가 낸 숫자)는 네트워크로 새어나가지 않는다.
 */

import type { MonoState, PlayerId, TileColor } from './engine.ts';
import { currentPlayer, isTerminal, tileColor, winner } from './engine.ts';

export interface MonoHistRow {
  myTile: number;
  /** 무승부일 때만 상대 숫자 공개 (같은 숫자였음이 드러남) */
  oppTile: number | null;
  oppColor: TileColor;
  result: 'win' | 'lose' | 'draw';
}

export interface MonoView {
  seat: PlayerId;
  myHand: number[];
  oppHandCount: number;
  myScore: number;
  oppScore: number;
  round: number;
  overtime: number;
  iAmLeader: boolean;
  myTurn: boolean;
  /** 테이블 위 선 제시 타일 — 내 것이면 숫자 공개, 상대 것이면 색만 */
  pending: { color: TileColor; value: number | null } | null;
  history: MonoHistRow[];
  terminal: boolean;
  iWon: boolean | null;
}

export function viewFor(s: MonoState, seat: PlayerId): MonoView {
  const opp = (1 - seat) as PlayerId;
  const term = isTerminal(s);
  return {
    seat,
    myHand: [...s.hands[seat]],
    oppHandCount: s.hands[opp].length,
    myScore: s.scores[seat],
    oppScore: s.scores[opp],
    round: Math.min((s.history.length % 9) + 1, 9),
    overtime: s.overtime,
    iAmLeader: s.leader === seat,
    myTurn: !term && currentPlayer(s) === seat,
    pending:
      s.pending === null
        ? null
        : {
            color: tileColor(s.pending),
            value: s.leader === seat ? s.pending : null,
          },
    history: s.history.slice(9 * s.overtime).map((r) => ({
      myTile: r.tiles[seat],
      oppTile: r.winner === null ? r.tiles[opp] : null,
      oppColor: tileColor(r.tiles[opp]),
      result: r.winner === null ? 'draw' : r.winner === seat ? 'win' : 'lose',
    })),
    terminal: term,
    iWon: term ? winner(s) === seat : null,
  };
}
