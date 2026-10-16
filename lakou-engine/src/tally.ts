import type { ScoreEntry } from './types';

/**
 * Van's hand-drawn scoreboard.
 * Each box is worth 50: ten strokes of 5 points.
 *   stroke 1 "\" (5), stroke 2 "/" makes an X (10),
 *   then a two-stroke chevron in each gap of the X: top, right, bottom, left (8 strokes) = 50.
 * Small points always fill the EARLIEST unfinished box.
 * A 50 bonus is written as "50" in the next COMPLETELY EMPTY box (bowling-style).
 * If no empty box is left, the bonus fills what's left as strokes and any extra is overflow ("+10").
 * Invariant: sum of boxes = min(total, rowBoxes*50), so a full row <=> total >= target.
 */
export type TallyBox =
  | { kind: 'strokes'; strokes: number } // 0..10 (0 = empty box)
  | { kind: 'fifty' };

export interface Tally {
  boxes: TallyBox[];
  overflow: number;
  total: number;
  full: boolean;
}

export function buildTally(log: ScoreEntry[], rowBoxes: number): Tally {
  const boxes: TallyBox[] = Array.from({ length: rowBoxes }, () => ({ kind: 'strokes', strokes: 0 }));
  let overflow = 0;
  let total = 0;

  const addStrokes = (count: number) => {
    for (const b of boxes) {
      if (count === 0) break;
      if (b.kind === 'strokes' && b.strokes < 10) {
        const take = Math.min(10 - b.strokes, count);
        b.strokes += take;
        count -= take;
      }
    }
    overflow += count * 5;
  };

  for (const e of log) {
    total += e.amount;
    if (e.kind === 'bonus') {
      // Each 50 of a bonus gets its own "50" box (an All four of 200 fills four boxes).
      for (let k = 0; k < e.amount / 50; k++) {
        const empty = boxes.findIndex((b) => b.kind === 'strokes' && b.strokes === 0);
        if (empty >= 0) boxes[empty] = { kind: 'fifty' };
        else addStrokes(10);
      }
    } else {
      addStrokes(e.amount / 5);
    }
  }
  const full = boxes.every((b) => b.kind === 'fifty' || b.strokes === 10);
  return { boxes, overflow, total, full };
}

/** A line segment inside a 1×1 box: [x1, y1, x2, y2], (0,0) = top-left. */
export type Segment = [number, number, number, number];

/** The 10 strokes of a box, in drawing order. Take the first N to draw a box with N strokes. */
export const TALLY_STROKES: Segment[] = [
  [0.18, 0.18, 0.82, 0.82], // 1  "\"
  [0.82, 0.18, 0.18, 0.82], // 2  "/"  -> X
  [0.36, 0.08, 0.5, 0.3],   // 3  top chevron, left arm
  [0.5, 0.3, 0.64, 0.08],   // 4  top chevron, right arm
  [0.92, 0.36, 0.7, 0.5],   // 5  right chevron, upper arm
  [0.7, 0.5, 0.92, 0.64],   // 6  right chevron, lower arm
  [0.36, 0.92, 0.5, 0.7],   // 7  bottom chevron, left arm
  [0.5, 0.7, 0.64, 0.92],   // 8  bottom chevron, right arm
  [0.08, 0.36, 0.3, 0.5],   // 9  left chevron, upper arm
  [0.3, 0.5, 0.08, 0.64],   // 10 left chevron, lower arm
];

/** Ready-made SVG markup for one box (size in px). Handy for the scoreboard and the player cards. */
export function tallyBoxSvg(box: TallyBox, size = 40, color = '#F4EFE6'): string {
  const inner =
    box.kind === 'fifty'
      ? `<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700" font-size="${size * 0.42}" fill="${color}">50</text>`
      : TALLY_STROKES.slice(0, box.strokes)
          .map(([x1, y1, x2, y2]) =>
            `<line x1="${x1 * size}" y1="${y1 * size}" x2="${x2 * size}" y2="${y2 * size}" stroke="${color}" stroke-width="${Math.max(1.5, size / 18)}" stroke-linecap="round"/>`)
          .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${inner}</svg>`;
}
