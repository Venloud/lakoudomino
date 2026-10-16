import React from 'react';
import { buildTally, TALLY_STROKES, type ScoreEntry, type TallyBox } from '../src/index';
import { seatTint } from './theme';

function boxTip(b: TallyBox, i: number) {
  if (b.kind === 'fifty') return `Box ${i + 1}: 50 pts (bonus)`;
  if (!b.strokes) return `Box ${i + 1}: empty`;
  return `Box ${i + 1}: ${b.strokes * 5} pts${b.strokes === 10 ? ' (full)' : ` · ${50 - b.strokes * 5} to fill`}`;
}

/** Van's scoreboard row: 28px boxes (Figma), strokes in cream, bonus "50" in the seat tint. Hover/tap a box for its points. */
export function TallyRow({ log, rowBoxes, seat, size = 28 }: { log: ScoreEntry[]; rowBoxes: number; seat: number; size?: number }) {
  const t = buildTally(log, rowBoxes);
  return (
    <div className="lk-tally" style={{ gridTemplateColumns: `repeat(${Math.min(rowBoxes, 10)}, ${size}px)` }}>
      {t.boxes.map((b, i) => {
        const tip = boxTip(b, i);
        return (
          <span key={i} className="lk-tbox" tabIndex={0} data-tip={tip} aria-label={tip} style={{ width: size, height: size }}>
            {b.kind === 'fifty' ? (
              <b style={{ color: seatTint(seat), fontSize: size * 0.39 }}>50</b>
            ) : (
              <svg viewBox="0 0 22 22" width={size - 6} height={size - 6}>
                {TALLY_STROKES.slice(0, b.strokes).map(([x1, y1, x2, y2], k) => (
                  <line key={k} x1={x1 * 22} y1={y1 * 22} x2={x2 * 22} y2={y2 * 22} />
                ))}
              </svg>
            )}
          </span>
        );
      })}
      {t.overflow > 0 && <span className="lk-tover">+{t.overflow}</span>}
    </div>
  );
}
