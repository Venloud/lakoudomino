import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

export type RoomRecoveryNotification = {
  event: "persisted_room_recovery_skipped";
  skippedRoomCount: number;
  issueCounts: Array<{ fieldPath: string; occurrenceCount: number }>;
};

export type RoomRecoveryAlertHealth = {
  configured: boolean;
  deliveryState: "not-configured" | "idle" | "sending" | "delivered" | "failed";
  lastAttemptAt: string | null;
  attempts: number;
};

type RoomRecoveryNotificationOptions = {
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number) => Promise<void>;
};

const RECOVERY_ALERT_RETRY_DELAYS_MS = [150, 450] as const;
let lastRecoveryAlertState: RoomRecoveryAlertHealth = {
  configured: false,
  deliveryState: "not-configured",
  lastAttemptAt: null,
  attempts: 0,
};

export function getRoomRecoveryAlertHealth(): RoomRecoveryAlertHealth {
  const configured = Boolean(process.env.ROOM_RECOVERY_ALERT_WEBHOOK_URL?.trim());
  const deliveryState = lastRecoveryAlertState.deliveryState === "not-configured" && configured
    ? "idle"
    : lastRecoveryAlertState.deliveryState;
  return {
    ...lastRecoveryAlertState,
    configured,
    deliveryState,
  };
}

function updateRecoveryAlertHealth(
  state: RoomRecoveryAlertHealth["deliveryState"],
  attempts: number,
  configured: boolean,
  lastAttemptAt = lastRecoveryAlertState.lastAttemptAt,
): void {
  lastRecoveryAlertState = { configured, deliveryState: state, attempts, lastAttemptAt };
}

function isRetryableResponse(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableRequestError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
}

export async function sendRoomRecoveryNotification(
  notification: RoomRecoveryNotification,
  options: RoomRecoveryNotificationOptions = {},
): Promise<boolean> {
  const webhookUrl = options.webhookUrl ?? process.env.ROOM_RECOVERY_ALERT_WEBHOOK_URL;
  if (!webhookUrl?.trim()) {
    updateRecoveryAlertHealth("not-configured", 0, false, null);
    return false;
  }
  const lastAttemptAt = new Date().toISOString();
  updateRecoveryAlertHealth("sending", 0, true, lastAttemptAt);

  const logFailure = (fields: Record<string, unknown>) => logger.error(
    { event: "persisted_room_recovery_alert_delivery_failed", ...fields },
    "Could not deliver persisted room recovery alert",
  );

  let destination: URL;
  try {
    destination = new URL(webhookUrl);
    if (destination.protocol !== "https:" || destination.username || destination.password) {
      updateRecoveryAlertHealth("failed", 0, true, lastAttemptAt);
      logFailure({ attempts: 0, failureType: "invalid_destination" });
      return false;
    }
  } catch {
    updateRecoveryAlertHealth("failed", 0, true, lastAttemptAt);
    logFailure({ attempts: 0, failureType: "invalid_destination" });
    return false;
  }

  const issueSummary = notification.issueCounts
    .map(({ fieldPath, occurrenceCount }) => `${fieldPath}: ${occurrenceCount}`)
    .join(", ");
  const message = [
    `Persisted rooms skipped during recovery: ${notification.skippedRoomCount}.`,
    issueSummary ? `Issue paths: ${issueSummary}.` : "",
  ].filter(Boolean).join(" ");
  const sleep = options.sleepImpl ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const totalAttempts = RECOVERY_ALERT_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    updateRecoveryAlertHealth("sending", attempt + 1, true, lastAttemptAt);
    let retry = false;
    try {
      const response = await (options.fetchImpl ?? fetch)(destination, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: message, ...notification }),
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      });
      if (response.ok) {
        updateRecoveryAlertHealth("delivered", attempt + 1, true, lastAttemptAt);
        return true;
      }
      if (isRetryableResponse(response.status) && attempt < RECOVERY_ALERT_RETRY_DELAYS_MS.length) {
        retry = true;
      } else {
        updateRecoveryAlertHealth("failed", attempt + 1, true, lastAttemptAt);
        logFailure({
          attempts: attempt + 1,
          failureType: "http",
          statusCode: response.status,
        });
        return false;
      }
    } catch (error) {
      if (isRetryableRequestError(error) && attempt < RECOVERY_ALERT_RETRY_DELAYS_MS.length) {
        retry = true;
      } else {
        updateRecoveryAlertHealth("failed", attempt + 1, true, lastAttemptAt);
        logFailure({
          attempts: attempt + 1,
          failureType: isRetryableRequestError(error) ? "transport_exhausted" : "request",
        });
        return false;
      }
    }

    if (retry) await sleep(RECOVERY_ALERT_RETRY_DELAYS_MS[attempt]);
  }

  logFailure({ attempts: totalAttempts, failureType: "transport_exhausted" });
  return false;
}
