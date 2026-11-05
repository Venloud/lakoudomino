import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pause, Play, RotateCcw, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import { GameEndSequence } from '@/components/game-end-sequence';
import { ArcadeOnlinePanel } from '@/components/arcade-online-panel';
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

function chooseBlockDropBotPlacement(state: BlockDropState): BlockDropState {
  if (!state.active || state.status !== 'playing') return state;
  let best = state;
  let bestScore = -Infinity;
  for (let rotation = 0; rotation < 4; rotation++) {
    let rotated = state;
    for (let turn = 0; turn < rotation; turn++) rotated = rotateBlockDrop(rotated);
    const shape = getBlockDropShape(rotated.active!);
    for (let x = 0; x <= BLOCK_DROP_COLUMNS - shape.width; x++) {
      let candidate = rotated;
      while (candidate.active && candidate.active.x !== x) {
        const next = moveBlockDrop(candidate, candidate.active.x < x ? 1 : -1, 0);
        if (next === candidate) break;
        candidate = next;
      }
      if (!candidate.active || candidate.active.x !== x) continue;
      const landed = hardDropBlockDrop(candidate);
      let holes = 0, aggregateHeight = 0, bumpiness = 0;
      const heights = Array.from({ length: BLOCK_DROP_COLUMNS }, (_, column) => {
        const first = landed.board.findIndex((row) => row[column] !== null);
        const height = first < 0 ? 0 : BLOCK_DROP_ROWS - first;
        aggregateHeight += height;
        let occupied = false;
        for (const row of landed.board) {
          if (row[column] !== null) occupied = true;
          else if (occupied) holes++;
        }
        return height;
      });
      for (let column = 1; column < heights.length; column++) bumpiness += Math.abs(heights[column] - heights[column - 1]);
      const lines = landed.lines - state.lines;
      const score = lines * 500 - holes * 55 - aggregateHeight * 4 - bumpiness * 3;
      if (score > bestScore) { best = landed; bestScore = score; }
    }
  }
  return best;
}

