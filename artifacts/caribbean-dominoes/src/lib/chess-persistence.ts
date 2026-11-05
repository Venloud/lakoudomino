import { Chess } from 'chess.js';
import type { ChessMove } from './chess.ts';

export const CHESS_MATCH_STORAGE_KEY = '509-yard-chess-match';

export type ChessMatchSave = {
  version: 1;
  startFen: string;
  fen: string;
  moves: string[];
  promotionMove: ChessMove | null;
  clocks: [number, number];
  playVsBot: boolean;
  humanColor: 'w' | 'b';
  botDifficulty: 'easy' | 'medium' | 'hard';
  clockPreset: string;
  customClockMinutes: number;
  customClockIncrement: number;
};

export type RestoredChessMatch = Omit<ChessMatchSave, 'moves'> & { game: Chess };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const MAX_CLOCK_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function squareAt(index: number): string {
  return `${'abcdefgh'[index % 8]}${8 - Math.floor(index / 8)}`;
}

function validPromotionMove(game: Chess, move: ChessMove | null): boolean {
  if (move === null) return true;
  if (!Number.isInteger(move.from) || !Number.isInteger(move.to) ||
      move.from < 0 || move.from >= 64 || move.to < 0 || move.to >= 64) return false;
  const from = squareAt(move.from) as Parameters<Chess['get']>[0];
  const to = squareAt(move.to);
  if (game.get(from)?.type !== 'p') return false;
  return game.moves({ square: from, verbose: true }).some((candidate) =>
    candidate.to === to && candidate.promotion !== undefined);
}

function parseSave(value: unknown): ChessMatchSave | null {
  if (!isRecord(value) || value.version !== 1 ||
      typeof value.startFen !== 'string' || typeof value.fen !== 'string' ||
      !Array.isArray(value.moves) || value.moves.length > 1000 ||
      !value.moves.every((move) => typeof move === 'string' && move.length <= 32) ||
      !(value.promotionMove === null || (isRecord(value.promotionMove) &&
        Number.isInteger(value.promotionMove.from) && Number.isInteger(value.promotionMove.to))) ||
      !Array.isArray(value.clocks) || value.clocks.length !== 2 ||
      !value.clocks.every((clock) => typeof clock === 'number' && Number.isFinite(clock) && clock >= 0 && clock <= MAX_CLOCK_MS) ||
      typeof value.playVsBot !== 'boolean' || !['w', 'b'].includes(String(value.humanColor)) ||
      !['easy', 'medium', 'hard'].includes(String(value.botDifficulty)) ||
      typeof value.clockPreset !== 'string' || value.clockPreset.length > 32 ||
      typeof value.customClockMinutes !== 'number' || !Number.isFinite(value.customClockMinutes) || value.customClockMinutes < 1 || value.customClockMinutes > 180 ||
      typeof value.customClockIncrement !== 'number' || !Number.isFinite(value.customClockIncrement) || value.customClockIncrement < 0 || value.customClockIncrement > 60) {
    return null;
  }
  return value as unknown as ChessMatchSave;
}

export function saveChessMatch(storage: StorageLike, game: Chess, settings: Omit<ChessMatchSave, 'version' | 'startFen' | 'fen' | 'moves'>, startFen = new Chess().fen()): boolean {
  try {
    if (game.isGameOver()) {
      storage.removeItem(CHESS_MATCH_STORAGE_KEY);
      return false;
    }
    storage.setItem(CHESS_MATCH_STORAGE_KEY, JSON.stringify({
      version: 1,
      startFen,
      fen: game.fen(),
      moves: game.history(),
      ...settings,
    } satisfies ChessMatchSave));
    return true;
  } catch {
    return false;
  }
}

export function loadSavedChessMatch(storage: StorageLike): RestoredChessMatch | null {
  let raw: string | null;
  try {
    raw = storage.getItem(CHESS_MATCH_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const save = parseSave(JSON.parse(raw));
    if (!save) throw new Error('Invalid saved Chess match.');
    const game = new Chess(save.startFen);
    for (const move of save.moves) game.move(move);
    if (game.fen() !== save.fen || game.isGameOver() || !validPromotionMove(game, save.promotionMove)) {
      throw new Error('Saved Chess position failed validation.');
    }
    const { moves: _moves, ...restored } = save;
    return { ...restored, clocks: [...save.clocks] as [number, number], game };
  } catch {
    try { storage.removeItem(CHESS_MATCH_STORAGE_KEY); } catch { /* Ignore unavailable storage. */ }
    return null;
  }
}

export function clearSavedChessMatch(storage: StorageLike): void {
  storage.removeItem(CHESS_MATCH_STORAGE_KEY);
}
