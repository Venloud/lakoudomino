import React, { useEffect, useState } from 'react';
import type { ScoreEntry, Tile } from '../src/index';
import { Domino } from './Domino';
import { TallyRow } from './Tally';
import { initial, seatBorder, seatColor, seatInk } from './theme';

export interface ChatMessage { id: string | number; seat: number | null; name: string; text: string; mine?: boolean }

export function Avatar({ seat, name, size = 22 }: { seat: number; name: string; size?: number }) {
  return (
    <span className="lk-avatar" style={{ width: size, height: size, background: seatColor(seat), color: seatInk(seat), fontSize: size * 0.5 }}>
      {initial(name)}
    </span>
  );
}

/**
 * The color bar under the top bar: the four player colors (blue, red, green, yellow).
 * Pass `active` (a seat) during a game: that player's color stretches across and the others dim.
 */
export function FlagStripe({ height = 5, className = '', active = null }: { height?: number; className?: string; active?: number | null }) {
  return (
    <div className={`lk-stripe ${className}${active != null ? ' lk-has-active' : ''}`} style={{ height }} aria-hidden="true">
      {[0, 1, 2, 3].map((s) => <i key={s} className={active === s ? 'lk-active' : ''} />)}
    </div>
  );
}

/** Seconds left on a deadline, ticking 4×/s. */
export function useCountdown(deadline: number | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, deadline - now);
}

/** Opponent seat card around the table (Figma "Seat — Nadège"). */
export function SeatCard({ seat, name, points, tiles, progress, isTurn, secondsLeft, status, compact, showPoints, turnMs = 30000 }: {
  seat: number; name: string; points: number; tiles: number; progress: number; isTurn: boolean;
  secondsLeft?: number | null; status?: string | null; compact?: boolean; showPoints: boolean; turnMs?: number;
}) {
  const ringing = isTurn && secondsLeft != null;
  const pct = ringing ? Math.max(0, Math.min(100, (secondsLeft! / turnMs) * 100)) : 0;
  const avatar = <Avatar seat={seat} name={name} size={compact ? 18 : 22} />;
  return (
    <div className={`lk-seat${compact ? ' lk-seat-compact' : ''}${isTurn ? ' lk-turn' : ''}`} style={{ borderColor: seatBorder(seat, isTurn ? 1 : 0.55), '--lk-seat': seatColor(seat) } as React.CSSProperties}>
      <div className="lk-seat-top">
        {ringing
          ? <span className={`lk-ring${secondsLeft! <= 10000 ? ' lk-low' : ''}`} style={{ '--p': `${pct}%`, '--c': seatColor(seat) } as React.CSSProperties}>{avatar}</span>
          : avatar}
        <b className="lk-seat-name">{name}</b>
        {!compact && showPoints && <span className="lk-seat-pts" style={{ color: seatColor(seat) }}>{points} pts</span>}
      </div>
      <span className="lk-seat-sub">{compact ? `${showPoints ? `${points} pts · ` : ''}${tiles} tile${tiles === 1 ? '' : 's'}` : `${tiles} tile${tiles === 1 ? '' : 's'}`}</span>
      {showPoints && <span className="lk-track" style={{ height: compact ? 3 : 4 }}><i style={{ width: `${Math.min(100, progress * 100)}%`, background: seatColor(seat) }} /></span>}
      {status ? <span className="lk-seat-flag" style={{ background: seatColor(seat), color: seatInk(seat) }}>{status}</span>
        : isTurn && secondsLeft != null ? <span className={`lk-seat-flag lk-clock${secondsLeft <= 10000 ? ' lk-low' : ''}`}>{Math.ceil(secondsLeft / 1000)}s</span> : null}
    </div>
  );
}

