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
import { autoStep, createMatch } from "lakou-engine";
import { serializeRoom } from "../lib/room-persistence-codec.ts";
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
      quarantined_at timestamptz,
      quarantine_issues jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function receiveSocketMessage(socket: WebSocket): Promise<JsonRecord> {
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
    }, 5_000);
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

async function openRoomSocket(baseUrl: string, code: string): Promise<WebSocket> {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws?code=${encodeURIComponent(code)}`);
  await once(socket, "open");
  return socket;
}

async function expectSocketError(socket: WebSocket, payload: string, expected: string): Promise<void> {
  const message = receiveSocketMessage(socket);
  socket.send(payload);
  assert.deepEqual(await message, { type: "error", message: expected });
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

    assert.equal(
      await waitForBotAdvance(api.baseUrl, botCode, afterOpening, 12_000),
      true,
      "the active bot must make a move or otherwise advance the restored hand",
    );

    const humanInitial = await getGame(api.baseUrl, humanCode);
    assert.equal(humanInitial.turnSeat, activeSeat, "the fixture should restore on the human seat");
    assert.equal(matchesMatch(humanInitial, afterOpening), true, "the human fixture should start at its persisted state");
    await delay(3_500);
    const humanAfterWait = await getGame(api.baseUrl, humanCode);
    assert.equal(
      matchesMatch(humanAfterWait, afterOpening),
      true,
      "a restored human turn must wait for the player instead of playing automatically",
    );
  } finally {
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

    const turnSeat = Number(baseline.turnSeat);
    const playerToken = turnSeat === 0 ? created.reconnectToken : joined.reconnectToken;
    player = await openRoomSocket(api.baseUrl, created.code);
    const playerWelcomePromise = receiveSocketMessage(player);
    player.send(JSON.stringify({ type: "hello", reconnectToken: playerToken }));
    const playerWelcome = await playerWelcomePromise;
    const playerGame = playerWelcome.game as JsonRecord;
    assert.equal(playerGame.yourSeat, turnSeat);
    const hand = playerGame.hand as JsonRecord[];
    const openEnds = playerGame.openEnds as JsonRecord[];
    assert.ok(hand.length > 0, "the active player should have a tile to try");
    const unsupportedSide = ["right", "top", "bottom", "left"].find((side) =>
      !openEnds.some((end) => end.id === side));
    assert.ok(unsupportedSide, "the board should not have every possible end open");

    await expectSocketError(player, JSON.stringify({
      type: "play", tileId: hand[0].id, side: unsupportedSide,
    }), "That tile cannot be played on that end");
    await unchanged();
  } finally {
    spectator?.terminate();
    player?.terminate();
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
    await delay(1_050);
    await expectChatToBothMembers("Second message");
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
