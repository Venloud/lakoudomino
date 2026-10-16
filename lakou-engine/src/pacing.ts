/**
 * Lakou pace: how long the server waits before the next step, so games never stall and never feel instant.
 *
 *  - Start of a hand: the first tile goes down after ~1.5 s (bots don't wait for a timer).
 *  - After a play: 5 s for the animations (glow, "+15", banners). Big bonuses get a bit longer.
 *  - After a pass or a draw: 1.5 s (just the "Pass!" flag), not the full 5 s.
 *  - Bots: never get a turn timer. On top of the pause they "think" for 0.6–1.6 s (random), so it feels
 *    like a person played, not an instant reply.
 *  - Forced moves (only one legal thing: pass or draw) happen automatically for everyone, humans included.
 *  - Real players with a choice: the 30 s clock starts after the pause.
 *
 * Server loop:
 *   const step = nextStep(match, seats, lastEvents);
 *   if (step.type === 'none') return;                        // hand/match over → end-of-hand flow
 *   setTimeout(() => {
 *     if (step.type === 'human') { deadline = Date.now() + step.turnMs; broadcast(); timer = setTimeout(() => apply(timeoutMove(match)), step.turnMs); }
 *     else apply(autoStep(match, seats));                    // bot or forced
 *   }, step.delayMs);
 * Cancel the pending timer whenever a human acts.
 */
import type { GameEvent, MatchState } from './types';
import { isForced } from './match';
import type { SeatKind } from './runner';

export const PACE = {
  openingMs: 1500,
  afterPlayMs: 5000,
  /** Extra time when a banner shows (All four, blocked double). */
  bigBonusExtraMs: 1500,
  afterPassMs: 1500,
  afterDrawMs: 700,
  botThinkMinMs: 600,
  botThinkMaxMs: 1600,
  turnMs: 30000,
} as const;

/**
 * Just you and bots: quicker, but never instant. Used automatically when a table has 0 or 1 real player.
 * About 3 s from one bot's tile to the next, instead of about 6 s.
 */
export const PACE_SOLO = {
  openingMs: 1200,
  afterPlayMs: 2500,
  bigBonusExtraMs: 1000,
  afterPassMs: 1000,
  afterDrawMs: 500,
  botThinkMinMs: 300,
  botThinkMaxMs: 900,
} as const;

export type NextStep =
  | { type: 'none' }
  | { type: 'bot' | 'forced'; seat: number; delayMs: number }
  | { type: 'human'; seat: number; delayMs: number; turnMs: number };

/** `lastEvents` = the events from the step that just happened ([] or handStart events at the start of a hand). */
export function nextStep(
  match: MatchState,
  seats: SeatKind[],
  lastEvents: GameEvent[],
  opts: { random?: () => number; turnMs?: number; speed?: number; afk?: AfkState } = {},
): NextStep {
  if (match.over || match.hand.over) return { type: 'none' };
  const random = opts.random ?? Math.random;
  const speed = opts.speed ?? 1; // table speed setting: 1.5 = slower, 0.5 = faster (pauses only)
  const seat = match.hand.turn;
  const P = seats.filter((k) => k === 'human').length <= 1 ? PACE_SOLO : PACE;

  let pause: number;
  if (match.hand.board.history.length === 0) pause = P.openingMs;
  else if (lastEvents.some((e) => e.type === 'play')) {
    pause = P.afterPlayMs;
    if (lastEvents.some((e) => e.type === 'bonus' && (e.reason === 'allFour' || e.reason === 'blockedDouble'))) pause += P.bigBonusExtraMs;
  } else if (lastEvents.some((e) => e.type === 'pass')) pause = P.afterPassMs;
  else if (lastEvents.some((e) => e.type === 'draw')) pause = P.afterDrawMs;
  else pause = P.afterPassMs;
  pause = Math.round(pause * speed);

  if (isForced(match)) return { type: 'forced', seat, delayMs: pause };
  if (seats[seat] !== 'human') {
    const think = P.botThinkMinMs + random() * (P.botThinkMaxMs - P.botThinkMinMs);
    return { type: 'bot', seat, delayMs: Math.round(pause + think) };
  }
  const base = opts.turnMs ?? PACE.turnMs;
  const turnMs = opts.afk ? afkTurnMs(opts.afk, seat, base) ?? AFK_MIN_TURN_MS : base;
  return { type: 'human', seat, delayMs: pause, turnMs };
}

/**
 * Idle players ("auto-picked"): every time your clock runs out and the game plays for you, your turn time
 * drops by 25%: with a 30 s table 30 → 23 → 17 → 13 → 9 → 7 → 5 s (a 15 s table: 15 → 11 → 8 → 6 s).
 * Play a tile yourself and it goes straight back to full (recordOwnPlay). If it would drop under 5 s,
 * a bot takes your seat and finishes the game. If no real players are left, close the table.
 * Always pass the TABLE's turn timer as baseMs. Keep one AfkState per match (fresh every new match).
 */
export const AFK_FACTOR = 0.75;
export const AFK_MIN_TURN_MS = 5000;

export interface AfkState { timeouts: number[] }

export function createAfk(players: number): AfkState {
  return { timeouts: Array(players).fill(0) };
}

/** Turn time for this seat, or null when they're out of time and a bot should take over. */
export function afkTurnMs(afk: AfkState, seat: number, baseMs: number = PACE.turnMs): number | null {
  const ms = Math.round((baseMs * AFK_FACTOR ** (afk.timeouts[seat] ?? 0)) / 1000) * 1000;
  return ms < AFK_MIN_TURN_MS ? null : ms;
}

/**
 * Call right after timeoutMove for a seat. Returns the new state, the seat's next turn time, and whether
 * the seat is now a bot (update your seats array: seats[seat] = 'hard').
 */
export function recordTimeout(afk: AfkState, seat: number, baseMs: number = PACE.turnMs): {
  afk: AfkState; nextTurnMs: number | null; replacedByBot: boolean;
} {
  const timeouts = afk.timeouts.slice();
  timeouts[seat] = (timeouts[seat] ?? 0) + 1;
  const next = { timeouts };
  const nextTurnMs = afkTurnMs(next, seat, baseMs);
  return { afk: next, nextTurnMs, replacedByBot: nextTurnMs === null };
}

/** True when every seat is a bot: nobody real is left, so the server should close the table. */
export function onlyBotsLeft(seats: SeatKind[]): boolean {
  return seats.every((s) => s !== 'human');
}

/** The player acted on their own (played, drew or passed by tapping): their clock goes back to full. */
export function recordOwnPlay(afk: AfkState, seat: number): AfkState {
  if (!afk.timeouts[seat]) return afk;
  const timeouts = afk.timeouts.slice();
  timeouts[seat] = 0;
  return { timeouts };
}

/**
 * Crowns and the leaderboard only count for real games: at least 2 real players when the match started.
 * You + bots is practice. Guests never earn crowns (only signed-in accounts are saved).
 */
export function countsForCrowns(seatsAtStart: SeatKind[]): boolean {
  return seatsAtStart.filter((s) => s === 'human').length >= 2;
}
