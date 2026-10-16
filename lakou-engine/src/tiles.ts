import type { Tile } from './types';

/** All 28 tiles of a double-six set, low-high. */
export function fullSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push([a, b]);
  return tiles;
}

export const isDouble = (t: Tile) => t[0] === t[1];
export const pips = (t: Tile) => t[0] + t[1];
export const sameTile = (a: Tile, b: Tile) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
export const tileKey = (t: Tile) => `${Math.min(t[0], t[1])}-${Math.max(t[0], t[1])}`;
export const norm = (t: Tile): Tile => (t[0] <= t[1] ? [t[0], t[1]] : [t[1], t[0]]);
export const handPips = (hand: Tile[]) => hand.reduce((s, t) => s + pips(t), 0);

/** Small seeded random generator (mulberry32). Returns [value 0..1, nextState]. */
export function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Fisher-Yates shuffle using the seeded generator. Returns [shuffled, nextState]. */
export function shuffle<T>(items: T[], state: number): [T[], number] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [r, ns] = nextRandom(s);
    s = ns;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}
