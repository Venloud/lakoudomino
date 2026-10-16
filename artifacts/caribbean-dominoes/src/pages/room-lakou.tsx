import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAuthMeQueryKey,
  getGetRoomQueryKey,
  getListFriendsQueryKey,
  useCreateFriendInvite,
  useGetAuthMe,
  useGetRoom,
  useListFriends,
} from '@workspace/api-client-react';
import type { Action, PlayerView } from 'lakou-engine';
import { LakouGame } from '../../../../lakou-engine/ui/GameScreen';
import { WaitingRoom, type ChatMessage, type Friend as KitFriend, type WaitingSeat, type WaitlistEntryView } from '../../../../lakou-engine/ui';
import { getClientId } from '@/lib/lakou-session';

type SocketSnapshot = {
  view: (PlayerView & { engine: 'lakou' }) | null;
  events?: any[];
  eventsKey?: number;
  turnDeadline?: number | null;
  turnMs?: number | null;
  nextHandAt?: number | null;
  roomSettings?: {
    mode: 'regular' | 'points';
    rowBoxes: number;
    turnSeconds: number;
    isPrivate: boolean;
    playerCount: number;
  } | null;
  viewerId?: string | null;
  playNow?: boolean;
  waitlist?: {
    entries?: { id: string; name: string }[];
    meId?: string | null;
    notify?: boolean;
  };
};
const tokenKey = (code: string) => `dominoes-reconnect-${code}`;
const nameKey = (code: string) => `dominoes-display-name-${code}`;
const hostTokenKey = (code: string) => `dominoes-host-token-${code}`;
const waitlistTokenKey = (code: string) => `dominoes-waitlist-token-${code}`;
const waitlistNotifyKey = (code: string) => `dominoes-waitlist-notify-${code}`;

async function roomRequest(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || 'Request failed');
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function socketEventForAction(action: Action) {
  if (action.type !== 'play') return { type: action.type };
  const side = ({
    W: 'left',
    E: 'right',
    N: 'top',
    S: 'bottom',
    center: 'left',
  } as const)[action.arm];
  return { type: 'play' as const, tileId: `${action.tile[0]}-${action.tile[1]}`, side };
}

