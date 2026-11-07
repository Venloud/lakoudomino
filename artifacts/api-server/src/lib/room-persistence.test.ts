import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { pool } from "@workspace/db";
import { createMatch } from "lakou-engine";
import type { PersistedRoomState } from "./room-types.ts";

const apiServerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const resultPrefix = "ROOM_PERSISTENCE_RESULT=";

async function roundTripThroughDatabaseAdapter(
  databaseUrl: string,
  room: PersistedRoomState,
): Promise<{ row: Record<string, unknown>; restored: PersistedRoomState }> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/lib/room-persistence-test-process.ts"],
    {
      cwd: apiServerDirectory,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        ROOM_PERSISTENCE_FIXTURE: JSON.stringify(room),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
  const [exitCode, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  clearTimeout(timeout);
  assert.equal(exitCode, 0, `database adapter process failed (${signal ?? "no signal"}):\n${output}`);
  const resultLine = output.split("\n").find((line) => line.startsWith(resultPrefix));
  assert.ok(resultLine, `database adapter returned no result:\n${output}`);
  return JSON.parse(resultLine.slice(resultPrefix.length)) as {
    row: Record<string, unknown>;
    restored: PersistedRoomState;
  };
}

test("room persistence adapter round-trips against the provisioned table shape", {
  timeout: 60_000,
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for room persistence integration tests.");

  const schema = `room_adapter_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schema}"`;
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  try {
    const provisionedTable = await pool.query(
      "SELECT to_regclass('public.domino_rooms') AS table_name",
    );
    assert.equal(provisionedTable.rows[0]?.table_name, "domino_rooms", "the provisioned room table must exist");
    await pool.query(
      `CREATE TABLE ${quotedSchema}.domino_rooms (LIKE public.domino_rooms INCLUDING ALL)`,
    );
    await pool.query(
      `ALTER TABLE ${quotedSchema}.domino_rooms ADD COLUMN IF NOT EXISTS chat_history jsonb NOT NULL DEFAULT '[]'`,
    );

    const engineState = createMatch({
      mode: "regular",
      playerCount: 2,
      rowBoxes: 10,
      twoPlayerVariant: "draw",
      seed: 217,
    }).match;
    const room: PersistedRoomState = {
      code: `DB${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
      hostName: "Schema check host",
      mode: "regular",
      rowLength: 10,
      playerCount: 2,
      rowBoxes: 10,
      twoPlayerVariant: "draw",
      turnSeconds: 45,
      isPrivate: true,
      speed: 1.5,
      playNow: true,
      afkState: { timeouts: [1, 2] },
      seed: 217,
      status: "playing",
      seats: [0, 1, 2, 3].map((seat) => ({
        seat: seat as 0 | 1 | 2 | 3,
        status: seat < 2 ? "waiting" : "open",
        name: seat === 0 ? "Schema check host" : seat === 1 ? "Schema check guest" : null,
        reconnectTokenHash: seat < 2 ? `hash-${seat}` : null,
        userId: null,
      })),
      lastAction: null,
      engineState,
      waitlist: [{ id: "waitlist-hash", name: "Waiting player", notify: true, userId: null }],
      offers: [{ seat: 2, playerId: "offer-hash", expiresAt: 1_800_000_000_000, name: "Offered player" }],
      activeMatchId: null,
      statsRecorded: false,
      matchParticipants: [{ seat: 0, userId: null }, { seat: 1, userId: "guest-2" }],
      lifecycleApplied: false,
      crownsEligible: true,
      hostDisconnectedAt: null,
      chatHistory: [
        { id: "chat-1", seat: 0, name: "Schema check host", text: "Good hand", sentAt: "2026-11-07T00:00:00.000Z" },
      ],
    };
    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);

    const { row, restored } = await roundTripThroughDatabaseAdapter(isolatedDatabaseUrl.toString(), room);
    assert.deepEqual(row.seats, room.seats);
    assert.deepEqual(row.engineState, room.engineState);
    assert.deepEqual(row.waitlist, room.waitlist);
    assert.deepEqual(row.offers, room.offers);
    assert.deepEqual(row.matchParticipants, room.matchParticipants);
    assert.equal(row.speed, room.speed);
    assert.equal(row.playNow, room.playNow);
    assert.deepEqual(row.afkState, room.afkState);
    assert.equal(row.lifecycleApplied, room.lifecycleApplied);
    assert.equal(row.crownsEligible, room.crownsEligible);
    assert.equal(row.lastAction, null);
    assert.equal(row.activeMatchId, null);
    assert.equal(row.hostDisconnectedAt, null);
    assert.deepEqual(row.chatHistory, room.chatHistory);
    assert.equal(row.quarantinedAt, null);
    assert.equal(row.quarantineIssues, null);

    assert.deepEqual(restored.seats, room.seats);
    assert.deepEqual(restored.engineState, room.engineState);
    assert.deepEqual(restored.waitlist, room.waitlist);
    assert.deepEqual(restored.offers, room.offers);
    assert.deepEqual(restored.matchParticipants, room.matchParticipants);
    assert.equal(restored.speed, room.speed);
    assert.equal(restored.playNow, room.playNow);
    assert.deepEqual(restored.afkState, room.afkState);
    assert.equal(restored.lifecycleApplied, room.lifecycleApplied);
    assert.equal(restored.crownsEligible, room.crownsEligible);
    assert.equal(restored.lastAction, null);
    assert.equal(restored.activeMatchId, null);
    assert.equal(restored.hostDisconnectedAt, null);
    assert.deepEqual(restored.chatHistory, room.chatHistory);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  }
});
