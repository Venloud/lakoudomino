import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseMopyonBotMove,
  createMopyonState,
  MOPYON_BOARD_SIZE,
  playMopyonMove,
  type MopyonMark,
  type MopyonState,
} from './mopyon.ts';

function botPosition(marks: { row: number; column: number; mark: MopyonMark }[]): MopyonState {
  const state = createMopyonState();
  const board = [...state.board];
  for (const { row, column, mark } of marks) {
    board[row * MOPYON_BOARD_SIZE + column] = mark;
  }
  return { ...state, board, currentPlayer: 'O' };
}

function winningReplies(state: MopyonState, mark: MopyonMark): number[] {
  if (state.winner || state.isDraw) return [];
  const replies: number[] = [];
  for (let index = 0; index < state.board.length; index += 1) {
    if (state.board[index] !== null) continue;
    const next = playMopyonMove(
      { ...state, currentPlayer: mark },
      Math.floor(index / MOPYON_BOARD_SIZE),
      index % MOPYON_BOARD_SIZE,
    );
    if (next.winner === mark) replies.push(index);
  }
  return replies;
}

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

test('Mòpyon practice bot takes a winning move immediately', () => {
  const state = botPosition([
    ...[4, 5, 6, 7].map((column) => ({ row: 7, column, mark: 'O' as const })),
    { row: 3, column: 2, mark: 'X' },
  ]);

  assert.equal(chooseMopyonBotMove(state), 7 * MOPYON_BOARD_SIZE + 3);
});

test('Mòpyon challenging bot completes a diagonal win from the corner', () => {
  const state = botPosition([
    ...[1, 2, 3, 4].map((step) => ({ row: step, column: step, mark: 'O' as const })),
    { row: 0, column: MOPYON_BOARD_SIZE - 1, mark: 'X' },
  ]);

  const move = chooseMopyonBotMove(state);
  assert.equal(move, 0);
  const won = playMopyonMove(state, 0, 0);
  assert.equal(won.winner, 'O');
  assert.ok(won.winningLine?.includes(0));
});

test('Mòpyon practice bot blocks the opponent’s only immediate win', () => {
  const state = botPosition([
    { row: 7, column: 1, mark: 'O' },
    ...[2, 3, 4, 5].map((column) => ({ row: 7, column, mark: 'X' as const })),
    { row: 4, column: 8, mark: 'O' },
  ]);

  assert.equal(chooseMopyonBotMove(state), 7 * MOPYON_BOARD_SIZE + 6);
});

test('Mòpyon practice bot builds a line and opens in the center', () => {
  const openLine = botPosition([
    ...[6, 7, 8].map((column) => ({ row: 7, column, mark: 'O' as const })),
    { row: 2, column: 2, mark: 'X' },
  ]);
  const move = chooseMopyonBotMove(openLine);
  assert.ok(move === 7 * MOPYON_BOARD_SIZE + 5 || move === 7 * MOPYON_BOARD_SIZE + 9);
  assert.equal(chooseMopyonBotMove(createMopyonState()), 7 * MOPYON_BOARD_SIZE + 7);
});

test('Mòpyon challenging bot creates a fork from the corner', () => {
  const state = botPosition([
    ...[1, 2, 3].map((step) => ({ row: 0, column: step, mark: 'O' as const })),
    ...[1, 2, 3].map((step) => ({ row: step, column: 0, mark: 'O' as const })),
    { row: MOPYON_BOARD_SIZE - 1, column: MOPYON_BOARD_SIZE - 1, mark: 'X' },
  ]);

  const move = chooseMopyonBotMove(state);
  assert.notEqual(move, null);
  const row = Math.floor(move! / MOPYON_BOARD_SIZE);
  const column = move! % MOPYON_BOARD_SIZE;
  assert.ok(row === 0 || column === 0, 'the fork should be created on the top or left edge');
  const afterMove = playMopyonMove(state, row, column);
  assert.equal(afterMove.winner, null);
  assert.ok(winningReplies(afterMove, 'O').length >= 2);
});

test('Mòpyon challenging bot blocks an opponent win along the board edge', () => {
  const state = botPosition([
    ...[0, 1, 2, 3].map((column) => ({ row: 0, column, mark: 'X' as const })),
    { row: MOPYON_BOARD_SIZE - 1, column: MOPYON_BOARD_SIZE - 1, mark: 'O' },
  ]);
  const threatsBeforeMove = winningReplies(state, 'X');

  assert.deepEqual(threatsBeforeMove, [4]);
  const move = chooseMopyonBotMove(state);
  assert.equal(move, threatsBeforeMove[0]);

  const afterMove = playMopyonMove(state, Math.floor(move! / MOPYON_BOARD_SIZE), move! % MOPYON_BOARD_SIZE);
  assert.equal(afterMove.winner, null);
  assert.deepEqual(winningReplies(afterMove, 'X'), []);
});

test('Mòpyon practice bot returns no move after the game ends', () => {
  let state = createMopyonState();
  for (let column = 0; column < 5; column += 1) {
    if (column > 0) state = playMopyonMove(state, 0, column);
    state = playMopyonMove(state, 8, column);
  }

  assert.equal(state.winner, 'X');
  assert.equal(chooseMopyonBotMove(state), null);
});
