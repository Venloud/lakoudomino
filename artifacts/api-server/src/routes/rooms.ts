import { Router, type IRouter, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  CreateRoomBody,
  CreateRoomResponse,
  FillRoomBotsParams,
  FillRoomBotsResponse,
  GetGameParams,
  GetGameResponse,
  GetRoomParams,
  GetRoomResponse,
  JoinRoomBody,
  JoinRoomParams,
  JoinRoomResponse,
  GetLobbyResponse,
  NextHandBody,
  NextHandParams,
  NextHandResponse,
  StartRoomParams,
  StartRoomResponse,
} from "@workspace/api-zod";
import type { Seat } from "../lib/room-types";
import { getIdentityFromCookieHeader, getIdentityFromRequest } from "../lib/auth-session";
import { getLeaderboard } from "../lib/leaderboard";
import {
  broadcastToLobbyClients,
  clearPresence,
  trackPresence,
  uniqueOnlinePlayerCount,
  updatePresence,
} from "../lib/presence";
import { recordPointsMatch } from "../lib/match-stats";
import { logger } from "../lib/logger";
import {
  applySocketAction,
  applySocketControlAction,
  createRoomMatch,
  publicView,
} from "../lib/lakou-engine-adapter.ts";
import {
  loadPersistedRooms,
  persistRoom,
  deletePersistedRoom,
  type PersistedRoomState,
} from "../lib/room-persistence";
import {
  emptySeats,
  gameSnapshot,
  hashReconnectToken,
  nextHandEligibility,
  nextHandSeatEligibility,
  resolveSeatForReconnect,
  SOCKET_AUTHENTICATION_ERROR,
  validateSocketMessage,
} from "../lib/room-protocol";
import {
  autoStep,
  acceptSeat,
  afterGame,
  checkOffers,
  createAfk,
  createQueue,
  isQueued,
  joinQueue,
  joinWaitlist,
  leaveQueue,
  QUEUE_WAIT_MS,
  leaveWaitlist,
  nextStep,
  onlyBotsLeft,
  queueStatus,
  readyToStart,
  recordTimeout,
  recordOwnPlay,
  startNextHand,
  setNotify,
  setBotsOk,
  startNow,
  countsForCrowns,
  tickQueue,
  timeoutMove,
  type GameEvent,
  type QueueMatch,
  type QueueMode,
  type SeatKind,
} from "lakou-engine";

type RoomState = PersistedRoomState & {
  connections: Map<Seat, Set<WebSocket>>;
  waitlistConnections: Map<string, Set<WebSocket>>;
  automationTimer?: ReturnType<typeof setTimeout>;
  nextHandTimer?: ReturnType<typeof setTimeout>;
  nextHandAt?: number | null;
  timerVersion: number;
  offerTimer?: ReturnType<typeof setInterval>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  statsRetryTimer?: ReturnType<typeof setTimeout>;
  spectatorConnections: Set<WebSocket>;
  lastEvents: unknown[];
  eventsKey: number;
  turnDeadline: number | null;
  turnMs: number | null;
  chatTimestamps: Map<string | WebSocket, number>;
};

const rooms = new Map<string, RoomState>();
const socketViewerIds = new WeakMap<WebSocket, string>();
type QueueMember = {
  name: string;
  userId: string | null;
  sockets: Set<WebSocket>;
  keepAliveUntil: number;
};
let playQueue = createQueue();
const queueMembers = new Map<string, QueueMember>();
let queueTimer: ReturnType<typeof setInterval> | undefined;
let queueTickBusy = false;

function issueReconnectToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function initializeRooms(): Promise<void> {
  if (queueTimer) clearInterval(queueTimer);
  queueTimer = undefined;
  queueTickBusy = false;
  playQueue = createQueue();
  queueMembers.clear();
  const persistedRooms = await loadPersistedRooms();
  for (const room of rooms.values()) {
    if (room.offerTimer) clearInterval(room.offerTimer);
    if (room.automationTimer) clearTimeout(room.automationTimer);
    if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    if (room.statsRetryTimer) clearTimeout(room.statsRetryTimer);
  }
  rooms.clear();
  persistedRooms.forEach((room) => {
    const runtime: RoomState = {
      ...room,
      connections: new Map(),
      waitlistConnections: new Map(),
      spectatorConnections: new Set(),
      lastEvents: [],
      eventsKey: 0,
      turnDeadline: null,
      turnMs: null,
      nextHandAt: null,
      timerVersion: 0,
      chatTimestamps: new Map(),
      afkState: room.afkState ?? createAfk(room.playerCount ?? 4),
      speed: room.speed ?? 1,
      playNow: room.playNow ?? false,
      lifecycleApplied: room.lifecycleApplied ?? Boolean(room.engineState?.over),
      activeMatchId: room.activeMatchId ?? null,
      statsRecorded: room.statsRecorded ?? false,
      matchParticipants: room.matchParticipants ?? [],
      hostDisconnectedAt: room.hostDisconnectedAt ?? null,
    };
    startOfferTimer(runtime);
    rooms.set(room.code, runtime);
  });
  for (const room of rooms.values()) {
    if (room.engineState?.over && !room.statsRecorded) {
      await applyAfterGame(room);
      await persistRoom(room);
    }
    scheduleRoomCleanup(room);
    scheduleNextGameStep(room);
    scheduleNextHand(room);
  }
}

function startOfferTimer(room: RoomState): void {
  if (room.offerTimer) clearInterval(room.offerTimer);
  room.offerTimer = setInterval(() => void processOffers(room), 5000);
}

function isOnline(room: RoomState, id: string): boolean {
  const seat = room.seats.find((candidate) => candidate.reconnectTokenHash === id);
  const seatedOnline = seat && [...(room.connections.get(seat.seat) ?? [])]
    .some((socket) => socket.readyState === WebSocket.OPEN);
  const waitlistedOnline = [...(room.waitlistConnections.get(id) ?? [])]
    .some((socket) => socket.readyState === WebSocket.OPEN);
  return Boolean(seatedOnline || waitlistedOnline);
}

function sendWaitlistEvent(
  room: RoomState,
  event: { type: "offer" | "offerExpired"; seat: number; playerId: string; expiresAt?: number },
): void {
  room.waitlistConnections.get(event.playerId)?.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: event.type,
        seat: event.seat,
        ...(event.type === "offer" ? { expiresAt: event.expiresAt } : {}),
      }));
    }
  });
}
async function processOffers(room: RoomState): Promise<void> {
  const names = new Map([
    ...room.waitlist.map((entry) => [entry.id, entry.name] as const),
    ...room.offers.map((entry) => [entry.playerId, entry.name] as const),
    ...room.seats.flatMap((entry) => entry.reconnectTokenHash ? [[entry.reconnectTokenHash, entry.name]] as const : []),
  ]);
  const userIds = new Map([
    ...room.waitlist.map((entry) => [entry.id, entry.userId ?? null] as const),
    ...room.offers.map((entry) => [entry.playerId, entry.userId ?? null] as const),
    ...room.seats.flatMap((entry) => entry.reconnectTokenHash
      ? [[entry.reconnectTokenHash, entry.userId ?? null]] as const
      : []),
  ]);
  const result = checkOffers(
    { hostId: room.seats[0]?.reconnectTokenHash ?? "", seats: room.seats.map((s) => s.reconnectTokenHash), waitlist: room.waitlist, offers: room.offers },
    Date.now(), (id) => isOnline(room, id),
  );
  if (!result.events.length) return;
  room.waitlist = result.room.waitlist.map((entry) => ({
    ...entry,
    ...(names.get(entry.id) ? { name: names.get(entry.id) ?? undefined } : {}),
    userId: userIds.get(entry.id) ?? null,
  }));
  room.offers = result.room.offers.map((offer) => ({
    ...offer, ...(names.get(offer.playerId) ? { name: names.get(offer.playerId) ?? undefined } : {}),
    userId: userIds.get(offer.playerId) ?? null,
  }));
  await persistRoom(room);
  for (const event of result.events) {
    if (event.type === "offer" || event.type === "offerExpired") sendWaitlistEvent(room, event);
  }
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join("");
  } while (rooms.has(code));
  return code;
}

