import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { WebSocket } from "ws";
import { ARCADE_ROOM_RETENTION_MS } from "@workspace/api-zod";
import { arcadeRooms, pool } from "@workspace/db";

type JsonRecord = Record<string, unknown>;

const apiServerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arcadeRoomTableConfig = getTableConfig(arcadeRooms);
const delay = (milliseconds: number) =>
  new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function assertProvisionedArcadeSchemaMatchesDrizzle(): Promise<void> {
  const columns = await pool.query(`
    SELECT
      attribute.attname AS name,
      format_type(attribute.atttypid, attribute.atttypmod) AS sql_type,
      attribute.attnotnull AS not_null,
      (default_value.adbin IS NOT NULL) AS has_default,
      EXISTS (
        SELECT 1
        FROM pg_index AS primary_key
        WHERE primary_key.indrelid = relation.oid
          AND primary_key.indisprimary
          AND attribute.attnum = ANY(primary_key.indkey)
      ) AS is_primary
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_attrdef AS default_value
      ON default_value.adrelid = relation.oid
      AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'arcade_rooms'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY attribute.attnum
  `);
  assert.deepEqual(
    columns.rows.map((column) => ({
      name: column.name,
      sqlType: column.sql_type,
      notNull: column.not_null,
      hasDefault: column.has_default,
      primary: column.is_primary,
    })),
    arcadeRoomTableConfig.columns.map((column) => ({
      name: column.name,
      sqlType: column.getSQLType(),
      notNull: column.notNull,
      hasDefault: column.hasDefault,
      primary: column.primary,
    })),
    "provisioned public.arcade_rooms columns should match the Drizzle definition",
  );

  const indexes = await pool.query(
    `SELECT indexname AS name, indexdef
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'arcade_rooms'`,
  );
  for (const index of arcadeRoomTableConfig.indexes) {
    const expectedColumns = (index.config.columns as Array<{ name?: string }>)
      .flatMap((column) => column.name ? [column.name] : []);
    const provisionedIndex = indexes.rows.find((row) => row.name === index.config.name);
    assert.ok(provisionedIndex, `provisioned index ${index.config.name} should exist`);
    assert.match(
      provisionedIndex.indexdef,
      new RegExp(`\\(${expectedColumns.join(", ")}\\)$`),
      `provisioned index ${index.config.name} should cover its Drizzle columns`,
    );
  }
}

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

