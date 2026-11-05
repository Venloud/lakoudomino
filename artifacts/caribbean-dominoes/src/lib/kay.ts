export type KayPlayer = 0 | 1;
export type KayFrame = { pit: number | null; pits: number[] };
export type KayMoveResult = {
  pits: number[];
  frames: KayFrame[];
  lastPit: number;
  extraTurn: boolean;
  captured: number;
  ended: boolean;
  winner: KayPlayer | 2 | null;
};

export function playKayMove(pits: number[], player: KayPlayer, startPit: number): KayMoveResult | null {
  if (pits.length !== 14 || !pits.every((count) => Number.isInteger(count) && count >= 0)) return null;
  const ownPit = player === 0 ? startPit >= 0 && startPit < 6 : startPit >= 7 && startPit < 13;
  if (!ownPit || pits[startPit] === 0) return null;

  const next = [...pits];
  let seeds = next[startPit];
  next[startPit] = 0;
  let lastPit = startPit;
  const frames: KayFrame[] = [];

  while (seeds > 0) {
    lastPit = (lastPit + 1) % 14;
    if ((player === 0 && lastPit === 13) || (player === 1 && lastPit === 6)) continue;
    next[lastPit]++;
    seeds--;
    frames.push({ pit: lastPit, pits: [...next] });
  }

  const ownSide = player === 0 ? lastPit < 6 : lastPit > 6 && lastPit < 13;
  const oppositePit = 12 - lastPit;
  const extraTurn = (player === 0 && lastPit === 6) || (player === 1 && lastPit === 13);
  let captured = 0;
  if (ownSide && next[lastPit] === 1 && next[oppositePit] > 0) {
    captured = next[oppositePit] + 1;
    next[player === 0 ? 6 : 13] += captured;
    next[lastPit] = 0;
    next[oppositePit] = 0;
  }

  const playerZeroEmpty = next.slice(0, 6).every((count) => count === 0);
  const playerOneEmpty = next.slice(7, 13).every((count) => count === 0);
  const ended = playerZeroEmpty || playerOneEmpty;
  if (ended) {
    next[6] += next.slice(0, 6).reduce((sum, count) => sum + count, 0);
    next[13] += next.slice(7, 13).reduce((sum, count) => sum + count, 0);
    for (let pit = 0; pit < 6; pit++) next[pit] = 0;
    for (let pit = 7; pit < 13; pit++) next[pit] = 0;
  }

  if (frames.length === 0 || frames.at(-1)?.pits.some((count, index) => count !== next[index])) {
    frames.push({ pit: null, pits: [...next] });
  }
  const winner = ended ? next[6] === next[13] ? 2 : next[6] > next[13] ? 0 : 1 : null;
  return { pits: next, frames, lastPit, extraTurn: extraTurn && !ended, captured, ended, winner };
}
