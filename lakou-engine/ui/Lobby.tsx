// Home — Lobby (Figma 3-2, guest) and Home — Signed in (Figma 12-2). One component: pass `profile` when signed in.
import React, { useState } from 'react';
import { Avatar, useCountdown } from './Parts';
import { seatColor, seatInk } from './theme';
import { Domino } from './Domino';
import { Footer, OnlineLine, Page, ProfileChip, colorFor } from './Shell';

export type LobbyMode = 'regular' | 'points';

const regionalFlags = [
  '🇦🇮', '🇦🇬', '🇦🇼', '🇧🇸', '🇧🇧', '🇧🇿', '🇧🇲', '🇧🇶', '🇻🇬', '🇰🇾',
  '🇨🇺', '🇨🇼', '🇩🇲', '🇩🇴', '🇬🇩', '🇬🇵', '🇬🇾', '🇭🇹', '🇯🇲', '🇲🇶',
  '🇲🇸', '🇵🇷', '🇧🇱', '🇰🇳', '🇱🇨', '🇲🇫', '🇵🇲', '🇻🇨', '🇸🇽', '🇸🇷',
  '🇹🇹', '🇹🇨', '🇻🇮', '🇻🇪', '🇨🇴', '🇵🇦', '🇨🇷', '🇳🇮', '🇭🇳', '🇬🇹',
  '🇲🇽',
];

export interface LeaderRow { id: string; name: string; points: number; gold: number; silver: number; bronze: number; isMe?: boolean }
export interface OpenTableRow { code: string; name: string; mode: LobbyMode; seats: number; maxSeats: number; rowBoxes?: number; turnSeconds?: number }
export interface OpenTableOptions { name: string; mode: LobbyMode; rowBoxes: number; turnSeconds: number; private: boolean }
export interface Profile {
  name: string; flag?: string; color?: number; crownPoints: number; gold: number; silver: number; bronze: number;
  games: number; wins: number; socials?: { label: string; url: string }[];
}
export type FriendStatus = 'lobby' | 'game' | 'online' | 'offline' | 'table';
export interface Friend {
  id: string; name: string; status: FriendStatus;
  /** Extra text: game mode for 'game' ("Points"), "2h ago" / "yesterday" for 'offline'. */
  detail?: string; color?: number;
  /** Waiting room only: already sitting at this table. */
  joined?: boolean;
}
export interface FriendRequest { id: string; name: string; color?: number }

export interface LobbyScreenProps {
  /** Signed-in player. Leave null/undefined for the guest lobby. */
  profile?: Profile | null;
  onlinePlayers: number;
  tablesPlaying: number;
  connected: boolean;
  leaderboard: LeaderRow[];
  openTables: OpenTableRow[];
  onJoinTable: (code: string) => void;
  /** "Play now": join the matchmaking queue for this mode (server: joinQueue). */
  onPlayNow?: (mode: LobbyMode) => void;
  /** While this viewer is in the Play now queue: shows the "Finding players" overlay. */
  queue?: PlayNowQueueProps | null;
  onOpenTable: (opts: OpenTableOptions) => void;
  onViewLeaderboard?: () => void;
  /** Tap on "Lakou Domino" (back to the top of the lobby / refresh). */
  onHome?: () => void;
  // guest
  onSignIn?: () => void;
  onSignUp?: () => void;
  defaultName?: string;
  onHowToPlay?: () => void;
  // both
  onPlayFriends?: () => void;
  onPracticeBots?: () => void;
  // signed in
  onProfileMenu?: () => void;
  onEditProfile?: () => void;
  friends?: Friend[];
  requests?: FriendRequest[];
  onAddFriend?: (username: string) => void;
  onAcceptFriend?: (id: string) => void;
  onDeclineFriend?: (id: string) => void;
  onInviteFriend?: (id: string) => void;
  onWatchFriend?: (id: string) => void;
}

