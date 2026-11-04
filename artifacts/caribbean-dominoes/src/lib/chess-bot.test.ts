import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { chooseChessBotMove } from './chess-bot';

test('Yard bot returns a legal move when Black is to play', () => {
  const game = new Chess();
  game.move('e4');
  const move = chooseChessBotMove(game.fen(), 'b');
  assert.ok(move);
  assert.ok(game.moves().includes(`${move.from}${move.to}${move.promotion ?? ''}`) ||
    game.moves({ verbose: true }).some((candidate) => candidate.from === move.from && candidate.to === move.to));
});

test('Yard bot finds a checkmate in one', () => {
  const game = new Chess('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2');
  const move = chooseChessBotMove(game.fen(), 'b');
  assert.ok(move);
  game.move(move);
  assert.equal(game.isCheckmate(), true);
});
