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

async function startArcadeProcess(databaseUrl: string): Promise<{
  child: ChildProcess;
  baseUrl: string;
  getOutput: () => string;
}> {
  const port = await reservePort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/routes/arcade-test-process.ts"],
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
      throw new Error(`Arcade API process exited during startup:\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return { child, baseUrl, getOutput: () => output };
    } catch {
      // The process is still starting; try again.
    }
    await delay(100);
  }

  child.kill("SIGKILL");
  throw new Error(`Arcade API process did not become ready:\n${output}`);
}

async function stopArcadeProcess(child: ChildProcess): Promise<void> {
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

async function postRoom(
  baseUrl: string,
  path: string,
  body: JsonRecord,
): Promise<JsonRecord> {
  const response = await fetch(`${baseUrl}/api/arcade/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== 200 && response.status !== 201) {
    assert.fail(`Room request failed with ${response.status}: ${await response.text()}`);
  }
  return await response.json() as JsonRecord;
}

function parseSocketMessage(raw: WebSocket.RawData): JsonRecord {
  return JSON.parse(raw.toString()) as JsonRecord;
}

async function connectArcadeSocket(
  baseUrl: string,
  code: string,
  token: string,
): Promise<{ socket: WebSocket; firstMessage: JsonRecord }> {
  const socketUrl = new URL(baseUrl);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  socketUrl.pathname = "/ws";
  socketUrl.searchParams.set("arcadeCode", code);
  socketUrl.searchParams.set("token", token);
  const socket = new WebSocket(socketUrl);
  const firstMessage = new Promise<JsonRecord>((resolveMessage, rejectMessage) => {
    const timer = setTimeout(() => rejectMessage(new Error("Timed out waiting for arcade socket state.")), 5_000);
    socket.once("message", (raw) => {
      clearTimeout(timer);
      resolveMessage(parseSocketMessage(raw));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      rejectMessage(error);
    });
  });
  return { socket, firstMessage: await firstMessage };
}

function nextSocketMessage(socket: WebSocket): Promise<JsonRecord> {
  return new Promise((resolveMessage, rejectMessage) => {
    const timer = setTimeout(() => rejectMessage(new Error("Timed out waiting for arcade state update.")), 5_000);
    socket.once("message", (raw) => {
      clearTimeout(timer);
      resolveMessage(parseSocketMessage(raw));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      rejectMessage(error);
    });
  });
}

