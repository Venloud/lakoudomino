export const BLOCK_DROP_COLUMNS = 10;
export const BLOCK_DROP_ROWS = 20;

export type BlockDropPieceType = 'I' | 'O' | 'T' | 'J' | 'L' | 'S' | 'Z';
export type BlockDropCell = BlockDropPieceType | null;
export type BlockDropStatus = 'playing' | 'paused' | 'gameover';

export interface BlockDropPiece {
  type: BlockDropPieceType;
  rotation: number;
  x: number;
  y: number;
}

export interface BlockDropState {
  board: BlockDropCell[][];
  active: BlockDropPiece | null;
  nextPiece: BlockDropPieceType;
  score: number;
  lines: number;
  level: number;
  status: BlockDropStatus;
  randomSeed: number;
}

const PIECE_TYPES: BlockDropPieceType[] = ['I', 'O', 'T', 'J', 'L', 'S', 'Z'];

const SHAPES: Record<BlockDropPieceType, string[]> = {
  I: ['####'],
  O: ['##', '##'],
  T: ['.#.', '###'],
  J: ['#..', '###'],
  L: ['..#', '###'],
  S: ['.##', '##.'],
  Z: ['##.', '.##'],
};

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function pieceFromSeed(seed: number): { type: BlockDropPieceType; seed: number } {
  const index = Math.floor((seed / 0x100000000) * PIECE_TYPES.length);
  return { type: PIECE_TYPES[index], seed: nextSeed(seed) };
}

function emptyBoard(): BlockDropCell[][] {
  return Array.from({ length: BLOCK_DROP_ROWS }, () => Array<BlockDropCell>(BLOCK_DROP_COLUMNS).fill(null));
}

export function getBlockDropShape(piece: Pick<BlockDropPiece, 'type' | 'rotation'>): { cells: string[]; width: number; height: number } {
  let cells = SHAPES[piece.type].map((row) => row.split(''));
  for (let turn = 0; turn < piece.rotation % 4; turn += 1) {
    const height = cells.length;
    const width = cells[0].length;
    cells = Array.from({ length: width }, (_, row) =>
      Array.from({ length: height }, (_, column) => cells[height - column - 1][row]));
  }
  const rows = cells.map((row) => row.join(''));
  return { cells: rows, width: rows[0].length, height: rows.length };
}

export function createBlockDropState(random: () => number = Math.random): BlockDropState {
  const seed = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 0x100000000) >>> 0;
  const first = pieceFromSeed(seed);
  const second = pieceFromSeed(first.seed);
  const shape = getBlockDropShape({ type: first.type, rotation: 0 });
  return {
    board: emptyBoard(),
    active: { type: first.type, rotation: 0, x: Math.floor((BLOCK_DROP_COLUMNS - shape.width) / 2), y: 0 },
    nextPiece: second.type,
    score: 0,
    lines: 0,
    level: 1,
    status: 'playing',
    randomSeed: second.seed,
  };
}

function collides(board: BlockDropCell[][], piece: BlockDropPiece): boolean {
  const shape = getBlockDropShape(piece);
  for (let row = 0; row < shape.height; row += 1) {
    for (let column = 0; column < shape.width; column += 1) {
      if (shape.cells[row][column] !== '#') continue;
      const boardRow = piece.y + row;
      const boardColumn = piece.x + column;
      if (boardColumn < 0 || boardColumn >= BLOCK_DROP_COLUMNS || boardRow >= BLOCK_DROP_ROWS) return true;
      if (boardRow >= 0 && board[boardRow][boardColumn] !== null) return true;
    }
  }
  return false;
}

export function moveBlockDrop(state: BlockDropState, dx: number, dy: number): BlockDropState {
  if (state.status !== 'playing' || !state.active) return state;
  const candidate = { ...state.active, x: state.active.x + dx, y: state.active.y + dy };
  return collides(state.board, candidate) ? state : { ...state, active: candidate };
}

export function rotateBlockDrop(state: BlockDropState): BlockDropState {
  if (state.status !== 'playing' || !state.active) return state;
  const rotated = { ...state.active, rotation: (state.active.rotation + 1) % 4 };
  for (const kick of [0, -1, 1, -2, 2]) {
    const candidate = { ...rotated, x: rotated.x + kick };
    if (!collides(state.board, candidate)) return { ...state, active: candidate };
  }
  return state;
}

export function clearBlockDropLines(board: BlockDropCell[][]): { board: BlockDropCell[][]; lines: number } {
  const remaining = board.filter((row) => !row.every((cell) => cell !== null));
  const lines = board.length - remaining.length;
  const cleared = Array.from({ length: lines }, () => Array<BlockDropCell>(BLOCK_DROP_COLUMNS).fill(null));
  return { board: [...cleared, ...remaining.map((row) => [...row])], lines };
}

function lockBlockDropPiece(state: BlockDropState): BlockDropState {
  if (!state.active) return state;
  const board = state.board.map((row) => [...row]);
  const shape = getBlockDropShape(state.active);
  for (let row = 0; row < shape.height; row += 1) {
    for (let column = 0; column < shape.width; column += 1) {
      if (shape.cells[row][column] !== '#') continue;
      const boardRow = state.active.y + row;
      const boardColumn = state.active.x + column;
      if (boardRow < 0) return { ...state, status: 'gameover', active: null };
      board[boardRow][boardColumn] = state.active.type;
    }
  }

  const cleared = clearBlockDropLines(board);
  const lines = state.lines + cleared.lines;
  const level = Math.floor(lines / 10) + 1;
  const scoreByLines = [0, 100, 300, 500, 800][cleared.lines] ?? cleared.lines * 200;
  const nextActive: BlockDropPiece = {
    type: state.nextPiece,
    rotation: 0,
    x: Math.floor((BLOCK_DROP_COLUMNS - getBlockDropShape({ type: state.nextPiece, rotation: 0 }).width) / 2),
    y: 0,
  };
  const next = pieceFromSeed(state.randomSeed);
  const nextState: BlockDropState = {
    ...state,
    board: cleared.board,
    active: nextActive,
    nextPiece: next.type,
    lines,
    level,
    score: state.score + scoreByLines * state.level,
    randomSeed: next.seed,
  };
  return collides(nextState.board, nextActive) ? { ...nextState, status: 'gameover', active: null } : nextState;
}

export function tickBlockDrop(state: BlockDropState): BlockDropState {
  if (state.status !== 'playing' || !state.active) return state;
  const candidate = { ...state.active, y: state.active.y + 1 };
  return collides(state.board, candidate) ? lockBlockDropPiece(state) : { ...state, active: candidate };
}

export function hardDropBlockDrop(state: BlockDropState): BlockDropState {
  if (state.status !== 'playing' || !state.active) return state;
  let active = state.active;
  while (!collides(state.board, { ...active, y: active.y + 1 })) active = { ...active, y: active.y + 1 };
  return lockBlockDropPiece({ ...state, active });
}

export function toggleBlockDropPause(state: BlockDropState): BlockDropState {
  if (state.status === 'gameover') return state;
  return { ...state, status: state.status === 'paused' ? 'playing' : 'paused' };
}
