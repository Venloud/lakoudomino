import { LETTER_POINTS, WORDS } from './word-game-data';

export const SCRABBLE_SIZE = 15;
export type ScrabblePlayer = 0 | 1;
export type ScrabbleDirection = 'horizontal' | 'vertical';
export type ScrabbleTile = { letter: string; points: number };
export type ScrabbleGame = {
  board: (ScrabbleTile | null)[];
  racks: [string[], string[]];
  bag: string[];
  scores: [number, number];
  turn: ScrabblePlayer;
  passes: number;
  winner: ScrabblePlayer | 2 | null;
};
export type ScrabbleMove = { row: number; col: number; direction: ScrabbleDirection; word: string };
export type ScrabbleResult = { game: ScrabbleGame; error?: never } | { game?: never; error: string };

const TILE_COUNTS: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, '?': 2,
};
const TRIPLE_WORD = new Set(['0,0', '0,7', '0,14', '7,0', '7,14', '14,0', '14,7', '14,14']);
const DOUBLE_WORD = new Set(['1,1', '2,2', '3,3', '4,4', '7,7', '10,10', '11,11', '12,12', '13,13', '13,1', '12,2', '11,3', '10,4', '4,10', '3,11', '2,12', '1,13']);
const TRIPLE_LETTER = new Set(['1,5', '1,9', '5,1', '5,5', '5,9', '5,13', '9,1', '9,5', '9,9', '9,13', '13,5', '13,9']);
const DOUBLE_LETTER = new Set(['0,3', '0,11', '2,6', '2,8', '3,0', '3,7', '3,14', '6,2', '6,6', '6,8', '6,12', '7,3', '7,11', '8,2', '8,6', '8,8', '8,12', '11,0', '11,7', '11,14', '12,6', '12,8', '14,3', '14,11']);

