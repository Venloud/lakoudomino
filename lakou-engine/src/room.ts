/**
 * Table seating with a waitlist ("loser gets up").
 *
 * - People who want to play join the WAITLIST. Everyone in the room can see it, in order.
 * - After each game, the host's chosen number of bottom finishers get up and go to the back of the
 *   waitlist. The host is NEVER removed: if the host lost, the next-worst player gets up instead.
 * - Seated players who are away (offline) also give up their seat when someone is waiting.
 * - Each free seat is OFFERED to the next person in line who is online. They have 1 minute to take it.
 *   No answer (or they go offline) → they move to the back of the line and the seat goes to the next person.
 * - Anyone on the waitlist can turn on "notify me", and they get pinged when the game ends.
 *
 * Everything here is pure: pass in `now` (ms) and an `isOnline(id)` check from your socket layer.
 */
export const SEAT_OFFER_MS = 60_000;

export interface WaitlistEntry {
  id: string;
  /** Wants a ping when the current game ends. */
  notify: boolean;
}

export interface SeatOffer {
  seat: number;
  playerId: string;
  /** Timestamp (ms) when the offer runs out. Show a countdown. */
  expiresAt: number;
}

export interface Room {
  hostId: string;
  /** Player ids by seat. null = empty (a bot can fill it). */
  seats: (string | null)[];
  waitlist: WaitlistEntry[];
  /** Seats waiting for someone to tap "Take my seat". The next game starts when this is empty. */
  offers: SeatOffer[];
}

export type RoomEvent =
  | { type: 'gotUp'; seat: number; playerId: string; reason: 'lost' | 'away' }
  | { type: 'offer'; seat: number; playerId: string; expiresAt: number }
  | { type: 'offerExpired'; seat: number; playerId: string }
  | { type: 'seated'; seat: number; playerId: string }
  | { type: 'notifyGameOver'; playerIds: string[] };

type Online = (id: string) => boolean;

export function createRoom(hostId: string, seatCount = 4): Room {
  const seats: (string | null)[] = Array(seatCount).fill(null);
  seats[0] = hostId;
  return { hostId, seats, waitlist: [], offers: [] };
}

const clone = (r: Room): Room => ({
  hostId: r.hostId,
  seats: r.seats.slice(),
  waitlist: r.waitlist.map((w) => ({ ...w })),
  offers: r.offers.map((o) => ({ ...o })),
});

const isSeatedOrOffered = (r: Room, id: string) => r.seats.includes(id) || r.offers.some((o) => o.playerId === id);

export function joinWaitlist(room: Room, id: string, notify = false): Room {
  const r = clone(room);
  if (!isSeatedOrOffered(r, id) && !r.waitlist.some((w) => w.id === id)) r.waitlist.push({ id, notify });
  return r;
}

export function leaveWaitlist(room: Room, id: string): Room {
  const r = clone(room);
  r.waitlist = r.waitlist.filter((w) => w.id !== id);
  return r;
}

export function setNotify(room: Room, id: string, on: boolean): Room {
  const r = clone(room);
  const w = r.waitlist.find((x) => x.id === id);
  if (w) w.notify = on;
  return r;
}

/** 1 = next up. null = not on the waitlist. */
export function waitlistPosition(room: Room, id: string): number | null {
  const i = room.waitlist.findIndex((w) => w.id === id);
  return i < 0 ? null : i + 1;
}

/**
 * Call when a game ends. Frees seats (losers + away players, only as many as there are people
 * online and waiting), sends losers to the back of the line, and offers the free seats.
 */
export function afterGame(
  room: Room, placingsBySeat: number[], losersLeave: number, now: number, isOnline: Online,
): { room: Room; events: RoomEvent[] } {
  const r = clone(room);
  const events: RoomEvent[] = [];

  const toNotify = r.waitlist.filter((w) => w.notify).map((w) => w.id);
  if (toNotify.length) events.push({ type: 'notifyGameOver', playerIds: toNotify });

  const readyWaiting = r.waitlist.filter((w) => isOnline(w.id)).length;
  if (readyWaiting === 0) return { room: r, events }; // nobody to take a seat: everyone stays

  // Away players get up first, then the worst finishers. Never the host.
  const away = r.seats
    .map((id, seat) => ({ id, seat }))
    .filter((s) => s.id && s.id !== r.hostId && !isOnline(s.id))
    .map((s) => s.seat);
  const worstFirst = placingsBySeat.slice().reverse().filter((seat) => r.seats[seat] && r.seats[seat] !== r.hostId && !away.includes(seat));
  const leaving = [
    ...away.map((seat) => ({ seat, reason: 'away' as const })),
    ...worstFirst.slice(0, Math.max(0, losersLeave)).map((seat) => ({ seat, reason: 'lost' as const })),
  ].slice(0, readyWaiting);

  const freed: number[] = [];
  const goingToBack: WaitlistEntry[] = [];
  for (const { seat, reason } of leaving) {
    const id = r.seats[seat]!;
    events.push({ type: 'gotUp', seat, playerId: id, reason });
    r.seats[seat] = null;
    goingToBack.push({ id, notify: false });
    freed.push(seat);
  }
  for (const seat of freed) offerNext(r, seat, now, isOnline, events);
  // Players who got up join the back AFTER the seats are offered, so they can't be handed their seat straight back.
  for (const e of goingToBack) if (!r.waitlist.some((w) => w.id === e.id)) r.waitlist.push(e);
  return { room: r, events };
}

function offerNext(r: Room, seat: number, now: number, isOnline: Online, events: RoomEvent[], skip: string[] = []) {
  const i = r.waitlist.findIndex((w) => isOnline(w.id) && !skip.includes(w.id));
  if (i < 0) return; // nobody ready: seat stays empty (bot can fill it)
  const [next] = r.waitlist.splice(i, 1);
  const offer = { seat, playerId: next.id, expiresAt: now + SEAT_OFFER_MS };
  r.offers.push(offer);
  events.push({ type: 'offer', ...offer });
}

/** The offered player tapped "Take my seat". */
export function acceptSeat(room: Room, id: string): { room: Room; events: RoomEvent[] } {
  const r = clone(room);
  const o = r.offers.find((x) => x.playerId === id);
  if (!o) return { room: r, events: [] };
  r.offers = r.offers.filter((x) => x !== o);
  r.seats[o.seat] = id;
  return { room: r, events: [{ type: 'seated', seat: o.seat, playerId: id }] };
}

/**
 * Run every few seconds while there are open offers (the "1-minute check").
 * Offers that ran out, or whose player went offline, go to the next person in line;
 * the person who missed it moves to the back of the waitlist.
 */
export function checkOffers(room: Room, now: number, isOnline: Online): { room: Room; events: RoomEvent[] } {
  const r = clone(room);
  const events: RoomEvent[] = [];
  const missed = r.offers.filter((o) => o.expiresAt <= now || !isOnline(o.playerId));
  for (const o of missed) {
    r.offers = r.offers.filter((x) => x !== o);
    events.push({ type: 'offerExpired', seat: o.seat, playerId: o.playerId });
    offerNext(r, o.seat, now, isOnline, events, missed.map((m) => m.playerId));
    r.waitlist.push({ id: o.playerId, notify: false });
  }
  return { room: r, events };
}

/** The next game can start once nobody is still deciding. Empty seats get bots. */
export const readyToStart = (room: Room) => room.offers.length === 0;
