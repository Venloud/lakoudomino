import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFillerBoard, FILLER_COLOR_COUNT, FILLER_SIZE, playFillerMove } from './filler';

describe('Filler', () => {
  it('starts players in opposite corners on a randomized six-color board', () => {
    let next = 0;
    const board = createFillerBoard(() => ((next++ % FILLER_COLOR_COUNT) + 0.1) / FILLER_COLOR_COUNT);
    assert.equal(board.colors.length, FILLER_SIZE * FILLER_SIZE);
    assert.equal(board.owners[0], 0);
    assert.equal(board.owners.at(-1), 1);
    assert.notEqual(board.colors[0], board.colors.at(-1));
    assert.ok(board.colors.every((color) => color >= 0 && color < FILLER_COLOR_COUNT));
  });

  it('rejects both current region colors and invalid palette values', () => {
    const board = {
      colors: Array(64).fill(4),
      owners: Array(64).fill(null) as (0 | 1 | null)[],
    };
    board.owners[0] = 0;
    board.owners[63] = 1;
    board.colors[0] = 0;
    board.colors[63] = 1;
    assert.equal(playFillerMove(board, 0, 0), null);
    assert.equal(playFillerMove(board, 0, 1), null);
    assert.equal(playFillerMove(board, 0, 6), null);
  });

  it('floods connected cells of the selected color but not the opponent territory', () => {
    const colors = Array(64).fill(3);
    colors[0] = 0;
    colors[63] = 1;
    colors[1] = 2;
    colors[2] = 2;
    const owners = Array(64).fill(null) as (0 | 1 | null)[];
    owners[0] = 0;
    owners[63] = 1;
    owners[62] = 1;
    const result = playFillerMove({ colors, owners }, 0, 2);
    assert.ok(result);
    assert.equal(result.owners[1], 0);
    assert.equal(result.owners[2], 0);
    assert.equal(result.owners[62], 1);
    assert.equal(result.winner, null);
  });

  it('ends with the player holding more cells, or a draw on a tie', () => {
    const colors = Array(64).fill(0);
    const owners = Array(64).fill(0) as (0 | 1 | null)[];
    owners[63] = 1;
    colors[0] = 1;
    colors[63] = 0;
    const win = playFillerMove({ colors, owners }, 0, 2);
    assert.equal(win?.winner, 0);

    const tieOwners = Array(64).fill(1) as (0 | 1 | null)[];
    tieOwners[0] = 0;
    tieOwners[1] = null;
    tieOwners.fill(0, 2, 32);
    const tieColors = Array(64).fill(3);
    tieColors[0] = 0;
    tieColors[1] = 2;
    tieColors[63] = 1;
    const draw = playFillerMove({ colors: tieColors, owners: tieOwners }, 0, 2);
    assert.equal(draw?.winner, 2);
  });
});
