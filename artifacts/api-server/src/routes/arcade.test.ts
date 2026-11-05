import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import test, { mock } from "node:test";
import express from "express";
import { WebSocket } from "ws";
import { db } from "@workspace/db";
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

function connect(code: string, token: string): TestSocket {
  const socket = new TestSocket();
  const request = {
    url: `/ws?arcadeCode=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`,
    headers: { host: "localhost" },
  } as IncomingMessage;
  handleArcadeSocket(socket as unknown as WebSocket, request);
  return socket;
}

function sendState(socket: TestSocket, state: unknown, turn: number) {
  socket.emit("message", Buffer.from(JSON.stringify({ type: "state", state, turn })));
}

function settleSocketMessage(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("arcade room sockets reject illegal and out-of-turn updates and restore the accepted state on reconnect", async () => {
  const insertStub = mock.method(db, "insert", (() => ({
    values: () => ({
      onConflictDoUpdate: async () => undefined,
    }),
  })) as never);
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

  try {
    const createdResponse = await fetch(`${baseUrl}/arcade/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ game: "mopyon", displayName: "Player one", playerCount: 2, isPrivate: true }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { code: string; reconnectToken: string; state: Record<string, unknown> };
    assert.equal((created.state.board as unknown[]).length, 225);

    const joinedResponse = await fetch(`${baseUrl}/arcade/rooms/${created.code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Player two" }),
    });
    assert.equal(joinedResponse.status, 200);
    const joined = await joinedResponse.json() as { reconnectToken: string };
    firstSocket = connect(created.code, created.reconnectToken);
    secondSocket = connect(created.code, joined.reconnectToken);

    const firstMoveBoard = [...created.state.board as unknown[]];
    firstMoveBoard[0] = "X";
    sendState(firstSocket, {
      ...created.state,
      board: firstMoveBoard,
      currentPlayer: "O",
      lastMove: 0,
    }, 1);
    await settleSocketMessage();
    assert.equal(firstSocket.messages.at(-1)?.type, "state");
    assert.equal((firstSocket.messages.at(-1)?.room as Record<string, unknown>).turn, 1);

    const acceptedState = ((firstSocket.messages.at(-1)?.room as Record<string, unknown>).state) as Record<string, unknown>;
    const badOutOfTurnBoard = [...acceptedState.board as unknown[]];
    badOutOfTurnBoard[1] = "O";
    const secondPlayerMessageCount = secondSocket.messages.length;
    sendState(firstSocket, { ...acceptedState, board: badOutOfTurnBoard, currentPlayer: "X", lastMove: 1 }, 0);
    await settleSocketMessage();
    assert.equal(firstSocket.messages.at(-2)?.type, "error");
    assert.equal(firstSocket.messages.at(-1)?.type, "room");
    assert.equal(secondSocket.messages.length, secondPlayerMessageCount);

    const overwrittenBoard = [...acceptedState.board as unknown[]];
    overwrittenBoard[0] = "O";
    const firstPlayerMessageCount = firstSocket.messages.length;
    sendState(secondSocket, { ...acceptedState, board: overwrittenBoard }, 0);
    await settleSocketMessage();
    assert.equal(secondSocket.messages.at(-2)?.type, "error");
    assert.equal(secondSocket.messages.at(-1)?.type, "room");
    assert.equal(firstSocket.messages.length, firstPlayerMessageCount);

    const secondMoveBoard = [...acceptedState.board as unknown[]];
    secondMoveBoard[1] = "O";
    sendState(secondSocket, {
      ...acceptedState,
      board: secondMoveBoard,
      currentPlayer: "X",
      lastMove: 1,
    }, 0);
    await settleSocketMessage();
    assert.equal(secondSocket.messages.at(-1)?.type, "state");

    firstSocket.close();
    firstSocket = connect(created.code, created.reconnectToken);
    const reconnectSnapshot = firstSocket.messages[0];
    assert.equal(reconnectSnapshot.type, "room");
    const reconnectRoom = reconnectSnapshot.room as Record<string, unknown>;
    assert.equal(reconnectRoom.turn, 0);
    assert.deepEqual((reconnectRoom.state as Record<string, unknown>).board, secondMoveBoard);
  } finally {
    firstSocket?.close();
    secondSocket?.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    insertStub.mock.restore();
  }
});
