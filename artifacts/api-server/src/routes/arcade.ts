import { randomBytes, createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Router } from "express";
import { WebSocket } from "ws";
import { CreateArcadeRoomBody, JoinArcadeRoomBody, QuickMatchArcadeRoomBody } from "@workspace/api-zod";
import { pool, type ArcadeRoomRecord } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  ARCADE_GAME_IDS,
  createArcadeInitialState,
  validateArcadeTransition,
  type ArcadeGameId,
} from "../lib/arcade-validation.ts";

const GAME_IDS = new Set<string>(ARCADE_GAME_IDS);
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const NOTIFY_CHANNEL = "arcade_room_updates";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type ArcadePlayer = { name: string; tokenHash: string };
type ArcadeRoom = {
  code: string;
  game: string;
  capacity: number;
  isPrivate: boolean;
  players: ArcadePlayer[];
  state: unknown;
  turn: number;
  updatedAt: number;
};
type RoomInput = { game: string; name: string; capacity: number; isPrivate: boolean };
type RoomEvent = { code: string; type: "room" | "state" | "resigned"; seat?: number; origin?: string };
type SqlExecutor = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
type ArcadeNotificationClient = {
  query: (text: string) => Promise<unknown>;
  on: (event: "notification", listener: (notification: { channel?: string; payload?: string }) => void) => unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "end", listener: () => void): unknown;
  release: (destroy?: boolean) => void;
};

const socketsByRoom = new Map<string, Set<WebSocket>>();
const router = Router();
const instanceId = randomUUID();
let listenerStarted = false;
let listenerRetry: NodeJS.Timeout | undefined;
let listenerClient: ArcadeNotificationClient | undefined;
let listenerRetryPausedForTest = false;
let pendingBroadcasts: Promise<void> = Promise.resolve();

function recordFromRow(row: Record<string, unknown>): ArcadeRoomRecord {
  return {
    code: row.code as string,
    game: row.game as string,
    capacity: row.capacity as number,
    isPrivate: row.isPrivate as boolean,
    players: row.players as ArcadeRoomRecord["players"],
    state: row.state,
    turn: row.turn as number,
    updatedAt: row.updatedAt as Date,
  };
}

async function readRoom(executor: SqlExecutor, code: string, lock = false): Promise<ArcadeRoomRecord | null> {
  const result = await executor.query(
    `SELECT code, game, capacity, is_private AS "isPrivate", players, state, turn, updated_at AS "updatedAt"
     FROM arcade_rooms WHERE code = $1${lock ? " FOR UPDATE" : ""}`,
    [code],
  );
  return result.rows[0] ? recordFromRow(result.rows[0] as Record<string, unknown>) : null;
}

function restoreRoom(record: ArcadeRoomRecord): ArcadeRoom | null {
  if (!/^[A-Z0-9]{4,8}$/.test(record.code) || !GAME_IDS.has(record.game) ||
      ![2, 3, 4].includes(record.capacity) || typeof record.isPrivate !== "boolean" ||
      !Array.isArray(record.players) || record.players.length < 1 || record.players.length > record.capacity ||
      !Number.isInteger(record.turn) || record.turn < 0 || record.turn >= record.capacity ||
      !(record.updatedAt instanceof Date) || !Number.isFinite(record.updatedAt.getTime())) return null;
  const players: ArcadePlayer[] = [];
  for (const value of record.players) {
    if (!value || typeof value !== "object") return null;
    const player = value as Record<string, unknown>;
    if (typeof player.name !== "string" || !player.name.trim() ||
        typeof player.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(player.tokenHash)) return null;
    players.push({ name: player.name, tokenHash: player.tokenHash });
  }
  return {
    code: record.code,
    game: record.game,
    capacity: record.capacity,
    isPrivate: record.isPrivate,
    players,
    state: record.state,
    turn: record.turn,
    updatedAt: record.updatedAt.getTime(),
  };
}