export function LobbyScreen(p: LobbyScreenProps) {
  const signedIn = !!p.profile;
  const right = signedIn
    ? <ProfileChip name={p.profile!.name} flag={p.profile!.flag} color={p.profile!.color} onClick={p.onProfileMenu} />
    : <>
        <button className="lk-btn-line" onClick={p.onSignIn}>Sign in</button>
        <button className="lk-btn-cta" onClick={p.onSignUp}>Sign up</button>
      </>;

  return (
    <Page right={right} onHome={p.onHome}>
      <OnlineLine players={p.onlinePlayers} tables={p.tablesPlaying} />
      <RegionalFlagTicker />
      <main className={`lk-home${signedIn ? ' lk-home-in' : ''}`}>
        {signedIn ? (
          <aside className="lk-col lk-col-left">
            <ProfileCard profile={p.profile!} onEdit={p.onEditProfile} />
            <button className="lk-bigbtn lk-bigbtn-gold" onClick={p.onPlayFriends}>Play with friends</button>
            <button className="lk-bigbtn" onClick={p.onPracticeBots}>Practice vs bots</button>
            <Leaderboard rows={p.leaderboard} onViewAll={p.onViewLeaderboard} compact />
          </aside>
        ) : (
          <aside className="lk-col lk-col-left">
            <Leaderboard rows={p.leaderboard} onViewAll={p.onViewLeaderboard} onSignIn={p.onSignIn} />
          </aside>
        )}

        <LiveLobby
          connected={p.connected} tables={p.openTables} onJoin={p.onJoinTable} onOpen={p.onOpenTable}
          askName={!signedIn} defaultName={p.defaultName ?? p.profile?.name ?? ''} onPlayNow={p.onPlayNow}
        />

        {signedIn ? (
          <FriendsPanel
            friends={p.friends ?? []} requests={p.requests ?? []}
            onAdd={p.onAddFriend} onAccept={p.onAcceptFriend} onDecline={p.onDeclineFriend}
            onInvite={p.onInviteFriend} onWatch={p.onWatchFriend}
          />
        ) : (
          <aside className="lk-col lk-quick">
            <p className="lk-eyebrow">QUICK PLAY</p>
            <QuickCard tile={[6, 6]} title="Play with friends" sub="Invite with a link or code" onClick={p.onPlayFriends} />
            <QuickCard tile={[5, 4]} title="Practice vs bots" sub="Easy or Hard, start instantly" onClick={p.onPracticeBots} />
            <QuickCard tile={[2, 1]} title="How to play" sub="Regular and Points rules" onClick={p.onHowToPlay} />
          </aside>
        )}
      </main>
      <Footer />
      {p.queue && <PlayNowQueue {...p.queue} />}
    </Page>
  );
}

function RegionalFlagTicker() {
  const flagSet = (copy: string) => (
    <div className="lk-flag-set" key={copy} aria-hidden="true">
      {regionalFlags.map((flag, index) => <span className="lk-regional-flag" key={`${flag}-${index}`}>{flag}</span>)}
    </div>
  );

  return (
    <div className="lk-flag-bar" role="img" aria-label="Caribbean and nearby regional flags">
      <div className="lk-flag-track">
        {flagSet('first')}
        {flagSet('second')}
      </div>
    </div>
  );
}

function Crowns({ gold, silver, bronze, words, size = 8 }: { gold: number; silver: number; bronze: number; words?: boolean; size?: number }) {
  const one = (cls: string, n: number, w: string) => (
    <span className="lk-crownct"><i className={`lk-dot ${cls}`} style={{ width: size, height: size }} /><span>{words ? `${n} ${w}` : n}</span></span>
  );
  return <span className="lk-crowns">{one('lk-dot-gold', gold, 'gold')}{one('lk-dot-silver', silver, 'silver')}{one('lk-dot-bronze', bronze, 'bronze')}</span>;
}

