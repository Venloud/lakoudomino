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
