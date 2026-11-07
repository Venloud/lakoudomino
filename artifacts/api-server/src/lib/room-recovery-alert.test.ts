import assert from "node:assert/strict";
import test from "node:test";
import {
  logger,
  sendRoomRecoveryNotification,
  type RoomRecoveryNotification,
} from "./logger.ts";

const notification: RoomRecoveryNotification = {
  event: "persisted_room_recovery_skipped",
  skippedRoomCount: 2,
  issueCounts: [
    { fieldPath: "mode", occurrenceCount: 1 },
    { fieldPath: "seats", occurrenceCount: 1 },
  ],
};

test("recovery notification posts only the safe aggregate summary to an HTTPS webhook", async () => {
  let requestedUrl: URL | undefined;
  let requestInit: RequestInit | undefined;
  const delivered = await sendRoomRecoveryNotification(notification, {
    webhookUrl: "https://alerts.example.test/hooks/on-call",
    fetchImpl: async (input, init) => {
      requestedUrl = input instanceof URL
        ? input
        : typeof input === "string"
          ? new URL(input)
          : new URL(input.url);
      requestInit = init;
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(delivered, true);
  assert.equal(requestedUrl?.href, "https://alerts.example.test/hooks/on-call");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.redirect, "error");
  assert.equal((requestInit?.headers as Record<string, string>)["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    text: "Persisted rooms skipped during recovery: 2. Issue paths: mode: 1, seats: 1.",
    ...notification,
  });
});

test("missing or non-HTTPS recovery destinations are not contacted", async () => {
  let requests = 0;
  const fetchImpl: typeof fetch = async () => {
    requests += 1;
    return new Response(null, { status: 204 });
  };

  assert.equal(await sendRoomRecoveryNotification(notification, { webhookUrl: "", fetchImpl }), false);
  assert.equal(await sendRoomRecoveryNotification(notification, {
    webhookUrl: "http://alerts.example.test/hooks/on-call",
    fetchImpl,
  }), false);
  assert.equal(requests, 0);
});

test("recovery notification delivery failures are contained", async () => {
  const rejectedResponse = await sendRoomRecoveryNotification(notification, {
    webhookUrl: "https://alerts.example.test/hooks/on-call",
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  const rejectedRequest = await sendRoomRecoveryNotification(notification, {
    webhookUrl: "https://alerts.example.test/hooks/on-call",
    fetchImpl: async () => {
      throw new Error("PRIVATE-ROOM-CODE RECONNECT-CREDENTIAL persisted raw data");
    },
  });

  assert.equal(rejectedResponse, false);
  assert.equal(rejectedRequest, false);
});

test("transient recovery alert failures retry with bounded backoff and can succeed", async () => {
  let requests = 0;
  const delays: number[] = [];
  const delivered = await sendRoomRecoveryNotification(notification, {
    webhookUrl: "https://alerts.example.test/hooks/on-call",
    fetchImpl: async () => {
      requests += 1;
      return new Response(null, { status: requests === 1 ? 503 : 204 });
    },
    sleepImpl: async (milliseconds) => { delays.push(milliseconds); },
  });

  assert.equal(delivered, true);
  assert.equal(requests, 2);
  assert.deepEqual(delays, [150]);
});

test("permanent and exhausted recovery alert failures stop after bounded attempts and log no secrets", async () => {
  const logCalls: unknown[][] = [];
  const mutableLogger = logger as unknown as { error: (...args: unknown[]) => void };
  const originalError = mutableLogger.error;
  mutableLogger.error = (...args) => { logCalls.push(args); };

  try {
    let permanentRequests = 0;
    const permanentDelays: number[] = [];
    assert.equal(await sendRoomRecoveryNotification(notification, {
      webhookUrl: "https://alerts.example.test/hooks/on-call",
      fetchImpl: async () => {
        permanentRequests += 1;
        return new Response(null, { status: 400 });
      },
      sleepImpl: async (milliseconds) => { permanentDelays.push(milliseconds); },
    }), false);

    let transientRequests = 0;
    const transientDelays: number[] = [];
    assert.equal(await sendRoomRecoveryNotification(notification, {
      webhookUrl: "https://alerts.example.test/hooks/RECONNECT-CREDENTIAL",
      fetchImpl: async () => {
        transientRequests += 1;
        throw new TypeError("PRIVATE-ROOM-CODE RECONNECT-CREDENTIAL raw persisted value");
      },
      sleepImpl: async (milliseconds) => { transientDelays.push(milliseconds); },
    }), false);

    assert.equal(permanentRequests, 1, "permanent HTTP failures must not retry");
    assert.deepEqual(permanentDelays, []);
    assert.equal(transientRequests, 3, "transient failures must stop after the configured attempt limit");
    assert.deepEqual(transientDelays, [150, 450]);
  } finally {
    mutableLogger.error = originalError;
  }

  assert.equal(logCalls.length, 2);
  const logOutput = JSON.stringify(logCalls);
  assert.doesNotMatch(logOutput, /PRIVATE-ROOM-CODE|RECONNECT-CREDENTIAL|raw persisted value/);
  assert.match(logOutput, /"attempts":1/);
  assert.match(logOutput, /"attempts":3/);
  assert.match(logOutput, /"statusCode":400/);
});
