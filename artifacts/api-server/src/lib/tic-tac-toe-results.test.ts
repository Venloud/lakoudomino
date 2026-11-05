import assert from "node:assert/strict";
import test from "node:test";
import { buildTicTacToeResultInserts } from "./tic-tac-toe-results.ts";

const baseRoom = {
  code: "TABC1234",
  mode: "regular" as const,
  status: "finished" as const,
  roundNumber: 2,
  players: [
    { seat: 0 as const, mark: "X" as const, name: "Nadia", userId: "user-x" },
    { seat: 1 as const, mark: "O" as const, name: "Mika", userId: "user-o" },
  ],
  state: { winner: "X" as const, isDraw: false },
};

test("finished online rounds create matching win/loss results for signed-in players", () => {
  assert.deepEqual(buildTicTacToeResultInserts(baseRoom), [
    { roomCode: "TABC1234", roundNumber: 2, userId: "user-x", mode: "regular", outcome: "win", mark: "X", opponentName: "Mika" },
    { roomCode: "TABC1234", roundNumber: 2, userId: "user-o", mode: "regular", outcome: "loss", mark: "O", opponentName: "Nadia" },
  ]);
});

test("a resigned player receives a loss and the remaining player receives a win", () => {
  const resignedRound = {
    ...baseRoom,
    state: { winner: "O" as const, isDraw: false },
  };
  const results = buildTicTacToeResultInserts(resignedRound);
  assert.equal(results.find((result) => result.userId === "user-x")?.outcome, "loss");
  assert.equal(results.find((result) => result.userId === "user-o")?.outcome, "win");
});

test("Yard draws are stored for each signed-in player, while guests get no result row", () => {
  const room = {
    ...baseRoom,
    mode: "yard" as const,
    state: { winner: null, isDraw: true },
    players: [baseRoom.players[0], { ...baseRoom.players[1], userId: null }],
  };
  assert.deepEqual(buildTicTacToeResultInserts(room), [
    { roomCode: "TABC1234", roundNumber: 2, userId: "user-x", mode: "yard", outcome: "draw", mark: "X", opponentName: "Mika" },
  ]);
});

test("unfinished rooms and self-play do not create profile results", () => {
  assert.deepEqual(buildTicTacToeResultInserts({ ...baseRoom, status: "playing" }), []);
  assert.deepEqual(buildTicTacToeResultInserts({
    ...baseRoom,
    players: [baseRoom.players[0], { ...baseRoom.players[1], userId: "user-x" }],
  }), []);
});
