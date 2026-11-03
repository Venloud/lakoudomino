import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_DROP_COLUMNS,
  BLOCK_DROP_ROWS,
  clearBlockDropLines,
  createBlockDropState,
  getBlockDropShape,
  hardDropBlockDrop,
  moveBlockDrop,
  rotateBlockDrop,
  tickBlockDrop,
} from './block-drop.ts';

test('Block Drop starts with an empty 10 by 20 board and a falling piece', () => {
  const state = createBlockDropState(() => 0);
  assert.equal(state.board.length, BLOCK_DROP_ROWS);
  assert.equal(state.board[0].length, BLOCK_DROP_COLUMNS);
  assert.equal(state.board.flat().filter(Boolean).length, 0);
  assert.ok(state.active);
  assert.equal(state.status, 'playing');
});

test('pieces move across the board but stay inside its walls', () => {
  let state = createBlockDropState(() => 0);
  for (let i = 0; i < 12; i += 1) state = moveBlockDrop(state, -1, 0);
  assert.ok(state.active);
  assert.equal(state.active.x, 0);
  for (let i = 0; i < 20; i += 1) state = moveBlockDrop(state, 1, 0);
  assert.ok(state.active);
  assert.ok(state.active.x + getBlockDropShape(state.active).width <= BLOCK_DROP_COLUMNS);
});

test('pieces rotate and a tick advances them one row', () => {
  const state = createBlockDropState(() => 0);
  const rotated = rotateBlockDrop(state);
  assert.ok(rotated.active);
  assert.notDeepEqual(getBlockDropShape(rotated.active), getBlockDropShape(state.active!));
  const falling = tickBlockDrop(state);
  assert.equal(falling.active?.y, state.active!.y + 1);
});

test('hard drop locks the piece and spawns the next one', () => {
  const state = createBlockDropState(() => 0);
  const dropped = hardDropBlockDrop(state);
  assert.ok(dropped.active);
  assert.ok(dropped.board.flat().some(Boolean));
  assert.equal(dropped.status, 'playing');
  assert.ok(dropped.active.y >= 0);
});

test('completed rows clear out of the board', () => {
  const state = createBlockDropState(() => 0);
  const board = state.board.map((row) => [...row]);
  board[BLOCK_DROP_ROWS - 1] = Array(BLOCK_DROP_COLUMNS).fill('T');
  const cleared = clearBlockDropLines(board);
  assert.equal(cleared.lines, 1);
  assert.ok(cleared.board[0].every((cell) => cell === null));
  assert.ok(cleared.board[BLOCK_DROP_ROWS - 1].every((cell) => cell === null));
});

test('locking a piece that completes a row awards score and advances the level counters', () => {
  const state = createBlockDropState(() => 0);
  const board = state.board.map((row) => [...row]);
  board[BLOCK_DROP_ROWS - 1].fill('T');
  for (let column = 6; column < BLOCK_DROP_COLUMNS; column += 1) board[BLOCK_DROP_ROWS - 1][column] = null;

  const dropped = hardDropBlockDrop({
    ...state,
    board,
    active: { type: 'I', rotation: 0, x: 6, y: 0 },
  });
  assert.equal(dropped.lines, 1);
  assert.equal(dropped.score, 100);
  assert.equal(dropped.level, 1);
});
