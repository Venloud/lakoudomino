export type TicTacToeMark = 'X' | 'O';
export type TicTacToeMode = 'regular' | 'yard';
export type YardGridResult = TicTacToeMark | 'draw' | null;

export interface TicTacToeState {
  board: (TicTacToeMark | null)[];
  currentPlayer: TicTacToeMark;
  winner: TicTacToeMark | null;
  isDraw: boolean;
}

export interface YardTicTacToeState {
  boards: (TicTacToeMark | null)[][];
  gridResults: YardGridResult[];
  currentPlayer: TicTacToeMark;
  winner: TicTacToeMark | null;
  isDraw: boolean;
  nextBoard: number | null;
}

export type TicTacToeGameState = TicTacToeState | YardTicTacToeState;

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

function getLineWinner(cells: (TicTacToeMark | null)[]): TicTacToeMark | null {
  for (const [a, b, c] of WINNING_LINES) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
  }
  return null;
}

export function createTicTacToeState(): TicTacToeState {
  return {
    board: Array<TicTacToeMark | null>(9).fill(null),
    currentPlayer: 'X',
    winner: null,
    isDraw: false,
  };
}

export function playTicTacToeMove(state: TicTacToeState, index: number): TicTacToeState {
  if (!Number.isInteger(index) || index < 0 || index > 8 || state.winner || state.isDraw || state.board[index]) {
    return state;
  }

  const board = [...state.board];
  board[index] = state.currentPlayer;
  const winner = getLineWinner(board);
  const isDraw = !winner && board.every(Boolean);

  return {
    board,
    currentPlayer: winner || isDraw ? state.currentPlayer : state.currentPlayer === 'X' ? 'O' : 'X',
    winner,
    isDraw,
  };
}

export function createYardTicTacToeState(): YardTicTacToeState {
  return {
    boards: Array.from({ length: 9 }, () => Array<TicTacToeMark | null>(9).fill(null)),
    gridResults: Array<YardGridResult>(9).fill(null),
    currentPlayer: 'X',
    winner: null,
    isDraw: false,
    nextBoard: null,
  };
}

export function playYardTicTacToeMove(
  state: YardTicTacToeState,
  boardIndex: number,
  cellIndex: number,
): YardTicTacToeState {
  const invalidIndex = !Number.isInteger(boardIndex) || boardIndex < 0 || boardIndex > 8
    || !Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8;
  if (
    invalidIndex
    || state.winner
    || state.isDraw
    || state.gridResults[boardIndex] !== null
    || (state.nextBoard !== null && state.nextBoard !== boardIndex)
    || state.boards[boardIndex][cellIndex] !== null
  ) return state;

  const boards = state.boards.map((board) => [...board]);
  boards[boardIndex][cellIndex] = state.currentPlayer;
  const gridResults = [...state.gridResults];
  const localWinner = getLineWinner(boards[boardIndex]);
  gridResults[boardIndex] = localWinner ?? (boards[boardIndex].every(Boolean) ? 'draw' : null);
  const winner = getLineWinner(gridResults.map((result) => result === 'draw' ? null : result));
  const isDraw = !winner && gridResults.every((result) => result !== null);
  const nextBoard = gridResults[cellIndex] === null ? cellIndex : null;

  return {
    boards,
    gridResults,
    currentPlayer: winner || isDraw ? state.currentPlayer : state.currentPlayer === 'X' ? 'O' : 'X',
    winner,
    isDraw,
    nextBoard,
  };
}
