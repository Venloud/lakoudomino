import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { WebSocket, type RawData } from "ws";
import {
  createTicTacToeState,
  createYardTicTacToeState,
  playTicTacToeMove,
  playYardTicTacToeMove,
  type TicTacToeGameState,
  type TicTacToeMark,
  type TicTacToeMode,
} from "lakou-engine";
import { CreateTicTacToeRoomBody, JoinTicTacToeRoomBody } from "@workspace/api-zod";
import { db, dominoRooms, ticTacToeResults, ticTacToeRooms } from "@workspace/db";
import { getIdentityFromRequest } from "../lib/auth-session";
import { buildTicTacToeResultInserts } from "../lib/tic-tac-toe-results";

type TicTacToePlayer = {
  seat: 0 | 1;
  mark: TicTacToeMark;
  name: string;
  reconnectTokenHash: string;
  userId?: string | null;
  resigned?: boolean;
};

type RoomStatus = "waiting" | "playing" | "finished";

type TicTacToeRoom = {
  code: string;
  mode: TicTacToeMode;
  status: RoomStatus;
  players: TicTacToePlayer[];
  state: TicTacToeGameState;
  roundNumber: number;
  connections: Map<0 | 1, Set<WebSocket>>;
  spectators: Set<WebSocket>;
};

const rooms = new Map<string, TicTacToeRoom>();
const pendingWrites = new Map<string, Promise<void>>();
const router = Router();

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function issueReconnectToken(): string {
  return randomBytes(32).toString("base64url");
}

function issueRoomCode(): string {
  return `T${randomBytes(4).toString("hex").slice(0, 7).toUpperCase()}`;
}

function isMark(value: unknown): value is TicTacToeMark {
  return value === "X" || value === "O";
}

function isValidState(mode: TicTacToeMode, value: unknown): value is TicTacToeGameState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  if (!isMark(state.currentPlayer) || !(state.winner === null || isMark(state.winner)) ||
      typeof state.isDraw !== "boolean") return false;
  const validCell = (cell: unknown) => cell === null || isMark(cell);
  if (mode === "regular") {
    return Array.isArray(state.board) && state.board.length === 9 && state.board.every(validCell);
  }
  return Array.isArray(state.boards) && state.boards.length === 9 &&
    state.boards.every((board) => Array.isArray(board) && board.length === 9 && board.every(validCell)) &&
    Array.isArray(state.gridResults) && state.gridResults.length === 9 &&
    state.gridResults.every((result) => result === null || result === "draw" || isMark(result)) &&
    (state.nextBoard === null || (Number.isInteger(state.nextBoard) && (state.nextBoard as number) >= 0 && (state.nextBoard as number) < 9));
}

function restoreRoom(record: {
  code: string;
  mode: string;
  status: string;
  players: unknown;
  state: unknown;
  roundNumber?: number;
}): TicTacToeRoom | null {
  if (!/^[A-Z0-9]{4,8}$/.test(record.code) ||
      (record.mode !== "regular" && record.mode !== "yard") ||
      !["waiting", "playing", "finished"].includes(record.status) ||
      !Array.isArray(record.players) ||
      !isValidState(record.mode, record.state)) return null;
  const players = record.players as TicTacToePlayer[];
  if (players.length < 1 || players.length > 2 || players.some((player, index) =>
    !player || player.seat !== index || player.mark !== (index === 0 ? "X" : "O") ||
     typeof player.name !== "string" || typeof player.reconnectTokenHash !== "string" ||
     (player.resigned !== undefined && typeof player.resigned !== "boolean") ||
     (player.userId !== undefined && player.userId !== null && typeof player.userId !== "string"))) return null;
  return {
    code: record.code,
    mode: record.mode,
    status: record.status as RoomStatus,
    players,
    state: record.state,
    roundNumber: Number.isInteger(record.roundNumber) && (record.roundNumber ?? 0) > 0 ? record.roundNumber! : 1,
    connections: new Map(),
    spectators: new Set(),
  };
}

export async function initializeTicTacToeRooms(): Promise<void> {
  rooms.clear();
  const records = await db.select().from(ticTacToeRooms);
  for (const record of records) {
    const room = restoreRoom(record);
    if (room) {
      rooms.set(room.code, room);
      if (room.status === "finished") await persistRoom(room);
    }
  }
}

