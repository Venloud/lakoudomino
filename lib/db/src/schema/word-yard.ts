import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const wordYardRooms = pgTable("word_yard_rooms", {
  code: text("code").primaryKey(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  playerCount: integer("player_count").notNull(),
  players: jsonb("players").notNull(),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wordYardResults = pgTable("word_yard_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomCode: text("room_code").notNull(),
  roundNumber: integer("round_number").notNull(),
  userId: uuid("user_id"),
  mode: text("mode").notNull(),
  score: integer("score").notNull(),
  completionTimeMs: integer("completion_time_ms"),
  outcome: text("outcome").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("word_yard_result_round_room_user_idx").on(table.roomCode, table.roundNumber, table.userId),
]);

export type WordYardRoomRecord = typeof wordYardRooms.$inferSelect;
export type WordYardResult = typeof wordYardResults.$inferSelect;
export const insertWordYardRoomSchema = createInsertSchema(wordYardRooms).omit({ updatedAt: true });
export type InsertWordYardRoom = z.infer<typeof insertWordYardRoomSchema>;
export const insertWordYardResultSchema = createInsertSchema(wordYardResults).omit({ id: true, completedAt: true });
export type InsertWordYardResult = z.infer<typeof insertWordYardResultSchema>;