function publicRoom(room: RoomState, reconnectToken: string | null = null) {
  return {
    code: room.code,
    hostName: room.hostName,
    reconnectToken,
    mode: room.mode,
    rowLength: room.rowLength,
    rowBoxes: room.rowBoxes ?? room.rowLength,
    playerCount: room.playerCount ?? 4,
    twoPlayerVariant: room.twoPlayerVariant ?? "draw",
    turnSeconds: room.turnSeconds ?? 30,
    isPrivate: room.isPrivate ?? false,
    status: room.status,
    seats: room.seats.map(({ seat, status, name }) => ({
      seat,
      status,
      name,
      tileCount: room.engineState?.hand.hands[seat]?.length ?? 0,
    })),
  };
}

function publicWaitlist(room: RoomState, meId: string | null = null) {
  return {
    entries: room.waitlist.map(({ id, name }) => ({ id, name: name || "Guest" })),
    meId,
    notify: meId ? Boolean(room.waitlist.find((entry) => entry.id === meId)?.notify) : false,
  };
}

function engineRoom(room: RoomState) {
  return {
    hostId: room.seats[0]?.reconnectTokenHash ?? "",
    seats: room.seats.map((s) => s.reconnectTokenHash),
    waitlist: room.waitlist.map(({ id, notify }) => ({ id, notify })),
    offers: room.offers,
  };
}

function dispatchRoomEvents(room: RoomState, events: readonly unknown[]): void {
  for (const event of events) {
    if (event && typeof event === "object" &&
      ((event as { type?: string }).type === "offer" ||
       (event as { type?: string }).type === "offerExpired")) {
      sendWaitlistEvent(room, event as { type: "offer" | "offerExpired"; seat: number; playerId: string; expiresAt?: number });
    }
  }
}

async function applyAfterGame(room: RoomState): Promise<boolean> {
  if (!room.engineState?.over) return true;
  if (room.mode === "points" && !room.statsRecorded) {
    if (!room.activeMatchId || room.crownsEligible !== true ||
        !(room.matchParticipants ?? []).some((participant) => participant.userId)) {
      logger.warn({ roomCode: room.code }, "Skipping Points awards because the match is not crown-eligible or has no signed-in participant");
      room.statsRecorded = true;
    } else {
      try {
        await recordPointsMatch({
          matchId: room.activeMatchId,
          roomCode: room.code,
          mode: room.mode,
          match: room.engineState,
          participants: room.matchParticipants ?? [],
        });
        room.statsRecorded = true;
      } catch (error) {
        logger.error({ err: error, roomCode: room.code }, "Could not persist completed Points match awards");
        if (!room.statsRetryTimer) {
          room.statsRetryTimer = setTimeout(() => {
            room.statsRetryTimer = undefined;
            void applyAfterGame(room).then(async (recorded) => {
              if (!recorded || rooms.get(room.code) !== room) return;
              await broadcastRoom(room);
              scheduleRoomCleanup(room);
            });
          }, 5000);
        }
        return false;
      }
    }
  }
  if (room.lifecycleApplied) return true;
  const lifecycle = afterGame(
    engineRoom(room),
    room.engineState.placings ?? room.engineState.hand.ranking ?? [],
    1,
    Date.now(),
    (candidate) => isOnline(room, candidate),
  );
  const names = new Map([
    ...room.waitlist.map((entry) => [entry.id, entry.name] as const),
    ...room.offers.map((entry) => [entry.playerId, entry.name] as const),
    ...room.seats.flatMap((entry) => entry.reconnectTokenHash ? [[entry.reconnectTokenHash, entry.name]] as const : []),
  ]);
  const userIds = new Map([
    ...room.waitlist.map((entry) => [entry.id, entry.userId ?? null] as const),
    ...room.offers.map((entry) => [entry.playerId, entry.userId ?? null] as const),
    ...room.seats.flatMap((entry) => entry.reconnectTokenHash
      ? [[entry.reconnectTokenHash, entry.userId ?? null]] as const
      : []),
  ]);
  room.waitlist = lifecycle.room.waitlist.map((entry) => ({
    ...entry, ...(names.get(entry.id) ? { name: names.get(entry.id) ?? undefined } : {}),
    userId: userIds.get(entry.id) ?? null,
  }));
  room.offers = lifecycle.room.offers.map((offer) => ({
    ...offer, ...(names.get(offer.playerId) ? { name: names.get(offer.playerId) ?? undefined } : {}),
    userId: userIds.get(offer.playerId) ?? null,
  }));
  lifecycle.events.filter((event) => event.type === "gotUp").forEach((event) => {
    room.seats[event.seat] = {
      seat: event.seat as Seat, status: "open", name: null, reconnectTokenHash: null, userId: null,
    };
  });
  if (room.engineState?.over) room.lifecycleApplied = true;
  dispatchRoomEvents(room, lifecycle.events);
  return true;
}

function getRoom(code: string): RoomState | undefined {
  return rooms.get(code.toUpperCase());
}

function lobbyState() {
  const activeRooms = [...rooms.values()];
  const tables = activeRooms.filter((room) => room.status === "waiting" &&
    !room.isPrivate && room.seats.slice(0, room.playerCount ?? 4).some((seat) => seat.status === "open"));
  return {
    tables: tables.map((room) => publicRoom(room)),
    onlinePlayers: uniqueOnlinePlayerCount(),
    tablesPlaying: activeRooms.filter((room) => room.engineState && !room.engineState.over).length,
    connected: true,
  };
}

function broadcastLobbyUpdate(): void {
  broadcastToLobbyClients({ type: "lobbyUpdate", ...lobbyState() });
}

function hasConnectedPlayer(room: RoomState): boolean {
  return [...room.connections.entries()].some(([seat, sockets]) =>
    room.seats[seat]?.status !== "bot" &&
    [...sockets].some((socket) => socket.readyState === WebSocket.OPEN),
  );
}

function isHostOnlyWaitingRoom(room: RoomState): boolean {
  const capacity = room.playerCount ?? 4;
  return room.status === "waiting" &&
    room.seats[0]?.status === "waiting" &&
    room.seats.slice(1, capacity).every((seat) => seat.status === "open");
}

async function removeRoom(room: RoomState): Promise<void> {
  if (rooms.get(room.code) !== room) return;
  rooms.delete(room.code);
  room.timerVersion += 1;
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.statsRetryTimer) clearTimeout(room.statsRetryTimer);
  if (room.offerTimer) clearInterval(room.offerTimer);
  if (room.automationTimer) clearTimeout(room.automationTimer);
  if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
  room.automationTimer = undefined;
  room.nextHandTimer = undefined;
  room.nextHandAt = null;
  room.turnDeadline = null;
  room.turnMs = null;
  const sockets = new Set<WebSocket>([
    ...[...room.connections.values()].flatMap((set) => [...set]),
    ...[...room.waitlistConnections.values()].flatMap((set) => [...set]),
    ...room.spectatorConnections,
  ]);
  for (const socket of sockets) {
    clearPresence(socket);
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Room was removed");
  }
  room.connections.clear();
  room.waitlistConnections.clear();
  room.spectatorConnections.clear();
  await deletePersistedRoom(room.code);
  broadcastLobbyUpdate();
}

