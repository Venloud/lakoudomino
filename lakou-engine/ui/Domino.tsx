import React, { createContext, useContext } from 'react';
import { DEFAULT_DOMINO_STYLE, dominoAssetUrl, type DominoStyle } from './domino-style';

export { DEFAULT_DOMINO_STYLE, type DominoStyle } from './domino-style';
export const DominoStyleContext = createContext<DominoStyle>(DEFAULT_DOMINO_STYLE);

/** A tile uses 560×1120 art, displayed at the requested half-unit size. */
export interface DominoProps {
  first: number;
  second: number;
  orientation: 'h' | 'v';
  unit: number;
  skin?: DominoStyle;
  /** Halves whose pips glow (0 = first, 1 = second), e.g. after they were counted for points. */
  litHalves?: number[];
  /** Negative ms offset so a glow keeps in step across re-renders. */
  glowDelayMs?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Domino({ first, second, orientation, unit: u, litHalves = [], className = '', style, skin: requestedSkin }: DominoProps) {
  const contextStyle = useContext(DominoStyleContext);
  const skin = requestedSkin ?? contextStyle;
  const flat = orientation === 'h';
  const w = flat ? 2 * u : u;
  const h = flat ? u : 2 * u;
  return (
    <span className={`lk-domino lk-domino-image${litHalves.length ? ' lk-domino-lit' : ''} ${className}`} style={{ width: w, height: h, ...style }}>
      <img
        src={dominoAssetUrl(first, second, skin)}
        alt=""
        draggable={false}
        className={`lk-domino-art${flat ? ` lk-domino-art-flat${first <= second ? '' : ' lk-domino-art-reverse'}` : first > second ? ' lk-domino-art-reverse' : ''}`}
        style={{ width: u, height: 2 * u }}
      />
    </span>
  );
}
