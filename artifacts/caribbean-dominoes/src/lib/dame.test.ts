import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDameLegalMoves, playDameMove, type DamePiece } from './dame.ts';

const board = (placements: Array<[number, 0 | 1, 'D' | 'K']>) => {
  const pieces: DamePiece[] = Array(64).fill(null);
  for (const [index, side, kind] of placements) pieces[index] = { side, kind };
  return pieces;
};

test('mandatory captures suppress ordinary moves', () => {
  const pieces = board([[42, 0, 'D'], [33, 1, 'D'], [44, 0, 'D']]);
  assert.deepEqual(getDameLegalMoves(pieces, 0), [{ from: 42, to: 24, capture: 33 }]);
  assert.equal(playDameMove(pieces, 0, 44, 35), null);
});

test('a capture chain forces the same piece to continue until no jump remains', () => {
  const pieces = board([[42, 0, 'D'], [40, 0, 'D'], [33, 1, 'D'], [17, 1, 'D']]);
  const first = playDameMove(pieces, 0, 42, 24);
  assert.ok(first);
  assert.equal(first.forcedFrom, 24);
  assert.equal(first.turn, 0);
  assert.deepEqual(getDameLegalMoves(first.board, 0, first.forcedFrom), [{ from: 24, to: 10, capture: 17 }]);
  assert.equal(playDameMove(first.board, 0, 40, 33, first.forcedFrom), null);
  const second = playDameMove(first.board, 0, 24, 10, first.forcedFrom);
  assert.ok(second);
  assert.equal(second.forcedFrom, null);
  assert.equal(second.turn, 1);
  assert.equal(second.winner, 0);
});

test('kings move and capture diagonally in either direction', () => {
  const pieces = board([[27, 0, 'K']]);
  const moves = getDameLegalMoves(pieces, 0);
  assert.ok(moves.some((move) => move.from === 27 && move.to === 18 && move.capture === null));
  assert.ok(moves.some((move) => move.from === 27 && move.to === 36 && move.capture === null));
  assert.ok(moves.some((move) => move.from === 27 && move.to === 34 && move.capture === null));
  const backwardCapture = getDameLegalMoves(board([[27, 0, 'K'], [36, 1, 'D']]), 0);
  assert.ok(backwardCapture.some((move) => move.from === 27 && move.to === 45 && move.capture === 36));
});

test('men promote at the far rank and promotion ends the turn', () => {
  const pieces = board([[12, 0, 'D'], [14, 1, 'D']]);
  const result = playDameMove(pieces, 0, 12, 5);
  assert.ok(result);
  assert.deepEqual(result.board[5], { side: 0, kind: 'K' });
  assert.equal(result.forcedFrom, null);
  assert.equal(result.turn, 1);

  const oppositePromotion = playDameMove(board([[51, 1, 'D']]), 1, 51, 58);
  assert.deepEqual(oppositePromotion?.board[58], { side: 1, kind: 'K' });
  assert.equal(oppositePromotion?.turn, 0);
});

test('a player wins when the opponent has no pieces or no legal moves', () => {
  const captureWin = playDameMove(board([[42, 0, 'D'], [33, 1, 'D']]), 0, 42, 24);
  assert.equal(captureWin?.winner, 0);

  const blockedWin = playDameMove(board([[42, 0, 'D'], [56, 1, 'D']]), 0, 42, 33);
  assert.equal(blockedWin?.winner, 0);
});
