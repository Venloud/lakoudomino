export type ChessSide = 0 | 1;
export type ChessPieceKind = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
export type ChessPiece = { side: ChessSide; kind: ChessPieceKind } | null;
export type CastlingRights = Record<ChessSide, { kingSide: boolean; queenSide: boolean }>;
export type ChessMove = { from: number; to: number };
export type ChessGame = {
  board: ChessPiece[];
  turn: ChessSide;
  castling: CastlingRights;
  enPassant: number | null;
  halfmoveClock?: number;
  positionHistory?: string[];
};
export type ChessStatus = 'playing' | 'check' | 'checkmate' | 'stalemate' | 'threefold-repetition' | 'fifty-move-rule' | 'insufficient-material';

const STARTING_ROW: ChessPieceKind[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
const PROMOTIONS: ChessPieceKind[] = ['Q', 'R', 'B', 'N'];

export function createChessGame(): ChessGame {
  const board: ChessPiece[] = Array(64).fill(null);
  for (let col = 0; col < 8; col++) {
    board[col] = { side: 1, kind: STARTING_ROW[col] };
    board[8 + col] = { side: 1, kind: 'P' };
    board[48 + col] = { side: 0, kind: 'P' };
    board[56 + col] = { side: 0, kind: STARTING_ROW[col] };
  }
  const game: ChessGame = {
    board,
    turn: 0,
    castling: {
      0: { kingSide: true, queenSide: true },
      1: { kingSide: true, queenSide: true },
    },
    enPassant: null,
    halfmoveClock: 0,
    positionHistory: [],
  };
  game.positionHistory = [positionKey(game)];
  return game;
}

function positionKey(game: ChessGame): string {
  const board = game.board.map((piece) => piece ? `${piece.side}${piece.kind}` : '--').join('');
  const castling = [0, 1].map((side) => {
    const rights = game.castling[side as ChessSide];
    return `${rights.kingSide ? 'k' : ''}${rights.queenSide ? 'q' : ''}`;
  }).join('|');
  return `${board}/${game.turn}/${castling}/${game.enPassant ?? '-'}`;
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function findKing(board: ChessPiece[], side: ChessSide): number {
  return board.findIndex((piece) => piece?.side === side && piece.kind === 'K');
}

export function isSquareAttacked(board: ChessPiece[], square: number, bySide: ChessSide): boolean {
  const row = Math.floor(square / 8);
  const col = square % 8;
  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || piece.side !== bySide) continue;
    const fromRow = Math.floor(from / 8);
    const fromCol = from % 8;
    const dr = row - fromRow;
    const dc = col - fromCol;
    switch (piece.kind) {
      case 'P':
        if (dr === (bySide === 0 ? -1 : 1) && Math.abs(dc) === 1) return true;
        break;
      case 'N':
        if (Math.abs(dr * dc) === 2) return true;
        break;
      case 'K':
        if (Math.max(Math.abs(dr), Math.abs(dc)) === 1) return true;
        break;
      case 'R':
        if ((dr === 0 || dc === 0) && isPathClear(board, from, square)) return true;
        break;
      case 'B':
        if (Math.abs(dr) === Math.abs(dc) && isPathClear(board, from, square)) return true;
        break;
      case 'Q':
        if ((dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc)) && isPathClear(board, from, square)) return true;
        break;
    }
  }
  return false;
}

export function isKingInCheck(board: ChessPiece[], side: ChessSide): boolean {
  const king = findKing(board, side);
  return king < 0 || isSquareAttacked(board, king, side === 0 ? 1 : 0);
}

function isPathClear(board: ChessPiece[], from: number, to: number): boolean {
  const fromRow = Math.floor(from / 8);
  const fromCol = from % 8;
  const toRow = Math.floor(to / 8);
  const toCol = to % 8;
  const dr = Math.sign(toRow - fromRow);
  const dc = Math.sign(toCol - fromCol);
  let row = fromRow + dr;
  let col = fromCol + dc;
  while (row !== toRow || col !== toCol) {
    if (board[row * 8 + col]) return false;
    row += dr;
    col += dc;
  }
  return true;
}

