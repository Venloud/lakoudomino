import { createHash, randomBytes, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { WebSocket, type RawData } from "ws";
import {
  chooseWordYardAnswer,
  createWordYardMatch,
  scoreWordYardRound,
  settleWordYardDeadline,
  startNextWordYardMatchRound,
  submitWordYardMatchGuess,
  toWordYardMatchView,
  type WordYardMatch,
  type WordYardMode,
} from "lakou-engine";
import { db, dominoRooms, ticTacToeRooms, wordYardResults, wordYardRooms } from "@workspace/db";
import { getIdentityFromRequest } from "../lib/auth-session";
import { logger } from "../lib/logger";

type Player = {
  seat: number;
  playerId: string;
  name: string;
  ready: boolean;
  reconnectTokenHash: string;
  userId: string | null;
};
type RoomStatus = "waiting" | "playing" | "round-complete" | "finished";
type Room = {
  code: string;
  mode: WordYardMode;
  status: RoomStatus;
  playerCount: 2 | 3 | 4;
  wordLength: number;
  timeLimitMs: number;
  roundsToPlay: number;
  isPrivate: boolean;
  players: Player[];
  match: WordYardMatch | null;
  connections: Map<number, Set<WebSocket>>;
};

const router = Router();
const rooms = new Map<string, Room>();
const pendingWrites = new Map<string, Promise<void>>();
let acceptedWords: ReadonlySet<string> | null = null;
let deadlineTimer: NodeJS.Timeout | null = null;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function issueToken(): string {
  return randomBytes(32).toString("base64url");
}
function issueCode(): string {
  return `W${randomBytes(4).toString("hex").slice(0, 5).toUpperCase()}`;
}
function isMode(value: unknown): value is WordYardMode {
  return value === "classic" || value === "speed" || value === "party";
}
function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

async function dictionary(): Promise<ReadonlySet<string>> {
  if (acceptedWords) return acceptedWords;
  const path = resolve(process.cwd(), "../caribbean-dominoes/src/lib/data/word-list.bin");
  const compressed = await readFile(path);
  const words = gunzipSync(compressed).toString("utf8").toUpperCase().split(/\s+/);
  acceptedWords = new Set(words.filter((word) => word.length >= 4 && word.length <= 7 && /^[A-Z]+$/.test(word)));
  if (acceptedWords.size === 0) throw new Error("The licensed Word Yard dictionary contains no playable words.");
  return acceptedWords;
}

function roomState(room: Room) {
  return {
    wordLength: room.wordLength,
    timeLimitMs: room.timeLimitMs,
    roundsToPlay: room.roundsToPlay,
    isPrivate: room.isPrivate,
    match: room.match,
  };
}

async function persist(room: Room): Promise<void> {
  const values = {
    code: room.code,
    mode: room.mode,
    status: room.status,
    playerCount: room.playerCount,
    players: room.players,
    state: roomState(room),
    updatedAt: new Date(),
  };
  const previous = pendingWrites.get(room.code) ?? Promise.resolve();
  const next: Promise<void> = previous.catch(() => undefined).then(async () => {
    await db.insert(wordYardRooms).values(values).onConflictDoUpdate({
      target: wordYardRooms.code,
      set: values,
    });
    if (room.match && (room.match.status === "round-complete" || room.match.status === "finished")) {
      const roundNumber = room.match.roundNumber;
      const resultRows = room.match.players.flatMap((player) => {
        const userId = room.players.find((seat) => seat.playerId === player.playerId)?.userId;
        if (!userId) return [];
        const round = player.rounds[roundNumber - 1];
        if (!round) return [];
        const score = scoreWordYardRound(round);
        return [{
          roomCode: room.code,
          roundNumber,
          userId,
          mode: room.mode,
          score: score.points,
          completionTimeMs: score.completionMs,
          outcome: round.status === "solved" ? "solved" : "unsolved",
        }];
      });
      if (resultRows.length) {
        await db.insert(wordYardResults).values(resultRows).onConflictDoNothing();
      }
    }
  });
  pendingWrites.set(room.code, next);
  try {
    await next;
  } finally {
    if (pendingWrites.get(room.code) === next) pendingWrites.delete(room.code);
  }
}

function restoreRoom(record: { code: string; mode: string; status: string; playerCount: number; players: unknown; state: unknown }): Room | null {
  if (!/^[A-Z0-9]{4,8}$/.test(record.code) || !isMode(record.mode) ||
      !["waiting", "playing", "round-complete", "finished"].includes(record.status) ||
      ![2, 3, 4].includes(record.playerCount) || !Array.isArray(record.players) ||
      !record.state || typeof record.state !== "object") return null;
  const state = record.state as Record<string, unknown>;
  if (!Number.isInteger(state.wordLength) || (state.wordLength as number) < 4 || (state.wordLength as number) > 7 ||
      !Number.isInteger(state.timeLimitMs) || (state.timeLimitMs as number) < 10_000 ||
      !Number.isInteger(state.roundsToPlay) || (state.roundsToPlay as number) < 1 ||
      typeof state.isPrivate !== "boolean") return null;
  const players = record.players as Player[];
  if (players.length > record.playerCount || players.some((player, seat) =>
    !player || player.seat !== seat || typeof player.playerId !== "string" ||
    typeof player.name !== "string" || typeof player.ready !== "boolean" ||
    typeof player.reconnectTokenHash !== "string")) return null;
  const match = state.match as WordYardMatch | null;
  return {
    code: record.code,
    mode: record.mode,
    status: record.status as RoomStatus,
    playerCount: record.playerCount as 2 | 3 | 4,
    wordLength: state.wordLength as number,
    timeLimitMs: state.timeLimitMs as number,
    roundsToPlay: state.roundsToPlay as number,
    isPrivate: state.isPrivate,
    players,
    match,
    connections: new Map(),
  };
}

export async function initializeWordYardRooms(): Promise<void> {
  rooms.clear();
  acceptedWords = null;
  await dictionary();
  const records = await db.select().from(wordYardRooms);
  for (const record of records) {
    const room = restoreRoom(record);
    if (room) rooms.set(room.code, room);
  }
  if (!deadlineTimer) {
    deadlineTimer = setInterval(() => {
      for (const room of rooms.values()) {
        if (room.status !== "playing" || !room.match) continue;
        const settled = settleWordYardDeadline(room.match, Date.now());
        if (settled === room.match || settled.status === "playing") continue;
        room.match = settled;
        room.status = settled.status === "finished" ? "finished" : "round-complete";
        room.players = room.players.map((player) => ({ ...player, ready: false }));
        void persist(room).then(() => broadcast(room)).catch((error) => {
          logger.error({ err: error, roomCode: room.code }, "Could not persist a timed-out Word Yard round.");
        });
      }
    }, 1000);
  }
}

function safeSnapshot(room: Room, viewerSeat?: number) {
  const viewerId = viewerSeat === undefined ? "" : room.players[viewerSeat]?.playerId ?? "";
  const view = room.match && viewerId ? toWordYardMatchView(room.match, viewerId) : null;
  return {
    code: room.code,
    mode: room.mode,
    status: room.status,
    playerCount: room.playerCount,
    wordLength: room.wordLength,
    timeLimitMs: room.timeLimitMs,
    roundsToPlay: room.roundsToPlay,
    isPrivate: room.isPrivate,
    players: room.players.map((player) => ({
      seat: player.seat,
      playerId: player.playerId,
      name: player.name,
      ready: player.ready,
      guessesUsed: view?.players.find((entry) => entry.playerId === player.playerId)?.guessesUsed ?? 0,
      roundStatus: view?.players.find((entry) => entry.playerId === player.playerId)?.status ?? "waiting",
      totalScore: view?.players.find((entry) => entry.playerId === player.playerId)?.totalScore ?? 0,
    })),
    match: view,
  };
}

function sendSnapshot(socket: WebSocket, room: Room, seat: number): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "snapshot", room: safeSnapshot(room, seat) }));
  }
}
function broadcast(room: Room): void {
  for (const [seat, sockets] of room.connections) {
    for (const socket of sockets) sendSnapshot(socket, room, seat);
  }
}
function sendError(socket: WebSocket, message: string): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "error", message }));
}
function rawText(raw: RawData): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(new Uint8Array(raw)).toString("utf8");
  return raw.toString("utf8");
}
function seatForToken(room: Room, token: string): number {
  return room.players.find((player) => player.reconnectTokenHash === hashToken(token))?.seat ?? -1;
}

