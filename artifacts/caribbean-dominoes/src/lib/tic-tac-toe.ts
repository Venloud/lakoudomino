export type TicTacToeMark = 'X' | 'O';

export interface TicTacToeState {
  board: (TicTacToeMark | null)[];
  currentPlayer: TicTacToeMark;
  winner: TicTacToeMark | null;
  isDraw: boolean;
}

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

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
  const winner = WINNING_LINES.some(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c])
    ? state.currentPlayer
    : null;
  const isDraw = !winner && board.every(Boolean);

  return {
    board,
    currentPlayer: winner || isDraw ? state.currentPlayer : state.currentPlayer === 'X' ? 'O' : 'X',
    winner,
    isDraw,
  };
}
