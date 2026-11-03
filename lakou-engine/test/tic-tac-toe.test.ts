import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTicTacToeState,
  createYardTicTacToeState,
  playTicTacToeMove,
  playYardTicTacToeMove,
} from '../src/tic-tac-toe.ts';

test('regular mode switches turns, rejects occupied cells, and retains a completed win', () => {
  let state = createTicTacToeState();
  state = playTicTacToeMove(state, 0);
  const next = playTicTacToeMove(state, 0);
  assert.equal(next, state);
  state = playTicTacToeMove(state, 3);
  state = playTicTacToeMove(state, 1);
  state = playTicTacToeMove(state, 4);
  state = playTicTacToeMove(state, 2);
  assert.equal(state.winner, 'X');
  assert.equal(playTicTacToeMove(state, 8), state);
});

test('Yard Mode enforces the routed board and allows any open board when the target is closed', () => {
  let state = createYardTicTacToeState();
  state = playYardTicTacToeMove(state, 0, 4);
  assert.equal(state.currentPlayer, 'O');
  assert.equal(state.nextBoard, 4);
  assert.equal(playYardTicTacToeMove(state, 2, 0), state);
  assert.notEqual(playYardTicTacToeMove(state, 4, 0), state);
});
