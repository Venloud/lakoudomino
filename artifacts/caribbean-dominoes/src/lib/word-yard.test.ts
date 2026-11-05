import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWordGame,
  clearSavedWordGame,
  evaluateWordPlay,
  loadSavedWordGame,
  passWordTurn,
  playWordTurn,
  resolveWordChallenge,
  saveWordGame,
  WORD_GAME_STORAGE_KEY,
  WORD_CENTER,
  WORD_RACK_SIZE,
} from './word-yard.ts';
import type { WordBoard, WordGameState, WordPlayer } from './word-yard.ts';

const dictionary = new Set(['AR', 'ARC', 'AT', 'CAT', 'DOG', 'GO', 'GOD', 'HI', 'IT', 'READERS', 'TO', 'TAR']);
const blankBoard = (): WordBoard => Array(225).fill(null);
const position = (row: number, col: number) => row * 15 + col;
const tile = (letter: string, owner: WordPlayer = 0) => ({ letter, owner, blank: false });
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('creates a complete 100-tile bag and two seven-tile racks', () => {
  const game = createWordGame(() => 0.5);
  assert.equal(game.racks[0].length, WORD_RACK_SIZE);
  assert.equal(game.racks[1].length, WORD_RACK_SIZE);
  assert.equal(game.bag.length + game.racks[0].length + game.racks[1].length, 100);
  assert.equal(game.bag.filter((letter) => letter === '?').length +
    game.racks.flat().filter((letter) => letter === '?').length, 2);
});

test('requires the opening word to cover the center and scores the center double word', () => {
  const board = blankBoard();
  const rack = ['C', 'A', 'T'];
  const invalid = evaluateWordPlay(board, rack, [
    { index: position(7, 4), rackIndex: 0, letter: 'C' },
    { index: position(7, 5), rackIndex: 1, letter: 'A' },
    { index: position(7, 6), rackIndex: 2, letter: 'T' },
  ], 'horizontal', dictionary);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.reason, /center/i);

  const valid = evaluateWordPlay(board, rack, [
    { index: position(7, 6), rackIndex: 0, letter: 'C' },
    { index: WORD_CENTER, rackIndex: 1, letter: 'A' },
    { index: position(7, 8), rackIndex: 2, letter: 'T' },
  ], 'horizontal', dictionary);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.score, 10);
    assert.deepEqual(valid.words, ['CAT']);
  }
});

test('scores a cross-word and rejects any invalid cross-word', () => {
  const board = blankBoard();
  board[position(7, 7)] = tile('R');
  board[position(7, 8)] = tile('C');
  board[position(6, 6)] = tile('C');
  board[position(8, 6)] = tile('T');
  const placement = [{ index: position(7, 6), rackIndex: 0, letter: 'A' }];

  const valid = evaluateWordPlay(board, ['A'], placement, 'horizontal', dictionary);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.deepEqual(valid.words, ['ARC', 'CAT']);
    assert.equal(valid.score, 10);
  }

  const rejected = evaluateWordPlay(board, ['A'], placement, 'horizontal', new Set(['ARC']));
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.reason, /CAT/);
});

test('allows a provisional word so the opponent can challenge it', () => {
  const initial = createWordGame(() => 0.5);
  const state: WordGameState = {
    ...initial,
    racks: [['Z', 'Z', 'A', 'B', 'C', 'D', 'E'], initial.racks[1]],
  };
  const placements = [
    { index: WORD_CENTER, rackIndex: 0, letter: 'Z' },
    { index: WORD_CENTER + 1, rackIndex: 1, letter: 'Z' },
  ];
  assert.equal(playWordTurn(state, placements, 'horizontal', dictionary).ok, false);
  const provisional = playWordTurn(state, placements, 'horizontal', dictionary, () => 0, true);
  assert.equal(provisional.ok, true);
  if (provisional.ok) assert.deepEqual(provisional.words, ['ZZ']);
});

test('applies a letter premium and the seven-tile bonus', () => {
  const board = blankBoard();
  board[position(0, 2)] = tile('C');
  board[position(0, 4)] = tile('T');
  const doubleLetter = evaluateWordPlay(board, ['A'], [
    { index: position(0, 3), rackIndex: 0, letter: 'A' },
  ], 'horizontal', dictionary);
  assert.equal(doubleLetter.ok, true);
  if (doubleLetter.ok) assert.equal(doubleLetter.score, 6);

  const bingo = evaluateWordPlay(blankBoard(), [...'READERS'], [...'READERS'].map((letter, rackIndex) => ({
    index: position(7, 4 + rackIndex),
    rackIndex,
    letter,
  })), 'horizontal', dictionary);
  assert.equal(bingo.ok, true);
  if (bingo.ok) assert.equal(bingo.score, 66);
});

