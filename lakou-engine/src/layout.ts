import type { ArmId, BoardState, Tile } from './types';
import { isDouble } from './tiles';

/**
 * Where every tile sits on the table.
 *
 * Units: 1 unit = one half of a domino. A flat (horizontal) tile is 2 wide × 1 tall,
 * a standing (vertical) tile is 1 wide × 2 tall. (0,0) is the middle of the first tile.
 *
 * To draw: pick a pixel size per unit that makes the whole layout fit, e.g.
 *   unit = min(tableW / (bounds.width + 2), tableH / (bounds.height + 2), maxUnit)
 * then put each tile at
 *   left = (x - w/2 - bounds.minX + 1) * unit,  top = (y - h/2 - bounds.minY + 1) * unit,
 *   width = w*unit, height = h*unit.
 * Recompute after every play so the line always fits and stays centred. Use a CSS transition on
 * left/top so tiles glide if the layout re-flows.
 *
 * Guarantee: tiles never overlap (tested over thousands of games). Lines go straight until they
 * reach the soft edge (halfWidth / halfHeight), then turn a corner like on a real table.
 */
export interface LaidTile {
  tile: Tile;
  seat: number;
  /** Centre of the tile. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 'h' = lying flat (two halves side by side), 'v' = standing (halves top and bottom). */
  orientation: 'h' | 'v';
  /** Pips on the left half ('h') or top half ('v'). */
  first: number;
  /** Pips on the right half ('h') or bottom half ('v'). */
  second: number;
  arm: ArmId | 'center';
  isSpinner: boolean;
  /** Order it was played in (0 = first tile). Use it to animate the newest tile. */
  order: number;
  /** Which half faces outward (the open end): 'first', 'second', or null for the first tile. */
  outerHalf: 'first' | 'second' | null;
}

export interface Layout {
  tiles: LaidTile[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
}

export interface LayoutOptions {
  /** How far (in units) a line may run from the middle before it turns. Match your table's shape.
   *  Square table: 8 and 8. Phone (tall) table: 6 and 9. */
  halfWidth?: number;
  halfHeight?: number;
}

type V = { x: number; y: number };
interface ArmGeo { p: V; d: V }
interface Rect { x: number; y: number; w: number; h: number }

interface State {
  tiles: LaidTile[];
  geo: Partial<Record<ArmId, ArmGeo>>;
  outer: Partial<Record<ArmId, number>>;
  /** Space kept free for the spinner's N and S sides until their first tile arrives. */
  reserved: Partial<Record<'N' | 'S', Rect>>;
}

const add = (a: V, b: V, k = 1): V => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const cw = (d: V): V => ({ x: -d.y, y: d.x }); // clockwise on screen (y points down)
const ccw = (d: V): V => ({ x: d.y, y: -d.x });
const GAP = 0.25; // minimum space between tiles that don't touch on purpose

export function layoutBoard(board: BoardState, opts: LayoutOptions = {}): Layout {
  const halfW = opts.halfWidth ?? 8;
  const halfH = opts.halfHeight ?? 8;
  const moves = board.history;
  if (!moves.length) return { tiles: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 } };

  // Which move made the spinner (if any)?
  let spinnerOrder = -1;
  if (board.spinner) {
    if (board.spinner.where === 'center') spinnerOrder = 0;
    else {
      const { arm, index } = board.spinner.where;
      let c = -1;
      spinnerOrder = moves.findIndex((m) => m.arm === arm && ++c === index);
    }
  }

  const start = placeCenter(moves[0].tile, moves[0].seat, spinnerOrder === 0);
  let budget = 40000;
  let best: State | null = null;

  // Depth-first: try the nicest option for each tile; if a later tile gets boxed in, back up.
  const solve = (i: number, st: State): State | null => {
    if (i === moves.length) return st;
    if (--budget < 0) return null;
    for (const opt of options(st, moves[i], i, i === spinnerOrder, halfW, halfH)) {
      const res = solve(i + 1, opt);
      if (res) return res;
    }
    return null;
  };
  best = solve(1, start);
  if (!best) best = greedyFallback(start, moves, spinnerOrder, halfW, halfH);

