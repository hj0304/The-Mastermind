/**
 * 모든 게임이 구현하는 공통 턴제 게임 인터페이스.
 *
 * 이 추상화 하나로 세 가지가 공짜로 따라온다:
 *  - 솔로 AI 대전: legalMoves/applyMove 위에서 minimax·MCTS가 동작
 *  - 온라인 멀티: Move를 직렬화해 방(room)에 중계하면 어떤 게임이든 동기화됨
 *  - 리플레이/검증: 초기 seed + Move 목록만 있으면 게임 전체를 재현
 *
 * 불완전정보 게임(포커류)은 observe()로 각 플레이어에게 보이는 정보만 노출한다.
 */

export type PlayerId = number; // 0-based

export interface GameResult {
  /** 승자 목록 (무승부면 비어 있음) */
  winners: PlayerId[];
}

export interface GameDefinition<State, Move> {
  /** 게임 식별자 (registry의 id와 동일) */
  id: string;
  /** 지원 인원 범위 */
  minPlayers: number;
  maxPlayers: number;

  /** 초기 상태 생성. 같은 seed면 항상 같은 상태(셔플 재현용). */
  setup(playerCount: number, seed: number): State;

  /** 현재 행동할 플레이어 */
  currentPlayer(state: State): PlayerId;

  /** 현재 플레이어가 둘 수 있는 수 */
  legalMoves(state: State): Move[];

  /** 수를 적용한 다음 상태 (state는 불변으로 취급) */
  applyMove(state: State, move: Move): State;

  /** 게임 종료 여부 */
  isTerminal(state: State): boolean;

  /** 종료 상태의 결과. 비종료 상태면 null. */
  result(state: State): GameResult | null;

  /**
   * player 시점에서 보이는 상태(불완전정보 게임용).
   * 완전정보 게임은 state를 그대로 반환하면 된다.
   */
  observe(state: State, player: PlayerId): unknown;
}

/** AI 전략: 상태를 받아 둘 수를 고른다. 난이도별로 구현체를 바꾼다. */
export interface Agent<State, Move> {
  chooseMove(state: State, legal: Move[]): Move | Promise<Move>;
}