async function persistRoom(room: TicTacToeRoom): Promise<void> {
  const results = buildTicTacToeResultInserts(room);
  const values = {
    code: room.code,
    mode: room.mode,
    status: room.status,
    players: room.players.map(({ seat, mark, name, reconnectTokenHash, userId, resigned }) => ({ seat, mark, name, reconnectTokenHash, userId: userId ?? null, resigned: resigned ?? false })),
    state: room.state,
    roundNumber: room.roundNumber,
    updatedAt: new Date(),
  };
  const previous = pendingWrites.get(room.code) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await db.insert(ticTacToeRooms).values(values).onConflictDoUpdate({
      target: ticTacToeRooms.code,
      set: values,
    });
    if (results.length) {
      await db.insert(ticTacToeResults).values(results).onConflictDoNothing();
    }
  });
  pendingWrites.set(room.code, next);
  try {
    await next;
  } finally {
    if (pendingWrites.get(room.code) === next) pendingWrites.delete(room.code);
  }
}

function accessResponse(room: TicTacToeRoom, reconnectToken: string) {
  return {
    code: room.code,
    mode: room.mode,
    status: room.status,
    players: room.players.map(({ seat, mark, name }) => ({ seat, mark, name })),
    reconnectToken,
  };
}

function getRoom(code: string): TicTacToeRoom | undefined {
  return rooms.get(code.toUpperCase());
}

async function createRoomCode(): Promise<string> {
  let code = issueRoomCode();
  while (
    rooms.has(code) ||
    (await db.select({ code: ticTacToeRooms.code }).from(ticTacToeRooms).where(eq(ticTacToeRooms.code, code))).length ||
    (await db.select({ code: dominoRooms.code }).from(dominoRooms).where(eq(dominoRooms.code, code))).length
  ) {
    code = issueRoomCode();
  }
  return code;
}

router.post("/tic-tac-toe/rooms", async (req, res) => {
  const parsed = CreateTicTacToeRoomBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a game mode and enter a player name." });
  const displayName = parsed.data.displayName.trim().slice(0, 24);
  if (!displayName) return res.status(400).json({ error: "Enter a player name." });

  const code = await createRoomCode();
  const reconnectToken = issueReconnectToken();
  const identity = await getIdentityFromRequest(req);
  const room: TicTacToeRoom = {
    code,
    mode: parsed.data.mode,
    status: "waiting",
    players: [{ seat: 0, mark: "X", name: displayName, reconnectTokenHash: tokenHash(reconnectToken), userId: identity?.userId ?? null }],
    state: parsed.data.mode === "regular" ? createTicTacToeState() : createYardTicTacToeState(),
    roundNumber: 1,
    connections: new Map(),
    spectators: new Set(),
  };
  rooms.set(code, room);
  try {
    await persistRoom(room);
  } catch (error) {
    rooms.delete(code);
    throw error;
  }
  return res.status(201).json(accessResponse(room, reconnectToken));
});

router.post("/tic-tac-toe/rooms/:code/join", async (req, res) => {
  const params = JoinTicTacToeRoomBody.safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Enter a player name." });
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Tic-Tac-Toe room not found." });
  const resignedPlayer = room.players.find((player) => player.resigned);
  const isReplacementJoin = room.status === "finished" && Boolean(resignedPlayer) && room.players.length === 2;
  if (!isReplacementJoin && (room.status !== "waiting" || room.players.length !== 1)) {
    return res.status(409).json({ error: "This room has already started or is full." });
  }
  const displayName = params.data.displayName.trim().slice(0, 24);
  if (!displayName) return res.status(400).json({ error: "Enter a player name." });
  if (room.players.some((player) => !player.resigned && player.name.toLowerCase() === displayName.toLowerCase())) {
    return res.status(409).json({ error: "Choose a different name from the other player." });
  }
  const reconnectToken = issueReconnectToken();
  const identity = await getIdentityFromRequest(req);
  const newPlayer: TicTacToePlayer = {
    seat: resignedPlayer?.seat ?? 1,
    mark: resignedPlayer?.mark ?? "O",
    name: displayName,
    reconnectTokenHash: tokenHash(reconnectToken),
    userId: identity?.userId ?? null,
    resigned: false,
  };
  if (resignedPlayer) {
    room.players[resignedPlayer.seat] = newPlayer;
    room.state = room.mode === "regular" ? createTicTacToeState() : createYardTicTacToeState();
    room.roundNumber += 1;
  } else {
    room.players.push(newPlayer);
  }
  room.status = "playing";
  await persistRoom(room);
  broadcastRoom(room);
  return res.json(accessResponse(room, reconnectToken));
});

function sendSnapshot(socket: WebSocket, room: TicTacToeRoom, seat: 0 | 1 | null): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: "snapshot",
    code: room.code,
    mode: room.mode,
    status: room.status,
    players: room.players.map(({ seat: playerSeat, mark, name }) => ({ seat: playerSeat, mark, name })),
    state: room.state,
    viewerRole: seat === null ? "spectator" : "player",
    myMark: seat === null ? null : room.players[seat]?.mark ?? null,
    resignedSeat: room.players.find((player) => player.resigned)?.seat ?? null,
  }));
}