export function premiumAt(row: number, col: number): 'TW' | 'DW' | 'TL' | 'DL' | null {
  const key = `${row},${col}`;
  if (TRIPLE_WORD.has(key)) return 'TW';
  if (DOUBLE_WORD.has(key)) return 'DW';
  if (TRIPLE_LETTER.has(key)) return 'TL';
  if (DOUBLE_LETTER.has(key)) return 'DL';
  return null;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function drawTiles(bag: string[], count: number): { drawn: string[]; bag: string[] } {
  const drawn = bag.slice(0, count);
  return { drawn, bag: bag.slice(drawn.length) };
}

export function createScrabbleGame(random: () => number = Math.random): ScrabbleGame {
  const bag = shuffle(Object.entries(TILE_COUNTS).flatMap(([letter, count]) => Array(count).fill(letter)), random);
  const p1 = drawTiles(bag, 7);
  const p2 = drawTiles(p1.bag, 7);
  return { board: Array(SCRABBLE_SIZE * SCRABBLE_SIZE).fill(null), racks: [p1.drawn, p2.drawn], bag: p2.bag, scores: [0, 0], turn: 0, passes: 0, winner: null };
}

function adjacentIndexes(index: number): number[] {
  const row = Math.floor(index / SCRABBLE_SIZE);
  const col = index % SCRABBLE_SIZE;
  return [
    ...(row > 0 ? [index - SCRABBLE_SIZE] : []),
    ...(row < SCRABBLE_SIZE - 1 ? [index + SCRABBLE_SIZE] : []),
    ...(col > 0 ? [index - 1] : []),
    ...(col < SCRABBLE_SIZE - 1 ? [index + 1] : []),
  ];
}

function wordAt(board: (ScrabbleTile | null)[], index: number, direction: ScrabbleDirection): { indexes: number[]; word: string } {
  const delta = direction === 'horizontal' ? 1 : SCRABBLE_SIZE;
  const inBounds = (i: number) => i >= 0 && i < board.length
    && (direction === 'horizontal' ? Math.floor(i / SCRABBLE_SIZE) === Math.floor(index / SCRABBLE_SIZE) : true);
  let first = index;
  while (inBounds(first - delta) && board[first - delta]) first -= delta;
  const indexes: number[] = [];
  let cursor = first;
  while (inBounds(cursor) && board[cursor]) { indexes.push(cursor); cursor += delta; }
  return { indexes, word: indexes.map((i) => board[i]!.letter).join('') };
}

function scoreWord(board: (ScrabbleTile | null)[], indexes: number[], newIndexes: Set<number>): number {
  let total = 0, wordMultiplier = 1;
  for (const index of indexes) {
    const tile = board[index]!;
    if (!newIndexes.has(index)) { total += tile.points; continue; }
    const premium = premiumAt(Math.floor(index / SCRABBLE_SIZE), index % SCRABBLE_SIZE);
    total += tile.points * (premium === 'DL' ? 2 : premium === 'TL' ? 3 : 1);
    if (premium === 'DW') wordMultiplier *= 2;
    if (premium === 'TW') wordMultiplier *= 3;
  }
  return total * wordMultiplier;
}

function finish(game: ScrabbleGame, scores: [number, number]): ScrabbleGame {
  return { ...game, scores, winner: scores[0] === scores[1] ? 2 : scores[0] > scores[1] ? 0 : 1 };
}

export function playScrabbleWord(game: ScrabbleGame, move: ScrabbleMove): ScrabbleResult {
  if (game.winner !== null) return { error: 'This game is already over.' };
  const word = move.word.trim().toUpperCase();
  if (!/^[A-Z]{2,15}$/.test(word)) return { error: 'Enter a word using 2–15 letters.' };
  const player = game.turn;
  const rack = [...game.racks[player]];
  const board = [...game.board];
  const newIndexes = new Set<number>();
  for (let i = 0; i < word.length; i++) {
    const row = move.row + (move.direction === 'vertical' ? i : 0);
    const col = move.col + (move.direction === 'horizontal' ? i : 0);
    if (row < 0 || row >= SCRABBLE_SIZE || col < 0 || col >= SCRABBLE_SIZE) return { error: 'That word would go past the board edge.' };
    const index = row * SCRABBLE_SIZE + col;
    const existing = board[index];
    if (existing) {
      if (existing.letter !== word[i]) return { error: 'The word must match every tile already on the board.' };
      continue;
    }
    let rackIndex = rack.indexOf(word[i]);
    let points = LETTER_POINTS[word[i]];
    if (rackIndex < 0) {
      rackIndex = rack.indexOf('?');
      points = 0;
    }
    if (rackIndex < 0) return { error: `You do not have the letter ${word[i]} in your rack.` };
    rack.splice(rackIndex, 1);
    board[index] = { letter: word[i], points };
    newIndexes.add(index);
  }
  if (newIndexes.size === 0) return { error: 'Place at least one new tile.' };
  const firstMove = game.board.every((tile) => tile === null);
  if (firstMove && !newIndexes.has(7 * SCRABBLE_SIZE + 7)) return { error: 'The first word must cover the center star.' };
  if (!firstMove && ![...newIndexes].some((index) => adjacentIndexes(index).some((next) => game.board[next] !== null))) {
    return { error: 'A new tile must connect to a word already on the board.' };
  }

  const main = wordAt(board, [...newIndexes][0], move.direction);
  if (main.indexes.length < 2 || !WORDS.has(main.word)) return { error: `${main.word || word} is not in the starter dictionary.` };
  const words = [main];
  const crossDirection = move.direction === 'horizontal' ? 'vertical' : 'horizontal';
  for (const index of newIndexes) {
    const cross = wordAt(board, index, crossDirection);
    if (cross.indexes.length > 1) {
      if (!WORDS.has(cross.word)) return { error: `${cross.word} is not in the starter dictionary.` };
      words.push(cross);
    }
  }
  let points = words.reduce((sum, formed) => sum + scoreWord(board, formed.indexes, newIndexes), 0);
  if (newIndexes.size === 7) points += 50;
  const scores: [number, number] = [...game.scores] as [number, number];
  scores[player] += points;
  const refill = drawTiles(game.bag, Math.min(7 - rack.length, game.bag.length));
  const racks: [string[], string[]] = [...game.racks] as [string[], string[]];
  racks[player] = [...rack, ...refill.drawn];
  const next: ScrabbleGame = { ...game, board, racks, bag: refill.bag, scores, turn: player === 0 ? 1 : 0, passes: 0 };
  const emptied = next.bag.length === 0 && racks[player].length === 0;
  if (emptied) {
    const other = player === 0 ? 1 : 0;
    const leftover = racks[other].reduce((sum, letter) => sum + (LETTER_POINTS[letter] ?? 0), 0);
    scores[player] += leftover;
    scores[other] -= leftover;
  }
  return { game: emptied ? finish(next, scores) : next };
}

export function passScrabbleTurn(game: ScrabbleGame): ScrabbleGame {
  if (game.winner !== null) return game;
  const next = { ...game, turn: game.turn === 0 ? 1 as const : 0 as const, passes: game.passes + 1 };
  if (next.passes < 4) return next;
  const scores: [number, number] = [
    game.scores[0] - game.racks[0].reduce((sum, letter) => sum + (LETTER_POINTS[letter] ?? 0), 0),
    game.scores[1] - game.racks[1].reduce((sum, letter) => sum + (LETTER_POINTS[letter] ?? 0), 0),
  ];
  return finish(next, scores);
}

