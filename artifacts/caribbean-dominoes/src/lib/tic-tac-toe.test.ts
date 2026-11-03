import test from 'node:test';
import assert from 'node:assert/strict';
import { createTicTacToeState, playTicTacToeMove } from './tic-tac-toe.ts';

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