async function startMatch(room: Room): Promise<void> {
  if (room.players.length !== room.playerCount || room.players.some((player) => !player.ready)) return;
  const words = await dictionary();
  const answer = chooseWordYardAnswer(words, room.wordLength, () => randomInt(1_000_000) / 1_000_000);
  room.match = createWordYardMatch({
    mode: room.mode,
    playerIds: room.players.map((player) => player.playerId),
    answer,
    startedAt: Date.now(),
    timeLimitMs: room.timeLimitMs,
    roundsToPlay: room.roundsToPlay,
  });
  room.status = "playing";
}

async function setReady(room: Room, seat: number): Promise<void> {
  room.players[seat] = { ...room.players[seat], ready: true };
  if (room.status === "round-complete" && room.players.every((player) => player.ready)) {
    const words = await dictionary();
    const answer = chooseWordYardAnswer(words, room.wordLength, () => randomInt(1_000_000) / 1_000_000);
    room.match = startNextWordYardMatchRound(room.match!, answer, Date.now());
    room.players = room.players.map((player) => ({ ...player, ready: false }));
    room.status = "playing";
  } else if (room.status === "waiting") {
    await startMatch(room);
  }
  await persist(room);
  broadcast(room);
}

async function submitGuess(room: Room, seat: number, guess: string): Promise<string | null> {
  if (room.status !== "playing" || !room.match) return "The round is not accepting guesses.";
  const result = submitWordYardMatchGuess(room.match, room.players[seat].playerId, guess, await dictionary(), Date.now());
  if (!result.match) return result.error;
  room.match = result.match;
  if (room.match.status === "round-complete") {
    room.status = "round-complete";
    room.players = room.players.map((player) => ({ ...player, ready: false }));
  } else if (room.match.status === "finished") room.status = "finished";
  await persist(room);
  broadcast(room);
  return null;
}