test("arcade private, matchmaking, and Block Drop rooms survive an API process restart", {
  timeout: 60_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade restart integration tests.");

  const schema = `arcade_restart_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  const codes: string[] = [];
  let processOne: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  let processTwo: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  let blockDropSocket: WebSocket | undefined;
  let reconnectSockets: WebSocket[] = [];

  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await pool.query(`
      CREATE TABLE ${quotedSchema}.arcade_rooms (
        code text PRIMARY KEY,
        game text NOT NULL,
        capacity integer NOT NULL,
        is_private boolean NOT NULL,
        players jsonb NOT NULL,
        state jsonb,
        turn integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    processOne = await startArcadeProcess(isolatedDatabaseUrl.toString());

    const privateRoom = await postRoom(processOne.baseUrl, "rooms", {
      game: "mopyon",
      displayName: "Private player",
      playerCount: 2,
      isPrivate: true,
    });
    const matchmakingRoom = await postRoom(processOne.baseUrl, "quick-match", {
      game: "scrabble",
      displayName: "Waiting player",
      playerCount: 3,
    });
    const blockDropRoom = await postRoom(processOne.baseUrl, "rooms", {
      game: "block-drop",
      displayName: "Block Drop player",
      playerCount: 2,
      isPrivate: true,
    });
    await postRoom(processOne.baseUrl, `rooms/${String(blockDropRoom.code)}/join`, {
      displayName: "Block Drop opponent",
    });
    for (const room of [privateRoom, matchmakingRoom, blockDropRoom]) {
      codes.push(String(room.code));
    }
    assert.equal(matchmakingRoom.seat, 0);

    const blockState = blockDropRoom.state as unknown[];
    const playerState = blockState[0] as JsonRecord;
    const activePiece = playerState.active as JsonRecord;
    const changedPlayerState = {
      ...playerState,
      active: { ...activePiece, x: Number(activePiece.x) - 1 },
    };
    const connected = await connectArcadeSocket(
      processOne.baseUrl,
      String(blockDropRoom.code),
      String(blockDropRoom.reconnectToken),
    );
    blockDropSocket = connected.socket;
    assert.equal(connected.firstMessage.type, "room");
    blockDropSocket.send(JSON.stringify({ type: "state", state: changedPlayerState, turn: 0 }));
    const acceptedMove = await nextSocketMessage(blockDropSocket);
    assert.equal(acceptedMove.type, "state", JSON.stringify(acceptedMove));
    const movedRoom = acceptedMove.room as JsonRecord;
    const movedPlayer = (movedRoom.state as unknown[])[0] as JsonRecord;
    assert.equal((movedPlayer.active as JsonRecord).x, Number(activePiece.x) - 1);

    const expiredCode = `Y${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const expiredState = {
      board: Array(225).fill(null),
      currentPlayer: "X",
      winner: null,
      isDraw: false,
      winningLine: null,
      lastMove: null,
    };
    await pool.query(
      `INSERT INTO ${quotedSchema}.arcade_rooms
        (code, game, capacity, is_private, players, state, turn, updated_at)
       VALUES ($1, 'mopyon', 2, true, $2::jsonb, $3::jsonb, 0, now() - interval '7 hours')`,
      [
        expiredCode,
        JSON.stringify([{ name: "Expired player", tokenHash: "0".repeat(64) }]),
        JSON.stringify(expiredState),
      ],
    );

    await stopArcadeProcess(processOne.child);
    processOne = undefined;
    processTwo = await startArcadeProcess(isolatedDatabaseUrl.toString());

    for (const code of codes) {
      const response = await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${code}`);
      assert.equal(response.status, 200, `room ${code} should be restored after restart`);
    }

    const privateReconnect = await connectArcadeSocket(
      processTwo.baseUrl,
      String(privateRoom.code),
      String(privateRoom.reconnectToken),
    );
    reconnectSockets.push(privateReconnect.socket);
    assert.equal(privateReconnect.firstMessage.type, "room");
    assert.equal(privateReconnect.firstMessage.seat, 0);

    const waitingReconnect = await connectArcadeSocket(
      processTwo.baseUrl,
      String(matchmakingRoom.code),
      String(matchmakingRoom.reconnectToken),
    );
    reconnectSockets.push(waitingReconnect.socket);
    const waitingSnapshot = waitingReconnect.firstMessage.room as JsonRecord;
    assert.equal(waitingSnapshot.status, "waiting");
    assert.deepEqual(waitingSnapshot.players, [{ name: "Waiting player", seat: 0 }]);

    const restoredBlockDrop = await fetch(
      `${processTwo.baseUrl}/api/arcade/rooms/${String(blockDropRoom.code)}`,
    );
    assert.equal(restoredBlockDrop.status, 200);
    const restoredRoom = await restoredBlockDrop.json() as JsonRecord;
    const restoredPlayer = (restoredRoom.state as unknown[])[0] as JsonRecord;
    assert.equal((restoredPlayer.active as JsonRecord).x, Number(activePiece.x) - 1);

    const expiredResponse = await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${expiredCode}`);
    assert.equal(expiredResponse.status, 404);
    const expiredRows = await pool.query(
      `SELECT code FROM ${quotedSchema}.arcade_rooms WHERE code = $1`,
      [expiredCode],
    );
    assert.equal(expiredRows.rowCount, 0, "expired room should also be deleted from storage");
  } finally {
    blockDropSocket?.close();
    reconnectSockets.forEach((socket) => socket.close());
    if (processTwo) await stopArcadeProcess(processTwo.child);
    if (processOne) await stopArcadeProcess(processOne.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("arcade seats, concurrent joins, and room updates stay consistent across API instances", {
  timeout: 60_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade multi-instance integration tests.");

  const schema = `arcade_multi_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let processOne: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  let processTwo: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  const sockets: WebSocket[] = [];

  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await pool.query(`
      CREATE TABLE ${quotedSchema}.arcade_rooms (
        code text PRIMARY KEY,
        game text NOT NULL,
        capacity integer NOT NULL,
        is_private boolean NOT NULL,
        players jsonb NOT NULL,
        state jsonb,
        turn integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    [processOne, processTwo] = await Promise.all([
      startArcadeProcess(isolatedDatabaseUrl.toString()),
      startArcadeProcess(isolatedDatabaseUrl.toString()),
    ]);

    const [matchOne, matchTwo] = await Promise.all([
      postRoom(processOne.baseUrl, "quick-match", {
        game: "mopyon",
        displayName: "Match one",
        playerCount: 2,
      }),
      postRoom(processTwo.baseUrl, "quick-match", {
        game: "mopyon",
        displayName: "Match two",
        playerCount: 2,
      }),
    ]);
    assert.equal(matchOne.code, matchTwo.code, "simultaneous matchmaking should use one waiting room");
    assert.deepEqual([matchOne.seat, matchTwo.seat].sort(), [0, 1]);

    const roomFromOne = await fetch(`${processOne.baseUrl}/api/arcade/rooms/${String(matchOne.code)}`);
    const roomFromTwo = await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${String(matchOne.code)}`);
    assert.equal(roomFromOne.status, 200);
    assert.equal(roomFromTwo.status, 200);
    const firstSnapshot = await roomFromOne.json() as JsonRecord;
    const secondSnapshot = await roomFromTwo.json() as JsonRecord;
    assert.deepEqual(firstSnapshot.players, secondSnapshot.players);
    assert.equal((firstSnapshot.players as unknown[]).length, 2);

    const seatZero = matchOne.seat === 0
      ? { baseUrl: processOne.baseUrl, room: matchOne }
      : { baseUrl: processTwo.baseUrl, room: matchTwo };
    const seatOne = matchOne.seat === 1
      ? { baseUrl: processOne.baseUrl, room: matchOne }
      : { baseUrl: processTwo.baseUrl, room: matchTwo };
    const [firstConnection, secondConnection] = await Promise.all([
      connectArcadeSocket(seatZero.baseUrl, String(seatZero.room.code), String(seatZero.room.reconnectToken)),
      connectArcadeSocket(seatOne.baseUrl, String(seatOne.room.code), String(seatOne.room.reconnectToken)),
    ]);
    sockets.push(firstConnection.socket, secondConnection.socket);
    assert.equal(firstConnection.firstMessage.type, "room");
    assert.equal(secondConnection.firstMessage.type, "room");

    const firstMove = Promise.resolve().then(() => {
      const initialState = seatZero.room.state as JsonRecord;
      const board = [...initialState.board as unknown[]];
      board[0] = "X";
      firstConnection.socket.send(JSON.stringify({
        type: "state",
        state: { ...initialState, board, currentPlayer: "O", lastMove: 0 },
        turn: 1,
      }));
    });
    const crossInstanceUpdate = nextSocketMessage(secondConnection.socket);
    await firstMove;
    const stateMessage = await crossInstanceUpdate;
    assert.equal(stateMessage.type, "state", JSON.stringify(stateMessage));
    assert.equal((stateMessage.room as JsonRecord).turn, 1);

    const observerOnTwo = await connectArcadeSocket(
      processTwo.baseUrl,
      String(matchOne.code),
      String(seatZero.room.reconnectToken),
    );
    sockets.push(observerOnTwo.socket);
    const interrupted = await fetch(`${processTwo.baseUrl}/__test/interrupt-notification-listener`, {
      method: "POST",
    });
    assert.equal(interrupted.status, 200, "instance two should interrupt its notification listener");

    const writerOnOne = await connectArcadeSocket(
      processOne.baseUrl,
      String(matchOne.code),
      String(seatOne.room.reconnectToken),
    );
    sockets.push(writerOnOne.socket);
    const afterFirstMove = stateMessage.room as JsonRecord;
    const afterFirstState = afterFirstMove.state as JsonRecord;
    const nextBoard = [...afterFirstState.board as unknown[]];
    nextBoard[4] = "O";
    const recoveredSnapshot = nextSocketMessage(observerOnTwo.socket);
    const writerAcknowledgement = nextSocketMessage(writerOnOne.socket);
    writerOnOne.socket.send(JSON.stringify({
      type: "state",
      state: { ...afterFirstState, board: nextBoard, currentPlayer: "X", lastMove: 4 },
      turn: 0,
    }));
    const committedMove = await writerAcknowledgement;
    assert.equal(committedMove.type, "state");
    const resumed = await fetch(`${processTwo.baseUrl}/__test/resume-notification-listener`, {
      method: "POST",
    });
    assert.equal(resumed.status, 200);
    const recovered = await recoveredSnapshot;
    assert.equal(recovered.type, "room", JSON.stringify(recovered));
    const recoveredRoom = recovered.room as JsonRecord;
    assert.equal(recoveredRoom.turn, 0);
    assert.equal((recoveredRoom.state as JsonRecord).board instanceof Array, true);
    assert.equal(((recoveredRoom.state as JsonRecord).board as unknown[])[4], "O");

    const privateRoom = await postRoom(processOne.baseUrl, "rooms", {
      game: "mopyon",
      displayName: "Private host",
      playerCount: 2,
      isPrivate: true,
    });
    const concurrentJoin = (baseUrl: string, displayName: string) => fetch(
      `${baseUrl}/api/arcade/rooms/${String(privateRoom.code)}/join`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      },
    );
    const joinResults = await Promise.all([
      concurrentJoin(processOne.baseUrl, "Joiner one"),
      concurrentJoin(processTwo.baseUrl, "Joiner two"),
    ]);
    assert.deepEqual(joinResults.map((response) => response.status).sort(), [200, 409]);
  } finally {
    sockets.forEach((socket) => socket.close());
    if (processTwo) await stopArcadeProcess(processTwo.child);
    if (processOne) await stopArcadeProcess(processOne.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("resignation records one winner and survives duplicate requests and reconnects", {
  timeout: 60_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade resignation integration tests.");

  const schema = `arcade_resign_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let server: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await pool.query(`
      CREATE TABLE ${quotedSchema}.arcade_rooms (
        code text PRIMARY KEY,
        game text NOT NULL,
        capacity integer NOT NULL,
        is_private boolean NOT NULL,
        players jsonb NOT NULL,
        state jsonb,
        turn integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    server = await startArcadeProcess(isolatedDatabaseUrl.toString());

    const host = await postRoom(server.baseUrl, "rooms", {
      game: "mopyon",
      displayName: "Player one",
      playerCount: 2,
      isPrivate: true,
    });
    const guest = await postRoom(server.baseUrl, `rooms/${String(host.code)}/join`, {
      displayName: "Player two",
    });
    assert.equal(host.seat, 0);
    assert.equal(guest.seat, 1);

    const playerOne = await connectArcadeSocket(
      server.baseUrl,
      String(host.code),
      String(host.reconnectToken),
    );
    const playerTwo = await connectArcadeSocket(
      server.baseUrl,
      String(host.code),
      String(guest.reconnectToken),
    );
    sockets.push(playerOne.socket, playerTwo.socket);

    const firstResultForOne = nextSocketMessage(playerOne.socket);
    const firstResultForTwo = nextSocketMessage(playerTwo.socket);
    playerOne.socket.send(JSON.stringify({ type: "resign" }));
    const [oneMessage, twoMessage] = await Promise.all([firstResultForOne, firstResultForTwo]);
    assert.equal(oneMessage.type, "room");
    assert.equal(twoMessage.type, "room");
    const oneRoom = oneMessage.room as JsonRecord;
    const twoRoom = twoMessage.room as JsonRecord;
    assert.equal(oneRoom.status, "finished");
    const result = oneRoom.result as JsonRecord;
    assert.equal(result.winnerSeat, 1);
    assert.equal(result.resignedSeat, 0);
    assert.equal(Number.isFinite(result.endedAt), true);
    assert.deepEqual(twoRoom.result, result);

    const duplicateForOne = nextSocketMessage(playerOne.socket);
    const duplicateForTwo = nextSocketMessage(playerTwo.socket);
    playerOne.socket.send(JSON.stringify({ type: "resign" }));
    const [duplicateOne, duplicateTwo] = await Promise.all([duplicateForOne, duplicateForTwo]);
    assert.deepEqual((duplicateOne.room as JsonRecord).result, oneRoom.result);
    assert.deepEqual((duplicateTwo.room as JsonRecord).result, oneRoom.result);

    playerOne.socket.close();
    playerTwo.socket.close();
    const reconnectOne = await connectArcadeSocket(
      server.baseUrl,
      String(host.code),
      String(host.reconnectToken),
    );
    const reconnectTwo = await connectArcadeSocket(
      server.baseUrl,
      String(host.code),
      String(guest.reconnectToken),
    );
    sockets.push(reconnectOne.socket, reconnectTwo.socket);
    for (const reconnect of [reconnectOne, reconnectTwo]) {
      const room = reconnect.firstMessage.room as JsonRecord;
      assert.equal(room.status, "finished");
      assert.deepEqual(room.result, oneRoom.result);
    }
  } finally {
    sockets.forEach((socket) => socket.close());
    if (server) await stopArcadeProcess(server.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("overlapping cross-instance room refresh and cleanup preserves live matches", {
  timeout: 60_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade room retention integration tests.");

  const schema = `arcade_idle_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let processOne: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  let processTwo: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    await pool.query(`
      CREATE TABLE ${quotedSchema}.arcade_rooms (
        code text PRIMARY KEY,
        game text NOT NULL,
        capacity integer NOT NULL,
        is_private boolean NOT NULL,
        players jsonb NOT NULL,
        state jsonb,
        turn integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    [processOne, processTwo] = await Promise.all([
      startArcadeProcess(isolatedDatabaseUrl.toString()),
      startArcadeProcess(isolatedDatabaseUrl.toString()),
    ]);

    const room = await postRoom(processOne.baseUrl, "rooms", {
      game: "mopyon",
      displayName: "Idle host",
      playerCount: 2,
      isPrivate: true,
    });
    await postRoom(processOne.baseUrl, `rooms/${String(room.code)}/join`, {
      displayName: "Idle opponent",
    });
    const connection = await connectArcadeSocket(
      processOne.baseUrl,
      String(room.code),
      String(room.reconnectToken),
    );
    sockets.push(connection.socket);
    assert.equal((connection.firstMessage.room as JsonRecord).status, "playing");

    const disconnectedRoom = await postRoom(processTwo.baseUrl, "rooms", {
      game: "mopyon",
      displayName: "Disconnected host",
      playerCount: 2,
      isPrivate: true,
    });
    const disconnectedConnection = await connectArcadeSocket(
      processTwo.baseUrl,
      String(disconnectedRoom.code),
      String(disconnectedRoom.reconnectToken),
    );
    sockets.push(disconnectedConnection.socket);
    const socketClosed = once(disconnectedConnection.socket, "close");
    disconnectedConnection.socket.close();
    await socketClosed;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const staleTimestamp = new Date(Date.now() - 6 * 60 * 60 * 1000 - 10_000);
      await pool.query(
        `UPDATE ${quotedSchema}.arcade_rooms SET updated_at = $2 WHERE code = $1`,
        [room.code, staleTimestamp],
      );

      const refreshed = await fetch(
        `${processOne.baseUrl}/__test/maintain-rooms?pauseAfterRefreshMs=250`,
        { method: "POST" },
      );
      assert.equal(refreshed.status, 200);
      const cleaned = fetch(`${processTwo.baseUrl}/__test/maintain-rooms`, { method: "POST" });
      const cleanupResponse = await cleaned;
      assert.equal(cleanupResponse.status, 200);

      const activeRoom = await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${String(room.code)}`);
      assert.equal(activeRoom.status, 200, `the active match should survive refresh/cleanup race ${attempt + 1}`);
    }

    const expiredTimestamp = new Date(Date.now() - 6 * 60 * 60 * 1000 - 10_000);
    await pool.query(
      `UPDATE ${quotedSchema}.arcade_rooms SET updated_at = $2 WHERE code = $1`,
      [disconnectedRoom.code, expiredTimestamp],
    );
    const cleaned = await fetch(`${processTwo.baseUrl}/__test/maintain-rooms`, { method: "POST" });
    assert.equal(cleaned.status, 200);

    const activeRoom = await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${String(room.code)}`);
    const expiredRoom = await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${String(disconnectedRoom.code)}`);
    assert.equal(activeRoom.status, 200, "the cleanup instance must retain the refreshed live match");
    assert.equal(expiredRoom.status, 404, "an expired room with no connected players must be removed");
  } finally {
    sockets.forEach((socket) => socket.close());
    if (processTwo) await stopArcadeProcess(processTwo.child);
    if (processOne) await stopArcadeProcess(processOne.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("notification listener retries automatically and resyncs connected room snapshots", {
  timeout: 30_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade automatic listener recovery tests.");

  const schema = `arcade_listener_retry_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let processOne: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  let processTwo: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);

  try {
    await pool.query(`
      CREATE TABLE ${quotedSchema}.arcade_rooms (
        code text PRIMARY KEY,
        game text NOT NULL,
        capacity integer NOT NULL,
        is_private boolean NOT NULL,
        players jsonb NOT NULL,
        state jsonb,
        turn integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    [processOne, processTwo] = await Promise.all([
      startArcadeProcess(isolatedDatabaseUrl.toString()),
      startArcadeProcess(isolatedDatabaseUrl.toString()),
    ]);

    const host = await postRoom(processOne.baseUrl, "rooms", {
      game: "mopyon",
      displayName: "Retry host",
      playerCount: 2,
      isPrivate: true,
    });
    const guest = await postRoom(processOne.baseUrl, `rooms/${String(host.code)}/join`, {
      displayName: "Retry guest",
    });
    const writer = await connectArcadeSocket(processOne.baseUrl, String(host.code), String(host.reconnectToken));
    const observer = await connectArcadeSocket(processTwo.baseUrl, String(host.code), String(guest.reconnectToken));
    sockets.push(writer.socket, observer.socket);
    assert.equal(observer.firstMessage.type, "room");

    const disconnected = await fetch(`${processTwo.baseUrl}/__test/disconnect-notification-listener`, {
      method: "POST",
    });
    assert.equal(disconnected.status, 200);
    assert.deepEqual(await disconnected.json(), { disconnected: true });

    const initialRoom = observer.firstMessage.room as JsonRecord;
    const initialState = initialRoom.state as JsonRecord;
    const board = [...initialState.board as unknown[]];
    board[0] = "X";
    const latestState = { ...initialState, board, currentPlayer: "O", lastMove: 0 };
    const recoveredSnapshot = nextSocketMessage(observer.socket);
    await pool.query(
      `UPDATE ${quotedSchema}.arcade_rooms
       SET state = $2::jsonb, turn = $3, updated_at = now()
       WHERE code = $1`,
      [host.code, JSON.stringify(latestState), 1],
    );

    const recovered = await recoveredSnapshot;
    assert.equal(recovered.type, "room", JSON.stringify(recovered));
    const recoveredRoom = recovered.room as JsonRecord;
    assert.equal(recoveredRoom.turn, 1);
    assert.equal(((recoveredRoom.state as JsonRecord).board as unknown[])[0], "X");
    assert.equal(observer.socket.readyState, WebSocket.OPEN);
  } finally {
    sockets.forEach((socket) => socket.close());
    if (processTwo) await stopArcadeProcess(processTwo.child);
    if (processOne) await stopArcadeProcess(processOne.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("resigned Scrabble and Filler seats become bots, then reopen for the next match", {
  timeout: 45_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade resignation integration tests.");

  const schema = `arcade_bot_seats_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let processOne: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  let processTwo: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);

  try {
    await pool.query(`
      CREATE TABLE ${quotedSchema}.arcade_rooms (
        code text PRIMARY KEY,
        game text NOT NULL,
        capacity integer NOT NULL,
        is_private boolean NOT NULL,
        players jsonb NOT NULL,
        state jsonb,
        turn integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    [processOne, processTwo] = await Promise.all([
      startArcadeProcess(isolatedDatabaseUrl.toString()),
      startArcadeProcess(isolatedDatabaseUrl.toString()),
    ]);

    for (const game of ["scrabble", "filler"] as const) {
      const host = await postRoom(processOne.baseUrl, "rooms", {
        game,
        displayName: `${game} host`,
        playerCount: 3,
        isPrivate: true,
      });
      const second = await postRoom(processOne.baseUrl, `rooms/${String(host.code)}/join`, {
        displayName: `${game} player two`,
      });
      await postRoom(processOne.baseUrl, `rooms/${String(host.code)}/join`, {
        displayName: `${game} player three`,
      });
      const hostConnection = await connectArcadeSocket(
        processOne.baseUrl, String(host.code), String(host.reconnectToken),
      );
      const observer = await connectArcadeSocket(
        processTwo.baseUrl, String(host.code), String(second.reconnectToken),
      );
      sockets.push(hostConnection.socket, observer.socket);

      const takeoverMessage = nextSocketMessage(observer.socket);
      hostConnection.socket.send(JSON.stringify({ type: "resign" }));
      const takeover = await takeoverMessage;
      assert.ok(takeover.type === "state" || takeover.type === "room", `${game}: ${JSON.stringify(takeover)}`);
      const botRoom = takeover.room as JsonRecord;
      assert.equal((botRoom.players as JsonRecord[])[0].isBot, true, `${game} should mark the resigned seat as a bot`);
      assert.equal(botRoom.turn, 1, `${game} bot should take its turn immediately`);
      if (game === "scrabble") assert.equal((botRoom.state as JsonRecord).passes, 1);
      else assert.equal(((botRoom.state as JsonRecord).fillerBoard as JsonRecord).turn, 1);

      await pool.query(
        `UPDATE ${quotedSchema}.arcade_rooms
         SET state = jsonb_set(state, '{winner}', '1'::jsonb), updated_at = now()
         WHERE code = $1`,
        [host.code],
      );
      const replacement = await postRoom(processOne.baseUrl, `rooms/${String(host.code)}/join`, {
        displayName: `${game} replacement`,
      });
      assert.equal(replacement.seat, 0);
      const nextRoom = replacement;
      assert.equal(((nextRoom.players as JsonRecord[])[0]).name, `${game} replacement`);
      assert.equal(((nextRoom.players as JsonRecord[])[0]).isBot, undefined);
      assert.equal(nextRoom.turn, 0);
      assert.equal((nextRoom.state as JsonRecord).winner, null);
    }
  } finally {
    sockets.forEach((socket) => socket.close());
    if (processTwo) await stopArcadeProcess(processTwo.child);
    if (processOne) await stopArcadeProcess(processOne.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});