function scheduleRoomCleanup(room: RoomState): void {
  if (rooms.get(room.code) !== room) return;
  if (onlyBotsLeft(room.seats.slice(0, room.playerCount ?? 4).map((seat) =>
    seat.status === "bot" ? (seat.botLevel ?? "easy") : seat.status === "waiting" ? "human" : "easy"))) {
    void removeRoom(room);
    return;
  }
  if (hasConnectedPlayer(room)) {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
    if (room.hostDisconnectedAt != null) {
      room.hostDisconnectedAt = null;
      void persistRoom(room);
    }
    return;
  }
  const startedAt = room.hostDisconnectedAt ?? Date.now();
  if (room.hostDisconnectedAt == null) {
    room.hostDisconnectedAt = startedAt;
    void persistRoom(room);
  }
  if (room.cleanupTimer) return;
  const remaining = Math.max(0, 2 * 60 * 1000 - (Date.now() - startedAt));
  if (remaining === 0) {
    void removeRoom(room);
    return;
  }
  room.cleanupTimer = setTimeout(() => {
    room.cleanupTimer = undefined;
    scheduleRoomCleanup(room);
  }, remaining);
}

function requireRoom(code: string, res: Response) {
  const room = getRoom(code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return undefined;
  }
  return room;
}


function sendSnapshot(socket: WebSocket, room: RoomState, seat: Seat | null, meId: string | null = null) {
  if (socket.readyState !== WebSocket.OPEN) return;
  const view = room.engineState ? publicView(room.engineState, seat) : null;
  socket.send(JSON.stringify({
    type: "snapshot",
    viewerId: socketViewerIds.get(socket) ?? null,
    playNow: room.playNow ?? false,
    game: room.engineState ? gameSnapshot(room, seat) : null,
    view,
    names: room.seats.map((entry) => entry.name || `Seat ${entry.seat + 1}`),
    waitlist: publicWaitlist(room, meId),
    roomSettings: {
      mode: room.mode,
      rowBoxes: room.rowBoxes ?? room.rowLength,
      turnSeconds: room.turnSeconds ?? 30,
      isPrivate: room.isPrivate ?? false,
      playerCount: room.playerCount ?? 4,
    },
    events: room.lastEvents,
    eventsKey: room.eventsKey,
    nextHandAt: room.nextHandAt ?? null,
    turnDeadline: room.turnDeadline,
    turnMs: room.turnMs,
  }));
}

function sendSocketError(socket: WebSocket, message: string) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "error", message }));
}

function clientPresenceId(requestUrl: URL): string {
  const value = requestUrl.searchParams.get("clientId") ?? "";
  return /^[A-Za-z0-9_-]{8,96}$/.test(value) ? value : randomBytes(12).toString("hex");
}

function queuePlayerId(userId: string | null | undefined, clientId: string): string {
  return userId ? `user:${userId}` : `guest:${clientId}`;
}

function sendQueueStatus(playerId: string): void {
  const message = JSON.stringify({ type: "queueStatus", status: queueStatus(playQueue, playerId, QUEUE_WAIT_MS, Date.now()) });
  queueMembers.get(playerId)?.sockets.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  });
}

function sendQueueError(playerId: string, message: string): void {
  queueMembers.get(playerId)?.sockets.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "queueError", message }));
    }
  });
}

function queuePlayerOnline(playerId: string, now: number): boolean {
  const member = queueMembers.get(playerId);
  return Boolean(member && (
    [...member.sockets].some((socket) => socket.readyState === WebSocket.OPEN) ||
    member.keepAliveUntil > now
  ));
}

async function createQueuedRoom(match: QueueMatch): Promise<void> {
  const players = match.players.map((id) => {
    const member = queueMembers.get(id);
    if (!member) throw new Error(`Queue member ${id} disappeared before room creation`);
    return { id, ...member, reconnectToken: issueReconnectToken() };
  });
  if (players.length === 0) return;

  const code = roomCode();
  const seats = emptySeats();
  players.forEach((player, seat) => {
    seats[seat] = {
      seat: seat as Seat,
      status: "waiting",
      name: player.name,
      reconnectTokenHash: hashReconnectToken(player.reconnectToken),
      userId: player.userId,
    };
  });
  for (let seat = players.length; seat < 4; seat += 1) {
    seats[seat] = {
      seat: seat as Seat,
      status: "bot",
      botLevel: match.seats[seat] === "hard" ? "hard" : "easy",
      name: `Bot ${seat + 1}`,
      reconnectTokenHash: null,
      userId: null,
    };
  }

  const started = createRoomMatch({
    mode: match.mode,
    playerCount: 4,
    rowBoxes: 10,
    twoPlayerVariant: "draw",
  });
  const room: RoomState = {
    code,
    hostName: players[0].name,
    mode: match.mode,
    rowLength: 10,
    playerCount: 4,
    rowBoxes: 10,
    twoPlayerVariant: "draw",
    turnSeconds: 30,
    speed: 1,
    isPrivate: false,
    playNow: true,
    status: "playing",
    seats,
    lastAction: "The tiles are dealt",
    engineState: started.match,
    waitlist: [],
    offers: [],
    connections: new Map(),
    waitlistConnections: new Map(),
    spectatorConnections: new Set(),
    lastEvents: started.events,
    eventsKey: 1,
    turnDeadline: null,
    turnMs: null,
    timerVersion: 0,
    chatTimestamps: new Map(),
    afkState: createAfk(4),
    activeMatchId: randomUUID(),
    lifecycleApplied: false,
    statsRecorded: false,
    matchParticipants: players.map((player, seat) => ({
      seat: seat as Seat,
      userId: player.userId,
    })),
    crownsEligible: countsForCrowns(match.seats),
    hostDisconnectedAt: null,
  };
  await persistRoom(room);
  rooms.set(code, room);
  startOfferTimer(room);
  try {
    await broadcastRoom(room);
  } catch (error) {
    rooms.delete(code);
    if (room.offerTimer) clearInterval(room.offerTimer);
    if (room.automationTimer) clearTimeout(room.automationTimer);
    await deletePersistedRoom(code).catch((cleanupError) => {
      logger.warn({ err: cleanupError, roomCode: code }, "Could not clean up a failed Play Now room creation");
    });
    throw error;
  }

  players.forEach((player, seat) => {
    const sockets = queueMembers.get(player.id)?.sockets;
    sockets?.forEach((socket) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "queueStatus", status: null }));
      socket.send(JSON.stringify({
        type: "queueMatch",
        roomCode: code,
        reconnectToken: player.reconnectToken,
        displayName: player.name,
        isHost: seat === 0,
        mode: match.mode,
      }));
    });
    queueMembers.delete(player.id);
  });
}

async function tickPlayQueue(): Promise<void> {
  if (queueTickBusy) return;
  queueTickBusy = true;
  try {
    const now = Date.now();
    const previousIds = playQueue.entries.map((entry) => entry.id);
    const result = tickQueue(playQueue, now, {
      isOnline: (id) => queuePlayerOnline(id, now),
    });
    playQueue = result.queue;
    const matched = new Set(result.matches.flatMap((match) => match.players));
    const stillQueued = new Set(playQueue.entries.map((entry) => entry.id));
    previousIds.forEach((id) => {
      if (!matched.has(id) && !stillQueued.has(id)) queueMembers.delete(id);
    });
    playQueue.entries.forEach((entry) => sendQueueStatus(entry.id));

    for (const match of result.matches) {
      try {
        await createQueuedRoom(match);
      } catch (error) {
        logger.error({ err: error, mode: match.mode, players: match.players }, "Could not create a Play Now table");
        match.players.forEach((id) => {
          sendQueueError(id, "We could not start that table. Please try Play now again.");
          queueMembers.delete(id);
        });
      }
    }
  } finally {
    queueTickBusy = false;
  }
}

function startQueueTimer(): void {
  if (queueTimer) return;
  queueTimer = setInterval(() => void tickPlayQueue(), 1000);
}