export function Leaderboard({ rows, onViewAll, compact, onSignIn }: { rows: LeaderRow[]; onViewAll?: () => void; compact?: boolean; onSignIn?: () => void }) {
  return (
    <section className={`lk-panel lk-board${compact ? ' lk-board-compact' : ''}`}>
      <div className="lk-row-between">
        <p className="lk-eyebrow">LEADERBOARD</p>
        {onViewAll && <button className="lk-link" onClick={onViewAll}>View all</button>}
      </div>
      <ol className="lk-board-list">
        {rows.map((r, i) => (
          <li key={r.id} className={`lk-board-row${r.isMe ? ' lk-me' : ''}`}>
            <b className={`lk-rank${i < 3 ? ' lk-top' : ''}`}>{i + 1}</b>
            <span className="lk-grow lk-board-name">
              <span>{r.name}{r.isMe ? ' (you)' : ''}</span>
              {!compact && <Crowns gold={r.gold} silver={r.silver} bronze={r.bronze} />}
            </span>
            <b className="lk-board-pts">{r.points}</b>
          </li>
        ))}
        {rows.length === 0 && <li className="lk-sub">No crowns yet. Win a Points game against real players to get on the board.</li>}
      </ol>
      {onSignIn && (
        <p className="lk-board-guest">
          <button className="lk-link" onClick={onSignIn}>Sign in or create an account</button> to get on the board. Guest games don’t earn crowns.
        </p>
      )}
    </section>
  );
}

function QuickCard({ tile, title, sub, onClick }: { tile: [number, number]; title: string; sub: string; onClick?: () => void }) {
  return (
    <button className="lk-quick-card" onClick={onClick}>
      <Domino first={tile[0]} second={tile[1]} orientation="h" unit={18} />
      <b>{title}</b>
      <span className="lk-sub">{sub}</span>
    </button>
  );
}

function ProfileCard({ profile, onEdit }: { profile: Profile; onEdit?: () => void }) {
  return (
    <section className="lk-panel lk-profile">
      <div className="lk-inline">
        <Avatar seat={profile.color ?? 0} name={profile.name} size={44} />
        <span className="lk-profile-id">
          <b className="lk-h16">{profile.name} {profile.flag && <span className="lk-flag">{profile.flag}</span>}</b>
          <span className="lk-gold lk-small">{profile.crownPoints} crown points</span>
        </span>
      </div>
      <Crowns gold={profile.gold} silver={profile.silver} bronze={profile.bronze} words size={9} />
      <span className="lk-sub">{profile.games} games played  ·  {profile.wins} wins</span>
      <div className="lk-inline lk-socials">
        {(profile.socials ?? []).map((s) => (
          <a key={s.label} className="lk-social" href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
        ))}
        {onEdit && <button className="lk-link lk-push" onClick={onEdit}>Edit profile</button>}
      </div>
    </section>
  );
}

const TIMER_OPTIONS = [15, 30, 45, 60];