test('rejects disconnected, gapped, mismatched, and repeated rack placements', () => {
  const board = blankBoard();
  board[position(7, 7)] = tile('A');
  const disconnected = evaluateWordPlay(board, ['C', 'A'], [
    { index: position(2, 2), rackIndex: 0, letter: 'C' },
    { index: position(2, 3), rackIndex: 1, letter: 'A' },
  ], 'horizontal', dictionary);
  assert.equal(disconnected.ok, false);

  const gapped = evaluateWordPlay(blankBoard(), ['C', 'T'], [
    { index: position(7, 6), rackIndex: 0, letter: 'C' },
    { index: position(7, 8), rackIndex: 1, letter: 'T' },
  ], 'horizontal', dictionary);
  assert.equal(gapped.ok, false);

  const repeatedRack = evaluateWordPlay(blankBoard(), ['C'], [
    { index: position(7, 6), rackIndex: 0, letter: 'C' },
    { index: WORD_CENTER, rackIndex: 0, letter: 'C' },
  ], 'horizontal', dictionary);
  assert.equal(repeatedRack.ok, false);
});

test('draws replacement tiles and ends after two passes with leftover tile deductions', () => {
  const created = createWordGame(() => 0);
  const first: WordGameState = { ...created, racks: [['C', 'A', 'T', 'S', 'E', 'R', 'N'], created.racks[1]] };
  const firstTurn = playWordTurn(first, [
    { index: position(7, 6), rackIndex: 0, letter: 'C' },
    { index: WORD_CENTER, rackIndex: 1, letter: 'A' },
    { index: position(7, 8), rackIndex: 2, letter: 'T' },
  ], 'horizontal', dictionary, () => 0);
  assert.equal(firstTurn.ok, true);
  if (!firstTurn.ok) return;
  assert.equal(firstTurn.state.racks[0].length, WORD_RACK_SIZE);
  assert.equal(firstTurn.state.bag.length, first.bag.length - 3);

  const state: WordGameState = {
    ...first,
    racks: [['A'], ['T']],
    scores: [10, 10],
    bag: [],
  };
  const afterFirstPass = passWordTurn(state);
  assert.equal(afterFirstPass.status, 'playing');
  const ended = passWordTurn(afterFirstPass);
  assert.equal(ended.status, 'finished');
  assert.equal(ended.endReason, 'passes');
  assert.deepEqual(ended.scores, [9, 9]);
  assert.equal(ended.winner, 2);
});

test('successful challenges restore the play and give the challenged turn away', () => {
  const beforePlay = { ...createWordGame(() => 0.5), turn: 0 as const, scores: [0, 0] as [number, number] };
  const playedState = { ...beforePlay, turn: 1 as const, scores: [8, 0] as [number, number] };
  const result = resolveWordChallenge(beforePlay, playedState, true);
  assert.deepEqual(result.board, beforePlay.board);
  assert.deepEqual(result.racks, beforePlay.racks);
  assert.deepEqual(result.scores, beforePlay.scores);
  assert.equal(result.turn, 1);
  assert.equal(result.consecutivePasses, 0);
});

test('failed challenges keep the word and make the challenger lose their turn', () => {
  const beforePlay = { ...createWordGame(() => 0.5), turn: 0 as const, scores: [0, 0] as [number, number] };
  const playedState = { ...beforePlay, turn: 1 as const, scores: [8, 0] as [number, number] };
  const result = resolveWordChallenge(beforePlay, playedState, false);
  assert.equal(result.board, playedState.board);
  assert.deepEqual(result.scores, playedState.scores);
  assert.equal(result.turn, 0);
});

test('saves and restores the complete in-progress match state', () => {
  const storage = memoryStorage();
  const initial = createWordGame(() => 0.5);
  const match: WordGameState = {
    ...initial,
    turn: 1,
    scores: [24, 11],
    consecutivePasses: 1,
    board: [...initial.board],
  };
  match.board[WORD_CENTER] = tile('A');
  match.racks[0].pop();

  assert.equal(saveWordGame(match, storage), true);
  assert.deepEqual(loadSavedWordGame(storage), match);
});

test('a new match replaces the saved match and can be explicitly cleared', () => {
  const storage = memoryStorage();
  const first = createWordGame(() => 0);
  const next: WordGameState = { ...createWordGame(() => 0.5), scores: [6, 2], turn: 1 };
  assert.equal(saveWordGame(first, storage), true);
  assert.equal(saveWordGame(next, storage), true);
  assert.deepEqual(loadSavedWordGame(storage), next);

  assert.equal(clearSavedWordGame(storage), true);
  assert.equal(storage.getItem(WORD_GAME_STORAGE_KEY), null);
  assert.equal(loadSavedWordGame(storage), null);
});

test('finished and malformed saved matches are never restored', () => {
  const storage = memoryStorage();
  const game = createWordGame(() => 0);
  const finished = passWordTurn(passWordTurn(game));
  assert.equal(finished.status, 'finished');
  assert.equal(saveWordGame(finished, storage), true);
  assert.equal(loadSavedWordGame(storage), null);

  storage.setItem(WORD_GAME_STORAGE_KEY, '{broken json');
  assert.equal(loadSavedWordGame(storage), null);
  assert.equal(storage.getItem(WORD_GAME_STORAGE_KEY), null);

  storage.setItem(WORD_GAME_STORAGE_KEY, JSON.stringify({ version: 1, state: finished }));
  assert.equal(loadSavedWordGame(storage), null);
  assert.equal(storage.getItem(WORD_GAME_STORAGE_KEY), null);
});
