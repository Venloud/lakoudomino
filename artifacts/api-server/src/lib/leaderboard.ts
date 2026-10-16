import { desc } from "drizzle-orm";
import { db, dominoUsers } from "@workspace/db";

export type LeaderboardRow = {
  id: string;
  name: string;
  points: number;
  gold: number;
  silver: number;
  bronze: number;
  isMe: boolean;
};
export async function getLeaderboard(userId: string | null): Promise<LeaderboardRow[]> {
  const rows = await db.select().from(dominoUsers).orderBy(desc(dominoUsers.crownPoints)).limit(userId ? 5 : 6);
  return rows.map((u) => ({
    id: u.id, name: u.username, points: u.crownPoints, gold: u.gold,
    silver: u.silver, bronze: u.bronze, isMe: userId !== null && u.id === userId,
  }));
}