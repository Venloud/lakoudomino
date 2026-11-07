import assert from "node:assert/strict";
import test from "node:test";
import { restoreRoom, serializeRoom } from "./room-persistence-codec";
import { ROOM_CHAT_HISTORY_LIMIT, type PersistedRoomState } from "./room-types";

const roomFixture = (chatHistory?: PersistedRoomState["chatHistory"]): PersistedRoomState => ({
  code: "CHAT",
  hostName: "Host",
  mode: "regular",
  rowLength: 10,
  playerCount: 2,
  status: "waiting",
  seats: [0, 1, 2, 3].map((seat) => ({
    seat: seat as 0 | 1 | 2 | 3,
    status: seat === 0 ? "waiting" : "open",
    name: seat === 0 ? "Host" : null,
    reconnectTokenHash: null,
  })),
  lastAction: null,
  waitlist: [],
  offers: [],
  ...(chatHistory ? { chatHistory } : {}),
});

test("room codec persists only the newest bounded chat and defaults legacy rooms to empty history", () => {
  const entries = Array.from({ length: ROOM_CHAT_HISTORY_LIMIT + 7 }, (_, index) => ({
    id: `chat-${index}`,
    seat: index % 2 as 0 | 1,
    name: `Player ${index % 2 + 1}`,
    text: `Message ${index}`,
    sentAt: new Date(index * 1000).toISOString(),
  }));
  const stored = serializeRoom(roomFixture(entries));
  assert.equal(stored.chatHistory?.length, ROOM_CHAT_HISTORY_LIMIT);
  assert.equal(stored.chatHistory?.[0]?.id, "chat-7");
  assert.deepEqual(restoreRoom(stored).chatHistory, entries.slice(-ROOM_CHAT_HISTORY_LIMIT));
  assert.deepEqual(restoreRoom(roomFixture()).chatHistory, []);
  assert.deepEqual(restoreRoom({ ...stored, chatHistory: [{ id: "bad" }] }).chatHistory, []);
});
