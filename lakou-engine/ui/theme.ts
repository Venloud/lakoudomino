// Lakou Domino design tokens — taken from the Figma file (p1dqMpTkC2qzsJeY61Zhnq).
/** Four seats, four colors: blue, red, green, yellow. */
export const SEAT_COLORS = ['#2F6BFF', '#E63946', '#1FB65E', '#FFD23F'] as const;
/** Lighter tint of each seat colour, used for "50" in the tally boxes (Figma: #7FA4FF for blue). */
export const SEAT_TINTS = ['#7FA4FF', '#F2848C', '#6FD89A', '#FFE38A'] as const;
/** Text colour that reads on top of each seat colour (yellow needs dark text). */
export const SEAT_INK = ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#141218'] as const;

export const seatColor = (seat: number) => SEAT_COLORS[seat % 4];
export const seatTint = (seat: number) => SEAT_TINTS[seat % 4];
export const seatInk = (seat: number) => SEAT_INK[seat % 4];

/** Figma seat card border: seat colour at 55% opacity. */
export function seatBorder(seat: number, alpha = 0.55) {
  const hex = seatColor(seat).slice(1);
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
export const initial = (name: string) => (name.trim()[0] || '?').toUpperCase();
