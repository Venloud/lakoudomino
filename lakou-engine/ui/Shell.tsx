// Shared page chrome for the non-game screens: glows, top bar, flag stripe, profile chip.
import React from 'react';
import { Avatar, FlagStripe } from './Parts';

/** Stable colour index (0–3) for someone without a seat, so their avatar colour never changes. */
export function colorFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 4;
}

export interface ProfileChipProps { name: string; flag?: string; color?: number; onClick?: () => void; caret?: boolean }

export function ProfileChip({ name, flag, color, onClick, caret = true }: ProfileChipProps) {
  return (
    <button className="lk-pchip" onClick={onClick} aria-label="Account menu">
      <Avatar seat={color ?? 0} name={name} size={24} />
      <b>{name}</b>
      {flag && <span className="lk-flag">{flag}</span>}
      {caret && <span className="lk-caret">▾</span>}
    </button>
  );
}

export function Page({ right, children, className = '', onHome }: { right?: React.ReactNode; children: React.ReactNode; className?: string; onHome?: () => void }) {
  return (
    <div className={`lk-game lk-page ${className}`}>
      <div className="lk-glows" aria-hidden="true"><i /><i /><i /></div>
      <header className="lk-topbar">
        {onHome ? <button className="lk-brand lk-brand-btn" onClick={onHome}>Lakou Domino</button> : <span className="lk-brand">Lakou Domino</span>}
        <span className="lk-topbar-right lk-topbar-actions">{right}</span>
      </header>
      <FlagStripe height={5} />
      {children}
    </div>
  );
}

export function OnlineLine({ players, tables }: { players: number; tables: number }) {
  return (
    <p className="lk-online">
      <i className="lk-dot lk-dot-green" />
      {players.toLocaleString()} players online  ·  {tables.toLocaleString()} tables playing
    </p>
  );
}

export function Footer() {
  return <p className="lk-footer">Regular and Points modes  ·  Up to 4 players  ·  Free to play</p>;
}
