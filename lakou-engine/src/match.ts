import type {
  Action, ArmId, CrownAward, GameEvent, HandState, MatchConfig, MatchState, Medal, Tile,
} from './types';
import { canPlay, emptyBoard, endsTotal, fits, isScoringTotal, allFourValue, openArms, placeTile } from './board';
import { fullSet, handPips, isDouble, pips, sameTile, shuffle } from './tiles';

// ────────────────────────────────────────────────────────────────────────────
// Creating a match
// ────────────────────────────────────────────────────────────────────────────

export interface CreateOptions {
  /** Seat that opens the first hand with ANY tile (e.g. last game's winner in a "loser gets up" room).
   *  Leave empty for the normal rule: whoever holds the 6-6 must play it. */
  starter?: number;
}

export function createMatch(config: MatchConfig, opts: CreateOptions = {}): { match: MatchState; events: GameEvent[] } {
  const playerCount = config.playerCount;
  if (![2, 3, 4].includes(playerCount)) throw new Error('playerCount must be 2, 3 or 4');
  if (config.mode === 'points' && playerCount !== 4) throw new Error('Points mode needs exactly 4 players');
  const rowBoxes = Math.max(5, Math.floor(config.rowBoxes ?? 10));
  const seed = (config.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;

  const match: MatchState = {
    config: {
      mode: config.mode,
      playerCount,
      rowBoxes,
      seed,
      twoPlayerVariant: config.twoPlayerVariant ?? 'draw',
    },
    rngState: seed,
    scores: Array(playerCount).fill(0),
    scoreLog: Array.from({ length: playerCount }, () => []),
    hand: null as unknown as HandState,
    handsPlayed: 0,
    over: false,
    placings: null,
  };
  const events: GameEvent[] = [];
  dealHand(match, opts.starter ?? null, events);
  return { match, events };
}

/** Points needed to fill a whole row (Points mode). */
export const targetScore = (m: MatchState) => m.config.rowBoxes * 50;

function dealHand(m: MatchState, starter: number | null, events: GameEvent[]) {
  const n = m.config.playerCount;
  let set = fullSet();
  if (n === 3) set = set.filter((t) => !(t[0] === 0 && t[1] === 0)); // 27 tiles, 9 each
  const [deck, next] = shuffle(set, m.rngState);
  m.rngState = next;

  const perHand = n === 4 ? 7 : n === 3 ? 9 : m.config.twoPlayerVariant === 'split' ? 14 : 7;
  const hands: Tile[][] = [];
  for (let s = 0; s < n; s++) hands.push(deck.slice(s * perHand, (s + 1) * perHand));
  const boneyard = deck.slice(n * perHand);

  let forcedOpener: Tile | null = null;
  let first = starter;
  if (first === null) {
    // Highest double dealt opens (6-6 whenever it was dealt). If nobody holds a double (only
    // possible in 2-player "draw"), the heaviest tile opens.
    let best: { seat: number; tile: Tile; score: number } | null = null;
    hands.forEach((h, seat) =>
      h.forEach((t) => {
        const score = isDouble(t) ? 100 + t[0] : pips(t);
        if (!best || score > best.score) best = { seat, tile: t, score };
      }),
    );
    first = best!.seat;
    forcedOpener = best!.tile;
  }

  m.hand = {
    number: m.handsPlayed + 1,
    hands,
    boneyard,
    board: emptyBoard(),
    turn: first,
    starter: first,
    forcedOpener,
    lastPlayer: null,
    passesInRow: 0,
    over: false,
    winner: null,
    ranking: null,
  };
  events.push({ type: 'handStart', hand: m.hand.number, starter: first });
}

/** Points mode: after a hand ends (and the match isn't over), deal the next one. The previous winner starts with any tile. */
export function startNextHand(match: MatchState): { match: MatchState; events: GameEvent[] } {
  if (match.over) throw new Error('Match is over');
  if (!match.hand.over) throw new Error('Current hand is not finished');
  const m = structuredClone(match);
  const events: GameEvent[] = [];
  dealHand(m, m.hand.winner ?? m.hand.ranking![0], events);
  return { match: m, events };
}

// ────────────────────────────────────────────────────────────────────────────
// What can the current player do?
// ────────────────────────────────────────────────────────────────────────────

export function legalActions(match: MatchState): Action[] {
  const h = match.hand;
  if (match.over || h.over) return [];
  const hand = h.hands[h.turn];

  if (!h.board.center) {
    if (h.forcedOpener) return [{ type: 'play', tile: h.forcedOpener, arm: 'center' }];
    return hand.map((tile) => ({ type: 'play', tile, arm: 'center' as const }));
  }

  const out: Action[] = [];
  const arms = openArms(h.board);
  for (const tile of hand) for (const arm of arms) if (fits(h.board, tile, arm)) out.push({ type: 'play', tile, arm });
  if (out.length) return out;
  return h.boneyard.length ? [{ type: 'draw' }] : [{ type: 'pass' }];
}

/** True when the current player has no real choice (must pass or draw). The server can run these automatically. */
export function isForced(match: MatchState): boolean {
  const acts = legalActions(match);
  return acts.length === 1 && acts[0].type !== 'play';
}

// ────────────────────────────────────────────────────────────────────────────
// Applying an action
// ────────────────────────────────────────────────────────────────────────────

export class IllegalMove extends Error {}

/**
 * Apply one action for the player whose turn it is. Returns a NEW match state plus the events
 * that happened (for animations, pop-ups, the chat log and the tally board).
 * Throws IllegalMove if the action is not allowed — the server should reject it.
 */
export function applyAction(match: MatchState, action: Action): { match: MatchState; events: GameEvent[] } {
  if (match.over) throw new IllegalMove('Match is over');
  if (match.hand.over) throw new IllegalMove('Hand is over — call startNextHand');
  const legal = legalActions(match);
  const ok = legal.some(
    (a) =>
      a.type === action.type &&
      (a.type !== 'play' || (action.type === 'play' && a.arm === action.arm && sameTile(a.tile, action.tile))),
  );
  if (!ok) throw new IllegalMove(`Illegal action ${JSON.stringify(action)}`);

  const m: MatchState = structuredClone(match);
  const events: GameEvent[] = [];
  const h = m.hand;
  const seat = h.turn;
  const n = m.config.playerCount;
  const points = m.config.mode === 'points';

  if (action.type === 'draw') {
    h.hands[seat].push(h.boneyard.shift()!);
    events.push({ type: 'draw', seat });
    return { match: m, events };
  }

  if (action.type === 'pass') {
    events.push({ type: 'pass', seat });
    h.passesInRow++;
    // Points mode: every pass pays 50 to whoever made the last play.
    if (points && h.lastPlayer !== null && h.lastPlayer !== seat) {
      award(m, h.lastPlayer, 'bonus', 50, events, { reason: 'pass', passer: seat });
      if (m.over) return { match: m, events };
    }
    // 2-player draw game: the boneyard can run dry after the last play, so check for a lock here too.
    if (checkLock(m, events)) return { match: m, events };
    h.turn = (seat + 1) % n;
    return { match: m, events };
  }

  // ── play ──
  const idx = h.hands[seat].findIndex((t) => sameTile(t, action.tile));
  const [tile] = h.hands[seat].splice(idx, 1);
  const deadBefore = deadDoubles(h.board);
  h.board = placeTile(h.board, m.config.mode, seat, tile, action.arm as ArmId | 'center');
  h.lastPlayer = seat;
  h.passesInRow = 0;
  events.push({ type: 'play', seat, tile, arm: action.arm });

  if (points) {
    const total = endsTotal(h.board);
    if (isScoringTotal(total)) {
      award(m, seat, 'points', total, events, { endsTotal: total });
      if (m.over) return { match: m, events };
    }
    // All four: all four ends show the same number — 100 on top of whatever the ends counted.
    // Made it by playing the double (e.g. the 5-5 onto four 5s)? That's a double all four: 200.
    const four = allFourValue(h.board);
    if (four !== null) {
      const doubled = isDouble(tile);
      award(m, seat, 'bonus', doubled ? 200 : 100, events, { reason: 'allFour', allFourValue: four, doubled });
      if (m.over) return { match: m, events };
    }
    // Blocking a double: this play shut out a double someone else is holding — it can never come in now.
    for (const d of deadDoubles(h.board)) {
      if (deadBefore.includes(d)) continue;
      const holder = h.hands.findIndex((hand) => hand.some((t) => t[0] === d && t[1] === d));
      if (holder < 0 || holder === seat) continue; // not held by anyone (boneyard) or you blocked your own
      award(m, seat, 'bonus', 50, events, { reason: 'blockedDouble', double: d, holder });
      if (m.over) return { match: m, events };
    }
  }

  // Domino — played the last tile.
  if (h.hands[seat].length === 0) {
    events.push({ type: 'domino', seat });
    if (points) {
      // Going out pays the other players' pips added up, rounded to the nearest 5 (27 -> 25, 38 -> 40).
      const left = h.hands.reduce((s, hand, i) => (i === seat ? s : s + handPips(hand)), 0);
      const amount = roundTo5(left);
      if (amount > 0) award(m, seat, 'bonus', amount, events, { reason: 'domino', pipsLeft: left, drawAsStrokes: true });
      if (m.over) return { match: m, events };
    }
    finishHand(m, seat, events);
    return { match: m, events };
  }

  if (checkLock(m, events, true)) return { match: m, events };
  h.turn = (seat + 1) % n;
  return { match: m, events };
}

/** Locked — nobody (including the player who just played) can ever move again. Ends the hand if so. */
function checkLock(m: MatchState, events: GameEvent[], afterPlay = false): boolean {
  const h = m.hand;
  const points = m.config.mode === 'points';
  const anyoneCanMove = h.boneyard.length > 0 || h.hands.some((hand) => canPlay(h.board, hand));
  if (!anyoneCanMove) {
    const pipCounts = h.hands.map(handPips);
    events.push({ type: 'locked', pips: pipCounts });
    // Locking the game pays the player who did it 50 for every other player shut out (150 at a 4-player table).
    if (points && afterPlay && h.lastPlayer !== null) {
      award(m, h.lastPlayer, 'bonus', 50 * (m.config.playerCount - 1), events, { reason: 'lockedGame' });
      if (m.over) return true;
    }
    const low = Math.min(...pipCounts);
    const lowest = pipCounts.map((p, s) => (p === low ? s : -1)).filter((s) => s >= 0);
    if (points && lowest.length === 1) {
      award(m, lowest[0], 'bonus', 50, events, { reason: 'lowestLock' });
      if (m.over) return true;
    }
    finishHand(m, null, events);
    return true;
  }
  return false;
}

function award(
  m: MatchState,
  seat: number,
  kind: 'points' | 'bonus',
  amount: number,
  events: GameEvent[],
  extra: { reason?: 'pass' | 'domino' | 'lowestLock' | 'blockedDouble' | 'allFour' | 'lockedGame'; passer?: number; endsTotal?: number; double?: number; holder?: number; allFourValue?: number; doubled?: boolean; pipsLeft?: number; drawAsStrokes?: boolean },
) {
  m.scores[seat] += amount;
  // Bonuses that aren't whole 50s (the domino payout) go on the scoreboard as strokes, like normal points.
  m.scoreLog[seat].push({
    kind: extra.drawAsStrokes ? 'points' : kind, amount, hand: m.hand.number,
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.pipsLeft !== undefined ? { pipsLeft: extra.pipsLeft } : {}),
    ...(extra.doubled !== undefined ? { doubled: extra.doubled } : {}),
  });
  if (kind === 'points') events.push({ type: 'score', seat, points: amount, endsTotal: extra.endsTotal! });
  else events.push({
    type: 'bonus', seat, points: amount, reason: extra.reason!,
    ...(extra.allFourValue !== undefined ? { allFourValue: extra.allFourValue, doubled: !!extra.doubled } : {}),
    ...(extra.passer !== undefined ? { passer: extra.passer } : {}),
    ...(extra.pipsLeft !== undefined ? { pipsLeft: extra.pipsLeft } : {}),
    ...(extra.double !== undefined ? { double: extra.double, holder: extra.holder } : {}),
  });

  // First player to fill their whole row wins on the spot.
  if (m.scores[seat] >= targetScore(m)) {
    m.hand.over = true;
    m.hand.ranking = rankHand(m, seat);
    m.hand.winner = seat;
    m.handsPlayed++;
    endMatch(m, seat, events);
  }
}

