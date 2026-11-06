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

type RoomRecoveryNotificationOptions = {
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function sendRoomRecoveryNotification(
  notification: RoomRecoveryNotification,
  options: RoomRecoveryNotificationOptions = {},
): Promise<boolean> {
  const webhookUrl = options.webhookUrl ?? process.env.ROOM_RECOVERY_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return false;

  try {
    const destination = new URL(webhookUrl);
    if (destination.protocol !== "https:" || destination.username || destination.password) {
      throw new Error("Invalid notification destination");
    }

    const issueSummary = notification.issueCounts
      .map(({ fieldPath, occurrenceCount }) => `${fieldPath}: ${occurrenceCount}`)
      .join(", ");
    const message = [
      `Persisted rooms skipped during recovery: ${notification.skippedRoomCount}.`,
      issueSummary ? `Issue paths: ${issueSummary}.` : "",
    ].filter(Boolean).join(" ");
    const response = await (options.fetchImpl ?? fetch)(destination, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message, ...notification }),
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Notification request failed");
    return true;
  } catch {
    logger.error(
      { event: "persisted_room_recovery_alert_delivery_failed" },
      "Could not deliver persisted room recovery alert",
    );
    return false;
  }
}