function applyBoardMove(board: ChessPiece[], move: ChessMove, enPassant: number | null): ChessPiece[] {
  const next = [...board];
  const moving = next[move.from];
  if (!moving) return next;
  const fromRow = Math.floor(move.from / 8);
  const fromCol = move.from % 8;
  const toRow = Math.floor(move.to / 8);
  const toCol = move.to % 8;

  if (moving.kind === 'P' && move.to === enPassant && fromCol !== toCol && !next[move.to]) {
    next[(toRow + (moving.side === 0 ? 1 : -1)) * 8 + toCol] = null;
  }
  next[move.to] = moving;
  next[move.from] = null;
  if (moving.kind === 'K' && Math.abs(toCol - fromCol) === 2) {
    const rookFrom = fromRow * 8 + (toCol > fromCol ? 7 : 0);
    const rookTo = fromRow * 8 + (toCol > fromCol ? 5 : 3);
    next[rookTo] = next[rookFrom];
    next[rookFrom] = null;
  }
  return next;
}

function pseudoLegalMoves(game: ChessGame, from: number): ChessMove[] {
  const piece = game.board[from];
  if (!piece || piece.side !== game.turn) return [];
  const row = Math.floor(from / 8);
  const col = from % 8;
  const moves: ChessMove[] = [];
  const add = (toRow: number, toCol: number) => {
    if (!inBounds(toRow, toCol)) return false;
    const to = toRow * 8 + toCol;
    const target = game.board[to];
    if (target?.side === piece.side || target?.kind === 'K') return false;
    moves.push({ from, to });
    return !target;
  };

  if (piece.kind === 'P') {
    const direction = piece.side === 0 ? -1 : 1;
    const startRow = piece.side === 0 ? 6 : 1;
    const oneRow = row + direction;
    if (inBounds(oneRow, col) && !game.board[oneRow * 8 + col]) {
      add(oneRow, col);
      const twoRow = row + direction * 2;
      if (row === startRow && !game.board[twoRow * 8 + col]) add(twoRow, col);
    }
    for (const dc of [-1, 1]) {
      const targetRow = row + direction;
      const targetCol = col + dc;
      if (!inBounds(targetRow, targetCol)) continue;
      const target = targetRow * 8 + targetCol;
      if (game.board[target]?.side === (piece.side === 0 ? 1 : 0) && game.board[target]?.kind !== 'K') {
        moves.push({ from, to: target });
      } else if (target === game.enPassant) {
        const adjacent = row * 8 + targetCol;
        if (game.board[adjacent]?.kind === 'P' && game.board[adjacent]?.side !== piece.side) moves.push({ from, to: target });
      }
    }
  } else if (piece.kind === 'N') {
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) add(row + dr, col + dc);
  } else if (piece.kind === 'K') {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr !== 0 || dc !== 0) add(row + dr, col + dc);
    }
    const homeRow = piece.side === 0 ? 7 : 0;
    const rights = game.castling[piece.side];
    const enemy = piece.side === 0 ? 1 : 0;
    if (row === homeRow && col === 4 && !isKingInCheck(game.board, piece.side)) {
      if (rights.kingSide && game.board[homeRow * 8 + 7]?.side === piece.side && game.board[homeRow * 8 + 7]?.kind === 'R'
        && !game.board[homeRow * 8 + 5] && !game.board[homeRow * 8 + 6]
        && !isSquareAttacked(game.board, homeRow * 8 + 5, enemy) && !isSquareAttacked(game.board, homeRow * 8 + 6, enemy)) {
        moves.push({ from, to: homeRow * 8 + 6 });
      }
      if (rights.queenSide && game.board[homeRow * 8]?.side === piece.side && game.board[homeRow * 8]?.kind === 'R'
        && !game.board[homeRow * 8 + 1] && !game.board[homeRow * 8 + 2] && !game.board[homeRow * 8 + 3]
        && !isSquareAttacked(game.board, homeRow * 8 + 3, enemy) && !isSquareAttacked(game.board, homeRow * 8 + 2, enemy)) {
        moves.push({ from, to: homeRow * 8 + 2 });
      }
    }
  } else {
    const directions = piece.kind === 'R'
      ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
      : piece.kind === 'B'
        ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
        : [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of directions) {
      let targetRow = row + dr;
      let targetCol = col + dc;
      while (inBounds(targetRow, targetCol)) {
        if (!add(targetRow, targetCol)) break;
        targetRow += dr;
        targetCol += dc;
      }
    }
  }
  return moves;
}