/**
 * Order seats for one hand.
 * Domino: the player who went out is 1st. Everyone else (and everyone on a lock) is ordered by pips
 * left, lowest first. Ties go to whoever comes first in turn order after `ref`
 * (the player who went out, or the last player to play on a lock).
 */
function rankHand(m: MatchState, winner: number | null): number[] {
  const h = m.hand;
  const n = m.config.playerCount;
  const ref = winner ?? h.lastPlayer ?? h.starter;
  const pipCounts = h.hands.map(handPips);
  const seats = [...Array(n).keys()];
  return seats.sort((a, b) => {
    if (a === winner) return -1;
    if (b === winner) return 1;
    if (pipCounts[a] !== pipCounts[b]) return pipCounts[a] - pipCounts[b];
    return ((a - ref + n) % n) - ((b - ref + n) % n);
  });
}

function finishHand(m: MatchState, winner: number | null, events: GameEvent[]) {
  const h = m.hand;
  h.over = true;
  h.ranking = rankHand(m, winner);
  h.winner = winner ?? h.ranking[0];
  m.handsPlayed++;
  events.push({ type: 'handOver', hand: h.number, winner: h.winner, ranking: h.ranking, pips: h.hands.map(handPips) });
  if (m.config.mode === 'regular') endMatch(m, null, events);
}

