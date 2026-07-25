import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { GAMES } from './games/registry.ts';
import type { GameMeta } from './games/registry.ts';
import MonochromeGame from './games/monochrome/MonochromeGame.tsx';
import BlindPokerGame from './games/blind-poker/BlindPokerGame.tsx';
import JungleJanggiGame from './games/jungle-janggi/JungleJanggiGame.tsx';
import NumberJanggiGame from './games/number-janggi/NumberJanggiGame.tsx';
import QuattroGame from './games/quattro/QuattroGame.tsx';
import Monochrome2Game from './games/monochrome2/Monochrome2Game.tsx';
import MonochromeRaiseGame from './games/monochrome-raise/MonochromeRaiseGame.tsx';
import ReflectGame from './games/reflect/ReflectGame.tsx';
import YutTacticsGame from './games/yut-tactics/YutTacticsGame.tsx';
import YutBluffGame from './games/yut-bluff/YutBluffGame.tsx';
import JanusPokerGame from './games/janus-poker/JanusPokerGame.tsx';
import DarkMazeGame from './games/dark-maze/DarkMazeGame.tsx';
import LoopLineGame from './games/loop-line/LoopLineGame.tsx';
import HiddenFormulaGame from './games/hidden-formula/HiddenFormulaGame.tsx';
import { getRecord } from './stats.ts';
import { RuleBookButton } from './games/shared/RuleBook.tsx';
import { THEMES, getTheme, setTheme } from './theme.ts';
import type { GameGenre } from './games/registry.ts';
import { canClaimDaily, claimDaily, getDaily, levelInfo, totalRecord, wallet } from './lobby-data.ts';
import './App.css';

function ThemeSwitch() {
  const [active, setActive] = useState(getTheme);
  return (
    <div className="theme-switch">
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={t.id === active ? 'active' : ''}
          onClick={() => {
            setTheme(t.id);
            setActive(t.id);
          }}
        >
          <span>{t.icon}</span> {t.name}
        </button>
      ))}
    </div>
  );
}

const STATUS_LABEL: Record<GameMeta['status'], string> = {
  playable: 'PLAY',
  wip: '개발 중',
  planned: 'COMING SOON',
};

/** 프로필 카드 + 재화 — 전부 로컬 플레이 기록에서 유도된 값 */
function ProfileBar({ daily }: { daily: ReturnType<typeof getDaily> }) {
  const totals = totalRecord();
  const lv = levelInfo(totals);
  const w = wallet(totals, daily);
  return (
    <div className="lb-profile-row">
      <div className="lb-profile">
        <div className="lb-avatar">
          M<span className="lb-lv">{lv.level}</span>
        </div>
        <div className="lb-profile-info">
          <div className="lb-nick">
            전략가 <span className="lb-record-mini">{totals.wins}승 {totals.losses}패</span>
          </div>
          <div className="lb-xp-row">
            <div className="lb-xp-bar"><div style={{ width: `${Math.round(lv.progress * 100)}%` }} /></div>
            <span className="lb-xp-label">{lv.xp}/{lv.next} XP</span>
          </div>
        </div>
      </div>
      <div className="lb-currencies">
        <div className="lb-cur coin">◎ {w.coins.toLocaleString()}</div>
        <div className="lb-cur gem">◆ {w.gems}</div>
      </div>
    </div>
  );
}

/** 빠른 대전 — 플레이 가능한 게임 중 하나로 즉시 진입 */
function QuickMatch({ onPlay }: { onPlay: (id: string) => void }) {
  const pick = () => {
    const playable = GAMES.filter((g) => g.status === 'playable');
    onPlay(playable[Math.floor(Math.random() * playable.length)].id);
  };
  return (
    <div className="lb-quick" role="button" onClick={pick}>
      <div className="lb-quick-shine" />
      <div className="lb-quick-body">
        <div>
          <span className="lb-extreme">EXTREME AI</span>
          <div className="lb-quick-title">빠른 대전</div>
          <div className="lb-quick-sub">랜덤 게임에서 당신을 학습하는 상대와 즉시 대결</div>
        </div>
        <div className="lb-quick-play">▶</div>
      </div>
    </div>
  );
}

