import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { WebSocket } from "ws";
import { pool } from "@workspace/db";

type JsonRecord = Record<string, any>;
const apiServerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const delay = (milliseconds: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function startApi(databaseUrl: string): Promise<{ child: ChildProcess; baseUrl: string; output: () => string }> {
  const port = await reservePort();
  const child = spawn(process.execPath, ["--import", "tsx", "src/routes/rooms-test-process.ts"], {
    cwd: apiServerDirectory,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Tic-Tac-Toe API exited during startup:\n${output}`);
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return { child, baseUrl, output: () => output };
    } catch {
      // Keep checking while the isolated API process starts.
    }
    await delay(100);
  }
  child.kill("SIGKILL");
  throw new Error(`Tic-Tac-Toe API did not become ready:\n${output}`);
}

async function stopApi(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit").then(() => undefined);
  child.kill("SIGTERM");
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    exited,
    new Promise<void>((resolveTimeout) => {
      timeout = setTimeout(() => { child.kill("SIGKILL"); resolveTimeout(); }, 5_000);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  await exited;
}

function socketClient(socket: WebSocket) {
  const queued: JsonRecord[] = [];
  const waiting: ((message: JsonRecord) => void)[] = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as JsonRecord;
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queued.push(message);
  });
  return {
    socket,
    send: (message: JsonRecord) => socket.send(JSON.stringify(message)),
    next: () => queued.length
      ? Promise.resolve(queued.shift()!)
      : new Promise<JsonRecord>((resolve, reject) => {
          const timeout = setTimeout(() => {
            socket.off("error", onError);
            reject(new Error("Timed out waiting for Tic-Tac-Toe socket update."));
          }, 5_000);
          const onError = (error: Error) => {
            clearTimeout(timeout);
            reject(error);
          };
          socket.once("error", onError);
          waiting.push((message) => {
            clearTimeout(timeout);
            socket.off("error", onError);
            resolve(message);
          });
        }),
  };
}

async function openRoomSocket(baseUrl: string, code: string, watch = false) {
  const url = `${baseUrl.replace(/^http/, "ws")}/ws?ticCode=${encodeURIComponent(code)}${watch ? "&ticWatch=1" : ""}`;
  const socket = new WebSocket(url);
  const client = socketClient(socket);
  await once(socket, "open");
  return client;
}

test("Tic-Tac-Toe spectators receive live updates but cannot play or start a round", { timeout: 90_000 }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for Tic-Tac-Toe spectator integration tests.");
  const schema = `ttt_spectator_${randomUUID().replaceAll("-", "")}`;
  const quoted = `"${schema}"`;
  let api: Awaited<ReturnType<typeof startApi>> | undefined;
  const sockets: WebSocket[] = [];
  await pool.query(`CREATE SCHEMA ${quoted}`);
  try {
    for (const table of ["domino_rooms", "tic_tac_toe_rooms", "tic_tac_toe_results"]) {
      await pool.query(`CREATE TABLE ${quoted}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.searchParams.set("options", `-c search_path=${schema}`);
    api = await startApi(isolatedUrl.toString());

    const createdResponse = await fetch(`${api.baseUrl}/api/tic-tac-toe/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "regular", displayName: "Player X" }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { code: string; reconnectToken: string };
    const joinedResponse = await fetch(`${api.baseUrl}/api/tic-tac-toe/rooms/${created.code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Player O" }),
    });
    assert.equal(joinedResponse.status, 200);
    const joined = await joinedResponse.json() as { reconnectToken: string };

    const playerX = await openRoomSocket(api.baseUrl, created.code);
    const playerO = await openRoomSocket(api.baseUrl, created.code);
    sockets.push(playerX.socket, playerO.socket);
    playerX.send({ type: "hello", reconnectToken: created.reconnectToken });
    playerO.send({ type: "hello", reconnectToken: joined.reconnectToken });
    assert.equal((await playerX.next()).viewerRole, "player");
    assert.equal((await playerO.next()).viewerRole, "player");

    const spectator = await openRoomSocket(api.baseUrl, created.code, true);
    sockets.push(spectator.socket);
    const initial = await spectator.next();
    assert.equal(initial.type, "snapshot");
    assert.equal(initial.viewerRole, "spectator");
    assert.equal(initial.myMark, null);
    assert.equal(initial.status, "playing");
    assert.deepEqual(initial.players.map((player: JsonRecord) => player.name), ["Player X", "Player O"]);

    spectator.send({ type: "move", index: 0 });
    const rejectedMove = await spectator.next();
    assert.equal(rejectedMove.type, "error");
    assert.match(rejectedMove.message, /cannot play/i);

    const firstUpdate = [playerX.next(), playerO.next(), spectator.next()];
    playerX.send({ type: "move", index: 0 });
    const afterMove = await Promise.all(firstUpdate);
    for (const update of afterMove) {
      assert.equal(update.state.board[0], "X");
      assert.equal(update.viewerRole, update === afterMove[2] ? "spectator" : "player");
    }

    const turns = [
      [playerO, 3], [playerX, 1], [playerO, 4], [playerX, 2],
    ] as const;
    let finalUpdates: JsonRecord[] = [];
    for (const [active, index] of turns) {
      const next = [playerX.next(), playerO.next(), spectator.next()];
      active.send({ type: "move", index });
      finalUpdates = await Promise.all(next);
    }
    const finalSnapshot = finalUpdates[2];
    assert.equal(finalSnapshot.status, "finished");
    assert.equal(finalSnapshot.state.winner, "X");
    assert.equal(finalSnapshot.state.board[2], "X");

    spectator.send({ type: "newRound" });
    const rejectedRound = await spectator.next();
    assert.equal(rejectedRound.type, "error");
    assert.match(rejectedRound.message, /cannot play/i);

    const secondSpectator = await openRoomSocket(api.baseUrl, created.code, true);
    sockets.push(secondSpectator.socket);
    const unchanged = await secondSpectator.next();
    assert.equal(unchanged.status, "finished");
    assert.equal(unchanged.state.winner, "X");
    assert.deepEqual(unchanged.state.board, finalSnapshot.state.board);
  } finally {
    sockets.forEach((socket) => socket.close());
    if (api) await stopApi(api.child);
    await pool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
