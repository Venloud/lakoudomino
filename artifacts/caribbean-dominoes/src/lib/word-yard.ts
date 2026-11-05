export const WORD_BOARD_SIZE = 15;
export const WORD_RACK_SIZE = 7;
export const WORD_CENTER = 7 * WORD_BOARD_SIZE + 7;

export type WordPlayer = 0 | 1;
export type WordDirection = 'horizontal' | 'vertical';
export type WordBonus = 'double-letter' | 'triple-letter' | 'double-word' | 'triple-word' | 'center';
export type WordBoardTile = {
  letter: string;
  owner: WordPlayer;
  blank: boolean;
};
export type WordPlacement = {
  index: number;
  rackIndex: number;
  letter: string;
};
export type WordBoard = Array<WordBoardTile | null>;
export type WordScores = [number, number];

export type WordGameState = {
  board: WordBoard;
  racks: [string[], string[]];
  bag: string[];
  scores: WordScores;
  turn: WordPlayer;
  consecutivePasses: number;
  status: 'playing' | 'finished';
  winner: WordPlayer | 2 | null;
  endReason: 'rack-empty' | 'passes' | null;
};

export const WORD_GAME_STORAGE_KEY = '509-yard-word-game:v1';
const WORD_GAME_STORAGE_VERSION = 1;
export type WordGameStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isWordGameState(value: unknown): value is WordGameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<WordGameState>;
  const isLetter = (letter: unknown) => typeof letter === 'string' && /^(?:[A-Z]|\?)$/.test(letter);
  const validTile = (tile: unknown): tile is WordBoardTile | null =>
    tile === null || (!!tile && typeof tile === 'object' &&
      typeof (tile as WordBoardTile).letter === 'string' &&
      /^[A-Z]$/.test((tile as WordBoardTile).letter) &&
      ((tile as WordBoardTile).owner === 0 || (tile as WordBoardTile).owner === 1) &&
      typeof (tile as WordBoardTile).blank === 'boolean');
  if (state.status !== 'playing' || state.winner !== null || state.endReason !== null ||
      !Array.isArray(state.board) || state.board.length !== WORD_BOARD_SIZE * WORD_BOARD_SIZE ||
      !state.board.every(validTile) ||
      !Array.isArray(state.racks) || state.racks.length !== 2 ||
      !state.racks.every((rack) => Array.isArray(rack) && rack.length <= WORD_RACK_SIZE && rack.every(isLetter)) ||
      !Array.isArray(state.bag) || !state.bag.every(isLetter) ||
      !Array.isArray(state.scores) || state.scores.length !== 2 ||
      !state.scores.every((score) => Number.isInteger(score)) ||
      (state.turn !== 0 && state.turn !== 1) ||
      (state.consecutivePasses !== 0 && state.consecutivePasses !== 1)) return false;
  const tileCount = state.board.filter(Boolean).length + state.racks[0].length + state.racks[1].length + state.bag.length;
  return tileCount === 100;
}

