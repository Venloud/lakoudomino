import { randomBytes, createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Router } from "express";
import { WebSocket } from "ws";
import { CreateArcadeRoomBody, JoinArcadeRoomBody, QuickMatchArcadeRoomBody } from "@workspace/api-zod";

const GAME_IDS = new Set([
  "mopyon", "box", "kay", "chess", "dame", "scrabble",
  "barricade", "four-in-a-row", "filler", "block-drop",
]);

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
const router = Router();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function getArcadeInviteRoom(code: string) {
  const room = rooms.get(code.toUpperCase());
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
    state: null, turn: 0, sockets: new Map(), updatedAt: Date.now(),
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

router.post("/arcade/rooms", (req, res) => {
  const parsed = CreateArcadeRoomBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a supported game and enter a player name." });
  const created = createOrFind(parsed.data, true, false);
  if (!created) return res.status(400).json({ error: "Choose a supported game and enter a player name." });
  return res.status(201).json(roomResponse(created.room, created.seat, created.reconnectToken));
});

router.post("/arcade/quick-match", (req, res) => {
  const parsed = QuickMatchArcadeRoomBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a supported game and enter a player name." });
  const joined = createOrFind(parsed.data, false, true);
  if (!joined) return res.status(400).json({ error: "Choose a supported game and enter a player name." });
  return res.status(joined.seat === 0 ? 201 : 200).json(roomResponse(joined.room, joined.seat, joined.reconnectToken));
});

router.post("/arcade/rooms/:code/join", (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  const parsed = JoinArcadeRoomBody.safeParse(req.body);
  const name = parsed.success ? cleanName(parsed.data.displayName) : null;
  if (!room) return res.status(404).json({ error: "That room was not found." });
  if (!name) return res.status(400).json({ error: "Enter a player name." });
  if (room.players.length >= room.capacity) return res.status(409).json({ error: "That room is full." });
  const token = issueToken();
  const seat = room.players.length;
  room.players.push({ name, tokenHash: hashToken(token) });
  room.updatedAt = Date.now();
  publish(room, { type: "room", room: roomSummary(room) });
  return res.status(200).json(roomResponse(room, seat, token));
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

  socket.on("message", (raw) => {
    let message: unknown;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message !== "object") return;
    const event = message as Record<string, unknown>;
    if (event.type === "state") {
      if (room.game === "block-drop") {
        const boards = Array.isArray(room.state) ? [...room.state] : Array(room.capacity).fill(null);
        boards[seat] = event.state;
        room.state = boards;
      } else if (seat !== room.turn || !Number.isInteger(event.turn) || (event.turn as number) < 0 || (event.turn as number) >= room.capacity) {
        send(socket, { type: "error", message: "Wait for your turn before sending a move." });
        return;
      } else {
        room.state = event.state;
        room.turn = event.turn as number;
      }
      room.updatedAt = Date.now();
      publish(room, { type: "state", room: roomSummary(room) });
    } else if (event.type === "resign") {
      room.updatedAt = Date.now();
      publish(room, { type: "resigned", seat });
    }
  });
  socket.on("close", () => {
    connections.delete(socket);
    if (!connections.size) room.sockets.delete(seat);
  });
}

setInterval(() => {
  const expiry = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if (room.updatedAt < expiry) rooms.delete(code);
}, 15 * 60 * 1000).unref();

export default router;
