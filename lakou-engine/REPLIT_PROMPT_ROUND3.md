Replace the lakou-engine folder with the new one. Still don't edit lakou-engine/src or lakou-engine/ui. This is the fix list from my full test of the site. Do all of it.

## Tables
1. Lingering tables: when the host leaves a waiting room, or nobody real is connected for 2 minutes, delete the room and remove it from the lobby. When everyone left is a bot (`onlyBotsLeft`), delete it too. Clean up the old test tables now.
2. Open table rows: also send `rowBoxes` and `turnSeconds` (the lobby now has All / Regular / Points filters and a row-length filter).
3. Waiting room: pass `onChangeSettings` (host only). It changes mode / row length / turn timer / private for the room and broadcasts to everyone waiting. Points still needs 4 seats.
4. Random deal every match: never pass a fixed `seed` to createMatch. (The first hand always starts with whoever holds the 6-6. That's the rule, not a bug.)

## Game loop
5. Pace: keep using `nextStep()`. It now plays faster by itself when there's only 1 real player at the table (about 3 s per bot instead of 6). Nothing extra to do.
6. Turn timer: the base must be THE TABLE'S setting (a 15 s table → 15 s), passed as `turnMs` to nextStep AND as `baseMs` to `afkTurnMs`/`recordTimeout`. Right now it's using 30 s.
7. Idle rule: on ANY action the player makes themselves (play, pass, draw), call `recordOwnPlay(afk, seat)`. Their clock goes back to full. Only consecutive auto-plays shrink it.
8. Next hand froze on the standings screen: after a hand ends (3 s tile reveal + standings), start the next hand automatically 10 s later and send that time as `nextHandAt` to LakouGame. `canStartNextHand` = true for the host at friend tables, and for every seated real player at Play now / bot tables. `onNextHand` must call startNextHand and restart the game loop.
9. Also still needed if not done: `turnDeadline` + `turnMs` on every update, and `mine: true` on your own chat messages.

## Play now
10. Play now tables have no waitlist: pass `waitlist={undefined}` (this also hides the "Line" tab).
11. Queue: `queueStatus(q, id, QUEUE_WAIT_MS, Date.now())` now also returns `botsOk` and `waitedMs`; `botsAt` is null when they're waiting for real players only. Pass to the `queue` prop: `{ mode, found, botsAt, waitedMs, onCancel, onToggleBots: (ok) => setBotsOk(q, id, ok, now), onStartNow: () => startNow(q, id) }`.

## Accounts, crowns, leaderboard
12. Crowns only if `countsForCrowns(seatsAtStart)` (at least 2 real players when the match started), and only for signed-in accounts. Guests and bot games are practice: no crowns, no stats.
13. Leaderboard: always show the real top players from the database, to guests too. For guests pass `onSignIn` to LobbyScreen (it shows "Sign in or create an account to get on the board").

## Navigation
14. "Lakou Domino" in the top bar goes home everywhere: pass `onHome`. LobbyScreen: scroll to top and refresh the lists. SignInScreen: already uses onBack. WaitingRoom and LakouGame: ask "Leave this table?" and, if yes, do the normal leave then go to the lobby.
15. "How to play" → new route that renders `<HowToPlayScreen onBack={toLobby} onPlayNow={playNow} />`.

## Check before you say you're done
- `npx tsx --test lakou-engine/test/*.test.ts` passes (42 tests).
- Play now alone → game with 3 bots: bots about 3 s apart. Let your 15 s clock run out once → next turn 11 s; play a tile → back to 15 s.
- Finish a Points hand: the standings show why each player scored (e.g. "Locked the game +150 · Lowest hand +50"), and the next hand starts by itself after 10 s.
- Leave a waiting room as host → the table disappears from the lobby.
Send screenshots of: the lobby with the filters, the Finding players popup, a waiting room as host, the standings screen, How to play.