async function handleLobbySocket(socket: WebSocket, request: IncomingMessage): Promise<void> {
  const requestUrl = new URL(request.url ?? "/ws", `http://${request.headers.host ?? "localhost"}`);
  const clientId = clientPresenceId(requestUrl);
  const identity = await getIdentityFromCookieHeader(request.headers.cookie);
  if (socket.readyState !== WebSocket.OPEN) return;
  const playerId = queuePlayerId(identity?.userId, clientId);
  const member = queueMembers.get(playerId);
  if (member && isQueued(playQueue, playerId)) {
    member.sockets.add(socket);
    member.keepAliveUntil = 0;
  }
  trackPresence(socket, {
    identityKey: identity ? `user:${identity.userId}` : `guest:${clientId}`,
    userId: identity?.userId ?? null,
    username: identity?.username ?? null,
    client: "lobby",
    status: "lobby",
  });
  socket.send(JSON.stringify({ type: "lobbyUpdate", ...lobbyState() }));
  socket.send(JSON.stringify({ type: "queueStatus", status: queueStatus(playQueue, playerId, QUEUE_WAIT_MS, Date.now()) }));
  startQueueTimer();
  socket.on("message", (raw) => {
    let event: unknown;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      socket.send(JSON.stringify({ type: "queueError", message: "That lobby request was not understood." }));
      return;
    }
    if (!event || typeof event !== "object") return;
    const message = event as { type?: unknown; mode?: unknown; displayName?: unknown; botsOk?: unknown };
    if (message.type === "playNow") {
      if (message.mode !== "points" && message.mode !== "regular") {
        socket.send(JSON.stringify({ type: "queueError", message: "Choose Points or Regular to join the queue." }));
        return;
      }
      const name = (identity?.username ||
        (typeof message.displayName === "string" ? message.displayName.trim().slice(0, 24) : "") ||
        "Guest").slice(0, 24);
      const existing = queueMembers.get(playerId);
      const queueMember: QueueMember = existing ?? {
        name,
        userId: identity?.userId ?? null,
        sockets: new Set(),
        keepAliveUntil: 0,
      };
      queueMember.name = name;
      queueMember.userId = identity?.userId ?? null;
      queueMember.keepAliveUntil = 0;
      queueMember.sockets.add(socket);
      queueMembers.set(playerId, queueMember);
      playQueue = joinQueue(playQueue, playerId, message.mode as QueueMode, Date.now());
      sendQueueStatus(playerId);
      return;
    }
    if (message.type === "leaveQueue") {
      const sockets = new Set(queueMembers.get(playerId)?.sockets ?? []);
      sockets.add(socket);
      playQueue = leaveQueue(playQueue, playerId);
      queueMembers.delete(playerId);
      const response = JSON.stringify({ type: "queueStatus", status: null });
      sockets.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(response);
      });
      return;
    }
    if (message.type === "toggleBots" && typeof message.botsOk === "boolean") {
      playQueue = setBotsOk(playQueue, playerId, message.botsOk, Date.now());
      sendQueueStatus(playerId);
      return;
    }
    if (message.type === "startNow") {
      playQueue = startNow(playQueue, playerId);
      sendQueueStatus(playerId);
    }
  });
  socket.on("close", () => {
    const queueMember = queueMembers.get(playerId);
    queueMember?.sockets.delete(socket);
    if (queueMember && ![...queueMember.sockets].some((client) => client.readyState === WebSocket.OPEN) &&
        queueMember.keepAliveUntil <= Date.now()) {
      playQueue = leaveQueue(playQueue, playerId);
      queueMembers.delete(playerId);
    }
    clearPresence(socket);
    broadcastLobbyUpdate();
  });
}

function broadcastChat(room: RoomState, seat: Seat | null, text: string, name: string, senderId: string): void {
  const message = {
    type: "chat",
    message: {
      id: `${Date.now()}-${seat}-${Math.random().toString(36).slice(2, 8)}`,
      seat,
      name,
      senderId,
      text,
      sentAt: new Date().toISOString(),
    },
  };
  room.connections.forEach((sockets) => {
    sockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    });
  });
  room.spectatorConnections.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  });
  room.waitlistConnections.forEach((sockets) => {
    sockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    });
  });
}

async function broadcastRoom(room: RoomState): Promise<void> {
  scheduleNextHand(room);
  await persistRoom(room);
  room.connections.forEach((sockets, seat) => {
    sockets.forEach((socket) => {
      updatePresence(socket, {
        status: room.engineState && !room.engineState.over ? "game" : "lobby",
        detail: room.mode === "points" ? "Points table" : "Regular table",
        roomCode: room.engineState && !room.engineState.over ? room.code : undefined,
      });
      sendSnapshot(socket, room, seat, room.seats[seat]?.reconnectTokenHash ?? null);
    });
  });
  room.spectatorConnections.forEach((socket) => {
    updatePresence(socket, { status: "online", detail: undefined, roomCode: undefined });
    sendSnapshot(socket, room, null);
  });
  room.waitlistConnections.forEach((sockets, id) => {
    sockets.forEach((socket) => {
      updatePresence(socket, { status: "online", detail: undefined, roomCode: undefined });
      sendSnapshot(socket, room, null, id);
    });
  });
  scheduleNextGameStep(room);
  broadcastLobbyUpdate();
}

function cancelGameTimer(room: RoomState): void {
  if (room.automationTimer) clearTimeout(room.automationTimer);
  room.automationTimer = undefined;
  room.timerVersion += 1;
  room.turnDeadline = null;
  room.turnMs = null;
}

const NEXT_HAND_DELAY_MS = 13_000;

function clearNextHandTimer(room: RoomState): void {
  if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
  room.nextHandTimer = undefined;
  room.nextHandAt = null;
}

function scheduleNextHand(room: RoomState): void {
  const match = room.engineState;
  if (rooms.get(room.code) !== room || !match?.hand.over || match.over) {
    if (room.nextHandTimer || room.nextHandAt != null) clearNextHandTimer(room);
    return;
  }
  if (room.nextHandTimer) return;

  room.nextHandAt = Date.now() + NEXT_HAND_DELAY_MS;
  room.nextHandTimer = setTimeout(() => {
    room.nextHandTimer = undefined;
    void startNextHandForRoom(room, "auto").catch((error) => {
      logger.error({ err: error, roomCode: room.code }, "Automatic next hand start failed");
    });
  }, NEXT_HAND_DELAY_MS);
}

async function startNextHandForRoom(
  room: RoomState,
  requester: Seat | "auto",
  socket?: WebSocket,
): Promise<{ started: true } | { started: false; reason: string }> {
  const requesterName = String(requester);
  logger.info(
    { roomCode: room.code, seat: requester },
    `nextHand requested by ${requesterName} in room ${room.code}`,
  );

  if (requester !== "auto") {
    const eligibility = nextHandSeatEligibility(room, requester);
    if (!eligibility.allowed) {
      logger.warn(
        { roomCode: room.code, seat: requester, reason: eligibility.reason },
        `Rejected nextHand request by ${requesterName} in room ${room.code}`,
      );
      if (socket) sendSocketError(socket, eligibility.reason);
      return { started: false, reason: eligibility.reason };
    }
  }

  const match = room.engineState;
  if (!match?.hand.over || match.over) {
    const reason = match?.over
      ? "The match has already ended"
      : "The current hand is already running";
    logger.warn(
      { roomCode: room.code, seat: requester, reason },
      `Rejected nextHand request by ${requesterName} in room ${room.code}`,
    );
    if (socket) sendSocketError(socket, reason);
    return { started: false, reason };
  }

  clearNextHandTimer(room);
  cancelGameTimer(room);
  const result = startNextHand(match);
  room.engineState = result.match;
  room.afkState = createAfk(room.playerCount ?? 4);
  room.status = "playing";
  room.lifecycleApplied = false;
  room.lastEvents = result.events;
  room.eventsKey += 1;
  room.lastAction = `Hand ${result.match.hand.number} started`;
  const handNumber = result.match.hand.number;
  logger.info({ roomCode: room.code, handNumber }, `hand ${handNumber} started`);
  await broadcastRoom(room);
  return { started: true };
}

function seatKinds(room: RoomState): SeatKind[] {
  return room.seats.map((seat) => seat.status === "bot" ? seat.botLevel ?? "easy" : "human");
}