  const tiles = best.tiles;
  const minX = Math.min(...tiles.map((t) => t.x - t.w / 2));
  const maxX = Math.max(...tiles.map((t) => t.x + t.w / 2));
  const minY = Math.min(...tiles.map((t) => t.y - t.h / 2));
  const maxY = Math.max(...tiles.map((t) => t.y + t.h / 2));
  return { tiles, bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } };
}

function placeCenter(tile: Tile, seat: number, spinner: boolean): State {
  if (isDouble(tile)) {
    const st: State = {
      tiles: [{ tile, seat, x: 0, y: 0, w: 1, h: 2, orientation: 'v', first: tile[0], second: tile[1], arm: 'center', isSpinner: spinner, order: 0, outerHalf: null }],
      geo: { W: { p: { x: -0.5, y: 0 }, d: { x: -1, y: 0 } }, E: { p: { x: 0.5, y: 0 }, d: { x: 1, y: 0 } } },
      outer: { W: tile[0], E: tile[1] },
      reserved: {},
    };
    if (spinner) {
      st.geo.N = { p: { x: 0, y: -1 }, d: { x: 0, y: -1 } };
      st.geo.S = { p: { x: 0, y: 1 }, d: { x: 0, y: 1 } };
      st.outer.N = tile[0];
      st.outer.S = tile[0];
      st.reserved = { N: reserveRect(st.geo.N), S: reserveRect(st.geo.S) };
    }
    return st;
  }
  return {
    tiles: [{ tile, seat, x: 0, y: 0, w: 2, h: 1, orientation: 'h', first: tile[0], second: tile[1], arm: 'center', isSpinner: false, order: 0, outerHalf: null }],
    geo: { W: { p: { x: -1, y: 0 }, d: { x: -1, y: 0 } }, E: { p: { x: 1, y: 0 }, d: { x: 1, y: 0 } } },
    outer: { W: tile[0], E: tile[1] },
    reserved: {},
  };
}

/** All ways to place the next tile, best first. Each option is a complete new State. */
function options(
  st: State, move: BoardState['history'][number], order: number, makesSpinner: boolean, halfW: number, halfH: number,
  gap = GAP, allowOverlap = false,
): State[] {
  const arm = move.arm as ArmId;
  const g = st.geo[arm]!;
  const tile = move.tile;
  const dbl = isDouble(tile);
  const inner = st.outer[arm]!;
  const outer = tile[0] === inner ? tile[1] : tile[0];

  const cands: { rect: Rect; next: ArmGeo; crosswise: boolean; dir: V; turn: number }[] = [];
  cands.push({ ...place(g.p, g.d, dbl, true), turn: 0 });
  // Turn a corner. Prefer the turn that heads away from the middle of the table.
  const turns = [cw(g.d), ccw(g.d)].sort((a, b) => (b.x * g.p.x + b.y * g.p.y) - (a.x * g.p.x + a.y * g.p.y));
  for (const nd of turns) {
    const q = add(add(g.p, g.d, 0.5), nd, -0.5); // attach point just round the corner
    cands.push({ ...place(q, nd, false, false), turn: 1 }); // at a corner even a double lies along the line
  }

  // The tile we are attaching to may touch us; everything else needs a gap.
  const anchor = [...st.tiles].reverse().find((t) => t.arm === arm) ?? spinnerOrCenter(st, arm);
  const clear = (r: Rect) =>
    allowOverlap ||
    (st.tiles.every((t) => !overlaps(r, t, t === anchor || t.isSpinner ? 0 : gap)) &&
      (Object.entries(st.reserved) as ['N' | 'S', Rect][]).every(([id, res]) => id === arm || !overlaps(r, res, 0)));
  // How far a tile would stick out past the soft edge (0 = inside).
  const overshoot = (r: Rect) =>
    Math.max(0, Math.abs(r.x) + r.w / 2 - halfW) + Math.max(0, Math.abs(r.y) + r.h / 2 - halfH);

  const ok = cands.filter((c) => clear(c.rect));
  ok.sort((a, b) => overshoot(a.rect) - overshoot(b.rect)); // stable: straight first when both fit

  return ok.map((c) => {
    const r = c.rect;
    let first = inner, second = outer;
    const flipped = c.dir.x < 0 || c.dir.y < 0;
    if (flipped) { first = outer; second = inner; }
    const laid: LaidTile = {
      tile, seat: move.seat, ...r, orientation: r.w >= r.h ? 'h' : 'v', first, second, arm, isSpinner: makesSpinner, order, outerHalf: flipped ? 'first' : 'second',
    };
    const reserved = { ...st.reserved };
    if (arm === 'N' || arm === 'S') delete reserved[arm];
    const next: State = {
      tiles: [...st.tiles, laid],
      geo: { ...st.geo, [arm]: c.next },
      outer: { ...st.outer, [arm]: outer },
      reserved,
    };
    if (makesSpinner) {
      const a = cw(c.dir), b = ccw(c.dir);
      const [up, down] = a.y < 0 || a.x < 0 ? [a, b] : [b, a];
      const off = c.crosswise ? 1 : 0.5;
      next.geo.N = { p: add({ x: r.x, y: r.y }, up, off), d: up };
      next.geo.S = { p: add({ x: r.x, y: r.y }, down, off), d: down };
      next.outer.N = tile[0];
      next.outer.S = tile[0];
      next.reserved = { ...next.reserved, N: reserveRect(next.geo.N), S: reserveRect(next.geo.S) };
    }
    return next;
  }).sort((a, b) => Number(spinnerBoxedIn(a)) - Number(spinnerBoxedIn(b)));
}

