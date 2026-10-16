I replaced the `lakou-engine` folder with a new version. It now has a `ui/` folder with the finished game screen as React components, built directly from our Figma frames. Read `lakou-engine/ui/README.md` first.

Your job is ONLY to plug it in. Do not design or restyle anything.

1. Replace the folder: first delete the OLD `lakou-engine` folder completely, then use the new one I uploaded.
2. Replace our whole in-game screen (table, seat cards, hand, side panel, chat panel, end-of-hand / results screens, seat offer popup) with `<LakouGame />` from `lakou-engine/ui`. Import `lakou-engine/ui/lakou-ui.css` once. Then delete our old game-screen components and their CSS: the flat table, seat cards, hand, tile components, results modal, and anything that draws dominoes.
3. Do NOT edit anything inside `lakou-engine/src` or `lakou-engine/ui`. Don't wrap LakouGame in extra styling or put it inside another card. Give it the full page. If a prop is missing something you need, tell me instead of editing the component.
4. Wire the props from our room/WebSocket state:
   - `view` = the `viewFor(match, mySeat)` the server sends (spectators: `viewFor(match, null)`).
   - `names` = player names by seat. `tableCode` = room code.
   - `events` = the events array from the server's last applyAction/autoStep; `eventsKey` = a number that goes up by 1 each time a new batch arrives.
   - `turnDeadline` = epoch ms when the current human player's 30 seconds end (null during the 5-second pause and on bot turns). Send it from the server so everyone sees the same countdown.
   - `chat` = `[{ id, seat, name, text, mine }]`. `onSendChat(text)` sends a chat message.
   - `onAction(action)` sends the move to the server, which calls `applyAction`.
   - `onNextHand` → server `startNextHand`. `canStartNextHand` = true for the host.
   - `onLeave`, `onPlayAgain` → our existing leave / rematch handlers.
   - `waitlist` = `{ entries: [{id, name}], meId, notify, onToggleNotify, onJoin, onLeave }` from the room's waitlist.
   - `seatOffer` = `{ tableName, seatNumber, reason, expiresAt, onTake, onStay }` when this viewer has an open seat offer, else null.
5. Keep all the server logic we already built (engine, 5-second pause, 30-second timer, waitlist, seat offers).

Before you say you're done:
- `npx tsx --test lakou-engine/test/engine.test.ts` passes (27 tests).
- Play one Points game with 3 bots. Send screenshots at 1440px wide and on phone (390px), mid-hand and on the standings screen. They should look like `lakou-engine/ui/harness/lakou-table.html` (open it in the browser to compare) and the Figma frames 1-2 and 19-2.