function scheduleNextGameStep(room: RoomState): void {
  if (!room.engineState || rooms.get(room.code) !== room || room.automationTimer) return;
  const step = nextStep(room.engineState, seatKinds(room), room.lastEvents as GameEvent[], {
    turnMs: (room.turnSeconds ?? 30) * 1000,
    speed: room.speed ?? 1,
    afk: room.afkState ?? (room.afkState = createAfk(room.playerCount ?? 4)),
  });
  if (step.type === "none") {
    room.turnDeadline = null;
    room.turnMs = null;
    return;
  }
  if (room.status !== "playing") return;

  room.turnDeadline = null;
  room.turnMs = null;
  const version = ++room.timerVersion;
  logger.info({
    roomCode: room.code,
    type: step.type,
    seat: step.seat,
    delayMs: step.delayMs,
  }, "Scheduled Lakou game step");
  room.automationTimer = setTimeout(() => {
    void runScheduledGameStep(room, step, version);
  }, step.delayMs);
}

async function runScheduledGameStep(
  room: RoomState,
  step: Exclude<ReturnType<typeof nextStep>, { type: "none" }>,
  version: number,
): Promise<void> {
  if (version !== room.timerVersion || rooms.get(room.code) !== room) return;
  room.automationTimer = undefined;
  if (!room.engineState || room.status !== "playing") return;

  if (step.type === "human") {
    if (room.engineState.hand.turn !== step.seat) {
      scheduleNextGameStep(room);
      return;
    }
    room.turnMs = step.turnMs;
    room.turnDeadline = Date.now() + step.turnMs;
    logger.info({
      roomCode: room.code,
      type: "human-turn",
      seat: step.seat,
      delayMs: step.turnMs,
    }, "Started Lakou human turn timer");
    room.automationTimer = setTimeout(() => {
      void expireHumanTurn(room, step.seat as Seat, version);
    }, step.turnMs);
    await broadcastRoom(room);
    return;
  }

  const result = autoStep(room.engineState, seatKinds(room));
  if (!result) {
    logger.error({
      roomCode: room.code,
      type: step.type,
      seat: step.seat,
      delayMs: step.delayMs,
    }, "Scheduled Lakou automatic step could not be applied");
    return;
  }
  room.engineState = result.match;
  room.lastEvents = result.events;
  room.lastAction = result.action.type === "play"
    ? `${room.seats[step.seat]?.name ?? `Seat ${step.seat + 1}`} played ${result.action.tile[0]}-${result.action.tile[1]}`
    : `${room.seats[step.seat]?.name ?? `Seat ${step.seat + 1}`} ${result.action.type === "pass" ? "passed" : "drew a tile"}`;
  room.eventsKey += 1;
  room.turnDeadline = null;
  room.turnMs = null;
  room.status = room.engineState.over || room.engineState.hand.over ? "finished" : "playing";
  await applyAfterGame(room);
  if (room.status === "finished") scheduleRoomCleanup(room);
  await broadcastRoom(room);
}

async function expireHumanTurn(room: RoomState, seat: Seat, version: number): Promise<void> {
  if (version !== room.timerVersion || rooms.get(room.code) !== room) return;
  room.automationTimer = undefined;
  if (!room.engineState || room.status !== "playing" || room.engineState.hand.turn !== seat) return;

  const result = timeoutMove(room.engineState);
  room.engineState = result.match;
  room.lastEvents = result.events;
  room.eventsKey += 1;
  room.turnDeadline = null;
  room.turnMs = null;
  room.lastAction = `${room.seats[seat]?.name ?? `Seat ${seat + 1}`} missed the timer; an automatic move was played`;

  const afk = recordTimeout(
    room.afkState ?? createAfk(room.playerCount ?? 4),
    seat,
    (room.turnSeconds ?? 30) * 1000,
  );
  room.afkState = afk.afk;
  if (afk.replacedByBot) replaceTimedOutSeat(room, seat);
  room.status = room.engineState.over || room.engineState.hand.over ? "finished" : "playing";
  await applyAfterGame(room);

  const activeKinds = seatKinds(room).slice(0, room.playerCount ?? 4);
  if (onlyBotsLeft(activeKinds)) {
    logger.info({ roomCode: room.code, seat, delayMs: 0 }, "Closing Lakou room after all human seats were replaced");
    await removeRoom(room);
    return;
  }
  if (room.status === "finished") scheduleRoomCleanup(room);
  await broadcastRoom(room);
}

function replaceTimedOutSeat(room: RoomState, seat: Seat): void {
  const entry = room.seats[seat];
  const playerName = entry?.name || `Seat ${seat + 1}`;
  const message = "You were away too long, a bot finished your game.";
  const sockets = [...(room.connections.get(seat) ?? [])];
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "afkReplaced", message }));
      clearPresence(socket);
      socket.close(1000, "A bot took your seat after repeated timeouts");
    }
  }
  room.connections.delete(seat);
  room.seats[seat] = {
    ...entry,
    status: "bot",
    botLevel: "hard",
    name: `${playerName} (bot)`,
    userId: null,
    reconnectTokenHash: null,
  };
  room.matchParticipants = (room.matchParticipants ?? []).map((participant) =>
    participant.seat === seat ? { ...participant, userId: null } : participant,
  );
  room.lastAction = `A bot took ${playerName}'s seat after repeated timeouts`;
  logger.warn({ roomCode: room.code, seat, delayMs: 0 }, "Replaced inactive Lakou player with a bot");
}

