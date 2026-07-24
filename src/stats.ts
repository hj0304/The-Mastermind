/** 게임별 통산 전적 (vs AI) — localStorage 저장 */

export interface GameRecord {
  wins: number;
  losses: number;
}

const key = (gameId: string) => `mastermind.record.${gameId}`;

export function getRecord(gameId: string): GameRecord {
  try {
    const raw = localStorage.getItem(key(gameId));
    if (raw) {
      const r = JSON.parse(raw) as GameRecord;
      // 손상된 저장값이 NaN으로 누적되는 것 방지
      if (Number.isFinite(r.wins) && Number.isFinite(r.losses)) return r;
    }
  } catch { /* 무시 */ }
  return { wins: 0, losses: 0 };
}

export function recordResult(gameId: string, won: boolean): void {
  try {
    const r = getRecord(gameId);
    if (won) r.wins += 1;
    else r.losses += 1;
    localStorage.setItem(key(gameId), JSON.stringify(r));
  } catch { /* 무시 */ }
}
