import { useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import {
  createTicTacToeState,
  createYardTicTacToeState,
  playTicTacToeMove,
  playYardTicTacToeMove,
  type TicTacToeMode,
} from '@/lib/tic-tac-toe';
import './tic-tac-toe.css';

export default function TicTacToePage() {
  const [mode, setMode] = useState<TicTacToeMode>('regular');
  const [regularGame, setRegularGame] = useState(createTicTacToeState);
  const [yardGame, setYardGame] = useState(createYardTicTacToeState);
  const game = mode === 'regular' ? regularGame : yardGame;
  const finished = Boolean(game.winner || game.isDraw);
  const setActiveMode = (nextMode: TicTacToeMode) => {
    setMode(nextMode);
    if (nextMode === 'regular') setRegularGame(createTicTacToeState());
    else setYardGame(createYardTicTacToeState());
  };

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    <main className={`yard-main yard-tic-main${mode === 'yard' ? ' is-yard-mode' : ''}`}>
      <Link href="/games" className="yard-tic-back"><ArrowLeft size={14} /> All games</Link>
      <div className="yard-heading">
        <div><p className="yard-kicker">509 YARD / NEXT GAME</p><h1>Tic-Tac-Toe</h1><p className="yard-subtitle">Choose a mode and take your turn.</p></div>
      </div>
      <div className="yard-tic-mode-picker" role="group" aria-label="Game mode">
        <button type="button" aria-pressed={mode === 'regular'} className={mode === 'regular' ? 'is-selected' : ''} onClick={() => setActiveMode('regular')}>
          <b>Regular</b><span>Classic 3 × 3</span>
        </button>
        <button type="button" aria-pressed={mode === 'yard'} className={mode === 'yard' ? 'is-selected' : ''} onClick={() => setActiveMode('yard')}>
          <b>Yard Mode</b><span>Nine grids in one</span>
        </button>
      </div>
      <div className="yard-tic-layout">
        <section className="yard-tic-board-card" aria-label="Tic-Tac-Toe game">
          <p className="yard-tic-status" role="status" aria-live="polite">
            {game.winner ? <><strong>{game.winner}</strong> wins this round</> : game.isDraw ? "It's a draw" : <><strong>{game.currentPlayer}</strong>'s turn</>}
            {mode === 'yard' && !finished && <span>{yardGame.nextBoard === null ? ' · Choose any open grid' : ` · Play in grid ${yardGame.nextBoard + 1}`}</span>}
          </p>
          {mode === 'regular'
            ? <div className="yard-tic-board" role="grid" aria-label="Tic-Tac-Toe board">
              {regularGame.board.map((mark, index) => <button
                key={index}
                type="button"
                className="yard-tic-cell"
                data-mark={mark ?? undefined}
                role="gridcell"
                aria-label={`Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}${mark ? `, ${mark}` : ', empty'}`}
                disabled={Boolean(mark || regularGame.winner || regularGame.isDraw)}
                onClick={() => setRegularGame((current) => playTicTacToeMove(current, index))}
              >{mark}</button>)}
            </div>
            : <div className="yard-ultimate-scroll">
              <div className="yard-ultimate-board" role="grid" aria-label="Yard Mode: nine Tic-Tac-Toe grids">
                {yardGame.boards.map((board, boardIndex) => {
                  const result = yardGame.gridResults[boardIndex];
                  const isTarget = yardGame.nextBoard === null || yardGame.nextBoard === boardIndex;
                  return <div
                    key={boardIndex}
                    className={`yard-ultimate-mini${isTarget && !result && !finished ? ' is-target' : ''}${!isTarget && !result && !finished ? ' is-locked' : ''}${result ? ' is-resolved' : ''}`}
                    role="group"
                    aria-label={`Small grid ${boardIndex + 1}${result ? `, ${result === 'draw' ? 'draw' : `${result} won`}` : ''}`}
                  >
                    {board.map((mark, cellIndex) => <button
                      key={cellIndex}
                      type="button"
                      className="yard-ultimate-cell"
                      data-mark={mark ?? undefined}
                      aria-label={`Grid ${boardIndex + 1}, row ${Math.floor(cellIndex / 3) + 1}, column ${(cellIndex % 3) + 1}${mark ? `, ${mark}` : ', empty'}`}
                      disabled={Boolean(result || !isTarget || finished || mark)}
                      onClick={() => setYardGame((current) => playYardTicTacToeMove(current, boardIndex, cellIndex))}
                    >{mark}</button>)}
                    {result && <span className={`yard-ultimate-result${result === 'draw' ? ' is-draw' : ''}`} aria-hidden="true">{result === 'draw' ? '—' : result}</span>}
                  </div>;
                })}
              </div>
            </div>}
          <div className="yard-tic-actions">
            <button type="button" className="yard-button" onClick={() => mode === 'regular' ? setRegularGame(createTicTacToeState()) : setYardGame(createYardTicTacToeState())}><RotateCcw size={14} /> New round</button>
          </div>
        </section>
        <aside className="yard-tic-info">
          <h2>{mode === 'regular' ? 'Regular mode' : 'Yard Mode'}</h2>
          <p>{mode === 'regular'
            ? 'Two players share this screen. X starts; take turns marking a square. First to line up three wins.'
            : 'Win small grids to claim their matching space on the big board. Your move sends your opponent to the small grid in the same position.'}</p>
          {mode === 'yard' && <p className="yard-tic-rule-note">If your move sends the other player to a grid that is already won or full, they may choose any open grid.</p>}
          <div className="yard-tic-players">
            <div className={`yard-tic-player${!finished && game.currentPlayer === 'X' ? ' is-active' : ''}`}><b>X</b> Player one</div>
            <div className={`yard-tic-player${!finished && game.currentPlayer === 'O' ? ' is-active' : ''}`}><b>O</b> Player two</div>
          </div>
          <small className="yard-tic-note">Local pass-and-play. Online rooms, invites, and match history can be added as the game grows.</small>
        </aside>
      </div>
    </main>
  </div>;
}