/** 오늘의 보상 — 연속 접속 스트릭 (localStorage) */
function DailyReward({ daily, onClaim }: { daily: ReturnType<typeof getDaily>; onClaim: () => void }) {
  const claimable = canClaimDaily(daily);
  return (
    <div className="lb-daily" id="daily-reward">
      <span className="lb-daily-icon">🎁</span>
      <div className="lb-daily-info">
        <div className="lb-daily-title">오늘의 보상</div>
        <div className="lb-streak">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className={`lb-streak-cell ${i <= daily.streak ? 'on' : ''}`} />
          ))}
        </div>
      </div>
      <button className={`lb-claim ${claimable ? '' : 'done'}`} disabled={!claimable} onClick={onClaim}>
        {claimable ? `+${100 * Math.min(7, daily.last === new Date(Date.now() - 86400000).toISOString().slice(0, 10) ? daily.streak + 1 : 1)}◎ 받기` : '수령완료'}
      </button>
    </div>
  );
}

type Filter = 'all' | GameGenre | 'hot';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'board', label: '보드 전략' },
  { key: 'card', label: '카드' },
  { key: 'mind', label: '심리·추리' },
  { key: 'hot', label: '🔥 인기' },
];

function matchFilter(g: GameMeta, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'hot') return !!g.hot;
  return g.genre === f;
}

