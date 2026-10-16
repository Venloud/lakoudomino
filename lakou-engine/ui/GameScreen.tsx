import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  countedHalves, layoutBoard, placeTile, placementsEquivalent,
  type Action, type GameEvent, type PlayerView, type Tile,
} from '../src/index';
import { Table, type Ghost, type RevealRow } from './Table';
import { Avatar, ChatBox, FlagStripe, Hand, PlayerCard, SeatCard, TurnTimer, useCountdown, type ChatMessage } from './Parts';
import { Banner, EndOfHand, MatchOver, SeatOffer, WaitlistPanel, type StandingRow, type WaitlistEntryView } from './Overlays';

/**
 * The whole Lakou Domino game screen, built from the Figma frames
 * "Game — Points (desktop)" 1-2, "Game — Points (phone)" 19-2, "Hands revealed" 33-42,
 * "End of hand" 17-122 and "Seat offer" 33-475.
 *
 * It is display-only: give it the server's `viewFor(match, mySeat)` and callbacks.
 * All rules live in the engine on the server.
 */
export interface LakouGameProps {
  view: PlayerView;
  /** Player names by seat. */
  names: string[];
  tableCode?: string;
  /** The latest batch of engine events (from applyAction / autoStep). Change `eventsKey` each time a new batch arrives. */
  events?: GameEvent[];
  eventsKey?: number;
  /** When the current player's 30 seconds run out (epoch ms). null while the 5-second pause runs or for bots. */
  turnDeadline?: number | null;
  turnMs?: number;
  chat: ChatMessage[];
  onAction: (action: Action) => void;
  onSendChat: (text: string) => void;
  onNextHand?: () => void;
  canStartNextHand?: boolean;
  onLeave?: () => void;
  onPlayAgain?: () => void;
  /** Waitlist panel (optional). */
  waitlist?: {
    entries: WaitlistEntryView[]; meId?: string | null; notify: boolean;
    onToggleNotify: (on: boolean) => void; onJoin?: () => void; onLeave?: () => void;
  };
  /** Seat offer popup for the person at the front of the line (optional). */
  seatOffer?: { tableName: string; seatNumber: number; reason: string; expiresAt: number; onTake: () => void; onStay: () => void } | null;
  /** How long leftover tiles stay face up before the standings open. */
  revealMs?: number;
  /** Tap on "Lakou Domino" in the top bar (e.g. back to the lobby). */
  onHome?: () => void;
  /** When the server starts the next hand by itself (epoch ms). Shows "Next hand in 8s" on the standings. */
  nextHandAt?: number | null;
}

function useWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

const sameTile = (a: Tile, b: Tile) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
const pipsOf = (tiles: Tile[]) => tiles.reduce((s, t) => s + t[0] + t[1], 0);

/** "Domino! 118 pips left +120 · Ends +25 · Pass bonus +50 ×2" — why a player got their points this hand. */
function reasonsFor(entries: { amount: number; reason?: string; pipsLeft?: number; doubled?: boolean }[]): string[] {
  const out: string[] = [];
  const ends = entries.filter((e) => !e.reason).reduce((a, e) => a + e.amount, 0);
  const passes = entries.filter((e) => e.reason === 'pass');
  for (const e of entries) {
    if (e.reason === 'domino') out.push(`Domino! ${e.pipsLeft} pips left over +${e.amount}`);
    if (e.reason === 'lockedGame') out.push(`Locked the game +${e.amount}`);
    if (e.reason === 'lowestLock') out.push(`Lowest hand +${e.amount}`);
    if (e.reason === 'allFour') out.push(`${e.doubled ? 'Double all four' : 'All four'} +${e.amount}`);
    if (e.reason === 'blockedDouble') out.push(`Blocked a double +${e.amount}`);
  }
  if (ends) out.push(`Ends +${ends}`);
  if (passes.length) out.push(`Pass bonus +${passes.reduce((a, e) => a + e.amount, 0)}${passes.length > 1 ? ` (${passes.length} passes)` : ''}`);
  return out;
}

