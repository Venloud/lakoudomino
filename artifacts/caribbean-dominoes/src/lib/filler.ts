export const FILLER_SIZE = 8;
export const FILLER_COLOR_COUNT = 6;

export type FillerPlayer = 0 | 1;
export type FillerBoard = {
  colors: number[];
  owners: (FillerPlayer | null)[];
};
export type FillerMoveResult = FillerBoard & { winner: FillerPlayer | 2 | null };

export function createFillerBoard(random: () => number = Math.random): FillerBoard {
  const colors = Array.from(
    { length: FILLER_SIZE * FILLER_SIZE },
    () => Math.min(FILLER_COLOR_COUNT - 1, Math.floor(random() * FILLER_COLOR_COUNT)),
  );
  if (colors[0] === colors[colors.length - 1]) colors[colors.length - 1] = (colors[0] + 1) % FILLER_COLOR_COUNT;
  const owners: (FillerPlayer | null)[] = Array(colors.length).fill(null);
  owners[0] = 0;
  owners[owners.length - 1] = 1;
  return { colors, owners };
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
  const ownStart = board.owners.findIndex((owner) => owner === player);
  const otherPlayer: FillerPlayer = player === 0 ? 1 : 0;
  const otherStart = board.owners.findIndex((owner) => owner === otherPlayer);
  if (ownStart < 0 || otherStart < 0 || color === board.colors[ownStart] || color === board.colors[otherStart]) return null;

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
  const winner = complete
    ? (owners.filter((owner) => owner === 0).length === owners.filter((owner) => owner === 1).length
      ? 2
      : owners.filter((owner) => owner === player).length > owners.filter((owner) => owner === otherPlayer).length
        ? player
        : otherPlayer)
    : null;
  return { colors, owners, winner };
}

