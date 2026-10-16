import type { Action, MatchState, Tile } from './types';
import { legalActions } from './match';
import { endsTotal, isScoringTotal, allFourValue, openArms, placeTile } from './board';
import { isDouble, pips, sameTile } from './tiles';

export type BotLevel = 'easy' | 'hard';

/**
 * Pick a move for the player whose turn it is.
 * Bots only look at their own hand and the table — they never peek at other hands.
 */
export function botMove(match: MatchState, level: BotLevel = 'hard', random: () => number = Math.random): Action {
  const legal = legalActions(match);
  if (!legal.length) throw new Error('No legal actions');
  if (legal.length === 1) return legal[0];
  if (level === 'easy') return legal[Math.floor(random() * legal.length)];

  const h = match.hand;
  const seat = h.turn;
  const myHand = h.hands[seat];
  let best = legal[0];
  let bestScore = -Infinity;

  for (const a of legal) {
    if (a.type !== 'play') continue;
    const rest = myHand.filter((t) => !sameTile(t, a.tile));
    const board = placeTile(h.board, match.config.mode, seat, a.tile, a.arm);
    let s = 0;

    if (match.config.mode === 'points') {
      const total = endsTotal(board);
      if (isScoringTotal(total)) s += total * 3; // take points when you can
      if (allFourValue(board) !== null) s += isDouble(a.tile) ? 600 : 300; // all four: 100, or 200 with the double
    }
    s += pips(a.tile) * 1.5;                 // get rid of heavy tiles
    if (isDouble(a.tile)) s += 6;            // doubles are hard to place later
    if (rest.length === 0) s += 1000;        // going out always wins

    // Keep ends I can follow: count how many of my remaining tiles fit the new ends.
    const ends = openArms(board).map((id) => board.arms[id]!.value);
    s += rest.filter((t) => ends.some((v) => t[0] === v || t[1] === v)).length * 2;

    s += random() * 0.5; // tiny wobble so bots don't feel robotic
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}

/** Useful for "hint" buttons or tests: which of my tiles can go anywhere right now? */
export function playableTiles(match: MatchState): Tile[] {
  const out: Tile[] = [];
  for (const a of legalActions(match)) if (a.type === 'play' && !out.some((t) => sameTile(t, a.tile))) out.push(a.tile);
  return out;
}
