import React from 'react';
import type { Tile } from '../src/index';
import { Avatar, FlagStripe, useCountdown } from './Parts';
import { Domino } from './Domino';
import { ordinal, seatColor } from './theme';

export interface StandingRow {
  seat: number; name: string; place: number; total: number; thisHand: number; pipsLeft: number; tilesLeft: Tile[]; isMe: boolean;
  /** Why they scored this hand, e.g. ["Locked the game +150", "Ends +20"]. */
  reasons?: string[];
}

/** Figma "Hand results" (17:409). */
export function EndOfHand({ handNumber, winnerSeat, winnerName, headline, rows, target, nextStarter, canStartNext, onNext, onLeave, nextHandAt }: {
  handNumber: number; winnerSeat: number; winnerName: string; headline: string; rows: StandingRow[]; target: number;
  nextStarter: string; canStartNext: boolean; onNext?: () => void; onLeave?: () => void; nextHandAt?: number | null;
}) {
  const left = useCountdown(nextHandAt ?? null);
  const secs = left != null ? Math.ceil(left / 1000) : null;
  const nextLabel = canStartNext && onNext
    ? `Next hand${secs != null && secs > 0 ? ` · ${secs}s` : ''}`
    : secs != null ? (secs > 0 ? `Next hand in ${secs}s` : 'Starting…') : 'Waiting for the host…';
  return (
    <div className="lk-scrim">
      <div className="lk-modal lk-results" role="dialog" aria-label={`Hand ${handNumber} results`}>
        <FlagStripe height={4} className="lk-modal-stripe" />
        <p className="lk-eyebrow">HAND {handNumber}  ·  RESULTS</p>
        <div className="lk-winner">
          <Avatar seat={winnerSeat} name={winnerName} size={44} />
          <div>
            <h2>{winnerName} won</h2>
            <p className="lk-gold">{headline}</p>
          </div>
        </div>
        <div className="lk-scores">
          <div className="lk-cols"><span>Place · Player</span><span>Pips left</span><span>This hand</span><span>Total</span></div>
          {rows.map((r) => (
            <div key={r.seat} className={`lk-result${r.isMe ? ' lk-me' : ''}`}>
              <div className="lk-result-row">
                <span className="lk-result-player">
                  <b className="lk-place" style={{ color: r.place === 1 ? '#FFB627' : '#F4EFE6' }}>{ordinal(r.place)}</b>
                  <Avatar seat={r.seat} name={r.name} size={24} />
                  <b>{r.name}{r.isMe ? ' (you)' : ''}</b>
                </span>
                <span className="lk-muted">{r.pipsLeft}</span>
                <b className={r.thisHand ? 'lk-green' : 'lk-muted'}>{r.thisHand ? `+${r.thisHand}` : '—'}</b>
                <b className="lk-total">{r.total}</b>
              </div>
              {r.reasons && r.reasons.length > 0 && <span className="lk-reasons">{r.reasons.join('  ·  ')}</span>}
              {r.tilesLeft.length > 0 && (
                <span className="lk-result-tiles">{r.tilesLeft.map((t, i) => <Domino key={i} first={t[0]} second={t[1]} orientation="h" unit={9} />)}</span>
              )}
              <span className="lk-track" style={{ height: 5 }}><i style={{ width: `${Math.min(100, (r.total / target) * 100)}%`, background: seatColor(r.seat) }} /></span>
            </div>
          ))}
        </div>
        <p className="lk-sub">{nextStarter} starts the next hand  ·  First to fill the row ({target}) wins</p>
        <div className="lk-buttons">
          <button className="lk-btn lk-btn-ghost" onClick={onLeave}>Leave table</button>
          <button className="lk-btn lk-btn-gold" onClick={onNext} disabled={!canStartNext || !onNext}>{nextLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Crown({ medal, fancy }: { medal: 'gold' | 'silver' | 'bronze' | null; fancy: boolean }) {
  if (!medal) return <span className="lk-crown lk-none" />;
  const fill = medal === 'gold' ? '#FFB627' : medal === 'silver' ? '#C9CED8' : '#C9793A';
  return (
    <svg className="lk-crown" viewBox="0 0 24 18" width="24" height="18" aria-label={`${medal} crown`}>
      <path d="M2 16 L3 5 L8 10 L12 2 L16 10 L21 5 L22 16 Z" fill={fill} stroke={fancy ? '#fff' : 'none'} strokeWidth={fancy ? 1.4 : 0} strokeLinejoin="round" />
    </svg>
  );
}

/** Final results with crowns (gold 3 / silver 2 / bronze 1, last place none; Points crowns get the outline). */
export function MatchOver({ rows, points, onAgain, onLeave, meSeat }: {
  rows: { seat: number; name: string; total: number }[]; points: boolean; onAgain?: () => void; onLeave?: () => void; meSeat: number | null;
}) {
  const medals = ['gold', 'silver', 'bronze'] as const;
  const winner = rows[0];
  return (
    <div className="lk-scrim">
      <div className="lk-modal lk-results" role="dialog" aria-label="Game over">
        <FlagStripe height={4} className="lk-modal-stripe" />
        <p className="lk-eyebrow">GAME OVER</p>
        <div className="lk-winner">
          <Avatar seat={winner.seat} name={winner.name} size={44} />
          <div>
            <h2>{winner.seat === meSeat ? 'You won!' : `${winner.name} won`}</h2>
            <p className="lk-gold">{points ? 'Filled the row first' : 'First to play every tile'}</p>
          </div>
        </div>
        <div className="lk-scores">
          {rows.map((r, i) => {
            const medal = i < rows.length - 1 ? medals[i] ?? null : null;
            return (
              <div key={r.seat} className={`lk-result${r.seat === meSeat ? ' lk-me' : ''}`}>
                <div className="lk-result-row lk-final-row">
                  <span className="lk-result-player">
                    <b className="lk-place" style={{ color: i === 0 ? '#FFB627' : '#F4EFE6' }}>{ordinal(i + 1)}</b>
                    <Crown medal={medal} fancy={points} />
                    <Avatar seat={r.seat} name={r.name} size={24} />
                    <b>{r.name}</b>
                  </span>
                  <span className="lk-muted">{medal ? `+${3 - i} crown pts` : 'gets up'}</span>
                  {points && <b className="lk-total">{r.total}</b>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="lk-buttons">
          <button className="lk-btn lk-btn-ghost" onClick={onLeave}>Leave table</button>
          <button className="lk-btn lk-btn-gold" onClick={onAgain}>Play again</button>
        </div>
      </div>
    </div>
  );
}

/** Figma "Seat offer" (33:475): 60-second countdown to take a free seat. */
export function SeatOffer({ tableName, seatNumber, reason, expiresAt, totalMs = 60000, onTake, onStay }: {
  tableName: string; seatNumber: number; reason: string; expiresAt: number; totalMs?: number; onTake: () => void; onStay: () => void;
}) {
  const left = useCountdown(expiresAt) ?? 0;
  const secs = Math.ceil(left / 1000);
  return (
    <div className="lk-scrim">
      <div className="lk-modal lk-offer" role="dialog" aria-label="Your seat is ready">
        <p className="lk-eyebrow lk-gold">YOUR SEAT IS READY</p>
        <h2>Take seat {seatNumber} at {tableName}</h2>
        <p className="lk-sub lk-offer-sub">{reason}</p>
        <div className="lk-offer-clock">
          <span className="lk-track" style={{ height: 8 }}><i style={{ width: `${(left / totalMs) * 100}%`, background: '#FFB627' }} /></span>
          <b>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</b>
        </div>
        <div className="lk-buttons">
          <button className="lk-btn lk-btn-ghost lk-btn-small" onClick={onStay}>Stay in line</button>
          <button className="lk-btn lk-btn-gold lk-grow" onClick={onTake}>Take my seat</button>
        </div>
        <p className="lk-sub">No answer in 1 minute and the seat goes to the next person. You move to the back of the line.</p>
      </div>
    </div>
  );
}

/** Big centre banner: "DOMINO!", "ALL FOUR +120", "Game locked". */
/** Big moments ("DOMINO!", "ALL FOUR", "GAME LOCKED"): the words slam in, the player's name + points under it,
 *  and a burst of pieces in their color. `big` adds the burst (domino, lock, all four). */
export function Banner({ text, seat, bannerKey, sub, big }: { text: string; seat: number | null; bannerKey: number; sub?: string; big?: boolean }) {
  const color = seat == null ? '#F4EFE6' : seatColor(seat);
  return (
    <div key={bannerKey} className={`lk-banner${big ? ' lk-banner-big' : ''}`} style={{ color, '--lk-bc': color } as React.CSSProperties} aria-live="polite">
      {big && (
        <span className="lk-burst" aria-hidden="true">
          {Array.from({ length: 22 }, (_, i) => {
            const a = (i / 22) * Math.PI * 2 + (i % 2) * 0.2;
            const d = 150 + (i % 5) * 38;
            return <i key={i} style={{ '--x': `${Math.cos(a) * d}px`, '--y': `${Math.sin(a) * d * 0.7}px`, background: i % 3 === 0 ? '#FFB627' : color, animationDelay: `${(i % 4) * 30}ms` } as React.CSSProperties} />;
          })}
        </span>
      )}
      <span className="lk-banner-text">{text}</span>
      {sub && <span className="lk-banner-sub">{sub}</span>}
    </div>
  );
}

export interface WaitlistEntryView { id: string; name: string; seatColorIndex?: number }

/** Figma waiting-room "Waitlist" panel (17:2). */
export function WaitlistPanel({ entries, meId, notify, onToggleNotify, onJoin, onLeave, isSeated }: {
  entries: WaitlistEntryView[]; meId?: string | null; notify: boolean; onToggleNotify: (on: boolean) => void;
  onJoin?: () => void; onLeave?: () => void; isSeated?: boolean;
}) {
  const myPos = meId ? entries.findIndex((e) => e.id === meId) : -1;
  return (
    <div className="lk-panel lk-waitlist">
      <div className="lk-row-between"><b className="lk-h16">Waitlist</b><span className="lk-sub">{entries.length} waiting</span></div>
      {entries.length === 0 && <p className="lk-sub">Nobody in line. Join to play after this game.</p>}
      {entries.map((e, i) => (
        <div key={e.id} className={`lk-inline${e.id === meId ? ' lk-me' : ''}`}>
          <b className="lk-muted lk-num">{i + 1}</b>
          <Avatar seat={e.seatColorIndex ?? (i + 1) % 4} name={e.name} size={26} />
          <b className="lk-grow">{e.name}</b>
          {i === 0 && e.id !== meId && <span className="lk-green lk-small">Next up</span>}
          {e.id === meId && <span className="lk-gold lk-small">You’re #{i + 1} in line</span>}
        </div>
      ))}
      {!isSeated && (
        <>
          <hr className="lk-hr" />
          <label className="lk-toggle">
            <span>Notify me when the game ends</span>
            <input id="lk-notify" type="checkbox" checked={notify} onChange={(e) => onToggleNotify(e.target.checked)} />
            <i aria-hidden="true" />
          </label>
          <p className="lk-sub lk-small">After each game the losers get up. The next person in line gets 1 minute to take the seat, or it goes to the next one.</p>
          <div className="lk-buttons">
            {myPos >= 0
              ? <button className="lk-btn lk-btn-ghost lk-grow lk-btn-small" onClick={onLeave}>Leave line</button>
              : <button className="lk-btn lk-btn-gold lk-grow lk-btn-small" onClick={onJoin}>Join waitlist</button>}
          </div>
        </>
      )}
    </div>
  );
}

