import test from 'node:test';
import assert from 'node:assert/strict';
import { createMopyonState, MOPYON_BOARD_SIZE, playMopyonMove } from './mopyon.ts';

const axisCases = [
  { name: 'horizontal', row: 7, column: (step: number) => 4 + step },
  { name: 'vertical', row: (step: number) => 4 + step, column: 7 },
  { name: 'diagonal', row: (step: number) => 4 + step, column: (step: number) => 4 + step },
  { name: 'reverse diagonal', row: (step: number) => 4 + step, column: (step: number) => 8 - step },
];

for (const axis of axisCases) {
  test(`Mòpyon detects five in a row ${axis.name}`, () => {
    let state = createMopyonState();
    for (let step = 0; step < 5; step += 1) {
      const row = typeof axis.row === 'function' ? axis.row(step) : axis.row;
      const column = typeof axis.column === 'function' ? axis.column(step) : axis.column;
      state = playMopyonMove(state, row, column);
      if (step < 4) state = playMopyonMove(state, 0, step);
    }

    assert.equal(state.winner, 'X');
    assert.equal(state.winningLine?.length, 5);
  });
}

test('Mòpyon starts with a 15 by 15 board and keeps placed marks', () => {
  let state = createMopyonState();
  assert.equal(state.board.length, MOPYON_BOARD_SIZE ** 2);
  state = playMopyonMove(state, 6, 8);
  assert.equal(state.board[6 * MOPYON_BOARD_SIZE + 8], 'X');
  assert.equal(state.currentPlayer, 'O');
});

test('Mòpyon ignores occupied, invalid, and post-win moves', () => {
  let state = createMopyonState();
  state = playMopyonMove(state, 2, 2);
  assert.equal(playMopyonMove(state, 2, 2), state);
  assert.equal(playMopyonMove(state, -1, 2), state);
  assert.equal(playMopyonMove(state, 2, MOPYON_BOARD_SIZE), state);

  for (let column = 0; column < 5; column += 1) {
    if (column > 0) state = playMopyonMove(state, 0, column);
    state = playMopyonMove(state, 8, column);
  }
  assert.equal(state.winner, 'O');
  assert.equal(playMopyonMove(state, 10, 10), state);
});
