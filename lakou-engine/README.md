# Lakou Domino — game engine

All the rules of Lakou Domino in plain TypeScript, with **no dependencies**. It covers the deal, legal moves, passing and drawing, the spinner, Points scoring, the 50 bonuses, locked games, placings, crowns, Van's tally scoreboard, a table layout where tiles never overlap, bots, and "loser gets up" seating.

It is **the single source of truth for the rules.** The server runs it; the browser only draws what it's sent.

## Files

| File | What it does |
|---|---|
| `src/match.ts` | `createMatch`, `legalActions`, `applyAction`, `startNextHand`, `standings` (who's 1st, 2nd…), `awardCrowns`, `headToHead`, `viewFor` |
| `src/board.ts` | Board, open ends, spinner, `endsTotal` (Points count), `countedHalves` (which pips to light up on a score) |
| `src/tally.ts` | `buildTally` (the 50-point boxes), `TALLY_STROKES` (stroke drawing order), `tallyBoxSvg` |
| `src/layout.ts` | `layoutBoard` gives every tile's x/y/size/rotation. Tiles never overlap, and lines turn at the table edge |
| `src/bots.ts` | `botMove` (easy / hard). Bots never look at other hands |
| `src/runner.ts` | `autoStep` (bots and forced passes/draws) and `timeoutMove` (turn timer ran out) |
| `src/room.ts` | Waitlist + "loser gets up": `joinWaitlist`, `setNotify`, `afterGame`, `acceptSeat`, `checkOffers` (1-minute seat offers), `readyToStart` |
| `test/engine.test.ts` | 27 tests, including 3,700 full bot games across every mode |
| `demo/` | A working practice table (you vs 3 bots) that uses this engine: reference front-end |

Run the tests with `npx tsx --test lakou-engine/test/engine.test.ts`.

## How the server uses it

```ts
import { createMatch, applyAction, autoStep, startNextHand, viewFor, IllegalMove } from './lakou-engine/src';

let { match, events } = createMatch({ mode: 'points', playerCount: 4, rowBoxes: 10 });
// store `match` in the room (it's plain JSON, so it can also go in the database)

// A player sent an action over the WebSocket:
try {
  ({ match, events } = applyAction(match, action));   // throws IllegalMove if it's not allowed
} catch (e) { if (e instanceof IllegalMove) return sendError(player, 'Not a legal move'); throw e; }

broadcastEvents(events);                                  // for animations, "+15", "Pass!", the chat log
for (const p of players) send(p, viewFor(match, p.seat)); // each player sees ONLY their own hand
for (const s of spectators) send(s, viewFor(match, null));

// Then loop with a delay (700–1200 ms) while autoStep returns something (bots, forced passes):
const step = autoStep(match, ['human', 'hard', 'human', 'easy']);
```

**Never send `match` itself to a browser,** because it contains everyone's tiles. Always send `viewFor(match, seat)`.

## How the browser uses it

- **Table:** `layoutBoard(view.board, { halfWidth: 8, halfHeight: 8 })` → scale by `bounds` to fit the table and recompute after every play (see the comment at the top of `layout.ts`). This replaces all hand-written tile positioning.
- **Scoreboard:** `buildTally(view.scoreLog[seat], view.rowBoxes)` → boxes with 0–10 strokes, or `"50"`. Draw strokes with `TALLY_STROKES`.
- **Clickable tiles:** `view.legal` (only filled on your turn).

## Rules as built

- **Regular:** one hand = one game, no spinner, two ends. First to play all tiles wins; others are ranked by pips left, lowest first. On a locked game, everyone is ranked by pips.
- **Points:** the first double played is the spinner. Its other two sides open once both main sides have a tile. After every play the open ends are added up (a double at an end counts both halves). If the total is a multiple of 5 and at least 10, the player scores it (a total of 5 scores nothing). There is a 50 bonus for each pass your play causes, going out pays the other players' pips added up and rounded to the nearest 5 (27 → 25, 38 → 40, drawn as strokes), 150 to the player whose play locks the game, 50 for lowest pips on a lock, 100 for **All four** (all four ends W, E, N, S have a tile and show the same number) or 200 for a **Double all four** (made by playing that number's double), paid on top of the normal count, and 50 for blocking a double (your play shuts out a double someone else is holding, so it can never come in; no bonus for blocking your own). Hands continue until someone fills their row. Hand 1 opens with the 6-6; after that, the previous winner starts with any tile.
- **Points mode is always 4 players** (`createMatch` refuses anything else).
- **Regular, 3 players:** the 0-0 is removed, 9 tiles each. **Regular, 2 players:** `'draw'` (7 each, draw from the boneyard) or `'split'` (14 each).
- **Crowns:** gold 3 / silver 2 / bronze 1. Last place never gets one. Points-mode crowns have `fancy: true`.

### Choices made where the rules didn't say (easy to change, ask Claude)
1. In Points mode the match ends **the moment** someone fills their row, even mid-hand.
2. A locked game is detected right after the play that locks it, so nobody has to pass around first. The player who locked it gets the lock bonus instead of pass bonuses.
3. If two players tie for lowest pips on a lock, **nobody** gets the 50.
4. Ties in placing go to whoever comes first in turn order after the winner (or after the last player to play, on a lock).
