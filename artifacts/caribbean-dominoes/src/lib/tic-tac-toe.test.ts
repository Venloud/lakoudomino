import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTicTacToeState,
  createYardTicTacToeState,
  playTicTacToeMove,
  playYardTicTacToeMove,
} from './tic-tac-toe.ts';

test('alternates turns and detects a row win', () => {
  let state = createTicTacToeState();
  for (const move of [0, 3, 1, 4, 2]) state = playTicTacToeMove(state, move);

  assert.equal(state.winner, 'X');
  assert.equal(state.currentPlayer, 'X');
  assert.deepEqual(state.board.slice(0, 3), ['X', 'X', 'X']);
});

test('detects a draw when all cells are used without a winner', () => {
  let state = createTicTacToeState();
  for (const move of [0, 1, 2, 4, 3, 5, 7, 6, 8]) state = playTicTacToeMove(state, move);

  assert.equal(state.winner, null);
  assert.equal(state.isDraw, true);
});

test('ignores occupied, out-of-range, and post-game moves', () => {
  let state = createTicTacToeState();
  state = playTicTacToeMove(state, 0);
  assert.equal(playTicTacToeMove(state, 0), state);
  assert.equal(playTicTacToeMove(state, -1), state);
  assert.equal(playTicTacToeMove(state, 9), state);

  for (const move of [3, 1, 4, 2]) state = playTicTacToeMove(state, move);
  assert.equal(state.winner, 'X');
  assert.equal(playTicTacToeMove(state, 5), state);
});

test('Yard Mode routes the next player to the matching small grid', () => {
  let state = createYardTicTacToeState();
  state = playYardTicTacToeMove(state, 4, 0);

  assert.equal(state.currentPlayer, 'O');
  assert.equal(state.nextBoard, 0);
  assert.equal(playYardTicTacToeMove(state, 1, 2), state);
  assert.notEqual(playYardTicTacToeMove(state, 0, 2), state);
});

test('Yard Mode awards a small grid and the matching outer-board win', () => {
  let localWin = createYardTicTacToeState();
  for (const [board, cell] of [[0, 0], [0, 3], [3, 1], [1, 4], [4, 2], [2, 5], [5, 6], [6, 7], [7, 8], [8, 0], [0, 1], [1, 0], [0, 2]]) {
    localWin = playYardTicTacToeMove(localWin, board, cell);
  }
  assert.equal(localWin.gridResults[0], 'X');

  const outerWin = createYardTicTacToeState();
  outerWin.gridResults[0] = 'X';
  outerWin.gridResults[1] = 'X';
  outerWin.boards[2][0] = 'X';
  outerWin.boards[2][1] = 'X';
  const won = playYardTicTacToeMove(outerWin, 2, 2);
  assert.equal(won.gridResults[2], 'X');
  assert.equal(won.winner, 'X');
});

test('Yard Mode allows free choice when the routed grid is already closed', () => {
  const state = createYardTicTacToeState();
  state.gridResults[0] = 'O';
  const next = playYardTicTacToeMove(state, 4, 0);

  assert.equal(next.nextBoard, null);
  assert.equal(next.currentPlayer, 'O');
  assert.notEqual(playYardTicTacToeMove(next, 8, 8), next);
});
