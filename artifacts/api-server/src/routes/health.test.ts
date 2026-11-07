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
  type QuarantinedRoomRetryResult,
} from "../lib/room-persistence.ts";
import { sendRoomRecoveryNotification } from "../lib/logger.ts";
import healthRouter, { createRoomRetryHandler } from "./health.ts";

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

test("health reports configured and failed recovery-alert delivery without private details", async () => {
  const previousWebhookUrl = process.env.ROOM_RECOVERY_ALERT_WEBHOOK_URL;
  delete process.env.ROOM_RECOVERY_ALERT_WEBHOOK_URL;
  const app = express();
  app.use(healthRouter);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let requests = 0;

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    assert.equal(await sendRoomRecoveryNotification({
      event: "persisted_room_recovery_skipped",
      skippedRoomCount: 0,
      issueCounts: [],
    }), false);
    const unconfiguredResponse = await fetch(`${baseUrl}/healthz`);
    const unconfiguredBody = await unconfiguredResponse.json() as {
      roomRecoveryAlert: { configured: boolean; deliveryState: string };
    };
    assert.deepEqual(unconfiguredBody.roomRecoveryAlert, {
      configured: false,
      deliveryState: "not-configured",
      lastAttemptAt: null,
      attempts: 0,
    });

    process.env.ROOM_RECOVERY_ALERT_WEBHOOK_URL = "https://alerts.example.test/hooks/PRIVATE-ROOM-CODE-RECONNECT-CREDENTIAL";
    const configuredResponse = await fetch(`${baseUrl}/healthz`);
    const configuredBody = await configuredResponse.json() as {
      roomRecoveryAlert: {
        configured: boolean;
        deliveryState: string;
        lastAttemptAt: string | null;
        attempts: number;
      };
    };
    assert.deepEqual(configuredBody.roomRecoveryAlert, {
      configured: true,
      deliveryState: "idle",
      lastAttemptAt: null,
      attempts: 0,
    });

    assert.equal(await sendRoomRecoveryNotification({
      event: "persisted_room_recovery_skipped",
      skippedRoomCount: 1,
      issueCounts: [{ fieldPath: "seats", occurrenceCount: 1 }],
    }, {
      fetchImpl: async () => {
        requests += 1;
        return new Response(null, { status: 503 });
      },
      sleepImpl: async () => {},
    }), false);
    assert.equal(requests, 3);

    const failedResponse = await fetch(`${baseUrl}/healthz`);
    const failedBody = await failedResponse.json() as {
      roomRecoveryAlert: {
        configured: boolean;
        deliveryState: string;
        lastAttemptAt: string | null;
        attempts: number;
      };
    };
    assert.deepEqual(failedBody.roomRecoveryAlert, {
      configured: true,
      deliveryState: "failed",
      lastAttemptAt: failedBody.roomRecoveryAlert.lastAttemptAt,
      attempts: 3,
    });
    assert.ok(failedBody.roomRecoveryAlert.lastAttemptAt);
    const serialized = JSON.stringify(failedBody.roomRecoveryAlert);
    assert.equal(serialized.includes("RECONNECT-CREDENTIAL"), false);
    assert.equal(serialized.includes("PRIVATE-ROOM-CODE"), false);
    assert.equal(serialized.includes("Persisted rooms skipped"), false);
    assert.deepEqual(Object.keys(failedBody.roomRecoveryAlert).sort(), [
      "attempts",
      "configured",
      "deliveryState",
      "lastAttemptAt",
    ]);
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
    if (previousWebhookUrl === undefined) delete process.env.ROOM_RECOVERY_ALERT_WEBHOOK_URL;
    else process.env.ROOM_RECOVERY_ALERT_WEBHOOK_URL = previousWebhookUrl;
  }
});

test("room retry requires the configured operator token and does not expose stored room data", async () => {
  const rawSentinel = "PRIVATE-ROOM-CODE RECONNECT-HASH-SENTINEL";
  let retryCalls = 0;
  let activatedRoom: unknown;
  const auditEvents: Array<{ result: string; issuePaths?: string[] }> = [];
  const validRoom = {
    code: "PRIVATE-ROOM-CODE",
    hostName: "Stored host",
    mode: "regular",
    rowLength: 10,
    status: "waiting",
    seats: [{
      seat: 0,
      status: "waiting",
      name: "Stored host",
      reconnectTokenHash: "RECONNECT-HASH-SENTINEL",
    }],
    lastAction: null,
    engineState: null,
    waitlist: [],
    offers: [],
  };
  const retryHandler = createRoomRetryHandler({
    getOperatorToken: () => "operator-token-secret",
    async retryRoom() {
      retryCalls++;
      return { status: "restored", room: validRoom } as QuarantinedRoomRetryResult;
    },
    async activateRoom(room) {
      activatedRoom = room;
      return true;
    },
    audit(result, issuePaths) {
      auditEvents.push({ result, issuePaths });
    },
  });
  const app = express();
  app.post("/ops/rooms/:code/retry", retryHandler);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}/ops/rooms/PRIVATE-ROOM-CODE/retry`;
    const denied = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });
    assert.equal(denied.status, 401);
    assert.equal(retryCalls, 0);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: "Bearer operator-token-secret" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "restored" });
    assert.deepEqual(activatedRoom, validRoom);
    assert.equal(retryCalls, 1);
    assert.deepEqual(auditEvents, [{ result: "restored", issuePaths: undefined }]);
    assert.equal(JSON.stringify(auditEvents).includes(rawSentinel), false);
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
  }
});

test("room retry reports only allowlisted validation paths for invalid saved data", async () => {
  const auditEvents: Array<{ result: string; issuePaths?: string[] }> = [];
  const retryHandler = createRoomRetryHandler({
    getOperatorToken: () => "operator-token-secret",
    async retryRoom() {
      return { status: "invalid", issuePaths: ["mode", "unknown"] };
    },
    async activateRoom() {
      assert.fail("invalid saved data must not be activated");
    },
    audit(result, issuePaths) {
      auditEvents.push({ result, issuePaths });
    },
  });
  const app = express();
  app.post("/ops/rooms/:code/retry", retryHandler);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/ops/rooms/ROOM123/retry`, {
      method: "POST",
      headers: { authorization: "Bearer operator-token-secret" },
    });
    assert.equal(response.status, 422);
    const body = await response.text();
    assert.equal(body.includes("operator-token-secret"), false);
    assert.deepEqual(JSON.parse(body), {
      error: "Saved room data is still invalid",
      issuePaths: ["mode", "unknown"],
    });
    assert.deepEqual(auditEvents, [{ result: "invalid", issuePaths: ["mode", "unknown"] }]);
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
  }
});
