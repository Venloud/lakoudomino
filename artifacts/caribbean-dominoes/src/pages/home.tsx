import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  getGetAuthMeQueryKey,
  getGetLobbyQueryKey,
  getListFriendsQueryKey,
  useAcceptFriendInvite,
  useAcceptFriendRequest,
  useCreateFriendInvite,
  useCreateFriendRequest,
  useCreateRoom,
  useDeclineFriendRequest,
  useDismissFriendInvite,
  useGetAuthMe,
  useGetLobby,
  useJoinRoom,
  useListFriends,
  useLogout,
} from '@workspace/api-client-react';
import { LobbyScreen, type Friend as KitFriend, type FriendRequest, type LobbyMode, type OpenTableOptions, type PlayNowQueueProps, type Profile } from '../../../../lakou-engine/ui';
import type { QueueStatus } from 'lakou-engine';
import { getClientId, getGuestName, saveGuestName } from '@/lib/lakou-session';

const displayNameKey = (code: string) => `dominoes-display-name-${code}`;
const tokenKey = (code: string) => `dominoes-reconnect-${code}`;
const hostTokenKey = (code: string) => `dominoes-host-token-${code}`;
const hostKey = (code: string) => `dominoes-host-${code}`;
const lobbyNoticeKey = 'lakou-lobby-notice';

function socketUrl(path: string) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
}

