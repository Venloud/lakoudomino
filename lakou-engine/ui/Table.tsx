import React, { useLayoutEffect, useRef, useState } from 'react';
import { layoutBoard, type BoardState, type LaidTile, type Tile, type countedHalves } from '../src/index';
import { Domino } from './Domino';
import { seatColor, seatInk } from './theme';

export interface Ghost { key: string; tile: LaidTile }
export interface RevealRow { seat: number; name: string; tiles: Tile[]; pips: number }

export interface TableProps {
  board: BoardState;
  /** Largest half-size in px (Figma: 36 on desktop, 21.5 on phone). Tiles never get bigger than this. */
  maxUnit: number;
  names: string[];
  /** Legal drop spots for the selected tile (dashed gold outlines). */
  ghosts?: Ghost[];
  onGhost?: (key: string) => void;
  onBackground?: () => void;
  /** Pips to light up after a score. */
  glow?: { halves: ReturnType<typeof countedHalves>; at: number } | null;
  /** Gold "+15" pill next to the newest tile. */
  pop?: { text: string; key: number; big?: boolean } | null;
  /** End of hand: everyone's leftover tiles, face up over a dimmed board. */
  reveal?: { title: string; rows: RevealRow[] } | null;
  compact?: boolean;
  /** Whose turn it is: the table frame takes that seat's color. null = nobody (pause, hand over). */
  turnSeat?: number | null;
  /** Where each seat sits around this viewer's table, so a new tile slides in from that side. */
  sideOf?: (seat: number) => 'left' | 'right' | 'top' | 'bottom';
}

const GLOW_MS = 2000;

export function Table({ board, maxUnit, names, ghosts = [], onGhost, onBackground, glow, pop, reveal, compact, turnSeat, sideOf }: TableProps) {
  const feltRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    const el = feltRef.current;
    if (!el) return;
    const measure = () => setSize(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = layoutBoard(board, { halfWidth: 8, halfHeight: 8 });
  const all = [...layout.tiles, ...ghosts.map((g) => g.tile)];
  const newest = layout.tiles.length ? layout.tiles[layout.tiles.length - 1] : null;

  let unit = maxUnit, offX = 0, offY = 0;
  if (all.length && size) {
    const minX = Math.min(...all.map((t) => t.x - t.w / 2)), maxX = Math.max(...all.map((t) => t.x + t.w / 2));
    const minY = Math.min(...all.map((t) => t.y - t.h / 2)), maxY = Math.max(...all.map((t) => t.y + t.h / 2));
    // Always leave at least 1.5 halves of wood on every side, and never exceed the Figma tile size.
    unit = Math.min(maxUnit, size / (maxX - minX + 3), size / (maxY - minY + 3));
    offX = (size - (maxX - minX) * unit) / 2 - minX * unit;
    offY = (size - (maxY - minY) * unit) / 2 - minY * unit;
  }
  const inset = Math.max(0.75, unit * 0.028); // Figma: ~2px between touching tiles at 36px
  const box = (t: LaidTile): React.CSSProperties => ({
    left: offX + (t.x - t.w / 2) * unit + inset,
    top: offY + (t.y - t.h / 2) * unit + inset,
  });
  const u = unit - inset; // draw each half slightly smaller so neighbours never touch

  const glowActive = glow && performance.now() - glow.at < GLOW_MS ? glow : null;
  const glowDelay = glowActive ? -Math.round(performance.now() - glowActive.at) : 0;
  const litFor = (t: LaidTile) => {
    if (!glowActive) return [];
    const out: number[] = [];
    for (const g of glowActive.halves) {
      if (g.order !== t.order) continue;
      if (g.half === 'both') out.push(0, 1);
      else if (g.half === 'first') out.push(0);
      else if (g.half === 'second') out.push(1);
      else out.push(t.outerHalf === 'first' ? 0 : 1);
    }
    return out;
  };
  // Start offset for the slide-in: from that player's edge of the table toward where the tile lands.
  const slideFrom = (t: LaidTile) => {
    if (!sideOf || !size) return {};
    const cx = offX + t.x * unit, cy = offY + t.y * unit;
    const side = sideOf(t.seat);
    const fx = side === 'left' ? -cx - 20 : side === 'right' ? size - cx + 20 : 0;
    const fy = side === 'top' ? -cy - 20 : side === 'bottom' ? size - cy + 20 : 0;
    return { '--lk-fx': `${Math.round(fx)}px`, '--lk-fy': `${Math.round(fy)}px` };
  };
  const tagSide = (t: LaidTile) => (t.order === 0 ? 'bottom' : Math.abs(t.x) > Math.abs(t.y) ? (t.x > 0 ? 'right' : 'left') : t.y < 0 ? 'top' : 'bottom');

  return (
    <div
      className={`lk-table${compact ? ' lk-compact' : ''}${turnSeat != null ? ' lk-turn-on' : ''}`}
      style={turnSeat != null ? ({ '--lk-turn': seatColor(turnSeat) } as React.CSSProperties) : undefined}
    >
      <div className="lk-felt" ref={feltRef} onClick={(e) => { if (!(e.target as HTMLElement).closest('.lk-ghost')) onBackground?.(); }}>
        {size > 0 && layout.tiles.map((t) => (
          <div key={t.order} className={`lk-laid${newest && t.order === newest.order ? ' lk-newest' : ''}`} style={{ ...box(t), '--lk-seat': seatColor(t.seat), ...slideFrom(t) } as React.CSSProperties}>
            <Domino first={t.first} second={t.second} orientation={t.orientation} unit={u} litHalves={litFor(t)} glowDelayMs={glowDelay} />
            {newest && t.order === newest.order && !ghosts.length && (
              <span className={`lk-namepill lk-${tagSide(t)}`} style={{ background: seatColor(t.seat), color: seatInk(t.seat) }}>{names[t.seat]}</span>
            )}
          </div>
        ))}
        {size > 0 && ghosts.map((g) => (
          <button
            key={g.key}
            className="lk-ghost"
            aria-label="Play here"
            onClick={() => onGhost?.(g.key)}
            style={{ ...box(g.tile), width: g.tile.w * unit - 2 * inset, height: g.tile.h * unit - 2 * inset, borderRadius: u / 6 }}
          />
        ))}
        {size > 0 && pop && newest && (
          <span key={pop.key} className={`lk-pop${pop.big ? ' lk-pop-big' : ''}`} style={{ left: offX + (newest.x + newest.w / 2) * unit + 6, top: offY + (newest.y - newest.h / 2) * unit - 10 }}>
            {pop.text}
          </span>
        )}
        {!layout.tiles.length && <div className="lk-empty">Waiting for the first tile…</div>}
        {reveal && (
          <div className="lk-reveal">
            <p className="lk-eyebrow lk-reveal-title">{reveal.title}</p>
            {reveal.rows.map((r) => (
              <div key={r.seat} className="lk-reveal-row" style={{ borderLeftColor: seatColor(r.seat) }}>
                <b style={{ color: seatColor(r.seat) }}>{r.name}</b>
                <span className="lk-reveal-tiles">
                  {r.tiles.length
                    ? r.tiles.map((t, i) => <Domino key={i} first={t[0]} second={t[1]} orientation="v" unit={compact ? 14 : 23} className="lk-flip" />)
                    : <em>Domino!</em>}
                </span>
                <span className="lk-reveal-pips">{r.tiles.length ? `${r.pips} pips` : 'went out'}</span>
              </div>
            ))}
            <p className="lk-reveal-note">Tiles stay face up for 3 seconds, then the standings open.</p>
          </div>
        )}
      </div>
    </div>
  );
}
