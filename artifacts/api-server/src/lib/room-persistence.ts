import { db, dominoRooms } from "@workspace/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { logger, sendRoomRecoveryNotification } from "./logger.ts";
import type { PersistedRoomState } from "./room-types.ts";
import {
  PersistedRoomRecoveryError,
  type PersistedRoomIssue,
  restoreRoom,
  restoreRooms,
  serializeRoom,
  type StoredRoomRecord,
} from "./room-persistence-codec.ts";

export type { PersistedRoomState, PersistedSeatState } from "./room-types";
export { restoreRoom, serializeRoom };
export type { StoredRoomRecord };
export { PersistedRoomRecoveryError };

const pendingWrites = new Map<string, Promise<void>>();

export type PersistedRoomQuarantine = {
  roomCode: string;
  issues: PersistedRoomIssue[];
  quarantinedAt: Date;
};

export type PersistedRoomStore = {
  loadActiveRooms: () => Promise<readonly unknown[]>;
  quarantineRoom: (quarantine: PersistedRoomQuarantine) => Promise<void>;
};

export type QuarantinedRoomRetryResult =
  | { status: "restored"; room: PersistedRoomState }
  | { status: "not_found" }
  | { status: "invalid"; issuePaths: string[] };

export const ROOM_RETRY_NOTIFICATION_CHANNEL = "domino_room_retry";

export type RoomRecoveryDiagnostics = {
  checkedAt: string | null;
  skippedRoomCount: number;
  issueCounts: Array<{ fieldPath: string; occurrenceCount: number }>;
};

export type RoomRecoveryAlertPayload = {
  event: "persisted_room_recovery_skipped";
  skippedRoomCount: number;
  issueCounts: Array<{ fieldPath: string; occurrenceCount: number }>;
};

const safeIssuePaths = new Set([
  "code",
  "hostName",
  "mode",
  "rowLength",
  "status",
  "seats",
  "speed",
  "afkState",
  "engineState",
]);

function getSafeIssuePaths(issues: readonly PersistedRoomIssue[]): string[] {
  return [...new Set(issues.map(({ path }) => safeIssuePaths.has(path) ? path : "unknown"))]
    .sort((left, right) => left.localeCompare(right));
}

let roomRecoveryDiagnostics: RoomRecoveryDiagnostics = {
  checkedAt: null,
  skippedRoomCount: 0,
  issueCounts: [],
};

export function getRoomRecoveryDiagnostics(): RoomRecoveryDiagnostics {
  return {
    ...roomRecoveryDiagnostics,
    issueCounts: roomRecoveryDiagnostics.issueCounts.map((issue) => ({ ...issue })),
  };
}

export function createRoomRecoveryAlertPayload(
  diagnostics: RoomRecoveryDiagnostics,
): RoomRecoveryAlertPayload | null {
  if (diagnostics.skippedRoomCount <= 0) return null;

  return {
    event: "persisted_room_recovery_skipped",
    skippedRoomCount: diagnostics.skippedRoomCount,
    issueCounts: diagnostics.issueCounts.map(({ fieldPath, occurrenceCount }) => ({
      fieldPath: safeIssuePaths.has(fieldPath) ? fieldPath : "unknown",
      occurrenceCount,
    })),
  };
}

function alertOnSkippedRooms(): void {
  const payload = createRoomRecoveryAlertPayload(getRoomRecoveryDiagnostics());
  if (payload) {
    logger.error(payload, "Persisted rooms skipped during recovery");
    void sendRoomRecoveryNotification(payload);
  }
}

function recordRoomRecoveryDiagnostics(errors: readonly PersistedRoomRecoveryError[]): void {
  const issueCounts = new Map<string, number>();
  for (const error of errors) {
    for (const issue of error.issues) {
      const fieldPath = safeIssuePaths.has(issue.path) ? issue.path : "unknown";
      issueCounts.set(fieldPath, (issueCounts.get(fieldPath) ?? 0) + 1);
    }
  }

  roomRecoveryDiagnostics = {
    checkedAt: new Date().toISOString(),
    skippedRoomCount: errors.length,
    issueCounts: [...issueCounts.entries()]
      .map(([fieldPath, occurrenceCount]) => ({ fieldPath, occurrenceCount }))
      .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath)),
  };
}

export function restorePersistedRooms(
  rows: readonly unknown[],
): PersistedRoomState[] {
  const result = restoreRooms(rows);
  recordRoomRecoveryDiagnostics(result.errors);
  alertOnSkippedRooms();
  return result.rooms;
}

