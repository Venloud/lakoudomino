import { randomBytes, createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Router } from "express";
import { eq, lt } from "drizzle-orm";
import { WebSocket } from "ws";
import { CreateArcadeRoomBody, JoinArcadeRoomBody, QuickMatchArcadeRoomBody } from "@workspace/api-zod";
import { arcadeRooms, db, type ArcadeRoomRecord } from "@workspace/db";
import { logger } from "../lib/logger";

import {
  ARCADE_GAME_IDS,
  createArcadeInitialState,
  validateArcadeTransition,
  type ArcadeGameId,
} from "../lib/arcade-validation.ts";

const GAME_IDS = new Set<string>(ARCADE_GAME_IDS);

type ArcadePlayer = { name: string; tokenHash: string };
type ArcadeRoom = {
  code: string;
  game: string;
  capacity: number;
  isPrivate: boolean;
  players: ArcadePlayer[];
  state: unknown;
  turn: number;
  sockets: Map<number, Set<WebSocket>>;
  updatedAt: number;
};

const rooms = new Map<string, ArcadeRoom>();
const pendingWrites = new Map<string, Promise<void>>();
const router = Router();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

export function getArcadeInviteRoom(code: string) {
  const room = rooms.get(code.toUpperCase());
  if (!room || !room.isPrivate || room.players.length >= room.capacity) return null;
  return { code: room.code, game: room.game };
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
    code: record.code, game: record.game, capacity: record.capacity, isPrivate: record.isPrivate,
    players, state: record.state, turn: record.turn, sockets: new Map(), updatedAt: record.updatedAt.getTime(),
  };
}

function persistRoom(room: ArcadeRoom): Promise<void> {
  const values = {
    code: room.code, game: room.game, capacity: room.capacity, isPrivate: room.isPrivate,
    players: room.players, state: room.state, turn: room.turn, updatedAt: new Date(room.updatedAt),
  };
  const previous = pendingWrites.get(room.code) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await db.insert(arcadeRooms).values(values).onConflictDoUpdate({
      target: arcadeRooms.code,
      set: values,
    });
  });
  pendingWrites.set(room.code, next);
  return next.finally(() => {
    if (pendingWrites.get(room.code) === next) pendingWrites.delete(room.code);
  });
}

export async function initializeArcadeRooms(): Promise<void> {
  const cutoff = new Date(Date.now() - ROOM_TTL_MS);
  await db.delete(arcadeRooms).where(lt(arcadeRooms.updatedAt, cutoff));
  const records = await db.select().from(arcadeRooms);
  for (const record of records) {
    const room = restoreRoom(record);
    if (room) rooms.set(room.code, room);
    else {
      logger.warn({ code: record.code }, "Ignoring invalid persisted arcade room");
      await db.delete(arcadeRooms).where(eq(arcadeRooms.code, record.code));
    }
  }
}

function hasOpenSockets(room: ArcadeRoom): boolean {
  for (const sockets of room.sockets.values()) {
    for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

async function expireInactiveRooms(): Promise<void> {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.updatedAt >= cutoff || hasOpenSockets(room)) continue;
    rooms.delete(code);
    try {
      await db.delete(arcadeRooms).where(eq(arcadeRooms.code, code));
    } catch (error) {
      logger.error({ err: error, code }, "Failed to delete expired arcade room");
    }
  }
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

function makeRoom(game: string, name: string, capacity: number, isPrivate: boolean) {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();
  const token = issueToken();
  const room: ArcadeRoom = {
    code, game, capacity, isPrivate,
    players: [{ name, tokenHash: hashToken(token) }],
    state: createArcadeInitialState(game as ArcadeGameId, capacity), turn: 0,
    sockets: new Map(), updatedAt: Date.now(),
  };
  rooms.set(code, room);
  return { room, seat: 0, reconnectToken: token };
}

function roomResponse(room: ArcadeRoom, seat: number, reconnectToken: string) {
  return { ...roomSummary(room), seat, reconnectToken };
}

function parseCreate(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const game = typeof value.game === "string" ? value.game : "";
  const name = cleanName(value.displayName);
  const capacity = value.playerCount === undefined ? 2 : value.playerCount;
  if (!GAME_IDS.has(game) || !name || !Number.isInteger(capacity) || (capacity !== 2 && capacity !== 3 && capacity !== 4)) return null;
  if (game !== "scrabble" && game !== "filler" && capacity !== 2) return null;
  return { game, name, capacity, isPrivate: value.isPrivate === true };
}

function createOrFind(body: unknown, isPrivate: boolean, match: boolean) {
  const input = parseCreate(body);
  if (!input) return null;
  if (match) {
    const waiting = [...rooms.values()].find((room) =>
      !room.isPrivate && room.game === input.game && room.capacity === input.capacity && room.players.length < room.capacity,
    );
    if (waiting) {
      const token = issueToken();
      const seat = waiting.players.length;
      waiting.players.push({ name: input.name, tokenHash: hashToken(token) });
      waiting.updatedAt = Date.now();
      publish(waiting, { type: "room", room: roomSummary(waiting) });
      return { room: waiting, seat, reconnectToken: token };
    }
  }
  return makeRoom(input.game, input.name, input.capacity, isPrivate || !match);
}

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function publish(room: ArcadeRoom, message: unknown) {
  for (const sockets of room.sockets.values()) for (const socket of sockets) send(socket, message);
}

router.post("/arcade/rooms", async (req, res): Promise<void> => {
  const parsed = CreateArcadeRoomBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  const created = createOrFind(parsed.data, true, false);
  if (!created) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  await persistRoom(created.room);
  res.status(201).json(roomResponse(created.room, created.seat, created.reconnectToken));
});

router.post("/arcade/quick-match", async (req, res): Promise<void> => {
  const parsed = QuickMatchArcadeRoomBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  const joined = createOrFind(parsed.data, false, true);
  if (!joined) { res.status(400).json({ error: "Choose a supported game and enter a player name." }); return; }
  await persistRoom(joined.room);
  res.status(joined.seat === 0 ? 201 : 200).json(roomResponse(joined.room, joined.seat, joined.reconnectToken));
});

router.post("/arcade/rooms/:code/join", async (req, res): Promise<void> => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  const parsed = JoinArcadeRoomBody.safeParse(req.body);
  const name = parsed.success ? cleanName(parsed.data.displayName) : null;
  if (!room) { res.status(404).json({ error: "That room was not found." }); return; }
  if (!name) { res.status(400).json({ error: "Enter a player name." }); return; }
  if (room.players.length >= room.capacity) { res.status(409).json({ error: "That room is full." }); return; }
  const token = issueToken();
  const seat = room.players.length;
  room.players.push({ name, tokenHash: hashToken(token) });
  room.updatedAt = Date.now();
  await persistRoom(room);
  publish(room, { type: "room", room: roomSummary(room) });
  res.status(200).json(roomResponse(room, seat, token));
});

