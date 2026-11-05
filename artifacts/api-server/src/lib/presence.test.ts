import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import WebSocket from "ws";
import { clearPresence, getPresenceForUser, trackPresence, uniqueOnlinePlayerCount, updatePresence } from "./presence";

function openSocket(): WebSocket {
  return { readyState: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket;
}

test("friend presence includes a live Tic-Tac-Toe room and game label", () => {
  const userId = randomUUID();
  const socket = openSocket();
  trackPresence(socket, {
    identityKey: `user:${userId}`,
    userId,
    username: "friend",
    client: "room",
    status: "game",
    detail: "Tic-Tac-Toe · Regular · Room T1234",
    roomCode: "T1234",
    game: "tic-tac-toe",
  });

  assert.deepEqual(getPresenceForUser(userId), {
    status: "game",
    detail: "Tic-Tac-Toe · Regular · Room T1234",
    roomCode: "T1234",
    game: "tic-tac-toe",
  });

  updatePresence(socket, { status: "online", detail: undefined, roomCode: undefined, game: undefined });
  assert.deepEqual(getPresenceForUser(userId), { status: "online" });
});

test("clearing a disconnected guest removes their online presence", () => {
  const before = uniqueOnlinePlayerCount();
  const socket = openSocket();
  trackPresence(socket, {
    identityKey: `guest:test:${randomUUID()}`,
    userId: null,
    username: null,
    client: "room",
    status: "online",
  });
  assert.equal(uniqueOnlinePlayerCount(), before + 1);

  clearPresence(socket);

  assert.equal(uniqueOnlinePlayerCount(), before);
});
