export type DameSide = 0 | 1;
export type DamePiece = { side: DameSide; kind: 'D' | 'K' } | null;
export type DameMove = { from: number; to: number; capture: number | null };
export type DameMoveResult = {
  board: DamePiece[];
  turn: DameSide;
  forcedFrom: number | null;
  winner: DameSide | null;
  captured: number | null;
  crowned: boolean;
};

const onBoard = (row: number, col: number) => row >= 0 && row < 8 && col >= 0 && col < 8;
const directions = (piece: Exclude<DamePiece, null>, side: DameSide) =>
  piece.kind === 'K' ? [-1, 1] : [side === 0 ? -1 : 1];

function capturesFrom(board: DamePiece[], from: number, side: DameSide): DameMove[] {
  const piece = board[from];
  if (!piece || piece.side !== side) return [];
  const row = Math.floor(from / 8), col = from % 8;
  const moves: DameMove[] = [];
  for (const dr of directions(piece, side)) for (const dc of [-1, 1]) {
    const middleRow = row + dr, middleCol = col + dc;
    const toRow = row + 2 * dr, toCol = col + 2 * dc;
    if (!onBoard(middleRow, middleCol) || !onBoard(toRow, toCol)) continue;
    const capture = middleRow * 8 + middleCol, to = toRow * 8 + toCol;
    if (board[capture]?.side === (side === 0 ? 1 : 0) && !board[to]) moves.push({ from, to, capture });
  }
  return moves;
}

export function getDameLegalMoves(board: DamePiece[], side: DameSide, forcedFrom: number | null = null): DameMove[] {
  if (board.length !== 64 || !board.every((piece) => piece === null ||
      ((piece.side === 0 || piece.side === 1) && (piece.kind === 'D' || piece.kind === 'K')))) return [];
  if (forcedFrom !== null) return capturesFrom(board, forcedFrom, side);
  const captures = board.flatMap((piece, from) => piece?.side === side ? capturesFrom(board, from, side) : []);
  if (captures.length) return captures;
  const moves: DameMove[] = [];
  board.forEach((piece, from) => {
    if (!piece || piece.side !== side) return;
    const row = Math.floor(from / 8), col = from % 8;
    for (const dr of directions(piece, side)) for (const dc of [-1, 1]) {
      const toRow = row + dr, toCol = col + dc;
      if (onBoard(toRow, toCol)) {
        const to = toRow * 8 + toCol;
        if (!board[to]) moves.push({ from, to, capture: null });
      }
    }
  });
  return moves;
}

export function playDameMove(board: DamePiece[], side: DameSide, from: number, to: number, forcedFrom: number | null = null): DameMoveResult | null {
  const move = getDameLegalMoves(board, side, forcedFrom).find((candidate) => candidate.from === from && candidate.to === to);
  if (!move) return null;
  const next = [...board];
  const moving = next[from];
  if (!moving) return null;
  next[from] = null;
  if (move.capture !== null) next[move.capture] = null;
  const crowned = moving.kind === 'D' && ((side === 0 && Math.floor(to / 8) === 0) || (side === 1 && Math.floor(to / 8) === 7));
  next[to] = crowned ? { side, kind: 'K' } : moving;
  const continuation = move.capture !== null && !crowned && capturesFrom(next, to, side).length > 0 ? to : null;
  if (continuation !== null) return { board: next, turn: side, forcedFrom: continuation, winner: null, captured: move.capture, crowned };
  const nextSide: DameSide = side === 0 ? 1 : 0;
  const hasOpponentPieces = next.some((piece) => piece?.side === nextSide);
  const winner = !hasOpponentPieces || getDameLegalMoves(next, nextSide).length === 0 ? side : null;
  return { board: next, turn: nextSide, forcedFrom: null, winner, captured: move.capture, crowned };
}
