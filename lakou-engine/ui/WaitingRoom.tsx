// Waiting room with invite list, table chat and waitlist (Figma 17-2).
import React, { useState } from 'react';
import { Avatar, ChatBox, type ChatMessage } from './Parts';
import { WaitlistPanel, type WaitlistEntryView } from './Overlays';
import { FriendRow, type Friend, type LobbyMode } from './Lobby';
import { Page, ProfileChip } from './Shell';
import { seatBorder } from './theme';

export interface WaitingSeat { name: string; host?: boolean; bot?: boolean }
export interface TableSettings { mode: LobbyMode; rowBoxes: number; turnSeconds: number; isPrivate: boolean }
const TIMERS = [15, 30, 45, 60];

export interface WaitingRoomProps {
  tableName: string;               // "Venloud's table"
  code: string;                    // "XU62"
  link: string;                    // "lakoudomino.com/t/XU62" (shown) — copied as https://…
  mode: LobbyMode;
  rowBoxes: number;
  turnSeconds: number;
  isPrivate: boolean;
  /** Always 4 entries (2 or 3 for Regular 1v1 / 3-player): a player or null for an open seat. */
  seats: (WaitingSeat | null)[];
  isHost: boolean;
  onStart: () => void;
  onFillBots?: () => void;
  onLeave: () => void;
  /** Called after the copy succeeds (for a toast/analytics). Copying itself is built in. */
  onCopied?: (what: 'link' | 'code') => void;
  /** Tap on an open seat's "Invite" — e.g. open a share sheet. Defaults to copying the link. */
  onInviteSeat?: () => void;
  me?: { name: string; flag?: string; color?: number; onClick?: () => void } | null;
  friends?: Friend[];
  onInviteFriend?: (id: string) => void;
  chat: ChatMessage[];
  onSendChat: (text: string) => void;
  /** Host only: change the table while people join. Seats that no longer exist are handled by the server. */
  onChangeSettings?: (s: TableSettings) => void;
  /** Tap on "Lakou Domino". */
  onHome?: () => void;
  waitlist?: {
    entries: WaitlistEntryView[]; meId?: string | null; notify: boolean; onToggleNotify: (on: boolean) => void;
    onJoin?: () => void; onLeave?: () => void; isSeated?: boolean;
  } | null;
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

export function WaitingRoom(p: WaitingRoomProps) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const filled = p.seats.filter(Boolean).length;
  const total = p.seats.length;
  const full = filled === total;
  const fullLink = /^https?:\/\//.test(p.link) ? p.link : `https://${p.link}`;

  const copy = async (what: 'link' | 'code') => {
    if (await copyText(what === 'link' ? fullLink : p.code)) {
      setCopied(what); p.onCopied?.(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1600);
    }
  };

  return (
    <Page right={p.me && <ProfileChip name={p.me.name} flag={p.me.flag} color={p.me.color} onClick={p.me.onClick} caret={false} />} onHome={p.onHome}>
      <main className="lk-wait">
        <section className="lk-wait-card">
          <header className="lk-wait-head">
            <p className="lk-eyebrow">WAITING ROOM</p>
            <h1 className="lk-wait-title">{p.tableName}</h1>
            <span className="lk-wait-status">
              <i className={`lk-dot ${full ? 'lk-dot-green' : 'lk-dot-gold'}`} />
              {filled} of {total} seats filled  ·  {full ? (p.isHost ? 'ready to start' : 'waiting for the host') : 'waiting for players'}
            </span>
          </header>

          <div className="lk-codebox">
            <div className="lk-codebox-left">
              <p className="lk-eyebrow">TABLE CODE</p>
              <b className="lk-bigcode">{p.code}</b>
              <span className="lk-sub lk-codelink">{p.link}</span>
            </div>
            <div className="lk-codebox-btns">
              <button className="lk-copy lk-copy-gold" onClick={() => copy('link')}>{copied === 'link' ? 'Link copied!' : 'Copy invite link'}</button>
              <button className="lk-copy" onClick={() => copy('code')}>{copied === 'code' ? 'Code copied!' : 'Copy code'}</button>
            </div>
          </div>

          {p.isHost && p.onChangeSettings ? (
            <HostSettings
              value={{ mode: p.mode, rowBoxes: p.rowBoxes, turnSeconds: p.turnSeconds, isPrivate: p.isPrivate }}
              onChange={p.onChangeSettings}
            />
          ) : (
            <div className="lk-setchips">
              <span>{p.mode === 'points' ? 'Points' : 'Regular'}</span>
              {p.mode === 'points' && <span>{p.rowBoxes}-box row</span>}
              <span>{p.turnSeconds}s turns</span>
              <span>{p.isPrivate ? 'Private' : 'Public'}</span>
            </div>
          )}

          <div className="lk-wseats" style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}>
            {p.seats.map((s, i) => s ? (
              <div key={i} className="lk-wseat" style={{ borderColor: seatBorder(i, 0.6) }}>
                <Avatar seat={i} name={s.name} size={48} />
                <b>{s.name}</b>
                <span className={s.host ? 'lk-gold lk-small' : 'lk-green lk-small'}>{s.host ? 'Host' : s.bot ? 'Bot' : 'Joined'}</span>
              </div>
            ) : (
              <button key={i} className="lk-wseat lk-wseat-open" onClick={() => (p.onInviteSeat ? p.onInviteSeat() : copy('link'))}>
                <span className="lk-plus">+</span>
                <b>Open seat</b>
                <span className="lk-gold lk-small">Invite</span>
              </button>
            ))}
          </div>