export function getLegalChessMoves(game: ChessGame, from?: number): ChessMove[] {
  const origins = from === undefined
    ? game.board.flatMap((piece, index) => piece?.side === game.turn ? [index] : [])
    : [from];
  return origins.flatMap((origin) => pseudoLegalMoves(game, origin)).filter((move) => {
    const moving = game.board[move.from];
    if (!moving) return false;
    const board = applyBoardMove(game.board, move, game.enPassant);
    return !isKingInCheck(board, moving.side);
  });
}

export function playChessMove(
  game: ChessGame,
  move: ChessMove,
  promotion: ChessPieceKind = 'Q',
): ChessGame | null {
  if (!getLegalChessMoves(game, move.from).some((candidate) => candidate.to === move.to)) return null;
  const moving = game.board[move.from];
  if (!moving) return null;
  const fromRow = Math.floor(move.from / 8);
  const fromCol = move.from % 8;
  const toRow = Math.floor(move.to / 8);
  const toCol = move.to % 8;
  const captured = game.board[move.to];
  const enPassantCapture = moving.kind === 'P' && move.to === game.enPassant
    && fromCol !== toCol && !captured;
  const nextBoard = applyBoardMove(game.board, move, game.enPassant);
  if (moving.kind === 'P' && (toRow === 0 || toRow === 7)) {
    nextBoard[move.to] = { side: moving.side, kind: PROMOTIONS.includes(promotion) ? promotion : 'Q' };
  }

  const castling: CastlingRights = {
    0: { ...game.castling[0] },
    1: { ...game.castling[1] },
  };
  if (moving.kind === 'K') {
    castling[moving.side] = { kingSide: false, queenSide: false };
  }
  if (moving.kind === 'R') {
    if (move.from === (moving.side === 0 ? 63 : 7)) castling[moving.side].kingSide = false;
    if (move.from === (moving.side === 0 ? 56 : 0)) castling[moving.side].queenSide = false;
  }
  if (captured?.kind === 'R') {
    if (move.to === (captured.side === 0 ? 63 : 7)) castling[captured.side].kingSide = false;
    if (move.to === (captured.side === 0 ? 56 : 0)) castling[captured.side].queenSide = false;
  }
  const enPassant = moving.kind === 'P' && Math.abs(toRow - fromRow) === 2
    ? ((fromRow + toRow) / 2) * 8 + toCol
    : null;
  const next: ChessGame = {
    board: nextBoard,
    turn: moving.side === 0 ? 1 : 0,
    castling,
    enPassant,
    halfmoveClock: moving.kind === 'P' || captured || enPassantCapture ? 0 : (game.halfmoveClock ?? 0) + 1,
  };
  next.positionHistory = [
    ...(game.positionHistory ?? [positionKey(game)]),
    positionKey(next),
  ];
  return next;
}

export function getChessStatus(game: ChessGame): ChessStatus {
  const inCheck = isKingInCheck(game.board, game.turn);
  const legalMoves = getLegalChessMoves(game);
  if (legalMoves.length === 0) return inCheck ? 'checkmate' : 'stalemate';
  const nonKings = game.board.filter((piece): piece is Exclude<ChessPiece, null> => piece !== null && piece.kind !== 'K');
  if (!nonKings.length ||
      (nonKings.length === 1 && ['B', 'N'].includes(nonKings[0].kind)) ||
      (nonKings.every((piece) => piece.kind === 'B') &&
        new Set(nonKings.map((_, index) => {
          const square = game.board.findIndex((piece) => piece === nonKings[index]);
          return (Math.floor(square / 8) + square % 8) % 2;
        })).size === 1)) {
    return 'insufficient-material';
  }
  if ((game.halfmoveClock ?? 0) >= 100) return 'fifty-move-rule';
  const currentPosition = positionKey(game);
  if ((game.positionHistory ?? [currentPosition]).filter((position) => position === currentPosition).length >= 3) {
    return 'threefold-repetition';
  }
  return inCheck ? 'check' : 'playing';
}
