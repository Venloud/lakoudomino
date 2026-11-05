import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { WebSocket } from "ws";
import { pool } from "@workspace/db";
import arcadeRouter, { handleArcadeSocket } from "./arcade.ts";

class TestSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  messages: Record<string, unknown>[] = [];

  send(raw: string) {
    this.messages.push(JSON.parse(raw) as Record<string, unknown>);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

async function connect(code: string, token: string): Promise<TestSocket> {
  const socket = new TestSocket();
  const request = {
    url: `/ws?arcadeCode=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`,
    headers: { host: "localhost" },
  } as IncomingMessage;
  await handleArcadeSocket(socket as unknown as WebSocket, request);
  return socket;
}

function sendState(socket: TestSocket, state: unknown, turn: number) {
  socket.emit("message", Buffer.from(JSON.stringify({ type: "state", state, turn })));
}

async function waitForMessage(socket: TestSocket, startAt: number, type: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (socket.messages.slice(startAt).some((message) => message.type === type)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for arcade socket message "${type}".`);
}

test("arcade room sockets reject illegal and out-of-turn updates and restore the accepted state on reconnect", async () => {
  const app = express();
  app.use(express.json());
  app.use(arcadeRouter);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let firstSocket: TestSocket | undefined;
  let secondSocket: TestSocket | undefined;
  let roomCode: string | undefined;

  try {
    const createdResponse = await fetch(`${baseUrl}/arcade/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ game: "mopyon", displayName: "Player one", playerCount: 2, isPrivate: true }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { code: string; reconnectToken: string; state: Record<string, unknown> };
    roomCode = created.code;
    assert.equal((created.state.board as unknown[]).length, 225);

    const joinedResponse = await fetch(`${baseUrl}/arcade/rooms/${created.code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Player two" }),
    });
    assert.equal(joinedResponse.status, 200);
    const joined = await joinedResponse.json() as { reconnectToken: string };
    firstSocket = await connect(created.code, created.reconnectToken);
    secondSocket = await connect(created.code, joined.reconnectToken);

    const firstMoveBoard = [...created.state.board as unknown[]];
    firstMoveBoard[0] = "X";
    const firstMoveMessageCount = firstSocket.messages.length;
    sendState(firstSocket, {
      ...created.state,
      board: firstMoveBoard,
      currentPlayer: "O",
      lastMove: 0,
    }, 1);
    await waitForMessage(firstSocket, firstMoveMessageCount, "state");
    assert.equal(firstSocket.messages.at(-1)?.type, "state");
    assert.equal((firstSocket.messages.at(-1)?.room as Record<string, unknown>).turn, 1);

    const acceptedState = ((firstSocket.messages.at(-1)?.room as Record<string, unknown>).state) as Record<string, unknown>;
    const badOutOfTurnBoard = [...acceptedState.board as unknown[]];
    badOutOfTurnBoard[1] = "O";
    const secondPlayerMessageCount = secondSocket.messages.length;
    const rejectedMessageCount = firstSocket.messages.length;
    sendState(firstSocket, { ...acceptedState, board: badOutOfTurnBoard, currentPlayer: "X", lastMove: 1 }, 0);
    await waitForMessage(firstSocket, rejectedMessageCount, "error");
    assert.equal(firstSocket.messages.at(-2)?.type, "error");
    assert.equal(firstSocket.messages.at(-1)?.type, "room");
    assert.equal(secondSocket.messages.length, secondPlayerMessageCount);

    const overwrittenBoard = [...acceptedState.board as unknown[]];
    overwrittenBoard[0] = "O";
    const firstPlayerMessageCount = firstSocket.messages.length;
    sendState(secondSocket, { ...acceptedState, board: overwrittenBoard }, 0);
    await waitForMessage(secondSocket, secondSocket.messages.length, "error");
    assert.equal(secondSocket.messages.at(-2)?.type, "error");
    assert.equal(secondSocket.messages.at(-1)?.type, "room");
    assert.equal(firstSocket.messages.length, firstPlayerMessageCount);

    const secondMoveBoard = [...acceptedState.board as unknown[]];
    secondMoveBoard[1] = "O";
    const secondMoveMessageCount = secondSocket.messages.length;
    sendState(secondSocket, {
      ...acceptedState,
      board: secondMoveBoard,
      currentPlayer: "X",
      lastMove: 1,
    }, 0);
    await waitForMessage(secondSocket, secondMoveMessageCount, "state");
    assert.equal(secondSocket.messages.at(-1)?.type, "state");

    firstSocket.close();
    firstSocket = await connect(created.code, created.reconnectToken);
    const reconnectSnapshot = firstSocket.messages[0];
    assert.equal(reconnectSnapshot.type, "room");
    const reconnectRoom = reconnectSnapshot.room as Record<string, unknown>;
    assert.equal(reconnectRoom.turn, 0);
    assert.deepEqual((reconnectRoom.state as Record<string, unknown>).board, secondMoveBoard);
  } finally {
    firstSocket?.close();
    secondSocket?.close();
    if (roomCode) await pool.query("DELETE FROM arcade_rooms WHERE code = $1", [roomCode]);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Scrabble room responses and live updates reveal only each player's own rack", async () => {
  const app = express();
  app.use(express.json());
  app.use(arcadeRouter);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sockets: TestSocket[] = [];
  let roomCode: string | undefined;

  try {
    const createdResponse = await fetch(`${baseUrl}/arcade/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ game: "scrabble", displayName: "Player one", playerCount: 4, isPrivate: true }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as {
      code: string;
      reconnectToken: string;
      state: { racks: string[][]; bag: string[] };
    };
    roomCode = created.code;
    assert.equal(created.state.racks[0].length, 7);
    assert.deepEqual(created.state.racks[1], []);
    assert.ok(created.state.bag.length > 0);
    assert.ok(created.state.bag.every((tile) => tile === ""));

    const players = [created];
    for (let seat = 1; seat < 4; seat += 1) {
      const joinedResponse = await fetch(`${baseUrl}/arcade/rooms/${created.code}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: `Player ${seat + 1}` }),
      });
      assert.equal(joinedResponse.status, 200);
      const joined = await joinedResponse.json() as typeof created;
      assert.deepEqual(joined.state.racks.map((rack) => rack.length),
        [0, 0, 0, 0].map((_, index) => index === seat ? 7 : 0));
      assert.equal(joined.state.racks[seat].length, 7);
      assert.ok(joined.state.bag.every((tile) => tile === ""));
      players.push(joined);
    }

    const publicResponse = await fetch(`${baseUrl}/arcade/rooms/${created.code}`);
    assert.equal(publicResponse.status, 200);
    const publicRoom = await publicResponse.json() as { state: { racks: string[][]; bag: string[] } };
    assert.deepEqual(publicRoom.state.racks, [[], [], [], []]);
    assert.ok(publicRoom.state.bag.every((tile) => tile === ""));

    for (const player of players) sockets.push(await connect(created.code, player.reconnectToken));
    for (const [seat, socket] of sockets.entries()) {
      const snapshot = socket.messages[0].room as { state: { racks: string[][]; bag: string[] } };
      assert.deepEqual(snapshot.state.racks, players.map((player, index) =>
        index === seat ? player.state.racks[seat] : []));
      assert.ok(snapshot.state.bag.every((tile) => tile === ""));
    }

    const beforeUpdate = sockets.map((socket) => socket.messages.length);
    const firstSnapshot = sockets[0].messages[0].room as { state: Record<string, unknown> };
    sendState(sockets[0], {
      ...firstSnapshot.state,
      turn: 1,
      passes: 1,
    }, 1);
    await Promise.all(sockets.map((socket, seat) => waitForMessage(socket, beforeUpdate[seat], "state")));
    for (const [seat, socket] of sockets.entries()) {
      const live = socket.messages.at(-1)?.room as { state: { racks: string[][]; bag: string[] } };
      assert.deepEqual(live.state.racks, players.map((player, index) =>
        index === seat ? player.state.racks[seat] : []));
      assert.ok(live.state.bag.every((tile) => tile === ""));
    }

    sockets[0].close();
    sockets[0] = await connect(created.code, created.reconnectToken);
    const reconnectRoom = sockets[0].messages[0].room as { state: { racks: string[][]; bag: string[] } };
    assert.deepEqual(reconnectRoom.state.racks, [created.state.racks[0], [], [], []]);
    assert.ok(reconnectRoom.state.bag.every((tile) => tile === ""));

    const stored = await pool.query("SELECT state FROM arcade_rooms WHERE code = $1", [created.code]);
    const storedState = stored.rows[0]?.state as { racks: string[][]; bag: string[] };
    assert.deepEqual(storedState.racks.map((rack) => rack.length), [7, 7, 7, 7]);
    assert.ok(storedState.bag.every((tile) => tile !== ""));
  } finally {
    sockets.forEach((socket) => socket.close());
    if (roomCode) await pool.query("DELETE FROM arcade_rooms WHERE code = $1", [roomCode]);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
