import { randomBytes, createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Router } from "express";
import { WebSocket } from "ws";
import { CreateArcadeRoomBody, JoinArcadeRoomBody, QuickMatchArcadeRoomBody } from "@workspace/api-zod";
import { pool, type ArcadeRoomRecord } from "@workspace/db";
import { getIdentityFromRequest } from "../lib/auth-session";
import { logger } from "../lib/logger";
import {
  ARCADE_GAME_IDS,
  createArcadeInitialState,
  getArcadeBotTransition,
  validateArcadeTransition,
  type ArcadeGameId,
} from "../lib/arcade-validation.ts";

const GAME_IDS = new Set<string>(ARCADE_GAME_IDS);
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const NOTIFY_CHANNEL = "arcade_room_updates";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STORED_RESULT_KEY = "__509YardArcadeResult";

type ArcadePlayer = { name: string; tokenHash: string; userId?: string; bot?: boolean };
type ArcadeResult = { winnerSeat: number; resignedSeat: number; endedAt: number };
type ArcadeRoom = {
  code: string;
  game: string;
  capacity: number;
  isPrivate: boolean;
  players: ArcadePlayer[];
  state: unknown;
  turn: number;
  updatedAt: number;
  result?: ArcadeResult | null;
};
type RoomInput = { game: string; name: string; capacity: number; isPrivate: boolean; userId?: string };
type ArcadeJoinResult =
  | { error: "missing" | "full" }
  | { room: ArcadeRoom; seat: number; token: string };
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

const socketsByRoom = new Map<string, Map<WebSocket, number>>();
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
  let result: ArcadeResult | null = null;
  for (const [index, value] of record.players.entries()) {
    if (!value || typeof value !== "object") return null;
    const player = value as Record<string, unknown>;
    if (typeof player.name !== "string" || !player.name.trim() ||
        typeof player.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(player.tokenHash)) return null;
    if (player.bot !== undefined && typeof player.bot !== "boolean") return null;
    if (player.userId !== undefined && (typeof player.userId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(player.userId))) return null;
    const savedResult = index === 0 ? player[STORED_RESULT_KEY] : undefined;
    if (savedResult && typeof savedResult === "object" && !Array.isArray(savedResult)) {
      const value = savedResult as Record<string, unknown>;
      if (typeof value.winnerSeat === "number" && Number.isInteger(value.winnerSeat) &&
          value.winnerSeat >= 0 && value.winnerSeat < 2 &&
          typeof value.resignedSeat === "number" && Number.isInteger(value.resignedSeat) &&
          value.resignedSeat >= 0 && value.resignedSeat < 2 &&
          value.winnerSeat !== value.resignedSeat && Number.isFinite(value.endedAt)) {
        result = {
          winnerSeat: value.winnerSeat as number,
          resignedSeat: value.resignedSeat as number,
          endedAt: value.endedAt as number,
        };
      }
    }
    players.push({
      name: player.name,
      tokenHash: player.tokenHash,
      ...(typeof player.userId === "string" ? { userId: player.userId } : {}),
      ...(player.bot ? { bot: true } : {}),
    });
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
    result,
  };
}

function storedRoomPlayers(room: ArcadeRoom): ArcadePlayer[] {
  // Keep this server-owned outcome beside room players in JSONB; snapshots only expose public player fields.
  return room.players.map((player, index) => index === 0 && room.result
    ? { ...player, [STORED_RESULT_KEY]: room.result } as ArcadePlayer
    : player);
}

