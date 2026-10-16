I uploaded a folder called `lakou-engine`. It is the finished, tested game engine for Lakou Domino: all rules, Points scoring, the tally scoreboard, the table layout, bots and seat rotation. Read `lakou-engine/README.md` first.

DESIGNS: Figma is the source of truth for the look — https://www.figma.com/design/p1dqMpTkC2qzsJeY61Zhnq (use the Figma integration; the account now has a Full seat, so reads work). Screens:
- Home — Lobby: node-id=3-2 · Sign in: 11-2 · Home — Signed in: 12-2
- Waiting room (now with the WAITLIST panel + "Notify me" toggle): 17-2
- Game — Points (desktop, with the 30-second turn bar under the hand): 1-2 · Game — Points (phone): 19-2
- Game — Hands revealed (leftover tiles face up on the table after a hand): 33-42
- Game — End of hand (standings 1st–4th): 17-122
- Seat offer (waitlist, 60-second "Take my seat"): 33-475

Rules for this job:
1. Do NOT rewrite, "improve" or re-implement anything inside `lakou-engine/src`. Import it. If something in it seems wrong, tell me instead of changing it.
2. Delete our old game-rule code (dealing, legal moves, scoring, pass logic, winner logic, bot logic) and use the engine instead. Keep our rooms, WebSocket, chat and UI.
3. Server: store one `MatchState` per room. When a player sends a move, call `applyAction`. If it throws `IllegalMove`, reject the move. After every change, send each player `viewFor(match, theirSeat)` and send spectators `viewFor(match, null)`. NEVER send the full `MatchState` to a browser, because it has everyone's tiles. Broadcast the `events` array so the UI can show "+15", "+50", "Pass!", "Game locked +150", "DOMINO! +30" (going out pays the other players' pips rounded to the nearest 5), "ALL FOUR +120" / "DOUBLE ALL FOUR +210" (big banner: the 100 or 200 bonus plus whatever the ends counted on that play), "Blocked the 4-4!" and the chat log lines. On the table, show the newest tile with a ring in the player's colour and their name in a small pill on the tile's open side (see the demo).
4. Turn pace (server-side timers, same for everyone at the table):
   - After EVERY play (or pass), wait 5 seconds before the next turn starts, so everyone sees the tile, the points and the animations. The host can pick Slow / Normal / Fast (×1.5 / ×1 / ×0.5 on that pause). The first tile of a hand doesn't wait.
   - Then: bots and forced passes/draws happen via `autoStep(match, seatKinds)` (seatKinds is 'human', 'easy' or 'hard' per seat).
   - Real players get 30 seconds. Show a countdown bar and seconds on their seat (gold, turning red under 10 s) that everyone can see. If time runs out, call `timeoutMove(match)` to play for them and post "Van ran out of time" in the table talk.
5. Points mode: when a hand ends (`view.handOver` and not `view.matchOver`), show the end-of-hand screen as STANDINGS from `standings(match)`: 1st, 2nd, 3rd, 4th by total points, each with points gained this hand and points to go. Then call `startNextHand` on the server.
6. When the match ends, save `awardCrowns(match)` and `headToHead(match)` to each player's profile.
7. Waitlist and "loser gets up" (use `lakou-engine/src/room.ts`, one `Room` per table):
   - Show a WAITLIST panel in the room to everyone: numbered names in order, and "You're #2 in line" for the viewer. Spectators get a "Join waitlist" / "Leave" button.
   - When a game ends, call `afterGame(room, match.placings, losersLeave, Date.now(), isOnline)`. Losers (and seated players who are offline) get up and go to the back of the line. The host never gets up. Nobody gets up if no one online is waiting.
   - Each free seat is OFFERED to the next online person in line: show them a big "Your seat is ready — Take my seat" button with a 60-second countdown. `acceptSeat` seats them.
   - While any offer is open, run `checkOffers(room, Date.now(), isOnline)` every 5 seconds. No answer in 1 minute (or they went offline) → they move to the back of the line and the seat goes to the next person. Start the next game when `readyToStart(room)`; empty seats get bots.
   - "Notify me" toggle for people on the waitlist (`setNotify`). On the `notifyGameOver` event, ping them: a sound, a browser notification (ask permission when they turn the toggle on) and the tab title flashing "Your turn to sit!". Also ping when they get a seat offer.
8. Table drawing: replace ALL tile positioning code with `layoutBoard(view.board)`. Scale it to fit the square wooden table using `bounds` (formula at the top of `lakou-engine/src/layout.ts`), recompute after every play, and animate left/top with a CSS transition. Delete the legacy renderer and the hard-coded 40×72 tile sizes. Leave a small gap (about 6% of a unit) around each tile so touching tiles read as separate pieces.
9. Scoreboard: draw each player's row with `buildTally(view.scoreLog[seat], view.rowBoxes)` and `TALLY_STROKES`. Boxes show strokes 0–10 or the numeral "50", and overflow shows as "+10". Hovering (or tapping) a box shows a small tooltip with the points in it, e.g. "Box 3: 35 pts · 15 to fill".
11. When someone scores, light up the pips that were counted: use `countedHalves(board)` with each laid tile's `outerHalf`. The pips turn gold, grow slightly and fade back over about 1.3 s (see the demo).
10. `lakou-engine/demo/lakou-practice.html` is a working reference front-end built on the same engine. Match its behaviour (tap a tile; if it fits more than one end, glowing spots appear on the table to choose from). Keep our Figma look.
12. Points mode is 4 players only. In the lobby, the 3-player and 1v1 options only appear for Regular.
13. When a hand ends, reveal everyone's leftover tiles face up ON the table (`view.revealedHands`, only filled once the hand is over): dim the board and show one row per player in finishing order with their colour, name, face-up tiles and pip count ("Domino!" for whoever went out). Tiles flip in. Keep it up about 3 seconds before the standings sheet opens. Also show them in each player's seat card and in the standings rows.
14. Wording is English by default: say "Pass!" (not "Pase!") everywhere, including the quick-chat chips, and "Game locked" when nobody can play. Creole/Spanish wording comes later as a language option.

Before you say you're done:
- Run `npx tsx --test lakou-engine/test/engine.test.ts`. All 27 tests must pass.
- Play one full Points game with 3 bots and one Regular game in the browser. Send me screenshots of the table mid-hand, the end-of-hand screen and the final results with crowns.
