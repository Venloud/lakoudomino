import { ArrowLeft, BookOpen, Check, Clock3 } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import './how-to-play.css';

type GameGuide = {
  name: string;
  status: 'Available now' | 'Coming soon';
  intro: string;
  steps: string[];
  note?: string;
  href?: string;
};

const gameGuides: GameGuide[] = [
  {
    name: 'Domino',
    status: 'Available now',
    intro: 'Caribbean double-six dominoes. The table has 28 tiles; each player starts with 7.',
    href: '/games/domino',
    steps: [
      'On your turn, place a tile that matches one of the open ends. Matching numbers touch.',
      'If you have no legal play, pass. In four-player games, players do not draw from the boneyard.',
      'Play all your tiles first to win the hand. If nobody can play, the hand is locked and the player with the fewest pips wins.',
      'Regular mode is a single hand. Points mode scores from the open ends and Lakou bonuses; fill your score row to win the match.',
    ],
    note: 'Points mode house scoring includes multiples of 5 from 10 up, pass and blocked-double bonuses, all-four bonuses, and points for going out or locking the game.',
  },
  {
    name: 'Tic-Tac-Toe',
    status: 'Available now',
    intro: 'Challenge a friend online in Regular mode or the larger Yard Mode.',
    href: '/games/tic-tac-toe',
    steps: [
      'Regular: take turns placing X or O in an empty square on the 3 × 3 board.',
      'Make three marks in a horizontal, vertical, or diagonal line to win. If all squares fill first, it is a draw.',
      'Yard Mode: play on a 3 × 3 board made of nine smaller Tic-Tac-Toe boards. Win a small board to claim its matching square on the large board.',
      'In Yard Mode, the cell you choose sends your opponent to the matching small board. If that board is already won or full, they may choose any open small board.',
      'Claim three small boards in a row—across, down, or diagonally—to win Yard Mode.',
    ],
  },
  {
    name: 'Mòpyon',
    status: 'Available now',
    intro: 'A two-player five-in-a-row game, played on the intersections of a 15 × 15 board.',
    href: '/games/mopyon',
    steps: [
      'Players take turns placing X or O on any empty intersection.',
      'Once placed, a mark stays on the board.',
      'Connect five or more of your marks in a horizontal, vertical, or diagonal line to win.',
      'X starts; the other player takes the next turn.',
    ],
    note: 'Mòpyon is currently local pass-and-play on one screen.',
  },
  {
    name: 'Block Drop',
    status: 'Available now',
    intro: 'Guide falling blocks, complete rows, and keep the stack below the top of the board.',
    href: '/games/block-drop',
    steps: [
      'Use ← and → to move a piece, ↑ to rotate it, and ↓ to move it down faster.',
      'Press Space to drop a piece immediately. Press P to pause or resume.',
      'On touch screens, use the on-screen move, rotate, and drop buttons.',
      'Complete full horizontal rows to clear them, score points, and advance. The game ends when the stack reaches the top.',
    ],
  },
  {
    name: 'Box',
    status: 'Available now',
    intro: 'A turn-based game inspired by Dots and Boxes.',
    href: '/games/box',
    steps: [
      'Take turns drawing one line between neighboring dots.',
      'Complete the fourth side of a square to claim that box and take another turn.',
      'When no more lines can be drawn, the player who claimed the most boxes wins.',
    ],
  },
  {
    name: 'Kay',
    status: 'Available now',
    intro: 'A sowing game inspired by Mancala, played with stones in small pits.',
    href: '/games/kay',
    steps: [
      'Pick up the stones from one of your pits and distribute them one at a time around the board.',
      'The aim is to collect more stones than your opponent.',
    ],
    note: 'This starter uses the common Kalah rules: six pits each, four stones per pit, capture from an empty pit, and keep sowing when your last stone lands in your store.',
  },
  {
    name: 'Chess',
    status: 'Available now',
    intro: 'Move pieces across the board and capture the opposing king in this local starter version.',
    href: '/games/chess',
    steps: [
      'Pawns move forward one square (or two on their first move) and capture diagonally. A pawn reaching the far side promotes to another piece.',
      'Rooks move along ranks and files; bishops move diagonally; queens move in either direction.',
      'Knights move in an L shape and can jump over pieces. Kings move one square in any direction, but never into check.',
      'Checkmate the opposing king: it is in check and has no legal escape. White moves first.',
    ],
    note: 'This first local version supports basic piece movement, captures, and pawn promotion. Check/checkmate, castling, and en passant are not included yet.',
  },
  {
    name: 'Dame',
    status: 'Available now',
    intro: 'Dame, also known as checkers, is a diagonal capture game.',
    href: '/games/dame',
    steps: [
      'Move pieces diagonally on the dark squares. Jump over an opposing piece to capture it.',
      'Reach the far side of the board to promote a piece to a king; kings can move diagonally in either direction.',
      'Win by capturing or blocking all of your opponent’s pieces.',
    ],
    note: 'This local foundation uses basic movement, captures, and promotion. Regional Dame rules can be refined later.',
  },
  {
    name: 'Word Yard',
    status: 'Available now',
    intro: 'Build words from your letter rack and score points from each letter.',
    href: '/games/words',
    steps: [
      'Take turns building words from the letters in your rack.',
      'Each letter has a point value; used letters are replenished from the tile bag.',
      'Use the starter dictionary and pass if you cannot make a word.',
    ],
    note: 'This foundation focuses on local word-building and scoring. A shared board, complete dictionary, and bonus squares can be added later.',
  },
  {
    name: 'Scrabble',
    status: 'Available now',
    intro: 'Place connected words on a shared board and score letter and premium-square points.',
    href: '/games/scrabble',
    steps: [
      'Player 1 starts by placing a word across the center star. Each new play must connect to tiles already on the board.',
      'Choose across or down, select a starting square, and make a word using your rack.',
      'New tiles on double- or triple-letter and word squares earn bonuses. The rack refills from the tile bag.',
      'Pass turns when needed; after four consecutive passes, remaining rack values are subtracted and the higher score wins.',
    ],
    note: 'This local version uses a starter dictionary and pass-and-play. Tile exchange and the full official dictionary are not included yet.',
  },
  {
    name: 'Barricade',
    status: 'Available now',
    intro: 'Race your pawns to the finish while moving barricades and sending rivals back to base.',
    href: '/games/barricade',
    steps: [
      'Roll the die and move one pawn toward the finish or back toward your base by the number rolled.',
      'Barricades block movement. Land exactly on one to move it to an empty track space.',
      'You may pass pawns, but landing on an opponent sends that pawn back to its base.',
      'Reach the finish first to win. A pawn must land exactly on the final space.',
    ],
    note: 'This is a local two-player foundation on a winding track; the full multi-player board layout can be added later.',
  },
  {
    name: 'Four in a Row',
    status: 'Available now',
    intro: 'Drop pieces into a shared grid and try to connect four.',
    href: '/games/four-in-a-row',
    steps: [
      'Take turns dropping one piece into a column; it lands in the lowest open space.',
      'Connect four of your pieces horizontally, vertically, or diagonally to win.',
      'If the board fills without a four-piece line, the game is a draw.',
    ],
  },
  {
    name: 'Filler',
    status: 'Available now',
    intro: 'Claim colored tiles by growing your connected territory from your corner.',
    href: '/games/filler',
    steps: [
      'Each player starts in an opposite corner on a random six-color board.',
      'Take turns choosing a color different from both players’ current territory colors.',
      'Your connected region absorbs every touching tile of the chosen color.',
      'When the board is full, the player with more tiles wins; an equal count is a draw.',
    ],
  },
];

