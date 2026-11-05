import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const arcadeRooms = pgTable("arcade_rooms", {
  code: text("code").primaryKey(),
  game: text("game").notNull(),
  capacity: integer("capacity").notNull(),
  isPrivate: boolean("is_private").notNull(),
  players: jsonb("players").notNull(),
  state: jsonb("state"),
  turn: integer("turn").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ArcadeRoomRecord = typeof arcadeRooms.$inferSelect;
