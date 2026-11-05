import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createChessGame,
  getChessStatus,
  getLegalChessMoves,
  isKingInCheck,
  playChessMove,
  type ChessGame,
  type ChessPiece,
  type ChessPieceKind,
  type ChessSide,
} from './chess.ts';

function position(
  pieces: Array<[number, ChessSide, ChessPieceKind]>,
  turn: ChessSide = 0,
  castling: ChessGame['castling'] = {
    0: { kingSide: false, queenSide: false },
    1: { kingSide: false, queenSide: false },
  },
  enPassant: number | null = null,
): ChessGame {
  const board: ChessPiece[] = Array(64).fill(null);
  for (const [square, side, kind] of pieces) board[square] = { side, kind };
  return { board, turn, castling, enPassant };
}

function move(game: ChessGame, from: number, to: number, promotion?: ChessPieceKind): ChessGame {
  const next = playChessMove(game, { from, to }, promotion);
  assert.ok(next, `Expected legal move ${from} to ${to}`);
  return next;
}

test('the initial position has 20 legal moves and never allows capturing the king', () => {
  const game = createChessGame();
  assert.equal(getLegalChessMoves(game).length, 20);
  assert.equal(getLegalChessMoves(game, 60).some(({ to }) => to === 4), false);
});

test('a pinned piece cannot move if it would expose its king', () => {
  const game = position([
    [60, 0, 'K'], [52, 0, 'R'], [4, 1, 'R'], [0, 1, 'K'],
  ]);
  const rookMoves = getLegalChessMoves(game, 52).map(({ to }) => to);
  assert.ok(rookMoves.includes(44));
  assert.equal(rookMoves.includes(51), false);
});

test('checkmate ends the game and stalemate is a draw', () => {
  let game = createChessGame();
  game = move(game, 52, 36);
  game = move(game, 12, 28);
  game = move(game, 59, 31);
  game = move(game, 1, 18);
  game = move(game, 61, 34);
  game = move(game, 6, 21);
  game = move(game, 31, 13);
  assert.equal(getChessStatus(game), 'checkmate');
  assert.equal(isKingInCheck(game.board, game.turn), true);

  const stalemate = position([[7, 1, 'K'], [13, 0, 'K'], [22, 0, 'Q']], 1);
  assert.equal(getChessStatus(stalemate), 'stalemate');
});

test('threefold repetition ends the game automatically', () => {
  let game = createChessGame();
  for (let cycle = 0; cycle < 2; cycle++) {
    game = move(game, 62, 45);
    game = move(game, 6, 21);
    game = move(game, 45, 62);
    game = move(game, 21, 6);
  }
  assert.equal(getChessStatus(game), 'threefold-repetition');
});

test('the 50-move rule ends after 100 quiet half-moves and resets on a pawn move', () => {
  const quietPosition = { ...position([[60, 0, 'K'], [4, 1, 'K'], [0, 0, 'R']]), halfmoveClock: 99 };
  const afterQuietMove = move(quietPosition, 0, 8);
  assert.equal(afterQuietMove.halfmoveClock, 100);
  assert.equal(getChessStatus(afterQuietMove), 'fifty-move-rule');

  const pawnPosition = { ...position([[60, 0, 'K'], [4, 1, 'K'], [52, 0, 'P']]), halfmoveClock: 99 };
  const afterPawnMove = move(pawnPosition, 52, 44);
  assert.equal(afterPawnMove.halfmoveClock, 0);
  assert.notEqual(getChessStatus(afterPawnMove), 'fifty-move-rule');

  const capturePosition = { ...position([[60, 0, 'K'], [4, 1, 'K'], [0, 0, 'R'], [8, 1, 'N']]), halfmoveClock: 99 };
  assert.equal(move(capturePosition, 0, 8).halfmoveClock, 0);
});

test('kings with insufficient minor material end the game automatically', () => {
  assert.equal(getChessStatus(position([[60, 0, 'K'], [4, 1, 'K']])), 'insufficient-material');
  assert.equal(getChessStatus(position([[60, 0, 'K'], [4, 1, 'K'], [42, 0, 'B']])), 'insufficient-material');
  assert.equal(getChessStatus(position([[60, 0, 'K'], [4, 1, 'K'], [42, 0, 'N']])), 'insufficient-material');
  assert.equal(getChessStatus(position([[60, 0, 'K'], [4, 1, 'K'], [42, 0, 'B'], [26, 1, 'B']])), 'insufficient-material');
});

test('castling moves the rook and is forbidden through an attacked square', () => {
  const rights: ChessGame['castling'] = {
    0: { kingSide: true, queenSide: true },
    1: { kingSide: false, queenSide: false },
  };
  const clear = position([[60, 0, 'K'], [63, 0, 'R'], [4, 1, 'K']], 0, rights);
  assert.ok(getLegalChessMoves(clear, 60).some(({ to }) => to === 62));
  const castled = move(clear, 60, 62);
  assert.deepEqual(castled.board[61], { side: 0, kind: 'R' });
  assert.equal(castled.board[63], null);
  assert.equal(castled.castling[0].kingSide, false);

  const throughCheck = position([[60, 0, 'K'], [63, 0, 'R'], [4, 1, 'K'], [5, 1, 'R']], 0, rights);
  assert.equal(getLegalChessMoves(throughCheck, 60).some(({ to }) => to === 62), false);
});

test('castling rights are lost permanently when the rook moves', () => {
  const rights: ChessGame['castling'] = {
    0: { kingSide: true, queenSide: false },
    1: { kingSide: false, queenSide: false },
  };
  let game = position([[60, 0, 'K'], [63, 0, 'R'], [4, 1, 'K']], 0, rights);
  game = move(game, 63, 55);
  game = move(game, 4, 3);
  game = move(game, 55, 63);
  assert.equal(game.castling[0].kingSide, false);
  assert.equal(getLegalChessMoves(game, 60).some(({ to }) => to === 62), false);
});

test('en passant is available for one reply and removes the bypassed pawn', () => {
  const game = position([[60, 0, 'K'], [4, 1, 'K'], [28, 0, 'P'], [27, 1, 'P']], 0, undefined, 19);
  assert.ok(getLegalChessMoves(game, 28).some(({ to }) => to === 19));
  const captured = move(game, 28, 19);
  assert.deepEqual(captured.board[19], { side: 0, kind: 'P' });
  assert.equal(captured.board[27], null);
  assert.equal(captured.enPassant, null);
});

test('en passant is illegal when removing both pawns exposes the king', () => {
  const game = position([
    [31, 0, 'K'], [30, 0, 'P'], [24, 1, 'R'], [29, 1, 'P'], [4, 1, 'K'],
  ], 0, undefined, 21);
  assert.equal(getLegalChessMoves(game, 30).some(({ to }) => to === 21), false);
});

test('promotion supports all standard choices and defaults to a queen', () => {
  const game = position([[60, 0, 'K'], [7, 1, 'K'], [8, 0, 'P']]);
  assert.deepEqual(move(game, 8, 0, 'N').board[0], { side: 0, kind: 'N' });
  assert.deepEqual(move(game, 8, 0).board[0], { side: 0, kind: 'Q' });
  assert.deepEqual(move(game, 8, 0, 'B').board[0], { side: 0, kind: 'B' });
  assert.deepEqual(move(game, 8, 0, 'R').board[0], { side: 0, kind: 'R' });
});
