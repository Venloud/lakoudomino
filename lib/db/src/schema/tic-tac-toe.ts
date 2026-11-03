import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const ticTacToeRooms = pgTable("tic_tac_toe_rooms", {
  code: text("code").primaryKey(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  players: jsonb("players").notNull(),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TicTacToeRoomRecord = typeof ticTacToeRooms.$inferSelect;