export function createPersistedRoomQuarantine(
  error: PersistedRoomRecoveryError,
  quarantinedAt: Date,
): PersistedRoomQuarantine {
  return {
    roomCode: error.roomCode,
    issues: error.issues,
    quarantinedAt,
  };
}

const databaseRoomStore: PersistedRoomStore = {
  async loadActiveRooms() {
    return db
      .select()
      .from(dominoRooms)
      .where(isNull(dominoRooms.quarantinedAt));
  },
  async quarantineRoom(quarantine) {
    const updated = await db
      .update(dominoRooms)
      .set({
        quarantinedAt: quarantine.quarantinedAt,
        quarantineIssues: quarantine.issues,
      })
      .where(eq(dominoRooms.code, quarantine.roomCode))
      .returning({ code: dominoRooms.code });

    if (updated.length === 0) {
      logger.warn(
        { roomCode: quarantine.roomCode },
        "Could not quarantine invalid persisted room because it no longer exists",
      );
    }
  },
};

export async function retryQuarantinedRoom(
  roomCode: string,
): Promise<QuarantinedRoomRetryResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(dominoRooms)
      .where(and(
        eq(dominoRooms.code, roomCode),
        isNotNull(dominoRooms.quarantinedAt),
      ))
      .for("update");

    if (!row) return { status: "not_found" };

    let room: PersistedRoomState;
    try {
      room = restoreRoom(row);
    } catch (error) {
      if (!(error instanceof PersistedRoomRecoveryError)) throw error;
      return {
        status: "invalid",
        issuePaths: getSafeIssuePaths(error.issues),
      };
    }

    await tx
      .update(dominoRooms)
      .set({ quarantinedAt: null, quarantineIssues: null, updatedAt: new Date() })
      .where(and(
        eq(dominoRooms.code, roomCode),
        isNotNull(dominoRooms.quarantinedAt),
      ));
    await tx.execute(sql`select pg_notify(${ROOM_RETRY_NOTIFICATION_CHANNEL}, ${roomCode})`);

    return { status: "restored", room };
  });
}

export async function loadActivePersistedRooms(): Promise<PersistedRoomState[]> {
  const rows = await databaseRoomStore.loadActiveRooms();
  return restoreRooms(rows).rooms;
}

export async function loadActivePersistedRoom(
  roomCode: string,
): Promise<PersistedRoomState | undefined> {
  const [row] = await db
    .select()
    .from(dominoRooms)
    .where(and(
      eq(dominoRooms.code, roomCode),
      isNull(dominoRooms.quarantinedAt),
    ))
    .limit(1);
  return row ? restoreRoom(row) : undefined;
}

async function quarantineInvalidRooms(
  errors: readonly PersistedRoomRecoveryError[],
  store: PersistedRoomStore,
): Promise<void> {
  if (errors.length === 0) return;

  const quarantinedAt = new Date();
  await Promise.all(
    errors.map(async (error) => {
      await store.quarantineRoom(createPersistedRoomQuarantine(error, quarantinedAt));
    }),
  );
}

export async function loadPersistedRooms(
  store: PersistedRoomStore = databaseRoomStore,
): Promise<PersistedRoomState[]> {
  const rows = await store.loadActiveRooms();
  const result = restoreRooms(rows);
  recordRoomRecoveryDiagnostics(result.errors);

  alertOnSkippedRooms();
  await quarantineInvalidRooms(result.errors, store);
  return result.rooms;
}

export async function persistRoom(room: PersistedRoomState): Promise<void> {
  const values = {
    ...serializeRoom(room),
    quarantinedAt: null,
    quarantineIssues: null,
    updatedAt: new Date(),
  };

  const previous = pendingWrites.get(room.code) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await db
      .insert(dominoRooms)
      .values(values)
      .onConflictDoUpdate({
        target: dominoRooms.code,
        set: values,
      });
  });
  pendingWrites.set(room.code, next);
  try {
    await next;
  } finally {
    if (pendingWrites.get(room.code) === next) pendingWrites.delete(room.code);
  }
}

export async function deletePersistedRoom(code: string): Promise<void> {
  const previous = pendingWrites.get(code) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await db.delete(dominoRooms).where(eq(dominoRooms.code, code));
  });
  pendingWrites.set(code, next);
  try {
    await next;
  } finally {
    if (pendingWrites.get(code) === next) pendingWrites.delete(code);
  }
}