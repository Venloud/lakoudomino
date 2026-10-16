import type { MatchState } from "lakou-engine";
import type { PersistedRoomState, PersistedSeatState, RoomMode, Seat } from "./room-types";

export type StoredRoomRecord = {
  code: string; hostName: string; mode: string; rowLength: number;
  playerCount?: 2 | 3 | 4; rowBoxes?: number;
  twoPlayerVariant?: "draw" | "split"; seed?: number;
  turnSeconds?: number; speed?: number; isPrivate?: boolean; playNow?: boolean;
  afkState?: PersistedRoomState["afkState"];
  status: string; seats: PersistedSeatState[];
  lastAction: string | null; engineState: MatchState | null;
  waitlist?: PersistedRoomState["waitlist"]; offers?: PersistedRoomState["offers"];
  lifecycleApplied?: boolean;
  activeMatchId?: string | null; statsRecorded?: boolean;
  matchParticipants?: PersistedRoomState["matchParticipants"];
  crownsEligible?: boolean;
  hostDisconnectedAt?: number | null;
};
export type PersistedRoomIssue = { path: string; message: string };
export class PersistedRoomRecoveryError extends Error {
  readonly code = "INVALID_PERSISTED_ROOM";
  constructor(readonly roomCode: string, readonly issues: PersistedRoomIssue[]) {
    super(`Cannot restore persisted room "${roomCode}": ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
    this.name = "PersistedRoomRecoveryError";
  }
}
export type RestoreRoomsResult = { rooms: PersistedRoomState[]; errors: PersistedRoomRecoveryError[] };
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function serializeRoom(room: PersistedRoomState): StoredRoomRecord {
  return {
    code: room.code, hostName: room.hostName, mode: room.mode, rowLength: room.rowLength,
    playerCount: room.playerCount, rowBoxes: room.rowBoxes,
    twoPlayerVariant: room.twoPlayerVariant, seed: room.seed, status: room.status,
    turnSeconds: room.turnSeconds ?? 30, isPrivate: room.isPrivate ?? false,
    speed: room.speed ?? 1, playNow: room.playNow ?? false, afkState: room.afkState,
    seats: room.seats.map((s) => ({
      seat: s.seat, status: s.status,
      ...(s.botLevel ? { botLevel: s.botLevel } : {}),
      name: s.name, reconnectTokenHash: s.reconnectTokenHash,
      userId: s.userId ?? null,
    })),
    lastAction: room.lastAction, engineState: room.engineState ?? null,
    waitlist: room.waitlist, offers: room.offers,
    lifecycleApplied: room.lifecycleApplied,
    activeMatchId: room.activeMatchId ?? null,
    statsRecorded: room.statsRecorded ?? false,
    matchParticipants: room.matchParticipants ?? [],
    crownsEligible: room.crownsEligible,
    hostDisconnectedAt: room.hostDisconnectedAt ?? null,
  };
}
export function restoreRoom(value: unknown): PersistedRoomState {
  if (!record(value)) throw new PersistedRoomRecoveryError("<unknown>", [{ path: "", message: "must be an object" }]);
  const issues: PersistedRoomIssue[] = [];
  const reqString = (key: string) => {
    if (typeof value[key] !== "string" || value[key] === "") issues.push({ path: key, message: "must be a non-empty string" });
  };
  reqString("code"); reqString("hostName");
  if (value.mode !== "regular" && value.mode !== "points") issues.push({ path: "mode", message: "must be regular or points" });
  if (typeof value.rowLength !== "number") issues.push({ path: "rowLength", message: "must be a number" });
  if (!["waiting", "playing", "finished"].includes(String(value.status))) issues.push({ path: "status", message: "invalid status" });
  if (!Array.isArray(value.seats) || value.seats.length !== 4) issues.push({ path: "seats", message: "must contain four seats" });
  if (value.speed !== undefined &&
    (typeof value.speed !== "number" || !Number.isFinite(value.speed) || value.speed <= 0)) {
    issues.push({ path: "speed", message: "must be a positive number" });
  }
  if (value.afkState !== undefined &&
    (!record(value.afkState) || !Array.isArray(value.afkState.timeouts) ||
      value.afkState.timeouts.length < 2 || value.afkState.timeouts.length > 4 ||
      !value.afkState.timeouts.every((timeout) => Number.isInteger(timeout) && Number(timeout) >= 0))) {
    issues.push({ path: "afkState", message: "must contain 2 to 4 non-negative integer timeout counts" });
  }
  if (value.engineState !== null && value.engineState !== undefined) {
    const match = value.engineState;
    if (!record(match) || !record(match.config) || !record(match.hand) ||
      !Array.isArray(match.scores) || !Array.isArray(match.scoreLog) ||
      typeof match.rngState !== "number" || typeof match.handsPlayed !== "number" ||
      typeof match.over !== "boolean") {
      issues.push({ path: "engineState", message: "must be a valid MatchState" });
    }
  }
  if (issues.length) throw new PersistedRoomRecoveryError(String(value.code ?? "<unknown>"), issues);
  const seats = value.seats as PersistedSeatState[];
  return {
    code: value.code as string, hostName: value.hostName as string, mode: value.mode as RoomMode,
    rowLength: value.rowLength as number, playerCount: value.playerCount as 2 | 3 | 4 | undefined,
    rowBoxes: value.rowBoxes as number | undefined, twoPlayerVariant: value.twoPlayerVariant as "draw" | "split" | undefined,
    seed: value.seed as number | undefined, status: value.status as PersistedRoomState["status"],
    turnSeconds: typeof value.turnSeconds === "number" ? value.turnSeconds : 30,
    speed: typeof value.speed === "number" ? value.speed : 1,
    isPrivate: typeof value.isPrivate === "boolean" ? value.isPrivate : Boolean(value.isPrivate ?? false),
    playNow: value.playNow === true,
    afkState: record(value.afkState) && Array.isArray(value.afkState.timeouts)
      ? { timeouts: value.afkState.timeouts as number[] }
      : undefined,
    seats: seats.map((s) => ({
      seat: s.seat as Seat, status: s.status,
      ...(s.botLevel === "easy" || s.botLevel === "hard" ? { botLevel: s.botLevel } : {}),
      name: s.name ?? null,
      reconnectTokenHash: s.reconnectTokenHash ?? null, userId: s.userId ?? null,
    })),
    lastAction: (value.lastAction as string | null) ?? null,
    engineState: (value.engineState as MatchState | null) ?? null,
    waitlist: Array.isArray(value.waitlist) ? (value.waitlist as unknown[]).map((entry) => {
      const item = record(entry) ? entry : {};
      return {
        id: typeof item.id === "string" ? item.id : "",
        ...(typeof item.name === "string" ? { name: item.name } : {}),
        notify: Boolean(item.notify),
        userId: typeof item.userId === "string" ? item.userId : null,
      };
    }).filter((entry) => entry.id) : [],
    offers: Array.isArray(value.offers) ? value.offers as PersistedRoomState["offers"] : [],
    lifecycleApplied: Boolean(value.lifecycleApplied),
    activeMatchId: typeof value.activeMatchId === "string" ? value.activeMatchId : null,
    statsRecorded: Boolean(value.statsRecorded),
    matchParticipants: Array.isArray(value.matchParticipants)
      ? value.matchParticipants.flatMap((entry) => {
        if (!record(entry) || ![0, 1, 2, 3].includes(Number(entry.seat))) return [];
        return [{
          seat: Number(entry.seat) as Seat,
          userId: typeof entry.userId === "string" ? entry.userId : null,
        }];
      })
      : [],
    crownsEligible: typeof value.crownsEligible === "boolean" ? value.crownsEligible : undefined,
    hostDisconnectedAt: typeof value.hostDisconnectedAt === "number" ? value.hostDisconnectedAt : null,
  };
}
export function restoreRooms(rows: readonly unknown[]): RestoreRoomsResult {
  const rooms: PersistedRoomState[] = [], errors: PersistedRoomRecoveryError[] = [];
  for (const row of rows) try { rooms.push(restoreRoom(row)); } catch (e) {
    if (e instanceof PersistedRoomRecoveryError) errors.push(e); else throw e;
  }
  return { rooms, errors };
}