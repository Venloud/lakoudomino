import type { AfkState, MatchState } from "lakou-engine";
export type RoomMode = "regular" | "points";
export type Seat = 0 | 1 | 2 | 3;

export type PersistedSeatState = {
  seat: Seat;
  status: "open" | "waiting" | "bot";
  botLevel?: "easy" | "hard";
  name: string | null;
  reconnectTokenHash: string | null;
  userId?: string | null;
};
export type PersistedWaitlistEntry = { id: string; name?: string; notify: boolean; userId?: string | null };
export type PersistedSeatOffer = {
  seat: number;
  playerId: string;
  expiresAt: number;
  name?: string;
  userId?: string | null;
};
export type PersistedMatchParticipant = { seat: Seat; userId: string | null };

export type PersistedRoomState = {
  code: string;
  hostName: string;
  mode: RoomMode;
  rowLength: number;
  playerCount?: 2 | 3 | 4;
  rowBoxes?: number;
  twoPlayerVariant?: "draw" | "split";
  turnSeconds?: number;
  speed?: number;
  isPrivate?: boolean;
  playNow?: boolean;
  afkState?: AfkState;
  seed?: number;
  status: "waiting" | "playing" | "finished";
  seats: PersistedSeatState[];
  lastAction: string | null;
  /** Engine state for rooms created after the Lakou migration. */
  engineState?: MatchState | null;
  waitlist: PersistedWaitlistEntry[];
  offers: PersistedSeatOffer[];
  /** Runtime-safe marker preventing afterGame from rotating the same match twice. */
  lifecycleApplied?: boolean;
  /** Durable idempotency key for Points-match awards, independent from lifecycle rotation. */
  activeMatchId?: string | null;
  statsRecorded?: boolean;
  matchParticipants?: PersistedMatchParticipant[];
  /** Whether this match started with at least two real players. Undefined means legacy/unknown. */
  crownsEligible?: boolean;
  /** Epoch milliseconds when the room last had no connected real player. */
  hostDisconnectedAt?: number | null;
};