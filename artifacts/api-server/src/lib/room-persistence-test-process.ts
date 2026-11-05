import { eq } from "drizzle-orm";
import { db, dominoRooms, pool } from "@workspace/db";
import { loadPersistedRooms, persistRoom } from "./room-persistence.ts";
import type { PersistedRoomState } from "./room-types.ts";

const resultPrefix = "ROOM_PERSISTENCE_RESULT=";

async function main() {
  const fixture = process.env.ROOM_PERSISTENCE_FIXTURE;
  if (!fixture) throw new Error("ROOM_PERSISTENCE_FIXTURE is required.");
  const room = JSON.parse(fixture) as PersistedRoomState;
  try {
    await persistRoom(room);
    const [row] = await db.select().from(dominoRooms).where(eq(dominoRooms.code, room.code));
    const [restored] = await loadPersistedRooms();
    process.stdout.write(`${resultPrefix}${JSON.stringify({ row, restored })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
