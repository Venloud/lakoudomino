import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import { GameEndSequence } from '@/components/game-end-sequence';
import { ArcadeOnlinePanel } from '@/components/arcade-online-panel';
import { createMopyonState, MOPYON_BOARD_SIZE, playMopyonMove } from '@/lib/mopyon';
import './mopyon.css';

export default function MopyonPage() {
  const [game, setGame] = useState(createMopyonState);
  const [practiceBot, setPracticeBot] = useState(false);
  const [onlineSession, setOnlineSession] = useState<{ seat: number; connected: boolean; turn: number | null } | null>(null);
  const canAct = onlineSession === null || (onlineSession.connected && onlineSession.seat === (game.currentPlayer === 'X' ? 0 : 1));
  const applyRemoteGame = useCallback((state: unknown) => {
    if (state && typeof state === 'object' && Array.isArray((state as typeof game).board)) setGame(state as typeof game);
  }, []);
  const handleRoomChange = useCallback((session: { seat: number; connected: boolean; turn: number | null } | null) => {
    setOnlineSession(session);
    if (session) setPracticeBot(false);
  }, []);
  const winningCells = new Set(game.winningLine ?? []);
  useEffect(() => {
    if (!practiceBot || game.currentPlayer !== 'O' || game.winner || game.isDraw) return;
    const timer = window.setTimeout(() => {
      const candidates = game.board.flatMap((mark, index) => mark ? [] : [index]);
      let choice = candidates[0];
      for (const mark of ['O', 'X'] as const) {
        const winning = candidates.find((index) => {
          const next = playMopyonMove({ ...game, currentPlayer: mark }, Math.floor(index / MOPYON_BOARD_SIZE), index % MOPYON_BOARD_SIZE);
          return next.winner === mark;
        });
        if (winning !== undefined) { choice = winning; break; }
      }
      if (choice !== undefined) setGame((current) => playMopyonMove(current, Math.floor(choice / MOPYON_BOARD_SIZE), choice % MOPYON_BOARD_SIZE));
    }, 380);
    return () => window.clearTimeout(timer);
  }, [game, practiceBot]);

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    {(game.winner || game.isDraw) && <GameEndSequence gameName="Mòpyon" perspective={game.isDraw ? 'draw' : practiceBot ? game.winner === 'X' ? 'winner' : 'opponent' : 'local'} winnerName={game.isDraw ? 'Draw game' : game.winner === 'X' ? 'You · X' : practiceBot ? 'Yard bot · O' : 'Player 2 · O'} opponentName={game.winner === 'X' ? practiceBot ? 'Yard bot · O' : 'Player 2 · O' : 'You · X'} onPlayAgain={() => setGame(createMopyonState())} />}
    <main className="yard-main yard-mopyon-main">
      <Link href="/games" className="yard-mopyon-back"><ArrowLeft size={14} /> All games</Link>
      <div className="yard-heading">
        <div>
          <p className="yard-kicker">509 YARD / NEXT GAME</p>
          <h1>Mòpyon</h1>
          <p className="yard-subtitle">Five in a row. Place your mark on any open intersection.</p>
        </div>
      </div>
      <ArcadeOnlinePanel game="mopyon" turn={game.currentPlayer === 'X' ? 0 : 1} state={game} onRemoteState={applyRemoteGame} onRoomChange={handleRoomChange} />
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '0 0 14px' }} aria-label="Opponent">
        <button type="button" className={`yard-button${!practiceBot ? ' primary' : ''}`} aria-pressed={!practiceBot} disabled={onlineSession !== null} onClick={() => setPracticeBot(false)}>Two players</button>
        <button type="button" className={`yard-button${practiceBot ? ' primary' : ''}`} aria-pressed={practiceBot} disabled={onlineSession !== null} onClick={() => setPracticeBot(true)}>Practice vs bot</button>
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
                  disabled={Boolean(mark || game.winner || game.isDraw || !canAct || (practiceBot && game.currentPlayer === 'O'))}
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
