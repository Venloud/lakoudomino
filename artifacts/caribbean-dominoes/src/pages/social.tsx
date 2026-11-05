import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  Bell, ChevronDown, CircleHelp, Gamepad2, LogOut, MessageCircle, Plus,
  Trophy, ArrowUpRight,
} from 'lucide-react';
import {
  getGetAuthMeQueryKey, getGetLobbyQueryKey, getListFriendsQueryKey,
  getGetRecentMatchesQueryKey as getRecentMatchesQueryKey, getGetTicTacToeResultsQueryKey,
  useAcceptFriendInvite, useAcceptFriendRequest, useCreateFriendInvite, useDismissFriendInvite, useWithdrawFriendInvite,
  useCreateFriendRequest, useDeclineFriendRequest, useGetAuthMe, useGetLobby,
  useGetRecentMatches, useGetTicTacToeResults, useJoinRoom, useJoinTicTacToeRoom, useListFriends, useLogout,
} from '@workspace/api-client-react';
import { getClientId } from '@/lib/lakou-session';
import { TicTacToeProfileResults } from './tic-tac-toe-profile';

type Destination = 'home' | 'games' | 'friends' | 'leaderboard' | 'profile' | 'about';

function GameMark({ game }: { game: string }) {
  return <span className={`yard-game-mark yard-mark-${game}`} aria-hidden="true">
    <svg viewBox="0 0 40 40" role="presentation">
      <rect x="1" y="1" width="38" height="38" rx="5.5" fill="#f0ead8" stroke="#383832" strokeWidth="1.2" />
      {game === 'tic-tac-toe' && <>
        <path d="M14 8v24M26 8v24M8 14h24M8 26h24" stroke="#dfe7d5" strokeOpacity=".5" strokeWidth="1.5" />
        <path d="m10 10 7 7m0-7-7 7" stroke="#91bd78" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="26" cy="26" r="4" fill="none" stroke="#f1d983" strokeWidth="2.5" />
      </>}
      {game === 'mopyon' && <>
        <path d="M9 9h22M9 20h22M9 31h22M9 9v22M20 9v22M31 9v22" stroke="#dce6d3" strokeOpacity=".52" strokeWidth="1.5" />
        <circle cx="9" cy="9" r="3" fill="#91bd78" /><circle cx="20" cy="20" r="3" fill="#f1d983" />
        <circle cx="31" cy="31" r="3" fill="#91bd78" /><circle cx="31" cy="9" r="3" fill="#e67870" />
      </>}
      {game === 'box' && <>
        <path d="M10 10h20v20H10z" fill="#d5a75c" fillOpacity=".24" stroke="#e8bc70" strokeWidth="2" />
        <path d="M10 10h20M10 20h20M10 30h20M10 10v20M20 10v20M30 10v20" stroke="#e9eee2" strokeOpacity=".45" strokeWidth="1" />
        <path d="M10 20h10M20 20v10" stroke="#8ecf62" strokeWidth="2.5" />
        {[10, 20, 30].map((x) => [10, 20, 30].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" fill="#f3eee0" />))}
      </>}
      {game === 'kay' && <>
        <rect x="6" y="10" width="28" height="20" rx="8" fill="none" stroke="#d8c28e" strokeWidth="1.5" />
        {[11, 17, 23, 29].map((x) => <g key={x}><ellipse cx={x} cy="15" rx="2.4" ry="3" fill="#dfc27c" /><ellipse cx={x} cy="25" rx="2.4" ry="3" fill="#dfc27c" /></g>)}
        <circle cx="8" cy="20" r="3" fill="#f0dfb6" /><circle cx="32" cy="20" r="3" fill="#f0dfb6" />
      </>}
      {game === 'chess' && <>
        <path d="M8 8h12v12H8zM20 20h12v12H20z" fill="#d9d5c2" fillOpacity=".42" />
        <path d="M22 31h11v-2l-3-2 1-4-3-3 1-4-4-7-7 2 1 5-3 4 2 3-2 4-3 2v2z" fill="#eee9da" stroke="#b5a778" strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="25" cy="12" r="1" fill="#332f26" />
      </>}
      {game === 'dame' && <>
        <path d="M8 8h12v12H8zM20 20h12v12H20z" fill="#d9d5c2" fillOpacity=".45" />
        <circle cx="15" cy="25" r="7" fill="#b84947" stroke="#f2d5b5" strokeWidth="1.5" />
        <circle cx="15" cy="25" r="4.5" fill="none" stroke="#e79585" strokeWidth="1" />
        <circle cx="27" cy="13" r="5" fill="#f0e8d6" stroke="#b5a778" strokeWidth="1.5" />
      </>}
      {(game === 'words' || game === 'word-yard') && <>
        <path d="M14 14 21 11 25 23" stroke="#45453f" strokeWidth="1.3" />
        <rect x="6" y="10" width="11" height="11" rx="2" fill="#f8f3e5" stroke="#45453f" strokeWidth="1.3" />
        <rect x="16" y="6" width="11" height="11" rx="2" fill="#d5ceb9" stroke="#45453f" strokeWidth="1.3" />
        <rect x="21" y="21" width="11" height="11" rx="2" fill="#d5ceb9" stroke="#45453f" strokeWidth="1.3" />
        <circle cx="21.5" cy="11.5" r="1.5" fill="#729e63" />
      </>}
      {game === 'scrabble' && <>
        <rect x="7" y="7" width="26" height="26" rx="2" fill="#d5ceb9" stroke="#45453f" strokeWidth="1.3" />
        <path d="M20 7v26M7 20h26" stroke="#45453f" strokeWidth="1.1" />
        <rect x="9" y="9" width="9" height="9" rx="1.3" fill="#f8f3e5" stroke="#45453f" strokeWidth="1" />
        <rect x="22" y="22" width="9" height="9" rx="1.3" fill="#f8f3e5" stroke="#45453f" strokeWidth="1" />
        <circle cx="24.5" cy="11.5" r="1.7" fill="#729e63" />
      </>}
      {game === 'barricade' && <>
        <path d="M9 10h22M9 20h22M9 30h22M10 9v22M20 9v22M30 9v22" stroke="#d9e6ca" strokeOpacity=".48" strokeWidth="1" />
        <circle cx="13" cy="26" r="4" fill="#9adb68" stroke="#e4f5cb" strokeWidth="1.4" />
        <path d="m22 12 8 4-2 4-8-4z" fill="#e5c56f" stroke="#fff0b5" strokeWidth="1" />
        <circle cx="27" cy="27" r="3" fill="#ed7770" />
      </>}
      {game === 'four-in-a-row' && <>
        <rect x="5" y="7" width="30" height="26" rx="5" fill="#195e9e" stroke="#67a4d7" strokeWidth="1.4" />
        {[10, 20, 30].map((x) => [12, 20, 28].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#112f57" />))}
        <circle cx="10" cy="12" r="3" fill="#ef6465" /><circle cx="20" cy="20" r="3" fill="#ef6465" />
        <circle cx="30" cy="28" r="3" fill="#f0ce58" />
      </>}
      {game === 'filler' && <>
        <path d="M8 8h11v11H8z" fill="#78c856" /><path d="M21 8h11v11H21z" fill="#56a7dd" />
        <path d="M8 21h11v11H8z" fill="#e6c656" /><path d="M21 21h11v11H21z" fill="#dc6b72" />
        <path d="M13.5 13.5h13v13h-13z" fill="none" stroke="#f4f0e6" strokeWidth="1.5" strokeDasharray="2 2" />
      </>}
      {game === 'block-drop' && <>
        <path d="M15 8h9v9h-9zM6 17h9v9H6zM15 17h9v9h-9zM24 17h9v9h-9zM15 26h9v8h-9z" fill="#a98ae9" stroke="#e2d6ff" strokeWidth="1" />
        <path d="M17 10h5v2h-5zM8 19h5v2H8z" fill="#e6dcff" fillOpacity=".7" />
      </>}
      {!['tic-tac-toe', 'mopyon', 'box', 'kay', 'chess', 'dame', 'words', 'word-yard', 'scrabble', 'barricade', 'four-in-a-row', 'filler', 'block-drop'].includes(game) && <>
        <path d="M10 11h20v18H10z" fill="none" stroke="#dbe9d0" strokeWidth="2" />
        <circle cx="15" cy="20" r="3" fill="#91bd78" /><circle cx="25" cy="20" r="3" fill="#f1d983" />
      </>}
    </svg>
  </span>;
}

function GameIcon({ slug }: { slug: string }) {
  if (slug === 'domino') return <img src="/domino-logo.webp" alt="" />;
  if (slug === 'mopyon') return <img src="/mopyon-logo.webp" alt="" />;
  if (slug === 'box') return <img src="/box-logo.webp" alt="" />;
  if (slug === 'kay') return <img src="/kay-logo.webp" alt="" />;
  if (slug === 'chess') return <img src="/chess-logo.webp" alt="" />;
  if (slug === 'dame') return <img src="/dame-logo.webp" alt="" />;
  if (slug === 'words' || slug === 'word-yard') return <img src="/word-yard-logo.webp" alt="" />;
  if (slug === 'scrabble') return <img src="/scrabble-logo.webp" alt="" />;
  if (slug === 'tic-tac-toe') return <img src="/tic-tac-toe-logo.webp" alt="" />;
  return <GameMark game={slug} />;
}

const arcadeGameIds = new Set([
  'mopyon', 'box', 'kay', 'chess', 'dame', 'scrabble',
  'barricade', 'four-in-a-row', 'filler', 'block-drop',
]);

async function createInviteRoom(game: string, displayName: string): Promise<{ code: string; route: string }> {
  const arcade = arcadeGameIds.has(game);
  const endpoint = game === 'domino' ? '/api/rooms'
    : game === 'tic-tac-toe' ? '/api/tic-tac-toe/rooms'
      : game === 'words' ? '/api/word-yard/rooms'
        : '/api/arcade/rooms';
  const body = game === 'domino'
    ? { displayName, mode: 'regular', rowLength: 10, rowBoxes: 10, playerCount: 2, twoPlayerVariant: 'draw', isPrivate: true }
    : game === 'tic-tac-toe'
      ? { displayName, mode: 'regular' }
      : game === 'words'
        ? { displayName, mode: 'classic', playerCount: 2, wordLength: 5, timeLimitMs: 180_000, roundsToPlay: 3, isPrivate: true }
        : { game, displayName, playerCount: 2, isPrivate: true };

  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-lakou-client': 'lakou' },
    body: JSON.stringify(body),
  });
  const result = await response.json() as {
    code?: string; reconnectToken?: string; seat?: number;
    room?: { code?: string };
    error?: string;
  };
  if (!response.ok) throw new Error(result.error || 'Could not create a private game room.');
  const code = result.room?.code ?? result.code;
  if (!code || !result.reconnectToken) throw new Error('The room was created without access details.');

  if (game === 'domino') {
    sessionStorage.setItem(`dominoes-reconnect-${code}`, result.reconnectToken);
    sessionStorage.setItem(`dominoes-display-name-${code}`, displayName);
    sessionStorage.setItem(`dominoes-host-token-${code}`, result.reconnectToken);
    sessionStorage.setItem(`dominoes-host-${code}`, displayName);
  } else if (game === 'tic-tac-toe') {
    sessionStorage.setItem(`tic-tac-toe-reconnect-${code}`, result.reconnectToken);
    sessionStorage.setItem(`tic-tac-toe-display-name-${code}`, displayName);
  } else if (game === 'words') {
    sessionStorage.setItem(`word-yard-reconnect-${code}`, result.reconnectToken);
    sessionStorage.setItem(`word-yard-display-name-${code}`, displayName);
    if (Number.isInteger(result.seat)) sessionStorage.setItem(`word-yard-seat-${code}`, String(result.seat));
  } else if (arcade) {
    sessionStorage.setItem(`509-yard-arcade-room:${game}`, JSON.stringify({
      code, seat: result.seat ?? 0, reconnectToken: result.reconnectToken,
    }));
  }
  const route = game === 'domino' ? `/room/${code}`
    : game === 'tic-tac-toe' ? `/games/tic-tac-toe/${code}`
      : game === 'words' ? `/games/words/${code}`
        : `/games/${game}`;
  return { code, route };
}

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
  return <div className="yard-empty yard-empty-history" data-testid="empty-recent-matches">
    <div>
      <strong>No recorded matches yet</strong>
      <p>Your completed Domino matches will appear here.</p>
    </div>
    <button type="button" className="yard-button" onClick={onGames} data-testid="button-play-first-match">Find a game <ArrowUpRight size={14} /></button>
  </div>;
}

export default function SocialPage({ page }: { page: Destination }) {
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const auth = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey(), refetchOnWindowFocus: true } });
  const user = auth.data?.user;
  const signedIn = Boolean(user);
  const friendsQuery = useListFriends({ query: { queryKey: getListFriendsQueryKey(), enabled: signedIn, refetchInterval: 15000, refetchOnWindowFocus: true } });
  const lobby = useGetLobby({ query: { queryKey: getGetLobbyQueryKey(), refetchInterval: 15000, refetchOnWindowFocus: true } });
  const recent = useGetRecentMatches({ query: { queryKey: getRecentMatchesQueryKey(), enabled: signedIn, refetchOnWindowFocus: true } });
  const ticTacToeResults = useGetTicTacToeResults({ query: { queryKey: getGetTicTacToeResultsQueryKey(), enabled: signedIn, refetchOnWindowFocus: true } });
  const requestFriend = useCreateFriendRequest();
  const acceptRequest = useAcceptFriendRequest();
  const declineRequest = useDeclineFriendRequest();
  const acceptInvite = useAcceptFriendInvite();
  const dismissInvite = useDismissFriendInvite();
  const withdrawInvite = useWithdrawFriendInvite();
  const createFriendInvite = useCreateFriendInvite();
  const joinRoom = useJoinRoom();
  const joinTicTacToeRoom = useJoinTicTacToeRoom();
  const logout = useLogout();
  const [username, setUsername] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteGame, setInviteGame] = useState('domino');
  const [invitingFriendId, setInvitingFriendId] = useState<string | null>(null);
  const friendData = friendsQuery.data;
  const unreadSocial = (friendData?.requests.length ?? 0) + (friendData?.invites.length ?? 0);
  useEffect(() => {
    if (!signedIn) return;
    let closed = false;
    let retry: number | undefined;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (closed) return;
      socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws?lobby=1&clientId=${encodeURIComponent(getClientId())}`);
      socket.onopen = () => {
        void client.invalidateQueries({ queryKey: getListFriendsQueryKey() });
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string };
          if (message.type === 'roomInvite' || message.type === 'friendInviteUpdated' || message.type === 'friendRequest' || message.type === 'friendRequestUpdated') {
            void client.invalidateQueries({ queryKey: getListFriendsQueryKey() });
          }
        } catch {
          // Ignore unrelated malformed lobby events; the friends query remains the source of truth.
        }
      };
      socket.onclose = () => {
        if (!closed) retry = window.setTimeout(connect, 1200);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      socket?.close();
    };
  }, [client, signedIn]);
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
  const inviteFriendToGame = async (friendId: string) => {
    if (!user || invitingFriendId) return;
    setInvitingFriendId(friendId);
    setNotice('');
    try {
      const displayName = user.username.slice(0, 24);
      const room = await createInviteRoom(inviteGame, displayName);
      await createFriendInvite.mutateAsync({ data: { friendId, roomCode: room.code } });
      setLocation(room.route);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send that game invite.');
    } finally {
      setInvitingFriendId(null);
    }
  };
  const joinInvite = (id: string) => acceptInvite.mutate({ id }, {
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: getListFriendsQueryKey() });
      const displayName = user?.username ?? 'Guest';
      if (result.game === 'word-yard') {
        void fetch(`/api/word-yard/rooms/${encodeURIComponent(result.roomCode)}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ displayName }),
        }).then(async (response) => {
          if (!response.ok) throw new Error('Invite accepted, but the Word Yard room could not be joined.');
          const room = await response.json() as { room: { code: string }; reconnectToken: string };
          sessionStorage.setItem(`word-yard-reconnect-${room.room.code}`, room.reconnectToken);
          sessionStorage.setItem(`word-yard-display-name-${room.room.code}`, displayName);
          setLocation(`/games/words/${room.room.code}`);
        }).catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : 'Invite accepted, but the Word Yard room could not be joined.');
        });
        return;
      }
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
      if (arcadeGameIds.has(result.game)) {
        void fetch(`/api/arcade/rooms/${encodeURIComponent(result.roomCode)}/join`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-lakou-client': 'lakou' },
          body: JSON.stringify({ displayName }),
        }).then(async (response) => {
          const room = await response.json() as { code?: string; seat?: number; reconnectToken?: string; error?: string };
          if (!response.ok) throw new Error(room.error || 'Invite accepted, but the game room could not be joined.');
          if (!room.code || !room.reconnectToken) throw new Error('The room did not issue access details.');
          sessionStorage.setItem(`509-yard-arcade-room:${result.game}`, JSON.stringify({
            code: room.code, seat: room.seat ?? 1, reconnectToken: room.reconnectToken,
          }));
          setLocation(`/games/${result.game}`);
        }).catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : 'Invite accepted, but the game room could not be joined.');
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
  const subtitle = page === 'home' ? 'Find your crew, jump into a match, and see who takes the points.' : page === 'games' ? 'Find a live match or create a private room for any game.' : page === 'friends' ? 'Keep your people close and find who is around.' : page === 'leaderboard' ? 'The standings from games played across the yard.' : 'Your Domino record and recent results.';
  const recentMatches = recent.data?.matches ?? [];
  const friendRows = friendData?.friends ?? [];
  const gameCatalog = [
    { name: 'Domino', slug: 'domino', description: 'Live tables · Regular and Points', online: true },
    { name: 'Tic-Tac-Toe', slug: 'tic-tac-toe', description: 'Regular and Yard Mode', online: true },
    { name: 'Mòpyon', slug: 'mopyon', description: 'Five in a row', online: true },
    { name: 'Box', slug: 'box', description: 'Dots and Boxes', online: true },
    { name: 'Kay', slug: 'kay', description: 'Mancala-style seed game', online: true },
    { name: 'Chess', slug: 'chess', description: 'Classic chess', online: true },
    { name: 'Dame', slug: 'dame', description: 'Checkers', online: true },
    { name: 'Word Yard', slug: 'words', description: 'Multiplayer word game', online: true },
    { name: 'Scrabble', slug: 'scrabble', description: 'Build words · 2–4 players', online: true },
    { name: 'Barricade', slug: 'barricade', description: 'Race and block the path', online: true },
    { name: 'Four in a Row', slug: 'four-in-a-row', description: 'Connect four pieces', online: true },
    { name: 'Filler', slug: 'filler', description: 'Claim more of the board', online: true },
    { name: 'Block Drop', slug: 'block-drop', description: 'Live race · Score challenge', online: true },
  ];
   const goGames = () => setLocation('/games/domino');
  const recentMatchLabel = (mode: string) => {
    if (!mode.startsWith('arcade:')) return mode === 'points' ? 'Points' : 'Regular';
    const slug = mode.slice('arcade:'.length);
    return `${gameCatalog.find((game) => game.slug === slug)?.name ?? slug} · Online`;
  };
  const renderHistory = () => {
     if (!signedIn) return <div className="yard-empty" data-testid="empty-history-sign-in"><strong>Sign in to see your match history</strong><p>Recorded results belong to your 509 Yard account. Sign in to see your recent games and standings.</p><Link href="/sign-in" className="yard-button primary" data-testid="link-history-sign-in">Sign in</Link></div>;
    if (recent.isLoading) return <div className="yard-loading" data-testid="loading-recent-matches"><i className="yard-skeleton" /><i className="yard-skeleton" /><i className="yard-skeleton" /></div>;
    if (recent.isError) return <div className="yard-empty" role="alert" data-testid="error-recent-matches"><strong>Match history is unavailable</strong><p>We couldn't load your recorded matches.</p><button className="yard-button" onClick={() => void recent.refetch()} data-testid="button-retry-history">Try again</button></div>;
    if (!recentMatches.length) return <EmptyHistory onGames={goGames} />;
    return <div className="yard-history-list">{recentMatches.slice(0, 6).map((match) => <div className="yard-history-row" key={match.matchId} data-testid={`match-${match.matchId}`}>
      <span className="yard-result-mark">{match.rank ? `#${match.rank}` : '—'}</span>
       <span><b>{match.won ? 'Victory' : `${match.medal || 'Match'} finish`}</b><small>{recentMatchLabel(match.mode)} · Table {match.roomCode} · {new Date(match.recordedAt).toLocaleDateString()}</small></span>
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
      {friendData?.sentInvites.length ? <div className="yard-section-space"><p className="yard-kicker">Invites you sent · {friendData.sentInvites.length}</p>{friendData.sentInvites.map((invite) => {
        const gameName = gameCatalog.find((game) => game.slug === invite.game || (game.slug === 'words' && invite.game === 'word-yard'))?.name ?? invite.game;
        return <div className="yard-friend-row" key={invite.id} data-testid={`sent-friend-invite-${invite.id}`}><span className="yard-avatar">{initials(invite.inviteeName)}</span><span style={{ flex: 1 }}><b>{invite.inviteeName}</b><small>Pending {gameName} invite · {invite.roomCode}</small></span><button className="yard-small-button" disabled={withdrawInvite.isPending} onClick={() => withdrawInvite.mutate({ id: invite.id }, { onSuccess: () => void client.invalidateQueries({ queryKey: getListFriendsQueryKey() }), onError: () => setNotice('Could not withdraw that pending invite.') })} data-testid={`withdraw-friend-invite-${invite.id}`}>Withdraw</button></div>;
      })}</div> : null}
      {friendData?.invites.length ? <div className="yard-section-space"><p className="yard-kicker">Game invitations · {friendData.invites.length}</p>{friendData.invites.map((invite) => {
        const gameName = gameCatalog.find((game) => game.slug === invite.game || (game.slug === 'words' && invite.game === 'word-yard'))?.name ?? invite.game;
        return <div className="yard-friend-row" key={invite.id} data-testid={`friend-invite-${invite.id}`}><span className="yard-avatar">{initials(invite.inviterName)}</span><span style={{ flex: 1 }}><b>{invite.inviterName}</b><small>Invited you to {gameName} · {invite.roomCode}</small></span><span className="yard-list-actions"><button className="yard-small-button" onClick={() => joinInvite(invite.id)} data-testid={`join-invite-${invite.id}`}>Join</button><button className="yard-small-button" disabled={dismissInvite.isPending} onClick={() => dismissInvite.mutate({ id: invite.id }, { onSuccess: () => void client.invalidateQueries({ queryKey: getListFriendsQueryKey() }) })} data-testid={`dismiss-invite-${invite.id}`}>Dismiss</button></span></div>;
      })}</div> : null}
      <div className="yard-section-space">
        <p className="yard-kicker">Your friends · {friendRows.length}</p>
        {friendRows.length ? <>
          <label className="yard-input-row" style={{ marginBottom: 8 }}>
            <span className="yard-sr-only">Choose a game to invite friends to</span>
            <select className="yard-input" aria-label="Game to invite to" value={inviteGame} onChange={(event) => setInviteGame(event.target.value)} data-testid="select-invite-game">
              {gameCatalog.map((game) => <option key={game.slug} value={game.slug}>{game.name}</option>)}
            </select>
          </label>
          {friendRows.map((friend) => <div className="yard-friend-row" key={friend.id} data-testid={`friend-${friend.id}`}>
            <span className="yard-avatar">{initials(friend.username)}</span>
            <span style={{ flex: 1 }}><b>{friend.username}</b><small className="yard-presence"><i style={{ background: friend.status ? 'var(--yard-accent)' : '#66676c' }} />{presenceText(friend.status?.status, friend.status?.detail)}</small></span>
            <span className="yard-list-actions">
              {friend.status?.status === 'game' && friend.status.roomCode && <Link
                className="yard-small-button"
                href={friend.status.game === 'tic-tac-toe' ? `/games/tic-tac-toe/${friend.status.roomCode}?watch=1` : `/room/${friend.status.roomCode}`}
                data-testid={`watch-friend-${friend.id}`}
              >Watch</Link>}
              <button className="yard-small-button" disabled={Boolean(invitingFriendId)} onClick={() => void inviteFriendToGame(friend.id)} data-testid={`invite-friend-${friend.id}`}>{invitingFriendId === friend.id ? 'Inviting…' : 'Invite'}</button>
            </span>
          </div>)}
        </> : <div className="yard-empty"><strong>Start your circle</strong><p>Add a username above to find a friend and invite them to the next table.</p></div>}
      </div>
    </>;
  };
  return <div className="yard-app">
    <YardHeader active={page} username={user?.username} notifications={unreadSocial} onLogout={handleLogout} />
    <main className="yard-main">
      {notice && <div className="yard-notice" role="status" data-testid="status-social-notice">{notice}</div>}
      <div className={`yard-heading${page === 'home' ? ' yard-home-heading' : ''}`}><div>{page !== 'home' && <p className="yard-kicker">509 YARD / {page.toUpperCase()}</p>}<h1>{title}</h1><p className="yard-subtitle">{subtitle}</p></div>
        {page === 'home' ? <div className="yard-intro-actions"><Link className="yard-button primary" href="/games" data-testid="button-explore-games"><Gamepad2 size={15} /> Browse games</Link><Link className="yard-button" href="/friends" data-testid="button-find-friends">Find your crew</Link></div> : page === 'games' && <Link className="yard-button primary" href="/games/domino" data-testid="button-play-lakou"><Gamepad2 size={15} /> Play Domino</Link>}
      </div>
      {page === 'home' && <>
        <div className="yard-home-grid">
          <Panel title="Recent matches" action={<Link href="/profile" className="yard-panel-link" data-testid="link-all-matches">Match history</Link>}>
            {renderHistory()}
          </Panel>
          <Panel title="Available games" action={<Link href="/games" className="yard-panel-link yard-games-all-link">All games <ArrowUpRight size={12} /></Link>}>
            <div className="yard-home-game-list">
              {gameCatalog.slice(0, 4).map((game) => <Link key={game.slug} href={`/games/${game.slug}`} className="yard-game-card" data-testid={`home-game-${game.slug}`}>
                <span className="yard-game-card-mark"><GameIcon slug={game.slug} /></span>
                <span className="yard-game-card-copy"><strong>{game.name}</strong><small>{game.description}</small></span>
                <span className={`yard-game-badge${game.online ? ' is-online' : ''}`}>{game.online ? 'Online' : 'Local'}</span>
              </Link>)}
            </div>
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
      {page === 'games' && <div className="yard-dashboard-grid yard-games-dashboard">
        <div><section className="yard-featured-game"><div><p className="yard-kicker">AVAILABLE NOW</p><h2 className="yard-game-title">Domino</h2><p className="yard-game-copy">Classic table play with Regular and Points modes, live matchmaking, private rooms, and friends.</p><Link className="yard-button primary" href="/games/domino" data-testid="button-play-lakou-card"><Gamepad2 size={15} /> Play now</Link></div><div className="yard-domino-mark" aria-hidden="true"><img src="/domino-logo.webp" alt="" /></div></section>
             <section className="yard-panel yard-section-space"><div className="yard-panel-body"><p className="yard-kicker">THE GAME YARD</p><h2 style={{ fontSize: 17, margin: '0 0 8px' }}>Choose a game</h2><p className="yard-subtitle" style={{ margin: 0 }}>Online rooms are available for Domino, Tic-Tac-Toe, and Word Yard. The rest are ready for local play.</p>
              <div className="yard-game-foundation-list">
                  {gameCatalog.filter((game) => game.slug !== 'domino').map((game) => <Link key={game.slug} href={`/games/${game.slug}`} className="yard-game-card" data-testid={`game-card-${game.slug}`}>
                    <span className="yard-game-card-mark"><GameIcon slug={game.slug} /></span>
                    <span className="yard-game-card-copy"><strong>{game.name}</strong><small>{game.description}</small></span>
                    <span className={`yard-game-badge${game.online ? ' is-online' : ''}`}>{game.online ? 'Online' : 'Local'}</span>
                  </Link>)}
              </div>
            </div></section>
        </div>
        <Panel title="Live activity"><div className="yard-metric"><b>{lobby.data?.onlinePlayers ?? '—'}</b><span>Players in the yard</span></div><p className="yard-subtitle">Open the Domino lobby to browse live tables or start a match.</p></Panel>
      </div>}
      {page === 'friends' && <div className="yard-dashboard-grid"><Panel title="Your circle" action={<span className="yard-status">{signedIn ? `${friendRows.length} friends` : 'Sign in required'}</span>}>{renderFriends()}</Panel>
        <div className="yard-side-stack"><Panel title="Table activity"><p className="yard-subtitle" style={{ margin: 0 }}>See who's online, send table invitations, and jump into games with friends.</p><Link href="/games" className="yard-button yard-section-space" data-testid="button-open-game-lobby">Choose a game</Link></Panel><Panel title="Messages"><div className="yard-empty"><strong>Keep the conversation in your game</strong><p>Messages are available inside live game rooms.</p><Link href="/games" className="yard-panel-link">Choose a game</Link></div></Panel></div>
      </div>}
      {page === 'leaderboard' && <Panel title="Crown points" action={<span className="yard-status">Domino · Points mode</span>}>
        {lobby.isLoading ? <div className="yard-loading"><i className="yard-skeleton" /><i className="yard-skeleton" /><i className="yard-skeleton" /></div> : lobby.isError ? <div className="yard-empty" role="alert"><strong>Standings unavailable</strong><p>We couldn't load the live leaderboard.</p><button className="yard-button" onClick={() => void lobby.refetch()}>Try again</button></div> : leaderRows.length ? <div className="yard-rows">{leaderRows.map((row, index) => <div className="yard-rank-row" key={row.id} data-testid={`leaderboard-row-${row.id}`}><b>{String(index + 1).padStart(2, '0')}</b><span>{row.name}{row.isMe ? ' (you)' : ''}</span><strong>{row.points.toLocaleString()} CP</strong></div>)}</div> : <div className="yard-empty"><Trophy size={20} color="var(--yard-accent)" /><strong>No standings yet</strong><p>Points games against real players earn crown points. Start a match to join the board.</p><Link className="yard-button primary" href="/games/domino">Play Points</Link></div>}
      </Panel>}
      {page === 'profile' && <>{!signedIn ? <Panel title="Your 509 Yard account"><div className="yard-empty"><strong>Sign in to see your profile</strong><p>Your record and recorded matches are attached to your account. Sign in to view them here.</p><Link href="/sign-in" className="yard-button primary" data-testid="link-profile-sign-in">Sign in</Link></div></Panel> : <>
        <Panel title="Player card"><div className="yard-profile-card"><span className="yard-avatar">{initials(user?.username ?? '')}</span><span><p className="yard-kicker">PLAYER</p><h2 style={{ margin: 0, fontSize: 20 }}>{user?.username}</h2><small className="yard-status">509 Yard account</small></span></div></Panel>
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
      <footer className="yard-section-space" style={{ color: 'var(--yard-muted)', fontSize: 10 }}><CircleHelp size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />509 Yard · Domino is the first game. <Link href="/how-to-play" className="yard-panel-link" style={{ marginLeft: 6 }}>How to play</Link><Link href="/about" className="yard-panel-link" style={{ marginLeft: 12 }}>About & credits</Link></footer>
    </main>
  </div>;
}
