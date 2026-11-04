import { HeartHandshake, Minus, RotateCcw, Trophy } from 'lucide-react';
import { Link } from 'wouter';
import './game-end-sequence.css';

type Perspective = 'local' | 'winner' | 'opponent' | 'draw' | 'solo-loss';

type GameEndSequenceProps = {
  gameName: string;
  perspective: Perspective;
  winnerName?: string;
  opponentName?: string;
  detail?: string;
  score?: string;
  onPlayAgain: () => void;
  returnHref?: string;
};

export function GameEndSequence({
  gameName,
  perspective,
  winnerName = 'Player 1',
  opponentName = 'Player 2',
  detail,
  score,
  onPlayAgain,
  returnHref = '/games',
}: GameEndSequenceProps) {
  const isLocal = perspective === 'local';
  const isDraw = perspective === 'draw';
  const isWinner = perspective === 'winner';
  const title = isDraw ? 'A hard-fought draw' : isWinner ? 'You take the win' :
    perspective === 'solo-loss' ? 'Good run' : perspective === 'opponent' ? 'Good game' : `${winnerName} wins`;
  const subtitle = isDraw ? 'No one takes this round. Run it back?' :
    isWinner ? `${opponentName} put up a fight. Enjoy the win.` :
      perspective === 'solo-loss' ? 'The board got away from you. Ready for another round?' :
        perspective === 'opponent' ? `${winnerName} takes this one. There is always another game.` :
          `${opponentName} — good game. The next round is yours to take.`;

  return <div className={`yard-end-scrim${isWinner ? ' is-winner' : ''}${perspective === 'opponent' || perspective === 'solo-loss' ? ' is-opponent' : ''}`} role="presentation">
    <section className="yard-end-card" role="dialog" aria-modal="true" aria-labelledby="yard-end-title" aria-describedby="yard-end-copy">
      <div className="yard-end-mark" aria-hidden="true">
        {isDraw ? <Minus size={25} /> : isWinner || isLocal ? <Trophy size={25} /> : <HeartHandshake size={25} />}
      </div>
      <p className="yard-end-kicker">509 YARD <span>·</span> {gameName.toUpperCase()} COMPLETE</p>
      <h2 id="yard-end-title">{title}</h2>
      <p id="yard-end-copy" className="yard-end-copy">{detail ?? subtitle}</p>
      {score && <p className="yard-end-score">{score}</p>}
      {isLocal && !isDraw && <div className="yard-end-perspectives">
        <div><span className="yard-end-view-label">WINNER'S VIEW</span><strong>{winnerName}</strong><small>That was a great finish.</small></div>
        <div><span className="yard-end-view-label">OPPONENT'S VIEW</span><strong>{opponentName}</strong><small>Good game. Run it back?</small></div>
      </div>}
      {isDraw && <div className="yard-end-draw-note">Both players held their ground.</div>}
      <div className="yard-end-actions">
        <Link href={returnHref} className="yard-end-secondary">Back to games</Link>
        <button type="button" className="yard-end-primary" onClick={onPlayAgain}><RotateCcw size={15} /> Play again</button>
      </div>
    </section>
  </div>;
}