async function handleSocket(socket: WebSocket, request: IncomingMessage): Promise<void> {
  const requestUrl = new URL(
    request.url ?? "/ws",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const room = getRoom(requestUrl.searchParams.get("code") ?? "");
  const identity = await getIdentityFromCookieHeader(request.headers.cookie);
  const clientId = clientPresenceId(requestUrl);
  const viewerId = randomUUID();
  socketViewerIds.set(socket, viewerId);
  let seat: Seat | undefined;
  let waitlistIdentity: string | undefined;
  let spectator = false;
  let displayName = "Viewer";

  if (!room) {
    sendSocketError(socket, "Room not found");
    socket.close();
    return;
  }

  socket.on("message", async (raw) => {
    const rawText = raw.toString();
    const validation = validateSocketMessage(rawText, seat);
    if (!validation.ok) {
      let attemptedNextHand = false;
      try {
        attemptedNextHand = JSON.parse(rawText)?.type === "nextHand";
      } catch { /* malformed messages are reported by the protocol validator */ }
      if (attemptedNextHand) {
        const requesterName = seat === undefined ? "unknown" : String(seat);
        logger.info(
          { roomCode: room.code, seat: seat ?? null },
          `nextHand requested by ${requesterName} in room ${room.code}`,
        );
        logger.warn(
          { roomCode: room.code, seat: seat ?? null, reason: validation.error },
          `Rejected nextHand request by ${requesterName} in room ${room.code}`,
        );
      }
      sendSocketError(socket, validation.error);
      return;
    }
    const event = validation.event;
    if (event.type === "hello") {
      const matchingSeat = event.reconnectToken
        ? resolveSeatForReconnect(room.seats, event.reconnectToken)
        : undefined;
      displayName = identity?.username || event.displayName?.trim().slice(0, 24) || "Viewer";
      if (!event.reconnectToken) {
        spectator = true;
        room.spectatorConnections.add(socket);
        trackPresence(socket, {
          identityKey: identity ? `user:${identity.userId}` : `guest:${clientId}`,
          userId: identity?.userId ?? null,
          username: identity?.username ?? displayName,
          client: "room",
          status: "online",
          detail: "Watching a table",
        });
        sendSnapshot(socket, room, null);
        broadcastLobbyUpdate();
        return;
      }
      if (matchingSeat === undefined) {
        const identityHash = hashReconnectToken(event.reconnectToken);
        if (!room.waitlist.some((entry) => entry.id === identityHash) &&
            !room.offers.some((offer) => offer.playerId === identityHash)) {
          sendSocketError(socket, "That reconnect token is not valid for this room");
          return;
        }
        waitlistIdentity = identityHash;
        const waitingSockets = room.waitlistConnections.get(identityHash) ?? new Set<WebSocket>();
        waitingSockets.add(socket);
        room.waitlistConnections.set(identityHash, waitingSockets);
        trackPresence(socket, {
          identityKey: identity ? `user:${identity.userId}` : `guest:${clientId}`,
          userId: identity?.userId ?? null,
          username: identity?.username ?? displayName,
          client: "room",
          status: room.engineState && !room.engineState.over ? "online" : "lobby",
          detail: "Waiting for a seat",
        });
        sendSnapshot(socket, room, null, identityHash);
        const offer = room.offers.find((candidate) => candidate.playerId === identityHash);
        if (offer) socket.send(JSON.stringify({ type: "offer", seat: offer.seat, expiresAt: offer.expiresAt }));
        broadcastLobbyUpdate();
        return;
      }
      if (waitlistIdentity) {
        const waitingSockets = room.waitlistConnections.get(waitlistIdentity);
        waitingSockets?.delete(socket);
        if (!waitingSockets?.size) room.waitlistConnections.delete(waitlistIdentity);
        waitlistIdentity = undefined;
      }
      seat = matchingSeat as Seat;
      if (!room.seats[seat].userId && identity?.userId) room.seats[seat].userId = identity.userId;
      const sockets = room.connections.get(seat) ?? new Set<WebSocket>();
      sockets.add(socket);
      room.connections.set(seat, sockets);
      trackPresence(socket, {
        identityKey: room.seats[seat].userId
          ? `user:${room.seats[seat].userId}`
          : `guest:${clientId}`,
        userId: room.seats[seat].userId ?? null,
        username: room.seats[seat].name ?? identity?.username ?? displayName,
        client: "room",
        status: room.engineState && !room.engineState.over ? "game" : "lobby",
        detail: room.mode === "points" ? "Points table" : "Regular table",
        roomCode: room.engineState && !room.engineState.over ? room.code : undefined,
      });
      scheduleRoomCleanup(room);
      sendSnapshot(socket, room, seat);
      await broadcastRoom(room);
      return;
    }

    if (event.type === "chat") {
      const identity = seat === undefined
        ? socket
        : room.seats[seat]?.reconnectTokenHash ?? `seat:${seat}`;
      const now = Date.now();
      const previous = room.chatTimestamps.get(identity) ?? 0;
      if (now - previous < 1000) {
        sendSocketError(socket, "Please wait a moment before sending another message.");
        return;
      }
      room.chatTimestamps.set(identity, now);
      const speaker = seat === undefined ? displayName : (room.seats[seat]?.name || `Seat ${seat + 1}`);
      broadcastChat(room, seat ?? null, event.text, speaker, viewerId);
      return;
    }
    if (event.type === "changeSettings") {
      if (seat !== 0 || room.status !== "waiting") {
        sendSocketError(socket, "Only the host can change settings while waiting");
        return;
      }
      if (![15, 30, 45, 60].includes(event.turnSeconds) || event.rowBoxes < 5 || event.rowBoxes > 20) {
        sendSocketError(socket, "Choose a row length from 5 to 20 and a 15, 30, 45, or 60 second timer");
        return;
      }
      if (event.mode === "points" && (room.playerCount ?? 4) !== 4) {
        sendSocketError(socket, "Points games require four seats");
        return;
      }
      room.mode = event.mode;
      room.rowBoxes = event.rowBoxes;
      room.rowLength = event.rowBoxes;
      room.turnSeconds = event.turnSeconds;
      room.isPrivate = event.isPrivate;
      await broadcastRoom(room);
      return;
    }
    if (event.type === "nextHand") {
      if (seat === undefined) {
        sendSocketError(socket, "Only a seated player can start the next hand");
        return;
      }
      await startNextHandForRoom(room, seat, socket);
      return;
    }
    if (event.type === "playAgain") {
      if (room.playNow && seat !== undefined) {
        const playerId = queuePlayerId(room.seats[seat]?.userId, clientId);
        const existing = queueMembers.get(playerId);
        const member: QueueMember = existing ?? {
          name: room.seats[seat]?.name || displayName,
          userId: room.seats[seat]?.userId ?? null,
          sockets: new Set(),
          keepAliveUntil: 0,
        };
        member.name = room.seats[seat]?.name || member.name;
        member.userId = room.seats[seat]?.userId ?? null;
        member.sockets.add(socket);
        member.keepAliveUntil = Date.now() + 15_000;
        queueMembers.set(playerId, member);
        playQueue = joinQueue(playQueue, playerId, room.mode as QueueMode, Date.now());
        sendQueueStatus(playerId);
        socket.send(JSON.stringify({ type: "queueing", mode: room.mode }));
        return;
      }
      if (seat !== 0) {
        sendSocketError(socket, "Only the host can start another match.");
        return;
      }
      if (!room.engineState?.over || !readyToStart(engineRoom(room))) {
        sendSocketError(socket, "The table is waiting for seat offers to be decided.");
        return;
      }
      const capacity = room.playerCount ?? 4;
      room.seats.forEach((entry, index) => {
        if (index < capacity && entry.status === "open") {
          entry.status = "bot";
          entry.botLevel = "easy";
          entry.name = `Bot ${index + 1}`;
          entry.userId = null;
        }
      });
      const started = createRoomMatch({
        mode: room.mode,
        playerCount: room.playerCount ?? 4,
        rowBoxes: room.rowBoxes ?? room.rowLength,
        twoPlayerVariant: room.twoPlayerVariant ?? "draw",
      });
      room.engineState = started.match;
      room.afkState = createAfk(capacity);
      room.status = "playing";
      room.lifecycleApplied = false;
      room.activeMatchId = randomUUID();
      room.statsRecorded = false;
      room.matchParticipants = room.seats.slice(0, capacity).map((entry) => ({
        seat: entry.seat,
        userId: entry.userId ?? null,
      }));
      room.crownsEligible = countsForCrowns(room.seats.slice(0, capacity).map((entry) =>
        entry.status === "bot" ? (entry.botLevel ?? "easy") : "human"));
      room.hostDisconnectedAt = null;
      room.lastAction = "The host started another match";
      room.lastEvents = started.events;
      room.eventsKey += 1;
      cancelGameTimer(room);
      await broadcastRoom(room);
      return;
    }
    if (seat === undefined) {
      sendSocketError(socket, SOCKET_AUTHENTICATION_ERROR);
      return;
    }
    if (!room.engineState) {
      sendSocketError(socket, "This room has no active engine match");
      return;
    }
    try {
      if (event.type === "play") {
        const result = applySocketAction(room.engineState, seat, event.tileId, event.side);
        room.engineState = result.match;
        room.lastEvents = result.events;
        room.lastAction = `${room.seats[seat].name ?? `Seat ${seat + 1}`} played ${event.tileId}`;
      } else {
        const result = applySocketControlAction(room.engineState, seat, event.type);
        room.engineState = result.match;
        room.lastEvents = result.events;
        room.lastAction = `${room.seats[seat].name ?? `Seat ${seat + 1}`} ${event.type === "pass" ? "passed" : "drew a tile"}`;
      }
      room.afkState = recordOwnPlay(
        room.afkState ?? createAfk(room.playerCount ?? 4),
        seat,
      );
      room.status = room.engineState.over || room.engineState.hand.over ? "finished" : "playing";
      room.eventsKey += 1;
      cancelGameTimer(room);
      await applyAfterGame(room);
    } catch (error) {
      sendSocketError(socket, error instanceof Error ? error.message : "That move was not legal");
      return;
    }
    if (room.status === "finished") scheduleRoomCleanup(room);
    await broadcastRoom(room);
  });

  socket.on("close", () => {
    if (seat !== undefined) room.connections.get(seat)?.delete(socket);
    if (spectator) room.spectatorConnections.delete(socket);
    if (waitlistIdentity) {
      const waitingSockets = room.waitlistConnections.get(waitlistIdentity);
      waitingSockets?.delete(socket);
      if (!waitingSockets?.size) room.waitlistConnections.delete(waitlistIdentity);
    }
    if (seat !== undefined) {
      const playerId = queuePlayerId(room.seats[seat]?.userId, clientId);
      const member = queueMembers.get(playerId);
      member?.sockets.delete(socket);
      if (member && ![...member.sockets].some((client) => client.readyState === WebSocket.OPEN) &&
          member.keepAliveUntil <= Date.now()) {
        playQueue = leaveQueue(playQueue, playerId);
        queueMembers.delete(playerId);
      }
    }
    clearPresence(socket);
    scheduleRoomCleanup(room);
    broadcastLobbyUpdate();
  });
}

export function attachRoomWebSocket(server: HttpServer) {
  startQueueTimer();
  const webSocketServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      const upgradedUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (upgradedUrl.searchParams.get("lobby") === "1") {
        void handleLobbySocket(client, request);
      } else {
        void handleSocket(client, request);
      }
    });
  });
}

