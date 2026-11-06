export type LocalArcadeGame = 'box' | 'kay' | 'dame' | 'four-in-a-row' | 'filler';
export type LocalArcadePiece = { side: 0 | 1; kind: string } | null;
export type LocalArcadeWinner = 0 | 1 | 2 | null;

type LocalArcadeStateBase = { turn: number; winner: LocalArcadeWinner };
export type LocalArcadeState =
  | (LocalArcadeStateBase & {
      game: 'box';
      dots: string[];
      edgeOwners: [string, number][];
      claimed: (0 | 1 | null)[];
    })
  | (LocalArcadeStateBase & { game: 'kay'; pits: number[] })
  | (LocalArcadeStateBase & {
      game: 'dame';
      pieces: LocalArcadePiece[];
      forcedFrom: number | null;
    })
  | (LocalArcadeStateBase & { game: 'four-in-a-row'; four: (0 | 1 | null)[] })
  | (LocalArcadeStateBase & {
      game: 'filler';
      fillerBoard: {
        colors: number[];
        owners: (0 | 1 | 2 | 3 | null)[];
        playerCount: 2 | 3 | 4;
      };
    });

type LocalArcadeStateFor<Game extends LocalArcadeGame> = Extract<LocalArcadeState, { game: Game }>;
export type SavedLocalArcadeMatch = {
  [Game in LocalArcadeGame]: {
    game: Game;
    playVsBot: boolean;
    state: LocalArcadeStateFor<Game>;
  };
}[LocalArcadeGame];

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const SAVE_VERSION = 1;
const SAVE_KEY_PREFIX = '509-yard-local-arcade:';
const ONLINE_SESSION_KEY_PREFIX = '509-yard-arcade-room:';

export function isLocalArcadeGame(game: string): game is LocalArcadeGame {
  return ['box', 'kay', 'dame', 'four-in-a-row', 'filler'].includes(game);
}

export function localArcadeSaveKey(game: LocalArcadeGame): string {
  return `${SAVE_KEY_PREFIX}${game}:v${SAVE_VERSION}`;
}

