import { useState } from 'react';
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
import './App.css';

const STATUS_LABEL: Record<GameMeta['status'], string> = {
  playable: 'PLAY',
  wip: '개발 중',
  planned: 'COMING SOON',
};

function GameCard({ game, onPlay }: { game: GameMeta; onPlay: (id: string) => void }) {
  const locked = game.status === 'planned';
  return (
    <button
      className={`game-card ${locked ? 'locked' : ''}`}
      disabled={locked}
      onClick={() => onPlay(game.id)}
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
      </div>
    </button>
  );
}

export default function App() {
  const [activeGame, setActiveGame] = useState<string | null>(null);

  if (activeGame === 'monochrome') {
    return <MonochromeGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'blind-poker') {
    return <BlindPokerGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'jungle-janggi') {
    return <JungleJanggiGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'number-janggi') {
    return <NumberJanggiGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'quattro') {
    return <QuattroGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'monochrome-2') {
    return <Monochrome2Game onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'monochrome-raise') {
    return <MonochromeRaiseGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'reflect') {
    return <ReflectGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'yut-tactics') {
    return <YutTacticsGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'yut-bluff') {
    return <YutBluffGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'janus-poker') {
    return <JanusPokerGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'dark-maze') {
    return <DarkMazeGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'loop-line') {
    return <LoopLineGame onExit={() => setActiveGame(null)} />;
  }
  if (activeGame === 'hidden-formula') {
    return <HiddenFormulaGame onExit={() => setActiveGame(null)} />;
  }

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>The Mastermind</h1>
        <p>클래식 두뇌게임의 AI 재해석 — 당신을 학습하는 상대와 싸워라</p>
      </header>
      <main className="game-grid">
        {GAMES.map((g) => (
          <GameCard key={g.id} game={g} onPlay={setActiveGame} />
        ))}
      </main>
      <footer className="lobby-footer">
        <p>NAN 2026 사전 과제 출품작 · 1인 개발</p>
      </footer>
    </div>
  );
}
