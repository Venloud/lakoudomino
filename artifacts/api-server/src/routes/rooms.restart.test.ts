import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { WebSocket } from "ws";
import { pool } from "@workspace/db";
import { applyAction, autoStep, createMatch, viewFor, type Action } from "lakou-engine";
import { restoreRooms, serializeRoom } from "../lib/room-persistence-codec.ts";
import {
  hashReconnectToken,
  SOCKET_AUTHENTICATION_ERROR,
  SOCKET_PROTOCOL_ERROR,
} from "../lib/room-protocol.ts";
import type { PersistedRoomState } from "../lib/room-types.ts";

type JsonRecord = Record<string, unknown>;
const apiServerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const delay = (milliseconds: number) =>
  new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => error ? reject(error) : resolveClose()),
  );
  return address.port;
}

async function startRoomsProcess(databaseUrl: string): Promise<{
  child: ChildProcess;
  baseUrl: string;
  getOutput: () => string;
}> {
  const port = await reservePort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/routes/rooms-test-process.ts"],
    {
      cwd: apiServerDirectory,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "test",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Rooms API process exited during startup:\n${output}`);
    }
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) {
        return { child, baseUrl, getOutput: () => output };
      }
    } catch {
      // The process is still starting; try again.
    }
    await delay(100);
  }

  child.kill("SIGKILL");
  throw new Error(`Rooms API process did not become ready:\n${output}`);
}

async function stopRoomsProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit").then(() => undefined);
  child.kill("SIGTERM");
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    exited,
    new Promise<void>((resolveTimeout) => {
      timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolveTimeout();
      }, 5_000);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  await exited;
}

async function createRoomsTable(schema: string): Promise<void> {
  await pool.query(`
    CREATE TABLE "${schema}".domino_rooms (
      code text PRIMARY KEY,
      host_name text NOT NULL,
      mode text NOT NULL,
      row_length integer NOT NULL,
      player_count integer NOT NULL DEFAULT 4,
      row_boxes integer NOT NULL DEFAULT 10,
      two_player_variant text NOT NULL DEFAULT 'draw',
      turn_seconds integer NOT NULL DEFAULT 30,
      is_private boolean NOT NULL DEFAULT false,
      speed real NOT NULL DEFAULT 1,
      play_now boolean NOT NULL DEFAULT false,
      afk_state jsonb,
      seed integer,
      status text NOT NULL,
      seats jsonb NOT NULL,
      last_action text,
      engine_state jsonb,
      waitlist jsonb NOT NULL DEFAULT '[]',
      offers jsonb NOT NULL DEFAULT '[]',
      active_match_id text,
      stats_recorded boolean NOT NULL DEFAULT false,
      match_participants jsonb NOT NULL DEFAULT '[]',
      lifecycle_applied boolean NOT NULL DEFAULT false,
      crowns_eligible boolean,
      host_disconnected_at bigint,
      chat_history jsonb NOT NULL DEFAULT '[]',
      quarantined_at timestamptz,
      quarantine_issues jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function receiveSocketMessage(socket: WebSocket, timeoutMs = 5_000): Promise<JsonRecord> {
  return await new Promise((resolveMessage, rejectMessage) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    const onMessage = (raw: unknown) => {
      cleanup();
      try {
        resolveMessage(JSON.parse(String(raw)) as JsonRecord);
      } catch (error) {
        rejectMessage(error);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      rejectMessage(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      rejectMessage(new Error("Timed out waiting for a room WebSocket message."));
    }, timeoutMs);
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

async function receiveSocketMessageMatching(
  socket: WebSocket,
  matches: (message: JsonRecord) => boolean,
  timeoutMs = 5_000,
): Promise<JsonRecord> {
  return await new Promise((resolveMessage, rejectMessage) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    const onMessage = (raw: unknown) => {
      let message: JsonRecord;
      try {
        message = JSON.parse(String(raw)) as JsonRecord;
      } catch (error) {
        cleanup();
        rejectMessage(error);
        return;
      }
      if (matches(message)) {
        cleanup();
        resolveMessage(message);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      rejectMessage(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      rejectMessage(new Error("Timed out waiting for the expected room WebSocket message."));
    }, timeoutMs);
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

async function receiveHumanTurnClock(
  socket: WebSocket,
  seat: number,
  turnMs: number,
): Promise<JsonRecord> {
  return await new Promise((resolveMessage, rejectMessage) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    const onMessage = (raw: unknown) => {
      let message: JsonRecord;
      try {
        message = JSON.parse(String(raw)) as JsonRecord;
      } catch (error) {
        cleanup();
        rejectMessage(error);
        return;
      }
      const game = message.game as JsonRecord | undefined;
      if (message.type !== "snapshot" ||
          game?.turnSeat !== seat ||
          message.turnMs !== turnMs ||
          typeof message.turnDeadline !== "number") return;
      cleanup();
      resolveMessage(message);
    };
    const onError = (error: Error) => {
      cleanup();
      rejectMessage(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      rejectMessage(new Error("Timed out waiting for the restored human turn clock."));
    }, 10_000);
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

async function openRoomSocket(baseUrl: string, code: string, watchOnly = false): Promise<WebSocket> {
  const watchQuery = watchOnly ? "&watch=1" : "";
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws?code=${encodeURIComponent(code)}${watchQuery}`);
  await once(socket, "open");
  return socket;
}

async function expectSocketError(socket: WebSocket, payload: string, expected: string): Promise<void> {
  const message = new Promise<JsonRecord>((resolveMessage, rejectMessage) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    const onMessage = (raw: unknown) => {
      let value: JsonRecord;
      try {
        value = JSON.parse(String(raw)) as JsonRecord;
      } catch (error) {
        cleanup();
        rejectMessage(error);
        return;
      }
      if (value.type !== "error") return;
      cleanup();
      resolveMessage(value);
    };
    const onError = (error: Error) => {
      cleanup();
      rejectMessage(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      rejectMessage(new Error("Timed out waiting for a room WebSocket error."));
    }, 5_000);
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
  socket.send(payload);
  assert.deepEqual(await message, { type: "error", message: expected });
}

async function receiveRoomSettings(
  socket: WebSocket,
  expected: Record<string, unknown>,
): Promise<JsonRecord> {
  return await new Promise((resolveMessage, rejectMessage) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    const onMessage = (raw: unknown) => {
      let message: JsonRecord;
      try {
        message = JSON.parse(String(raw)) as JsonRecord;
      } catch (error) {
        cleanup();
        rejectMessage(error);
        return;
      }
      if (message.type !== "snapshot") return;
      const settings = message.roomSettings as JsonRecord | undefined;
      if (!settings || !Object.entries(expected).every(([key, value]) => settings[key] === value)) return;
      cleanup();
      resolveMessage(message);
    };
    const onError = (error: Error) => {
      cleanup();
      rejectMessage(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      rejectMessage(new Error("Timed out waiting for the expected room settings snapshot."));
    }, 5_000);
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function makeRoom(code: string, match: ReturnType<typeof createMatch>["match"], botOnTurn: boolean): PersistedRoomState {
  const activeSeat = match.hand.turn;
  const otherPlayerSeat = activeSeat === 0 ? 1 : 0;
  const seats = Array.from({ length: 4 }, (_, seat) => {
    const isPlayingSeat = seat === activeSeat || seat === otherPlayerSeat;
    const isBot = isPlayingSeat && (seat === activeSeat ? botOnTurn : !botOnTurn);
    return {
      seat: seat as 0 | 1 | 2 | 3,
      status: !isPlayingSeat ? "open" as const : isBot ? "bot" as const : "waiting" as const,
      ...(isBot ? { botLevel: "easy" as const } : {}),
      name: !isPlayingSeat ? null : isBot ? "Restart bot" : "Restart human",
      reconnectTokenHash: null,
      userId: null,
    };
  });

  return {
    code,
    hostName: "Restart human",
    mode: "regular",
    rowLength: 10,
    playerCount: 2,
    rowBoxes: 10,
    twoPlayerVariant: "draw",
    turnSeconds: 30,
    isPrivate: false,
    seed: match.config.seed,
    status: "playing",
    seats,
    lastAction: "Restored test match",
    engineState: match,
    waitlist: [],
    offers: [],
  };
}

function pointsHandEndingMove(seed: number): {
  match: ReturnType<typeof createMatch>["match"];
  action: Action;
  finishedMatch: ReturnType<typeof createMatch>["match"];
} {
  let match = createMatch({ mode: "points", playerCount: 4, seed }).match;
  for (let index = 0; index < 500 && !match.hand.over && !match.over; index += 1) {
    const legal = viewFor(match, match.hand.turn).legal;
    const action = legal.find((candidate) => candidate.type === "play") ??
      legal.find((candidate) => candidate.type === "draw") ??
      legal.find((candidate) => candidate.type === "pass");
    assert.ok(action, "engine exposes a legal action until the hand ends");
    const next = applyAction(match, action).match;
    if (next.hand.over) {
      assert.equal(next.over, false, "the fixture should end one Points hand, not the whole match");
      return { match, action, finishedMatch: next };
    }
    match = next;
  }
  assert.fail("the fixture should reach a hand-ending move");
}

async function insertRoom(
  schema: string,
  room: PersistedRoomState,
  legacySeatWithoutTokenHash?: number,
): Promise<void> {
  const stored = serializeRoom(room);
  if (legacySeatWithoutTokenHash !== undefined) {
    delete (stored.seats[legacySeatWithoutTokenHash] as { reconnectTokenHash?: string | null }).reconnectTokenHash;
  }
  await pool.query(
    `INSERT INTO "${schema}".domino_rooms
      (code, host_name, mode, row_length, player_count, row_boxes, two_player_variant,
       turn_seconds, is_private, speed, play_now, afk_state, seed, status, seats, last_action, engine_state,
       waitlist, offers, active_match_id, stats_recorded, match_participants,
       lifecycle_applied, crowns_eligible, host_disconnected_at, quarantined_at, quarantine_issues)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14,
        $15::jsonb, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20, $21, $22::jsonb,
        $23, $24, $25, NULL, NULL)`,
    [
      stored.code, stored.hostName, stored.mode, stored.rowLength, stored.playerCount,
      stored.rowBoxes, stored.twoPlayerVariant, stored.turnSeconds, stored.isPrivate,
      stored.speed, stored.playNow, JSON.stringify(stored.afkState ?? null), stored.seed,
      stored.status, JSON.stringify(stored.seats), stored.lastAction,
      JSON.stringify(stored.engineState), JSON.stringify(stored.waitlist),
      JSON.stringify(stored.offers), stored.activeMatchId, stored.statsRecorded,
      JSON.stringify(stored.matchParticipants), stored.lifecycleApplied ?? Boolean(stored.engineState?.over),
      stored.crownsEligible ?? null, stored.hostDisconnectedAt,
    ],
  );
}

async function getGame(baseUrl: string, code: string): Promise<JsonRecord> {
  const response = await fetch(`${baseUrl}/api/rooms/${code}/game`);
  if (!response.ok) {
    assert.fail(`game snapshot failed with ${response.status}: ${await response.text()}`);
  }
  return await response.json() as JsonRecord;
}

function matchesMatch(game: JsonRecord, match: ReturnType<typeof createMatch>["match"]): boolean {
  if (game.turnSeat !== match.hand.turn ||
      !Array.isArray(game.board) ||
      game.board.length !== match.hand.board.history.length ||
      !Array.isArray(game.players)) return false;
  return (game.players as JsonRecord[]).every((player) => {
    const seat = Number(player.seat);
    return Number.isInteger(seat) && player.tileCount === match.hand.hands[seat]?.length;
  });
}

async function waitForBotAdvance(
  baseUrl: string,
  code: string,
  initialMatch: ReturnType<typeof createMatch>["match"],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const game = await getGame(baseUrl, code);
    if (!matchesMatch(game, initialMatch)) return true;
    await delay(100);
  }
  return !matchesMatch(await getGame(baseUrl, code), initialMatch);
}

test("a restored bot turn resumes automatically while a restored human turn waits", {
  timeout: 90_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room restart integration tests.");

  const schema = `rooms_restart_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startRoomsProcess>> | undefined;
  let humanSocket: WebSocket | undefined;
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await createRoomsTable(schema);

    const initial = createMatch({
      mode: "regular",
      playerCount: 2,
      rowBoxes: 10,
      twoPlayerVariant: "draw",
      seed: 73,
    }).match;
    const opening = autoStep(initial, []);
    assert.ok(opening, "fixture opening should be a legal automatic move");
    assert.equal(opening.match.hand.board.history.length, 1);
    const afterOpening = opening.match;
    const activeSeat = afterOpening.hand.turn;
    const botCode = `B${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const humanCode = `H${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    await insertRoom(schema, makeRoom(botCode, afterOpening, true));
    await insertRoom(schema, makeRoom(humanCode, afterOpening, false));

    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());

    humanSocket = new WebSocket(
      `${api.baseUrl.replace(/^http/, "ws")}/ws?code=${encodeURIComponent(humanCode)}&watch=1`,
    );
    const humanClockPromise = receiveHumanTurnClock(humanSocket, activeSeat, 30_000);
    await once(humanSocket, "open");
    humanSocket.send(JSON.stringify({ type: "hello", displayName: "Clock observer" }));
    const humanClock = await humanClockPromise;
    const turnDeadline = humanClock.turnDeadline as number;
    assert.equal(humanClock.turnMs, 30_000, "the restored human should receive the configured 30-second clock");
    assert.ok(
      turnDeadline - Date.now() >= 29_000,
      "the full turn clock should start after the restored room's startup pacing",
    );

    assert.equal(
      await waitForBotAdvance(api.baseUrl, botCode, afterOpening, 12_000),
      true,
      "the active bot must make a move or otherwise advance the restored hand",
    );

    const humanInitial = await getGame(api.baseUrl, humanCode);
    assert.equal(humanInitial.turnSeat, activeSeat, "the fixture should restore on the human seat");
    assert.equal(matchesMatch(humanInitial, afterOpening), true, "the human fixture should start at its persisted state");
    const waitUntilBeforeDeadline = turnDeadline - Date.now() - 500;
    if (waitUntilBeforeDeadline > 0) await delay(waitUntilBeforeDeadline);
    const humanAfterWait = await getGame(api.baseUrl, humanCode);
    assert.ok(Date.now() < turnDeadline, "the final state check should happen before the configured turn limit");
    assert.equal(
      matchesMatch(humanAfterWait, afterOpening),
      true,
      "a restored human turn must not time out or play automatically before its configured limit",
    );
  } finally {
    if (humanSocket && humanSocket.readyState !== WebSocket.CLOSED) humanSocket.close();
    if (api) await stopRoomsProcess(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("live room WebSocket rejects invalid and unauthenticated messages without changing the room snapshot", {
  timeout: 90_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room WebSocket integration tests.");

  const schema = `rooms_ws_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startRoomsProcess>> | undefined;
  let spectator: WebSocket | undefined;
  let watchOnlySpectator: WebSocket | undefined;
  let player: WebSocket | undefined;
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await createRoomsTable(schema);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());

    const createResponse = await fetch(`${api.baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Protocol host",
        mode: "regular",
        playerCount: 2,
        rowLength: 10,
        rowBoxes: 10,
        twoPlayerVariant: "draw",
        isPrivate: true,
      }),
    });
    if (createResponse.status !== 201) assert.fail(`room create failed: ${await createResponse.text()}`);
    const created = await createResponse.json() as { code: string; reconnectToken: string };
    const joinResponse = await fetch(`${api.baseUrl}/api/rooms/${created.code}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Protocol guest" }),
    });
    if (joinResponse.status !== 200) assert.fail(`room join failed: ${await joinResponse.text()}`);
    const joined = await joinResponse.json() as { reconnectToken: string };
    const startResponse = await fetch(`${api.baseUrl}/api/rooms/${created.code}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reconnectToken: created.reconnectToken }),
    });
    if (startResponse.status !== 200) assert.fail(`room start failed: ${await startResponse.text()}`);
    const baseline = await getGame(api.baseUrl, created.code);

    spectator = await openRoomSocket(api.baseUrl, created.code);
    const unchanged = async () => assert.deepEqual(await getGame(api!.baseUrl, created.code), baseline);
    await expectSocketError(spectator, "{malformed", SOCKET_PROTOCOL_ERROR);
    await unchanged();
    await expectSocketError(spectator, JSON.stringify({ type: "unknown-event" }), SOCKET_PROTOCOL_ERROR);
    await unchanged();

    const legacyHello = receiveSocketMessage(spectator);
    spectator.send(JSON.stringify({ type: "hello", displayName: "Legacy display name" }));
    const legacyWelcome = await legacyHello;
    assert.equal(legacyWelcome.type, "snapshot");
    assert.equal((legacyWelcome.game as JsonRecord).yourSeat, null, "a display-name-only hello must remain a spectator");
    await unchanged();

    await expectSocketError(spectator, JSON.stringify({
      type: "play", tileId: "0-0", side: "left",
    }), SOCKET_AUTHENTICATION_ERROR);
    await unchanged();

    watchOnlySpectator = await openRoomSocket(api.baseUrl, created.code, true);
    await expectSocketError(watchOnlySpectator, JSON.stringify({
      type: "hello", reconnectToken: created.reconnectToken,
    }), "A watch link cannot use a player reconnect token");
    const watchSnapshotPromise = receiveSocketMessage(watchOnlySpectator);
    watchOnlySpectator.send(JSON.stringify({ type: "hello", displayName: "Watch-only guest" }));
    const watchSnapshot = await watchSnapshotPromise;
    assert.equal(watchSnapshot.type, "snapshot");
    assert.equal(watchSnapshot.viewerRole, "spectator");
    assert.deepEqual((watchSnapshot.game as JsonRecord).hand, []);
    assert.deepEqual((watchSnapshot.view as JsonRecord).myHand, []);
    assert.equal((watchSnapshot.view as JsonRecord).revealedHands, null);
    assert.equal(((watchSnapshot.game as JsonRecord).engine as JsonRecord).revealedHands, null);
    assert.deepEqual((watchSnapshot.waitlist as JsonRecord).entries, []);
    assert.equal(JSON.stringify(watchSnapshot).includes(created.reconnectToken), false);
    await expectSocketError(watchOnlySpectator, JSON.stringify({
      type: "play", tileId: "0-0", side: "left",
    }), "This watch link is read-only");
    await expectSocketError(watchOnlySpectator, JSON.stringify({
      type: "changeSettings", mode: "regular", rowBoxes: 10, turnSeconds: 30, isPrivate: false,
    }), "This watch link is read-only");
    await expectSocketError(watchOnlySpectator, JSON.stringify({ type: "nextHand" }), "This watch link is read-only");
    await unchanged();

    const turnSeat = Number(baseline.turnSeat);
    const playerToken = turnSeat === 0 ? created.reconnectToken : joined.reconnectToken;
    player = await openRoomSocket(api.baseUrl, created.code);
    const playerWelcomePromise = receiveSocketMessage(player);
    player.send(JSON.stringify({ type: "hello", reconnectToken: playerToken }));
    const playerWelcome = await playerWelcomePromise;
    const spectatorAfterPlayerJoins = await receiveSocketMessage(watchOnlySpectator);
    const playerGame = playerWelcome.game as JsonRecord;
    assert.equal(playerGame.yourSeat, turnSeat);
    const hand = playerGame.hand as JsonRecord[];
    assert.ok(hand.length > 0, "a seated player should still receive their own private hand");
    const openEnds = playerGame.openEnds as JsonRecord[];
    const unsupportedSide = ["right", "top", "bottom", "left"].find((side) =>
      !openEnds.some((end) => end.id === side));
    assert.ok(unsupportedSide, "the board should not have every possible end open");

    await expectSocketError(player, JSON.stringify({
      type: "play", tileId: hand[0].id, side: unsupportedSide,
    }), "That tile cannot be played on that end");
    await unchanged();

    const playerView = playerWelcome.view as JsonRecord;
    const legal = playerView.legal as JsonRecord[];
    const action = legal.find((candidate) => candidate.type === "play");
    assert.ok(action, "the opening turn should have a legal play");
    const tile = action.tile as number[];
    const side = ({ W: "left", E: "right", N: "top", S: "bottom", center: "left" } as Record<string, string>)[String(action.arm)];
    const watchUpdatePromise = receiveSocketMessage(watchOnlySpectator);
    player.send(JSON.stringify({ type: "play", tileId: `${tile[0]}-${tile[1]}`, side }));
    const watchUpdate = await watchUpdatePromise;
    assert.equal(watchUpdate.type, "snapshot");
    assert.equal(watchUpdate.viewerRole, "spectator");
    const spectatorBoard = ((watchUpdate.view as JsonRecord).board as JsonRecord).history as unknown[];
    const initialBoard = ((spectatorAfterPlayerJoins.view as JsonRecord).board as JsonRecord).history as unknown[];
    assert.equal(spectatorBoard.length, initialBoard.length + 1, "watchers should receive the public board update");
    assert.deepEqual((watchUpdate.game as JsonRecord).hand, []);
    assert.deepEqual((watchUpdate.view as JsonRecord).myHand, []);
    const afterMove = await getGame(api.baseUrl, created.code);
    assert.ok(
      ((afterMove.board as unknown[]) ?? []).length > ((baseline.board as unknown[]) ?? []).length,
      "the seated player's legal move should be persisted",
    );
    await expectSocketError(watchOnlySpectator, JSON.stringify({ type: "chat", text: "hello" }), "This watch link is read-only");
  } finally {
    spectator?.terminate();
    watchOnlySpectator?.terminate();
    player?.terminate();
    if (api) await stopRoomsProcess(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("a connected watch-only socket receives Points hand results and the automatic next hand", {
  timeout: 90_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room WebSocket integration tests.");

  const schema = `rooms_spectator_hands_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startRoomsProcess>> | undefined;
  let spectator: WebSocket | undefined;
  let player: WebSocket | undefined;
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await createRoomsTable(schema);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    const { match, action, finishedMatch } = pointsHandEndingMove(29);
    const activeSeat = match.hand.turn;
    const code = `S${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const reconnectToken = randomUUID();
    const room = makeRoom(code, match, false);
    room.mode = "points";
    room.playerCount = 4;
    room.status = "playing";
    room.seats.forEach((seat, index) => {
      seat.name = index === activeSeat ? "Final-move player" : `Transition bot ${index + 1}`;
      seat.status = index === activeSeat ? "waiting" : "bot";
      seat.reconnectTokenHash = index === activeSeat ? hashReconnectToken(reconnectToken) : null;
      seat.userId = null;
      if (index === activeSeat) {
        delete seat.botLevel;
      } else {
        seat.botLevel = "easy";
      }
    });
    await insertRoom(schema, room);
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());

    spectator = await openRoomSocket(api.baseUrl, code, true);
    const spectatorWelcomePromise = receiveSocketMessage(spectator);
    spectator.send(JSON.stringify({ type: "hello", displayName: "Hand transition watcher" }));
    const spectatorWelcome = await spectatorWelcomePromise;
    const assertNoPrivateTiles = (snapshot: JsonRecord) => {
      assert.equal(snapshot.type, "snapshot");
      assert.equal(snapshot.viewerRole, "spectator");
      assert.deepEqual((snapshot.game as JsonRecord).hand, []);
      assert.deepEqual((snapshot.view as JsonRecord).myHand, []);
      assert.deepEqual((snapshot.view as JsonRecord).legal, []);
      assert.equal((snapshot.view as JsonRecord).revealedHands, null);
      const gameEngine = (snapshot.game as JsonRecord).engine as JsonRecord;
      assert.deepEqual(gameEngine.myHand, []);
      assert.deepEqual(gameEngine.legal, []);
      assert.equal(gameEngine.revealedHands, null);
    };
    assertNoPrivateTiles(spectatorWelcome);
    assert.equal(((spectatorWelcome.game as JsonRecord).handPoints as number[]).length, 4);

    player = await openRoomSocket(api.baseUrl, code);
    const playerWelcomePromise = receiveSocketMessage(player);
    const spectatorPlayerJoinPromise = receiveSocketMessage(spectator);
    player.send(JSON.stringify({ type: "hello", reconnectToken }));
    const [playerWelcome, spectatorPlayerJoin] = await Promise.all([
      playerWelcomePromise,
      spectatorPlayerJoinPromise,
    ]);
    assert.equal((playerWelcome.game as JsonRecord).yourSeat, activeSeat);
    assertNoPrivateTiles(spectatorPlayerJoin);

    const handEndPromise = receiveSocketMessage(spectator);
    const finalAction = action.type === "play"
      ? {
          type: "play",
          tileId: `${action.tile[0]}-${action.tile[1]}`,
          side: action.arm === "center"
            ? "left"
            : ({ W: "left", E: "right", N: "top", S: "bottom" } as Record<string, string>)[action.arm],
        }
      : { type: action.type };
    player.send(JSON.stringify(finalAction));
    const handEnd = await handEndPromise;
    assertNoPrivateTiles(handEnd);
    const endGame = handEnd.game as JsonRecord;
    assert.equal(endGame.handNumber, 1);
    assert.deepEqual(endGame.handPoints, finishedMatch.scores, "the end-of-hand snapshot should include updated scores");
    assert.ok(
      (handEnd.events as JsonRecord[]).some((event) => event.type === "handOver"),
      "the watcher should receive the hand result event",
    );
    assert.notDeepEqual(finishedMatch.scores, match.scores, "the fixture's final move should change the score");

    const nextHand = await receiveSocketMessage(spectator, 25_000);
    assertNoPrivateTiles(nextHand);
    const nextGame = nextHand.game as JsonRecord;
    assert.equal(nextGame.handNumber, 2, "the same watcher should receive the automatic next-hand snapshot");
    assert.deepEqual(nextGame.board, [], "the next hand should arrive with a cleared public board");
    assert.deepEqual(nextGame.handPoints, finishedMatch.scores);
    assert.ok(
      (nextHand.events as JsonRecord[]).some((event) => event.type === "handStart"),
      "the next-hand snapshot should identify the hand start",
    );
    assert.equal(spectator.readyState, WebSocket.OPEN, "the watcher should not need to reconnect");
  } finally {
    spectator?.terminate();
    player?.terminate();
    if (api) await stopRoomsProcess(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("waiting room setting changes reach every connected player and rejected changes are not saved", {
  timeout: 90_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room WebSocket integration tests.");

  const schema = `rooms_settings_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startRoomsProcess>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await createRoomsTable(schema);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());

    const createResponse = await fetch(`${api.baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Settings host",
        mode: "regular",
        playerCount: 4,
        rowLength: 10,
        rowBoxes: 10,
        twoPlayerVariant: "draw",
        isPrivate: true,
      }),
    });
    if (createResponse.status !== 201) assert.fail(`room create failed: ${await createResponse.text()}`);
    const created = await createResponse.json() as { code: string; reconnectToken: string };
    const joinResponse = await fetch(`${api.baseUrl}/api/rooms/${created.code}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Settings guest" }),
    });
    if (joinResponse.status !== 200) assert.fail(`room join failed: ${await joinResponse.text()}`);
    const joined = await joinResponse.json() as { reconnectToken: string };

    const connectPlayer = async (reconnectToken: string) => {
      const socket = await openRoomSocket(api!.baseUrl, created.code);
      sockets.push(socket);
      const welcomePromise = receiveSocketMessage(socket);
      socket.send(JSON.stringify({ type: "hello", reconnectToken }));
      assert.equal((await welcomePromise).type, "snapshot");
      return socket;
    };
    const host = await connectPlayer(created.reconnectToken);
    const guest = await connectPlayer(joined.reconnectToken);
    const spectator = await openRoomSocket(api.baseUrl, created.code);
    sockets.push(spectator);
    const spectatorWelcome = receiveSocketMessage(spectator);
    spectator.send(JSON.stringify({ type: "hello", displayName: "Settings spectator" }));
    assert.equal((await spectatorWelcome).type, "snapshot");
    const updatedSettings = {
      mode: "points",
      rowBoxes: 14,
      turnSeconds: 45,
      isPrivate: false,
      playerCount: 4,
    };
    const hostUpdate = receiveRoomSettings(host, updatedSettings);
    const guestUpdate = receiveRoomSettings(guest, updatedSettings);
    const spectatorUpdate = receiveRoomSettings(spectator, updatedSettings);
    host.send(JSON.stringify({ type: "changeSettings", ...updatedSettings }));
    const [hostSnapshot, guestSnapshot, spectatorSnapshot] = await Promise.all([
      hostUpdate,
      guestUpdate,
      spectatorUpdate,
    ]);
    assert.deepEqual(hostSnapshot.roomSettings, updatedSettings);
    assert.deepEqual(guestSnapshot.roomSettings, updatedSettings);
    assert.deepEqual(spectatorSnapshot.roomSettings, updatedSettings);

    const readPersistedSettings = async () => {
      const result = await pool.query(
        `SELECT mode, row_boxes, turn_seconds, is_private, player_count
         FROM ${quotedSchema}.domino_rooms WHERE code = $1`,
        [created.code],
      );
      assert.equal(result.rowCount, 1, "the room should remain persisted");
      return result.rows[0];
    };
    const persistedSettingsBeforeRejections = await readPersistedSettings();
    assert.ok(persistedSettingsBeforeRejections, "the updated room should remain persisted");
    assert.deepEqual(persistedSettingsBeforeRejections, {
      mode: updatedSettings.mode,
      row_boxes: updatedSettings.rowBoxes,
      turn_seconds: updatedSettings.turnSeconds,
      is_private: updatedSettings.isPrivate,
      player_count: updatedSettings.playerCount,
    }, "the accepted settings should be saved before the server restarts");

    await expectSocketError(
      guest,
      JSON.stringify({ type: "changeSettings", ...updatedSettings, rowBoxes: 18 }),
      "Only the host can change settings while waiting",
    );
    assert.deepEqual(
      await readPersistedSettings(),
      persistedSettingsBeforeRejections,
      "an unauthorized change must not be saved",
    );

    await expectSocketError(
      host,
      JSON.stringify({ type: "changeSettings", ...updatedSettings, rowBoxes: 21 }),
      "Choose a row length from 5 to 20 and a 15, 30, 45, or 60 second timer",
    );
    assert.deepEqual(
      await readPersistedSettings(),
      persistedSettingsBeforeRejections,
      "an invalid change must not be saved",
    );

    sockets.forEach((socket) => socket.terminate());
    sockets.length = 0;
    await stopRoomsProcess(api.child);
    api = undefined;
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());

    const reconnectAndReadSettings = async (reconnectToken: string) => {
      const socket = await openRoomSocket(api!.baseUrl, created.code);
      sockets.push(socket);
      const welcomePromise = receiveSocketMessage(socket);
      socket.send(JSON.stringify({ type: "hello", reconnectToken }));
      const welcome = await welcomePromise;
      assert.equal(welcome.type, "snapshot");
      return { socket, welcome };
    };
    const [restoredHost, restoredGuest] = await Promise.all([
      reconnectAndReadSettings(created.reconnectToken),
      reconnectAndReadSettings(joined.reconnectToken),
    ]);
    assert.deepEqual(
      restoredHost.welcome.roomSettings,
      updatedSettings,
      "the host should receive the saved settings after restart",
    );
    assert.deepEqual(
      restoredGuest.welcome.roomSettings,
      updatedSettings,
      "the guest should receive the saved settings after restart",
    );
  } finally {
    sockets.forEach((socket) => socket.terminate());
    if (api) await stopRoomsProcess(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("live room chat reaches members in order, rejects invalid text, stays room-local, and leaves game snapshots unchanged", {
  timeout: 90_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room WebSocket integration tests.");

  const schema = `rooms_chat_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startRoomsProcess>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await createRoomsTable(schema);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());

    const createStartedRoom = async (hostName: string, guestName: string) => {
      const createResponse = await fetch(`${api!.baseUrl}/api/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: hostName,
          mode: "regular",
          playerCount: 2,
          rowLength: 10,
          rowBoxes: 10,
          twoPlayerVariant: "draw",
          isPrivate: true,
        }),
      });
      if (createResponse.status !== 201) assert.fail(`room create failed: ${await createResponse.text()}`);
      const created = await createResponse.json() as { code: string; reconnectToken: string };
      const joinResponse = await fetch(`${api!.baseUrl}/api/rooms/${created.code}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: guestName }),
      });
      if (joinResponse.status !== 200) assert.fail(`room join failed: ${await joinResponse.text()}`);
      const joined = await joinResponse.json() as { reconnectToken: string };
      const startResponse = await fetch(`${api!.baseUrl}/api/rooms/${created.code}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reconnectToken: created.reconnectToken }),
      });
      if (startResponse.status !== 200) assert.fail(`room start failed: ${await startResponse.text()}`);
      return { code: created.code, hostToken: created.reconnectToken, guestToken: joined.reconnectToken };
    };
    const primaryRoom = await createStartedRoom("Chat host", "Chat guest");
    const otherRoom = await createStartedRoom("Other host", "Other guest");

    const connectMember = async (code: string, reconnectToken: string) => {
      const socket = await openRoomSocket(api!.baseUrl, code);
      sockets.push(socket);
      const welcomePromise = receiveSocketMessage(socket);
      socket.send(JSON.stringify({ type: "hello", reconnectToken }));
      const welcome = await welcomePromise;
      assert.equal(welcome.type, "snapshot");
      return socket;
    };
    const host = await connectMember(primaryRoom.code, primaryRoom.hostToken);
    const guest = await connectMember(primaryRoom.code, primaryRoom.guestToken);
    const unrelatedHost = await connectMember(otherRoom.code, otherRoom.hostToken);
    const baselinePrimary = await getGame(api.baseUrl, primaryRoom.code);
    const baselineOther = await getGame(api.baseUrl, otherRoom.code);

    await expectSocketError(host, JSON.stringify({ type: "chat", text: "  \t " }), SOCKET_PROTOCOL_ERROR);
    await expectSocketError(host, JSON.stringify({ type: "chat", text: "x".repeat(161) }), SOCKET_PROTOCOL_ERROR);

    const nextChat = (socket: WebSocket) => new Promise<JsonRecord>((resolveChat, rejectChat) => {
      const onMessage = (raw: unknown) => {
        let value: JsonRecord;
        try {
          value = JSON.parse(String(raw)) as JsonRecord;
        } catch (error) {
          cleanup();
          rejectChat(error);
          return;
        }
        if (value.type === "chat") {
          cleanup();
          resolveChat(value);
        }
      };
      const onError = (error: Error) => {
        cleanup();
        rejectChat(error);
      };
      const timeout = setTimeout(() => {
        cleanup();
        rejectChat(new Error("Timed out waiting for a room chat message."));
      }, 5_000);
      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        socket.off("error", onError);
      };
      socket.on("message", onMessage);
      socket.once("error", onError);
    });
    let unrelatedChatReceived = false;
    const onUnrelatedMessage = (raw: unknown) => {
      try {
        if ((JSON.parse(String(raw)) as JsonRecord).type === "chat") unrelatedChatReceived = true;
      } catch {
        // The unrelated room's normal messages are not relevant to chat isolation.
      }
    };
    unrelatedHost.on("message", onUnrelatedMessage);

    const expectChatToBothMembers = async (text: string) => {
      const hostMessage = nextChat(host);
      const guestMessage = nextChat(guest);
      host.send(JSON.stringify({ type: "chat", text }));
      const [fromHost, fromGuest] = await Promise.all([hostMessage, guestMessage]);
      assert.equal((fromHost.message as JsonRecord).text, text.trim());
      assert.equal((fromGuest.message as JsonRecord).text, text.trim());
      assert.equal((fromHost.message as JsonRecord).name, "Chat host");
      assert.equal((fromGuest.message as JsonRecord).name, "Chat host");
    };
    await expectChatToBothMembers("  First message  ");
    await expectSocketError(
      host,
      JSON.stringify({ type: "chat", text: "This is too soon" }),
      "Please wait a moment before sending another message.",
    );
    assert.deepEqual(
      await getGame(api.baseUrl, primaryRoom.code),
      baselinePrimary,
      "a cooldown rejection must not change the primary game snapshot",
    );
    await delay(1_050);
    await expectChatToBothMembers("Second message");
    assert.deepEqual(
      await getGame(api.baseUrl, primaryRoom.code),
      baselinePrimary,
      "a later accepted chat message must not change the primary game snapshot",
    );
    const reconnectingHost = await openRoomSocket(api.baseUrl, primaryRoom.code);
    sockets.push(reconnectingHost);
    const reconnectedSnapshot = receiveSocketMessage(reconnectingHost);
    reconnectingHost.send(JSON.stringify({ type: "hello", reconnectToken: primaryRoom.hostToken }));
    assert.equal((await reconnectedSnapshot).type, "snapshot");
    let history = await receiveSocketMessage(reconnectingHost);
    while (history.type !== "chatHistory") history = await receiveSocketMessage(reconnectingHost);
    assert.equal(history.type, "chatHistory");
    assert.equal(history.viewerSeat, 0);
    assert.deepEqual(
      (history.messages as JsonRecord[]).map((message) => message.text),
      ["First message", "Second message"],
    );
    await delay(250);
    unrelatedHost.off("message", onUnrelatedMessage);
    assert.equal(unrelatedChatReceived, false, "a different room must not receive the chat message");

    assert.deepEqual(await getGame(api.baseUrl, primaryRoom.code), baselinePrimary, "chat must not change the primary game's snapshot");
    assert.deepEqual(await getGame(api.baseUrl, otherRoom.code), baselineOther, "chat must not change another game's snapshot");
  } finally {
    sockets.forEach((socket) => socket.terminate());
    if (api) await stopRoomsProcess(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("restored rooms reconnect only preserved seat tokens and never claim tokenless legacy seats", {
  timeout: 90_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room reconnect integration tests.");

  const schema = `rooms_reconnect_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startRoomsProcess>> | undefined;
  let reconnectingPlayer: WebSocket | undefined;
  let legacyNameClient: WebSocket | undefined;
  let blankTokenClient: WebSocket | undefined;
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await createRoomsTable(schema);
    const match = createMatch({
      mode: "regular",
      playerCount: 2,
      rowBoxes: 10,
      twoPlayerVariant: "draw",
      seed: 118,
    }).match;
    const opening = autoStep(match, []);
    assert.ok(opening, "fixture opening should be a legal automatic move");
    const reconnectToken = randomUUID();
    const code = `R${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const room = makeRoom(code, opening.match, false);
    room.hostName = "Preserved token player";
    for (const seat of room.seats) {
      seat.status = seat.seat < 2 ? "waiting" : "open";
      seat.name = seat.seat === 0 ? "Preserved token player" : seat.seat === 1 ? "Legacy player" : null;
      seat.reconnectTokenHash = seat.seat === 0 ? hashReconnectToken(reconnectToken) : null;
      delete seat.botLevel;
    }
    await insertRoom(schema, room, 1);

    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());

    reconnectingPlayer = await openRoomSocket(api.baseUrl, code);
    const welcomePromise = receiveSocketMessage(reconnectingPlayer);
    reconnectingPlayer.send(JSON.stringify({ type: "hello", reconnectToken }));
    const welcome = await welcomePromise;
    const game = welcome.game as JsonRecord;
    assert.equal(welcome.type, "snapshot");
    assert.equal(game.yourSeat, 0);
    const tileView = (tiles: [number, number][]) => tiles.map(([left, right]) => ({
      id: `${left}-${right}`,
      left,
      right,
    }));
    const expectedHand = tileView(opening.match.hand.hands[0]);
    const legacyHand = tileView(opening.match.hand.hands[1]);
    assert.deepEqual(game.hand, expectedHand, "the preserved token should receive its own restored hand");
    assert.notDeepEqual(expectedHand, legacyHand, "the fixture should give each seat a different hand");
    const privateView = welcome.view as JsonRecord;
    assert.deepEqual(privateView.myHand, opening.match.hand.hands[0]);
    assert.equal(Array.isArray(privateView.revealedHands), false, "the socket must not reveal all player hands");

    legacyNameClient = await openRoomSocket(api.baseUrl, code);
    const legacyWelcomePromise = receiveSocketMessage(legacyNameClient);
    legacyNameClient.send(JSON.stringify({ type: "hello", displayName: "Legacy player" }));
    const legacyWelcome = await legacyWelcomePromise;
    const legacyGame = legacyWelcome.game as JsonRecord;
    assert.equal(legacyGame.yourSeat, null, "a matching display name must not claim a tokenless legacy seat");
    assert.deepEqual(legacyGame.hand, [], "spectators must not receive either player's private hand");

    blankTokenClient = await openRoomSocket(api.baseUrl, code);
    const blankTokenWelcomePromise = receiveSocketMessage(blankTokenClient);
    blankTokenClient.send(JSON.stringify({ type: "hello", reconnectToken: "" }));
    const blankTokenWelcome = await blankTokenWelcomePromise;
    const blankTokenGame = blankTokenWelcome.game as JsonRecord;
    assert.equal(blankTokenGame.yourSeat, null, "a blank token must not match a legacy seat with no token hash");
    assert.deepEqual(blankTokenGame.hand, [], "blank-token clients must not receive private hands");
  } finally {
    reconnectingPlayer?.terminate();
    legacyNameClient?.terminate();
    blankTokenClient?.terminate();
    if (api) await stopRoomsProcess(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("two devices can reconnect to one restored seat without disconnecting each other", {
  timeout: 90_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room reconnect integration tests.");

  const schema = `rooms_multi_device_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startRoomsProcess>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await createRoomsTable(schema);
    const opening = autoStep(createMatch({
      mode: "regular",
      playerCount: 2,
      rowBoxes: 10,
      twoPlayerVariant: "draw",
      seed: 118,
    }).match, []);
    assert.ok(opening, "fixture opening should be a legal automatic move");
    const activeSeat = opening.match.hand.turn;
    const opponentSeat = activeSeat === 0 ? 1 : 0;
    const expectedHand = opening.match.hand.hands[activeSeat].map(([left, right]) => ({
      id: `${left}-${right}`,
      left,
      right,
    }));
    const opponentHand = opening.match.hand.hands[opponentSeat].map(([left, right]) => ({
      id: `${left}-${right}`,
      left,
      right,
    }));
    assert.notDeepEqual(expectedHand, opponentHand, "the fixture should give each seat a different hand");

    const cases = [
      { code: `A${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`, closingDevice: 0 },
      { code: `B${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`, closingDevice: 1 },
    ];
    const reconnectTokens = new Map<string, string>();
    for (const { code } of cases) {
      const reconnectToken = randomUUID();
      reconnectTokens.set(code, reconnectToken);
      const room = makeRoom(code, opening.match, false);
      room.seats[activeSeat].reconnectTokenHash = hashReconnectToken(reconnectToken);
      await insertRoom(schema, room);
    }

    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());

    for (const { code, closingDevice } of cases) {
      const reconnectToken = reconnectTokens.get(code)!;
      const connectDevice = async () => {
        const socket = await openRoomSocket(api!.baseUrl, code);
        sockets.push(socket);
        const welcomePromise = receiveSocketMessage(socket);
        socket.send(JSON.stringify({ type: "hello", reconnectToken }));
        return { socket, welcome: await welcomePromise };
      };
      const devices = [await connectDevice(), await connectDevice()];
      const [firstDevice, secondDevice] = devices;
      for (const snapshot of [firstDevice.welcome, secondDevice.welcome]) {
        const game = snapshot.game as JsonRecord;
        const view = snapshot.view as JsonRecord;
        assert.equal(snapshot.type, "snapshot");
        assert.equal(game.yourSeat, activeSeat);
        assert.deepEqual(game.hand, expectedHand, "each device should receive its seat's restored hand");
        assert.deepEqual(view.myHand, opening.match.hand.hands[activeSeat]);
        assert.notDeepEqual(game.hand, opponentHand, "a reconnect must never reveal the opponent's hand");
        assert.equal(view.revealedHands, null, "the snapshot must not reveal every player's hand");
      }

      const closingSocket = devices[closingDevice].socket;
      const survivingDevice = devices[1 - closingDevice];
      const closePromise = once(closingSocket, "close");
      closingSocket.close();
      await closePromise;
      assert.equal(survivingDevice.socket.readyState, WebSocket.OPEN);

      const legal = (survivingDevice.welcome.view as JsonRecord).legal as JsonRecord[];
      const action = legal.find((candidate) => candidate.type === "play") ??
        legal.find((candidate) => candidate.type === "draw") ??
        legal.find((candidate) => candidate.type === "pass");
      assert.ok(action, "the surviving device should have a legal turn action");
      const actionEvent = action.type === "play"
        ? {
            type: "play",
            tileId: (action.tile as number[]).join("-"),
            side: ({ W: "left", E: "right", N: "top", S: "bottom", center: "left" } as Record<string, string>)[String(action.arm)],
          }
        : { type: action.type };
      const initialLastAction = (survivingDevice.welcome.game as JsonRecord).lastAction;
      const moveResult = receiveSocketMessageMatching(
        survivingDevice.socket,
        (message) => message.type === "snapshot" &&
          (message.game as JsonRecord | undefined)?.lastAction !== initialLastAction,
      );
      survivingDevice.socket.send(JSON.stringify(actionEvent));
      const updatedSnapshot = await moveResult;
      assert.equal(updatedSnapshot.type, "snapshot", "the surviving device should receive the move update");
      assert.equal((updatedSnapshot.game as JsonRecord).yourSeat, activeSeat);
      assert.notEqual(
        (updatedSnapshot.game as JsonRecord).lastAction,
        initialLastAction,
        "the surviving device's legal action should update the restored room",
      );
      assert.equal(survivingDevice.socket.readyState, WebSocket.OPEN);
    }
  } finally {
    sockets.forEach((socket) => socket.terminate());
    if (api) await stopRoomsProcess(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("a restored room rejects another room's reconnect token without revealing hands or changing either room", {
  timeout: 90_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room reconnect integration tests.");

  const schema = `rooms_cross_reconnect_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startRoomsProcess>> | undefined;
  let roomBSocket: WebSocket | undefined;
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await createRoomsTable(schema);
    const firstMatch = createMatch({
      mode: "regular",
      playerCount: 2,
      rowBoxes: 10,
      twoPlayerVariant: "draw",
      seed: 219,
    }).match;
    const secondMatch = createMatch({
      mode: "regular",
      playerCount: 2,
      rowBoxes: 10,
      twoPlayerVariant: "draw",
      seed: 220,
    }).match;
    const firstOpening = autoStep(firstMatch, []);
    const secondOpening = autoStep(secondMatch, []);
    assert.ok(firstOpening, "the first room fixture should have a legal opening move");
    assert.ok(secondOpening, "the second room fixture should have a legal opening move");
    assert.notDeepEqual(
      firstOpening.match.hand.hands[0],
      secondOpening.match.hand.hands[0],
      "the rooms should contain different private hands",
    );

    const roomACode = `A${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const roomBCode = `B${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const roomATokens = [randomUUID(), randomUUID()];
    const roomBTokens = [randomUUID(), randomUUID()];
    const configureRoom = (
      code: string,
      match: ReturnType<typeof createMatch>["match"],
      tokens: string[],
      hostName: string,
    ) => {
      const room = makeRoom(code, match, false);
      room.hostName = hostName;
      for (const seat of room.seats) {
        if (seat.seat < 2) {
          seat.status = "waiting";
          seat.name = `${hostName} ${seat.seat + 1}`;
          seat.reconnectTokenHash = hashReconnectToken(tokens[seat.seat]);
          delete seat.botLevel;
        }
      }
      return room;
    };
    const roomA = configureRoom(roomACode, firstOpening.match, roomATokens, "Room A");
    const roomB = configureRoom(roomBCode, secondOpening.match, roomBTokens, "Room B");
    assert.notEqual(
      roomA.seats[0].reconnectTokenHash,
      roomB.seats[0].reconnectTokenHash,
      "each room should store a different seat token hash",
    );
    await insertRoom(schema, roomA);
    await insertRoom(schema, roomB);

    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());
    const roomABaseline = await getGame(api.baseUrl, roomACode);
    const roomBBaseline = await getGame(api.baseUrl, roomBCode);
    assert.equal(matchesMatch(roomABaseline, firstOpening.match), true, "room A should restore its saved match");
    assert.equal(matchesMatch(roomBBaseline, secondOpening.match), true, "room B should restore its saved match");

    roomBSocket = await openRoomSocket(api.baseUrl, roomBCode);
    const receivedMessages: JsonRecord[] = [];
    const captureMessage = (raw: unknown) => {
      receivedMessages.push(JSON.parse(String(raw)) as JsonRecord);
    };
    roomBSocket.on("message", captureMessage);
    const invalidTokenError = "That reconnect token is not valid for this room";
    await expectSocketError(
      roomBSocket,
      JSON.stringify({ type: "hello", reconnectToken: roomATokens[0] }),
      invalidTokenError,
    );
    await delay(50);
    roomBSocket.off("message", captureMessage);
    assert.deepEqual(
      receivedMessages,
      [{ type: "error", message: invalidTokenError }],
      "a foreign token must not receive a snapshot or any private hand",
    );

    assert.deepEqual(await getGame(api.baseUrl, roomACode), roomABaseline, "room A's snapshot must remain unchanged");
    assert.deepEqual(await getGame(api.baseUrl, roomBCode), roomBBaseline, "room B's snapshot must remain unchanged");
  } finally {
    roomBSocket?.terminate();
    if (api) await stopRoomsProcess(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("a restored completed hand automatically starts the next hand", {
  timeout: 45_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room next-hand restart tests.");

  const schema = `rooms_next_hand_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startRoomsProcess>> | undefined;
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await createRoomsTable(schema);
    const match = createMatch({
      mode: "regular",
      playerCount: 2,
      rowBoxes: 10,
      twoPlayerVariant: "draw",
      seed: 274,
    }).match;
    match.handsPlayed = match.hand.number;
    match.hand.hands[0] = [];
    match.hand.over = true;
    match.hand.winner = 0;
    match.hand.ranking = [0, 1];

    const code = `N${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const room = makeRoom(code, match, false);
    room.status = "finished";
    room.seats.forEach((seat, index) => {
      seat.status = index < 2 ? "waiting" : "open";
      seat.name = index === 0 ? "Next-hand host" : index === 1 ? "Next-hand guest" : null;
      seat.reconnectTokenHash = null;
      delete seat.botLevel;
    });
    await insertRoom(schema, room);

    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    api = await startRoomsProcess(isolatedDatabaseUrl.toString());

    const deadline = Date.now() + 30_000;
    let savedHandNumber = 1;
    while (Date.now() < deadline) {
      const savedRoom = await pool.query(
        `SELECT status, engine_state FROM ${quotedSchema}.domino_rooms WHERE code = $1`,
        [code],
      );
      assert.equal(savedRoom.rowCount, 1, "the restored room should remain present during the hand transition");
      const engineState = savedRoom.rows[0].engine_state as JsonRecord;
      const hand = engineState.hand as JsonRecord;
      savedHandNumber = Number(hand.number);
      if (savedHandNumber > 1) {
        assert.equal(savedRoom.rows[0].status, "playing");
        assert.equal(hand.over, false);
        assert.equal((hand.hands as unknown[]).length, 2);
        break;
      }
      await delay(200);
    }
    assert.equal(savedHandNumber, 2, "the pending hand should start automatically after restart without a player request");
  } finally {
    if (api) await stopRoomsProcess(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("legacy Domino room rows restore with safe defaults after schema additions", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for legacy room persistence tests.");

  const schema = `rooms_legacy_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  const code = `L${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;

  try {
    await pool.query(`CREATE SCHEMA ${quotedSchema}`);
    await createRoomsTable(schema);

    const match = createMatch({
      mode: "regular",
      playerCount: 2,
      rowBoxes: 10,
      twoPlayerVariant: "draw",
      seed: 619,
    }).match;
    const seats = [
      { seat: 0, status: "waiting", name: "Legacy host", reconnectTokenHash: null },
      { seat: 1, status: "waiting", name: "Legacy guest", reconnectTokenHash: null },
      { seat: 2, status: "open", name: null, reconnectTokenHash: null },
      { seat: 3, status: "open", name: null, reconnectTokenHash: null },
    ];

    // Deliberately omit speed, play_now, afk_state, lifecycle_applied, and crowns_eligible.
    await pool.query(
      `INSERT INTO ${quotedSchema}.domino_rooms (
        code, host_name, mode, row_length, player_count, row_boxes,
        two_player_variant, turn_seconds, is_private, seed, status, seats,
        last_action, engine_state, waitlist, offers
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12::jsonb, $13, $14::jsonb, $15::jsonb, $16::jsonb
      )`,
      [
        code, "Legacy host", "regular", 10, 2, 10, "draw", 30, false, 619,
        "playing", JSON.stringify(seats), "legacy room", JSON.stringify(match),
        "[]", "[]",
      ],
    );

    const { rows } = await pool.query(
      `SELECT
        code, host_name AS "hostName", mode, row_length AS "rowLength",
        player_count AS "playerCount", row_boxes AS "rowBoxes",
        two_player_variant AS "twoPlayerVariant", turn_seconds AS "turnSeconds",
        is_private AS "isPrivate", speed, play_now AS "playNow",
        afk_state AS "afkState", seed, status, seats,
        last_action AS "lastAction", engine_state AS "engineState",
        waitlist, offers, lifecycle_applied AS "lifecycleApplied",
        crowns_eligible AS "crownsEligible"
      FROM ${quotedSchema}.domino_rooms
      WHERE code = $1`,
      [code],
    );
    assert.equal(rows.length, 1);

    const result = restoreRooms(rows);
    assert.deepEqual(result.errors, [], "a legacy row must not be quarantined");
    assert.equal(result.rooms.length, 1);
    const restored = result.rooms[0]!;
    assert.equal(restored.speed, 1);
    assert.equal(restored.playNow, false);
    assert.equal(restored.afkState, undefined);
    assert.equal(restored.lifecycleApplied, false);
    assert.equal(restored.crownsEligible, undefined);
    assert.equal(restored.engineState?.hand.turn, match.hand.turn, "the saved player turn must be preserved");
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});
