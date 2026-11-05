import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { pool } from "@workspace/db";
import { autoStep, createMatch } from "lakou-engine";
import { serializeRoom } from "../lib/room-persistence-codec.ts";
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

async function insertRoom(schema: string, room: PersistedRoomState): Promise<void> {
  const stored = serializeRoom(room);
  await pool.query(
    `INSERT INTO "${schema}".domino_rooms
      (code, host_name, mode, row_length, player_count, row_boxes, two_player_variant,
       turn_seconds, is_private, seed, status, seats, last_action, engine_state,
       waitlist, offers, active_match_id, stats_recorded, match_participants,
       host_disconnected_at, quarantined_at, quarantine_issues)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb,
       $15::jsonb, $16::jsonb, $17, $18, $19::jsonb, $20, NULL, NULL)`,
    [
      stored.code, stored.hostName, stored.mode, stored.rowLength, stored.playerCount,
      stored.rowBoxes, stored.twoPlayerVariant, stored.turnSeconds, stored.isPrivate,
      stored.seed, stored.status, JSON.stringify(stored.seats), stored.lastAction,
      JSON.stringify(stored.engineState), JSON.stringify(stored.waitlist),
      JSON.stringify(stored.offers), stored.activeMatchId, stored.statsRecorded,
      JSON.stringify(stored.matchParticipants), stored.hostDisconnectedAt,
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
    await pool.query(`
      CREATE TABLE ${quotedSchema}.domino_rooms (
        code text PRIMARY KEY,
        host_name text NOT NULL,
        mode text NOT NULL,
        row_length integer NOT NULL,
        player_count integer NOT NULL DEFAULT 4,
        row_boxes integer NOT NULL DEFAULT 10,
        two_player_variant text NOT NULL DEFAULT 'draw',
        turn_seconds integer NOT NULL DEFAULT 30,
        is_private boolean NOT NULL DEFAULT false,
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
        host_disconnected_at bigint,
        quarantined_at timestamptz,
        quarantine_issues jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

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