function broadcastRoom(room: TicTacToeRoom): void {
  room.connections.forEach((sockets, seat) => {
    sockets.forEach((socket) => sendSnapshot(socket, room, seat));
  });
  room.spectators.forEach((socket) => sendSnapshot(socket, room, null));
}

function sendSocketError(socket: WebSocket, message: string): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "error", message }));
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(new Uint8Array(raw)).toString("utf8");
  return raw.toString("utf8");
}

export async function handleTicTacToeSocket(socket: WebSocket, request: IncomingMessage): Promise<void> {
  const requestUrl = new URL(request.url ?? "/ws", `http://${request.headers.host ?? "localhost"}`);
  const code = requestUrl.searchParams.get("ticCode")?.toUpperCase() ?? "";
  const room = getRoom(code);
  if (!room) {
    sendSocketError(socket, "Tic-Tac-Toe room not found.");
    socket.close(1008, "Room not found");
    return;
  }
  const watchOnly = requestUrl.searchParams.get("ticWatch") === "1";
  let seat: 0 | 1 | undefined;
  if (watchOnly) {
    room.spectators.add(socket);
    sendSnapshot(socket, room, null);
  }

  socket.on("message", async (raw) => {
    let message: unknown;
    try {
      message = JSON.parse(rawDataToString(raw));
    } catch {
      sendSocketError(socket, "That game request could not be read.");
      return;
    }
    if (!message || typeof message !== "object") return;
    const event = message as Record<string, unknown>;
    if (watchOnly) {
      sendSocketError(socket, "Spectators can watch, but cannot play or start another round.");
      return;
    }
    if (event.type === "hello") {
      if (typeof event.reconnectToken !== "string") {
        sendSocketError(socket, "A room reconnect token is required.");
        return;
      }
      const hash = tokenHash(event.reconnectToken);
      const player = room.players.find((candidate) => candidate.reconnectTokenHash === hash);
      if (!player || player.resigned) {
        sendSocketError(socket, "That seat has been released. Join again for the next round.");
        socket.close(1008, "Seat released");
        return;
      }
      seat = player.seat;
      const sockets = room.connections.get(seat) ?? new Set<WebSocket>();
      sockets.add(socket);
      room.connections.set(seat, sockets);
      sendSnapshot(socket, room, seat);
      return;
    }
    if (seat === undefined) {
      sendSocketError(socket, "Reconnect to this room before playing.");
      return;
    }
    if (event.type === "resign") {
      if (room.status !== "playing") {
        sendSocketError(socket, "There is no active round to resign from.");
        return;
      }
      const player = room.players.find((candidate) => candidate.seat === seat);
      const opponent = room.players.find((candidate) => candidate.seat !== seat && !candidate.resigned);
      if (!player || !opponent) {
        sendSocketError(socket, "The opponent seat is not available.");
        return;
      }
      room.players[seat] = { ...player, resigned: true };
      room.state = { ...room.state, winner: opponent.mark, isDraw: false } as TicTacToeGameState;
      room.status = "finished";
      await persistRoom(room);
      broadcastRoom(room);
      return;
    }
    if (event.type === "move") {
      if (room.status !== "playing") {
        sendSocketError(socket, "Wait for both players before making a move.");
        return;
      }
      if (room.state.currentPlayer !== room.players[seat]?.mark) {
        sendSocketError(socket, "It is the other player's turn.");
        return;
      }
      const nextState = room.mode === "regular"
        ? typeof event.index === "number" && "board" in room.state
          ? playTicTacToeMove(room.state, event.index)
          : room.state
        : typeof event.boardIndex === "number" && typeof event.cellIndex === "number" && "boards" in room.state
          ? playYardTicTacToeMove(room.state, event.boardIndex, event.cellIndex)
          : room.state;
      if (nextState === room.state) {
        sendSocketError(socket, "That square is not available.");
        return;
      }
      room.state = nextState;
      if (nextState.winner || nextState.isDraw) room.status = "finished";
      await persistRoom(room);
      broadcastRoom(room);
      return;
    }
    if (event.type === "newRound") {
      if (room.players.some((player) => player.resigned)) {
        sendSocketError(socket, "Waiting for a new opponent to take the open seat.");
        return;
      }
      if (room.status !== "finished") {
        sendSocketError(socket, "The round must finish before starting another.");
        return;
      }
      room.state = room.mode === "regular" ? createTicTacToeState() : createYardTicTacToeState();
      room.status = "playing";
      room.roundNumber += 1;
      await persistRoom(room);
      broadcastRoom(room);
      return;
    }
    sendSocketError(socket, "That game action is not supported.");
  });

  socket.on("close", () => {
    room.spectators.delete(socket);
    if (seat === undefined) return;
    const sockets = room.connections.get(seat);
    sockets?.delete(socket);
    if (!sockets?.size) room.connections.delete(seat);
  });
}

/* original route functions continued below */

export default router;
