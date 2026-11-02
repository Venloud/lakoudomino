// Shared page chrome for the non-game screens: glows, top bar, flag stripe, profile chip.
import React from 'react';
import { Avatar } from './Parts';

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

type SiteNavTarget = 'lk-nav-games' | 'lk-nav-friends' | 'lk-nav-leaderboard' | 'lk-nav-profile';

function SiteNavIcon({ name }: { name: 'home' | 'games' | 'friends' | 'leaderboard' | 'profile' | 'notifications' | 'messages' }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    games: <><rect x="3" y="7" width="18" height="12" rx="3" /><path d="M8 13h4m-2-2v4m5-2h.01m3 0h.01" /></>,
    friends: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    leaderboard: <><path d="M8 21h8m-4-4v4m-7-17h14v4a7 7 0 0 1-14 0V4Z" /><path d="M5 6H3v2a4 4 0 0 0 4 4m12-6h2v2a4 4 0 0 1-4 4" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    messages: <><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5Z" /><path d="M8 11.5h8m-8 3h5" /></>,
  };
  return <svg className="lk-site-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function SiteNavigation({ onHome, onNavigate, active = 'home' }: {
  onHome?: () => void; onNavigate?: (target: SiteNavTarget) => void; active?: string;
}) {
  const items: { label: string; target?: SiteNavTarget; icon: 'home' | 'games' | 'friends' | 'leaderboard' | 'profile' }[] = [
    { label: 'Home', icon: 'home' },
    { label: 'Games', target: 'lk-nav-games', icon: 'games' },
    { label: 'Friends', target: 'lk-nav-friends', icon: 'friends' },
    { label: 'Leaderboard', target: 'lk-nav-leaderboard', icon: 'leaderboard' },
    { label: 'Profile', target: 'lk-nav-profile', icon: 'profile' },
  ];
  const navigate = (target: SiteNavTarget) => {
    if (onNavigate) onNavigate(target);
    else if (typeof window !== 'undefined') window.location.assign(`/#${target}`);
  };
  return (
    <nav className="lk-site-nav" aria-label="Main navigation">
      <div className="lk-site-nav-links">
        {items.map((item) => (
          <button key={item.label} type="button" className={`lk-site-nav-link${active === item.label.toLowerCase() ? ' lk-site-nav-active' : ''}`}
            aria-current={active === item.label.toLowerCase() ? 'page' : undefined}
            onClick={() => item.target ? navigate(item.target) : onHome ? onHome() : window.location.assign('/')}>
            <SiteNavIcon name={item.icon} /><span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="lk-site-tools">
        <button type="button" className="lk-site-tool lk-site-notification" aria-label="Notifications" title="Notifications" onClick={() => navigate('lk-nav-friends')}>
          <SiteNavIcon name="notifications" /><i aria-hidden="true" />
        </button>
        <button type="button" className="lk-site-tool lk-site-message" aria-label="Messages" title="Messages" onClick={() => navigate('lk-nav-friends')}>
          <SiteNavIcon name="messages" />
        </button>
      </div>
    </nav>
  );
}

export function Page({ right, children, className = '', onHome, navigation }: { right?: React.ReactNode; children: React.ReactNode; className?: string; onHome?: () => void; navigation?: React.ReactNode }) {
  const siteNavigation = navigation ?? <SiteNavigation onHome={onHome} />;
  return (
    <div className={`lk-game lk-page ${className}`}>
      <div className="lk-glows" aria-hidden="true"><i /><i /><i /></div>
      <header className="lk-topbar lk-site-topbar">
        {onHome ? <button className="lk-site-brand" onClick={onHome} aria-label="509 Yard home"><img src="/509-yard-logo.png" alt="509 Yard" /></button> : <a className="lk-site-brand" href="/" aria-label="509 Yard home"><img src="/509-yard-logo.png" alt="509 Yard" /></a>}
        {siteNavigation}
        <span className="lk-topbar-right lk-topbar-actions">{right}</span>
      </header>
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
