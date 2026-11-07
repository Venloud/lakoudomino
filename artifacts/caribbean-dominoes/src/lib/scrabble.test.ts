import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canRestoreScrabbleDraft, createScrabbleGame, exchangeScrabbleTiles, hasScrabbleDraft, passScrabbleTurn, playScrabbleWord, SCRABBLE_SIZE, shouldRecoverScrabbleDraft, type ScrabbleGame } from './scrabble';

const fixture = (overrides: Partial<ScrabbleGame> = {}): ScrabbleGame => ({
  board: Array(SCRABBLE_SIZE * SCRABBLE_SIZE).fill(null),
  racks: [['C', 'A', 'T', 'S', 'E', 'R', 'N'], ['T', 'A', 'R', 'E', 'S', 'N', 'O']],
  bag: [],
  bagCount: overrides.bagCount ?? overrides.bag?.length ?? 0,
  scores: [0, 0],
  turn: 0,
  playerCount: 2,
  passes: 0,
  winner: null,
  ...overrides,
});

describe('Scrabble foundation', () => {
  it('preserves a draft for remote updates and restores rack selections only when the rack matches', () => {
    const game = createScrabbleGame(() => 0.5);
    const draft = {
      word: 'WORD',
      start: 112,
      direction: 'vertical' as const,
      selectedRackTiles: [0, 2],
      player: 0 as const,
      rack: [...game.racks[0]],
    };
    assert.equal(hasScrabbleDraft(draft), true);
    assert.equal(canRestoreScrabbleDraft(draft, game), true);
    assert.equal(canRestoreScrabbleDraft(draft, { ...game, turn: 1 }), true);
    assert.equal(canRestoreScrabbleDraft(draft, {
      ...game,
      racks: game.racks.map((rack, index) => index === 0 ? [...rack.slice(1), 'A'] : rack),
    }), false);
    assert.equal(hasScrabbleDraft({ word: ' ', selectedRackTiles: [] }), false);
    assert.equal(shouldRecoverScrabbleDraft(game, game, draft), false);
    assert.equal(shouldRecoverScrabbleDraft(game, { ...game, turn: 1 }, draft), true);
    assert.equal(shouldRecoverScrabbleDraft(game, { ...game, turn: 1 }, { word: ' ', selectedRackTiles: [] }), false);
  });

  it('deals seven tiles to each player from a 100-tile bag', () => {
    const game = createScrabbleGame(() => 0.5);
    assert.equal(game.racks[0].length, 7);
    assert.equal(game.racks[1].length, 7);
    assert.equal(game.bag.length, 86);
    assert.equal(game.bagCount, 86);
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
    assert.equal(exchanged.game.bagCount, 86);
    assert.equal(exchanged.game.turn, 1);
    assert.match(exchangeScrabbleTiles({ ...game, bag: [], bagCount: 0 }, ['A']).error ?? '', /at least 7/);
  });

  it('keeps online bag counts separate from hidden tile identities during moves', () => {
    const online = fixture({ bag: [], bagCount: 10 });
    const word = playScrabbleWord(online, { word: 'CAT', row: 7, col: 6, direction: 'horizontal' });
    assert.ok(word.game);
    assert.deepEqual(word.game.racks[0], ['S', 'E', 'R', 'N']);
    assert.equal(word.game.racks[0].includes(''), false);
    assert.equal(word.game.bag.length, 0);
    assert.equal(word.game.bagCount, 7);

    const passed = passScrabbleTurn(online);
    assert.deepEqual(passed.racks[0], online.racks[0]);
    assert.equal(passed.bag.length, 0);
    assert.equal(passed.bagCount, 10);

    const exchanged = exchangeScrabbleTiles(online, ['C']);
    assert.ok(exchanged.game);
    assert.equal(exchanged.game.racks[0].length, 6);
    assert.equal(exchanged.game.racks[0].includes(''), false);
    assert.equal(exchanged.game.bag.length, 0);
    assert.equal(exchanged.game.bagCount, 10);
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
