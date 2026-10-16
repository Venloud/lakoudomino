import type { ArmId, BoardState, Mode, Placement, Tile } from './types';
import { isDouble, norm } from './tiles';

/** Points mode: does this ends total score? Multiples of 5, but never just 5 — the smallest score is 10. */
export const isScoringTotal = (total: number) => total >= 10 && total % 5 === 0;

export function emptyBoard(): BoardState {
  return { center: null, arms: {}, spinner: null, history: [] };
}

/**
 * Which arms a tile can be played on right now.
 * W and E always (once the first tile is down). N and S only in Points mode,
 * and only after the spinner has a tile on both of its main sides.
 */
export function openArms(board: BoardState): ArmId[] {
  if (!board.center) return [];
  const out: ArmId[] = ['W', 'E'];
  if (board.spinner && spinnerSidesOpen(board)) out.push('N', 'S');
  return out;
}

/** True once both "main" sides of the spinner are covered, which opens N and S. */
export function spinnerSidesOpen(board: BoardState): boolean {
  const sp = board.spinner;
  if (!sp) return false;
  if (sp.where === 'center') {
    return (board.arms.W?.tiles.length ?? 0) > 0 && (board.arms.E?.tiles.length ?? 0) > 0;
  }
  const arm = board.arms[sp.where.arm]!;
  return arm.tiles.length > sp.where.index + 1;
}

/** Can this tile go on this arm? */
export function fits(board: BoardState, tile: Tile, arm: ArmId): boolean {
  const a = board.arms[arm];
  if (!a) return false;
  if (!openArms(board).includes(arm)) return false;
  return tile[0] === a.value || tile[1] === a.value;
}

/** Place a tile. Assumes the move was already checked as legal. Returns a new board. */
export function placeTile(board: BoardState, mode: Mode, seat: number, tileIn: Tile, arm: ArmId | 'center'): BoardState {
  const b: BoardState = structuredClone(board);
  const tile = norm(tileIn);
  const dbl = isDouble(tile);
  b.history.push({ seat, tile, arm });

  if (arm === 'center') {
    b.center = { tile, inner: null, outer: tile[1], seat, isDouble: dbl };
    b.arms.W = { id: 'W', tiles: [], value: tile[0] };
    b.arms.E = { id: 'E', tiles: [], value: tile[1] };
    if (mode === 'points' && dbl) makeSpinner(b, tile, 'center');
    return b;
  }

  const a = b.arms[arm]!;
  const inner = a.value;
  const outer = tile[0] === inner ? tile[1] : tile[0];
  const p: Placement = { tile, inner, outer, seat, isDouble: dbl };
  a.tiles.push(p);
  a.value = outer;

  // In Points mode the FIRST double played becomes the spinner (only on the main line).
  if (mode === 'points' && dbl && !b.spinner && (arm === 'W' || arm === 'E')) {
    makeSpinner(b, tile, { arm, index: a.tiles.length - 1 });
  }
  return b;
}

function makeSpinner(b: BoardState, tile: Tile, where: 'center' | { arm: ArmId; index: number }) {
  b.spinner = { tile, where };
  b.arms.N = { id: 'N', tiles: [], value: tile[0] };
  b.arms.S = { id: 'S', tiles: [], value: tile[0] };
}

/**
 * Points mode: add up every open end.
 * - A double sitting at an end counts both halves (6-6 = 12).
 * - The spinner counts (both halves) while at least one of its main sides is still empty.
 * - N and S only count once a tile has been played on them.
 */
export function endsTotal(board: BoardState): number {
  const c = board.center;
  if (!c) return 0;
  const endValue = (p: Placement) => (p.isDouble ? p.outer * 2 : p.outer);
  let total = 0;

  const W = board.arms.W!;
  const E = board.arms.E!;
  if (c.isDouble) {
    // Centre double: counts once (both halves) while either side is still bare.
    if (W.tiles.length === 0 || E.tiles.length === 0) total += c.tile[0] * 2;
    if (W.tiles.length) total += endValue(W.tiles[W.tiles.length - 1]);
    if (E.tiles.length) total += endValue(E.tiles[E.tiles.length - 1]);
  } else {
    total += W.tiles.length ? endValue(W.tiles[W.tiles.length - 1]) : c.tile[0];
    total += E.tiles.length ? endValue(E.tiles[E.tiles.length - 1]) : c.tile[1];
  }
  for (const id of ['N', 'S'] as const) {
    const a = board.arms[id];
    if (a && a.tiles.length) total += endValue(a.tiles[a.tiles.length - 1]);
  }
  return total;
}