async function insertRoom(executor: SqlExecutor, room: ArcadeRoom): Promise<void> {
  await executor.query(
    `INSERT INTO arcade_rooms (code, game, capacity, is_private, players, state, turn, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      room.code, room.game, room.capacity, room.isPrivate, JSON.stringify(room.players),
      JSON.stringify(room.state), room.turn, new Date(room.updatedAt),
    ],
  );
}

async function updateRoom(executor: SqlExecutor, room: ArcadeRoom): Promise<void> {
  await executor.query(
    `UPDATE arcade_rooms
     SET players = $2::jsonb, state = $3::jsonb, turn = $4, updated_at = $5
     WHERE code = $1`,
    [room.code, JSON.stringify(room.players), JSON.stringify(room.state), room.turn, new Date(room.updatedAt)],
  );
}

async function notifyRoom(executor: SqlExecutor, event: RoomEvent): Promise<void> {
  await executor.query("SELECT pg_notify($1, $2)", [
    NOTIFY_CHANNEL,
    JSON.stringify({ ...event, origin: instanceId }),
  ]);
}

async function withTransaction<T>(operation: (client: SqlExecutor) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function fetchRoom(code: string): Promise<ArcadeRoom | null> {
  const record = await readRoom(pool, code);
  return record ? restoreRoom(record) : null;
}

function roomSummary(room: ArcadeRoom) {
  return {
    code: room.code,
    game: room.game,
    capacity: room.capacity,
    status: room.players.length === room.capacity ? "playing" : "waiting",
    players: room.players.map((player, seat) => ({ name: player.name, seat })),
    state: room.state,
    turn: room.turn,
  };
}

async function broadcastRoomEvent(event: RoomEvent): Promise<void> {
  const sockets = socketsByRoom.get(event.code);
  if (!sockets?.size) return;
  if (event.type === "resigned") {
    const message = JSON.stringify({ type: "resigned", seat: event.seat });
    for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(message);
    return;
  }
  const room = await fetchRoom(event.code);
  if (!room) return;
  const message = JSON.stringify({ type: event.type, room: roomSummary(room) });
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(message);
}

async function resyncConnectedRooms(): Promise<void> {
  for (const [code, sockets] of socketsByRoom) {
    const liveSockets = [...sockets].filter((socket) => socket.readyState === WebSocket.OPEN);
    if (!liveSockets.length) continue;
    const room = await fetchRoom(code);
    if (!room) continue;
    const message = JSON.stringify({ type: "room", room: roomSummary(room) });
    for (const socket of liveSockets) socket.send(message);
  }
}

function queueRoomEvent(event: RoomEvent): void {
  pendingBroadcasts = pendingBroadcasts
    .then(() => broadcastRoomEvent(event))
    .catch((error) => logger.error({ err: error, code: event.code }, "Failed to broadcast arcade room update"));
}

function handleListenerDisconnect(client: ArcadeNotificationClient, error?: Error): void {
  if (listenerClient !== client) return;
  listenerClient = undefined;
  if (error) logger.error({ err: error }, "Arcade room notification connection failed");
  client.release(true);
  scheduleListenerRetry();
}

async function listenForRoomEvents(): Promise<void> {
  let client: ArcadeNotificationClient | undefined;
  try {
    client = await pool.connect() as unknown as ArcadeNotificationClient;
    listenerClient = client;
    client.on("notification", (notification: { channel?: string; payload?: string }) => {
      if (notification.channel !== NOTIFY_CHANNEL || !notification.payload) return;
      try {
        const event = JSON.parse(notification.payload) as RoomEvent;
        if (!/^[A-Z0-9]{4,8}$/.test(event.code) ||
            !["room", "state", "resigned"].includes(event.type) ||
            (event.type === "resigned" && !Number.isInteger(event.seat))) return;
        if (event.origin === instanceId) return;
        queueRoomEvent(event);
      } catch (error) {
        logger.warn({ err: error }, "Ignoring malformed arcade room notification");
      }
    });
    client.once("error", (error: Error) => handleListenerDisconnect(client!, error));
    client.once("end", () => handleListenerDisconnect(client!));
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    await resyncConnectedRooms();
  } catch (error) {
    logger.error({ err: error }, "Could not listen for arcade room updates");
    if (client && listenerClient === client) {
      listenerClient = undefined;
      client.release(true);
    }
    scheduleListenerRetry();
  }
}

function scheduleListenerRetry(): void {
  if (listenerRetry || listenerRetryPausedForTest) return;
  listenerRetry = setTimeout(() => {
    listenerRetry = undefined;
    void listenForRoomEvents();
  }, 1_000);
  listenerRetry.unref();
}

export function interruptArcadeNotificationListenerForTest(): boolean {
  const client = listenerClient;
  if (!client) return false;
  listenerRetryPausedForTest = true;
  handleListenerDisconnect(client);
  return true;
}

export function resumeArcadeNotificationListenerForTest(): void {
  listenerRetryPausedForTest = false;
  if (listenerRetry) {
    clearTimeout(listenerRetry);
    listenerRetry = undefined;
  }
  if (!listenerClient) void listenForRoomEvents();
}

export async function initializeArcadeRooms(): Promise<void> {
  await pool.query("DELETE FROM arcade_rooms WHERE updated_at < $1", [new Date(Date.now() - ROOM_TTL_MS)]);
  const records = await pool.query(
    `SELECT code, game, capacity, is_private AS "isPrivate", players, state, turn, updated_at AS "updatedAt"
     FROM arcade_rooms`,
  );
  for (const row of records.rows) {
    const record = recordFromRow(row as Record<string, unknown>);
    if (!restoreRoom(record)) {
      logger.warn({ code: record.code }, "Ignoring invalid persisted arcade room");
      await pool.query("DELETE FROM arcade_rooms WHERE code = $1", [record.code]);
    }
  }
  if (!listenerStarted) {
    listenerStarted = true;
    await listenForRoomEvents();
  }
}

export async function getArcadeInviteRoom(code: string) {
  const room = await fetchRoom(code.toUpperCase());
  if (!room || !room.isPrivate || room.players.length >= room.capacity) return null;
  return { code: room.code, game: room.game };
}

function randomCode(): string {
  return `Y${Array.from(randomBytes(7), (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join("")}`;
}

function issueToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().slice(0, 24);
  return name || null;
}

function makeRoom(input: RoomInput): { room: ArcadeRoom; token: string } {
  const token = issueToken();
  return {
    room: {
      code: randomCode(),
      game: input.game,
      capacity: input.capacity,
      isPrivate: input.isPrivate,
      players: [{ name: input.name, tokenHash: hashToken(token) }],
      state: createArcadeInitialState(input.game as ArcadeGameId, input.capacity),
      turn: 0,
      updatedAt: Date.now(),
    },
    token,
  };
}

function roomResponse(room: ArcadeRoom, seat: number, reconnectToken: string) {
  return { ...roomSummary(room), seat, reconnectToken };
}

function parseCreate(body: unknown): RoomInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const game = typeof value.game === "string" ? value.game : "";
  const name = cleanName(value.displayName);
  const capacity = value.playerCount === undefined ? 2 : value.playerCount;
  if (!GAME_IDS.has(game) || !name || !Number.isInteger(capacity) ||
      (capacity !== 2 && capacity !== 3 && capacity !== 4)) return null;
  if (game !== "scrabble" && game !== "filler" && capacity !== 2) return null;
  return { game, name, capacity, isPrivate: value.isPrivate === true };
}

async function createPrivateRoom(input: RoomInput): Promise<{ room: ArcadeRoom; seat: number; token: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const created = makeRoom({ ...input, isPrivate: true });
    try {
      await withTransaction((client) => insertRoom(client, created.room));
      return { room: created.room, seat: 0, token: created.token };
    } catch (error) {
      if ((error as { code?: string }).code !== "23505" || attempt === 2) throw error;
    }
  }
  throw new Error("Could not allocate an arcade room code.");
}

async function createOrJoinQuickMatch(input: RoomInput): Promise<{ room: ArcadeRoom; seat: number; token: string }> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('arcade_quick_match'))");
    const result = await client.query(
      `SELECT code, game, capacity, is_private AS "isPrivate", players, state, turn, updated_at AS "updatedAt"
       FROM arcade_rooms
       WHERE is_private = false AND game = $1 AND capacity = $2 AND jsonb_array_length(players) < capacity
       ORDER BY updated_at, code
       LIMIT 1 FOR UPDATE`,
      [input.game, input.capacity],
    );
    if (result.rows[0]) {
      const room = restoreRoom(recordFromRow(result.rows[0] as Record<string, unknown>));
      if (!room) throw new Error("The waiting arcade room has invalid stored data.");
      const token = issueToken();
      const seat = room.players.length;
      room.players.push({ name: input.name, tokenHash: hashToken(token) });
      room.updatedAt = Date.now();
      await updateRoom(client, room);
      await notifyRoom(client, { code: room.code, type: "room" });
      return { room, seat, token };
    }
    const created = makeRoom({ ...input, isPrivate: false });
    await insertRoom(client, created.room);
    return { room: created.room, seat: 0, token: created.token };
  });
}

router.post("/arcade/rooms", async (req, res): Promise<void> => {
  const parsed = CreateArcadeRoomBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  const input = parseCreate(parsed.data);
  if (!input) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  const created = await createPrivateRoom(input);
  res.status(201).json(roomResponse(created.room, created.seat, created.token));
});

router.post("/arcade/quick-match", async (req, res): Promise<void> => {
  const parsed = QuickMatchArcadeRoomBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  const input = parseCreate(parsed.data);
  if (!input) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  const joined = await createOrJoinQuickMatch(input);
  if (joined.seat > 0) queueRoomEvent({ code: joined.room.code, type: "room" });
  res.status(joined.seat === 0 ? 201 : 200).json(roomResponse(joined.room, joined.seat, joined.token));
});

router.post("/arcade/rooms/:code/join", async (req, res): Promise<void> => {
  const code = String(req.params.code).toUpperCase();
  const parsed = JoinArcadeRoomBody.safeParse(req.body);
  const name = parsed.success ? cleanName(parsed.data.displayName) : null;
  if (!name) { res.status(400).json({ error: "Enter a player name." }); return; }
  const joined = await withTransaction(async (client) => {
    const record = await readRoom(client, code, true);
    const room = record ? restoreRoom(record) : null;
    if (!room) return { error: "missing" as const };
    if (room.players.length >= room.capacity) return { error: "full" as const };
    const token = issueToken();
    const seat = room.players.length;
    room.players.push({ name, tokenHash: hashToken(token) });
    room.updatedAt = Date.now();
    await updateRoom(client, room);
    await notifyRoom(client, { code, type: "room" });
    return { room, seat, token };
  });
  if ("error" in joined) {
    res.status(joined.error === "missing" ? 404 : 409).json({
      error: joined.error === "missing" ? "That room was not found." : "That room is full.",
    });
    return;
  }
  queueRoomEvent({ code, type: "room" });
  res.status(200).json(roomResponse(joined.room, joined.seat, joined.token));
});

router.get("/arcade/rooms/:code", async (req, res): Promise<void> => {
  const room = await fetchRoom(String(req.params.code).toUpperCase());
  if (!room) { res.status(404).json({ error: "That room was not found." }); return; }
  res.json(roomSummary(room));
});

export async function handleArcadeSocket(socket: WebSocket, request: IncomingMessage): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const code = url.searchParams.get("arcadeCode")?.toUpperCase();
  const token = url.searchParams.get("token") ?? "";
  let room: ArcadeRoom | null = null;
  let seat = -1;
  try {
    if (code) room = await fetchRoom(code);
    seat = room?.players.findIndex((player) => player.tokenHash === hashToken(token)) ?? -1;
  } catch (error) {
    logger.error({ err: error, code }, "Failed to load arcade room for socket");
  }
  if (!room || seat < 0 || socket.readyState !== WebSocket.OPEN) {
    if (socket.readyState === WebSocket.OPEN) {
      send(socket, { type: "error", message: "Room access expired. Rejoin the room to continue." });
      socket.close(1008, "Invalid room access");
    }
    return;
  }

  const connections = socketsByRoom.get(room.code) ?? new Set<WebSocket>();
  connections.add(socket);
  socketsByRoom.set(room.code, connections);
  send(socket, { type: "room", room: roomSummary(room), seat });

  socket.on("message", async (raw) => {
    const rejectUpdate = (message: string, currentRoom: ArcadeRoom = room!) => {
      send(socket, { type: "error", message });
      send(socket, { type: "room", room: roomSummary(currentRoom), seat });
    };
    const rawText = raw.toString();
    if (rawText.length > 64 * 1024) {
      rejectUpdate("That game update is too large.");
      return;
    }
    let message: unknown;
    try { message = JSON.parse(rawText); } catch {
      rejectUpdate("That game update could not be read.");
      return;
    }
    if (!message || typeof message !== "object") return;
    const event = message as Record<string, unknown>;
    if (event.type !== "state" && event.type !== "resign") return;
    try {
      const outcome = await withTransaction(async (client) => {
        const record = await readRoom(client, room!.code, true);
        const current = record ? restoreRoom(record) : null;
        if (!current || current.players[seat]?.tokenHash !== hashToken(token)) return { error: "missing" as const };
        if (event.type === "resign") {
          current.updatedAt = Date.now();
          await updateRoom(client, current);
          await notifyRoom(client, { code: current.code, type: "resigned", seat });
          return { room: current };
        }
        if (current.players.length !== current.capacity) {
          return { error: "not-full" as const, room: current };
        }
        const result = validateArcadeTransition(
          current.game as ArcadeGameId,
          current.state,
          event.state,
          seat,
          current.capacity,
          current.turn,
          event.turn,
        );
        if (!result.ok) return { error: result.error, room: current };
        current.state = result.state;
        current.turn = result.turn;
        current.updatedAt = Date.now();
        await updateRoom(client, current);
        await notifyRoom(client, { code: current.code, type: "state" });
        return { room: current };
      });
      if ("error" in outcome) {
        const errors: Record<string, string> = {
          missing: "Room access expired. Rejoin the room to continue.",
          "not-full": "Wait for all players to join before moving.",
        };
        const errorKey = typeof outcome.error === "string" ? outcome.error : "missing";
        rejectUpdate(errors[errorKey] ?? errorKey, "room" in outcome ? outcome.room : room);
      } else {
        queueRoomEvent({
          code: room!.code,
          type: event.type === "resign" ? "resigned" : "state",
          ...(event.type === "resign" ? { seat } : {}),
        });
      }
    } catch (error) {
      logger.error({ err: error, code: room!.code }, "Failed to save arcade game update");
      rejectUpdate(event.type === "state" ? "Your move could not be saved. Please try again." : "Your resignation could not be saved.");
    }
  });
  socket.on("close", () => {
    connections.delete(socket);
    if (!connections.size) socketsByRoom.delete(room!.code);
  });
}

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

setInterval(() => {
  const activeCodes = [...socketsByRoom.entries()]
    .filter(([, sockets]) => [...sockets].some((socket) => socket.readyState === WebSocket.OPEN))
    .map(([code]) => code);
  void (async () => {
    if (activeCodes.length) {
      await pool.query("UPDATE arcade_rooms SET updated_at = now() WHERE code = ANY($1::text[])", [activeCodes]);
    }
    await pool.query("DELETE FROM arcade_rooms WHERE updated_at < $1", [new Date(Date.now() - ROOM_TTL_MS)]);
  })().catch((error) => logger.error({ err: error }, "Failed to maintain arcade rooms"));
}, 5 * 60 * 1000).unref();

export default router;