/** 하단 네비게이션 — 홈/리더보드/상점/보상/설정 */
function BottomNav({ onOpen }: { onOpen: (panel: string) => void }) {
  const items = [
    { key: 'home', label: '홈', icon: '⌂' },
    { key: 'rank', label: '리더보드', icon: '📊' },
    { key: 'shop', label: '상점', icon: '🛍️' },
    { key: 'reward', label: '보상', icon: '🎁' },
    { key: 'settings', label: '설정', icon: '⚙️' },
  ];
  return (
    <nav className="lb-nav">
      {items.map((it) => (
        <button key={it.key} onClick={() => onOpen(it.key)}>
          <span className="lb-nav-icon">{it.icon}</span>
          <span className="lb-nav-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** 리더보드 — 게임별 통산 전적 (로컬 기록) */
function RankPanel() {
  const rows = GAMES.map((g) => ({ g, r: getRecord(g.id) }))
    .filter((x) => x.r.wins + x.r.losses > 0)
    .sort((a, b) => b.r.wins + b.r.losses - (a.r.wins + a.r.losses));
  const t = totalRecord();
  return (
    <>
      <h3>📊 내 전적</h3>
      {rows.length === 0 ? (
        <p className="lb-panel-dim">아직 기록이 없습니다 — 첫 판을 시작해 보세요!</p>
      ) : (
        <div className="lb-rank-list">
          {rows.map(({ g, r }) => (
            <div key={g.id} className="lb-rank-row">
              <span className="lb-rank-name">{g.icon} {g.name}</span>
              <span className="lb-rank-rec">
                <b>{r.wins}</b>승 {r.losses}패
                <span className="lb-rank-rate"> {Math.round((r.wins / (r.wins + r.losses)) * 100)}%</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="lb-rank-total">통산 <b>{t.wins}승 {t.losses}패</b> · EXTREME AI 상대</p>
    </>
  );
}

function SettingsPanel({ onReset }: { onReset: () => void }) {
  return (
    <>
      <h3>⚙️ 설정</h3>
      <p className="lb-panel-dim">테마</p>
      <ThemeSwitch />
      <button className="lb-danger-btn" onClick={onReset}>전적·학습 데이터 초기화</button>
    </>
  );
}

function GameCard({ game, onPlay }: { game: GameMeta; onPlay: (id: string) => void }) {
  const locked = game.status === 'planned';
  return (
    <div
      className={`game-card ${locked ? 'locked' : ''}`}
      role="button"
      tabIndex={locked ? -1 : 0}
      onClick={() => !locked && onPlay(game.id)}
      onKeyDown={(e) => {
        if (!locked && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onPlay(game.id);
        }
      }}
    >
      <div className="game-card-head">
        <h3><span className="game-icon">{game.icon}</span> {game.name}</h3>
        <span className={`badge ${game.hot && game.status === 'playable' ? 'badge-hot' : `badge-${game.status}`}`}>
          {game.hot && game.status === 'playable' ? 'HOT' : STATUS_LABEL[game.status]}
        </span>
      </div>
      <p className="tagline">{game.tagline}</p>
      <div className="modes">
        {game.solo && <span className="mode">🤖 AI 대전</span>}
        {game.multi && <span className="mode">⚔️ 멀티플레이</span>}
        <span className="mode players">{game.minPlayers === game.maxPlayers ? `${game.minPlayers}인` : `${game.minPlayers}~${game.maxPlayers}인`}</span>
        {game.status === 'playable' && (() => {
          const r = getRecord(game.id);
          return r.wins + r.losses > 0 ? (
            <span className="mode record">{r.wins}승 {r.losses}패</span>
          ) : null;
        })()}
        {game.status !== 'planned' && (
          <RuleBookButton gameId={game.id} gameName={game.name} className="mode rb-card-btn" />
        )}
      </div>
    </div>
  );
}

const GAME_COMPONENTS: Record<string, ComponentType<{ onExit: () => void }>> = {
  'monochrome': MonochromeGame,
  'blind-poker': BlindPokerGame,
  'jungle-janggi': JungleJanggiGame,
  'number-janggi': NumberJanggiGame,
  'quattro': QuattroGame,
  'monochrome-2': Monochrome2Game,
  'monochrome-raise': MonochromeRaiseGame,
  'reflect': ReflectGame,
  'yut-tactics': YutTacticsGame,
  'yut-bluff': YutBluffGame,
  'janus-poker': JanusPokerGame,
  'dark-maze': DarkMazeGame,
  'loop-line': LoopLineGame,
  'hidden-formula': HiddenFormulaGame,
};

/** URL 해시(#/game-id)에서 게임 id 추출 — 뒤로가기/새로고침/딥링크 지원 */
function gameFromHash(): string | null {
  const id = window.location.hash.replace(/^#\/?/, '');
  return id in GAME_COMPONENTS ? id : null;
}

export default function App() {
  const [activeGame, setActiveGame] = useState<string | null>(gameFromHash);
  const [filter, setFilter] = useState<Filter>('all');
  const [panel, setPanel] = useState<string | null>(null);
  const [daily, setDaily] = useState(getDaily);

  useEffect(() => {
    const onHashChange = () => setActiveGame(gameFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const ActiveGame = activeGame ? GAME_COMPONENTS[activeGame] : null;
  if (ActiveGame) {
    return <ActiveGame onExit={() => { window.location.hash = ''; }} />;
  }

  const openGame = (id: string) => { window.location.hash = `#/${id}`; };
  const shown = GAMES.filter((g) => matchFilter(g, filter));

  const onNav = (key: string) => {
    if (key === 'home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (key === 'reward') {
      document.getElementById('daily-reward')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setPanel(key);
  };

  const resetData = () => {
    if (!window.confirm('모든 전적과 AI 학습 데이터를 초기화할까요?')) return;
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('mastermind.')) localStorage.removeItem(k);
      }
    } catch { /* 무시 */ }
    window.location.reload();
  };

  return (
    <div className="lobby">
      <ProfileBar daily={daily} />
      <header className="lobby-header">
        <h1>The Mastermind</h1>
        <p>클래식 두뇌게임의 AI 재해석 — 당신을 학습하는 상대와 싸워라</p>
        <div className="lobby-stats">
          <span>🎮 14개 게임</span>
          <span>🧠 단일 난이도 — EXTREME AI</span>
          <span>⚔️ 온라인 멀티플레이</span>
          <span>📱 설치 없이 바로 플레이</span>
        </div>
        <ThemeSwitch />
      </header>

      <div className="lb-cta-row">
        <QuickMatch onPlay={openGame} />
        <DailyReward daily={daily} onClaim={() => setDaily(claimDaily())} />
      </div>

      <div className="lb-games-head">
        <h2>게임 선택</h2>
        <span className="lb-count">{shown.length} / {GAMES.length}</span>
      </div>
      <div className="lb-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`lb-filter ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <main className="game-grid">
        {shown.map((g) => (
          <GameCard key={g.id} game={g} onPlay={openGame} />
        ))}
      </main>
      <footer className="lobby-footer">
        <p>NAN 2026 사전 과제 출품작 · 1인 개발</p>
      </footer>

      <BottomNav onOpen={onNav} />

      {panel !== null && (
        <div className="lb-panel-overlay" onClick={() => setPanel(null)}>
          <div className="lb-panel" onClick={(e) => e.stopPropagation()}>
            {panel === 'rank' && <RankPanel />}
            {panel === 'shop' && (
              <>
                <h3>🛍️ 상점</h3>
                <p className="lb-panel-dim">
                  준비 중입니다 — 지금은 모든 테마가 무료로 열려 있습니다. 설정에서 골라보세요!
                </p>
              </>
            )}
            {panel === 'settings' && <SettingsPanel onReset={resetData} />}
            <button className="lb-panel-close" onClick={() => setPanel(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
