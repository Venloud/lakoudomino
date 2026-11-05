import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { canClaimChessDraw, hasAutomaticChessDraw } from './chess-rules.ts';

test('threefold repetition is claimable but not automatically forced', () => {
  const game = new Chess();
  for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(move);
  assert.equal(canClaimChessDraw(game), true);
  assert.equal(hasAutomaticChessDraw(game), false);
});

test('fivefold repetition ends automatically', () => {
  const game = new Chess();
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(move);
  }
  assert.equal(hasAutomaticChessDraw(game), true);
});

test('the 50-move rule is claimable and the 75-move rule ends automatically', () => {
  const fiftyMovePosition = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 100 51');
  const seventyFiveMovePosition = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 150 76');
  assert.equal(canClaimChessDraw(fiftyMovePosition), true);
  assert.equal(hasAutomaticChessDraw(fiftyMovePosition), false);
  assert.equal(hasAutomaticChessDraw(seventyFiveMovePosition), true);
});

test('insufficient material and stalemate are automatic draws', () => {
  const insufficient = new Chess('8/8/8/8/8/8/2k5/4K2N w - - 0 1');
  const stalemate = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(hasAutomaticChessDraw(insufficient), true);
  assert.equal(hasAutomaticChessDraw(stalemate), true);
});
