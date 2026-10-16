/**
 * "Play now" matchmaking.
 *
 * - Tapping Play now puts you in the queue for a mode (Points or Regular).
 * - As soon as 4 people are waiting for the same mode, they get a table together.
 * - If the table can't fill, then QUEUE_WAIT_MS after the first person in line joined, everyone waiting
 *   for that mode starts right away and bots take the empty seats (1 person → 3 bots, 2 → 2 bots…).
 * - After a game, "Play again" should call joinQueue again, so you get matched with anyone who
 *   showed up in the meantime before falling back to bots.
 * - "Wait for real players" (setBotsOk false): you're never put with bots, you wait as long as you like
 *   and only start when 4 real people are in line. "Start now with bots" (startNow) skips the countdown.
 *
 * Pure: pass `now` (ms) and optionally an `isOnline(id)` check. Call tickQueue about once a second.
 */
import type { BotLevel } from './bots';

export const QUEUE_WAIT_MS = 20_000;
export const QUEUE_TABLE_SIZE = 4;

export type QueueMode = 'points' | 'regular';

export interface QueueEntry {
  id: string; mode: QueueMode; joinedAt: number;
  /** false = only real players, keep waiting. Default true. */
  botsOk?: boolean;
  /** Start right away with bots on the next tick. */
  now?: boolean;
}
export interface PlayQueue { entries: QueueEntry[] }

export interface QueueMatch {
  mode: QueueMode;
  /** Real players, in seat order (seat 0 = first in line). */
  players: string[];
  /** Seat kinds for the runner / autoStep: 'human' for players, then a bot level for each empty seat. */
  seats: ('human' | BotLevel)[];
  /** How many bots fill the table. 0 = all real players. */
  bots: number;
}

export interface QueueStatus {
  mode: QueueMode;
  /** 1 = first in line. */
  position: number;
  /** People waiting for this mode right now, including you (capped at the table size). */
  found: number;
  needed: number;
  /** When bots fill the table if nobody else comes (ms timestamp). null = waiting for real players only. */
  botsAt: number | null;
  botsOk: boolean;
  /** How long you've been in line (ms), for "Waiting 2:14". */
  waitedMs: number;
}

export function createQueue(): PlayQueue {
  return { entries: [] };
}

/** Join (or switch mode). Re-joining the same mode keeps your place in line. */
export function joinQueue(q: PlayQueue, id: string, mode: QueueMode, now: number, opts: { botsOk?: boolean } = {}): PlayQueue {
  const existing = q.entries.find((e) => e.id === id);
  if (existing && existing.mode === mode) return opts.botsOk === undefined ? q : setBotsOk(q, id, opts.botsOk, now);
  return { entries: [...q.entries.filter((e) => e.id !== id), { id, mode, joinedAt: now, botsOk: opts.botsOk ?? true }] };
}

/** Switch between "bots can fill in" and "wait for real players". Turning bots back on restarts your countdown. */
export function setBotsOk(q: PlayQueue, id: string, botsOk: boolean, now: number): PlayQueue {
  return { entries: q.entries.map((e) => (e.id === id ? { ...e, botsOk, joinedAt: botsOk && e.botsOk === false ? now : e.joinedAt } : e)) };
}

/** "Start now with bots": your table starts on the next tick with whoever is waiting (bots-OK people). */
export function startNow(q: PlayQueue, id: string): PlayQueue {
  return { entries: q.entries.map((e) => (e.id === id ? { ...e, botsOk: true, now: true } : e)) };
}

export function leaveQueue(q: PlayQueue, id: string): PlayQueue {
  return q.entries.some((e) => e.id === id) ? { entries: q.entries.filter((e) => e.id !== id) } : q;
}

export function isQueued(q: PlayQueue, id: string): boolean {
  return q.entries.some((e) => e.id === id);
}

export function queueStatus(q: PlayQueue, id: string, waitMs = QUEUE_WAIT_MS, now: number = Date.now()): QueueStatus | null {
  const me = q.entries.find((e) => e.id === id);
  if (!me) return null;
  const same = q.entries.filter((e) => e.mode === me.mode);
  // You're grouped with the people ahead of you in blocks of 4.
  const idx = same.indexOf(me);
  const groupStart = Math.floor(idx / QUEUE_TABLE_SIZE) * QUEUE_TABLE_SIZE;
  const group = same.slice(groupStart, groupStart + QUEUE_TABLE_SIZE);
  const botsOk = me.botsOk !== false;
  const firstOk = same.find((e) => e.botsOk !== false);
  return {
    mode: me.mode,
    position: idx + 1,
    found: group.length,
    needed: QUEUE_TABLE_SIZE,
    botsAt: botsOk && firstOk ? firstOk.joinedAt + waitMs : null,
    botsOk,
    waitedMs: Math.max(0, now - me.joinedAt),
  };
}

/**
 * Forms every table that's ready: full tables of real players first, then tables whose first person
 * has waited long enough (filled with bots). Offline people are dropped from the queue.
 */
export function tickQueue(
  q: PlayQueue,
  now: number,
  opts: { isOnline?: (id: string) => boolean; waitMs?: number; botLevel?: BotLevel } = {},
): { queue: PlayQueue; matches: QueueMatch[] } {
  const waitMs = opts.waitMs ?? QUEUE_WAIT_MS;
  const botLevel = opts.botLevel ?? 'hard';
  const online = opts.isOnline ?? (() => true);
  let entries = q.entries.filter((e) => online(e.id));
  const matches: QueueMatch[] = [];

  const make = (mode: QueueMode, group: QueueEntry[]): QueueMatch => {
    const bots = QUEUE_TABLE_SIZE - group.length;
    return {
      mode,
      players: group.map((e) => e.id),
      seats: [...group.map(() => 'human' as const), ...Array<BotLevel>(bots).fill(botLevel)],
      bots,
    };
  };

  for (const mode of ['points', 'regular'] as QueueMode[]) {
    let same = entries.filter((e) => e.mode === mode);
    while (same.length >= QUEUE_TABLE_SIZE) {
      const group = same.slice(0, QUEUE_TABLE_SIZE);
      matches.push(make(mode, group));
      same = same.slice(QUEUE_TABLE_SIZE);
    }
    // Bot fallback: only people who said bots are OK. "Real players only" people keep waiting.
    const ok = same.filter((e) => e.botsOk !== false);
    if (ok.length && (ok.some((e) => e.now) || now - ok[0].joinedAt >= waitMs)) {
      matches.push(make(mode, ok));
      same = same.filter((e) => e.botsOk === false);
    }
    entries = [...entries.filter((e) => e.mode !== mode), ...same];
  }
  entries.sort((a, b) => a.joinedAt - b.joinedAt);
  const changed = matches.length > 0 || entries.length !== q.entries.length;
  return { queue: changed ? { entries } : q, matches };
}
