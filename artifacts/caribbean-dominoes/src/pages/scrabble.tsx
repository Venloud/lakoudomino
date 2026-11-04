import { useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import { GameEndSequence } from '@/components/game-end-sequence';
import { createScrabbleGame, passScrabbleTurn, playScrabbleWord, premiumAt, SCRABBLE_SIZE, type ScrabbleDirection } from '@/lib/scrabble';

const premiumColors = { TW: '#733c35', DW: '#754951', TL: '#355a72', DL: '#3c6252' };

export default function ScrabblePage() {
  const [game, setGame] = useState(createScrabbleGame);
  const [word, setWord] = useState('');
  const [start, setStart] = useState(7 * SCRABBLE_SIZE + 7);
  const [direction, setDirection] = useState<ScrabbleDirection>('horizontal');
  const [message, setMessage] = useState('Start at the center star. Words must connect to the tiles already played.');
  const preview = word.trim().toUpperCase();
  const playerScore = (player: 0 | 1) => game.scores[player];
  const turnLabel = game.winner === null ? `Player ${game.turn + 1} to move` : game.winner === 2 ? 'Draw game' : `Player ${game.winner + 1} wins`;

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
    setMessage(`Word played for ${gained} points.`);
  };

  const handlePass = () => {
    setGame((current) => passScrabbleTurn(current));
    setMessage('Turn passed.');
  };

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    {game.winner !== null && <GameEndSequence gameName="Scrabble" perspective={game.winner === 2 ? 'draw' : 'local'} winnerName={`Player ${game.winner + 1}`} opponentName={`Player ${game.winner === 0 ? 2 : 1}`} score={`Player 1 ${game.scores[0]} · Player 2 ${game.scores[1]}`} onPlayAgain={() => { setGame(createScrabbleGame()); setWord(''); setStart(7 * SCRABBLE_SIZE + 7); setDirection('horizontal'); setMessage('Start at the center star. Words must connect to the tiles already played.'); }} />}
    <main className="yard-main" style={{ maxWidth: 1050 }}>
      <Link href="/games" className="yard-panel-link"><ArrowLeft size={14} /> All games</Link>
      <header className="yard-heading" style={{ marginTop: 16 }}>
        <div><p className="yard-kicker">509 YARD / LOCAL FOUNDATION</p><h1>Scrabble</h1><p className="yard-subtitle">Place connected words, score letter and board bonuses, and outscore your opponent.</p></div>
      </header>
      <section className="yard-panel" style={{ padding: 16, marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <strong role="status">{turnLabel}</strong>
          <button className="yard-button" type="button" onClick={() => { setGame(createScrabbleGame()); setWord(''); setStart(112); setDirection('horizontal'); setMessage('Start at the center star. Words must connect to the tiles already played.'); }}><RotateCcw size={14} /> New game</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginBottom: 12, fontSize: 13 }}>
          <span>Player 1 <b>{playerScore(0)}</b></span><span>Player 2 <b>{playerScore(1)}</b></span><span>Tiles left <b>{game.bag.length}</b></span>
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
          <p style={{ margin: 0, textAlign: 'center', color: '#a6a6aa', fontSize: 12 }}>Player {game.turn + 1} rack: {game.racks[game.turn].map((letter, i) => <b key={`${letter}-${i}`} style={{ display: 'inline-grid', placeItems: 'center', width: 27, height: 30, margin: '0 2px', borderRadius: 4, background: '#e5dfd1', color: '#202124' }}>{letter === '?' ? '☆' : letter}<small style={{ fontSize: 8 }}>{letter === '?' ? 0 : undefined}</small></b>)}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Word <input className="yard-input" value={word} onChange={(event) => setWord(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} maxLength={15} placeholder="e.g. WORD" style={{ width: 150 }} disabled={game.winner !== null} /></label>
            <button type="button" className="yard-button" aria-pressed={direction === 'horizontal'} onClick={() => setDirection('horizontal')}>Across</button>
            <button type="button" className="yard-button" aria-pressed={direction === 'vertical'} onClick={() => setDirection('vertical')}>Down</button>
            <button type="button" className="yard-button primary" onClick={handlePlay} disabled={game.winner !== null}>Play word</button>
            <button type="button" className="yard-button" onClick={handlePass} disabled={game.winner !== null}>Pass</button>
          </div>
          <p role="status" style={{ minHeight: 18, margin: 0, textAlign: 'center', color: '#b7b8b9', fontSize: 12 }}>{message}</p>
          <p style={{ margin: 0, textAlign: 'center', color: '#85878b', fontSize: 11 }}>Local pass-and-play. Starter dictionary; premium squares apply once when a tile is placed.</p>
        </div>
      </section>
    </main>
  </div>;
}

