import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScrabbleGame, exchangeScrabbleTiles, passScrabbleTurn, playScrabbleWord, SCRABBLE_SIZE, type ScrabbleGame } from './scrabble';

const fixture = (overrides: Partial<ScrabbleGame> = {}): ScrabbleGame => ({
  board: Array(SCRABBLE_SIZE * SCRABBLE_SIZE).fill(null),
  racks: [['C', 'A', 'T', 'S', 'E', 'R', 'N'], ['T', 'A', 'R', 'E', 'S', 'N', 'O']],
  bag: [],
  scores: [0, 0],
  turn: 0,
  playerCount: 2,
  passes: 0,
  winner: null,
  ...overrides,
});

describe('Scrabble foundation', () => {
  it('deals seven tiles to each player from a 100-tile bag', () => {
    const game = createScrabbleGame(() => 0.5);
    assert.equal(game.racks[0].length, 7);
    assert.equal(game.racks[1].length, 7);
    assert.equal(game.bag.length, 86);
  });

  it('supports a four-player deal and cycles turns around all seats', () => {
    let game = createScrabbleGame(() => 0.5, 4);
    assert.equal(game.racks.length, 4);
    assert.equal(game.racks.every((rack) => rack.length === 7), true);
    assert.equal(game.bag.length, 72);
    game = passScrabbleTurn(game);
    game = passScrabbleTurn(game);
    game = passScrabbleTurn(game);
    assert.equal(game.turn, 3);
    game = passScrabbleTurn(game);
    assert.equal(game.turn, 0);
  });

  it('exchanges selected tiles only when at least seven tiles remain', () => {
    const game = createScrabbleGame(() => 0.5);
    const exchanged = exchangeScrabbleTiles(game, [game.racks[0][0]], () => 0.5);
    assert.ok(exchanged.game);
    assert.equal(exchanged.game.racks[0].length, 7);
    assert.equal(exchanged.game.bag.length, 86);
    assert.equal(exchanged.game.turn, 1);
    assert.match(exchangeScrabbleTiles({ ...game, bag: [] }, ['A']).error ?? '', /at least 7/);
  });

  it('requires the first word to cover the center and scores its double-word square', () => {
    const invalid = playScrabbleWord(fixture(), { word: 'CAT', row: 0, col: 0, direction: 'horizontal' });
    assert.match(invalid.error ?? '', /center star/);
    const valid = playScrabbleWord(fixture(), { word: 'CAT', row: 7, col: 6, direction: 'horizontal' });
    assert.ok(valid.game);
    assert.equal(valid.game.scores[0], 10);
    assert.equal(valid.game.board[7 * SCRABBLE_SIZE + 7]?.letter, 'A');
    assert.equal(valid.game.turn, 1);
  });

  it('lets later words connect by matching existing tiles and rejects disconnected plays', () => {
    const first = playScrabbleWord(fixture(), { word: 'CAT', row: 7, col: 6, direction: 'horizontal' });
    assert.ok(first.game);
    const connected = playScrabbleWord({ ...first.game, turn: 1 }, { word: 'ATE', row: 7, col: 7, direction: 'vertical' });
    assert.ok(connected.game);
    assert.equal(connected.game.board[9 * SCRABBLE_SIZE + 7]?.letter, 'E');
    const disconnected = playScrabbleWord({ ...first.game, turn: 1 }, { word: 'TAR', row: 0, col: 0, direction: 'horizontal' });
    assert.match(disconnected.error ?? '', /connect/);
  });

  it('ends the game after four consecutive passes and subtracts leftover rack points', () => {
    let game = fixture({ scores: [20, 15] });
    game = passScrabbleTurn(game);
    game = passScrabbleTurn(game);
    game = passScrabbleTurn(game);
    game = passScrabbleTurn(game);
    assert.notEqual(game.winner, null);
    assert.ok(game.scores[0] < 20);
    assert.ok(game.scores[1] < 15);
  });
});
