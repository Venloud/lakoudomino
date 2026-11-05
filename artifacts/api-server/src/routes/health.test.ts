import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { loadPersistedRooms, type PersistedRoomStore } from "../lib/room-persistence.ts";
import healthRouter from "./health.ts";

test("health exposes skipped-room counts and field paths without identifiers or credentials", async () => {
  const store: PersistedRoomStore = {
    async loadActiveRooms() {
      return [
        {
          code: "PRIVATE-ROOM-CODE",
          hostName: "Player",
          mode: "invalid",
          rowLength: 10,
          status: "playing",
          seats: [],
          reconnectTokenHash: "RECONNECT-HASH-SENTINEL",
        },
        {
          code: "ANOTHER-PRIVATE-CODE",
          hostName: "Player",
          mode: "invalid",
          rowLength: 10,
          status: "playing",
          seats: [],
        },
      ];
    },
    async quarantineRoom() {},
  };
  assert.deepEqual(await loadPersistedRooms(store), []);

  const app = express();
  app.use(healthRouter);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      status: string;
      roomRecovery: {
        checkedAt: string | null;
        skippedRoomCount: number;
        issueCounts: Array<{ fieldPath: string; occurrenceCount: number }>;
      };
    };

    assert.equal(body.status, "ok");
    assert.ok(body.roomRecovery.checkedAt);
    assert.equal(body.roomRecovery.skippedRoomCount, 2);
    assert.deepEqual(body.roomRecovery.issueCounts, [
      { fieldPath: "mode", occurrenceCount: 2 },
      { fieldPath: "seats", occurrenceCount: 2 },
    ]);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("PRIVATE-ROOM-CODE"), false);
    assert.equal(serialized.includes("ANOTHER-PRIVATE-CODE"), false);
    assert.equal(serialized.includes("RECONNECT-HASH-SENTINEL"), false);
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
  }
});
