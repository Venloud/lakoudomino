New feature: "Play now" matchmaking. Replace the lakou-engine folder with the new one again. Still don't edit lakou-engine/src or lakou-engine/ui.

How it works (the logic is already written in `lakou-engine/src/matchmaking.ts`, with tests):
- Play now puts you in a queue for Points or Regular.
- 4 people waiting for the same mode → they get a table together right away.
- Nobody else comes → 20 seconds after the first person in line joined, everyone waiting starts and bots fill the empty seats (1 person + 3 bots, 2 people + 2 bots…).
- After the game, "Play again" puts you back in the queue, so you get matched with anyone who's waiting before falling back to bots.

Wire it up:
1. Server: keep one `PlayQueue` (createQueue()). On a `playNow {mode}` message → `joinQueue(q, userId, mode, Date.now())`. On `leaveQueue` or disconnect → `leaveQueue(q, userId)`.
2. Every 1 second: `const { queue, matches } = tickQueue(q, Date.now(), { isOnline })`. For each match: create a room with those players in seat order and bots in the rest (`match.seats` is ready for autoStep), start the match immediately (no waiting room), and send those players straight into the game.
3. Every second while someone is queued, send each queued user their `queueStatus(q, userId)` → pass it to LobbyScreen as `queue={{ mode, found, botsAt, onCancel }}` (null when not queued). Pass `onPlayNow={(mode) => send playNow}`.
4. For games that came from Play now, the end-of-game "Play again" (onPlayAgain) calls joinQueue again and sends the player back to the lobby with the Finding players overlay. For friend tables, keep Play again as it is now.
5. Guests can use Play now too (use their guest id + name).
6. Run all tests: `npx tsx --test lakou-engine/test/*.test.ts` (33 tests). Then test in two browser windows: both hit Play now within 20 seconds → same table with 2 bots. One window alone → bots after 20 seconds. Send screenshots of the lobby with the Play now button, the Finding players overlay, and the game that started.
