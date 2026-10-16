import { db, dominoRooms } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { logger } from "./logger.ts";
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

export function restorePersistedRooms(
  rows: readonly unknown[],
): PersistedRoomState[] {
  const result = restoreRooms(rows);
  result.errors.forEach((error) => {
    logger.error(
      {
        err: error,
        roomCode: error.roomCode,
        issues: error.issues,
      },
      "Skipping invalid persisted room",
    );
  });
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

  result.errors.forEach((error) => {
    logger.error(
      {
        err: error,
        roomCode: error.roomCode,
        issues: error.issues,
      },
      "Skipping invalid persisted room",
    );
  });
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