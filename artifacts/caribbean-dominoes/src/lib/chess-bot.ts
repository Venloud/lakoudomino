import { Chess, type Move } from 'chess.js';

const VALUE: Record<string, number> = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };

function scorePosition(game: Chess, botColor: 'w' | 'b') {
  if (game.isCheckmate()) return game.turn() === botColor ? -100_000 : 100_000;
  if (game.isDraw()) return 0;
  let score = 0;
  for (const row of game.board()) for (const piece of row) {
    if (!piece) continue;
    const file = piece.square.charCodeAt(0) - 97;
    const rank = Number(piece.square[1]) - 1;
    const center = 3.5 - (Math.abs(3.5 - file) + Math.abs(3.5 - rank)) / 2;
    const value = VALUE[piece.type] + center * (piece.type === 'p' || piece.type === 'n' ? 5 : 2);
    score += piece.color === botColor ? value : -value;
  }
  return score;
}

function search(game: Chess, depth: number, alpha: number, beta: number, botColor: 'w' | 'b'): number {
  if (depth === 0 || game.isGameOver()) return scorePosition(game, botColor);
  const maximizing = game.turn() === botColor;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of game.moves({ verbose: true })) {
    game.move(move);
    const score = search(game, depth - 1, alpha, beta, botColor);
    game.undo();
    if (maximizing) { best = Math.max(best, score); alpha = Math.max(alpha, best); }
    else { best = Math.min(best, score); beta = Math.min(beta, best); }
    if (beta <= alpha) break;
  }
  return best;
}

export function chooseChessBotMove(
  fen: string,
  color: 'w' | 'b' = 'b',
  difficulty: 'easy' | 'medium' | 'hard' = 'medium',
): Move | null {
  const game = new Chess(fen);
  const searchDepth = { easy: 0, medium: 1, hard: 2 }[difficulty];
  let bestScore = -Infinity;
  let choices: Move[] = [];
  for (const move of game.moves({ verbose: true })) {
    game.move(move);
    const score = search(game, searchDepth, -Infinity, Infinity, color);
    game.undo();
    if (score > bestScore) { bestScore = score; choices = [move]; }
    else if (score === bestScore) choices.push(move);
  }
  return choices[Math.floor(Math.random() * choices.length)] ?? null;
}
