import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  Bell, ChevronDown, CircleHelp, Crosshair, Gamepad2, Grid3X3, LogOut, MessageCircle, Plus,
  Trophy, ArrowUpRight,
} from 'lucide-react';
import {
  getGetAuthMeQueryKey, getGetLobbyQueryKey, getListFriendsQueryKey,
  getGetRecentMatchesQueryKey as getRecentMatchesQueryKey, getGetTicTacToeResultsQueryKey,
  useAcceptFriendInvite, useAcceptFriendRequest,
  useCreateFriendRequest, useDeclineFriendRequest, useGetAuthMe, useGetLobby,
  useGetRecentMatches, useGetTicTacToeResults, useJoinRoom, useJoinTicTacToeRoom, useListFriends, useLogout,
} from '@workspace/api-client-react';
import { TicTacToeProfileResults } from './tic-tac-toe-profile';

type Destination = 'home' | 'games' | 'friends' | 'leaderboard' | 'profile';
const navItems: { label: string; href: string; key: Destination }[] = [
  { label: 'Home', href: '/', key: 'home' },
  { label: 'Games', href: '/games', key: 'games' },
  { label: 'Friends', href: '/friends', key: 'friends' },
  { label: 'Leaderboard', href: '/leaderboard', key: 'leaderboard' },
  { label: 'Profile', href: '/profile', key: 'profile' },
];
const initials = (name: string) => name.trim().slice(0, 2).toUpperCase() || 'Y';
const presenceText = (status?: string | null, detail?: string) => {
  if (status === 'game') return detail ? `In a game · ${detail}` : 'In a game';
  if (status === 'lobby') return 'In the lobby';
  if (status === 'online') return 'Online';
  return 'Offline';
};

export function YardHeader({ active, username, notifications, onLogout }: { active: Destination; username?: string; notifications: number; onLogout: () => void }) {
  const [menu, setMenu] = useState(false);
  const [, setLocation] = useLocation();
  return <header className="yard-topbar">
    <Link href="/" className="yard-brand" aria-label="509 Yard home" data-testid="link-yard-home"><img src="/509-yard-logo-cutout.png" alt="509 Yard" /></Link>
    <nav className="yard-nav" aria-label="Product navigation">
      {navItems.map((item) => <Link key={item.key} href={item.href} aria-current={active === item.key ? 'page' : undefined} data-testid={`nav-${item.key}`}>{item.label}</Link>)}
    </nav>
    <div className="yard-tools">
      <button type="button" className="yard-tool" aria-label="Notifications" title="Notifications" data-testid="button-notifications" onClick={() => setLocation('/friends')}><Bell />{notifications > 0 && <i className="yard-badge" />}</button>
      <button type="button" className="yard-tool" aria-label="Messages" title="Messages" data-testid="button-messages" onClick={() => setLocation('/friends')}><MessageCircle /></button>
      {username ? <div className="yard-account">
        <button className="yard-avatar-button" type="button" aria-expanded={menu} aria-label="Account menu" data-testid="button-account-menu" onClick={() => setMenu(!menu)}>
          <span className="yard-avatar">{initials(username)}</span><span><b>{username}</b><br /><small className="yard-account-status"><i />Online</small></span><ChevronDown size={14} />
        </button>
        {menu && <div className="yard-menu" role="menu">
          <Link href="/profile" role="menuitem" onClick={() => setMenu(false)} data-testid="menu-profile">View profile</Link>
          <button type="button" role="menuitem" onClick={onLogout} data-testid="menu-sign-out"><LogOut size={14} /> Sign out</button>
        </div>}
      </div> : <button type="button" className="yard-button" onClick={() => setLocation('/sign-in')} data-testid="button-sign-in">Sign in</button>}
    </div>
  </header>;
}

function Panel({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`yard-panel ${className}`}>
    <div className="yard-panel-header"><h2>{title}</h2>{action}</div>
    <div className="yard-panel-body">{children}</div>
  </section>;
}