          <div className="lk-wait-actions">
            <button className="lk-leave-table" onClick={p.onLeave}>Leave table</button>
            {p.isHost && (
              <span className="lk-wait-btns">
                {p.onFillBots && !full && <button className="lk-fill" onClick={p.onFillBots}>Fill empty seats with bots</button>}
                <button className="lk-start" disabled={!full} onClick={p.onStart}>Start game</button>
              </span>
            )}
          </div>
          <p className="lk-wait-hint">
            {p.isHost
              ? full ? 'Everyone’s here. Start when you’re ready.' : `Start unlocks when all ${total} seats are filled.`
              : 'The host starts the game when every seat is filled.'}
          </p>
        </section>

        <aside className="lk-wait-side">
          {p.friends && p.friends.length > 0 && (
            <section className="lk-panel lk-invite">
              <b className="lk-h16">Invite friends</b>
              {p.friends.map((f) => (
                <FriendRow key={f.id} f={f} invited={invited.has(f.id)}
                  onInvite={p.onInviteFriend && ((id) => { p.onInviteFriend!(id); setInvited((s) => new Set(s).add(id)); })} />
              ))}
            </section>
          )}
          <section className="lk-panel lk-wait-chat">
            <p className="lk-eyebrow">TABLE CHAT</p>
            <ChatBox messages={p.chat} onSend={p.onSendChat} quick={false} compact />
          </section>
          {p.waitlist && <WaitlistPanel {...p.waitlist} />}
        </aside>
      </main>
    </Page>
  );
}

/** Host-only table settings in the waiting room: same controls as "Open a table", in one row. */
function HostSettings({ value, onChange }: { value: TableSettings; onChange: (s: TableSettings) => void }) {
  const set = (patch: Partial<TableSettings>) => onChange({ ...value, ...patch });
  return (
    <div className="lk-hostset" aria-label="Table settings">
      <div className="lk-seg lk-seg-sm" role="radiogroup" aria-label="Mode">
        {(['regular', 'points'] as LobbyMode[]).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={value.mode === m} className={value.mode === m ? 'lk-on' : ''} onClick={() => set({ mode: m })}>
            {m === 'points' ? 'Points' : 'Regular'}
          </button>
        ))}
      </div>
      {value.mode === 'points' && (
        <div className="lk-stepper lk-stepper-sm" aria-label="Row length">
          <button type="button" aria-label="Fewer boxes" disabled={value.rowBoxes <= 5} onClick={() => set({ rowBoxes: value.rowBoxes - 1 })}>−</button>
          <b>{value.rowBoxes} boxes</b>
          <button type="button" aria-label="More boxes" disabled={value.rowBoxes >= 20} onClick={() => set({ rowBoxes: value.rowBoxes + 1 })}>+</button>
        </div>
      )}
      <span className="lk-select lk-select-sm">
        <select id="lk-wait-timer" aria-label="Turn timer" value={value.turnSeconds} onChange={(e) => set({ turnSeconds: Number(e.target.value) })}>
          {TIMERS.map((t) => <option key={t} value={t}>{t}s turns</option>)}
        </select>
        <i aria-hidden="true">▾</i>
      </span>
      <label className="lk-toggle lk-toggle-sm">
        <span>Private</span>
        <input id="lk-wait-private" type="checkbox" checked={value.isPrivate} onChange={(e) => set({ isPrivate: e.target.checked })} />
        <i aria-hidden="true" />
      </label>
    </div>
  );
}