export function hasSavedArcadeOnlineSession(storage: Pick<Storage, 'getItem'>, game: LocalArcadeGame): boolean {
  try {
    return Boolean(storage.getItem(`${ONLINE_SESSION_KEY_PREFIX}${game}`));
  } catch {
    // If session storage cannot be read, avoid treating a room snapshot as local progress.
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPlayerOrNull(value: unknown): value is 0 | 1 | null {
  return value === null || value === 0 || value === 1;
}

function isWinner(value: unknown): value is LocalArcadeWinner {
  return value === null || value === 0 || value === 1 || value === 2;
}

function isLocalArcadeState<Game extends LocalArcadeGame>(
  game: Game,
  value: unknown,
): value is LocalArcadeStateFor<Game> {
  if (!isRecord(value) || value.game !== game || !Number.isInteger(value.turn) || !isWinner(value.winner)) return false;
  // Finished matches are never valid resumable saves.
  if (value.winner !== null) return false;
  switch (game) {
    case 'box':
      if (!Array.isArray(value.dots)) return false;
      const dots = value.dots;
      return (value.turn === 0 || value.turn === 1) &&
        dots.length <= 24 &&
        dots.every((edge) => typeof edge === 'string' && /^(?:h:[0-3]:[0-2]|v:[0-2]:[0-3])$/.test(edge)) &&
        new Set(dots).size === dots.length &&
        Array.isArray(value.edgeOwners) && value.edgeOwners.length === value.dots.length &&
        value.edgeOwners.every((entry) => Array.isArray(entry) && entry.length === 2 &&
          typeof entry[0] === 'string' && dots.includes(entry[0]) && (entry[1] === 0 || entry[1] === 1)) &&
        new Set(value.edgeOwners.map((entry) => entry[0])).size === value.edgeOwners.length &&
        Array.isArray(value.claimed) && value.claimed.length === 9 &&
        value.claimed.every(isPlayerOrNull);
    case 'kay':
      return (value.turn === 0 || value.turn === 1) &&
        Array.isArray(value.pits) && value.pits.length === 14 &&
        value.pits.every((stones) => Number.isInteger(stones) && stones >= 0 && stones <= 48) &&
        value.pits[6] + value.pits[13] <= 48 &&
        value.pits.slice(0, 6).every((stones) => stones <= 24) &&
        value.pits.slice(7, 13).every((stones) => stones <= 24);
    case 'dame':
      const forcedFrom = value.forcedFrom;
      return (value.turn === 0 || value.turn === 1) &&
        Array.isArray(value.pieces) && value.pieces.length === 64 &&
        value.pieces.every((piece) => piece === null || (isRecord(piece) &&
          (piece.side === 0 || piece.side === 1) && typeof piece.kind === 'string' &&
          ['D', 'K'].includes(piece.kind))) &&
        (forcedFrom === null ||
          (typeof forcedFrom === 'number' && Number.isInteger(forcedFrom) && forcedFrom >= 0 && forcedFrom < 64));
    case 'four-in-a-row':
      return (value.turn === 0 || value.turn === 1) &&
        Array.isArray(value.four) && value.four.length === 42 &&
        value.four.every(isPlayerOrNull);
    case 'filler': {
      const board = value.fillerBoard;
      return Number.isInteger(value.turn) && Number(value.turn) >= 0 && Number(value.turn) < 4 &&
        isRecord(board) && [2, 3, 4].includes(Number(board.playerCount)) &&
        Number(value.turn) < Number(board.playerCount) &&
        Array.isArray(board.colors) && board.colors.length === 64 &&
        board.colors.every((color) => Number.isInteger(color) && color >= 0 && color <= 5) &&
        Array.isArray(board.owners) && board.owners.length === 64 &&
        board.owners.every((owner) => owner === null ||
          (Number.isInteger(owner) && Number(owner) >= 0 && Number(owner) < Number(board.playerCount))) &&
        board.owners.every((owner) => owner === null) === false;
    }
  }
}

function clear(storage: StorageLike, game: LocalArcadeGame): void {
  try { storage.removeItem(localArcadeSaveKey(game)); } catch { /* Storage may be unavailable. */ }
}

export function loadSavedLocalArcadeMatch(
  storage: StorageLike,
  onlineStorage: Pick<Storage, 'getItem'>,
  game: LocalArcadeGame,
): SavedLocalArcadeMatch | null {
  if (hasSavedArcadeOnlineSession(onlineStorage, game)) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(localArcadeSaveKey(game));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== SAVE_VERSION || parsed.game !== game ||
        typeof parsed.playVsBot !== 'boolean' || !isLocalArcadeState(game, parsed.state)) {
      throw new Error('Invalid local arcade save.');
    }
    return {
      game,
      playVsBot: parsed.playVsBot,
      state: parsed.state,
    } as SavedLocalArcadeMatch;
  } catch {
    clear(storage, game);
    return null;
  }
}

export function saveLocalArcadeMatch(
  storage: StorageLike,
  onlineStorage: Pick<Storage, 'getItem'>,
  game: LocalArcadeGame,
  state: unknown,
  playVsBot: boolean,
): boolean {
  if (hasSavedArcadeOnlineSession(onlineStorage, game)) return true;
  if (isRecord(state) && state.winner !== null) {
    clear(storage, game);
    return true;
  }
  if (typeof playVsBot !== 'boolean' || !isLocalArcadeState(game, state)) return false;
  try {
    storage.setItem(localArcadeSaveKey(game), JSON.stringify({
      version: SAVE_VERSION,
      game,
      playVsBot,
      state,
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedLocalArcadeMatch(storage: StorageLike, game: LocalArcadeGame): void {
  clear(storage, game);
}