function EmptyHistory({ onGames }: { onGames: () => void }) {
  return <div className="yard-empty" data-testid="empty-recent-matches">
    <strong>No recorded matches yet</strong>
    <p>Your completed Lakou Domino matches will appear here. Start a game to put your first result on the board.</p>
    <button type="button" className="yard-button" onClick={onGames} data-testid="button-play-first-match">Find a game <ArrowUpRight size={14} /></button>
  </div>;
}

export default function SocialPage({ page }: { page: Destination }) {
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const auth = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey(), refetchOnWindowFocus: true } });
  const user = auth.data?.user;
  const signedIn = Boolean(user);
  const friendsQuery = useListFriends({ query: { queryKey: getListFriendsQueryKey(), enabled: signedIn, refetchOnWindowFocus: true } });
  const lobby = useGetLobby({ query: { queryKey: getGetLobbyQueryKey(), refetchInterval: 15000, refetchOnWindowFocus: true } });
  const recent = useGetRecentMatches({ query: { queryKey: getRecentMatchesQueryKey(), enabled: signedIn, refetchOnWindowFocus: true } });
  const ticTacToeResults = useGetTicTacToeResults({ query: { queryKey: getGetTicTacToeResultsQueryKey(), enabled: signedIn, refetchOnWindowFocus: true } });
  const requestFriend = useCreateFriendRequest();
  const acceptRequest = useAcceptFriendRequest();
  const declineRequest = useDeclineFriendRequest();
  const acceptInvite = useAcceptFriendInvite();
  const joinRoom = useJoinRoom();
  const joinTicTacToeRoom = useJoinTicTacToeRoom();
  const logout = useLogout();
  const [username, setUsername] = useState('');
  const [notice, setNotice] = useState('');
  const friendData = friendsQuery.data;
  const unreadSocial = (friendData?.requests.length ?? 0) + (friendData?.invites.length ?? 0);
  const leaderRows = lobby.data?.leaderboard ?? [];
  const openGames = lobby.data?.tables ?? [];
  const handleLogout = () => logout.mutate(undefined, {
    onSuccess: () => {
      client.setQueryData(getGetAuthMeQueryKey(), { user: null });
      client.removeQueries({ queryKey: getListFriendsQueryKey() });
      client.removeQueries({ queryKey: getRecentMatchesQueryKey() });
      client.removeQueries({ queryKey: getGetTicTacToeResultsQueryKey() });
      setLocation('/');
    },
    onError: () => setNotice('Could not sign out. Please try again.'),
  });
  const addFriend = (event: FormEvent) => {
    event.preventDefault();
    const clean = username.trim();
    if (!clean) return;
    requestFriend.mutate({ data: { username: clean } }, {
      onSuccess: () => { setUsername(''); setNotice(`Friend request sent to ${clean}.`); void client.invalidateQueries({ queryKey: getListFriendsQueryKey() }); },
      onError: () => setNotice('We could not send that friend request. Check the username and try again.'),
    });
  };
  const joinInvite = (id: string) => acceptInvite.mutate({ id }, {
    onSuccess: (result) => {
      const displayName = user?.username ?? 'Guest';
      if (result.game === 'tic-tac-toe') {
        joinTicTacToeRoom.mutate({ code: result.roomCode, data: { displayName } }, {
          onSuccess: (room) => {
            sessionStorage.setItem(`tic-tac-toe-reconnect-${room.code}`, room.reconnectToken);
            sessionStorage.setItem(`tic-tac-toe-display-name-${room.code}`, displayName);
            setLocation(`/games/tic-tac-toe/${room.code}`);
          },
          onError: () => setNotice('Invite accepted, but the Tic-Tac-Toe room could not be joined.'),
        });
        return;
      }
      joinRoom.mutate({ code: result.roomCode, data: { displayName } }, {
        onSuccess: (room) => {
          if (room.reconnectToken) {
            sessionStorage.setItem(`dominoes-reconnect-${room.code}`, room.reconnectToken);
            sessionStorage.setItem(`dominoes-display-name-${room.code}`, displayName);
            setLocation(`/room/${room.code}`);
          } else setNotice('The invite was accepted, but the table did not issue a reconnect token.');
        },
        onError: () => setNotice('Invite accepted, but the room could not be joined.'),
      });
    },
    onError: () => setNotice('That invite is no longer available.'),
  });
  const title = page === 'home' ? 'Meet at the table.' : page === 'games' ? 'Games' : page === 'friends' ? 'Friends' : page === 'leaderboard' ? 'Leaderboard' : 'Your profile';
  const subtitle = page === 'home' ? 'Find your crew, jump into a match, and see who takes the points.' : page === 'games' ? 'One game is on the table. More games are on the way.' : page === 'friends' ? 'Keep your people close and find who is around.' : page === 'leaderboard' ? 'The standings from games played across the yard.' : 'Your Lakou Domino record and recent results.';
  const recentMatches = recent.data?.matches ?? [];
  const friendRows = friendData?.friends ?? [];
  const goGames = () => setLocation('/games/lakou');
  const renderHistory = () => {
    if (!signedIn) return <div className="yard-empty" data-testid="empty-history-sign-in"><strong>Sign in to see your match history</strong><p>Recorded results belong to your Lakou account. Sign in to see your recent games and standings.</p><Link href="/sign-in" className="yard-button primary" data-testid="link-history-sign-in">Sign in</Link></div>;
    if (recent.isLoading) return <div className="yard-loading" data-testid="loading-recent-matches"><i className="yard-skeleton" /><i className="yard-skeleton" /><i className="yard-skeleton" /></div>;
    if (recent.isError) return <div className="yard-empty" role="alert" data-testid="error-recent-matches"><strong>Match history is unavailable</strong><p>We couldn't load your recorded matches.</p><button className="yard-button" onClick={() => void recent.refetch()} data-testid="button-retry-history">Try again</button></div>;
    if (!recentMatches.length) return <EmptyHistory onGames={goGames} />;
    return <div className="yard-history-list">{recentMatches.slice(0, 6).map((match) => <div className="yard-history-row" key={match.matchId} data-testid={`match-${match.matchId}`}>
      <span className="yard-result-mark">{match.rank ? `#${match.rank}` : '—'}</span>
      <span><b>{match.won ? 'Victory' : `${match.medal || 'Match'} finish`}</b><small>{match.mode === 'points' ? 'Points' : 'Regular'} · Table {match.roomCode} · {new Date(match.recordedAt).toLocaleDateString()}</small></span>
      <strong className="yard-history-points">{match.crownPoints > 0 ? `+${match.crownPoints}` : match.crownPoints} CP</strong>
    </div>)}</div>;
  };
  const renderFriends = () => {
    if (!signedIn) return <div className="yard-empty"><strong>Your people are one sign-in away</strong><p>Sign in to add friends, see their live status, and join their tables.</p><Link className="yard-button primary" href="/sign-in" data-testid="link-friends-sign-in">Sign in</Link></div>;
    if (friendsQuery.isLoading) return <div className="yard-loading"><i className="yard-skeleton" /><i className="yard-skeleton" /><i className="yard-skeleton" /></div>;
    if (friendsQuery.isError) return <div className="yard-empty" role="alert"><strong>Friends couldn't load</strong><button className="yard-button" onClick={() => void friendsQuery.refetch()}>Try again</button></div>;
    return <>
      <form className="yard-input-row" onSubmit={addFriend} data-testid="form-add-friend">
        <input className="yard-input" aria-label="Username" placeholder="Add by username" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={16} data-testid="input-friend-username" />
        <button className="yard-button primary" type="submit" disabled={!username.trim() || requestFriend.isPending} data-testid="button-add-friend"><Plus size={14} /> Add</button>
      </form>
      {friendData?.requests.length ? <div className="yard-section-space"><p className="yard-kicker">Requests · {friendData.requests.length}</p>{friendData.requests.map((request) => <div className="yard-friend-row" key={request.id} data-testid={`friend-request-${request.id}`}>
        <span className="yard-avatar">{initials(request.username)}</span><span style={{ flex: 1 }}><b>{request.username}</b><small>Wants to be friends</small></span>
        <span className="yard-list-actions"><button className="yard-small-button" onClick={() => acceptRequest.mutate({ id: request.id }, { onSuccess: () => void client.invalidateQueries({ queryKey: getListFriendsQueryKey() }) })} data-testid={`accept-request-${request.id}`}>Accept</button><button className="yard-small-button" onClick={() => declineRequest.mutate({ id: request.id }, { onSuccess: () => void client.invalidateQueries({ queryKey: getListFriendsQueryKey() }) })} data-testid={`decline-request-${request.id}`}>Decline</button></span>
      </div>)}</div> : null}
      {friendData?.invites.length ? <div className="yard-section-space"><p className="yard-kicker">Game invitations · {friendData.invites.length}</p>{friendData.invites.map((invite) => <div className="yard-friend-row" key={invite.id} data-testid={`friend-invite-${invite.id}`}><span className="yard-avatar">{initials(invite.inviterName)}</span><span style={{ flex: 1 }}><b>{invite.inviterName}</b><small>Invited you to {invite.game === 'tic-tac-toe' ? 'Tic-Tac-Toe' : 'Lakou Domino'} · {invite.roomCode}</small></span><button className="yard-small-button" onClick={() => joinInvite(invite.id)} data-testid={`join-invite-${invite.id}`}>Join</button></div>)}</div> : null}
      <div className="yard-section-space">
        <p className="yard-kicker">Your friends · {friendRows.length}</p>
        {friendRows.length ? friendRows.map((friend) => <div className="yard-friend-row" key={friend.id} data-testid={`friend-${friend.id}`}><span className="yard-avatar">{initials(friend.username)}</span><span style={{ flex: 1 }}><b>{friend.username}</b><small className="yard-presence"><i style={{ background: friend.status ? 'var(--yard-accent)' : '#66676c' }} />{presenceText(friend.status?.status, friend.status?.detail)}</small></span>{friend.status?.status === 'game' && friend.status.roomCode && <Link className="yard-small-button" href={`/room/${friend.status.roomCode}`} data-testid={`watch-friend-${friend.id}`}>Watch</Link>}</div>) : <div className="yard-empty"><strong>Start your circle</strong><p>Add a username above to find a friend and invite them to the next table.</p></div>}
      </div>
    </>;
  };
  return <div className="yard-app">
    <YardHeader active={page} username={user?.username} notifications={unreadSocial} onLogout={handleLogout} />
    <main className="yard-main">
      {notice && <div className="yard-notice" role="status" data-testid="status-social-notice">{notice}</div>}
      <div className={`yard-heading${page === 'home' ? ' yard-home-heading' : ''}`}><div>{page !== 'home' && <p className="yard-kicker">509 YARD / {page.toUpperCase()}</p>}<h1>{title}</h1><p className="yard-subtitle">{subtitle}</p></div>
        {page === 'home' ? <div className="yard-intro-actions"><Link className="yard-button primary" href="/games" data-testid="button-explore-games"><Gamepad2 size={15} /> Browse games</Link><Link className="yard-button" href="/friends" data-testid="button-find-friends">Find your crew</Link></div> : page === 'games' && <Link className="yard-button primary" href="/games/lakou" data-testid="button-play-lakou"><Gamepad2 size={15} /> Play Lakou Domino</Link>}
      </div>
      {page === 'home' && <>
        <div className="yard-home-grid">
          <Panel title="Recent matches" action={<Link href="/profile" className="yard-panel-link" data-testid="link-all-matches">Match history</Link>}>
            {renderHistory()}
          </Panel>
          <Panel title="Available games">
            <div className="yard-available-game" data-testid="card-featured-game">
              <div className="yard-game-tile" aria-hidden="true"><i /><i /><i /></div>
              <div className="yard-available-copy"><strong>Lakou Domino</strong><span>Multiplayer dominoes</span></div>
              <Link href="/games/lakou" className="yard-button primary" data-testid="button-open-lobby">Play</Link>
            </div>
            <div className="yard-coming-soon"><Crosshair size={17} /><span>Mòpyon is up next</span><Link href="/games/mopyon" className="yard-panel-link">Preview</Link></div>
            <div className="yard-coming-soon"><Gamepad2 size={17} /><span>Coming after: Box → Kay</span></div>
            <div className="yard-coming-soon"><Grid3X3 size={17} /><span>Tic-Tac-Toe · Regular and Yard Mode</span><Link href="/games/tic-tac-toe" className="yard-panel-link">Play online</Link></div>
          </Panel>
        </div>
        <div className="yard-home-status">
          <span className="yard-live-indicator"><i /> Yard activity</span>
          <span><b data-testid="value-players-online">{lobby.data?.onlinePlayers ?? '—'}</b> players online</span>
          <span><b data-testid="value-tables-playing">{lobby.data?.tablesPlaying ?? '—'}</b> tables playing</span>
          <span><b data-testid="value-open-tables">{openGames.length}</b> open tables</span>
          <Link href="/friends" data-testid="link-home-friends">Friends <ArrowUpRight size={13} /></Link>
        </div>
      </>}
      {page === 'games' && <div className="yard-dashboard-grid">
        <div><section className="yard-featured-game"><div><p className="yard-kicker">AVAILABLE NOW</p><h2 className="yard-game-title">Lakou Domino</h2><p className="yard-game-copy">Classic table play with Regular and Points modes, live matchmaking, private rooms, and friends.</p><Link className="yard-button primary" href="/games/lakou" data-testid="button-play-lakou-card"><Gamepad2 size={15} /> Play now</Link></div><div className="yard-domino-mark" aria-hidden="true" /></section>
            <div className="yard-panel yard-section-space yard-next-game"><div className="yard-panel-body"><p className="yard-kicker">COMING NEXT</p><h2 style={{ fontSize: 17, margin: '0 0 5px' }}>Mòpyon</h2><p className="yard-subtitle" style={{ margin: 0 }}>Five in a row, played on the intersections of a 15 × 15 board.</p><Link href="/games/mopyon" className="yard-button yard-section-space" data-testid="button-preview-mopyon"><Crosshair size={15} /> Try local game</Link><small className="yard-next-game-note">Two players, one screen. Online rooms can come next.</small><div className="yard-coming-soon"><Gamepad2 size={15} /><span>Then: Box → Kay</span></div></div></div>
            <div className="yard-panel yard-section-space"><div className="yard-panel-body"><p className="yard-kicker">AVAILABLE NOW</p><h2 style={{ fontSize: 17, margin: '0 0 5px' }}>Tic-Tac-Toe</h2><p className="yard-subtitle" style={{ margin: 0 }}>Create a room, invite a friend, and play across devices in Regular or Yard Mode.</p><Link href="/games/tic-tac-toe" className="yard-button yard-section-space" data-testid="button-preview-tic-tac-toe"><Grid3X3 size={15} /> Play Tic-Tac-Toe</Link><small className="yard-next-game-note">Share a room link or invite a Lakou friend.</small></div></div>
        </div>
        <Panel title="Live activity"><div className="yard-metric"><b>{lobby.data?.onlinePlayers ?? '—'}</b><span>Players in the yard</span></div><p className="yard-subtitle">Open the Lakou lobby to browse live tables or start a match.</p></Panel>
      </div>}
      {page === 'friends' && <div className="yard-dashboard-grid"><Panel title="Your circle" action={<span className="yard-status">{signedIn ? `${friendRows.length} friends` : 'Sign in required'}</span>}>{renderFriends()}</Panel>
        <div className="yard-side-stack"><Panel title="Table activity"><p className="yard-subtitle" style={{ margin: 0 }}>See who's online, send table invitations, and jump into games with friends.</p><Link href="/games/lakou" className="yard-button yard-section-space" data-testid="button-open-game-lobby">Open game lobby</Link></Panel><Panel title="Messages"><div className="yard-empty"><strong>Keep the conversation at the table</strong><p>Messages are available inside live Lakou Domino rooms.</p><Link href="/games/lakou" className="yard-panel-link">Find a table</Link></div></Panel></div>
      </div>}
      {page === 'leaderboard' && <Panel title="Crown points" action={<span className="yard-status">Lakou Domino · Points mode</span>}>
        {lobby.isLoading ? <div className="yard-loading"><i className="yard-skeleton" /><i className="yard-skeleton" /><i className="yard-skeleton" /></div> : lobby.isError ? <div className="yard-empty" role="alert"><strong>Standings unavailable</strong><p>We couldn't load the live leaderboard.</p><button className="yard-button" onClick={() => void lobby.refetch()}>Try again</button></div> : leaderRows.length ? <div className="yard-rows">{leaderRows.map((row, index) => <div className="yard-rank-row" key={row.id} data-testid={`leaderboard-row-${row.id}`}><b>{String(index + 1).padStart(2, '0')}</b><span>{row.name}{row.isMe ? ' (you)' : ''}</span><strong>{row.points.toLocaleString()} CP</strong></div>)}</div> : <div className="yard-empty"><Trophy size={20} color="var(--yard-accent)" /><strong>No standings yet</strong><p>Points games against real players earn crown points. Start a match to join the board.</p><Link className="yard-button primary" href="/games/lakou">Play Points</Link></div>}
      </Panel>}
      {page === 'profile' && <>{!signedIn ? <Panel title="Your Lakou account"><div className="yard-empty"><strong>Sign in to see your profile</strong><p>Your record and recorded matches are attached to your account. Sign in to view them here.</p><Link href="/sign-in" className="yard-button primary" data-testid="link-profile-sign-in">Sign in</Link></div></Panel> : <>
        <Panel title="Player card"><div className="yard-profile-card"><span className="yard-avatar">{initials(user?.username ?? '')}</span><span><p className="yard-kicker">PLAYER</p><h2 style={{ margin: 0, fontSize: 20 }}>{user?.username}</h2><small className="yard-status">Lakou Domino account</small></span></div></Panel>
        <div className="yard-profile-stat-grid yard-section-space">
          <div className="yard-profile-stat"><strong>{user?.crownPoints ?? 0}</strong><span>Crown points</span></div><div className="yard-profile-stat"><strong>{user?.games ?? 0}</strong><span>Domino games</span></div><div className="yard-profile-stat"><strong>{user?.wins ?? 0}</strong><span>Domino wins</span></div><div className="yard-profile-stat"><strong>{user?.gold ?? 0} / {user?.silver ?? 0} / {user?.bronze ?? 0}</strong><span>Domino medals</span></div>
        </div>
        <div className="yard-section-space"><Panel title="Recent matches">{renderHistory()}</Panel></div>
        <div className="yard-section-space"><Panel title="Tic-Tac-Toe results">
          <TicTacToeProfileResults
            data={ticTacToeResults.data}
            isLoading={ticTacToeResults.isLoading}
            isError={ticTacToeResults.isError}
            onRetry={() => void ticTacToeResults.refetch()}
          />
        </Panel></div>
      </>}</>}
      <footer className="yard-section-space" style={{ color: 'var(--yard-muted)', fontSize: 10 }}><CircleHelp size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />509 Yard · Lakou Domino is the first game. <Link href="/how-to-play" className="yard-panel-link" style={{ marginLeft: 6 }}>How to play</Link></footer>
    </main>
  </div>;
}
