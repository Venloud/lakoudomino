export const MOPYON_BOARD_SIZE = 15;

export type MopyonMark = 'X' | 'O';

export interface MopyonState {
  board: (MopyonMark | null)[];
  currentPlayer: MopyonMark;
  winner: MopyonMark | null;
  isDraw: boolean;
  winningLine: number[] | null;
  lastMove: number | null;
}

const WIN_DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

export function createMopyonState(): MopyonState {
  return {
    board: Array<MopyonMark | null>(MOPYON_BOARD_SIZE * MOPYON_BOARD_SIZE).fill(null),
    currentPlayer: 'X',
    winner: null,
    isDraw: false,
    winningLine: null,
    lastMove: null,
  };
}

function findWinningLine(board: (MopyonMark | null)[], row: number, column: number, mark: MopyonMark): number[] | null {
  for (const [rowStep, columnStep] of WIN_DIRECTIONS) {
    const line = [{ row, column }];

    for (const sign of [-1, 1]) {
      let nextRow = row + rowStep * sign;
      let nextColumn = column + columnStep * sign;
      while (
        nextRow >= 0 && nextRow < MOPYON_BOARD_SIZE
        && nextColumn >= 0 && nextColumn < MOPYON_BOARD_SIZE
        && board[nextRow * MOPYON_BOARD_SIZE + nextColumn] === mark
      ) {
        line.push({ row: nextRow, column: nextColumn });
        nextRow += rowStep * sign;
        nextColumn += columnStep * sign;
      }
    }

    if (line.length >= 5) return line.map(({ row: lineRow, column: lineColumn }) => lineRow * MOPYON_BOARD_SIZE + lineColumn);
  }
  return null;
}

const otherMark = (mark: MopyonMark): MopyonMark => mark === 'X' ? 'O' : 'X';

function lineLength(board: (MopyonMark | null)[], row: number, column: number, rowStep: number, columnStep: number, mark: MopyonMark): number {
  let length = 1;
  for (const sign of [-1, 1]) {
    let nextRow = row + rowStep * sign;
    let nextColumn = column + columnStep * sign;
    while (
      nextRow >= 0 && nextRow < MOPYON_BOARD_SIZE
      && nextColumn >= 0 && nextColumn < MOPYON_BOARD_SIZE
      && board[nextRow * MOPYON_BOARD_SIZE + nextColumn] === mark
    ) {
      length += 1;
      nextRow += rowStep * sign;
      nextColumn += columnStep * sign;
    }
  }
  return length;
}

function winsAt(board: (MopyonMark | null)[], index: number, mark: MopyonMark): boolean {
  if (board[index] !== null) return false;
  const row = Math.floor(index / MOPYON_BOARD_SIZE);
  const column = index % MOPYON_BOARD_SIZE;
  return WIN_DIRECTIONS.some(([rowStep, columnStep]) =>
    lineLength(board, row, column, rowStep, columnStep, mark) >= 5);
}

function candidateMoves(board: (MopyonMark | null)[]): number[] {
  const candidates = new Set<number>();
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) continue;
    const row = Math.floor(index / MOPYON_BOARD_SIZE);
    const column = index % MOPYON_BOARD_SIZE;
    let nearMark = false;
    for (let rowOffset = -2; rowOffset <= 2 && !nearMark; rowOffset += 1) {
      for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
        const nearRow = row + rowOffset;
        const nearColumn = column + columnOffset;
        if (
          nearRow >= 0 && nearRow < MOPYON_BOARD_SIZE
          && nearColumn >= 0 && nearColumn < MOPYON_BOARD_SIZE
          && board[nearRow * MOPYON_BOARD_SIZE + nearColumn] !== null
        ) {
          nearMark = true;
          break;
        }
      }
    }
    if (nearMark) candidates.add(index);
  }
  if (candidates.size === 0) {
    const center = Math.floor(MOPYON_BOARD_SIZE / 2);
    candidates.add(center * MOPYON_BOARD_SIZE + center);
  }
  return [...candidates];
}

