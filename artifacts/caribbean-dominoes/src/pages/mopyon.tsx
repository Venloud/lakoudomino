import { useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import { createMopyonState, MOPYON_BOARD_SIZE, playMopyonMove } from '@/lib/mopyon';
import './mopyon.css';

export default function MopyonPage() {
  const [game, setGame] = useState(createMopyonState);
  const winningCells = new Set(game.winningLine ?? []);

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    <main className="yard-main yard-mopyon-main">
      <Link href="/games" className="yard-mopyon-back"><ArrowLeft size={14} /> All games</Link>
      <div className="yard-heading">
        <div>
          <p className="yard-kicker">509 YARD / NEXT GAME</p>
          <h1>Mòpyon</h1>
          <p className="yard-subtitle">Five in a row. Place your mark on any open intersection.</p>
        </div>
      </div>
      <div className="yard-mopyon-layout">
        <section className="yard-mopyon-board-card" aria-label="Mòpyon game">
          <p className="yard-mopyon-status" role="status" aria-live="polite">
            {game.winner ? <><strong>{game.winner}</strong> wins with five in a row</> : game.isDraw ? "The board is full — it's a draw" : <><strong>{game.currentPlayer}</strong>'s turn</>}
          </p>
          <div className="yard-mopyon-scroll">
            <div className="yard-mopyon-board" role="group" aria-label="Mòpyon 15 by 15 intersection board">
              {game.board.map((mark, index) => {
                const row = Math.floor(index / MOPYON_BOARD_SIZE);
                const column = index % MOPYON_BOARD_SIZE;
                return <button
                  key={index}
                  type="button"
                  className={`yard-mopyon-point${winningCells.has(index) ? ' is-winning' : ''}${game.lastMove === index ? ' is-last-move' : ''}`}
                  data-mark={mark ?? undefined}
                  aria-label={`Row ${row + 1}, column ${column + 1}${mark ? `, ${mark}` : ', empty intersection'}`}
                  disabled={Boolean(mark || game.winner || game.isDraw)}
                  onClick={() => setGame((current) => playMopyonMove(current, row, column))}
                >{mark && <span aria-hidden="true">{mark}</span>}</button>;
              })}
            </div>
          </div>
          <div className="yard-mopyon-actions">
            <span>15 × 15 intersections</span>
            <button type="button" className="yard-button" onClick={() => setGame(createMopyonState())}><RotateCcw size={14} /> New game</button>
          </div>
        </section>
        <aside className="yard-mopyon-info">
          <h2>How to play</h2>
          <p>Two players take turns placing a mark at any open crossing. First to connect five marks wins.</p>
          <ul>
            <li>Lines can go horizontal, vertical, or diagonal.</li>
            <li>Marks stay on the board once placed.</li>
            <li>X starts. O takes the next turn.</li>
          </ul>
          <div className="yard-mopyon-players">
            <div className={`yard-tic-player${!game.winner && !game.isDraw && game.currentPlayer === 'X' ? ' is-active' : ''}`}><b>X</b> Player one</div>
            <div className={`yard-tic-player${!game.winner && !game.isDraw && game.currentPlayer === 'O' ? ' is-active' : ''}`}><b>O</b> Player two</div>
          </div>
          <small>Local pass-and-play. Online rooms and invites can be added later.</small>
        </aside>
      </div>
    </main>
  </div>;
}