export default function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState(() => sessionStorage.getItem(lobbyNoticeKey) ?? '');
  const [socketConnected, setSocketConnected] = useState(false);
  const [playNowStatus, setPlayNowStatus] = useState<QueueStatus | null>(null);
  const pendingPlayNow = useRef<LobbyMode | null>(null);
  const lobbySocket = useRef<WebSocket | null>(null);
  const [liveInvites, setLiveInvites] = useState<{ id: string; roomCode: string }[]>([]);
  const auth = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey(), refetchOnWindowFocus: true } });
  const signedIn = Boolean(auth.data?.user);
  const lobby = useGetLobby({
    query: { queryKey: getGetLobbyQueryKey(), refetchInterval: 15000, refetchOnWindowFocus: true },
  });
  const friendsQuery = useListFriends({
    query: { queryKey: getListFriendsQueryKey(), enabled: signedIn, refetchOnWindowFocus: true },
  });
  const createRoom = useCreateRoom();
  const joinRoom = useJoinRoom();
  const logout = useLogout();
  const addFriend = useCreateFriendRequest();
  const acceptRequest = useAcceptFriendRequest();
  const declineRequest = useDeclineFriendRequest();
  const inviteFriend = useCreateFriendInvite();
  const acceptInvite = useAcceptFriendInvite();
  const dismissInvite = useDismissFriendInvite();
  const [guestName, setGuestName] = useState(getGuestName());

  const refreshSocial = () => {
    void queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListFriendsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetAuthMeQueryKey() });
  };

  useEffect(() => {
    const clientId = getClientId();
    const pendingNotice = sessionStorage.getItem(lobbyNoticeKey);
    if (pendingNotice) {
      setNotice(pendingNotice);
      sessionStorage.removeItem(lobbyNoticeKey);
    }
    let closed = false;
    let retry: number | undefined;
    let ws: WebSocket | null = null;
    const connect = () => {
      if (closed) return;
      const connection = new WebSocket(socketUrl(`/ws?lobby=1&clientId=${encodeURIComponent(clientId)}`));
      ws = connection;
      lobbySocket.current = connection;
      connection.onopen = () => {
        setSocketConnected(true);
        refreshSocial();
        const queuedMode = sessionStorage.getItem('lakou-play-now');
        if (queuedMode === 'regular' || queuedMode === 'points') {
          sessionStorage.removeItem('lakou-play-now');
          pendingPlayNow.current = queuedMode;
        }
      };
      connection.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            type?: string;
            id?: string;
            roomCode?: string;
            reconnectToken?: string;
            displayName?: string;
            isHost?: boolean;
            status?: QueueStatus | null;
            message?: string;
            tables?: typeof lobby.data extends infer T ? T extends { tables: infer R } ? R : never : never;
            onlinePlayers?: number;
            tablesPlaying?: number;
          };
          if (message.type === 'queueStatus') setPlayNowStatus(message.status ?? null);
          if (message.type === 'queueError') {
            setPlayNowStatus(null);
            setNotice(message.message || 'The Play now queue could not be updated.');
          }
          if (message.type === 'queueMatch') {
            if (!message.roomCode || !message.reconnectToken) {
              setPlayNowStatus(null);
              setNotice('The match was found, but the table could not be opened.');
            } else {
              setPlayNowStatus(null);
              enterRoom(
                message.roomCode,
                message.reconnectToken,
                message.displayName || defaultName || 'Guest',
                Boolean(message.isHost),
              );
            }
          }
          if (message.type === 'lobbyUpdate') {
            queryClient.setQueryData(getGetLobbyQueryKey(), (current: typeof lobby.data) => current ? ({
              ...current,
              tables: message.tables ?? current.tables,
              onlinePlayers: message.onlinePlayers ?? current.onlinePlayers,
              tablesPlaying: message.tablesPlaying ?? current.tablesPlaying,
              connected: true,
            }) : current);
          }
          if (message.type === 'roomInvite' && message.id && message.roomCode) {
            setLiveInvites((current) => current.some((invite) => invite.id === message.id)
              ? current
              : [...current, { id: message.id!, roomCode: message.roomCode! }]);
          }
          if (message.type === 'presenceChanged' || message.type === 'friendRequest' || message.type === 'friendRequestUpdated' || message.type === 'roomInvite') {
            void queryClient.invalidateQueries({ queryKey: getListFriendsQueryKey() });
          }
        } catch {
          setNotice('The live lobby sent an unreadable update. Refresh to reconnect.');
        }
      };
      connection.onclose = () => {
        if (lobbySocket.current === connection) lobbySocket.current = null;
        setSocketConnected(false);
        if (!closed) retry = window.setTimeout(connect, 1400);
      };
    };
    const onFocus = () => refreshSocial();
    connect();
    window.addEventListener('focus', onFocus);
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      window.removeEventListener('focus', onFocus);
      ws?.close();
      if (lobbySocket.current === ws) lobbySocket.current = null;
    };
  }, [queryClient]);

  const profile = useMemo<Profile | null>(() => {
    const user = auth.data?.user;
    if (!user) return null;
    return {
      name: user.username,
      crownPoints: user.crownPoints,
      gold: user.gold,
      silver: user.silver,
      bronze: user.bronze,
      games: user.games,
      wins: user.wins,
      socials: [],
    };
  }, [auth.data?.user]);

  const friendViews = useMemo<KitFriend[]>(() => (friendsQuery.data?.friends ?? []).map((friend) => ({
    id: friend.id,
    name: friend.username,
    status: friend.status?.status ?? 'offline',
    detail: friend.status?.detail,
  })), [friendsQuery.data?.friends]);
  const requests = useMemo<FriendRequest[]>(() => (friendsQuery.data?.requests ?? []).map((request) => ({
    id: request.id, name: request.username,
  })), [friendsQuery.data?.requests]);
  const invites = useMemo(() => {
    const fromApi = friendsQuery.data?.invites ?? [];
    const known = new Set(fromApi.map((invite) => invite.id));
    return [
      ...fromApi,
      ...liveInvites.filter((invite) => !known.has(invite.id)).map((invite) => ({
        id: invite.id,
        inviterId: '',
        inviterName: 'A friend',
        roomCode: invite.roomCode,
        status: 'pending' as const,
      })),
    ];
  }, [friendsQuery.data?.invites, liveInvites]);
  const defaultName = profile?.name ?? guestName;

  const onPlayNow = (mode: LobbyMode) => {
    const socket = lobbySocket.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setNotice('The live lobby is reconnecting. Try Play now again in a moment.');
      return;
    }
    const name = (profile?.name || guestName || 'Guest').trim().slice(0, 24);
    if (!profile) setGuestName(saveGuestName(name));
    setNotice('');
    socket.send(JSON.stringify({ type: 'playNow', mode, displayName: name }));
  };

  useEffect(() => {
    if (!pendingPlayNow.current || !lobbySocket.current || lobbySocket.current.readyState !== WebSocket.OPEN) return;
    const mode = pendingPlayNow.current;
    pendingPlayNow.current = null;
    onPlayNow(mode);
  });

  const cancelPlayNow = () => {
    const socket = lobbySocket.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'leaveQueue' }));
    }
    setPlayNowStatus(null);
  };

  const toggleBots = (botsOk: boolean) => {
    if (lobbySocket.current?.readyState === WebSocket.OPEN) {
      lobbySocket.current.send(JSON.stringify({ type: 'toggleBots', botsOk }));
    }
  };

  const startNow = () => {
    if (lobbySocket.current?.readyState === WebSocket.OPEN) {
      lobbySocket.current.send(JSON.stringify({ type: 'startNow' }));
    }
  };

  const goHome = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    refreshSocial();
  };

  const enterRoom = (code: string, reconnectToken: string, displayName: string, isHost: boolean) => {
    sessionStorage.setItem(tokenKey(code), reconnectToken);
    sessionStorage.setItem(displayNameKey(code), displayName);
    sessionStorage.removeItem(hostTokenKey(code));
    sessionStorage.removeItem(hostKey(code));
    if (isHost) {
      sessionStorage.setItem(hostTokenKey(code), reconnectToken);
      sessionStorage.setItem(hostKey(code), displayName);
    }
    setLocation(`/room/${code}`);
  };

  const createTable = (options: OpenTableOptions, startWithBots = false) => {
    setNotice('');
    const displayName = (profile?.name || options.name || guestName || 'Guest').trim().slice(0, 24);
    if (!profile) {
      setGuestName(saveGuestName(displayName));
    }
    createRoom.mutate({
      data: {
        displayName, mode: options.mode, rowLength: options.rowBoxes, rowBoxes: options.rowBoxes,
        playerCount: 4, twoPlayerVariant: 'draw', turnSeconds: options.turnSeconds, isPrivate: options.private,
      },
    }, {
      onSuccess: async (room) => {
        if (!room.reconnectToken) {
          setNotice('The table opened without a reconnect token. Please try again.');
          return;
        }
        if (startWithBots) {
          try {
            await fetch(`/api/rooms/${room.code}/bots`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reconnectToken: room.reconnectToken }) });
            await fetch(`/api/rooms/${room.code}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reconnectToken: room.reconnectToken }) });
          } catch {
            setNotice('The practice table opened, but the match could not start.');
          }
        }
        enterRoom(room.code, room.reconnectToken, displayName, true);
      },
      onError: () => setNotice('That table could not be opened. Try once more.'),
    });
  };

  const joinTable = (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    const name = (profile?.name || guestName || 'Guest').slice(0, 24);
    if (!code || code.length < 3) {
      setNotice('Enter a valid table code.');
      return;
    }
    if (!profile) setGuestName(saveGuestName(name));
    joinRoom.mutate({ code, data: { displayName: name } }, {
      onSuccess: (room) => room.reconnectToken
        ? enterRoom(room.code, room.reconnectToken, name, false)
        : setNotice('The table did not issue a reconnect token. Please try again.'),
      onError: () => setNotice('We could not find that table. Check the code and try again.'),
    });
  };

  const inviteFriendToTable = (friendId: string) => {
    if (!profile) {
      setNotice('Sign in to invite friends to a private table.');
      return;
    }
    const name = profile.name.slice(0, 24);
    setNotice('Opening a private table for your invite…');
    createRoom.mutate({
      data: {
        displayName: name, mode: 'regular', rowLength: 10, rowBoxes: 10,
        playerCount: 4, twoPlayerVariant: 'draw', turnSeconds: 30, isPrivate: true,
      },
    }, {
      onSuccess: (room) => {
        if (!room.reconnectToken) {
          setNotice('The table opened without a reconnect token. Please try again.');
          return;
        }
        inviteFriend.mutate({ data: { friendId, roomCode: room.code } }, {
          onSuccess: () => {
            setNotice('Invite sent. Your private table is ready.');
            enterRoom(room.code, room.reconnectToken!, name, true);
          },
          onError: () => setNotice('The table opened, but the invite could not be sent.'),
        });
      },
      onError: () => setNotice('That private table could not be opened. Try once more.'),
    });
  };

  const acceptRoomInvite = (id: string) => {
    acceptInvite.mutate({ id }, {
      onSuccess: (result) => {
        setLiveInvites((current) => current.filter((invite) => invite.id !== id));
        const name = profile?.name || 'Guest';
        joinRoom.mutate({ code: result.roomCode, data: { displayName: name } }, {
          onSuccess: (room) => {
            if (!room.reconnectToken) {
              setNotice('The invite was accepted, but the table did not issue a reconnect token.');
              return;
            }
            enterRoom(room.code, room.reconnectToken, name, false);
          },
          onError: () => setNotice('The invite was accepted, but we could not join the table.'),
        });
      },
      onError: () => setNotice('That invite is no longer available.'),
    });
  };

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetAuthMeQueryKey(), { user: null });
        queryClient.removeQueries({ queryKey: getListFriendsQueryKey() });
        setNotice('You are signed out. Your guest name is still saved on this device.');
      },
      onError: () => setNotice('Could not sign out. Try again.'),
    });
  };

  const openTables = (lobby.data?.tables ?? []).map((room) => ({
    code: room.code,
    name: `${room.hostName}'s table`,
    mode: room.mode,
    seats: room.seats.filter((seat) => seat.status !== 'open').length,
    maxSeats: room.playerCount ?? 4,
    rowBoxes: room.rowBoxes ?? room.rowLength,
    turnSeconds: room.turnSeconds ?? 30,
  }));

  return (
    <>
      <LobbyScreen
        profile={profile}
        defaultName={defaultName || undefined}
        onlinePlayers={lobby.data?.onlinePlayers ?? 0}
        tablesPlaying={lobby.data?.tablesPlaying ?? 0}
        connected={socketConnected && !lobby.isError}
        leaderboard={lobby.data?.leaderboard ?? []}
        openTables={openTables}
        onJoinTable={joinTable}
        onPlayNow={onPlayNow}
        queue={playNowStatus ? {
          mode: playNowStatus.mode,
          found: playNowStatus.found,
          needed: playNowStatus.needed,
          botsAt: playNowStatus.botsAt,
          waitedMs: playNowStatus.waitedMs,
          onCancel: cancelPlayNow,
          onToggleBots: toggleBots,
          onStartNow: startNow,
        } satisfies PlayNowQueueProps : null}
        onOpenTable={(options) => createTable(options)}
        onSignIn={() => setLocation('/sign-in')}
        onSignUp={() => setLocation('/sign-up')}
        onHome={goHome}
        onHowToPlay={() => setLocation('/how-to-play')}
        onPlayFriends={() => createTable({ name: defaultName || 'Guest', mode: 'regular', rowBoxes: 10, turnSeconds: 30, private: true })}
        onPracticeBots={() => createTable({ name: defaultName || 'Guest', mode: 'regular', rowBoxes: 10, turnSeconds: 30, private: true }, true)}
        onProfileMenu={handleLogout}
        onEditProfile={() => setNotice('Your username and record come from your Lakou account.')}
        friends={signedIn ? friendViews : []}
        requests={signedIn ? requests : []}
        onAddFriend={(username) => addFriend.mutate({ data: { username } }, { onSuccess: refreshSocial, onError: () => setNotice('We could not send that friend request.') })}
        onAcceptFriend={(id) => acceptRequest.mutate({ id }, { onSuccess: refreshSocial, onError: () => setNotice('That friend request could not be accepted.') })}
        onDeclineFriend={(id) => declineRequest.mutate({ id }, { onSuccess: refreshSocial, onError: () => setNotice('That friend request could not be declined.') })}
        onInviteFriend={inviteFriendToTable}
        onWatchFriend={(id) => {
          const friend = friendsQuery.data?.friends.find((entry) => entry.id === id);
          if (friend?.status?.status === 'game' && friend.status.roomCode) setLocation(`/room/${friend.status.roomCode}`);
        }}
      />
      {signedIn && invites.length > 0 && (
        <div className="social-notices" aria-live="polite">
          {invites.map((invite) => (
            <div className="social-notice" key={invite.id} data-testid={`invite-${invite.id}`}>
              <div className="social-notice-copy"><b>{invite.inviterName} invited you to a table</b><span>Table code: {invite.roomCode}</span></div>
              <div className="social-notice-actions">
                <button type="button" data-testid={`accept-invite-${invite.id}`} onClick={() => acceptRoomInvite(invite.id)} disabled={acceptInvite.isPending || joinRoom.isPending}>Join table</button>
                <button type="button" data-testid={`dismiss-invite-${invite.id}`} onClick={() => dismissInvite.mutate({ id: invite.id }, { onSuccess: () => { setLiveInvites((current) => current.filter((item) => item.id !== invite.id)); refreshSocial(); } })}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {notice && <p className="app-notice" role="alert" data-testid="lobby-notice">{notice}</p>}
    </>
  );
}