import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pause, Play, RotateCcw, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import {
  BLOCK_DROP_COLUMNS,
  BLOCK_DROP_ROWS,
  createBlockDropState,
  getBlockDropShape,
  hardDropBlockDrop,
  moveBlockDrop,
  rotateBlockDrop,
  tickBlockDrop,
  toggleBlockDropPause,
  type BlockDropCell,
  type BlockDropState,
} from '@/lib/block-drop';
import './block-drop.css';

const PIECE_COLORS: Record<Exclude<BlockDropCell, null>, string> = {
  I: 'piece-i',
  O: 'piece-o',
  T: 'piece-t',
  J: 'piece-j',
  L: 'piece-l',
  S: 'piece-s',
  Z: 'piece-z',
};

function getVisibleBoard(game: BlockDropState): BlockDropCell[][] {
  const board = game.board.map((row) => [...row]);
  if (!game.active) return board;
  const shape = getBlockDropShape(game.active);
  shape.cells.forEach((row, r) => [...row].forEach((cell, c) => {
    const boardRow = game.active!.y + r;
    const boardColumn = game.active!.x + c;
    if (cell === '#' && boardRow >= 0 && boardRow < BLOCK_DROP_ROWS && boardColumn >= 0 && boardColumn < BLOCK_DROP_COLUMNS) {
      board[boardRow][boardColumn] = game.active!.type;
    }
  }));
  return board;
}

export default function BlockDropPage() {
  const [game, setGame] = useState(createBlockDropState);
  const visibleBoard = useMemo(() => getVisibleBoard(game), [game]);
  const nextShape = getBlockDropShape({ type: game.nextPiece, rotation: 0 });

  useEffect(() => {
    if (game.status !== 'playing') return;
    const speed = Math.max(100, 700 - (game.level - 1) * 55);
    const timer = window.setInterval(() => setGame((current) => tickBlockDrop(current)), speed);
    return () => window.clearInterval(timer);
  }, [game.level, game.status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, a, input, textarea, select')) return;
      let update: ((current: BlockDropState) => BlockDropState) | null = null;
      switch (event.key) {
        case 'ArrowLeft': update = (current) => moveBlockDrop(current, -1, 0); break;
        case 'ArrowRight': update = (current) => moveBlockDrop(current, 1, 0); break;
        case 'ArrowDown': update = (current) => tickBlockDrop(current); break;
        case 'ArrowUp':
        case 'x':
        case 'X': update = rotateBlockDrop; break;
        case ' ': update = hardDropBlockDrop; break;
        case 'p':
        case 'P': update = toggleBlockDropPause; break;
        default: return;
      }
      event.preventDefault();
      setGame(update);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const freshGame = () => setGame(createBlockDropState());

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    <main className="yard-main yard-block-drop-main">
      <Link href="/games" className="yard-mopyon-back"><ArrowLeft size={14} /> All games</Link>
      <div className="yard-heading">
        <div>
          <p className="yard-kicker">509 YARD / ARCADE</p>
          <h1>Block Drop</h1>
          <p className="yard-subtitle">Drop, stack, and clear lines.</p>
        </div>
        <button type="button" className="yard-button" onClick={freshGame}><RotateCcw size={14} /> New game</button>
      </div>

      <section className="yard-block-drop-shell" aria-label="Block Drop game">
        <div className="yard-block-drop-play">
          <div className="yard-block-drop-board-wrap">
            {game.status !== 'playing' && <div className="yard-block-drop-overlay">
              <strong>{game.status === 'paused' ? 'Paused' : 'Game over'}</strong>
              {game.status === 'gameover' && <span>Start a new game to play again.</span>}
            </div>}
            <div
              className="yard-block-drop-board"
              role="img"
              aria-label={`Block Drop board. Score ${game.score}, ${game.lines} lines cleared. Use arrow keys to move, up arrow to rotate, space to drop, and P to pause.`}
            >
              {visibleBoard.flatMap((row, rowIndex) => row.map((cell, columnIndex) =>
                <span key={`${rowIndex}-${columnIndex}`} className={`yard-block-drop-cell${cell ? ` ${PIECE_COLORS[cell]}` : ''}`} />,
              ))}
            </div>
          </div>
          <div className="yard-block-drop-touch" aria-label="Game controls">
            <button type="button" aria-label="Move left" onClick={() => setGame((current) => moveBlockDrop(current, -1, 0))}><ArrowLeft /></button>
            <button type="button" aria-label="Move right" onClick={() => setGame((current) => moveBlockDrop(current, 1, 0))}><ArrowRight /></button>
            <button type="button" aria-label="Soft drop" onClick={() => setGame((current) => tickBlockDrop(current))}><ArrowDown /></button>
            <button type="button" aria-label="Rotate piece" onClick={() => setGame(rotateBlockDrop)}><ArrowUp /></button>
            <button type="button" aria-label="Hard drop" onClick={() => setGame(hardDropBlockDrop)}><Zap /></button>
          </div>
        </div>

        <aside className="yard-block-drop-sidebar">
          <div className="yard-block-drop-stat"><span>Score</span><strong>{game.score.toLocaleString()}</strong></div>
          <div className="yard-block-drop-stat"><span>Lines</span><strong>{game.lines}</strong></div>
          <div className="yard-block-drop-stat"><span>Level</span><strong>{game.level}</strong></div>
          <div className="yard-block-drop-next">
            <span>Next piece</span>
            <div className="yard-block-drop-preview" style={{ gridTemplateColumns: `repeat(${nextShape.width}, 1fr)` }}>
              {nextShape.cells.flatMap((row, rowIndex) => [...row].map((cell, columnIndex) =>
                <span key={`${rowIndex}-${columnIndex}`} className={cell === '#' ? `yard-block-drop-cell ${PIECE_COLORS[game.nextPiece]}` : 'yard-block-drop-cell is-empty'} />,
              ))}
            </div>
          </div>
          <button
            type="button"
            className="yard-button yard-block-drop-pause"
            onClick={() => setGame(toggleBlockDropPause)}
            disabled={game.status === 'gameover'}
          >{game.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}{game.status === 'paused' ? 'Resume' : 'Pause'}</button>
          <p className="yard-block-drop-hint"><b>← →</b> move · <b>↑</b> rotate · <b>↓</b> drop · <b>Space</b> hard drop · <b>P</b> pause</p>
        </aside>
      </section>
    </main>
  </div>;
}
