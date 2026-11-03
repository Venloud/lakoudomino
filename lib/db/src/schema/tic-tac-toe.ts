import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const ticTacToeRooms = pgTable("tic_tac_toe_rooms", {
  code: text("code").primaryKey(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  players: jsonb("players").notNull(),
  state: jsonb("state").notNull(),
  roundNumber: integer("round_number").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ticTacToeResults = pgTable("tic_tac_toe_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomCode: text("room_code").notNull(),
  roundNumber: integer("round_number").notNull(),
  userId: uuid("user_id").notNull(),
  mode: text("mode").notNull(),
  outcome: text("outcome").notNull(),
  mark: text("mark").notNull(),
  opponentName: text("opponent_name").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("tic_tac_toe_result_round_user_idx").on(t.roomCode, t.roundNumber, t.userId)]);

export type TicTacToeRoomRecord = typeof ticTacToeRooms.$inferSelect;
export type TicTacToeResult = typeof ticTacToeResults.$inferSelect;
