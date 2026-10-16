import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const dominoRooms = pgTable("domino_rooms", {
  code: text("code").primaryKey(),
  hostName: text("host_name").notNull(),
  mode: text("mode").notNull(),
  rowLength: integer("row_length").notNull(),
  playerCount: integer("player_count").notNull().default(4),
  rowBoxes: integer("row_boxes").notNull().default(10),
  twoPlayerVariant: text("two_player_variant").notNull().default("draw"),
  turnSeconds: integer("turn_seconds").notNull().default(30),
  isPrivate: boolean("is_private").notNull().default(false),
  seed: integer("seed"),
  status: text("status").notNull(),
  seats: jsonb("seats").notNull(),
  lastAction: text("last_action"),
  engineState: jsonb("engine_state"),
  waitlist: jsonb("waitlist").notNull().default([]),
  offers: jsonb("offers").notNull().default([]),
  activeMatchId: text("active_match_id"),
  statsRecorded: boolean("stats_recorded").notNull().default(false),
  matchParticipants: jsonb("match_participants").notNull().default([]),
  hostDisconnectedAt: bigint("host_disconnected_at", { mode: "number" }),
  quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
  quarantineIssues: jsonb("quarantine_issues"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});