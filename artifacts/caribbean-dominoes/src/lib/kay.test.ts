import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playKayMove } from './kay.ts';

const board = (changes: Record<number, number> = {}) =>
  Array.from({ length: 14 }, (_, pit) => Number(changes[pit] ?? (pit === 6 || pit === 13 ? 0 : 4)));
const total = (pits: number[]) => pits.reduce((sum, count) => sum + count, 0);

test('sowing skips the opponent store for either player', () => {
  const p0 = board({ 5: 10 });
  const p0Move = playKayMove(p0, 0, 5);
  assert.ok(p0Move);
  assert.equal(p0Move.lastPit, 2);
  assert.equal(p0Move.pits[13], 0);
  assert.equal(p0Move.pits[0], 5);
  assert.equal(total(p0Move.pits), total(p0));

  const p1 = board({ 7: 10 });
  const p1Move = playKayMove(p1, 1, 7);
  assert.ok(p1Move);
  assert.equal(p1Move.lastPit, 3);
  assert.equal(p1Move.pits[6], 0);
  assert.equal(p1Move.pits[7], 0);
  assert.equal(total(p1Move.pits), total(p1));
});

test('landing in the active player store grants an extra turn', () => {
  const p0 = playKayMove(board({ 5: 1 }), 0, 5);
  const p1 = playKayMove(board({ 12: 1 }), 1, 12);
  assert.equal(p0?.lastPit, 6);
  assert.equal(p0?.extraTurn, true);
  assert.equal(p1?.lastPit, 13);
  assert.equal(p1?.extraTurn, true);
  assert.equal(p0?.ended, false);
  assert.equal(p1?.ended, false);
  assert.deepEqual(p0?.frames.at(-1)?.pits, p0?.pits);
  assert.deepEqual(p1?.frames.at(-1)?.pits, p1?.pits);
});

test('last seed in an empty own pit captures the opposite pit', () => {
  const before = board({ 2: 1, 3: 0, 9: 4 });
  const result = playKayMove(before, 0, 2);
  assert.ok(result);
  assert.equal(result.captured, 5);
  assert.equal(result.pits[6], 5);
  assert.equal(result.pits[3], 0);
  assert.equal(result.pits[9], 0);
  assert.equal(total(result.pits), total(before));
  assert.deepEqual(result.frames.at(-1)?.pits, result.pits);
  assert.equal(result.frames.at(-1)?.pit, null);

  const oppositeSide = board({ 9: 1, 10: 0, 2: 4 });
  const reverseCapture = playKayMove(oppositeSide, 1, 9);
  assert.ok(reverseCapture);
  assert.equal(reverseCapture.captured, 5);
  assert.equal(reverseCapture.pits[13], 5);
  assert.equal(reverseCapture.pits[10], 0);
  assert.equal(reverseCapture.pits[2], 0);
  assert.equal(total(reverseCapture.pits), total(oppositeSide));
});

test('an empty row sweeps remaining seeds and declares the store winner', () => {
  const before = board({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 7: 2, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 });
  const result = playKayMove(before, 0, 5);
  assert.ok(result);
  assert.equal(result.ended, true);
  assert.equal(result.winner, 1);
  assert.equal(result.pits[6], 1);
  assert.equal(result.pits[13], 2);
  assert.ok(result.pits.slice(0, 6).every((count) => count === 0));
  assert.ok(result.pits.slice(7, 13).every((count) => count === 0));
  assert.equal(total(result.pits), total(before));
  assert.deepEqual(result.frames.at(-1)?.pits, result.pits);
});

test('rejects invalid, empty, and opponent pits', () => {
  const pits = board();
  assert.equal(playKayMove(pits, 0, 6), null);
  assert.equal(playKayMove(pits, 0, 7), null);
  assert.equal(playKayMove(board({ 2: 0 }), 0, 2), null);
  assert.equal(playKayMove([1, 2], 0, 0), null);
});
