I replaced the `lakou-engine` folder again. `lakou-engine/ui` now also has the lobby, sign in, signed-in home and waiting room screens, built from our Figma frames 3-2, 11-2, 12-2 and 17-2. Read the "Other screens" part of `lakou-engine/ui/README.md`.

Your job is ONLY to plug them in, the same way as LakouGame. Do not design or restyle anything.

1. Delete the old `lakou-engine` folder completely and use the new one.
2. Replace our pages with the components:
   - Lobby / home page → `<LobbyScreen />`. Guests: no `profile`. Signed in: pass `profile`, `friends`, `requests`.
   - Sign in page → `<SignInScreen />`.
   - Waiting room (after opening or joining a table, before the game starts) → `<WaitingRoom />`.
   Give each one the full page (it has its own top bar and flag stripe). Remove our old top bar on these pages, and delete the old lobby / sign-in / waiting-room components and their CSS.
3. Do NOT edit anything in `lakou-engine/src` or `lakou-engine/ui`, and don't wrap the screens in extra styling. If a prop is missing, tell me instead of editing the component.
4. Wire the props to what we already have:
   - Online counts, open tables, leaderboard and connected state from the server.
   - `onOpenTable` creates the room with the chosen mode, row length, turn timer and private flag. Points mode needs 4 players.
   - `onJoinTable(code)` joins by code.
   - Waiting room: seats from the room (null for open seats), `isHost`, `onStart` (only when every seat is filled), `onFillBots`, `onLeave`, room chat and waitlist.
   - Friends and requests: if we don't have a friends system yet, pass empty arrays and no-op handlers for now, and tell me.
   - Google / Apple: only pass `onGoogle` / `onApple` if that sign-in actually works. Otherwise leave them out and the buttons disappear.
5. `lakou-engine/ui/lakou-ui.css` is still the only CSS import.

Before you say you're done:
- `npx tsx --test lakou-engine/test/engine.test.ts` still passes (27 tests).
- Send screenshots of the lobby (signed out and signed in), sign in and the waiting room, at 1440px wide and at 390px. Compare them with `lakou-engine/ui/harness/lakou-table.html?screen=lobby` (also `home`, `signin`, `waiting`) and the Figma frames.
