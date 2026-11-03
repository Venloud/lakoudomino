import { useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import { createTicTacToeState, playTicTacToeMove } from '@/lib/tic-tac-toe';
import './tic-tac-toe.css';

export default function TicTacToePage() {
  const [game, setGame] = useState(createTicTacToeState);
  const status = game.winner
    ? `${game.winner} wins this round`
    : game.isDraw
      ? "It's a draw"
      : `${game.currentPlayer}'s turn`;

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    <main className="yard-main yard-tic-main">
      <Link href="/games" className="yard-tic-back"><ArrowLeft size={14} /> All games</Link>
      <div className="yard-heading">
        <div><p className="yard-kicker">509 YARD / NEXT GAME</p><h1>Tic-Tac-Toe</h1><p className="yard-subtitle">A quick game, right here in the yard.</p></div>
      </div>
      <div className="yard-tic-layout">
        <section className="yard-tic-board-card" aria-label="Tic-Tac-Toe game">
          <p className="yard-tic-status" role="status" aria-live="polite">
            {game.winner ? <><strong>{game.winner}</strong> wins this round</> : game.isDraw ? "It's a draw" : <><strong>{game.currentPlayer}</strong>'s turn</>}
          </p>
          <div className="yard-tic-board" role="grid" aria-label="Tic-Tac-Toe board">
            {game.board.map((mark, index) => {
              const row = Math.floor(index / 3) + 1;
              const column = (index % 3) + 1;
              return <button
                key={index}
                type="button"
                className="yard-tic-cell"
                data-mark={mark ?? undefined}
                role="gridcell"
                aria-label={`Row ${row}, column ${column}${mark ? `, ${mark}` : ', empty'}`}
                disabled={Boolean(mark || game.winner || game.isDraw)}
                onClick={() => setGame((current) => playTicTacToeMove(current, index))}
              >{mark}</button>;
            })}
          </div>
          <div className="yard-tic-actions">
            <button type="button" className="yard-button" onClick={() => setGame(createTicTacToeState())}><RotateCcw size={14} /> New round</button>
          </div>
        </section>
        <aside className="yard-tic-info">
          <h2>Pass and play</h2>
          <p>Two players share this screen. X starts; take turns marking a square. First to line up three wins.</p>
          <div className="yard-tic-players">
            <div className={`yard-tic-player${!game.winner && !game.isDraw && game.currentPlayer === 'X' ? ' is-active' : ''}`}><b>X</b> Player one</div>
            <div className={`yard-tic-player${!game.winner && !game.isDraw && game.currentPlayer === 'O' ? ' is-active' : ''}`}><b>O</b> Player two</div>
          </div>
          <small className="yard-tic-note">Local starter only. Online rooms, invites, and match history can be added as the game grows.</small>
        </aside>
      </div>
    </main>
  </div>;
}