const router: IRouter = Router();

router.post("/rooms", async (req, res) => {
  const input = CreateRoomBody.parse(req.body);
  const identity = await getIdentityFromRequest(req);
  if (input.mode === "points" && input.playerCount !== 4) {
    res.status(409).json({ error: "Points games require four seats" });
    return;
  }
  const code = roomCode();
  const reconnectToken = issueReconnectToken();
  const seats = emptySeats();
  seats[0] = {
    ...seats[0],
    status: "waiting",
    name: input.displayName.trim(),
    reconnectTokenHash: hashReconnectToken(reconnectToken),
    userId: identity?.userId ?? null,
  };
  const room: RoomState = {
    code,
    hostName: input.displayName.trim(),
    mode: input.mode,
    rowLength: input.rowLength,
    playerCount: input.playerCount,
    rowBoxes: input.rowBoxes,
    twoPlayerVariant: input.twoPlayerVariant,
    turnSeconds: input.turnSeconds ?? 30,
    speed: 1,
    isPrivate: input.isPrivate ?? false,
    playNow: false,
    status: "waiting",
    seats,
    lastAction: null,
    engineState: null,
    waitlist: [],
    offers: [],
    connections: new Map(),
    waitlistConnections: new Map(),
    spectatorConnections: new Set(),
    lastEvents: [],
    eventsKey: 0,
    turnDeadline: null,
    turnMs: null,
    timerVersion: 0,
    chatTimestamps: new Map(),
    afkState: createAfk(input.playerCount ?? 4),
    activeMatchId: null,
    statsRecorded: false,
    matchParticipants: [],
    hostDisconnectedAt: null,
  };
  rooms.set(code, room);
  startOfferTimer(room);
  await persistRoom(room);
  scheduleRoomCleanup(room);
  broadcastLobbyUpdate();
  res
    .status(201)
    .json(CreateRoomResponse.parse(publicRoom(room, reconnectToken)));
});

router.get("/rooms/:code", (req, res) => {
  const params = GetRoomParams.parse(req.params);
  const room = requireRoom(params.code, res);
  if (!room) return;
  res.json(GetRoomResponse.parse(publicRoom(room)));
});

router.post("/rooms/:code", async (req, res) => {
  const params = JoinRoomParams.parse(req.params);
  const input = JoinRoomBody.parse(req.body);
  const identity = await getIdentityFromRequest(req);
  const room = requireRoom(params.code, res);
  if (!room) return;
  if (room.status !== "waiting") {
    res.status(409).json({ error: "This room has already started; join the waitlist instead" });
    return;
  }
  const displayName = input.displayName.trim();
  const existing = room.seats.find(
    (seat) => seat.name?.toLowerCase() === displayName.toLowerCase(),
  );
  if (existing) {
    res.status(409).json({ error: "That display name is already in the room" });
    return;
  }
  const capacity = room.playerCount ?? 4;
  const seat = room.seats.find(
    (candidate) => candidate.seat < capacity && candidate.status === "open",
  );
  if (!seat) {
    res.status(409).json({ error: "This room is full" });
    return;
  }
  seat.status = "waiting";
  seat.name = displayName;
  seat.userId = identity?.userId ?? null;
  const reconnectToken = issueReconnectToken();
  seat.reconnectTokenHash = hashReconnectToken(reconnectToken);
  await persistRoom(room);
  await broadcastRoom(room);
  res.json(JoinRoomResponse.parse(publicRoom(room, reconnectToken)));
});

router.get("/lobby", async (req, res) => {
  const identity = await getIdentityFromRequest(req);
  const leaderboard = await getLeaderboard(identity?.userId ?? null);
  res.json(GetLobbyResponse.parse({
    ...lobbyState(),
    leaderboard,
  }));
});

router.post("/rooms/:code/bots", async (req, res) => {
  const params = FillRoomBotsParams.parse(req.params);
  const room = requireRoom(params.code, res);
  if (!room) return;
  if (resolveSeatForReconnect(room.seats, req.body?.reconnectToken ?? "") !== 0) {
    res.status(403).json({ error: "Only the host can fill this room" });
    return;
  }
  const capacity = room.playerCount ?? 4;
  room.seats.forEach((seat, index) => {
    if (index < capacity && seat.status === "open") {
      seat.status = "bot";
      seat.botLevel = "easy";
      seat.name = `Bot ${index + 1}`;
      seat.userId = null;
    }
  });
  await persistRoom(room);
  broadcastLobbyUpdate();
  res.json(FillRoomBotsResponse.parse(publicRoom(room)));
});

router.post("/rooms/:code/start", async (req, res) => {
  const params = StartRoomParams.parse(req.params);
  const room = requireRoom(params.code, res);
  if (!room) return;
  if (resolveSeatForReconnect(room.seats, req.body?.reconnectToken ?? "") !== 0) {
    res.status(403).json({ error: "Only the host can start this room" });
    return;
  }
  if (room.status !== "waiting") {
    res.status(409).json({ error: "This room has already started" });
    return;
  }
  const capacity = room.playerCount ?? 4;
  if (room.mode === "points" && capacity !== 4) {
    res.status(409).json({ error: "Points games require four seats" });
    return;
  }
  if (room.seats.slice(0, capacity).some((seat) => seat.status === "open")) {
    res.status(409).json({ error: `${capacity} seats are required to start` });
    return;
  }

  const started = createRoomMatch({
    mode: room.mode,
    playerCount: room.playerCount ?? 4,
    rowBoxes: room.rowBoxes ?? room.rowLength,
    twoPlayerVariant: room.twoPlayerVariant ?? "draw",
  });
  room.engineState = started.match;
  room.afkState = createAfk(capacity);
  room.speed = room.speed ?? 1;
  room.playNow = room.playNow ?? false;
  room.status = "playing";
  room.lifecycleApplied = false;
  room.activeMatchId = randomUUID();
  room.statsRecorded = false;
  room.matchParticipants = room.seats.slice(0, capacity).map((seat) => ({
    seat: seat.seat,
    userId: seat.userId ?? null,
  }));
  room.crownsEligible = countsForCrowns(room.seats.slice(0, capacity).map((entry) =>
    entry.status === "bot" ? (entry.botLevel ?? "easy") : "human"));
  room.hostDisconnectedAt = null;
  room.lastEvents = started.events;
  room.eventsKey += 1;
  cancelGameTimer(room);
  room.lastAction = "The tiles are dealt";
  await persistRoom(room);
  await broadcastRoom(room);
  res.json(StartRoomResponse.parse(gameSnapshot(room)));
});

