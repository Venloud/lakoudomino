import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import {
  createRoomRecoveryAlertPayload,
  getRoomRecoveryDiagnostics,
  loadPersistedRooms,
  type RoomRecoveryDiagnostics,
  type PersistedRoomStore,
} from "../lib/room-persistence.ts";
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
      arcadeRoomUpdates: {
        status: string;
        retryScheduled: boolean;
        retryPaused: boolean;
        retryCount: number;
        nextRetryAt: number | null;
        lastConnectedAt: number | null;
        lastDisconnectedAt: number | null;
      };
    };

    assert.equal(body.status, "ok");
    assert.ok(body.roomRecovery.checkedAt);
    assert.equal(body.roomRecovery.skippedRoomCount, 2);
    assert.deepEqual(body.roomRecovery.issueCounts, [
      { fieldPath: "mode", occurrenceCount: 2 },
      { fieldPath: "seats", occurrenceCount: 2 },
    ]);
    assert.equal(body.arcadeRoomUpdates.status, "not-started");
    assert.equal(body.arcadeRoomUpdates.retryScheduled, false);
    assert.equal(body.arcadeRoomUpdates.retryCount, 0);
    assert.deepEqual(Object.keys(body.arcadeRoomUpdates).sort(), [
      "lastConnectedAt",
      "lastDisconnectedAt",
      "nextRetryAt",
      "retryCount",
      "retryPaused",
      "retryScheduled",
      "status",
    ]);
    assert.deepEqual(createRoomRecoveryAlertPayload(getRoomRecoveryDiagnostics()), {
      event: "persisted_room_recovery_skipped",
      skippedRoomCount: 2,
      issueCounts: [
        { fieldPath: "mode", occurrenceCount: 2 },
        { fieldPath: "seats", occurrenceCount: 2 },
      ],
    });
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

test("recovery alert is absent for zero skips and only contains aggregate safe paths", () => {
  const emptyDiagnostics: RoomRecoveryDiagnostics = {
    checkedAt: null,
    skippedRoomCount: 0,
    issueCounts: [],
  };
  assert.equal(createRoomRecoveryAlertPayload(emptyDiagnostics), null);

  const alert = createRoomRecoveryAlertPayload({
    checkedAt: "2026-11-05T00:00:00.000Z",
    skippedRoomCount: 1,
    issueCounts: [
      { fieldPath: "mode", occurrenceCount: 1 },
      { fieldPath: "RECONNECT-HASH-SENTINEL", occurrenceCount: 1 },
    ],
  });
  assert.deepEqual(alert, {
    event: "persisted_room_recovery_skipped",
    skippedRoomCount: 1,
    issueCounts: [
      { fieldPath: "mode", occurrenceCount: 1 },
      { fieldPath: "unknown", occurrenceCount: 1 },
    ],
  });
  assert.equal(JSON.stringify(alert).includes("RECONNECT-HASH-SENTINEL"), false);
});
