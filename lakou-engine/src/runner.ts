import type { Action, GameEvent, MatchState } from './types';
import { applyAction, isForced } from './match';
import { botMove, type BotLevel } from './bots';

export type SeatKind = 'human' | BotLevel;

/**
 * The server calls this in a loop (with a short delay between calls so people can see what happened).
 * It returns the next automatic step, or null when a human has to decide.
 *   - forced pass / draw → done automatically for everyone (humans too)
 *   - bot seats → the bot plays
 *   - hand over (Points mode, match not over) → null; call startNextHand when the end-of-hand screen is done
 *
 * Lakou pace: wait 5 s after every play before the next turn (animations), then real players get 30 s (timeoutMove when it runs out).
 */
export function autoStep(match: MatchState, seats: SeatKind[], random: () => number = Math.random): { match: MatchState; events: GameEvent[]; action: Action } | null {
  if (match.over || match.hand.over) return null;
  const kind = seats[match.hand.turn];
  let action: Action | null = null;
  if (isForced(match)) action = botMove(match, 'easy', random); // the only legal action
  else if (kind !== 'human') action = botMove(match, kind, random);
  if (!action) return null;
  return { ...applyAction(match, action), action };
}

/** Turn timer ran out: play something sensible for the human (same as a hard bot would). */
export function timeoutMove(match: MatchState): { match: MatchState; events: GameEvent[]; action: Action } {
  const action = botMove(match, 'hard');
  return { ...applyAction(match, action), action };
}