function scoreLine(board: (MopyonMark | null)[], index: number, mark: MopyonMark, rowStep: number, columnStep: number): number {
  const row = Math.floor(index / MOPYON_BOARD_SIZE);
  const column = index % MOPYON_BOARD_SIZE;
  let length = 1;
  let openEnds = 0;

  for (const sign of [-1, 1]) {
    let nextRow = row + rowStep * sign;
    let nextColumn = column + columnStep * sign;
    while (
      nextRow >= 0 && nextRow < MOPYON_BOARD_SIZE
      && nextColumn >= 0 && nextColumn < MOPYON_BOARD_SIZE
      && board[nextRow * MOPYON_BOARD_SIZE + nextColumn] === mark
    ) {
      length += 1;
      nextRow += rowStep * sign;
      nextColumn += columnStep * sign;
    }
    if (
      nextRow >= 0 && nextRow < MOPYON_BOARD_SIZE
      && nextColumn >= 0 && nextColumn < MOPYON_BOARD_SIZE
      && board[nextRow * MOPYON_BOARD_SIZE + nextColumn] === null
    ) openEnds += 1;
  }

  if (length >= 5) return 10_000_000;
  if (length === 4) return openEnds === 2 ? 1_000_000 : openEnds === 1 ? 100_000 : 0;
  if (length === 3) return openEnds === 2 ? 12_000 : openEnds === 1 ? 900 : 0;
  if (length === 2) return openEnds === 2 ? 180 : openEnds === 1 ? 24 : 0;
  return openEnds ? 3 : 0;
}

function positionalScore(board: (MopyonMark | null)[], index: number, mark: MopyonMark): number {
  let score = 0;
  for (const [rowStep, columnStep] of WIN_DIRECTIONS) {
    score += scoreLine(board, index, mark, rowStep, columnStep);
  }
  return score;
}

function immediateWinningMoves(board: (MopyonMark | null)[], mark: MopyonMark): number[] {
  return candidateMoves(board).filter((index) => winsAt(board, index, mark));
}

/**
 * Select a tactical Mopyon move: win now, stop an immediate loss, build open lines,
 * and avoid leaving the opponent multiple winning replies.
 */
export function chooseMopyonBotMove(state: MopyonState, mark: MopyonMark = state.currentPlayer): number | null {
  if (state.winner || state.isDraw) return null;
  const candidates = candidateMoves(state.board);
  const winningMove = candidates.find((index) => winsAt(state.board, index, mark));
  if (winningMove !== undefined) return winningMove;

  const opponent = otherMark(mark);
  const opponentWins = immediateWinningMoves(state.board, opponent);
  if (opponentWins.length === 1) return opponentWins[0]!;

  let bestMove = candidates[0] ?? null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const center = Math.floor(MOPYON_BOARD_SIZE / 2);

  for (const index of candidates) {
    const row = Math.floor(index / MOPYON_BOARD_SIZE);
    const column = index % MOPYON_BOARD_SIZE;
    const nextBoard = [...state.board];
    nextBoard[index] = mark;

    const ownWinsNextTurn = immediateWinningMoves(nextBoard, mark).length;
    const opponentWinsNextTurn = immediateWinningMoves(nextBoard, opponent).length;
    const ownScore = positionalScore(nextBoard, index, mark);
    const defenseScore = positionalScore(nextBoard, index, opponent);
    const centerDistance = Math.abs(row - center) + Math.abs(column - center);
    const score = ownScore
      + defenseScore * 0.92
      + ownWinsNextTurn * 150_000
      - opponentWinsNextTurn * 1_200_000
      - centerDistance;

    if (score > bestScore) {
      bestMove = index;
      bestScore = score;
    }
  }

  return bestMove;
}

export function playMopyonMove(state: MopyonState, row: number, column: number): MopyonState {
  if (
    !Number.isInteger(row) || !Number.isInteger(column)
    || row < 0 || row >= MOPYON_BOARD_SIZE
    || column < 0 || column >= MOPYON_BOARD_SIZE
    || state.winner !== null
    || state.isDraw
    || state.board[row * MOPYON_BOARD_SIZE + column] !== null
  ) return state;

  const index = row * MOPYON_BOARD_SIZE + column;
  const board = [...state.board];
  board[index] = state.currentPlayer;
  const winningLine = findWinningLine(board, row, column, state.currentPlayer);
  const isDraw = !winningLine && board.every(Boolean);

  return {
    board,
    currentPlayer: winningLine || isDraw ? state.currentPlayer : state.currentPlayer === 'X' ? 'O' : 'X',
    winner: winningLine ? state.currentPlayer : null,
    isDraw,
    winningLine,
    lastMove: index,
  };
}