/** Room for one straight tile (plus a little extra) off a spinner side. */
function reserveRect(g: ArmGeo): Rect {
  const len = 2.5;
  const c = add(g.p, g.d, len / 2);
  return g.d.x !== 0 ? { x: c.x, y: c.y, w: len, h: 1.2 } : { x: c.x, y: c.y, w: 1.2, h: len };
}

/** A freshly made spinner whose side space is already covered by tiles — try other shapes first. */
function spinnerBoxedIn(st: State): boolean {
  return (Object.values(st.reserved) as Rect[]).some((res) =>
    st.tiles.some((t) => !t.isSpinner && overlaps(res, t, 0)));
}

function spinnerOrCenter(st: State, arm: ArmId): LaidTile {
  if (arm === 'N' || arm === 'S') return st.tiles.find((t) => t.isSpinner) ?? st.tiles[0];
  return st.tiles[0];
}

/** If the search runs out of budget: place each tile at the first non-overlapping spot found by pushing further out. */
function greedyFallback(start: State, moves: BoardState['history'], spinnerOrder: number, halfW: number, halfH: number): State {
  let st = start;
  for (let i = 1; i < moves.length; i++) {
    const o = (gap: number, overlap = false) => options(st, moves[i], i, i === spinnerOrder, halfW, halfH, gap, overlap)[0];
    // Never drop a tile: try with the normal gap, then touching, then (last resort) overlapping.
    st = o(GAP) ?? o(0) ?? o(0, true);
  }
  return st;
}

/** Place a tile going direction d from attach point p. Crosswise doubles are 1 long × 2 wide. */
function place(p: V, d: V, dbl: boolean, allowCrosswise: boolean) {
  const crosswise = dbl && allowCrosswise;
  const len = crosswise ? 1 : 2;
  const c = add(p, d, len / 2);
  const rect: Rect = d.x !== 0
    ? { x: c.x, y: c.y, w: len, h: crosswise ? 2 : 1 }
    : { x: c.x, y: c.y, w: crosswise ? 2 : 1, h: len };
  return { rect, next: { p: add(p, d, len), d }, crosswise, dir: d };
}

function overlaps(a: Rect, b: Rect, gap: number) {
  const eps = 1e-6;
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap - eps && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap - eps;
}

/** Pairs of tiles that overlap (always empty — used by the tests). */
export function findOverlaps(layout: Layout): [number, number][] {
  const out: [number, number][] = [];
  const t = layout.tiles;
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (overlaps(t[i], t[j], 0)) out.push([i, j]);
  return out;
}
