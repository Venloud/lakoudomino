// "How to play": the rules book (Lobby → Quick play → How to play).
import React from 'react';
import { Domino } from './Domino';
import { Page } from './Shell';

export interface HowToPlayProps { onBack?: () => void; onPlayNow?: () => void }

const BONUSES: [string, string, string][] = [
  ['Ends count', 'multiple of 5, from 10 up', 'After your play, add up the open ends. 10, 15, 20… score that many points. A total of 5 doesn’t count.'],
  ['Pass bonus', '+50 each', 'Every player who has to pass right after you gives you 50.'],
  ['Blocked a double', '+50', 'Your play shuts out a double someone else is holding (not your own, not one still in the boneyard).'],
  ['All four', '+100', 'All four ends show the same number. On top of the normal count.'],
  ['Double all four', '+200', 'You make all four by playing that number’s double.'],
  ['Domino!', 'everyone’s pips', 'Go out first: you get the pips left in the other three hands, rounded to the nearest 5 (27 → 25, 38 → 40).'],
  ['Locked the game', '+150', 'Your play leaves nobody able to move. The player with the lowest hand also gets +50.'],
];

export function HowToPlayScreen({ onBack, onPlayNow }: HowToPlayProps) {
  return (
    <Page right={onBack && <button className="lk-back" onClick={onBack}>← Back to lobby</button>} onHome={onBack}>
      <main className="lk-rules">
        <header className="lk-rules-head">
          <p className="lk-eyebrow">RULES</p>
          <h1>How to play</h1>
          <p className="lk-sub">Caribbean dominoes, the way we play it in the lakou. Double-six set, 28 tiles, 7 each.</p>
        </header>

        <section className="lk-panel lk-rules-card">
          <h2>The basics</h2>
          <ol className="lk-rules-list">
            <li>Everyone gets 7 tiles. First hand: whoever holds the double six puts it down. After that, the winner of the last hand starts with any tile.</li>
            <li>On your turn, play a tile whose number matches an open end. Matching halves touch.</li>
            <li>Can’t play? You pass (“Pass!”). There’s no drawing in 4-player games.</li>
            <li>First to play every tile calls <b>Domino!</b> and wins the hand. If nobody can move, the game is <b>locked</b> and the lowest hand wins.</li>
          </ol>
          <div className="lk-rules-demo" aria-hidden="true">
            <Domino first={4} second={6} orientation="h" unit={20} />
            <Domino first={6} second={6} orientation="v" unit={20} />
            <Domino first={6} second={2} orientation="h" unit={20} />
          </div>
          <p className="lk-sub">Double-tap a tile when both ends give the same result and it goes down on its own. Otherwise tap a glowing spot.</p>
        </section>

        <div className="lk-rules-modes">
          <section className="lk-panel lk-rules-card">
            <h2>Regular</h2>
            <p className="lk-sub">One hand, two ends, no points. First out wins. If the game locks, everyone is ranked by the pips left in their hand, lowest first. 2, 3 or 4 players.</p>
          </section>
          <section className="lk-panel lk-rules-card">
            <h2>Points</h2>
            <p className="lk-sub">4 players. The first double becomes the spinner: once both sides are covered, it opens up and down too (four ends). Score by making the ends add up to multiples of 5. First to fill their row of boxes wins the match.</p>
          </section>
        </div>

        <section className="lk-panel lk-rules-card">
          <h2>Points mode scoring · Lakou house rules</h2>
          <p className="lk-sub">This is how we play at our table. Classic All Fives is a little different: a total of 5 scores, there’s no pass or blocked-double bonus, and a locked game is paid by pips.</p>
          <div className="lk-rules-table">
            {BONUSES.map(([name, pts, what]) => (
              <div key={name} className="lk-rules-row">
                <b>{name}</b><span className="lk-gold">{pts}</span><span className="lk-sub">{what}</span>
              </div>
            ))}
          </div>
          <p className="lk-sub">Your row: each box holds 50, drawn as 10 strokes of 5. A 50 bonus fills a whole box. Hover or tap a box to see what’s in it.</p>
        </section>

        <div className="lk-rules-modes">
          <section className="lk-panel lk-rules-card">
            <h2>Crowns</h2>
            <p className="lk-sub">At the end of a match: 1st gets gold (3 crown points), 2nd silver (2), 3rd bronze (1), last place nothing. Only signed-in players earn crowns, and only in games with at least 2 real players. Games against bots are practice.</p>
          </section>
          <section className="lk-panel lk-rules-card">
            <h2>Turns and tables</h2>
            <p className="lk-sub">You get the table’s turn time (30 s by default). Let it run out and the game plays for you, and your next turn is 25% shorter. Play yourself and it goes back to full. Too many in a row and a bot takes your seat. After a game, losers get up for whoever is waiting in line.</p>
          </section>
        </div>

        {onPlayNow && <button className="lk-playnow-btn lk-rules-cta" onClick={onPlayNow}><b>Play now</b><span>jump in a game</span></button>}
      </main>
    </Page>
  );
}
