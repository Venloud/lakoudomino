// Harness data for the non-game screens (?screen=lobby|home|signin|waiting). Same sample data as the Figma frames.
import React, { useState } from 'react';
import { LobbyScreen, SignInScreen, WaitingRoom, HowToPlayScreen, type ChatMessage, type WaitingSeat, type TableSettings } from '../index';

const BOARD = [
  { id: '1', name: 'Ti Jo', points: 58, gold: 12, silver: 8, bronze: 6 },
  { id: '2', name: 'Nadège', points: 53, gold: 10, silver: 7, bronze: 9 },
  { id: '3', name: 'Marc', points: 50, gold: 9, silver: 9, bronze: 5 },
  { id: '4', name: 'Stéphanie', points: 43, gold: 8, silver: 6, bronze: 7 },
  { id: '5', name: 'Venloud', points: 37, gold: 7, silver: 5, bronze: 6 },
  { id: '6', name: 'Jean', points: 35, gold: 5, silver: 6, bronze: 8 },
];
const TABLES = [
  { code: 'JN41', name: 'Jean’s table', mode: 'points' as const, seats: 3, maxSeats: 4, rowBoxes: 10 },
  { code: 'ND22', name: 'Nadège’s table', mode: 'regular' as const, seats: 2, maxSeats: 4 },
  { code: 'MC07', name: 'Marc’s table', mode: 'points' as const, seats: 1, maxSeats: 4, rowBoxes: 15 },
  { code: 'TJ90', name: 'Ti Jo’s table', mode: 'regular' as const, seats: 3, maxSeats: 4 },
];
const log = (...a: unknown[]) => console.log(...a);

export function Screens({ screen }: { screen: string }) {
  const [chat, setChat] = useState<ChatMessage[]>([
    { id: 1, seat: 1, name: 'Jean', text: 'yo I’m here' },
    { id: 2, seat: 0, name: 'Venloud', text: 'waiting on Marc, then we start', mine: true },
  ]);
  const [seats, setSeats] = useState<(WaitingSeat | null)[]>([{ name: 'Venloud', host: true }, { name: 'Jean' }, null, null]);
  const [notify, setNotify] = useState(true);
  const [queue, setQueue] = useState<{ mode: 'points' | 'regular'; found: number; botsAt: number | null } | null>(
    screen === 'queue' ? { mode: 'points', found: 2, botsAt: Date.now() + 12000 } : null);
  const [settings, setSettings] = useState<TableSettings>({ mode: 'points', rowBoxes: 10, turnSeconds: 15, isPrivate: false });
  const playNow = (mode: 'points' | 'regular') => {
    setQueue({ mode, found: 1, botsAt: Date.now() + 20000 });
    setTimeout(() => setQueue((q) => q && { ...q, found: 2 }), 6000);
  };

  if (screen === 'rules') return <HowToPlayScreen onBack={log} onPlayNow={log} />;
  if (screen === 'signin') {
    return <SignInScreen onLogin={log} onGoogle={log} onApple={log} onForgot={log} onSignUp={log} onGuest={log} onBack={log} />;
  }
  if (screen === 'waiting') {
    return (
      <WaitingRoom
        tableName="Venloud’s table" code="XU62" link="lakoudomino.com/t/XU62"
        mode={settings.mode} rowBoxes={settings.rowBoxes} turnSeconds={settings.turnSeconds} isPrivate={settings.isPrivate}
        onChangeSettings={setSettings}
        seats={seats} isHost
        onStart={() => log('start')} onLeave={() => log('leave')}
        onFillBots={() => setSeats((s) => s.map((x, i) => x ?? { name: `Bot ${i}`, bot: true }))}
        me={{ name: 'Venloud', flag: '🇭🇹' }}
        friends={[
          { id: 'j', name: 'Jean', status: 'table', joined: true, color: 1 },
          { id: 'm', name: 'Marc', status: 'online', color: 0 },
          { id: 'n', name: 'Nadège', status: 'game', detail: 'Points', color: 2 },
          { id: 'k', name: 'Kenny', status: 'offline', detail: 'yesterday', color: 3 },
        ]}
        onInviteFriend={log}
        chat={chat} onSendChat={(text) => setChat((c) => [...c, { id: Date.now(), seat: 0, name: 'Venloud', text, mine: true }])}
        waitlist={{
          entries: [{ id: 'm', name: 'Marc', seatColorIndex: 0 }, { id: 'k', name: 'Kenny', seatColorIndex: 3 }, { id: 't', name: 'Tasha', seatColorIndex: 1 }],
          meId: 'k', notify, onToggleNotify: setNotify, onJoin: log, onLeave: log,
        }}
      />
    );
  }
  const signedIn = screen === 'home' || screen === 'queue';
  return (
    <LobbyScreen
      profile={signedIn ? { name: 'Venloud', flag: '🇭🇹', crownPoints: 37, gold: 7, silver: 5, bronze: 6, games: 42, wins: 18,
        socials: [{ label: 'TikTok', url: '#' }, { label: 'Instagram', url: '#' }] } : null}
      onlinePlayers={128} tablesPlaying={34} connected
      leaderboard={signedIn ? BOARD.slice(0, 5).map((r) => ({ ...r, isMe: r.name === 'Venloud' })) : BOARD}
      openTables={TABLES}
      onJoinTable={log} onOpenTable={log} onPlayNow={playNow}
      queue={queue && { ...queue, onCancel: () => setQueue(null),
        onToggleBots: (ok) => setQueue((q) => q && { ...q, botsAt: ok ? Date.now() + 20000 : null }),
        onStartNow: () => setQueue(null) }} onViewLeaderboard={log}
      onSignIn={log} onSignUp={log} onHowToPlay={log} onPlayFriends={log} onPracticeBots={log}
      onProfileMenu={log} onEditProfile={log}
      friends={[
        { id: 'j', name: 'Jean', status: 'lobby', color: 1 },
        { id: 'n', name: 'Nadège', status: 'game', detail: 'Points', color: 2 },
        { id: 'm', name: 'Marc', status: 'online', color: 0 },
        { id: 's', name: 'Stéphanie', status: 'offline', detail: '2h ago', color: 1 },
        { id: 'k', name: 'Kenny', status: 'offline', detail: 'yesterday', color: 3 },
      ]}
      requests={[{ id: 't', name: 'Ti Jo', color: 3 }]}
      onAddFriend={log} onAcceptFriend={log} onDeclineFriend={log} onInviteFriend={log} onWatchFriend={log}
    />
  );
}