/**
 * Points mode: exactly which tile halves were counted in endsTotal — for lighting up the pips when someone scores.
 * `order` is the tile's index in board.history (same as LaidTile.order).
 * half: 'outer' = the open half, 'both' = a double at an end (both halves count),
 *       'first' / 'second' = one half of a non-double first tile whose side is still bare.
 */
export function countedHalves(board: BoardState): { order: number; half: 'outer' | 'both' | 'first' | 'second' }[] {
  const c = board.center;
  if (!c) return [];
  const out: { order: number; half: 'outer' | 'both' | 'first' | 'second' }[] = [];
  const orderOf = (arm: ArmId, idx: number) => {
    let n = -1;
    return board.history.findIndex((h) => h.arm === arm && ++n === idx);
  };
  const lastOf = (id: ArmId) => {
    const a = board.arms[id];
    if (!a || !a.tiles.length) return null;
    const p = a.tiles[a.tiles.length - 1];
    return { order: orderOf(id, a.tiles.length - 1), half: p.isDouble ? ('both' as const) : ('outer' as const) };
  };
  const W = board.arms.W!, E = board.arms.E!;
  if (c.isDouble) {
    if (!W.tiles.length || !E.tiles.length) out.push({ order: 0, half: 'both' });
  } else {
    if (!W.tiles.length) out.push({ order: 0, half: 'first' });
    if (!E.tiles.length) out.push({ order: 0, half: 'second' });
  }
  for (const id of ['W', 'E', 'N', 'S'] as const) {
    const l = lastOf(id);
    if (l) out.push(l);
  }
  return out;
}

/**
 * All four: all four ends — W, E, N and S, each with at least one tile on it — show the same number.
 * Returns that number, or null.
 */
export function allFourValue(board: BoardState): number | null {
  if (!board.spinner) return null;
  const vals: number[] = [];
  for (const id of ['W', 'E', 'N', 'S'] as const) {
    const a = board.arms[id];
    if (!a || !a.tiles.length) return null;
    vals.push(a.value);
  }
  return vals.every((v) => v === vals[0]) ? vals[0] : null;
}

/** Does any tile in this hand fit anywhere? */
export function canPlay(board: BoardState, hand: Tile[]): boolean {
  if (!board.center) return hand.length > 0;
  const arms = openArms(board);
  return hand.some((t) => arms.some((id) => fits(board, t, id)));
}

/** What the open ends look like: the count plus each open end's number (and whether a double sits there). */
function endsSignature(board: BoardState): string {
  const ends = openArms(board).map((id) => {
    const a = board.arms[id]!;
    const last = a.tiles[a.tiles.length - 1];
    const dbl = last ? last.isDouble : !!board.center?.isDouble;
    return `${a.value}${dbl ? 'd' : ''}`;
  }).sort().join(',');
  return `${endsTotal(board)}|${ends}`;
}

/**
 * True when every one of these spots gives the exact same result (same count, same open ends), e.g. a 6
 * on either side of a 6-6 in the middle, or two ends that both show a plain 6. Then the choice doesn't
 * matter and the UI can place the tile straight away on a double-tap. If one of the ends is a double, the
 * results differ (covering the double changes the count), so the player has to pick.
 */
export function placementsEquivalent(board: BoardState, mode: Mode, seat: number, tile: Tile, arms: (ArmId | 'center')[]): boolean {
  if (arms.length < 2) return true;
  const sigs = new Set(arms.map((arm) => endsSignature(placeTile(board, mode, seat, tile, arm))));
  return sigs.size === 1;
}