function endMatch(m: MatchState, rowWinner: number | null, events: GameEvent[]) {
  m.over = true;
  if (m.config.mode === 'regular') {
    m.placings = m.hand.ranking!.slice();
  } else {
    // Points: most points first. Ties: turn order after the player who filled their row.
    const n = m.config.playerCount;
    const ref = rowWinner ?? 0;
    m.placings = [...Array(n).keys()].sort((a, b) => {
      if (a === rowWinner) return -1;
      if (b === rowWinner) return 1;
      if (m.scores[a] !== m.scores[b]) return m.scores[b] - m.scores[a];
      return ((a - ref + n) % n) - ((b - ref + n) % n);
    });
  }
  events.push({ type: 'matchOver', placings: m.placings });
}

// ────────────────────────────────────────────────────────────────────────────
// Crowns & head-to-head
// ────────────────────────────────────────────────────────────────────────────

/** Gold 3 / Silver 2 / Bronze 1. Last place never gets a crown (4p: G/S/B, 3p: G/S, 2p: G). */
export function awardCrowns(match: MatchState): CrownAward[] {
  if (!match.placings) throw new Error('Match not finished');
  const medals: Medal[] = ['gold', 'silver', 'bronze'];
  const n = match.placings.length;
  return match.placings.map((seat, i) => {
    const medal = i < n - 1 ? medals[i] ?? null : null;
    return {
      seat,
      place: i + 1,
      medal,
      crownPoints: medal ? 3 - i : 0,
      fancy: match.config.mode === 'points',
    };
  });
}