export function LakouGame(props: LakouGameProps) {
  const { view, names, events, eventsKey, turnDeadline, turnMs = 30000, chat, onAction, onSendChat } = props;
  const width = useWidth();
  const desktop = width >= 1100;
  const phone = width < 560;
  const n = view.playerCount;
  const me = view.seat;
  const base = me ?? 0;
  const points = view.mode === 'points';
  const [selected, setSelected] = useState<Tile | null>(null);
  const [expanded, setExpanded] = useState<number | null>(base);
  const [tab, setTab] = useState<'players' | 'chat' | 'line'>('players');
  const [status, setStatus] = useState<Record<number, string>>({});
  const [glow, setGlow] = useState<{ halves: ReturnType<typeof countedHalves>; at: number } | null>(null);
  const [pop, setPop] = useState<{ text: string; key: number; big?: boolean } | null>(null);
  const [banner, setBanner] = useState<{ text: string; seat: number | null; key: number; sub?: string; big?: boolean } | null>(null);
  const [handOverAt, setHandOverAt] = useState<number | null>(null);
  const [, force] = useState(0);
  const counter = useRef(0);

  // Engine events → "Pass!" flags, score pops, glowing pips, banners.
  useEffect(() => {
    if (!events?.length) return;
    const nextStatus: Record<number, string> = {};
    let gained = 0;
    for (const e of events) {
      if (e.type === 'pass') nextStatus[e.seat] = 'Pass!';
      if (e.type === 'play') nextStatus[e.seat] = '';
      if (e.type === 'score') { gained += e.points; setGlow({ halves: countedHalves(view.board), at: performance.now() }); }
      if (e.type === 'bonus') {
        gained += e.points;
        if (e.reason === 'allFour') {
          const counted = events.find((x) => x.type === 'score' && x.seat === e.seat) as Extract<GameEvent, { type: 'score' }> | undefined;
          setBanner({ text: e.doubled ? 'DOUBLE ALL FOUR' : 'ALL FOUR', sub: `${names[e.seat]}  +${e.points + (counted?.points ?? 0)}`, seat: e.seat, key: ++counter.current, big: true });
        }
        if (e.reason === 'lockedGame') setBanner({ text: 'GAME LOCKED', sub: `${names[e.seat]}  +${e.points}`, seat: e.seat, key: ++counter.current, big: true });
      }
      if (e.type === 'domino') {
        const pay = events.find((x) => x.type === 'bonus' && x.reason === 'domino') as Extract<GameEvent, { type: 'bonus' }> | undefined;
        setBanner({ text: 'DOMINO!', sub: `${names[e.seat]}${pay ? `  +${pay.points}` : ''}`, seat: e.seat, key: ++counter.current, big: true });
      }
      if (e.type === 'locked' && !events.some((x) => x.type === 'bonus' && x.reason === 'lockedGame')) setBanner({ text: 'Game locked', seat: null, key: ++counter.current });
    }
    if (gained) setPop({ text: `+${gained}`, key: ++counter.current, big: gained >= 50 });
    setStatus((s) => ({ ...s, ...nextStatus }));
    const clear = setTimeout(() => setStatus((s) => { const c = { ...s }; for (const k of Object.keys(nextStatus)) if (c[+k] === 'Pass!') delete c[+k]; return c; }), 2500);
    const popClear = setTimeout(() => setPop(null), 2200);
    const glowTick = setTimeout(() => force((x) => x + 1), 2100);
    return () => { clearTimeout(clear); clearTimeout(popClear); clearTimeout(glowTick); };
  }, [eventsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hand over → keep tiles face up for revealMs, then open the standings.
  useEffect(() => {
    if (view.handOver) {
      if (handOverAt == null) setHandOverAt(Date.now());
    } else if (handOverAt != null) setHandOverAt(null);
  }, [view.handOver]); // eslint-disable-line react-hooks/exhaustive-deps
  const revealMs = props.revealMs ?? 3000;
  const [revealDone, setRevealDone] = useState(false);
  useEffect(() => {
    setRevealDone(false);
    if (handOverAt == null) return;
    const t = setTimeout(() => setRevealDone(true), revealMs);
    return () => clearTimeout(t);
  }, [handOverAt, revealMs]);

  useEffect(() => { setSelected(null); }, [view.turn, view.handNumber, view.board.history.length]);

  const msLeft = useCountdown(turnDeadline ?? null);
  const myTurn = me !== null && view.turn === me && !view.handOver && !view.matchOver && view.legal.length > 0;
  const legalPlays = view.legal.filter((a) => a.type === 'play') as Extract<Action, { type: 'play' }>[];
  const playable = (t: Tile) => myTurn && legalPlays.some((a) => sameTile(a.tile, t));

  const pick = (t: Tile) => {
    const opts = legalPlays.filter((a) => sameTile(a.tile, t));
    if (!opts.length) return;
    if (opts.length === 1) { onAction(opts[0]); setSelected(null); return; }
    // Second tap on the same tile (double-tap): if every spot gives the same result, just play it.
    if (selected && sameTile(selected, t)) {
      if (placementsEquivalent(view.board, view.mode, me!, t, opts.map((a) => a.arm))) onAction(opts[0]);
      setSelected(null);
      return;
    }
    setSelected(t);
  };

  const selectedSame = !!selected && myTurn && placementsEquivalent(
    view.board, view.mode, me!, selected, legalPlays.filter((a) => sameTile(a.tile, selected)).map((a) => a.arm));

  const ghosts: Ghost[] = useMemo(() => {
    if (!selected || !myTurn) return [];
    return legalPlays.filter((a) => sameTile(a.tile, selected)).map((a) => {
      const b2 = placeTile(view.board, view.mode, me!, a.tile, a.arm);
      const l2 = layoutBoard(b2, { halfWidth: 8, halfHeight: 8 });
      return { key: String(a.arm), tile: l2.tiles[l2.tiles.length - 1] };
    });
  }, [selected, myTurn, view.board]); // eslint-disable-line react-hooks/exhaustive-deps

  const onGhost = (arm: string) => {
    if (!selected) return;
    onAction({ type: 'play', tile: selected, arm: arm as never });
    setSelected(null);
  };

  // Seats around the table, relative to me.
  const rel = (k: number) => (base + k) % n;
  const around = n === 4 ? { left: rel(1), top: rel(2), right: rel(3) } : n === 3 ? { left: rel(1), right: rel(2) } : { top: rel(1) };
  const sideOf = (s: number): 'left' | 'right' | 'top' | 'bottom' =>
    s === around.left ? 'left' : s === around.right ? 'right' : s === around.top ? 'top' : 'bottom';
  const progress = (s: number) => (points ? view.scores[s] / view.target : 0);
  const secsFor = (s: number) => (view.turn === s && !view.handOver ? msLeft : null);

  const seatCard = (s: number | undefined, compact = false) => s === undefined ? null : (
    <SeatCard
      key={s} seat={s} name={names[s]} points={view.scores[s]} tiles={view.handCounts[s]} progress={progress(s)}
      isTurn={view.turn === s && !view.handOver && !view.matchOver} secondsLeft={secsFor(s)} status={status[s] || null}
      compact={compact} showPoints={points} turnMs={turnMs}
    />
  );

  // Reveal rows + standings.
  const handOrder = view.ranking ?? [...Array(n).keys()];
  const revealed = view.revealedHands;
  const revealRows: RevealRow[] = revealed ? handOrder.map((s) => ({ seat: s, name: names[s], tiles: revealed[s], pips: pipsOf(revealed[s]) })) : [];
  const standingRows: StandingRow[] = useMemo(() => {
    const thisHand = (s: number) => view.scoreLog[s].filter((e) => e.hand === view.handNumber).reduce((a, e) => a + e.amount, 0);
    return [...Array(n).keys()]
      .sort((a, b) => view.scores[b] - view.scores[a] || handOrder.indexOf(a) - handOrder.indexOf(b))
      .map((s, i) => ({
        seat: s, name: names[s], place: i + 1, total: view.scores[s], thisHand: thisHand(s),
        pipsLeft: revealed ? pipsOf(revealed[s]) : 0, tilesLeft: revealed ? revealed[s] : [], isMe: s === me,
        reasons: reasonsFor(view.scoreLog[s].filter((e) => e.hand === view.handNumber)),
      }));
  }, [view, names]); // eslint-disable-line react-hooks/exhaustive-deps

  const winner = view.ranking ? view.ranking[0] : 0;
  const wentOut = revealed ? revealed[winner].length === 0 : false;
  const winnerGain = standingRows.find((r) => r.seat === winner)?.thisHand ?? 0;
  const dominoPips = view.scoreLog[winner]?.find((e) => e.hand === view.handNumber && e.reason === 'domino')?.pipsLeft ?? null;
  const showReveal = view.handOver && !revealDone && !!revealed;
  const showStandings = points && view.handOver && !view.matchOver && revealDone;
  const showFinal = view.matchOver && (revealDone || !revealed);
  const finalRows = (view.placings ?? []).map((s) => ({ seat: s, name: names[s], total: view.scores[s] }));

  const hint = !myTurn
    ? me === null ? 'Watching the table' : view.handOver ? '' : `Waiting for ${names[view.turn]}…`
    : selected
      ? (selectedSame ? 'Tap a glowing spot, or double-tap the tile' : 'Tap a glowing spot')
      : 'Tap a tile to play';
  const turnLine = myTurn ? `Your turn${msLeft != null ? ` · ${Math.ceil(msLeft / 1000)}s` : ''}` : me === null ? '' : view.handOver ? 'Hand over' : 'Waiting';

  const turnSeat = !view.handOver && !view.matchOver ? view.turn : null;
  const handUnit = phone ? 38 : 52;
  const tableEl = (
    <Table
      board={view.board} maxUnit={phone ? 21.5 : 36} names={names} ghosts={ghosts} onGhost={onGhost}
      onBackground={() => setSelected(null)} glow={glow} pop={pop} compact={phone}
      turnSeat={turnSeat} sideOf={sideOf}
      reveal={showReveal ? { title: `HAND ${view.handNumber} · EVERYONE’S TILES`, rows: revealRows } : null}
    />
  );
  const handEl = me !== null && (
    <Hand tiles={view.myHand} playable={playable} selected={selected} onPick={pick} unit={handUnit} />
  );
  const playersList = (
    <div className="lk-players">
      {[...Array(n).keys()].map((k) => rel(k)).map((s) => (
        <PlayerCard
          key={s} seat={s} name={names[s]} points={view.scores[s]} tiles={view.handCounts[s]} progress={progress(s)}
          isMe={s === me} isTurn={view.turn === s && !view.handOver && !view.matchOver} secondsLeft={secsFor(s)}
          expanded={expanded === s} onToggle={() => setExpanded((e) => (e === s ? null : s))}
          log={view.scoreLog[s]} rowBoxes={view.rowBoxes} showPoints={points}
        />
      ))}
    </div>
  );
  const waitlistEl = props.waitlist && (
    <WaitlistPanel {...props.waitlist} isSeated={me !== null} />
  );

  return (
    <div className={`lk-game ${desktop ? 'lk-desktop' : 'lk-compact-layout'}${phone ? ' lk-phone' : ''}`}>
      <div className="lk-glows" aria-hidden="true"><i /><i /><i /></div>
      <header className="lk-topbar">
        {props.onHome ? <button className="lk-brand lk-brand-btn" onClick={props.onHome}>Lakou Domino</button> : <b className="lk-brand">Lakou Domino</b>}
        {desktop ? (
          <span className="lk-topbar-right">
            <span className="lk-meta">{points ? `Points  ·  ${view.rowBoxes}-box row` : `Regular`}{props.tableCode ? `  ·  Table ${props.tableCode}` : ''}</span>
            <button className="lk-leave" onClick={props.onLeave}>Leave table</button>
          </span>
        ) : (
          <span className="lk-topbar-right">
            {props.tableCode && <span className="lk-code-pill">{props.tableCode}</span>}
            <button className="lk-more" onClick={props.onLeave} aria-label="Leave table">⋯</button>
          </span>
        )}
      </header>
      <FlagStripe height={5} active={turnSeat} />

      {desktop ? (
        <div className="lk-desk">
          <main className="lk-board-area">
            <div className="lk-slot lk-slot-top">{seatCard(around.top)}</div>
            <div className="lk-slot lk-slot-left">{seatCard(around.left)}</div>
            <div className="lk-slot lk-slot-table">{tableEl}</div>
            <div className="lk-slot lk-slot-right">{seatCard(around.right)}</div>
            <div className="lk-slot lk-slot-me">
              {me !== null ? (
                <>
                  <div className="lk-me-info">
                    <b className="lk-me-name">{names[me]}</b>
                    <span className={myTurn ? 'lk-green' : 'lk-muted'}>{turnLine}</span>
                    <span className="lk-sub">{hint}</span>
                  </div>
                  <div className="lk-me-hand">
                    {handEl}
                    {myTurn && msLeft != null && <TurnTimer msLeft={msLeft} totalMs={turnMs} width={276} />}
                  </div>
                </>
              ) : (
                <div className="lk-me-spectator">{seatCard(0)}<span className="lk-sub">Watching the table</span></div>
              )}
            </div>
          </main>
          <aside className="lk-side">
            <div className="lk-panel lk-side-panel">
              <FlagStripe height={4} className="lk-panel-stripe" active={turnSeat} />
              <div className="lk-section">
                <p className="lk-eyebrow">PLAYERS</p>
                {playersList}
              </div>
              <div className="lk-section">
                <p className="lk-eyebrow">TABLE CHAT</p>
                <ChatBox messages={chat} onSend={onSendChat} />
              </div>
            </div>
            {waitlistEl}
          </aside>
        </div>
      ) : (
        <div className="lk-stack">
          <div className="lk-opponents">
            {[...Array(n - 1).keys()].map((k) => seatCard(rel(k + 1), true))}
          </div>
          <div className="lk-stack-table">{tableEl}</div>
          {me !== null ? (
            <>
              <div className="lk-turnline">
                <span className={myTurn ? 'lk-green lk-strong' : 'lk-muted'}>{turnLine}</span>
                <span className="lk-sub">{hint}</span>
              </div>
              {myTurn && msLeft != null && <TurnTimer msLeft={msLeft} totalMs={turnMs} />}
              <div className="lk-stack-hand">{handEl}</div>
            </>
          ) : (
            <div className="lk-turnline"><span className="lk-sub">Watching the table</span></div>
          )}
          <div className="lk-sheet">
            <span className="lk-grabber" />
            <div className="lk-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'players'} className={tab === 'players' ? 'lk-on' : ''} onClick={() => setTab('players')}>Players</button>
              <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'lk-on' : ''} onClick={() => setTab('chat')}>Chat{chat.length ? ` · ${chat.length}` : ''}</button>
              {props.waitlist && <button role="tab" aria-selected={tab === 'line'} className={tab === 'line' ? 'lk-on' : ''} onClick={() => setTab('line')}>Line · {props.waitlist.entries.length}</button>}
            </div>
            {tab === 'players' && (
              <div className="lk-sheet-players">
                {[...Array(n).keys()].map((k) => rel(k)).map((s) => (
                  <div key={s} className={`lk-sheet-row${s === me ? ' lk-me' : ''}`}>
                    <Avatar seat={s} name={names[s]} size={20} />
                    <b className="lk-sheet-name">{names[s]}</b>
                    {points ? <span className="lk-track" style={{ height: 5 }}><i style={{ width: `${Math.min(100, progress(s) * 100)}%`, background: `var(--lk-c${s})` }} /></span> : <span className="lk-sub lk-grow">{view.handCounts[s]} tiles</span>}
                    {points && <b className="lk-sheet-pts">{view.scores[s]}</b>}
                  </div>
                ))}
              </div>
            )}
            {tab === 'chat' && <ChatBox messages={chat} onSend={onSendChat} compact />}
            {tab === 'line' && waitlistEl}
          </div>
        </div>
      )}

      {banner && <Banner text={banner.text} sub={banner.sub} big={banner.big} seat={banner.seat} bannerKey={banner.key} />}
      {showStandings && (
        <EndOfHand
          handNumber={view.handNumber} winnerSeat={winner} winnerName={names[winner]}
          headline={wentOut
            ? `Domino!${dominoPips != null ? `  ${dominoPips} pips left over` : ''}${winnerGain ? `  ·  +${winnerGain}` : ''}`
            : `Game locked${winnerGain ? `  ·  +${winnerGain}` : ''}`}
          rows={standingRows} target={view.target} nextStarter={winner === me ? 'You' : names[winner]}
          canStartNext={props.canStartNextHand ?? true} onNext={props.onNextHand} onLeave={props.onLeave}
          nextHandAt={props.nextHandAt ?? null}
        />
      )}
      {showFinal && <MatchOver rows={finalRows} points={points} onAgain={props.onPlayAgain} onLeave={props.onLeave} meSeat={me} />}
      {props.seatOffer && <SeatOffer {...props.seatOffer} onTake={props.seatOffer.onTake} onStay={props.seatOffer.onStay} />}
    </div>
  );
}
