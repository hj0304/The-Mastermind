/**
 * 로비 표시용 파생 데이터 — 전부 로컬 플레이 기록에서 유도한다.
 * 레벨·XP·코인·젬은 서버 없는 데모 경제: 실제 승패 기록(stats.ts)과
 * 일일 보상 수령 기록(localStorage)에서 계산된다.
 */

import { GAMES } from './games/registry.ts';
import { getRecord } from './stats.ts';

export interface Totals {
  wins: number;
  losses: number;
}

export function totalRecord(): Totals {
  let wins = 0;
  let losses = 0;
  for (const g of GAMES) {
    const r = getRecord(g.id);
    wins += r.wins;
    losses += r.losses;
  }
  return { wins, losses };
}

/** 레벨 = 판수 기반 완만한 성장 곡선, XP 진행도는 다음 레벨까지의 비율 */
export function levelInfo(t: Totals): { level: number; progress: number; xp: number; next: number } {
  const xp = t.wins * 120 + t.losses * 45;
  const level = 1 + Math.floor(Math.sqrt(xp / 90));
  const cur = 90 * (level - 1) * (level - 1);
  const next = 90 * level * level;
  const progress = next === cur ? 0 : (xp - cur) / (next - cur);
  return { level, progress: Math.min(1, Math.max(0, progress)), xp, next };
}

// ---------- 일일 보상 ----------

export interface Daily {
  /** 연속 수령 일수 (1~7) */
  streak: number;
  /** 마지막 수령일 YYYY-MM-DD */
  last: string;
  /** 누적 보너스 코인 */
  bonus: number;
}

const DAILY_KEY = 'mastermind.daily';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

export function getDaily(): Daily {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Daily;
      if (Number.isFinite(d.streak) && Number.isFinite(d.bonus) && typeof d.last === 'string') return d;
    }
  } catch { /* 무시 */ }
  return { streak: 0, last: '', bonus: 0 };
}

export function canClaimDaily(d: Daily): boolean {
  return d.last !== today();
}

/** 오늘 보상 수령 — 어제도 받았으면 연속 증가(최대 7), 아니면 1부터 */
export function claimDaily(): Daily {
  const d = getDaily();
  if (!canClaimDaily(d)) return d;
  const streak = d.last === yesterday() ? Math.min(7, d.streak + 1) : 1;
  const next: Daily = { streak, last: today(), bonus: d.bonus + 100 * streak };
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(next));
  } catch { /* 무시 */ }
  return next;
}

/** 코인 = 플레이 기록 + 일일 보상 누적, 젬 = 승리에서만 */
export function wallet(t: Totals, d: Daily): { coins: number; gems: number } {
  return { coins: 500 + t.wins * 120 + t.losses * 30 + d.bonus, gems: t.wins * 2 };
}