function LiveLobby({ connected, tables, onJoin, onOpen, askName, defaultName, onPlayNow }: {
  connected: boolean; tables: OpenTableRow[]; onJoin: (code: string) => void; onOpen: (o: OpenTableOptions) => void;
  askName: boolean; defaultName: string; onPlayNow?: (mode: LobbyMode) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(defaultName);
  const [mode, setMode] = useState<LobbyMode>('points');
  const [pnMode, setPnMode] = useState<LobbyMode>('points');
  const [rowBoxes, setRowBoxes] = useState(10);
  const [turnSeconds, setTurnSeconds] = useState(30);
  const [priv, setPriv] = useState(false);
  const cleanCode = code.trim().toUpperCase();
  const [filter, setFilter] = useState<'all' | LobbyMode>('all');
  const [boxFilter, setBoxFilter] = useState<number | 'any'>('any');
  const boxOptions = [...new Set(tables.filter((t) => t.mode === 'points' && t.rowBoxes).map((t) => t.rowBoxes!))].sort((a, b) => a - b);
  const shown = tables.filter((t) => (filter === 'all' || t.mode === filter) && (filter !== 'points' || boxFilter === 'any' || t.rowBoxes === boxFilter));

  return (
    <section className="lk-panel lk-live">
      <div className="lk-live-top">
        <div className="lk-live-head">
          <h1 className="lk-h20">Live lobby</h1>
          <span className={`lk-conn${connected ? '' : ' lk-off'}`}><i className={`lk-dot ${connected ? 'lk-dot-green' : 'lk-dot-red'}`} />{connected ? 'Connected' : 'Reconnecting…'}</span>
        </div>
        {onPlayNow && (
          <div className="lk-playnow">
            <button className="lk-playnow-btn" onClick={() => onPlayNow(pnMode)} disabled={!connected}>
              <b>Play now</b><span>{pnMode === 'points' ? 'Points' : 'Regular'} · jump in a game</span>
            </button>
            <button className="lk-link lk-playnow-switch" onClick={() => setPnMode(pnMode === 'points' ? 'regular' : 'points')}>
              Switch to {pnMode === 'points' ? 'Regular' : 'Points'}
            </button>
          </div>
        )}
      </div>
      <div className="lk-live-body">
        <div className="lk-open-list">
          <div className="lk-row-between lk-filter-row">
            <p className="lk-eyebrow">OPEN TABLES</p>
            <div className="lk-filters" role="radiogroup" aria-label="Filter tables">
              {(['all', 'regular', 'points'] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={filter === f} className={filter === f ? 'lk-on' : ''} onClick={() => { setFilter(f); setBoxFilter('any'); }}>
                  {f === 'all' ? 'All' : f === 'points' ? 'Points' : 'Regular'}
                </button>
              ))}
              {filter === 'points' && boxOptions.length > 1 && (
                <span className="lk-select lk-select-mini">
                  <select id="lk-filter-boxes" aria-label="Row length" value={boxFilter} onChange={(e) => setBoxFilter(e.target.value === 'any' ? 'any' : Number(e.target.value))}>
                    <option value="any">Any row</option>
                    {boxOptions.map((b) => <option key={b} value={b}>{b} boxes</option>)}
                  </select>
                  <i aria-hidden="true">▾</i>
                </span>
              )}
            </div>
          </div>
          <div className="lk-tables">
            <div className="lk-table-row lk-table-head" aria-hidden="true">
              <span className="lk-c-host">Host</span><span className="lk-c-mode">Mode</span><span className="lk-c-seats">Seats</span><span />
            </div>
            {shown.map((t) => (
              <div key={t.code} className="lk-table-row">
                <span className="lk-c-host lk-strong">{t.name}</span>
                <span className="lk-c-mode lk-muted">{t.mode === 'points' ? `Points${t.rowBoxes ? ` · ${t.rowBoxes}` : ''}` : 'Regular'}</span>
                <span className="lk-c-seats lk-muted">{t.seats}/{t.maxSeats}</span>
                <button className="lk-join" onClick={() => onJoin(t.code)} disabled={t.seats >= t.maxSeats}>{t.seats >= t.maxSeats ? 'Full' : 'Join'}</button>
              </div>
            ))}
            {tables.length === 0 && <p className="lk-sub lk-notables">No open tables right now. Open one and share the code.</p>}
            {tables.length > 0 && shown.length === 0 && <p className="lk-sub lk-notables">No {filter === 'points' ? 'Points' : 'Regular'} tables open right now.</p>}
          </div>
          <form className="lk-code-join" onSubmit={(e) => { e.preventDefault(); if (cleanCode) onJoin(cleanCode); }}>
            <input id="lk-join-code" className="lk-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter table code" maxLength={8} autoCapitalize="characters" autoComplete="off" aria-label="Table code" />
            <button type="submit" className="lk-code-btn" disabled={!cleanCode}>Join</button>
          </form>
        </div>

        <form className="lk-open-card" onSubmit={(e) => { e.preventDefault(); onOpen({ name: name.trim() || 'Guest', mode, rowBoxes, turnSeconds, private: priv }); }}>
          <p className="lk-eyebrow">OPEN A TABLE</p>
          {askName && (
            <label className="lk-field">
              <span>Your name</span>
              <input id="lk-open-name" className="lk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jean" maxLength={20} />
            </label>
          )}
          <div className="lk-field">
            <span>Mode</span>
            <div className="lk-seg" role="radiogroup" aria-label="Mode">
              {(['regular', 'points'] as LobbyMode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'lk-on' : ''} onClick={() => setMode(m)}>
                  {m === 'points' ? 'Points' : 'Regular'}
                </button>
              ))}
            </div>
          </div>
          <div className={`lk-field${mode !== 'points' ? ' lk-disabled' : ''}`}>
            <span>Row length (Points only)</span>
            <div className="lk-stepper">
              <button type="button" aria-label="Fewer boxes" disabled={mode !== 'points' || rowBoxes <= 5} onClick={() => setRowBoxes((n) => n - 1)}>−</button>
              <b>{rowBoxes} boxes</b>
              <button type="button" aria-label="More boxes" disabled={mode !== 'points' || rowBoxes >= 20} onClick={() => setRowBoxes((n) => n + 1)}>+</button>
            </div>
          </div>
          <label className="lk-field">
            <span>Turn timer</span>
            <span className="lk-select">
              <select id="lk-open-timer" value={turnSeconds} onChange={(e) => setTurnSeconds(Number(e.target.value))}>
                {TIMER_OPTIONS.map((s) => <option key={s} value={s}>{s} seconds</option>)}
              </select>
              <i aria-hidden="true">▾</i>
            </span>
          </label>
          <label className="lk-toggle">
            <span>Private table</span>
            <input id="lk-open-private" type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
            <i aria-hidden="true" />
          </label>
          <button type="submit" className="lk-open-btn">Open table</button>
        </form>
      </div>
    </section>
  );
}