/** My tiles under the table (Figma: 44×88 desktop, 34×68 phone; playable = gold outline; selected lifts up). */
export function Hand({ tiles, playable, selected, onPick, unit }: {
  tiles: Tile[]; playable: (t: Tile) => boolean; selected: Tile | null; onPick: (t: Tile) => void; unit: number;
}) {
  const same = (a: Tile | null, b: Tile) => !!a && ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]));
  return (
    <div className="lk-hand" style={{ gap: unit * 0.32 }}>
      {tiles.map((t, i) => {
        const can = playable(t);
        const sel = same(selected, t);
        return (
          <button key={`${t[0]}-${t[1]}`} className={`lk-mine${can ? ' lk-can' : ''}${sel ? ' lk-sel' : ''}`} disabled={!can} onClick={() => onPick(t)} aria-label={`Tile ${t[0]}-${t[1]}`} style={{ borderRadius: unit / 6 + 1 }}>
            <Domino first={t[0]} second={t[1]} orientation="v" unit={unit} />
          </button>
        );
      })}
    </div>
  );
}

export function TurnTimer({ msLeft, totalMs, width }: { msLeft: number; totalMs: number; width?: number }) {
  const low = msLeft <= 10000;
  return (
    <div className={`lk-timer${low ? ' lk-low' : ''}`}>
      <span className="lk-track lk-timer-track" style={{ width, height: 6 }}><i style={{ width: `${(msLeft / totalMs) * 100}%` }} /></span>
      <b>{Math.ceil(msLeft / 1000)}s</b>
    </div>
  );
}

/** Player card in the side panel (Figma "Player — Venloud (expanded)"). */
export function PlayerCard({ seat, name, points, tiles, progress, isMe, isTurn, secondsLeft, expanded, onToggle, log, rowBoxes, showPoints }: {
  seat: number; name: string; points: number; tiles: number; progress: number; isMe: boolean; isTurn: boolean;
  secondsLeft?: number | null; expanded: boolean; onToggle: () => void; log: ScoreEntry[]; rowBoxes: number; showPoints: boolean;
}) {
  return (
    <div className={`lk-pcard${expanded ? ' lk-open' : ''}`} style={expanded ? { borderColor: seatColor(seat) } : undefined}>
      <button className="lk-pcard-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="lk-pcard-left">
          <Avatar seat={seat} name={name} />
          <b>{name}</b>
          {isTurn && <span className="lk-green">{isMe ? 'your turn' : 'playing'}{secondsLeft != null ? ` · 0:${String(Math.ceil(secondsLeft / 1000)).padStart(2, '0')}` : ''}</span>}
        </span>
        <span className="lk-pcard-right">
          {showPoints && <b>{points}</b>}
          <span className="lk-caret">{expanded ? '▴' : '▾'}</span>
        </span>
      </button>
      <span className="lk-sub">{tiles} tile{tiles === 1 ? '' : 's'}{showPoints ? `  ·  ${Math.round(progress * 100)}% of row` : ''}</span>
      {showPoints && <span className="lk-track" style={{ height: 6 }}><i style={{ width: `${Math.min(100, progress * 100)}%`, background: seatColor(seat) }} /></span>}
      {expanded && showPoints && <TallyRow log={log} rowBoxes={rowBoxes} seat={seat} />}
    </div>
  );
}

export const QUICK_CHAT = ['Pass!', 'Domino!', 'Nice one', 'Hurry up'];

export function ChatBox({ messages, onSend, compact, quick = true }: { messages: ChatMessage[]; onSend: (text: string) => void; compact?: boolean; quick?: boolean }) {
  const [draft, setDraft] = useState('');
  const send = (text: string) => { const t = text.trim(); if (t) { onSend(t); setDraft(''); } };
  return (
    <div className="lk-chat">
      <div className="lk-chat-list">
        {messages.length === 0 && <p className="lk-sub lk-chat-empty">Say hello to the table.</p>}
        {messages.slice(-(compact ? 30 : 60)).map((m) => (
          <div key={m.id} className={`lk-msg${m.mine ? ' lk-mine-msg' : ''}`}>
            <div className="lk-bubble">
              {!m.mine && <b style={{ color: m.seat == null ? '#9A93A6' : seatColor(m.seat) }}>{m.name}</b>}
              <span>{m.text}</span>
            </div>
          </div>
        ))}
      </div>
      {quick && <div className="lk-chips">
        {QUICK_CHAT.map((q) => <button key={q} className="lk-chip" onClick={() => send(q)}>{q}</button>)}
      </div>}
      <form className="lk-chat-input" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <input id="lk-chat-draft" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the table…" maxLength={200} />
        <button type="submit" className="lk-send">Send</button>
      </form>
    </div>
  );
}