router.get("/arcade/rooms/:code", (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  if (!room) return res.status(404).json({ error: "That room was not found." });
  return res.json(roomSummary(room));
});

export function handleArcadeSocket(socket: WebSocket, request: IncomingMessage): void {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const code = url.searchParams.get("arcadeCode")?.toUpperCase();
  const token = url.searchParams.get("token") ?? "";
  const room = code ? rooms.get(code) : undefined;
  const seat = room?.players.findIndex((player) => player.tokenHash === hashToken(token)) ?? -1;
  if (!room || seat < 0) {
    send(socket, { type: "error", message: "Room access expired. Rejoin the room to continue." });
    socket.close(1008, "Invalid room access");
    return;
  }
  const connections = room.sockets.get(seat) ?? new Set<WebSocket>();
  connections.add(socket);
  room.sockets.set(seat, connections);
  send(socket, { type: "room", room: roomSummary(room), seat });

  socket.on("message", async (raw) => {
    const rejectUpdate = (message: string) => {
      send(socket, { type: "error", message });
      send(socket, { type: "room", room: roomSummary(room), seat });
    };
    let message: unknown;
    const rawText = raw.toString();
    if (rawText.length > 64 * 1024) {
      rejectUpdate("That game update is too large.");
      return;
    }
    try { message = JSON.parse(rawText); } catch {
      rejectUpdate("That game update could not be read.");
      return;
    }
    if (!message || typeof message !== "object") return;
    const event = message as Record<string, unknown>;
    if (event.type === "state") {
      if (room.players.length !== room.capacity) {
        rejectUpdate("Wait for all players to join before moving.");
        return;
      }
      const result = validateArcadeTransition(
        room.game as ArcadeGameId,
        room.state,
        event.state,
        seat,
        room.capacity,
        room.turn,
        event.turn,
      );
      if (!result.ok) {
        rejectUpdate(result.error);
        return;
      }
      const previous = { state: room.state, turn: room.turn, updatedAt: room.updatedAt };
      room.state = result.state;
      room.turn = result.turn;
      room.updatedAt = Date.now();
      try {
        await persistRoom(room);
      } catch (error) {
        room.state = previous.state;
        room.turn = previous.turn;
        room.updatedAt = previous.updatedAt;
        logger.error({ err: error, code: room.code }, "Failed to persist arcade game state");
        rejectUpdate("Your move could not be saved. Please try again.");
        return;
      }
      publish(room, { type: "state", room: roomSummary(room) });
    } else if (event.type === "resign") {
      room.updatedAt = Date.now();
      try { await persistRoom(room); }
      catch (error) { logger.error({ err: error, code: room.code }, "Failed to persist arcade resignation"); }
      publish(room, { type: "resigned", seat });
    }
  });
  socket.on("close", () => {
    connections.delete(socket);
    if (!connections.size) room.sockets.delete(seat);
  });
}

setInterval(() => { void expireInactiveRooms(); }, 15 * 60 * 1000).unref();

export default router;
