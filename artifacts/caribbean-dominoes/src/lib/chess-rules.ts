import { Chess } from 'chess.js';

export function canClaimChessDraw(game: Chess): boolean {
  return game.isDrawByFiftyMoves() || game.isThreefoldRepetition();
}

export function hasAutomaticChessDraw(game: Chess): boolean {
  const halfmoveClock = Number(game.fen().split(' ')[4] ?? 0);
  if (halfmoveClock >= 150) return true;

  const replay = new Chess();
  const repetitions = new Map<string, number>();
  const positionKey = (position: Chess) => position.fen().split(' ').slice(0, 4).join(' ');
  repetitions.set(positionKey(replay), 1);
  for (const move of game.history({ verbose: true })) {
    replay.move(move);
    const key = positionKey(replay);
    const count = (repetitions.get(key) ?? 0) + 1;
    if (count >= 5) return true;
    repetitions.set(key, count);
  }
  return game.isInsufficientMaterial() || game.isStalemate();
}