function accessResponse(room: Room, seat: number, token: string) {
  return { room: safeSnapshot(room, seat), seat, reconnectToken: token };
}

async function newRoom(input: {
  displayName: string;
  mode: WordYardMode;
  playerCount: 2 | 3 | 4;
  wordLength: number;
  timeLimitMs: number;
  roundsToPlay: number;
  isPrivate: boolean;
  userId: string | null;
}): Promise<{ room: Room; token: string }> {
  let code = issueCode();
  while (rooms.has(code) ||
    (await db.select({ code: dominoRooms.code }).from(dominoRooms).where(eq(dominoRooms.code, code))).length ||
    (await db.select({ code: ticTacToeRooms.code }).from(ticTacToeRooms).where(eq(ticTacToeRooms.code, code))).length ||
    (await db.select({ code: wordYardRooms.code }).from(wordYardRooms).where(eq(wordYardRooms.code, code))).length) code = issueCode();
  const token = issueToken();
  const room: Room = {
    code, mode: input.mode, status: "waiting", playerCount: input.playerCount,
    wordLength: input.wordLength, timeLimitMs: input.timeLimitMs, roundsToPlay: input.roundsToPlay,
    isPrivate: input.isPrivate,
    players: [{
      seat: 0, playerId: randomBytes(12).toString("hex"), name: input.displayName,
      ready: false, reconnectTokenHash: hashToken(token), userId: input.userId,
    }],
    match: null, connections: new Map(),
  };
  await persist(room);
  rooms.set(code, room);
  return { room, token };
}

type Settings = {
  mode: WordYardMode; playerCount: 2 | 3 | 4; wordLength: number; timeLimitMs: number;
  roundsToPlay: number; isPrivate: boolean; displayName: string;
};
function parseSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!isMode(body.mode) || ![2, 3, 4].includes(body.playerCount as number) ||
      !Number.isInteger(body.wordLength) || (body.wordLength as number) < 4 || (body.wordLength as number) > 7 ||
      !Number.isInteger(body.timeLimitMs) || (body.timeLimitMs as number) < 10_000 || (body.timeLimitMs as number) > 600_000 ||
      !Number.isInteger(body.roundsToPlay) || (body.roundsToPlay as number) < 1 || (body.roundsToPlay as number) > 10 ||
      typeof body.isPrivate !== "boolean" || typeof body.displayName !== "string") return null;
  return {
    mode: body.mode,
    playerCount: body.playerCount as 2 | 3 | 4,
    wordLength: body.wordLength as number,
    timeLimitMs: body.timeLimitMs as number,
    roundsToPlay: body.roundsToPlay as number,
    isPrivate: body.isPrivate,
    displayName: body.displayName,
  };
}

router.get("/word-yard/rooms", (_req, res) => {
  res.json({
    rooms: [...rooms.values()].filter((room) => !room.isPrivate && room.status === "waiting" && room.players.length < room.playerCount)
      .map((room) => ({ code: room.code, mode: room.mode, playerCount: room.playerCount, wordLength: room.wordLength, seatsTaken: room.players.length })),
  });
});

router.post("/word-yard/rooms", async (req, res) => {
  const settings = parseSettings(req.body);
  if (!settings) return res.status(400).json({ error: "Choose valid Word Yard room settings and enter a display name." });
  const displayName = settings.displayName.trim().slice(0, 24);
  if (!displayName) return res.status(400).json({ error: "Enter a display name." });
  const identity = await getIdentityFromRequest(req);
  const created = await newRoom({
    ...settings, displayName, userId: identity?.userId ?? null,
  });
  return res.status(201).json(accessResponse(created.room, 0, created.token));
});