export default function HowToPlayPage() {
  return (
    <div className="yard-app">
      <YardHeader active="games" notifications={0} onLogout={() => {}} />
      <main className="yard-main yard-guide-main">
        <Link href="/games" className="yard-guide-back"><ArrowLeft size={15} /> All games</Link>
        <header className="yard-heading yard-guide-heading">
          <div>
            <p className="yard-kicker">509 YARD / GAME GUIDE</p>
            <h1>How to play</h1>
            <p className="yard-subtitle">Rules and controls for every game in the yard.</p>
          </div>
        </header>

        <nav className="yard-guide-index" aria-label="Jump to a game's rules">
          {gameGuides.map((game) => <a key={game.name} href={`#guide-${game.name.toLowerCase().replaceAll(' ', '-')}`}>{game.name}</a>)}
        </nav>

        <section className="yard-guide-list" aria-label="Game instructions">
          {gameGuides.map((game) => {
            const available = game.status === 'Available now';
            return (
              <details
                className="yard-panel yard-guide-card"
                key={game.name}
                id={`guide-${game.name.toLowerCase().replaceAll(' ', '-')}`}
                open={available}
              >
                <summary>
                  <span className="yard-guide-title">{game.name}</span>
                  <span className={`yard-guide-status${available ? ' is-available' : ''}`}>
                    {available ? <Check size={13} /> : <Clock3 size={13} />}
                    {game.status}
                  </span>
                </summary>
                <div className="yard-guide-content">
                  <p>{game.intro}</p>
                  <ol>{game.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                  {game.note && <p className="yard-guide-note"><BookOpen size={15} />{game.note}</p>}
                  {game.href && <Link className="yard-button primary yard-guide-play" href={game.href}>Play {game.name}</Link>}
                  {game.name === 'Domino' && (
                    <div className="yard-guide-modes">
                      <b>Regular</b><span>First out wins the hand; if the game locks, the fewest pips wins.</span>
                      <b>Points</b><span>Build score with open-end totals and Lakou bonuses until a player fills their score row.</span>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </section>
      </main>
    </div>
  );
}