function statusLine(f: Friend) {
  switch (f.status) {
    case 'lobby': return <span className="lk-fstatus lk-g">In the lobby</span>;
    case 'game': return <span className="lk-fstatus lk-y">In a game{f.detail ? ` · ${f.detail}` : ''}</span>;
    case 'table': return <span className="lk-fstatus lk-g">At this table</span>;
    case 'online': return <span className="lk-fstatus lk-g">Online</span>;
    default: return <span className="lk-fstatus">Last seen {f.detail ?? 'a while ago'}</span>;
  }
}

/** One friend row: avatar, name, status and the right action. Used in Friends and in the waiting room's Invite list. */
export function FriendRow({ f, onInvite, onWatch, invited }: { f: Friend; onInvite?: (id: string) => void; onWatch?: (id: string) => void; invited?: boolean }) {
  const off = f.status === 'offline';
  let action: React.ReactNode = null;
  if (f.joined) action = <span className="lk-green lk-small lk-strong">Joined</span>;
  else if (f.status === 'game' && onWatch) action = <button className="lk-mini" onClick={() => onWatch(f.id)}>Watch</button>;
  else if (!off && f.status !== 'game' && onInvite) action = invited
    ? <span className="lk-sub">Invited</span>
    : <button className="lk-mini lk-mini-gold" onClick={() => onInvite(f.id)}>Invite</button>;
  return (
    <div className={`lk-friend${off ? ' lk-offline' : ''}`}>
      <Avatar seat={f.color ?? colorFor(f.name)} name={f.name} size={28} />
      <span className="lk-grow lk-friend-id"><b>{f.name}</b>{statusLine(f)}</span>
      {action}
    </div>
  );
}

