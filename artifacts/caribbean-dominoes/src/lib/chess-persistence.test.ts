import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { CHESS_MATCH_STORAGE_KEY, clearSavedChessMatch, loadSavedChessMatch, saveChessMatch } from './chess-persistence.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const settings = {
  promotionMove: null,
  clocks: [480_000, 600_000] as [number, number],
  playVsBot: true,
  humanColor: 'b' as const,
  botDifficulty: 'hard' as const,
  clockPreset: 'custom',
  customClockMinutes: 8,
  customClockIncrement: 2,
};

test('save and restore preserves turn, castling rights, en passant, and bot settings', () => {
  const storage = memoryStorage();
  const game = new Chess();
  for (const san of ['e4', 'a6', 'e5', 'd5']) game.move(san);
  assert.equal(saveChessMatch(storage, game, settings), true);
  const restored = loadSavedChessMatch(storage);
  assert.ok(restored);
  assert.equal(restored.game.fen(), game.fen());
  assert.equal(restored.game.turn(), 'w');
  assert.equal(restored.game.fen().split(' ')[2], 'KQkq');
  assert.equal(restored.game.fen().split(' ')[3], 'd6');
  assert.deepEqual(restored.clocks, settings.clocks);
  assert.equal(restored.playVsBot, true);
  assert.equal(restored.humanColor, 'b');
});

test('save and restore retains castling rights after castling and pending promotion', () => {
  const storage = memoryStorage();
  const castled = new Chess();
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']) castled.move(san);
  assert.equal(saveChessMatch(storage, castled, settings), true);
  assert.equal(loadSavedChessMatch(storage)?.game.fen().split(' ')[2], 'kq');

  const promotionPosition = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const promotionGame = new Chess(promotionPosition);
  const pending = { ...settings, promotionMove: { from: 8, to: 0 } };
  assert.equal(saveChessMatch(storage, promotionGame, pending, promotionPosition), true);
  assert.deepEqual(loadSavedChessMatch(storage)?.promotionMove, pending.promotionMove);
});

test('invalid and finished matches are discarded instead of restored', () => {
  const storage = memoryStorage();
  storage.setItem(CHESS_MATCH_STORAGE_KEY, JSON.stringify({ version: 1, fen: 'not a FEN', moves: [] }));
  assert.equal(loadSavedChessMatch(storage), null);
  assert.equal(storage.getItem(CHESS_MATCH_STORAGE_KEY), null);

  const finished = new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
  storage.setItem(CHESS_MATCH_STORAGE_KEY, 'old unfinished record');
  assert.equal(saveChessMatch(storage, finished, settings), false);
  assert.equal(loadSavedChessMatch(storage), null);

  const completedFromStart = new Chess();
  for (const san of ['f3', 'e5', 'g4', 'Qh4#']) completedFromStart.move(san);
  storage.setItem(CHESS_MATCH_STORAGE_KEY, JSON.stringify({
    version: 1,
    startFen: new Chess().fen(),
    fen: completedFromStart.fen(),
    moves: completedFromStart.history(),
    ...settings,
  }));
  assert.equal(loadSavedChessMatch(storage), null);
  assert.equal(storage.getItem(CHESS_MATCH_STORAGE_KEY), null);
});

test('saved match can be explicitly cleared', () => {
  const storage = memoryStorage();
  saveChessMatch(storage, new Chess(), settings);
  clearSavedChessMatch(storage);
  assert.equal(storage.getItem(CHESS_MATCH_STORAGE_KEY), null);
});
