import { useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import { GameEndSequence } from '@/components/game-end-sequence';
import { createScrabbleGame, exchangeScrabbleTiles, passScrabbleTurn, playScrabbleWord, premiumAt, SCRABBLE_SIZE, type ScrabbleDirection } from '@/lib/scrabble';

const premiumColors = { TW: '#733c35', DW: '#754951', TL: '#355a72', DL: '#3c6252' };

export default function ScrabblePage() {
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  const [game, setGame] = useState(() => createScrabbleGame());
  const [word, setWord] = useState('');
  const [start, setStart] = useState(7 * SCRABBLE_SIZE + 7);
  const [direction, setDirection] = useState<ScrabbleDirection>('horizontal');
  const [message, setMessage] = useState('Start at the center star. Words must connect to the tiles already played.');
  const [selectedRackTiles, setSelectedRackTiles] = useState<number[]>([]);
  const preview = word.trim().toUpperCase();
  const turnLabel = game.winner === null ? `Player ${game.turn + 1} to move` : game.winner === 'draw' ? 'Draw game' : `Player ${game.winner + 1} wins`;
  const newGame = (count = playerCount) => {
    setPlayerCount(count as 2 | 3 | 4);
    setGame(createScrabbleGame(Math.random, count as 2 | 3 | 4));
    setWord('');
    setStart(7 * SCRABBLE_SIZE + 7);
    setDirection('horizontal');
    setSelectedRackTiles([]);
    setMessage('Start at the center star. Words must connect to the tiles already played.');
  };

  const handlePlay = () => {
    const result = playScrabbleWord(game, {
      word: preview,
      row: Math.floor(start / SCRABBLE_SIZE),
      col: start % SCRABBLE_SIZE,
      direction,
    });
    if (!result.game) { setMessage(result.error); return; }
    const gained = result.game.scores[game.turn] - game.scores[game.turn];
    setGame(result.game);
    setWord('');
    setSelectedRackTiles([]);
    setMessage(`Word played for ${gained} points.`);
  };

  const handlePass = () => {
    setGame((current) => passScrabbleTurn(current));
    setSelectedRackTiles([]);
    setMessage('Turn passed.');
  };
  const handleExchange = () => {
    const tiles = selectedRackTiles.map((index) => game.racks[game.turn][index]).filter(Boolean);
    const result = exchangeScrabbleTiles(game, tiles);
    if (!result.game) { setMessage(result.error); return; }
    setGame(result.game);
    setSelectedRackTiles([]);
    setMessage(`${tiles.length} tile${tiles.length === 1 ? '' : 's'} exchanged. Turn passed.`);
  };

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    {game.winner !== null && <GameEndSequence gameName="Scrabble" perspective={game.winner === 'draw' ? 'draw' : 'local'} winnerName={game.winner === 'draw' ? 'Draw game' : `Player ${game.winner + 1}`} opponentName="Your opponents" score={game.scores.map((score, index) => `Player ${index + 1} ${score}`).join(' · ')} onPlayAgain={() => newGame()} />}
    <main className="yard-main" style={{ maxWidth: 1050 }}>
      <Link href="/games" className="yard-panel-link"><ArrowLeft size={14} /> All games</Link>
      <header className="yard-heading" style={{ marginTop: 16 }}>
         <div><p className="yard-kicker">509 YARD / LOCAL FOUNDATION</p><h1>Scrabble</h1><p className="yard-subtitle">Play connected words for 2–4 players, score bonuses, exchange tiles, and finish with the highest score.</p></div>
      </header>
      <section className="yard-panel" style={{ padding: 16, marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <strong role="status">{turnLabel}</strong>
           <button className="yard-button" type="button" onClick={() => newGame()}><RotateCcw size={14} /> New game</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12, fontSize: 13 }}>
          <span>Players</span>{([2, 3, 4] as const).map((count) => <button key={count} type="button" className="yard-button" aria-pressed={playerCount === count} onClick={() => newGame(count)}>{count}</button>)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 18, marginBottom: 12, fontSize: 13 }}>
          {game.scores.map((score, index) => <span key={index} aria-current={game.turn === index ? 'step' : undefined}>Player {index + 1} <b>{score}</b></span>)}<span>Tiles left <b>{game.bag.length}</b></span>
        </div>
        <div role="grid" aria-label="Scrabble board" className="yard-scrabble-board" style={{ display: 'grid', gridTemplateColumns: `repeat(${SCRABBLE_SIZE}, minmax(0,1fr))`, gap: 2, width: 'min(100%, 660px)', margin: '0 auto', padding: 5, borderRadius: 8, background: '#0e1112' }}>
          {game.board.map((tile, index) => {
            const row = Math.floor(index / SCRABBLE_SIZE), col = index % SCRABBLE_SIZE;
            const previewOffset = direction === 'horizontal' ? col - (start % SCRABBLE_SIZE) : row - Math.floor(start / SCRABBLE_SIZE);
            const inPreview = previewOffset >= 0 && previewOffset < preview.length
              && (direction === 'horizontal' ? row === Math.floor(start / SCRABBLE_SIZE) : col === start % SCRABBLE_SIZE);
            const premium = premiumAt(row, col);
            const letter = tile?.letter ?? (inPreview ? preview[previewOffset] : '');
            const isSelected = index === start;
            return <button
              key={index}
              type="button"
              role="gridcell"
              aria-label={`${tile ? `${tile.letter}, ` : ''}row ${row + 1}, column ${col + 1}${premium ? `, ${premium}` : ''}`}
              onClick={() => setStart(index)}
              style={{
                position: 'relative', display: 'grid', placeItems: 'center', minWidth: 0, aspectRatio: '1',
                padding: 0, border: isSelected ? '2px solid #75d64b' : '1px solid #29302d',
                borderRadius: 2, color: '#f7f5eb', background: tile ? '#d9d4c7' : premium ? premiumColors[premium] : '#344239',
                fontSize: 'clamp(7px, 1.3vw, 13px)', fontWeight: 800, cursor: 'pointer',
              }}
            >
              {letter && <span style={{ color: tile ? '#1c1d1e' : '#fff' }}>{letter}</span>}
              {!letter && premium && <span style={{ fontSize: 'clamp(5px, .75vw, 8px)' }}>{premium}</span>}
              {tile && <small style={{ position: 'absolute', right: 1, bottom: 0, color: '#26272a', fontSize: 'clamp(5px, .55vw, 7px)', lineHeight: 1 }}>{tile.points}</small>}
            </button>;
          })}
        </div>
        <div style={{ maxWidth: 660, margin: '14px auto 0', display: 'grid', gap: 12 }}>
          <div style={{ margin: 0, textAlign: 'center', color: '#a6a6aa', fontSize: 12 }}>Player {game.turn + 1} rack: {game.racks[game.turn].map((letter, i) => <button type="button" key={`${letter}-${i}`} aria-pressed={selectedRackTiles.includes(i)} onClick={() => setSelectedRackTiles((current) => current.includes(i) ? current.filter((index) => index !== i) : [...current, i])} style={{ display: 'inline-grid', placeItems: 'center', width: 32, height: 36, margin: '0 2px', borderRadius: 4, border: selectedRackTiles.includes(i) ? '2px solid #75d64b' : '1px solid #9e947f', background: '#e5dfd1', color: '#202124' }}>{letter === '?' ? '☆' : letter}<small style={{ fontSize: 8 }}>{letter === '?' ? 0 : undefined}</small></button>)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Word <input className="yard-input" value={word} onChange={(event) => setWord(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} maxLength={15} placeholder="e.g. WORD" style={{ width: 150 }} disabled={game.winner !== null} /></label>
            <button type="button" className="yard-button" aria-pressed={direction === 'horizontal'} onClick={() => setDirection('horizontal')}>Across</button>
            <button type="button" className="yard-button" aria-pressed={direction === 'vertical'} onClick={() => setDirection('vertical')}>Down</button>
            <button type="button" className="yard-button primary" onClick={handlePlay} disabled={game.winner !== null}>Play word</button>
            <button type="button" className="yard-button" onClick={handleExchange} disabled={game.winner !== null || selectedRackTiles.length === 0 || game.bag.length < 7}>Exchange selected</button>
            <button type="button" className="yard-button" onClick={handlePass} disabled={game.winner !== null}>Pass</button>
          </div>
          <p role="status" style={{ minHeight: 18, margin: 0, textAlign: 'center', color: '#b7b8b9', fontSize: 12 }}>{message}</p>
          <p style={{ margin: 0, textAlign: 'center', color: '#85878b', fontSize: 11 }}>Local pass-and-play. Starter dictionary; premium squares apply once when a tile is placed.</p>
        </div>
      </section>
    </main>
  </div>;
}