export function loadSavedWordGame(storage: WordGameStorage): WordGameState | null {
  try {
    const raw = storage.getItem(WORD_GAME_STORAGE_KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' ||
        (saved as { version?: unknown }).version !== WORD_GAME_STORAGE_VERSION ||
        !isWordGameState((saved as { state?: unknown }).state)) {
      storage.removeItem(WORD_GAME_STORAGE_KEY);
      return null;
    }
    return (saved as { state: WordGameState }).state;
  } catch {
    try { storage.removeItem(WORD_GAME_STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    return null;
  }
}

export function saveWordGame(state: WordGameState, storage: WordGameStorage): boolean {
  try {
    if (state.status !== 'playing') {
      storage.removeItem(WORD_GAME_STORAGE_KEY);
      return true;
    }
    if (!isWordGameState(state)) return false;
    storage.setItem(WORD_GAME_STORAGE_KEY, JSON.stringify({ version: WORD_GAME_STORAGE_VERSION, state }));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedWordGame(storage: WordGameStorage): boolean {
  try {
    storage.removeItem(WORD_GAME_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export type WordPlayResult =
  | { ok: true; board: WordBoard; score: number; words: string[]; usedRack: number[] }
  | { ok: false; reason: string };

export const LETTER_POINTS: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
  '?': 0,
};

const TILE_COUNTS: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, '?': 2,
};

const bonusCoordinates: Record<WordBonus, Array<[number, number]>> = {
  'triple-word': [[0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14]],
  'double-word': [
    [1, 1], [2, 2], [3, 3], [4, 4], [7, 7], [10, 10], [11, 11], [12, 12], [13, 13],
    [1, 13], [2, 12], [3, 11], [4, 10], [10, 4], [11, 3], [12, 2], [13, 1],
  ],
  'triple-letter': [
    [1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13],
    [9, 1], [9, 5], [9, 9], [9, 13], [13, 5], [13, 9],
  ],
  'double-letter': [
    [0, 3], [0, 11], [2, 6], [2, 8], [3, 0], [3, 7], [3, 14],
    [6, 2], [6, 6], [6, 8], [6, 12], [7, 3], [7, 11],
    [8, 2], [8, 6], [8, 8], [8, 12], [11, 0], [11, 7], [11, 14],
    [12, 6], [12, 8], [14, 3], [14, 11],
  ],
  center: [[7, 7]],
};

export const WORD_BONUSES = new Map<number, WordBonus>(
  Object.entries(bonusCoordinates).flatMap(([bonus, coordinates]) =>
    coordinates.map(([row, col]) => [row * WORD_BOARD_SIZE + col, bonus as WordBonus]),
  ),
);

function shuffledBag(random: () => number): string[] {
  const bag = Object.entries(TILE_COUNTS).flatMap(([letter, count]) => Array(count).fill(letter) as string[]);
  for (let index = bag.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [bag[index], bag[swap]] = [bag[swap], bag[index]];
  }
  return bag;
}

export function createWordGame(random: () => number = Math.random): WordGameState {
  const bag = shuffledBag(random);
  return {
    board: Array(WORD_BOARD_SIZE * WORD_BOARD_SIZE).fill(null),
    racks: [bag.splice(0, WORD_RACK_SIZE), bag.splice(0, WORD_RACK_SIZE)],
    bag,
    scores: [0, 0],
    turn: 0,
    consecutivePasses: 0,
    status: 'playing',
    winner: null,
    endReason: null,
  };
}

function pointValue(tile: WordBoardTile): number {
  return tile.blank ? 0 : LETTER_POINTS[tile.letter] ?? 0;
}

function getBonusMultipliers(index: number): { letter: number; word: number } {
  switch (WORD_BONUSES.get(index)) {
    case 'double-letter': return { letter: 2, word: 1 };
    case 'triple-letter': return { letter: 3, word: 1 };
    case 'double-word':
    case 'center': return { letter: 1, word: 2 };
    case 'triple-word': return { letter: 1, word: 3 };
    default: return { letter: 1, word: 1 };
  }
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < WORD_BOARD_SIZE && col >= 0 && col < WORD_BOARD_SIZE;
}

function boardIndex(row: number, col: number): number {
  return row * WORD_BOARD_SIZE + col;
}

function coordinates(index: number): [number, number] {
  return [Math.floor(index / WORD_BOARD_SIZE), index % WORD_BOARD_SIZE];
}

export function evaluateWordPlay(
  board: WordBoard,
  rack: string[],
  placements: WordPlacement[],
  direction: WordDirection,
  dictionary: ReadonlySet<string>,
  player: WordPlayer = 0,
): WordPlayResult {
  if (!placements.length) return { ok: false, reason: 'Place at least one tile before playing.' };
  const usedRack = placements.map(({ rackIndex }) => rackIndex);
  if (new Set(usedRack).size !== usedRack.length || usedRack.some((index) => index < 0 || index >= rack.length)) {
    return { ok: false, reason: 'A rack tile can only be used once.' };
  }
  if (placements.some(({ index, letter }) => index < 0 || index >= board.length || board[index] || !/^[A-Z]$/.test(letter))) {
    return { ok: false, reason: 'Tiles must be placed on empty board squares.' };
  }
  if (placements.some(({ rackIndex, letter }) => rack[rackIndex] !== '?' && rack[rackIndex] !== letter)) {
    return { ok: false, reason: 'A placed letter must match its rack tile.' };
  }

  const cells = placements.map(({ index }) => coordinates(index));
  const sameLine = direction === 'horizontal'
    ? cells.every(([row]) => row === cells[0][0])
    : cells.every(([, col]) => col === cells[0][1]);
  if (!sameLine) return { ok: false, reason: 'All tiles in a play must share one row or column.' };

  const overlay = new Map(placements.map((placement) => [placement.index, {
    letter: placement.letter,
    owner: player,
    blank: rack[placement.rackIndex] === '?',
  } satisfies WordBoardTile]));
  const isOccupied = (index: number) => Boolean(board[index] || overlay.has(index));
  const [row, col] = cells[0];
  const varyingPositions = cells.map(([r, c]) => direction === 'horizontal' ? c : r);
  const minPosition = Math.min(...varyingPositions);
  const maxPosition = Math.max(...varyingPositions);
  for (let position = minPosition; position <= maxPosition; position++) {
    const index = direction === 'horizontal' ? boardIndex(row, position) : boardIndex(position, col);
    if (!isOccupied(index)) return { ok: false, reason: 'The word must be continuous with no gaps.' };
  }

  let start = minPosition;
  let end = maxPosition;
  while (start > 0) {
    const index = direction === 'horizontal' ? boardIndex(row, start - 1) : boardIndex(start - 1, col);
    if (!isOccupied(index)) break;
    start--;
  }
  while (end < WORD_BOARD_SIZE - 1) {
    const index = direction === 'horizontal' ? boardIndex(row, end + 1) : boardIndex(end + 1, col);
    if (!isOccupied(index)) break;
    end++;
  }

  const lineIndices = Array.from({ length: end - start + 1 }, (_, offset) =>
    direction === 'horizontal' ? boardIndex(row, start + offset) : boardIndex(start + offset, col),
  );
  const tileAt = (index: number) => overlay.get(index) ?? board[index]!;
  const mainWord = lineIndices.map((index) => tileAt(index).letter).join('');
  if (mainWord.length < 2) return { ok: false, reason: 'A play must form a word of at least two letters.' };
  if (!dictionary.has(mainWord)) return { ok: false, reason: `${mainWord} is not in the game dictionary.` };

  const boardIsEmpty = board.every((tile) => tile === null);
  if (boardIsEmpty) {
    if (!overlay.has(WORD_CENTER)) return { ok: false, reason: 'The first word must cover the center square.' };
  } else {
    const touchesBoard = placements.some(({ index }) => {
      const [tileRow, tileCol] = coordinates(index);
      return [[tileRow - 1, tileCol], [tileRow + 1, tileCol], [tileRow, tileCol - 1], [tileRow, tileCol + 1]]
        .some(([neighborRow, neighborCol]) =>
          inBounds(neighborRow, neighborCol) && Boolean(board[boardIndex(neighborRow, neighborCol)]),
        );
    });
    if (!touchesBoard) return { ok: false, reason: 'Each new word must connect to a tile already on the board.' };
  }

  const words = [mainWord];
  let mainLetterTotal = 0;
  let mainWordMultiplier = 1;
  for (const index of lineIndices) {
    const tile = tileAt(index);
    const bonus = overlay.has(index) ? getBonusMultipliers(index) : { letter: 1, word: 1 };
    mainLetterTotal += pointValue(tile) * bonus.letter;
    mainWordMultiplier *= bonus.word;
  }
  let score = mainLetterTotal * mainWordMultiplier;

  for (const placement of placements) {
    const [tileRow, tileCol] = coordinates(placement.index);
    const crossDirection = direction === 'horizontal' ? 'vertical' : 'horizontal';
    let crossStart = crossDirection === 'vertical' ? tileRow : tileCol;
    let crossEnd = crossStart;
    const at = (position: number) => crossDirection === 'vertical'
      ? boardIndex(position, tileCol)
      : boardIndex(tileRow, position);
    while (crossStart > 0 && isOccupied(at(crossStart - 1))) crossStart--;
    while (crossEnd < WORD_BOARD_SIZE - 1 && isOccupied(at(crossEnd + 1))) crossEnd++;
    if (crossStart === crossEnd) continue;

    const crossIndices = Array.from({ length: crossEnd - crossStart + 1 }, (_, offset) => at(crossStart + offset));
    const crossWord = crossIndices.map((index) => tileAt(index).letter).join('');
    if (!dictionary.has(crossWord)) return { ok: false, reason: `${crossWord} is not in the game dictionary.` };
    words.push(crossWord);
    let crossLetterTotal = 0;
    let crossWordMultiplier = 1;
    for (const index of crossIndices) {
      const tile = tileAt(index);
      const bonus = index === placement.index ? getBonusMultipliers(index) : { letter: 1, word: 1 };
      crossLetterTotal += pointValue(tile) * bonus.letter;
      crossWordMultiplier *= bonus.word;
    }
    score += crossLetterTotal * crossWordMultiplier;
  }

  if (placements.length === WORD_RACK_SIZE && rack.length === WORD_RACK_SIZE) score += 50;
  const nextBoard = [...board];
  overlay.forEach((tile, index) => { nextBoard[index] = tile; });
  return { ok: true, board: nextBoard, score, words, usedRack };
}

function rackPoints(rack: string[]): number {
  return rack.reduce((total, letter) => total + (LETTER_POINTS[letter] ?? 0), 0);
}

function finishGame(
  state: WordGameState,
  scores: WordScores,
  endReason: WordGameState['endReason'],
): WordGameState {
  const winner = scores[0] === scores[1] ? 2 : scores[0] > scores[1] ? 0 : 1;
  return { ...state, scores, status: 'finished', winner, endReason };
}

export function playWordTurn(
  state: WordGameState,
  placements: WordPlacement[],
  direction: WordDirection,
  dictionary: ReadonlySet<string>,
  random: () => number = Math.random,
): { ok: true; state: WordGameState; score: number; words: string[] } | { ok: false; reason: string } {
  if (state.status !== 'playing') return { ok: false, reason: 'This game has ended. Start a new game to play again.' };
  const result = evaluateWordPlay(state.board, state.racks[state.turn], placements, direction, dictionary, state.turn);
  if (!result.ok) return result;

  const nextRack = [...state.racks[state.turn]];
  for (const rackIndex of [...result.usedRack].sort((a, b) => b - a)) nextRack.splice(rackIndex, 1);
  const nextBag = [...state.bag];
  while (nextRack.length < WORD_RACK_SIZE && nextBag.length) {
    const drawAt = Math.floor(random() * nextBag.length);
    nextRack.push(nextBag.splice(drawAt, 1)[0]);
  }
  const racks: [string[], string[]] = [...state.racks] as [string[], string[]];
  racks[state.turn] = nextRack;
  const scores: WordScores = [...state.scores];
  scores[state.turn] += result.score;
  const nextState: WordGameState = {
    ...state,
    board: result.board,
    racks,
    bag: nextBag,
    scores,
    turn: state.turn === 0 ? 1 : 0,
    consecutivePasses: 0,
  };

  if (nextBag.length === 0 && nextRack.length === 0) {
    const finalScores: WordScores = [...scores];
    const other: WordPlayer = state.turn === 0 ? 1 : 0;
    const otherPoints = rackPoints(racks[other]);
    finalScores[state.turn] += otherPoints;
    finalScores[other] -= otherPoints;
    return { ok: true, state: finishGame(nextState, finalScores, 'rack-empty'), score: result.score, words: result.words };
  }
  return { ok: true, state: nextState, score: result.score, words: result.words };
}

export function passWordTurn(state: WordGameState): WordGameState {
  if (state.status !== 'playing') return state;
  if (state.consecutivePasses === 0) {
    return { ...state, turn: state.turn === 0 ? 1 : 0, consecutivePasses: 1 };
  }
  const scores: WordScores = [
    state.scores[0] - rackPoints(state.racks[0]),
    state.scores[1] - rackPoints(state.racks[1]),
  ];
  return finishGame({ ...state, consecutivePasses: 2 }, scores, 'passes');
}
