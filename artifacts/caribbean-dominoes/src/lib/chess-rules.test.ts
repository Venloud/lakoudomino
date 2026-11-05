import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { getAutomaticChessDrawReason, hasAutomaticChessDraw } from './chess-rules.ts';

test('threefold repetition ends automatically', () => {
  const game = new Chess();
  for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(move);
  assert.equal(hasAutomaticChessDraw(game), true);
  assert.equal(getAutomaticChessDrawReason(game), 'threefold repetition');
});

test('fivefold repetition ends automatically', () => {
  const game = new Chess();
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(move);
  }
  assert.equal(hasAutomaticChessDraw(game), true);
  assert.equal(getAutomaticChessDrawReason(game), 'fivefold repetition');
});

test('the 50-move and 75-move rules end automatically', () => {
  const fiftyMovePosition = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 100 51');
  const seventyFiveMovePosition = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 150 76');
  assert.equal(hasAutomaticChessDraw(fiftyMovePosition), true);
  assert.equal(getAutomaticChessDrawReason(fiftyMovePosition), '50-move rule');
  assert.equal(hasAutomaticChessDraw(seventyFiveMovePosition), true);
  assert.equal(getAutomaticChessDrawReason(seventyFiveMovePosition), '75-move rule');
});

test('insufficient material and stalemate are automatic draws', () => {
  const insufficient = new Chess('8/8/8/8/8/8/2k5/4K2N w - - 0 1');
  const stalemate = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(hasAutomaticChessDraw(insufficient), true);
  assert.equal(hasAutomaticChessDraw(stalemate), true);
  assert.equal(getAutomaticChessDrawReason(insufficient), 'insufficient material');
  assert.equal(getAutomaticChessDrawReason(stalemate), 'stalemate');
});
