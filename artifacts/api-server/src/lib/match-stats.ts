import { sql } from "drizzle-orm";
import { awardCrowns, type MatchState } from "lakou-engine";
import { db, dominoMatchResults, dominoMatches, dominoUsers } from "@workspace/db";
import type { PersistedMatchParticipant, RoomMode, Seat } from "./room-types";

type RecordMatchInput = {
  matchId: string;
  roomCode: string;
  mode: RoomMode;
  match: MatchState;
  participants: readonly PersistedMatchParticipant[];
};

/**
 * Records only completed Points matches. The match row is the durable idempotency
 * gate; match results and counter increments commit in the same transaction.
 */
export async function recordPointsMatch(input: RecordMatchInput): Promise<boolean> {
  if (input.mode !== "points" || !input.match.over || !input.match.placings) return false;

  const participantBySeat = new Map(input.participants.map(({ seat, userId }) => [seat, userId]));
  const seenUsers = new Set<string>();
  const awards = awardCrowns(input.match);
  const results = awards.flatMap((award) => {
    if (![0, 1, 2, 3].includes(award.seat)) return [];
    const userId = participantBySeat.get(award.seat as Seat);
    if (!userId || seenUsers.has(userId)) return [];
    seenUsers.add(userId);
    return [{
      matchId: input.matchId,
      userId,
      rank: award.place,
      medal: award.medal ?? "none",
      crownPoints: award.crownPoints,
      won: award.place === 1,
    }];
  });

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(dominoMatches)
      .values({ matchId: input.matchId, roomCode: input.roomCode, mode: input.mode })
      .onConflictDoNothing()
      .returning({ matchId: dominoMatches.matchId });
    if (!created) return false;

    for (const result of results) {
      await tx.insert(dominoMatchResults).values(result).onConflictDoNothing();
      await tx.update(dominoUsers).set({
        crownPoints: sql`${dominoUsers.crownPoints} + ${result.crownPoints}`,
        games: sql`${dominoUsers.games} + 1`,
        wins: sql`${dominoUsers.wins} + ${result.won ? 1 : 0}`,
        gold: sql`${dominoUsers.gold} + ${result.medal === "gold" ? 1 : 0}`,
        silver: sql`${dominoUsers.silver} + ${result.medal === "silver" ? 1 : 0}`,
        bronze: sql`${dominoUsers.bronze} + ${result.medal === "bronze" ? 1 : 0}`,
      }).where(sql`${dominoUsers.id} = ${result.userId}`);
    }
    return true;
  });
}