export default function RoomPage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = (raw || '').toUpperCase();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const auth = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey() } });
  const friendsQuery = useListFriends({ query: { queryKey: getListFriendsQueryKey(), enabled: Boolean(auth.data?.user) } });
  const createFriendInvite = useCreateFriendInvite();
  const roomQuery = useGetRoom(code, { query: { queryKey: getGetRoomQueryKey(code), refetchInterval: 4000 } });
  const room = roomQuery.data;
  const [snapshot, setSnapshot] = useState<SocketSnapshot | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [offer, setOffer] = useState<any>(null);
  const [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const viewerId = useRef<string | null>(null);
  const [seatToken, setSeatToken] = useState<string | null>(() => sessionStorage.getItem(tokenKey(code)));
  const [waitlistToken, setWaitlistToken] = useState<string | null>(() => sessionStorage.getItem(waitlistTokenKey(code)));
  const [pendingNotify, setPendingNotify] = useState(() => sessionStorage.getItem(waitlistNotifyKey(code)) === 'true');
  const displayName = sessionStorage.getItem(nameKey(code)) || sessionStorage.getItem('lakou-display-name') || 'Guest';
  const activeToken = seatToken || waitlistToken;
  const host = Boolean(seatToken && sessionStorage.getItem(hostTokenKey(code)) === seatToken);
  const roomFriends = useMemo<KitFriend[]>(() => (friendsQuery.data?.friends ?? []).map((friend) => ({
    id: friend.id,
    name: friend.username,
    status: friend.status?.status ?? 'offline',
    detail: friend.status?.detail,
  })), [friendsQuery.data?.friends]);

  const inviteFriend = (friendId: string) => {
    createFriendInvite.mutate({ data: { friendId, roomCode: code } }, {
      onSuccess: () => setError('Invite sent.'),
      onError: () => setError('That friend could not be invited right now.'),
    });
  };

  useEffect(() => {
    setSeatToken(sessionStorage.getItem(tokenKey(code)));
    setWaitlistToken(sessionStorage.getItem(waitlistTokenKey(code)));
    setPendingNotify(sessionStorage.getItem(waitlistNotifyKey(code)) === 'true');
    setSnapshot(null);
    setChat([]);
    viewerId.current = null;
    setOffer(null);
    setError('');
  }, [code]);

  useEffect(() => {
    if (!room) return;
    let closed = false; let retry: number | undefined;
    const connect = () => {
      if (closed) return;
       const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?code=${encodeURIComponent(code)}&clientId=${encodeURIComponent(getClientId())}`);
      socket.current = ws;
       ws.onopen = () => {
         void queryClient.invalidateQueries({ queryKey: getListFriendsQueryKey() });
         ws?.send(JSON.stringify(
           activeToken
             ? { type: 'hello', reconnectToken: activeToken, displayName }
             : { type: 'hello', displayName },
         ));
       };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'snapshot') {
            viewerId.current = typeof message.viewerId === 'string' ? message.viewerId : null;
            setSnapshot(message);
            if (message.view) setError('');
          }
          if (message.type === 'chat' && message.message) {
            const incoming = message.message as ChatMessage & { senderId?: string };
            setChat((current) => [...current.slice(-49), {
              ...incoming,
              mine: Boolean(viewerId.current && incoming.senderId === viewerId.current),
            }]);
          }
          if (message.type === 'seatOffer' || message.type === 'offer') setOffer(message);
          if (message.type === 'queueing') setLocation('/');
          if (message.type === 'afkReplaced') {
            sessionStorage.setItem('lakou-lobby-notice', message.message || 'A bot took your seat, and you are being returned to the lobby.');
            sessionStorage.removeItem(tokenKey(code));
            sessionStorage.removeItem(hostTokenKey(code));
            sessionStorage.removeItem(waitlistTokenKey(code));
            setLocation('/');
          }
          if (message.type === 'error') {
            const messageText = message.message || 'The table rejected that request.';
            if (!seatToken && waitlistToken && messageText.includes('reconnect token is not valid')) {
              sessionStorage.removeItem(waitlistTokenKey(code));
              setWaitlistToken(null);
              setError('');
            } else {
              setError(messageText);
            }
          }
        } catch { setError('The table sent an unreadable update.'); }
      };
      ws.onclose = () => { if (!closed) retry = window.setTimeout(connect, 1200); };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
    };
  }, [code, room?.status, activeToken, displayName, seatToken, waitlistToken, setLocation]);

  const send = (message: unknown) => {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Reconnecting to the table…'); return; }
    socket.current.send(JSON.stringify(message));
  };

  const names = useMemo(() => {
    const seats = room?.seats ?? [];
    return Array.from(
      { length: 4 },
      (_, seat) => seats.find((entry) => entry.seat === seat)?.name || `Seat ${seat + 1}`,
    );
  }, [room]);

  const waitingSeats = useMemo< (WaitingSeat | null)[] >(() => {
    if (!room) return [];
    const roomSeats = room.seats ?? [];
    return Array.from({ length: room.playerCount ?? 4 }, (_, seat) => {
      const entry = roomSeats.find((candidate) => candidate.seat === seat);
      if (!entry || entry.status === 'open') return null;
      return {
        name: entry.name || `Seat ${seat + 1}`,
        host: seat === 0,
        bot: entry.status === 'bot',
      };
    });
  }, [room]);

  const waitlistEntries = (snapshot?.waitlist?.entries ?? []).map((entry, index): WaitlistEntryView => ({
    id: entry.id,
    name: entry.name,
    seatColorIndex: index % 4,
  }));
  const view = snapshot?.view;
  const canStartNextHand = Boolean(
    seatToken &&
    view &&
    view.seat !== null &&
    view.handOver &&
    !view.matchOver &&
    (host || snapshot?.playNow || room?.seats.some((entry) => entry.status === 'bot')),
  );

  const joinWaitlist = async () => {
    const token = waitlistToken || crypto.randomUUID();
    try {
      await roomRequest(`/rooms/${code}/waitlist`, 'POST', {
        reconnectToken: token,
        name: displayName,
        notify: pendingNotify,
      });
      sessionStorage.setItem(waitlistTokenKey(code), token);
      setWaitlistToken(token);
      setError('');
      void roomQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The waitlist is not available right now.');
    }
  };

  const leaveWaitlist = async () => {
    if (!waitlistToken) return;
    try {
      await roomRequest(`/rooms/${code}/waitlist`, 'DELETE', { reconnectToken: waitlistToken });
      sessionStorage.removeItem(waitlistTokenKey(code));
      setWaitlistToken(null);
      setError('');
      void roomQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not leave the waitlist.');
    }
  };

  const toggleWaitlistNotify = async (notify: boolean) => {
    setPendingNotify(notify);
    sessionStorage.setItem(waitlistNotifyKey(code), String(notify));
    if (!waitlistToken || !snapshot?.waitlist?.meId) return;
    try {
      await roomRequest(`/rooms/${code}/waitlist`, 'PATCH', { reconnectToken: waitlistToken, notify });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update waitlist notifications.');
    }
  };

  const leaveWaitingRoom = async () => {
    const clearRoomSession = () => {
      sessionStorage.removeItem(tokenKey(code));
      sessionStorage.removeItem(hostTokenKey(code));
      sessionStorage.removeItem(waitlistTokenKey(code));
      sessionStorage.removeItem(nameKey(code));
      sessionStorage.removeItem(`dominoes-host-${code}`);
    };
    try {
      if (seatToken) {
        await roomRequest(`/rooms/${code}/leave`, 'POST', { reconnectToken: seatToken });
      } else if (waitlistToken && snapshot?.waitlist?.meId) {
        await roomRequest(`/rooms/${code}/waitlist`, 'DELETE', { reconnectToken: waitlistToken });
      }
      clearRoomSession();
      setLocation('/');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not leave this table.';
      if (message === 'A seat can be released only after the hand ends') {
        clearRoomSession();
        sessionStorage.setItem('lakou-lobby-notice', 'You left the table. Your seat can be released once the current hand ends.');
        setLocation('/');
        return;
      }
      setError(message);
    }
  };

  const confirmLeave = () => {
    if (window.confirm('Leave this table?')) void leaveWaitingRoom();
  };

  const changeSettings = (settings: { mode: 'regular' | 'points'; rowBoxes: number; turnSeconds: number; isPrivate: boolean }) => {
    send({ type: 'changeSettings', ...settings });
  };

  const fillBots = async () => {
    if (!host || !seatToken) return;
    try {
      await roomRequest(`/rooms/${code}/bots`, 'POST', { reconnectToken: seatToken });
      setError('');
      void roomQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not fill the open seats.');
    }
  };

  const startRoom = async () => {
    if (!host || !seatToken || waitingSeats.length === 0 || waitingSeats.some((seat) => seat === null)) {
      return;
    }
    try {
      await roomRequest(`/rooms/${code}/start`, 'POST', { reconnectToken: seatToken });
      setError('');
      void roomQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The table is not ready to start yet.');
    }
  };

  const acceptOffer = async () => {
    if (!waitlistToken) return;
    try {
      await roomRequest(`/rooms/${code}/waitlist/accept`, 'POST', { reconnectToken: waitlistToken });
      sessionStorage.setItem(tokenKey(code), waitlistToken);
      sessionStorage.setItem(nameKey(code), displayName);
      sessionStorage.removeItem(waitlistTokenKey(code));
      setSeatToken(waitlistToken);
      setWaitlistToken(null);
      setOffer(null);
      void roomQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That seat offer is no longer available.');
    }
  };

  const declineOffer = async () => {
    if (!waitlistToken) return;
    try {
      await roomRequest(`/rooms/${code}/waitlist/decline`, 'POST', { reconnectToken: waitlistToken });
      setOffer(null);
      void roomQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not decline the seat offer.');
    }
  };

  if (roomQuery.isLoading) return <main className="room-shell room-loading-page"><p className="room-loading-text">Setting the table…</p></main>;
  if (!room) return <main className="room-shell"><div className="empty-card">That table may have closed.</div></main>;

  if (room.status === 'waiting') {
    const settings = snapshot?.roomSettings;
    return (
      <>
        <WaitingRoom
          tableName={`${room.hostName || 'Domino'}'s table`}
          code={code}
          link={new URL(`/room/${code}`, window.location.origin).toString()}
          mode={settings?.mode ?? room.mode}
          rowBoxes={settings?.rowBoxes ?? (room as typeof room & { rowBoxes?: number }).rowBoxes ?? room.rowLength}
          turnSeconds={settings?.turnSeconds ?? room.turnSeconds ?? 30}
          isPrivate={settings?.isPrivate ?? room.isPrivate ?? false}
          seats={waitingSeats}
          isHost={host}
          onStart={startRoom}
          onFillBots={fillBots}
          onLeave={confirmLeave}
          onChangeSettings={host ? changeSettings : undefined}
          onHome={confirmLeave}
          me={{ name: displayName }}
           friends={roomFriends}
           onInviteFriend={inviteFriend}
          chat={chat}
          onSendChat={(text) => send({ type: 'chat', text })}
          waitlist={snapshot?.playNow ? undefined : {
            entries: waitlistEntries,
            meId: snapshot?.waitlist?.meId ?? null,
            notify: snapshot?.waitlist?.notify ?? pendingNotify,
            isSeated: Boolean(seatToken),
            onToggleNotify: toggleWaitlistNotify,
            onJoin: joinWaitlist,
            onLeave: leaveWaitlist,
          }}
        />
        {error && <p role="alert">{error}</p>}
      </>
    );
  }

  if (!snapshot?.view) {
    return <main className="room-shell room-loading-page"><p className="room-loading-text">{error || 'Connecting to the table…'}</p></main>;
  }

  return <>
    <LakouGame view={snapshot.view} names={names} tableCode={code} events={snapshot.events} eventsKey={snapshot.eventsKey} turnDeadline={snapshot.turnDeadline} turnMs={snapshot.turnMs ?? undefined}
    chat={chat} onAction={(action) => send(socketEventForAction(action))} onSendChat={(text) => send({ type: 'chat', text })}
    canStartNextHand={canStartNextHand}
    onNextHand={() => {
      console.log(`Next hand clicked in room ${code}`);
      send({ type: 'nextHand' });
    }}
    nextHandAt={snapshot.nextHandAt ?? null}
    onPlayAgain={() => (host || snapshot.playNow) && send({ type: 'playAgain' })}
     onLeave={confirmLeave}
     onHome={confirmLeave}
     waitlist={!snapshot.playNow && snapshot.waitlist ? {
      ...snapshot.waitlist,
      entries: waitlistEntries,
      notify: snapshot.waitlist.notify ?? pendingNotify,
      onToggleNotify: toggleWaitlistNotify,
      onJoin: joinWaitlist,
      onLeave: leaveWaitlist,
    } : undefined}
    seatOffer={offer ? {
      tableName: room.hostName || 'Lakou Domino',
      seatNumber: offer.seat ?? 0,
      reason: 'A seat opened at the table.',
      expiresAt: offer.expiresAt ?? Date.now() + 60000,
      onTake: acceptOffer,
      onStay: declineOffer,
    } : null} />
    {error && <div className="room-live-error" role="alert" aria-live="assertive">{error}</div>}
  </>;
}