/** 테마 시스템 — html[data-theme] 속성 + localStorage 저장 */

export interface ThemeMeta {
  id: string;
  name: string;
  icon: string;
}

export const THEMES: ThemeMeta[] = [
  { id: 'midnight', name: '미드나이트', icon: '🌙' },
  { id: 'glass', name: '글래스', icon: '🫧' },
  { id: 'cyber', name: '사이버펑크', icon: '⚡' },
  { id: 'retro', name: '레트로 퓨처', icon: '🚀' },
  { id: 'skeuo', name: '클래식 룸', icon: '🎩' },
];

const KEY = 'mastermind.theme';

export function getTheme(): string {
  try {
    const t = localStorage.getItem(KEY);
    if (t && THEMES.some((th) => th.id === t)) return t;
  } catch { /* 무시 */ }
  return 'midnight';
}

export function setTheme(id: string): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch { /* 무시 */ }
}

/** 앱 렌더 전에 저장된 테마를 적용 (깜빡임 방지) */
export function applyStoredTheme(): void {
  document.documentElement.dataset.theme = getTheme();
}
