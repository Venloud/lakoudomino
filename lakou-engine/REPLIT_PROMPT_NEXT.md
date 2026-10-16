Replace the lakou-engine folder with the new one. Still don't edit lakou-engine/src or lakou-engine/ui. This round is 3 things.

## 1. Game pace (fixes the slow first tile with bots)
Use `nextStep()` from `lakou-engine/src/pacing.ts` for ALL game timing and delete our own delay/timer logic. The comment at the top of pacing.ts has the exact server loop. The rules it gives you:
- First tile of a hand: ~1.5 s (bots never wait for a turn timer).
- After a play: 5 s for the animations (a bit longer after All four / blocked double).
- After a pass: 1.5 s. After a draw: 0.7 s.
- Bots "think" an extra 0.6–1.6 s so they never answer instantly.
- Forced moves (only a pass or a draw possible) happen automatically, humans too.
- Real players' clock starts after the pause. Send `turnDeadline` = now + step.turnMs, and pass that player's `turnMs` to LakouGame so the bar is right.
Pass the table's speed setting as `{ speed }` (1.5 slow / 1 normal / 0.5 fast).
Cancel the pending timer whenever a human plays.

## 2. Idle players
Keep one `createAfk(4)` per match. When a player's clock runs out: `timeoutMove`, then `recordTimeout(afk, seat)`.
- Their turn time drops 25% each time for the rest of the match: 30 → 23 → 17 → 13 → 9 → 7 → 5 s. Pass `{ afk }` into nextStep and it gives the right turnMs.
- When `replacedByBot` is true: seats[seat] = 'hard', show their name as "<name> (bot)", send them back to the lobby with a message "You were away too long, a bot finished your game." They get no crowns for that match.
- If `onlyBotsLeft(seats)`: close the table and delete the room.
- New match = fresh AfkState.

## 3. Play now matchmaking (if you haven't done it yet, follow REPLIT_PROMPT_PLAYNOW.md)

Double-tap to play is already inside LakouGame. Nothing to wire.

Before you say you're done:
- `npx tsx --test lakou-engine/test/*.test.ts` passes (39 tests).
- Play one game with 3 bots and tell me how many seconds until the first tile shows up (should be under 3), and roughly the seconds between bot plays (about 6).
- Let your own clock run out twice and send a screenshot showing the shorter timer.
