import { Chess } from 'chess.js';

export function getAutomaticChessDrawReason(game: Chess): string | null {
  if (game.isCheckmate()) return null;
  if (game.isStalemate()) return 'stalemate';
  if (game.isInsufficientMaterial()) return 'insufficient material';
  const halfmoveClock = Number(game.fen().split(' ')[4] ?? 0);

  const replay = new Chess();
  const repetitions = new Map<string, number>();
  const positionKey = (position: Chess) => position.fen().split(' ').slice(0, 4).join(' ');
  repetitions.set(positionKey(replay), 1);
  for (const move of game.history({ verbose: true })) {
    replay.move(move);
    const key = positionKey(replay);
    repetitions.set(key, (repetitions.get(key) ?? 0) + 1);
  }
  const currentRepetitions = repetitions.get(positionKey(game)) ?? 0;
  if (currentRepetitions >= 5) return 'fivefold repetition';
  if (currentRepetitions >= 3) return 'threefold repetition';
  if (halfmoveClock >= 150) return '75-move rule';
  if (halfmoveClock >= 100) return '50-move rule';
  return null;
}

export function hasAutomaticChessDraw(game: Chess): boolean {
  return getAutomaticChessDrawReason(game) !== null;
}
