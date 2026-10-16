import React from 'react';

/**
 * One domino, drawn exactly like the Figma tiles:
 * ivory #F7F1E3, corner radius = unit/6, pips #1B1B1B at 17% of a half,
 * a thin #CFC6B4 divider (64% of the half's width), soft drop shadow.
 *
 * `unit` = size of one half in px. A flat ('h') tile is 2u × 1u, a standing ('v') tile is 1u × 2u.
 * `first` = pips on the left ('h') or top ('v') half; `second` = right / bottom half.
 */
export interface DominoProps {
  first: number;
  second: number;
  orientation: 'h' | 'v';
  unit: number;
  /** Halves whose pips glow (0 = first, 1 = second), e.g. after they were counted for points. */
  litHalves?: number[];
  /** Negative ms offset so a glow keeps in step across re-renders. */
  glowDelayMs?: number;
  className?: string;
  style?: React.CSSProperties;
}

// Pip cells for a standing half, as [row, col] in a 3×3 grid. Flat halves use the transposed grid.
const PIPS: Record<number, [number, number][]> = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [1, 0], [2, 0], [0, 2], [1, 2], [2, 2]],
};
const CENTERS = [0.249, 0.5, 0.751]; // Figma pip centres inside a half

function Half({ n, u, flat, lit, glowDelayMs }: { n: number; u: number; flat: boolean; lit: boolean; glowDelayMs?: number }) {
  const d = Math.max(2, u * 0.17);
  return (
    <span className={`lk-half${lit ? ' lk-lit' : ''}`} style={{ width: u, height: u, ...(lit && glowDelayMs ? ({ '--lk-glow-delay': `${glowDelayMs}ms` } as React.CSSProperties) : {}) }}>
      {(PIPS[n] || []).map(([r, c], i) => {
        const [row, col] = flat ? [c, r] : [r, c];
        return <i key={i} style={{ width: d, height: d, left: CENTERS[col] * u - d / 2, top: CENTERS[row] * u - d / 2 }} />;
      })}
    </span>
  );
}

export function Domino({ first, second, orientation, unit: u, litHalves = [], glowDelayMs, className = '', style }: DominoProps) {
  const flat = orientation === 'h';
  const w = flat ? 2 * u : u;
  const h = flat ? u : 2 * u;
  const lineThick = Math.max(1, u * 0.042);
  const lineLen = u * 0.64;
  return (
    <span className={`lk-domino ${className}`} style={{ width: w, height: h, borderRadius: u / 6, ...style }}>
      <span className="lk-halves" style={{ flexDirection: flat ? 'row' : 'column' }}>
        <Half n={first} u={u} flat={flat} lit={litHalves.includes(0)} glowDelayMs={glowDelayMs} />
        <Half n={second} u={u} flat={flat} lit={litHalves.includes(1)} glowDelayMs={glowDelayMs} />
      </span>
      <span
        className="lk-divider"
        style={flat
          ? { width: lineThick, height: lineLen, left: u - lineThick / 2, top: (u - lineLen) / 2 }
          : { height: lineThick, width: lineLen, top: u - lineThick / 2, left: (u - lineLen) / 2 }}
      />
    </span>
  );
}
