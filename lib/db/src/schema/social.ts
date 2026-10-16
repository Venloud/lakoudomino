import { integer, boolean, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";

export const dominoUsers = pgTable("domino_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  crownPoints: integer("crown_points").notNull().default(0),
  games: integer("games").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  gold: integer("gold").notNull().default(0),
  silver: integer("silver").notNull().default(0),
  bronze: integer("bronze").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});
export const dominoSessions = pgTable("domino_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const dominoFriendships = pgTable("domino_friendships", {
  id: uuid("id").defaultRandom().primaryKey(),
  userLow: uuid("user_low").notNull(),
  userHigh: uuid("user_high").notNull(),
  requesterId: uuid("requester_id").notNull(),
  status: text("status").notNull().default("pending"),
}, (t) => [uniqueIndex("friendship_pair_idx").on(t.userLow, t.userHigh)]);
export const dominoFriendInvites = pgTable("domino_friend_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviterId: uuid("inviter_id").notNull(),
  inviteeId: uuid("invitee_id").notNull(),
  roomCode: text("room_code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("pending"),
});
export const dominoMatches = pgTable("domino_matches", {
  matchId: uuid("match_id").primaryKey(),
  roomCode: text("room_code").notNull(),
  mode: text("mode").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});
export const dominoMatchResults = pgTable("domino_match_results", {
  matchId: uuid("match_id").notNull(),
  userId: uuid("user_id").notNull(),
  rank: integer("rank").notNull(),
  medal: text("medal").notNull(),
  crownPoints: integer("crown_points").notNull(),
  won: boolean("won").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("match_result_pair_idx").on(t.matchId, t.userId)]);
export type DominoUser = typeof dominoUsers.$inferSelect;