async function startArcadeProcess(
  databaseUrl: string,
  options: { failInitialListenerConnection?: boolean; listenerRetryDelayMs?: number } = {},
): Promise<{
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
        ...(options.failInitialListenerConnection ? { ARCADE_TEST_FAIL_INITIAL_LISTENER_CONNECTION: "1" } : {}),
        ...(options.listenerRetryDelayMs
          ? { ARCADE_TEST_LISTENER_RETRY_DELAY_MS: String(options.listenerRetryDelayMs) }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;

  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
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
    throw new Error(`Arcade API process did not become ready:\n${output}`);
  } catch (error) {
    await stopArcadeProcess(child);
    throw error;
  }
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
  cookie?: string,
): Promise<JsonRecord> {
  const response = await fetch(`${baseUrl}/api/arcade/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
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

  try {
    await pool.query(`CREATE SCHEMA ${quotedSchema}`);
    await assertProvisionedArcadeSchemaMatchesDrizzle();
    await pool.query(`
      CREATE TABLE ${quotedSchema}.arcade_rooms
      (LIKE public.arcade_rooms INCLUDING ALL)
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
    const persistedBlockDrop = await pool.query(
      `SELECT state FROM ${quotedSchema}.arcade_rooms WHERE code = $1`,
      [blockDropRoom.code],
    );
    assert.equal(persistedBlockDrop.rowCount, 1);
    const expectedBlockDropState = persistedBlockDrop.rows[0].state;

    const expiredCode = `Y${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
    const malformedCode = `Y${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
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
    await pool.query(
      `INSERT INTO ${quotedSchema}.arcade_rooms
        (code, game, capacity, is_private, players, state, turn, updated_at)
       VALUES ($1, 'mopyon', 2, true, $2::jsonb, $3::jsonb, 0, now())`,
      [
        malformedCode,
        JSON.stringify([{ name: "Malformed player", tokenHash: "not-a-token-hash" }]),
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
    assert.deepEqual(restoredRoom.state, expectedBlockDropState);

    const expiredResponse = await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${expiredCode}`);
    assert.equal(expiredResponse.status, 404);
    const expiredRows = await pool.query(
      `SELECT code FROM ${quotedSchema}.arcade_rooms WHERE code = $1`,
      [expiredCode],
    );
    assert.equal(expiredRows.rowCount, 0, "expired room should also be deleted from storage");
    assert.equal((await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${malformedCode}`)).status, 404);
    const malformedRows = await pool.query(
      `SELECT code FROM ${quotedSchema}.arcade_rooms WHERE code = $1`,
      [malformedCode],
    );
    assert.equal(malformedRows.rowCount, 0, "malformed room should also be deleted from storage");
  } finally {
    blockDropSocket?.close();
    reconnectSockets.forEach((socket) => socket.close());
    const processStops = await Promise.allSettled([
      ...(processTwo ? [stopArcadeProcess(processTwo.child)] : []),
      ...(processOne ? [stopArcadeProcess(processOne.child)] : []),
    ]);
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    } finally {
      const stopFailure = processStops.find((result) => result.status === "rejected");
      if (stopFailure?.status === "rejected") throw stopFailure.reason;
    }
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

test("signed-in arcade results remain in profile history after room deletion and duplicate resigns", {
  timeout: 30_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade match-history integration tests.");

  const schema = `arcade_history_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let processOne: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);

  try {
    await pool.query(`
      CREATE TABLE ${quotedSchema}.arcade_rooms (
        code text PRIMARY KEY, game text NOT NULL, capacity integer NOT NULL,
        is_private boolean NOT NULL, players jsonb NOT NULL, state jsonb,
        turn integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE ${quotedSchema}.domino_users (
        id uuid PRIMARY KEY, username text NOT NULL, games integer NOT NULL DEFAULT 0,
        wins integer NOT NULL DEFAULT 0
      );
      CREATE TABLE ${quotedSchema}.domino_sessions (
        token_hash text PRIMARY KEY, user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
      );
      CREATE TABLE ${quotedSchema}.domino_matches (
        match_id uuid PRIMARY KEY, room_code text NOT NULL, mode text NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE ${quotedSchema}.domino_match_results (
        match_id uuid NOT NULL, user_id uuid NOT NULL, rank integer NOT NULL,
        medal text NOT NULL, crown_points integer NOT NULL, won boolean NOT NULL,
        opponents text[] NOT NULL DEFAULT '{}'::text[],
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (match_id, user_id)
      );
    `);

    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    processOne = await startArcadeProcess(isolatedDatabaseUrl.toString());

    const hostUser = randomUUID();
    const guestUser = randomUUID();
    const thirdUser = randomUUID();
    const fourthUser = randomUUID();
    const hostSession = randomUUID();
    const guestSession = randomUUID();
    const thirdSession = randomUUID();
    const fourthSession = randomUUID();
    const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");
    await pool.query(
      `INSERT INTO ${quotedSchema}.domino_users (id, username)
       VALUES ($1, $2), ($3, $4), ($5, $6), ($7, $8)`,
      [hostUser, "history_host", guestUser, "history_guest", thirdUser, "history_third", fourthUser, "history_fourth"],
    );
    await pool.query(
      `INSERT INTO ${quotedSchema}.domino_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + interval '1 hour'), ($3, $4, now() + interval '1 hour'),
              ($5, $6, now() + interval '1 hour'), ($7, $8, now() + interval '1 hour')`,
      [
        sessionHash(hostSession), hostUser, sessionHash(guestSession), guestUser,
        sessionHash(thirdSession), thirdUser, sessionHash(fourthSession), fourthUser,
      ],
    );

    const hostCookie = `lakou.sid=${hostSession}`;
    const guestCookie = `lakou.sid=${guestSession}`;
    const thirdCookie = `lakou.sid=${thirdSession}`;
    const fourthCookie = `lakou.sid=${fourthSession}`;
    const host = await postRoom(processOne.baseUrl, "rooms", {
      game: "mopyon",
      displayName: "History host",
      playerCount: 2,
      isPrivate: true,
    }, hostCookie);
    assert.ok(typeof host.updatedAt === "number");
    assert.equal(host.reconnectDeadline, host.updatedAt + ARCADE_ROOM_RETENTION_MS);
    const guest = await postRoom(processOne.baseUrl, `rooms/${String(host.code)}/join`, {
      displayName: "History guest",
    }, guestCookie);
    const hostSocket = await connectArcadeSocket(processOne.baseUrl, String(host.code), String(host.reconnectToken));
    const guestSocket = await connectArcadeSocket(processOne.baseUrl, String(host.code), String(guest.reconnectToken));
    sockets.push(hostSocket.socket, guestSocket.socket);

    const firstResult = nextSocketMessage(guestSocket.socket);
    hostSocket.socket.send(JSON.stringify({ type: "resign" }));
    assert.equal((await firstResult).type, "room");
    const duplicateResult = nextSocketMessage(guestSocket.socket);
    hostSocket.socket.send(JSON.stringify({ type: "resign" }));
    assert.equal((await duplicateResult).type, "room");

    await pool.query(`DELETE FROM ${quotedSchema}.arcade_rooms WHERE code = $1`, [host.code]);
    const readHistory = async (cookie: string, limit = 6, offset = 0) => {
      const response = await fetch(
        `${processOne!.baseUrl}/api/auth/recent-matches?limit=${limit}&offset=${offset}`,
        { headers: { cookie } },
      );
      assert.equal(response.status, 200);
      return await response.json() as {
        matches: JsonRecord[];
        hasMore: boolean;
        nextOffset: number | null;
      };
    };
    const [hostHistory, guestHistory] = await Promise.all([
      readHistory(hostCookie),
      readHistory(guestCookie),
    ]);
    assert.equal(hostHistory.matches.length, 1);
    assert.equal(guestHistory.matches.length, 1);
    assert.equal(hostHistory.matches[0].mode, "arcade:mopyon");
    assert.equal(hostHistory.matches[0].medal, "loss");
    assert.equal(hostHistory.matches[0].won, false);
    assert.equal(guestHistory.matches[0].medal, "win");
    assert.equal(guestHistory.matches[0].won, true);
    assert.deepEqual(hostHistory.matches[0].opponents, ["History guest"]);
    assert.deepEqual(guestHistory.matches[0].opponents, ["History host"]);
    assert.equal(hostHistory.matches[0].matchId, guestHistory.matches[0].matchId);

    const multiRoom = await postRoom(processOne.baseUrl, "rooms", {
      game: "scrabble",
      displayName: "History host",
      playerCount: 4,
      isPrivate: true,
    }, hostCookie);
    const resigned = await postRoom(processOne.baseUrl, `rooms/${String(multiRoom.code)}/join`, {
      displayName: "Resigned rival",
    }, guestCookie);
    await postRoom(processOne.baseUrl, `rooms/${String(multiRoom.code)}/join`, {
      displayName: "History third",
    }, thirdCookie);
    await postRoom(processOne.baseUrl, `rooms/${String(multiRoom.code)}/join`, {
      displayName: "History fourth",
    }, fourthCookie);
    const multiHostSocket = await connectArcadeSocket(
      processOne.baseUrl, String(multiRoom.code), String(multiRoom.reconnectToken),
    );
    const resignedSocket = await connectArcadeSocket(
      processOne.baseUrl, String(multiRoom.code), String(resigned.reconnectToken),
    );
    sockets.push(multiHostSocket.socket, resignedSocket.socket);
    const beforeMatchEnd = nextSocketMessage(multiHostSocket.socket);
    resignedSocket.socket.send(JSON.stringify({ type: "resign" }));
    const takeover = await beforeMatchEnd;
    assert.equal(takeover.type, "room");
    assert.equal(((takeover.room as JsonRecord).players as JsonRecord[])[1].name, "Yard bot");

    const finalBoard = Array(225).fill(null) as (JsonRecord | null)[];
    finalBoard[112] = { letter: "C", points: 3 };
    finalBoard[113] = { letter: "A", points: 1 };
    finalBoard[114] = { letter: "T", points: 1 };
    const trustedState = {
      board: finalBoard,
      racks: [["S"], ["Q"], ["A"], ["B"]],
      bag: [],
      scores: [0, 0, 0, 0],
      turn: 0,
      playerCount: 4,
      passes: 0,
      winner: null,
    };
    await pool.query(
      `UPDATE ${quotedSchema}.arcade_rooms SET state = $2::jsonb, turn = 0 WHERE code = $1`,
      [multiRoom.code, JSON.stringify(trustedState)],
    );
    const completed = nextSocketMessage(multiHostSocket.socket);
    const completedBoard = [...finalBoard];
    completedBoard[115] = { letter: "S", points: 1 };
    multiHostSocket.socket.send(JSON.stringify({
      type: "state",
      turn: 1,
      state: { ...trustedState, board: completedBoard, racks: [[], [], [], []], turn: 1 },
    }));
    const finalUpdate = await completed;
    assert.equal(finalUpdate.type, "state");
    assert.equal(((finalUpdate.room as JsonRecord).state as JsonRecord).winner, 0);

    const historyAtRoom = async (cookie: string) => {
      const history = await readHistory(cookie);
      return history.matches.find((match) => match.roomCode === multiRoom.code);
    };
    const [multiHostHistory, resignedHistory, thirdHistory, fourthHistory] = await Promise.all([
      historyAtRoom(hostCookie),
      historyAtRoom(guestCookie),
      historyAtRoom(thirdCookie),
      historyAtRoom(fourthCookie),
    ]);
    assert.deepEqual(multiHostHistory?.opponents, ["Resigned rival", "History third", "History fourth"]);
    assert.deepEqual(resignedHistory?.opponents, ["History host", "History third", "History fourth"]);
    assert.deepEqual(thirdHistory?.opponents, ["History host", "Resigned rival", "History fourth"]);
    assert.deepEqual(fourthHistory?.opponents, ["History host", "Resigned rival", "History third"]);

    const legacyDominoMatchId = randomUUID();
    await pool.query(
      `INSERT INTO ${quotedSchema}.domino_matches (match_id, room_code, mode, recorded_at)
       VALUES ($1, 'OLD1', 'regular', now() - interval '1 day')`,
      [legacyDominoMatchId],
    );
    await pool.query(
      `INSERT INTO ${quotedSchema}.domino_match_results
       (match_id, user_id, rank, medal, crown_points, won)
       VALUES ($1, $2, 1, 'win', 10, true)`,
      [legacyDominoMatchId, hostUser],
    );
    const firstPage = await readHistory(hostCookie, 2, 0);
    const secondPage = await readHistory(hostCookie, 2, 2);
    assert.equal(firstPage.matches.length, 2);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.nextOffset, 2);
    assert.equal(secondPage.matches.length, 1);
    assert.equal(secondPage.hasMore, false);
    assert.equal(secondPage.nextOffset, null);
    assert.deepEqual(new Set(firstPage.matches.map((match) => match.mode)), new Set(["arcade:mopyon", "arcade:scrabble"]));
    assert.equal(secondPage.matches[0].mode, "regular");
    assert.equal(secondPage.matches[0].matchId, legacyDominoMatchId);
  } finally {
    sockets.forEach((socket) => socket.close());
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
    const opponent = await postRoom(processOne.baseUrl, `rooms/${String(room.code)}/join`, {
      displayName: "Idle opponent",
    });
    const connection = await connectArcadeSocket(
      processOne.baseUrl,
      String(room.code),
      String(room.reconnectToken),
    );
    sockets.push(connection.socket);
    assert.equal((connection.firstMessage.room as JsonRecord).status, "playing");
    const opponentConnection = await connectArcadeSocket(
      processTwo.baseUrl,
      String(room.code),
      String(opponent.reconnectToken),
    );
    sockets.push(opponentConnection.socket);
    assert.equal((opponentConnection.firstMessage.room as JsonRecord).status, "playing");

    const initialState = (connection.firstMessage.room as JsonRecord).state as JsonRecord;
    const firstBoard = [...initialState.board as unknown[]];
    firstBoard[112] = "X";
    const firstMove = {
      ...initialState,
      board: firstBoard,
      currentPlayer: "O",
      lastMove: 112,
    };
    const hostFirstMove = nextSocketMessage(connection.socket);
    const opponentFirstMove = nextSocketMessage(opponentConnection.socket);
    connection.socket.send(JSON.stringify({ type: "state", state: firstMove, turn: 1 }));
    const firstMoveMessages = await Promise.all([hostFirstMove, opponentFirstMove]);
    for (const message of firstMoveMessages) {
      assert.equal(message.type, "state");
      assert.equal((((message.room as JsonRecord).state as JsonRecord).board as unknown[])[112], "X");
    }

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
      const staleTimestamp = new Date(Date.now() - ARCADE_ROOM_RETENTION_MS - 10_000);
      await pool.query(
        `UPDATE ${quotedSchema}.arcade_rooms SET updated_at = $2 WHERE code = $1`,
        [room.code, staleTimestamp],
      );

      if (attempt === 0) {
        const refreshed = await fetch(
          `${processOne.baseUrl}/__test/maintain-rooms?pauseAfterRefreshMs=1000`,
          { method: "POST" },
        );
        assert.equal(refreshed.status, 200);

        const currentState = (firstMoveMessages[1].room as JsonRecord).state as JsonRecord;
        const secondBoard = [...currentState.board as unknown[]];
        secondBoard[113] = "O";
        const secondMove = {
          ...currentState,
          board: secondBoard,
          currentPlayer: "X",
          lastMove: 113,
        };
        const hostSecondMove = nextSocketMessage(connection.socket);
        const opponentSecondMove = nextSocketMessage(opponentConnection.socket);
        opponentConnection.socket.send(JSON.stringify({ type: "state", state: secondMove, turn: 0 }));
        const secondMoveMessages = await Promise.all([hostSecondMove, opponentSecondMove]);
        for (const message of secondMoveMessages) {
          assert.equal(message.type, "state");
          assert.equal((((message.room as JsonRecord).state as JsonRecord).board as unknown[])[113], "O");
        }
        const persisted = await pool.query(
          `SELECT state FROM ${quotedSchema}.arcade_rooms WHERE code = $1`,
          [room.code],
        );
        assert.equal((persisted.rows[0].state as JsonRecord).currentPlayer, "X");
        assert.equal(((persisted.rows[0].state as JsonRecord).board as unknown[])[113], "O");
      } else {
        const refreshed = await fetch(
          `${processOne.baseUrl}/__test/maintain-rooms?pauseAfterRefreshMs=250`,
          { method: "POST" },
        );
        assert.equal(refreshed.status, 200);
      }
      const cleaned = fetch(`${processTwo.baseUrl}/__test/maintain-rooms`, { method: "POST" });
      const cleanupResponse = await cleaned;
      assert.equal(cleanupResponse.status, 200);

      const activeRoom = await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${String(room.code)}`);
      assert.equal(activeRoom.status, 200, `the active match should survive refresh/cleanup race ${attempt + 1}`);
    }

    await pool.query(
      `UPDATE ${quotedSchema}.arcade_rooms SET updated_at = $2 WHERE code = $1`,
      [room.code, new Date(Date.now() - ARCADE_ROOM_RETENTION_MS - 10_000)],
    );
    const pausedMaintenance = await fetch(
      `${processOne.baseUrl}/__test/maintain-rooms?pauseAfterRefreshMs=1000`,
      { method: "POST" },
    );
    assert.equal(pausedMaintenance.status, 200);

    const resignationForHost = nextSocketMessage(connection.socket);
    const resignationForOpponent = nextSocketMessage(opponentConnection.socket);
    connection.socket.send(JSON.stringify({ type: "resign" }));
    const [hostResignation, opponentResignation] = await Promise.all([
      resignationForHost,
      resignationForOpponent,
    ]);
    assert.equal(hostResignation.type, "room");
    assert.equal(opponentResignation.type, "room");
    const resignedRoom = hostResignation.room as JsonRecord;
    const resignationResult = resignedRoom.result as JsonRecord;
    assert.equal(resignedRoom.status, "finished");
    assert.equal(resignationResult.winnerSeat, 1);
    assert.equal(resignationResult.resignedSeat, 0);
    assert.deepEqual((opponentResignation.room as JsonRecord).result, resignationResult);

    const persistedResignation = await pool.query(
      `SELECT players FROM ${quotedSchema}.arcade_rooms WHERE code = $1`,
      [room.code],
    );
    const savedPlayers = persistedResignation.rows[0].players as JsonRecord[];
    const savedResults = savedPlayers.filter((player) => "__509YardArcadeResult" in player);
    assert.equal(savedResults.length, 1, "the winner/loss result must be persisted once");
    assert.deepEqual(savedResults[0].__509YardArcadeResult, resignationResult);

    const beforeCutoffTimestamp = new Date(Date.now() - ARCADE_ROOM_RETENTION_MS + 5_000);
    await pool.query(
      `UPDATE ${quotedSchema}.arcade_rooms SET updated_at = $2 WHERE code = $1`,
      [disconnectedRoom.code, beforeCutoffTimestamp],
    );
    const retainedByCleanup = await fetch(`${processTwo.baseUrl}/__test/maintain-rooms`, { method: "POST" });
    assert.equal(retainedByCleanup.status, 200);

    const roomBeforeCutoff = await fetch(`${processTwo.baseUrl}/api/arcade/rooms/${String(disconnectedRoom.code)}`);
    assert.equal(roomBeforeCutoff.status, 200, "a disconnected room must remain available just before its shared retention deadline");
    const roomBeforeCutoffBody = await roomBeforeCutoff.json() as JsonRecord;
    assert.ok(
      Number(roomBeforeCutoffBody.reconnectDeadline) > Date.now(),
      "the public reconnect deadline must still be in the future just before cleanup eligibility",
    );

    const expiredTimestamp = new Date(Date.now() - ARCADE_ROOM_RETENTION_MS - 5_000);
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

test("Scrabble moves stay private and authoritative during cross-instance maintenance", {
  timeout: 30_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade room retention integration tests.");

  const schema = `arcade_scrabble_race_${randomUUID().replaceAll("-", "")}`;
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
      game: "scrabble",
      displayName: "Scrabble host",
      playerCount: 2,
      isPrivate: true,
    });
    const guest = await postRoom(processOne.baseUrl, `rooms/${String(host.code)}/join`, {
      displayName: "Scrabble guest",
    });
    const hostRack = ["C", "A", "T", "R", "E", "S", "O"];
    const guestRack = ["D", "O", "G", "H", "I", "J", "K"];
    const originalBag = ["L", "N", "D", "B", "Q"];
    const initialState = {
      board: Array(225).fill(null),
      racks: [hostRack, guestRack],
      bag: originalBag,
      scores: [0, 0],
      turn: 0,
      playerCount: 2,
      passes: 0,
      winner: null,
    };
    await pool.query(
      `UPDATE ${quotedSchema}.arcade_rooms
       SET state = $2::jsonb, updated_at = $3
       WHERE code = $1`,
      [
        host.code,
        JSON.stringify(initialState),
        new Date(Date.now() - ARCADE_ROOM_RETENTION_MS - 10_000),
      ],
    );

    const hostConnection = await connectArcadeSocket(
      processOne.baseUrl,
      String(host.code),
      String(host.reconnectToken),
    );
    const guestConnection = await connectArcadeSocket(
      processTwo.baseUrl,
      String(host.code),
      String(guest.reconnectToken),
    );
    const hostOnSecondInstance = await connectArcadeSocket(
      processTwo.baseUrl,
      String(host.code),
      String(host.reconnectToken),
    );
    sockets.push(hostConnection.socket, guestConnection.socket, hostOnSecondInstance.socket);
    assert.deepEqual(
      ((hostConnection.firstMessage.room as JsonRecord).state as JsonRecord).racks,
      [hostRack, []],
    );
    assert.deepEqual(
      ((guestConnection.firstMessage.room as JsonRecord).state as JsonRecord).racks,
      [[], guestRack],
    );

    const maintenanceResponse = await fetch(
      `${processOne.baseUrl}/__test/maintain-rooms?pauseAfterRefreshMs=1000`,
      { method: "POST" },
    );
    assert.equal(maintenanceResponse.status, 200);
    assert.deepEqual(await maintenanceResponse.json(), { refreshed: true });

    const projectedRacks = [hostRack.slice(3).concat(["", "", ""]), []];
    const board = [...initialState.board];
    board[111] = { letter: "C", points: 3 };
    board[112] = { letter: "A", points: 1 };
    board[113] = { letter: "T", points: 1 };
    const proposedState = {
      ...initialState,
      board,
      racks: projectedRacks,
      bag: Array(originalBag.length - 3).fill(""),
      scores: [10, 0],
      turn: 1,
    };
    const hostUpdate = nextSocketMessage(hostConnection.socket);
    const guestUpdate = nextSocketMessage(guestConnection.socket);
    hostOnSecondInstance.socket.send(JSON.stringify({ type: "state", state: proposedState, turn: 1 }));
    const [hostMessage, guestMessage] = await Promise.all([hostUpdate, guestUpdate]);

    for (const [seat, message] of [[0, hostMessage], [1, guestMessage]] as const) {
      assert.equal(message.type, "state");
      const room = message.room as JsonRecord;
      const state = room.state as JsonRecord;
      assert.equal(state.turn, 1);
      assert.equal(state.scores && (state.scores as number[])[0], 10);
      assert.equal((state.board as unknown[])[112] && ((state.board as JsonRecord[])[112]).letter, "A");
      assert.deepEqual(
        state.racks,
        seat === 0 ? [["R", "E", "S", "O", "L", "N", "D"], []] : [[], guestRack],
      );
      assert.ok((state.bag as string[]).every((tile) => tile === ""));
    }

    const saved = await pool.query(
      `SELECT state FROM ${quotedSchema}.arcade_rooms WHERE code = $1`,
      [host.code],
    );
    const savedState = saved.rows[0].state as typeof initialState;
    assert.equal(savedState.turn, 1);
    assert.equal((savedState.board[112] as JsonRecord).letter, "A");
    assert.deepEqual(savedState.racks, [
      ["R", "E", "S", "O", "L", "N", "D"],
      guestRack,
    ]);
    assert.deepEqual(savedState.bag, ["B", "Q"]);
  } finally {
    sockets.forEach((socket) => socket.close());
    if (processTwo) await stopArcadeProcess(processTwo.child);
    if (processOne) await stopArcadeProcess(processOne.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("maintenance rolls back activity refresh after a failure and can later expire stale rooms", {
  timeout: 30_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade maintenance integration tests.");

  const schema = `arcade_maintenance_failure_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let processOne: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);

  try {
    await pool.query(`
      CREATE TABLE ${quotedSchema}.arcade_rooms (
        code text PRIMARY KEY, game text NOT NULL, capacity integer NOT NULL,
        is_private boolean NOT NULL, players jsonb NOT NULL, state jsonb,
        turn integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    processOne = await startArcadeProcess(isolatedDatabaseUrl.toString());

    const activeHost = await postRoom(processOne.baseUrl, "rooms", {
      game: "mopyon",
      displayName: "Active host",
      playerCount: 2,
      isPrivate: true,
    });
    await postRoom(processOne.baseUrl, `rooms/${String(activeHost.code)}/join`, {
      displayName: "Active guest",
    });
    const activeConnection = await connectArcadeSocket(
      processOne.baseUrl,
      String(activeHost.code),
      String(activeHost.reconnectToken),
    );
    sockets.push(activeConnection.socket);
    assert.equal((activeConnection.firstMessage.room as JsonRecord).status, "playing");

    const staleRoom = await postRoom(processOne.baseUrl, "rooms", {
      game: "mopyon",
      displayName: "Stale host",
      playerCount: 2,
      isPrivate: true,
    });
    const staleTimestamp = new Date(Date.now() - ARCADE_ROOM_RETENTION_MS - 10_000);
    await pool.query(
      `UPDATE ${quotedSchema}.arcade_rooms SET updated_at = $2 WHERE code = ANY($1::text[])`,
      [[activeHost.code, staleRoom.code], staleTimestamp],
    );

    const failedMaintenance = await fetch(
      `${processOne.baseUrl}/__test/maintain-rooms?failAfterRefresh=true`,
      { method: "POST" },
    );
    assert.equal(failedMaintenance.status, 500);
    const health = await fetch(`${processOne.baseUrl}/healthz`);
    assert.equal(health.status, 200, "the API should remain usable after the maintenance failure");

    const rolledBackActive = await pool.query(
      `SELECT updated_at FROM ${quotedSchema}.arcade_rooms WHERE code = $1`,
      [activeHost.code],
    );
    assert.equal(new Date(rolledBackActive.rows[0].updated_at).getTime(), staleTimestamp.getTime());
    assert.equal((await fetch(`${processOne.baseUrl}/api/arcade/rooms/${String(staleRoom.code)}`)).status, 200);

    const socketClosed = once(activeConnection.socket, "close");
    activeConnection.socket.close();
    await socketClosed;
    const successfulMaintenance = await fetch(
      `${processOne.baseUrl}/__test/maintain-rooms`,
      { method: "POST" },
    );
    assert.equal(successfulMaintenance.status, 200);
    assert.equal((await fetch(`${processOne.baseUrl}/api/arcade/rooms/${String(staleRoom.code)}`)).status, 404);
    assert.equal((await fetch(`${processOne.baseUrl}/api/arcade/rooms/${String(activeHost.code)}`)).status, 404);
  } finally {
    sockets.forEach((socket) => socket.close());
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
    const readListenerHealth = async () => {
      const response = await fetch(`${processTwo!.baseUrl}/__test/arcade-notification-health`);
      assert.equal(response.status, 200);
      return await response.json() as {
        status: string;
        retryScheduled: boolean;
        retryPaused: boolean;
        retryCount: number;
        nextRetryAt: number | null;
        lastConnectedAt: number | null;
        lastDisconnectedAt: number | null;
      };
    };
    const healthyListener = await readListenerHealth();
    assert.equal(healthyListener.status, "connected");
    assert.equal(healthyListener.retryScheduled, false);
    assert.ok(healthyListener.lastConnectedAt);
    assert.deepEqual(Object.keys(healthyListener).sort(), [
      "lastConnectedAt",
      "lastDisconnectedAt",
      "nextRetryAt",
      "retryCount",
      "retryPaused",
      "retryScheduled",
      "status",
    ]);

    const disconnected = await fetch(`${processTwo.baseUrl}/__test/disconnect-notification-listener`, {
      method: "POST",
    });
    assert.equal(disconnected.status, 200);
    assert.deepEqual(await disconnected.json(), { disconnected: true });
    const retryingListener = await readListenerHealth();
    assert.equal(retryingListener.status, "retrying");
    assert.equal(retryingListener.retryScheduled, true);
    assert.equal(retryingListener.retryCount, 1);
    assert.ok(retryingListener.nextRetryAt);
    assert.ok(retryingListener.lastDisconnectedAt);

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
    const retryDeadline = Date.now() + 5_000;
    let recoveredListener = await readListenerHealth();
    while (recoveredListener.status !== "connected" && Date.now() < retryDeadline) {
      await delay(50);
      recoveredListener = await readListenerHealth();
    }
    assert.equal(recoveredListener.status, "connected");
    assert.equal(recoveredListener.retryScheduled, false);
    assert.equal(recoveredListener.retryCount, 0);
    assert.equal(recoveredListener.nextRetryAt, null);
    assert.ok(recoveredListener.lastDisconnectedAt);
  } finally {
    sockets.forEach((socket) => socket.close());
    if (processTwo) await stopArcadeProcess(processTwo.child);
    if (processOne) await stopArcadeProcess(processOne.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});

test("health reports an initial notification connection failure without exposing its details", {
  timeout: 20_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for arcade listener startup health tests.");

  const schema = `arcade_listener_startup_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  let server: Awaited<ReturnType<typeof startArcadeProcess>> | undefined;
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
    server = await startArcadeProcess(isolatedDatabaseUrl.toString(), {
      failInitialListenerConnection: true,
      listenerRetryDelayMs: 3_000,
    });

    const readHealth = async () => {
      const response = await fetch(`${server!.baseUrl}/healthz`);
      assert.equal(response.status, 200);
      return await response.json() as {
        status: string;
        arcadeRoomUpdates: {
          status: string;
          retryScheduled: boolean;
          retryCount: number;
          nextRetryAt: number | null;
          lastConnectedAt: number | null;
          lastDisconnectedAt: number | null;
        };
      };
    };

    const initialHealth = await readHealth();
    assert.equal(initialHealth.status, "ok");
    assert.equal(initialHealth.arcadeRoomUpdates.status, "retrying");
    assert.equal(initialHealth.arcadeRoomUpdates.retryScheduled, true);
    assert.equal(initialHealth.arcadeRoomUpdates.retryCount, 1);
    assert.ok(initialHealth.arcadeRoomUpdates.nextRetryAt);
    assert.ok(initialHealth.arcadeRoomUpdates.lastDisconnectedAt);
    assert.equal(initialHealth.arcadeRoomUpdates.lastConnectedAt, null);
    assert.doesNotMatch(JSON.stringify(initialHealth), /privacy sentinel|connection failure/i);

    const connectedDeadline = Date.now() + 10_000;
    let recoveredHealth = initialHealth;
    while (recoveredHealth.arcadeRoomUpdates.status !== "connected" && Date.now() < connectedDeadline) {
      await delay(50);
      recoveredHealth = await readHealth();
    }
    assert.equal(recoveredHealth.arcadeRoomUpdates.status, "connected");
    assert.equal(recoveredHealth.arcadeRoomUpdates.retryScheduled, false);
    assert.equal(recoveredHealth.arcadeRoomUpdates.retryCount, 0);
    assert.equal(recoveredHealth.arcadeRoomUpdates.nextRetryAt, null);
    assert.ok(recoveredHealth.arcadeRoomUpdates.lastConnectedAt);
    assert.ok(recoveredHealth.arcadeRoomUpdates.lastDisconnectedAt);
    assert.doesNotMatch(JSON.stringify(recoveredHealth), /privacy sentinel|connection failure/i);
  } finally {
    if (server) await stopArcadeProcess(server.child);
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