async function insertRoom(executor: SqlExecutor, room: ArcadeRoom): Promise<void> {
  await executor.query(
    `INSERT INTO arcade_rooms (code, game, capacity, is_private, players, state, turn, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      room.code, room.game, room.capacity, room.isPrivate, JSON.stringify(storedRoomPlayers(room)),
      JSON.stringify(room.state), room.turn, new Date(room.updatedAt),
    ],
  );
}

async function updateRoom(executor: SqlExecutor, room: ArcadeRoom): Promise<void> {
  await executor.query(
    `UPDATE arcade_rooms
     SET players = $2::jsonb, state = $3::jsonb, turn = $4, updated_at = $5
     WHERE code = $1`,
    [room.code, JSON.stringify(storedRoomPlayers(room)), JSON.stringify(room.state), room.turn, new Date(room.updatedAt)],
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

function privateScrabbleState(state: unknown, seat: number | null): unknown {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const gameState = state as Record<string, unknown>;
  if (!Array.isArray(gameState.racks) || !Array.isArray(gameState.bag)) return null;
  return {
    ...gameState,
    racks: gameState.racks.map((rack, index) => seat === index && Array.isArray(rack) ? [...rack] : []),
    // Keep only the public count; never send the hidden tile order or identities.
    bag: gameState.bag.map(() => ""),
  };
}

function roomSummary(room: ArcadeRoom, seat: number | null = null) {
  return {
    code: room.code,
    game: room.game,
    capacity: room.capacity,
    reconnectDeadline: room.updatedAt + ROOM_TTL_MS,
    status: isArcadeGameFinished(room) ? "finished" : room.players.length === room.capacity ? "playing" : "waiting",
    players: room.players.map((player, seat) => ({
      name: player.name,
      seat,
      ...(player.bot ? { isBot: true } : {}),
    })),
    state: room.game === "scrabble" ? privateScrabbleState(room.state, seat) : room.state,
    turn: room.turn,
    result: room.result ?? null,
  };
}

function isArcadeGameFinished(room: ArcadeRoom): boolean {
  if (room.result) return true;
  if (!room.state || typeof room.state !== "object") return false;
  const state = room.state as Record<string, unknown>;
  return (state.winner !== null && state.winner !== undefined) || state.status === "gameover";
}

function advanceBotTurns(room: ArcadeRoom): boolean {
  let moved = false;
  for (let count = 0; count < room.capacity * 2; count += 1) {
    if (isArcadeGameFinished(room) || !room.players[room.turn]?.bot) break;
    const transition = getArcadeBotTransition(
      room.game as ArcadeGameId,
      room.state,
      room.turn,
      room.capacity,
    );
    if (!transition) break;
    room.state = transition.state;
    room.turn = transition.turn;
    moved = true;
  }
  return moved;
}

async function persistArcadeMatchResult(client: SqlExecutor, room: ArcadeRoom): Promise<void> {
  const state = room.state && typeof room.state === "object"
    ? room.state as Record<string, unknown>
    : null;
  const winner = room.result?.winnerSeat ?? state?.winner;
  const draw = winner === "draw";
  if (!draw && (!Number.isInteger(winner) || (winner as number) < 0 || (winner as number) >= room.capacity)) return;

  const players = new Map<string, { seat: number }>();
  for (const [seat, player] of room.players.entries()) {
    if (player.userId && !players.has(player.userId)) players.set(player.userId, { seat });
  }
  if (!players.size) return;

  const matchId = randomUUID();
  await client.query(
    "INSERT INTO domino_matches (match_id, room_code, mode) VALUES ($1, $2, $3)",
    [matchId, room.code, `arcade:${room.game}`],
  );
  for (const [userId, player] of players) {
    const won = !draw && player.seat === winner;
    const inserted = await client.query(
      `INSERT INTO domino_match_results (match_id, user_id, rank, medal, crown_points, won)
       VALUES ($1, $2, $3, $4, 0, $5)
       ON CONFLICT (match_id, user_id) DO NOTHING
       RETURNING user_id`,
      [matchId, userId, won || draw ? 1 : 2, draw ? "draw" : won ? "win" : "loss", won],
    );
    if (inserted.rows.length) {
      await client.query(
        "UPDATE domino_users SET games = games + 1, wins = wins + $2 WHERE id = $1",
        [userId, won ? 1 : 0],
      );
    }
  }
}

async function broadcastRoomEvent(event: RoomEvent): Promise<void> {
  const sockets = socketsByRoom.get(event.code);
  if (!sockets?.size) return;
  if (event.type === "resigned") {
    const message = JSON.stringify({ type: "resigned", seat: event.seat });
    for (const socket of sockets.keys()) if (socket.readyState === WebSocket.OPEN) socket.send(message);
    return;
  }
  const room = await fetchRoom(event.code);
  if (!room) return;
  for (const [socket, seat] of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: event.type, room: roomSummary(room, seat) }));
    }
  }
}

async function resyncConnectedRooms(): Promise<void> {
  for (const [code, sockets] of socketsByRoom) {
    const liveSockets = [...sockets.entries()].filter(([socket]) => socket.readyState === WebSocket.OPEN);
    if (!liveSockets.length) continue;
    const room = await fetchRoom(code);
    if (!room) continue;
    for (const [socket, seat] of liveSockets) {
      socket.send(JSON.stringify({ type: "room", room: roomSummary(room, seat) }));
    }
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

export function disconnectArcadeNotificationListenerForTest(): boolean {
  const client = listenerClient;
  if (!client) return false;
  handleListenerDisconnect(client);
  return listenerRetry !== undefined;
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
      players: [{
        name: input.name,
        tokenHash: hashToken(token),
        ...(input.userId ? { userId: input.userId } : {}),
      }],
      state: createArcadeInitialState(input.game as ArcadeGameId, input.capacity),
      turn: 0,
      updatedAt: Date.now(),
    },
    token,
  };
}

function roomResponse(room: ArcadeRoom, seat: number, reconnectToken: string) {
  return { ...roomSummary(room, seat), seat, reconnectToken };
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

function replyWithRetryableRoomSaveError(res: import("express").Response, error: unknown, action: string): void {
  logger.error({ err: error, action }, "Arcade room persistence failed");
  res.status(503).json({ error: "Room storage is temporarily unavailable. Please retry.", retryable: true });
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
       room.players.push({
         name: input.name,
         tokenHash: hashToken(token),
         ...(input.userId ? { userId: input.userId } : {}),
       });
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
  const identity = await getIdentityFromRequest(req);
  input.userId = identity?.userId;
  let created: Awaited<ReturnType<typeof createPrivateRoom>>;
  try {
    created = await createPrivateRoom(input);
  } catch (error) {
    replyWithRetryableRoomSaveError(res, error, "create");
    return;
  }
  res.status(201).json(roomResponse(created.room, created.seat, created.token));
});

router.post("/arcade/quick-match", async (req, res): Promise<void> => {
  const parsed = QuickMatchArcadeRoomBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  const input = parseCreate(parsed.data);
  if (!input) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  const identity = await getIdentityFromRequest(req);
  input.userId = identity?.userId;
  let joined: Awaited<ReturnType<typeof createOrJoinQuickMatch>>;
  try {
    joined = await createOrJoinQuickMatch(input);
  } catch (error) {
    replyWithRetryableRoomSaveError(res, error, "quick-match");
    return;
  }
  if (joined.seat > 0) queueRoomEvent({ code: joined.room.code, type: "room" });
  res.status(joined.seat === 0 ? 201 : 200).json(roomResponse(joined.room, joined.seat, joined.token));
});

router.post("/arcade/rooms/:code/join", async (req, res): Promise<void> => {
  const code = String(req.params.code).toUpperCase();
  const parsed = JoinArcadeRoomBody.safeParse(req.body);
  const name = parsed.success ? cleanName(parsed.data.displayName) : null;
  if (!name) { res.status(400).json({ error: "Enter a player name." }); return; }
  const identity = await getIdentityFromRequest(req);
  let joined: ArcadeJoinResult;
  try {
    joined = await withTransaction(async (client) => {
      const record = await readRoom(client, code, true);
      const room = record ? restoreRoom(record) : null;
      if (!room) return { error: "missing" as const };
      const token = issueToken();
      let seat = room.players.length;
      if (room.players.length >= room.capacity) {
        seat = room.players.findIndex((player) => player.bot);
        if (seat < 0 || !isArcadeGameFinished(room)) return { error: "full" as const };
        room.players[seat] = { name, tokenHash: hashToken(token), ...(identity ? { userId: identity.userId } : {}) };
        room.state = createArcadeInitialState(room.game as ArcadeGameId, room.capacity);
        room.turn = 0;
        room.result = null;
      } else {
        room.players.push({ name, tokenHash: hashToken(token), ...(identity ? { userId: identity.userId } : {}) });
      }
      room.updatedAt = Date.now();
      await updateRoom(client, room);
      await notifyRoom(client, { code, type: "room" });
      return { room, seat, token };
    });
  } catch (error) {
    replyWithRetryableRoomSaveError(res, error, "join");
    return;
  }
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

  const connections = socketsByRoom.get(room.code) ?? new Map<WebSocket, number>();
  connections.set(socket, seat);
  socketsByRoom.set(room.code, connections);
  send(socket, { type: "room", room: roomSummary(room, seat), seat });

  socket.on("message", async (raw) => {
    const rejectUpdate = (message: string, currentRoom: ArcadeRoom = room!) => {
      send(socket, { type: "error", message });
      send(socket, { type: "room", room: roomSummary(currentRoom, seat), seat });
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
          if (current.result) return { room: current, eventType: "room" as const };
          if (isArcadeGameFinished(current)) return { room: current, eventType: "room" as const };
          if (current.capacity === 2 && current.players.length === 2) {
            current.result = { winnerSeat: 1 - seat, resignedSeat: seat, endedAt: Date.now() };
            current.updatedAt = current.result.endedAt;
            await persistArcadeMatchResult(client, current);
            await updateRoom(client, current);
            await notifyRoom(client, { code: current.code, type: "room" });
            return { room: current, eventType: "room" as const };
          }
          if (current.players.length === current.capacity) {
            current.players[seat] = {
              name: "Yard bot",
              tokenHash: hashToken(issueToken()),
              ...(current.players[seat].userId ? { userId: current.players[seat].userId } : {}),
              bot: true,
            };
            const botMoved = advanceBotTurns(current);
            current.updatedAt = Date.now();
            await persistArcadeMatchResult(client, current);
            await updateRoom(client, current);
            await notifyRoom(client, { code: current.code, type: botMoved ? "state" : "room" });
            return { room: current, eventType: botMoved ? "state" as const : "room" as const };
          } else {
            current.updatedAt = Date.now();
            await updateRoom(client, current);
            await notifyRoom(client, { code: current.code, type: "resigned", seat });
            return { room: current, eventType: "resigned" as const };
          }
        }
        if (current.result) return { error: "finished" as const, room: current };
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
        const botMoved = advanceBotTurns(current);
        current.updatedAt = Date.now();
        await persistArcadeMatchResult(client, current);
        await updateRoom(client, current);
        await notifyRoom(client, { code: current.code, type: "state" });
        return { room: current, eventType: botMoved ? "state" as const : "state" as const };
      });
      if ("error" in outcome) {
        const errors: Record<string, string> = {
          missing: "Room access expired. Rejoin the room to continue.",
          "not-full": "Wait for all players to join before moving.",
          finished: "This match has ended. Start a new room to play again.",
        };
        const errorKey = typeof outcome.error === "string" ? outcome.error : "missing";
        rejectUpdate(errors[errorKey] ?? errorKey, "room" in outcome ? outcome.room : room);
      } else {
        queueRoomEvent({
          code: room!.code,
          type: outcome.eventType,
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

async function maintainArcadeRooms(afterActivityRefresh?: () => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const activeCodes = [...socketsByRoom.entries()]
      .filter(([, sockets]) => [...sockets.keys()].some((socket) => socket.readyState === WebSocket.OPEN))
      .map(([code]) => code);
    if (activeCodes.length) {
      await client.query("UPDATE arcade_rooms SET updated_at = now() WHERE code = ANY($1::text[])", [activeCodes]);
    }
    await afterActivityRefresh?.();
    await client.query("DELETE FROM arcade_rooms WHERE updated_at < $1", [new Date(Date.now() - ROOM_TTL_MS)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function maintainArcadeRoomsForTest(afterActivityRefresh?: () => Promise<void>): Promise<void> {
  await maintainArcadeRooms(afterActivityRefresh);
}

setInterval(() => {
  void maintainArcadeRooms().catch((error) => logger.error({ err: error }, "Failed to maintain arcade rooms"));
}, 5 * 60 * 1000).unref();

export default router;
