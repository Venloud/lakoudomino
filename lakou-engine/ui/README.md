# Lakou Domino — game screen (React)

Ready-made React components for the in-game screens, built straight from the Figma frames:

| Screen | Figma node | Component |
|---|---|---|
| Game — Points (desktop, ≥1100px) | 1-2 | `LakouGame` |
| Game — Points (phone / tablet, <1100px) | 19-2 | `LakouGame` (switches layout automatically) |
| Hands revealed (leftover tiles face up) | 33-42 | inside `LakouGame` (3 seconds after a hand ends) |
| End of hand (standings 1st–4th) | 17-122 | inside `LakouGame` → `EndOfHand` |
| Final results with crowns | — | inside `LakouGame` → `MatchOver` |
| Seat offer (60-second "Take my seat") | 33-475 | `seatOffer` prop → `SeatOffer` |
| Waitlist panel | 17-2 | `waitlist` prop → `WaitlistPanel` |
| Home — Lobby (guest) | 3-2 | `LobbyScreen` (no `profile`) |
| Home — Signed in | 12-2 | `LobbyScreen` (with `profile`, `friends`, `requests`) |
| Sign in | 11-2 | `SignInScreen` |
| Waiting room + invite + chat + waitlist | 17-2 | `WaitingRoom` |

No dependencies besides React 18+. No Tailwind. All styles are in `lakou-ui.css` (class names start with `lk-`, so they can't clash with the rest of the app).

## Use it

```tsx
import { LakouGame } from '../lakou-engine/ui';
import '../lakou-engine/ui/lakou-ui.css';

<LakouGame
  view={view}                     // viewFor(match, mySeat) sent by the server — never the full MatchState
  names={['Venloud', 'Jean', 'Nadège', 'Bot 3']}   // by seat
  tableCode="XU62"
  events={lastEvents}             // the events array from the server's last applyAction/autoStep
  eventsKey={eventsCounter}       // +1 every time a new events batch arrives
  turnDeadline={turnEndsAtMs}     // epoch ms when the current player's 30 s end; null during the 5 s pause
  turnMs={30000}
  chat={messages}                 // [{ id, seat, name, text, mine? }]
  onAction={(action) => socket.send({ type: 'action', action })}
  onSendChat={(text) => socket.send({ type: 'chat', text })}
  onNextHand={() => socket.send({ type: 'nextHand' })}
  canStartNextHand={isHost}
  onLeave={leaveTable}
  onPlayAgain={() => socket.send({ type: 'playAgain' })}
  waitlist={{ entries, meId, notify, onToggleNotify, onJoin, onLeave }}
  seatOffer={offerForMe ? { tableName, seatNumber, reason, expiresAt, onTake, onStay } : null}
/>
```

The component is display-only: it never changes game state itself. Tapping a tile calls `onAction` with a legal move taken from `view.legal`. The server runs the engine and sends back a new `view` + `events`.

What it does on its own:
- Lays out the table with the engine's `layoutBoard`, sizes tiles like Figma (max 36px per half on desktop, 21.5px on phone) and keeps them inside the wood.
- Tap a tile: if it fits one end it plays; if it fits several, dashed gold spots appear on the table to choose from.
- Newest tile gets a ring in the player's colour and their name in a small pill.
- "+15" pop and gold glowing pips on the counted ends; "Pass!" flags on seat cards; big banners for DOMINO!, ALL FOUR, GAME LOCKED.
- 30-second countdown bar under your hand (red under 10 s) and a seconds badge on whoever's turn it is.
- End of hand: leftover tiles face up on the table for 3 s, then the standings sheet.
- Tally boxes with hover/tap tooltips.

## Other screens

All are display-only: they show what you pass in and call your handlers. Same CSS file, nothing else to import.

```tsx
import { LobbyScreen, SignInScreen, WaitingRoom } from '../lakou-engine/ui';

// Lobby — guest (3-2) or signed in (12-2: pass profile)
<LobbyScreen
  profile={user ? { name, flag: '🇭🇹', crownPoints, gold, silver, bronze, games, wins, socials: [{ label: 'TikTok', url }] } : null}
  onlinePlayers={128} tablesPlaying={34} connected={socketOpen}
  leaderboard={[{ id, name, points, gold, silver, bronze, isMe }]}      // top 6 guest, top 5 signed in
  openTables={[{ code: 'XU62', name: "Jean's table", mode: 'points', seats: 3, maxSeats: 4 }]}
  onJoinTable={(code) => …}                                            // row Join and the code box
  onOpenTable={({ name, mode, rowBoxes, turnSeconds, private }) => …}  // name only asked for guests
  onSignIn onSignUp onHowToPlay onPlayFriends onPracticeBots onViewLeaderboard
  onProfileMenu onEditProfile
  friends={[{ id, name, status: 'lobby' | 'game' | 'online' | 'offline', detail: 'Points' | '2h ago' }]}
  requests={[{ id, name }]}
  onAddFriend={(username) => …} onAcceptFriend onDeclineFriend onInviteFriend onWatchFriend
/>

// Play now: gold button in the Live lobby header + "Finding players" overlay
//   onPlayNow={(mode) => socket.send({ type: 'playNow', mode })}
//   queue={myStatus ? { mode, found, botsAt, onCancel: () => socket.send({ type: 'leaveQueue' }) } : null}

<SignInScreen onLogin={(user, pass) => …} onGoogle onApple onForgot onSignUp onGuest onBack error={msg} busy={loading} />
// Leave out onGoogle / onApple and those buttons (and the OR line) disappear.

<WaitingRoom
  tableName="Venloud's table" code="XU62" link="lakoudomino.com/t/XU62"
  mode="points" rowBoxes={10} turnSeconds={30} isPrivate
  seats={[{ name: 'Venloud', host: true }, { name: 'Jean' }, null, null]}  // null = open seat; { bot: true } for bots
  isHost={amHost} onStart onFillBots onLeave
  me={{ name, flag }}
  friends={[{ id, name, status, joined }]} onInviteFriend
  chat={messages} onSendChat
  waitlist={{ entries, meId, notify, onToggleNotify, onJoin, onLeave }}
/>
```

Copy invite link / Copy code copy to the clipboard by themselves (show "Link copied!"). Start game stays grey until every seat is filled. Only the host sees Start and Fill with bots.

Layouts: 3 columns at ≥1240px like Figma, 2 columns on tablet, single column on phone (<680px), no sideways scroll at 390px.

## Round 3 additions

- `LakouGame`: `onHome`, `nextHandAt` (auto next-hand countdown). Table frame takes the color of whoever's turn it is; new tiles slide in from that player's side. Seat colors are blue, red, green, white.
- Standings rows explain every point (from `scoreLog[].reason`).
- `LobbyScreen`: `onHome`, Play now `queue.onToggleBots` / `queue.onStartNow` / `queue.waitedMs`, table filters (needs `rowBoxes` on open tables), guest note on the leaderboard (`onSignIn`).
- `WaitingRoom`: `onChangeSettings` (host), `onHome`.
- `HowToPlayScreen`: the rules book.

## Preview

`harness/lakou-table.html` is a standalone build that runs the real engine with bots. Add `?screen=rules` (How to play), `?screen=queue` (Play now overlay), `?screen=lobby`, `?screen=home`, `?screen=signin` or `?screen=waiting` for the other screens, or `?state=mid`, `?state=reveal`, `?state=standings`, `?state=final` or `?state=offer` to jump to a screen. Rebuild with `node ui/harness/build.mjs`.
