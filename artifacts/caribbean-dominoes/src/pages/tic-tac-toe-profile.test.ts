import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TicTacToeProfileResults } from "./tic-tac-toe-profile.ts";

test("Tic-Tac-Toe profile panel renders separate totals and recent Regular/Yard outcomes", () => {
  const markup = renderToStaticMarkup(createElement(TicTacToeProfileResults, {
    data: {
      summary: { games: 3, wins: 1, losses: 1, draws: 1 },
      results: [
        { id: "win-1", roomCode: "TABC1234", mode: "yard", outcome: "win", mark: "X", opponentName: "Friend", completedAt: "2026-10-20T12:00:00.000Z" },
        { id: "loss-1", roomCode: "TDEF1234", mode: "regular", outcome: "loss", mark: "O", opponentName: "Guest", completedAt: "2026-10-19T12:00:00.000Z" },
      ],
    },
  }));
  assert.match(markup, /Tic-Tac-Toe record/);
  assert.match(markup, /Games/);
  assert.match(markup, /Wins/);
  assert.match(markup, /Losses/);
  assert.match(markup, /Draws/);
  assert.match(markup, /Yard Mode · vs Friend/);
  assert.match(markup, /Regular · vs Guest/);
  assert.match(markup, /Victory/);
  assert.match(markup, /Defeat/);
});

test("Tic-Tac-Toe profile panel has explicit loading, error, and empty states", () => {
  assert.match(renderToStaticMarkup(createElement(TicTacToeProfileResults, { isLoading: true })), /loading-tic-tac-toe-results/);
  assert.match(renderToStaticMarkup(createElement(TicTacToeProfileResults, { isError: true })), /error-tic-tac-toe-results/);
  assert.match(renderToStaticMarkup(createElement(TicTacToeProfileResults, {
    data: { summary: { games: 0, wins: 0, losses: 0, draws: 0 }, results: [] },
  })), /empty-tic-tac-toe-results/);
});