export default function BlockDropPage() {
  const [game, setGame] = useState(createBlockDropState);
  const [botGame, setBotGame] = useState(createBlockDropState);
  const [practiceBot, setPracticeBot] = useState(false);
  const [onlineSession, setOnlineSession] = useState<{ seat: number; connected: boolean; turn: number | null } | null>(null);
  const [opponentOnlineGame, setOpponentOnlineGame] = useState<BlockDropState | null>(null);
  const applyOnlineRace = useCallback((state: unknown) => {
    if (!Array.isArray(state)) return;
    const opponent = state.find((entry, seat) => seat !== onlineSession?.seat && entry && typeof entry === 'object') as BlockDropState | undefined;
    if (opponent && Array.isArray(opponent.board)) setOpponentOnlineGame(opponent);
  }, [onlineSession?.seat]);
  const handleRoomChange = useCallback((session: { seat: number; connected: boolean; turn: number | null } | null) => {
    setOnlineSession(session);
    if (session) setPracticeBot(false);
  }, []);
  const visibleBoard = useMemo(() => getVisibleBoard(game), [game]);
  const botVisibleBoard = useMemo(() => getVisibleBoard(botGame), [botGame]);
  const nextShape = getBlockDropShape({ type: game.nextPiece, rotation: 0 });
  const onlineMatchOver = Boolean(onlineSession?.connected && game.status === 'gameover' && opponentOnlineGame?.status === 'gameover');
  const matchOver = game.status === 'gameover' || (practiceBot && botGame.status === 'gameover') || onlineMatchOver;
  const practiceWinner = game.score === botGame.score ? 'draw' : game.score > botGame.score ? 'You' : 'Yard bot';
  const onlineWinner = !opponentOnlineGame || game.score === opponentOnlineGame.score ? 'draw' : game.score > opponentOnlineGame.score ? 'You' : 'Opponent';

  useEffect(() => {
    if (game.status !== 'playing') return;
    const speed = Math.max(100, 700 - (game.level - 1) * 55);
    const timer = window.setInterval(() => setGame((current) => tickBlockDrop(current)), speed);
    return () => window.clearInterval(timer);
  }, [game.level, game.status]);

  useEffect(() => {
    if (!practiceBot || game.status !== 'playing' || botGame.status !== 'playing') return;
    const timer = window.setTimeout(() => setBotGame((current) => chooseBlockDropBotPlacement(current)), 950);
    return () => window.clearTimeout(timer);
  }, [practiceBot, game.status, botGame]);

  useEffect(() => {
    if (practiceBot && botGame.status === 'gameover' && game.status === 'playing') {
      setGame((current) => toggleBlockDropPause(current));
    }
  }, [practiceBot, botGame.status, game.status]);

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

  const freshGame = () => { setGame(createBlockDropState()); setBotGame(createBlockDropState()); };
  const chooseOpponent = (enabled: boolean) => { setPracticeBot(enabled); freshGame(); };

  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    {matchOver && <GameEndSequence gameName="Block Drop" perspective={onlineMatchOver ? onlineWinner === 'draw' ? 'draw' : onlineWinner === 'You' ? 'winner' : 'opponent' : practiceBot ? practiceWinner === 'draw' ? 'draw' : practiceWinner === 'You' ? 'winner' : 'opponent' : 'solo-loss'} winnerName={onlineMatchOver ? onlineWinner === 'draw' ? 'Draw game' : onlineWinner : practiceBot ? practiceWinner === 'draw' ? 'Draw game' : practiceWinner : undefined} opponentName={onlineMatchOver ? onlineWinner === 'You' ? 'Opponent' : 'You' : practiceBot ? practiceWinner === 'You' ? 'Yard bot' : 'You' : undefined} score={onlineMatchOver ? `You ${game.score.toLocaleString()} · Opponent ${opponentOnlineGame?.score.toLocaleString() ?? 0}` : practiceBot ? `You ${game.score.toLocaleString()} · Yard bot ${botGame.score.toLocaleString()}` : `${game.score.toLocaleString()} points · ${game.lines} lines`} detail={onlineMatchOver ? 'Both score challenge runs are complete.' : practiceBot ? 'The first stack to top out ends the practice round.' : 'Your stack reached the top. Take a breath, then try for a new high score.'} onPlayAgain={freshGame} />}
    <main className="yard-main yard-block-drop-main">
      <Link href="/games" className="yard-mopyon-back"><ArrowLeft size={14} /> All games</Link>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '0 0 14px' }} role="group" aria-label="Choose opponent">
        <button type="button" className={`yard-button${!practiceBot ? ' primary' : ''}`} aria-pressed={!practiceBot} disabled={onlineSession !== null} onClick={() => chooseOpponent(false)}>Solo practice</button>
        <button type="button" className={`yard-button${practiceBot ? ' primary' : ''}`} aria-pressed={practiceBot} disabled={onlineSession !== null} onClick={() => chooseOpponent(true)}>Race the Yard bot</button>
      </div>
      <ArcadeOnlinePanel game="block-drop" turn={0} state={game} onRemoteState={applyOnlineRace} onRoomChange={handleRoomChange} />
      {onlineSession && <p role="status" style={{ textAlign: 'center', color: '#a6a6aa', fontSize: 12 }}>Quick Match is a live race. A private room code also works as a score challenge: each player can finish their run separately.</p>}
      {practiceBot && <p role="status" style={{ textAlign: 'center', margin: '0 0 14px', color: '#a6a6aa', fontSize: 12 }}>Yard bot: {botGame.score.toLocaleString()} points · {botGame.lines} lines · level {botGame.level}</p>}
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
          {practiceBot && <div style={{ gridColumn: '1 / -1', display: 'grid', justifyItems: 'center', gap: 6 }}>
            <strong style={{ fontSize: 12 }}>Yard bot · {botGame.score.toLocaleString()}</strong>
            <div aria-label="Yard bot board" style={{ width: 'min(100%, 170px)', display: 'grid', gridTemplateColumns: `repeat(${BLOCK_DROP_COLUMNS}, minmax(0, 1fr))`, gap: 1, padding: 3, borderRadius: 4, background: '#101312' }}>
              {botVisibleBoard.flatMap((row, rowIndex) => row.map((cell, columnIndex) => <i key={`${rowIndex}-${columnIndex}`} className={`yard-block-drop-cell${cell ? ` ${PIECE_COLORS[cell]}` : ' is-empty'}`} />))}
            </div>
            <small>{botGame.lines} lines · level {botGame.level}</small>
          </div>}
          {onlineSession?.connected && <div style={{ gridColumn: '1 / -1', display: 'grid', justifyItems: 'center', gap: 6 }}>
            <strong style={{ fontSize: 12 }}>Opponent · {opponentOnlineGame?.score.toLocaleString() ?? 'waiting'} points</strong>
            {opponentOnlineGame && <small>{opponentOnlineGame.lines} lines · level {opponentOnlineGame.level} · {opponentOnlineGame.status === 'gameover' ? 'finished' : 'playing'}</small>}
          </div>}
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
