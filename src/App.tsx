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
import './App.css';

const STATUS_LABEL: Record<GameMeta['status'], string> = {
  playable: 'PLAY',
  wip: '개발 중',
  planned: 'COMING SOON',
};

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
        <h3>{game.name}</h3>
        <span className={`badge badge-${game.status}`}>{STATUS_LABEL[game.status]}</span>
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

  useEffect(() => {
    const onHashChange = () => setActiveGame(gameFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const ActiveGame = activeGame ? GAME_COMPONENTS[activeGame] : null;
  if (ActiveGame) {
    return <ActiveGame onExit={() => { window.location.hash = ''; }} />;
  }

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>The Mastermind</h1>
        <p>클래식 두뇌게임의 AI 재해석 — 당신을 학습하는 상대와 싸워라</p>
      </header>
      <main className="game-grid">
        {GAMES.map((g) => (
          <GameCard key={g.id} game={g} onPlay={(id) => { window.location.hash = `#/${id}`; }} />
        ))}
      </main>
      <footer className="lobby-footer">
        <p>NAN 2026 사전 과제 출품작 · 1인 개발</p>
      </footer>
    </div>
  );
}