router.post("/rooms/:code/next-hand", async (req, res) => {
  const params = NextHandParams.parse(req.params);
  const input = NextHandBody.parse(req.body);
  const room = requireRoom(params.code, res);
  if (!room) return;
  const requestingSeat = resolveSeatForReconnect(room.seats, input.reconnectToken);
  const eligibility = nextHandEligibility(room, input.reconnectToken);
  if (!eligibility.allowed) {
    const requesterName = requestingSeat === undefined ? "unknown" : String(requestingSeat);
    logger.info(
      { roomCode: room.code, seat: requestingSeat ?? null },
      `nextHand requested by ${requesterName} in room ${room.code}`,
    );
    logger.warn(
      { roomCode: room.code, seat: requestingSeat ?? null, reason: eligibility.reason },
      `Rejected nextHand request by ${requesterName} in room ${room.code}`,
    );
    res.status(eligibility.reason.includes("host") ? 403 : 409).json({ error: eligibility.reason });
    return;
  }
  const transition = await startNextHandForRoom(room, eligibility.requestingSeat);
  if (!transition.started) {
    res.status(409).json({ error: transition.reason });
    return;
  }
  res.json(NextHandResponse.parse(gameSnapshot(room)));
});

router.get("/rooms/:code/game", (req, res) => {
  const params = GetGameParams.parse(req.params);
  const room = requireRoom(params.code, res);
  if (!room) return;
  if (room.status !== "playing" && room.status !== "finished") {
    res.status(409).json({ error: "The game has not started" });
    return;
  }
  res.json(GetGameResponse.parse(gameSnapshot(room)));
});

router.post("/rooms/:code/waitlist", async (req, res) => {
  const room = requireRoom(req.params.code, res);
  if (!room) return;
  const identity = await getIdentityFromRequest(req);
  const token = typeof req.body?.reconnectToken === "string" ? req.body.reconnectToken : "";
  if (token.length < 32 || token.length > 128) {
    return res.status(400).json({ error: "A valid waitlist token is required" });
  }
  if (resolveSeatForReconnect(room.seats, token) !== undefined) {
    return res.status(409).json({ error: "You already have a seat at this table" });
  }
  const id = hashReconnectToken(token);
  const engineRoom = { hostId: room.seats[0]?.reconnectTokenHash ?? "", seats: room.seats.map((s) => s.reconnectTokenHash), waitlist: room.waitlist, offers: room.offers };
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 24) : "Guest";
  const next = joinWaitlist(engineRoom, id, Boolean(req.body?.notify));
  room.waitlist = next.waitlist; room.offers = next.offers;
  const entry = room.waitlist.find((candidate) => candidate.id === id);
  if (entry) {
    if (!entry.name) entry.name = name || "Guest";
    entry.userId = identity?.userId ?? entry.userId ?? null;
  }
  await persistRoom(room);
  await broadcastRoom(room);
  return res.json({ position: room.waitlist.findIndex((entry) => entry.id === id) + 1 });
});

router.delete("/rooms/:code/waitlist", async (req, res) => {
  const room = requireRoom(req.params.code, res);
  if (!room) return;
  const id = hashReconnectToken(String(req.body?.reconnectToken ?? ""));
  const engineRoom = { hostId: room.seats[0]?.reconnectTokenHash ?? "", seats: room.seats.map((s) => s.reconnectTokenHash), waitlist: room.waitlist, offers: room.offers };
  const next = leaveWaitlist(engineRoom, id);
  room.waitlist = next.waitlist; room.offers = next.offers;
  await persistRoom(room);
  await broadcastRoom(room);
  res.json({ ok: true });
});

router.patch("/rooms/:code/waitlist", async (req, res) => {
  const room = requireRoom(req.params.code, res);
  if (!room) return;
  const id = hashReconnectToken(String(req.body?.reconnectToken ?? ""));
  const next = setNotify(engineRoom(room), id, Boolean(req.body?.notify));
  room.waitlist = room.waitlist.map((entry) => {
    const updated = next.waitlist.find((candidate) => candidate.id === entry.id);
    return updated ? { ...entry, notify: updated.notify } : entry;
  });
  await persistRoom(room);
  await broadcastRoom(room);
  res.json({ ok: true });
});

router.post("/rooms/:code/waitlist/accept", async (req, res) => {
  const room = requireRoom(req.params.code, res);
  if (!room) return;
  await processOffers(room);
  const id = hashReconnectToken(String(req.body?.reconnectToken ?? ""));
  const offeredName = room.offers.find((offer) => offer.playerId === id)?.name ?? "Guest";
  const offeredUserId = room.offers.find((offer) => offer.playerId === id)?.userId ??
    room.waitlist.find((entry) => entry.id === id)?.userId ?? null;
  const engineRoom = { hostId: room.seats[0]?.reconnectTokenHash ?? "", seats: room.seats.map((s) => s.reconnectTokenHash), waitlist: room.waitlist, offers: room.offers };
  const next = acceptSeat(engineRoom, id);
  const event = next.events.find((item) => item.type === "seated");
  if (!event || event.type !== "seated") return res.status(409).json({ error: "No active seat offer" });
  room.waitlist = next.room.waitlist; room.offers = next.room.offers;
  room.seats[event.seat].status = "waiting";
  room.seats[event.seat].name = offeredName;
  room.seats[event.seat].reconnectTokenHash = id;
  room.seats[event.seat].userId = offeredUserId;
  await persistRoom(room);
  await broadcastRoom(room);
  return res.json(publicRoom(room));
});

router.post("/rooms/:code/waitlist/decline", async (req, res) => {
  const room = requireRoom(req.params.code, res);
  if (!room) return;
  const id = hashReconnectToken(String(req.body?.reconnectToken ?? ""));
  const offer = room.offers.find((candidate) => candidate.playerId === id);
  if (!offer) return res.status(409).json({ error: "No active seat offer" });
  offer.expiresAt = 0;
  await processOffers(room);
  return res.json({ ok: true });
});

router.post("/rooms/:code/leave", async (req, res) => {
  const room = requireRoom(req.params.code, res);
  if (!room) return;
  const token = String(req.body?.reconnectToken ?? "");
  const id = hashReconnectToken(token);
  const seat = room.seats.find((candidate) => candidate.reconnectTokenHash === id);
  if (!seat) return res.status(403).json({ error: "That reconnect token is not seated" });
  if (room.status === "waiting") {
    if (seat.seat === 0) {
      await removeRoom(room);
      res.json({ events: [], room: null });
      return;
    }
    room.seats[seat.seat] = {
      seat: seat.seat, status: "open", name: null, reconnectTokenHash: null, userId: null,
    };
    await broadcastRoom(room);
    res.json({ events: [], room: publicRoom(room) });
    return;
  }
  if (!room.engineState?.over && !room.engineState?.hand.over) {
    return res.status(409).json({ error: "A seat can be released only after the hand ends" });
  }
  if (room.engineState?.over) {
    const applied = await applyAfterGame(room);
    if (!applied) {
      return res.status(503).json({ error: "The match results are still being saved. Please try again." });
    }
    await broadcastRoom(room);
    return res.json({ events: [], room: publicRoom(room) });
  }
  const lifecycle = afterGame(
    {
      hostId: room.seats[0]?.reconnectTokenHash ?? "",
      seats: room.seats.map((candidate) => candidate.reconnectTokenHash),
      waitlist: room.waitlist,
      offers: room.offers,
    },
    room.engineState.hand.ranking ?? room.engineState.placings ?? [],
    1,
    Date.now(),
    (candidate) => isOnline(room, candidate),
  );
  room.waitlist = lifecycle.room.waitlist;
  room.offers = lifecycle.room.offers;
  lifecycle.events.filter((event) => event.type === "gotUp").forEach((event) => {
    room.seats[event.seat] = {
      seat: event.seat as Seat, status: "open", name: null, reconnectTokenHash: null, userId: null,
    };
  });
  lifecycle.events.forEach((event) => {
    if (event.type === "offer" || event.type === "offerExpired") {
      sendWaitlistEvent(room, event);
    }
  });
  if (room.engineState?.over) room.lifecycleApplied = true;
  await broadcastRoom(room);
  return res.json({ events: lifecycle.events, room: publicRoom(room) });
});

export default router;