router.post("/word-yard/quick-match", async (req, res) => {
  const settings = parseSettings({ ...req.body, isPrivate: false });
  if (!settings) return res.status(400).json({ error: "Choose valid Word Yard match settings and enter a display name." });
  const displayName = settings.displayName.trim().slice(0, 24);
  if (!displayName) return res.status(400).json({ error: "Enter a display name." });
  const room = [...rooms.values()].find((candidate) => !candidate.isPrivate && candidate.status === "waiting" &&
    candidate.mode === settings.mode && candidate.playerCount === settings.playerCount &&
    candidate.wordLength === settings.wordLength && candidate.timeLimitMs === settings.timeLimitMs &&
    candidate.roundsToPlay === settings.roundsToPlay && candidate.players.length < candidate.playerCount);
  if (!room) {
    const identity = await getIdentityFromRequest(req);
    const created = await newRoom({
      ...settings, displayName, isPrivate: false,
      userId: identity?.userId ?? null,
    });
    return res.status(201).json(accessResponse(created.room, 0, created.token));
  }
  const token = issueToken();
  const seat = room.players.length;
  const identity = await getIdentityFromRequest(req);
  room.players.push({
    seat, playerId: randomBytes(12).toString("hex"), name: displayName,
    ready: false, reconnectTokenHash: hashToken(token), userId: identity?.userId ?? null,
  });
  await persist(room);
  broadcast(room);
  return res.status(200).json(accessResponse(room, seat, token));
});

router.post("/word-yard/rooms/:code/join", async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Word Yard room not found." });
  if (room.status !== "waiting" || room.players.length >= room.playerCount) return res.status(409).json({ error: "This Word Yard room is full or has started." });
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim().slice(0, 24) : "";
  if (!displayName) return res.status(400).json({ error: "Enter a display name." });
  const token = issueToken();
  const seat = room.players.length;
  const identity = await getIdentityFromRequest(req);
  room.players.push({ seat, playerId: randomBytes(12).toString("hex"), name: displayName, ready: false, reconnectTokenHash: hashToken(token), userId: identity?.userId ?? null });
  await persist(room);
  broadcast(room);
  return res.json(accessResponse(room, seat, token));
});

router.post("/word-yard/rooms/:code/ready", async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Word Yard room not found." });
  const token = typeof req.body?.reconnectToken === "string" ? req.body.reconnectToken : "";
  const seat = seatForToken(room, token);
  if (seat < 0) return res.status(403).json({ error: "Reconnect to your seat before readying up." });
  await setReady(room, seat);
  return res.json({ room: safeSnapshot(room, seat) });
});

router.post("/word-yard/rooms/:code/guess", async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Word Yard room not found." });
  const token = typeof req.body?.reconnectToken === "string" ? req.body.reconnectToken : "";
  const seat = seatForToken(room, token);
  if (seat < 0) return res.status(403).json({ error: "Reconnect to your seat before guessing." });
  if (typeof req.body?.guess !== "string") return res.status(400).json({ error: "Enter a word guess." });
  const error = await submitGuess(room, seat, req.body.guess);
  if (error) return res.status(409).json({ error });
  return res.json({ room: safeSnapshot(room, seat) });
});

export async function handleWordYardSocket(socket: WebSocket, request: IncomingMessage): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const room = getRoom(url.searchParams.get("wordCode") ?? "");
  if (!room) {
    sendError(socket, "Word Yard room not found.");
    socket.close(1008, "Room not found");
    return;
  }
  let seat = -1;
  socket.on("message", async (raw) => {
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawText(raw));
      if (!parsed || typeof parsed !== "object") throw new Error();
      event = parsed as Record<string, unknown>;
    } catch {
      sendError(socket, "That Word Yard request could not be read.");
      return;
    }
    if (event.type === "hello") {
      seat = typeof event.reconnectToken === "string" ? seatForToken(room, event.reconnectToken) : -1;
      if (seat < 0) {
        sendError(socket, "That reconnect token does not own a seat in this room.");
        socket.close(1008, "Invalid reconnect token");
        return;
      }
      const connections = room.connections.get(seat) ?? new Set<WebSocket>();
      connections.add(socket);
      room.connections.set(seat, connections);
      sendSnapshot(socket, room, seat);
      return;
    }
    if (seat < 0) {
      sendError(socket, "Reconnect to your room before playing.");
      return;
    }
    if (event.type === "ready") await setReady(room, seat);
    else if (event.type === "guess" && typeof event.word === "string") {
      const error = await submitGuess(room, seat, event.word);
      if (error) sendError(socket, error);
    } else sendError(socket, "That Word Yard action is not supported.");
  });
  socket.on("close", () => {
    if (seat < 0) return;
    const connections = room.connections.get(seat);
    connections?.delete(socket);
    if (!connections?.size) room.connections.delete(seat);
  });
}

router.get("/word-yard/health", (_req, res) => res.json({ activeRooms: rooms.size }));

export default router;
