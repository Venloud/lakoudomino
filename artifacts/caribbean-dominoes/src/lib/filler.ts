export const FILLER_SIZE = 8;
export const FILLER_COLOR_COUNT = 6;

export type FillerPlayer = 0 | 1 | 2 | 3;
export type FillerBoard = {
  colors: number[];
  owners: (FillerPlayer | null)[];
  playerCount?: 2 | 3 | 4;
  turn?: FillerPlayer;
};
export type FillerMoveResult = FillerBoard & {
  playerCount: 2 | 3 | 4;
  turn: FillerPlayer;
  scores: number[];
  winner: FillerPlayer | null;
  draw: boolean;
};

export function createFillerBoard(random: () => number = Math.random, playerCount: 2 | 3 | 4 = 2): FillerBoard & { playerCount: 2 | 3 | 4; turn: FillerPlayer } {
  if (![2, 3, 4].includes(playerCount)) throw new RangeError('Filler supports 2–4 players.');
  const colors = Array.from(
    { length: FILLER_SIZE * FILLER_SIZE },
    () => Math.min(FILLER_COLOR_COUNT - 1, Math.floor(random() * FILLER_COLOR_COUNT)),
  );
  const starts = playerCount === 2 ? [0, 63] : playerCount === 3 ? [3, 56, 63] : [0, 7, 56, 63];
  const startColors = Array.from({ length: FILLER_COLOR_COUNT }, (_, index) => index);
  for (let i = startColors.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [startColors[i], startColors[j]] = [startColors[j], startColors[i]];
  }
  const owners: (FillerPlayer | null)[] = Array(colors.length).fill(null);
  starts.forEach((index, player) => {
    owners[index] = player as FillerPlayer;
    colors[index] = startColors[player];
  });
  return { colors, owners, playerCount, turn: 0 };
}

function neighbors(index: number): number[] {
  const row = Math.floor(index / FILLER_SIZE);
  const col = index % FILLER_SIZE;
  return [
    ...(row > 0 ? [index - FILLER_SIZE] : []),
    ...(row < FILLER_SIZE - 1 ? [index + FILLER_SIZE] : []),
    ...(col > 0 ? [index - 1] : []),
    ...(col < FILLER_SIZE - 1 ? [index + 1] : []),
  ];
}

export function playFillerMove(
  board: FillerBoard,
  player: FillerPlayer,
  color: number,
): FillerMoveResult | null {
  if (!Number.isInteger(color) || color < 0 || color >= FILLER_COLOR_COUNT) return null;
  const playerCount = board.playerCount ?? 2;
  if (!Number.isInteger(player) || player < 0 || player >= playerCount) return null;
  if (board.turn !== undefined && board.turn !== player) return null;
  const activeColors = new Set(
    board.owners.flatMap((owner, index) => owner !== null && owner < playerCount ? [board.colors[index]] : []),
  );
  if (!activeColors.has(board.colors[board.owners.findIndex((owner) => owner === player)]) || activeColors.has(color)) return null;

  const colors = [...board.colors];
  const owners = [...board.owners];
  const frontier = owners.flatMap((owner, index) => owner === player ? [index] : []);
  for (const index of frontier) colors[index] = color;

  for (let cursor = 0; cursor < frontier.length; cursor++) {
    for (const next of neighbors(frontier[cursor])) {
      if (owners[next] === null && colors[next] === color) {
        owners[next] = player;
        frontier.push(next);
      }
    }
  }

  const complete = owners.every((owner) => owner !== null);
  const scores = Array.from({ length: playerCount }, (_, index) => owners.filter((owner) => owner === index).length);
  const highScore = Math.max(...scores);
  const leaders = scores.flatMap((score, index) => score === highScore ? [index] : []);
  const winner = complete && leaders.length === 1 ? leaders[0] as FillerPlayer : null;
  return {
    colors, owners, playerCount,
    turn: ((player + 1) % playerCount) as FillerPlayer,
    scores, winner, draw: complete && leaders.length > 1,
  };
}