/** Every pair where one player finished above another: [winnerSeat, loserSeat]. Use for head-to-head records. */
export function headToHead(match: MatchState): [number, number][] {
  if (!match.placings) throw new Error('Match not finished');
  const p = match.placings;
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) out.push([p[i], p[j]]);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Hidden information — NEVER send the full MatchState to a browser.
// ────────────────────────────────────────────────────────────────────────────

export interface PlayerView {
  mode: MatchState['config']['mode'];
  playerCount: number;
  rowBoxes: number;
  target: number;
  seat: number | null; // null = spectator
  myHand: Tile[];
  handCounts: number[];
  boneyardCount: number;
  board: MatchState['hand']['board'];
  turn: number;
  handNumber: number;
  scores: number[];
  scoreLog: MatchState['scoreLog'];
  endsTotal: number;
  legal: Action[]; // only filled for the player whose turn it is
  handOver: boolean;
  matchOver: boolean;
  ranking: number[] | null;
  placings: number[] | null;
  /** Revealed only once the hand is over, so everyone can see what was left. */
  revealedHands: Tile[][] | null;
}

export function viewFor(match: MatchState, seat: number | null): PlayerView {
  const h = match.hand;
  return {
    mode: match.config.mode,
    playerCount: match.config.playerCount,
    rowBoxes: match.config.rowBoxes,
    target: targetScore(match),
    seat,
    myHand: seat === null ? [] : h.hands[seat].slice(),
    handCounts: h.hands.map((x) => x.length),
    boneyardCount: h.boneyard.length,
    board: h.board,
    turn: h.turn,
    handNumber: h.number,
    scores: match.scores.slice(),
    scoreLog: match.scoreLog,
    endsTotal: endsTotal(h.board),
    legal: seat !== null && seat === h.turn ? legalActions(match) : [],
    handOver: h.over,
    matchOver: match.over,
    ranking: h.ranking,
    placings: match.placings,
    revealedHands: h.over ? h.hands : null,
  };
}