function FriendsPanel({ friends, requests, onAdd, onAccept, onDecline, onInvite, onWatch }: {
  friends: Friend[]; requests: FriendRequest[]; onAdd?: (u: string) => void; onAccept?: (id: string) => void;
  onDecline?: (id: string) => void; onInvite?: (id: string) => void; onWatch?: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const online = friends.filter((f) => f.status !== 'offline');
  const offline = friends.filter((f) => f.status === 'offline');
  const invite = onInvite && ((id: string) => { onInvite(id); setInvited((s) => new Set(s).add(id)); });
  return (
    <aside className="lk-panel lk-friends">
      <div className="lk-row-between"><b className="lk-h16">Friends</b><span className="lk-green lk-small">{online.length} online</span></div>
      <form className="lk-add" onSubmit={(e) => { e.preventDefault(); const u = draft.trim(); if (u) { onAdd?.(u); setDraft(''); } }}>
        <input id="lk-add-friend" className="lk-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add by username" maxLength={24} aria-label="Add by username" />
        <button type="submit" className="lk-add-btn">Add</button>
      </form>
      {requests.length > 0 && (
        <div className="lk-fgroup">
          <p className="lk-eyebrow">REQUESTS · {requests.length}</p>
          {requests.map((r) => (
            <div key={r.id} className="lk-request">
              <div className="lk-inline">
                <Avatar seat={r.color ?? colorFor(r.name)} name={r.name} size={28} />
                <span className="lk-friend-id"><b>{r.name}</b><span className="lk-fstatus">wants to be friends</span></span>
              </div>
              <div className="lk-inline">
                <button className="lk-req-btn lk-req-yes" onClick={() => onAccept?.(r.id)}>Accept</button>
                <button className="lk-req-btn" onClick={() => onDecline?.(r.id)}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="lk-fgroup">
        <p className="lk-eyebrow">ONLINE · {online.length}</p>
        {online.map((f) => <FriendRow key={f.id} f={f} onInvite={invite} onWatch={onWatch} invited={invited.has(f.id)} />)}
        {online.length === 0 && <span className="lk-sub">Nobody online right now.</span>}
      </div>
      {offline.length > 0 && (
        <div className="lk-fgroup">
          <p className="lk-eyebrow">OFFLINE · {offline.length}</p>
          {offline.map((f) => <FriendRow key={f.id} f={f} />)}
        </div>
      )}
    </aside>
  );
}

export interface PlayNowQueueProps {
  mode: LobbyMode;
  /** People found so far, including you (server: queueStatus().found). */
  found: number;
  needed?: number;
  /** When bots take the empty seats (server: queueStatus().botsAt). null = waiting for real players only. */
  botsAt: number | null;
  /** How long you've been waiting (server: queueStatus().waitedMs). */
  waitedMs?: number;
  onCancel: () => void;
  /** "Wait for real players" on/off (server: setBotsOk). */
  onToggleBots?: (botsOk: boolean) => void;
  /** "Start now with bots" (server: startNow). */
  onStartNow?: () => void;
}

const mmss = (ms: number) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

/** "Finding players" overlay while in the Play now queue. */
export function PlayNowQueue({ mode, found, needed = 4, botsAt, waitedMs, onCancel, onToggleBots, onStartNow }: PlayNowQueueProps) {
  const left = useCountdown(botsAt) ?? 0;
  const [openedAt] = useState(() => Date.now() - (waitedMs ?? 0));
  const [, tick] = useState(0);
  React.useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(id); }, []);
  const waited = Date.now() - openedAt;
  const realOnly = botsAt == null;
  const secs = Math.ceil(left / 1000);
  const total = 20000;
  return (
    <div className="lk-scrim">
      <div className="lk-modal lk-queue" role="dialog" aria-label="Finding players">
        <p className="lk-eyebrow lk-gold">PLAY NOW · {mode === 'points' ? 'POINTS' : 'REGULAR'}</p>
        <h2>{realOnly || left > 0 ? 'Finding players…' : 'Starting with bots…'}</h2>
        <div className="lk-queue-seats">
          {Array.from({ length: needed }, (_, i) => (
            <span key={i} className={`lk-queue-seat${i < found ? ' lk-found' : ''}`} style={i < found ? { background: seatColor(i), color: seatInk(i) } : undefined}>
              {i < found ? (i === 0 ? 'You' : '✓') : ''}
            </span>
          ))}
        </div>
        <p className="lk-sub lk-queue-sub">
          {found} of {needed} found  ·  waiting {mmss(waited)}
          {realOnly ? '  ·  real players only' : left > 0 ? `  ·  bots fill the empty seats in ${secs}s` : ''}
        </p>
        {!realOnly && <span className="lk-track" style={{ height: 6 }}><i style={{ width: `${Math.min(100, (left / total) * 100)}%`, background: '#FFB627' }} /></span>}
        {onToggleBots && (
          <label className="lk-toggle lk-queue-toggle">
            <span>Wait for real players only</span>
            <input id="lk-queue-real" type="checkbox" checked={realOnly} onChange={(e) => onToggleBots(!e.target.checked)} />
            <i aria-hidden="true" />
          </label>
        )}
        <div className="lk-buttons lk-queue-btns">
          <button className="lk-btn lk-btn-ghost lk-btn-small" onClick={onCancel}>Cancel</button>
          {onStartNow && <button className="lk-btn lk-btn-gold lk-btn-small" onClick={onStartNow}>Start now with bots</button>}
        </div>
        <p className="lk-sub lk-queue-note">Games with bots are practice: they don’t count for crowns.</p>
      </div>
    </div>
  );
}