/**
 * Who's ahead right now (Points mode): seats ordered by total points, highest first.
 * Ties go to whoever did better in the last hand. Use it for the end-of-hand screen and the live scoreboard.
 */
export function standings(match: MatchState): { seat: number; place: number; total: number; thisHand: number; toGo: number }[] {
  const hand = match.hand.number;
  const handOrder = match.hand.ranking ?? [...Array(match.config.playerCount).keys()];
  const target = targetScore(match);
  return [...Array(match.config.playerCount).keys()]
    .sort((a, b) => match.scores[b] - match.scores[a] || handOrder.indexOf(a) - handOrder.indexOf(b))
    .map((seat, i) => ({
      seat,
      place: i + 1,
      total: match.scores[seat],
      thisHand: match.scoreLog[seat].filter((e) => e.hand === hand).reduce((s, e) => s + e.amount, 0),
      toGo: Math.max(0, target - match.scores[seat]),
    }));
}

/**
 * Doubles that can never be played again: the double isn't on the table, all six other tiles
 * with that number are already down, and no open end shows that number.
 */
export function deadDoubles(board: MatchState['hand']['board']): number[] {
  if (!board.center) return [];
  const down = board.history.map((x) => x.tile);
  const ends = openArms(board).map((id) => board.arms[id]!.value);
  const out: number[] = [];
  for (let d = 0; d <= 6; d++) {
    if (down.some((t) => t[0] === d && t[1] === d)) continue;
    const others = down.filter((t) => t[0] !== t[1] && (t[0] === d || t[1] === d)).length;
    if (others === 6 && !ends.includes(d)) out.push(d);
  }
  return out;
}

/** Round to the nearest 5: 27 -> 25, 28 -> 30, 38 -> 40. */
export const roundTo5 = (n: number) => Math.round(n / 5) * 5;
