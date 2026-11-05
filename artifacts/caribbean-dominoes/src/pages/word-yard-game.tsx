import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowLeft, Check, Copy, DoorOpen, RotateCw, Users, Wifi, WifiOff } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import {
  getGetAuthMeQueryKey,
  getListFriendsQueryKey,
  useCreateFriendInvite,
  useGetAuthMe,
  useListFriends,
} from '@workspace/api-client-react';
import { YardHeader } from './social';
import { getGuestName, saveGuestName } from '@/lib/lakou-session';
import './word-yard-game.css';

type Mode = 'classic' | 'speed' | 'party';
type Settings = {
  mode: Mode;
  playerCount: 2 | 3 | 4;
  wordLength: number;
  timeLimitMs: number;
  roundsToPlay: number;
  isPrivate: boolean;
  displayName: string;
};
type PublicPlayer = {
  seat: number;
  playerId: string;
  name: string;
  ready: boolean;
  guessesUsed: number;
  roundStatus: string;
  totalScore: number;
};
type FeedbackTile = string | { state?: string; result?: string; status?: string; letter?: string };
type GuessRecord = string | { word?: string; guess?: string; feedback?: FeedbackTile[] };
type OwnRound = {
  guesses?: GuessRecord[];
  feedback?: FeedbackTile[][];
  answer?: string;
  deadlineAt?: number | string;
  startedAt?: number | string;
  status?: string;
  [key: string]: unknown;
};
type MatchPlayer = {
  playerId: string;
  totalScore: number;
  guessesUsed: number;
  status: string;
  ownRound?: OwnRound;
};
type MatchView = {
  status?: string;
  roundNumber?: number;
  deadlineAt?: number | string;
  endsAt?: number | string;
  startedAt?: number | string;
  answer?: string;
  players?: MatchPlayer[];
  [key: string]: unknown;
};
type RoomSnapshot = {
  code: string;
  mode: Mode;
  status: 'waiting' | 'playing' | 'round-complete' | 'finished';
  playerCount: number;
  wordLength: number;
  timeLimitMs: number;
  roundsToPlay: number;
  isPrivate: boolean;
  players: PublicPlayer[];
  match: MatchView | null;
};
type RoomListing = { code: string; mode: Mode; playerCount: number; wordLength: number; seatsTaken: number };
type AccessResult = { room: RoomSnapshot; seat: number; reconnectToken: string };
type ServerMessage = { type: 'snapshot'; room: RoomSnapshot } | { type: 'error'; message: string };

const reconnectKey = (code: string) => `word-yard-reconnect-${code}`;
const displayNameKey = (code: string) => `word-yard-display-name-${code}`;
const seatKey = (code: string) => `word-yard-seat-${code}`;
const roomPath = (code: string) => `/games/words/${encodeURIComponent(code)}`;
const DEFAULT_SETTINGS: Settings = {
  mode: 'classic',
  playerCount: 2,
  wordLength: 5,
  timeLimitMs: 180_000,
  roundsToPlay: 3,
  isPrivate: false,
  displayName: '',
};
const modeLabel: Record<Mode, string> = { classic: 'Classic', speed: 'Speed', party: 'Party' };
const keyboardRows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const cleanStatus = (status?: string) => (status ?? '').toLowerCase().replaceAll('_', '-');

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const result = await response.json() as { error?: unknown; message?: unknown };
    if (typeof result.error === 'string') return new Error(result.error);
    if (typeof result.message === 'string') return new Error(result.message);
  } catch { /* retain the useful fallback */ }
  return new Error(fallback);
}

async function postJson<T>(path: string, data: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw await responseError(response, 'The room could not complete that request.');
  return response.json() as Promise<T>;
}

function feedbackState(tile: FeedbackTile | undefined): string | undefined {
  const value = typeof tile === 'string' ? tile : tile?.state ?? tile?.result ?? tile?.status;
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (['correct', 'exact', 'right'].includes(normalized)) return 'correct';
  if (['present', 'misplaced', 'elsewhere'].includes(normalized)) return 'present';
  if (['absent', 'incorrect', 'miss'].includes(normalized)) return 'absent';
  return undefined;
}

function guessWord(guess: GuessRecord): string {
  return typeof guess === 'string' ? guess : guess.word ?? guess.guess ?? '';
}

function guessFeedback(guess: GuessRecord, own: OwnRound, index: number): FeedbackTile[] {
  if (typeof guess !== 'string' && guess.feedback) return guess.feedback;
  return own.feedback?.[index] ?? [];
}

function revealAnswer(room: RoomSnapshot): string | undefined {
  const match = room.match;
  if (!match || room.status === 'playing' || room.status === 'waiting') return undefined;
  if (typeof match.answer === 'string') return match.answer;
  for (const player of match.players ?? []) {
    const answer = player.ownRound?.answer;
    if (typeof answer === 'string') return answer;
  }
  return undefined;
}

function useRoomList() {
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = async () => {
    try {
      const response = await fetch('/api/word-yard/rooms', { credentials: 'include' });
      if (!response.ok) throw await responseError(response, 'Public rooms are unavailable right now.');
      const data = await response.json() as { rooms: RoomListing[] };
      setRooms(Array.isArray(data.rooms) ? data.rooms : []);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Public rooms are unavailable right now.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(interval);
  }, []);
  return { rooms, loading, error, refresh };
}

export default function WordYardGamePage() {
  const { code: rawCode } = useParams<{ code?: string }>();
  const code = rawCode?.toUpperCase();
  const [, setLocation] = useLocation();
  const auth = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey() } });
  const user = auth.data?.user;
  const friends = useListFriends({ query: { queryKey: getListFriendsQueryKey(), enabled: Boolean(user) } });
  const inviteFriend = useCreateFriendInvite();
  const rooms = useRoomList();
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, displayName: getGuestName() }));
  const [joinCode, setJoinCode] = useState('');
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting');
  const [pending, setPending] = useState(false);
  const [guessInput, setGuessInput] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const socket = useRef<WebSocket | null>(null);
  const connectionAttempt = useRef(0);
  const linkJoinPromise = useRef<Promise<string> | null>(null);

  useEffect(() => {
    if (user?.username) setSettings((current) => ({ ...current, displayName: user.username }));
  }, [user?.username]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!code) {
      setSnapshot(null);
      setConnection('connecting');
      setNotice('');
      return;
    }
    let stopped = false;
    let retryTimer: number | undefined;
    let activeSocket: WebSocket | null = null;
    const attemptId = ++connectionAttempt.current;

    const connect = async () => {
      if (stopped) return;
      setConnection(retryTimer ? 'reconnecting' : 'connecting');
      let token = sessionStorage.getItem(reconnectKey(code));
      if (!token) {
        const displayName = (user?.username || sessionStorage.getItem(displayNameKey(code)) || settings.displayName || getGuestName() || 'Guest')
          .trim().slice(0, 24);
        if (!linkJoinPromise.current) {
          linkJoinPromise.current = postJson<AccessResult>(`/api/word-yard/rooms/${encodeURIComponent(code)}/join`, { displayName })
            .then((result) => {
              sessionStorage.setItem(reconnectKey(code), result.reconnectToken);
              sessionStorage.setItem(displayNameKey(code), displayName);
              sessionStorage.setItem(seatKey(code), String(result.seat));
              return result.reconnectToken;
            })
            .finally(() => { linkJoinPromise.current = null; });
        }
        try {
          token = await linkJoinPromise.current;
        } catch (reason) {
          if (!stopped) {
            setNotice(reason instanceof Error ? reason.message : 'We could not join that room.');
            setConnection('offline');
          }
          return;
        }
      }
      if (stopped || !token || attemptId !== connectionAttempt.current) return;
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      activeSocket = new WebSocket(`${protocol}://${window.location.host}/ws?wordCode=${encodeURIComponent(code)}`);
      socket.current = activeSocket;
      activeSocket.onopen = () => activeSocket?.send(JSON.stringify({ type: 'hello', reconnectToken: token }));
      activeSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          if (message.type === 'error') {
            setNotice(message.message || 'The room rejected that action.');
            return;
          }
          if (message.type === 'snapshot' && message.room) {
            setSnapshot(message.room);
            setSettings((current) => ({ ...current, mode: message.room.mode }));
            setNotice('');
            setConnection('connected');
          }
        } catch {
          setNotice('The room sent an unreadable update. Reconnecting may help.');
        }
      };
      activeSocket.onerror = () => setConnection('reconnecting');
      activeSocket.onclose = () => {
        if (socket.current === activeSocket) socket.current = null;
        if (!stopped) {
          setConnection('reconnecting');
          retryTimer = window.setTimeout(connect, 1200);
        }
      };
    };
    void connect();
    return () => {
      stopped = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      activeSocket?.close();
      if (socket.current === activeSocket) socket.current = null;
    };
  }, [code, user?.username]);

  const displayName = (user?.username || settings.displayName || 'Guest').trim().slice(0, 24);
  const isSubmitting = pending;
  const mutateSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const beginRoom = async (endpoint: string, payload: Settings) => {
    const cleanName = payload.displayName.trim().slice(0, 24);
    if (!cleanName) { setNotice('Enter a display name before opening a room.'); return; }
    setPending(true);
    setNotice('');
    try {
      if (!user) saveGuestName(cleanName);
      const result = await postJson<AccessResult>(endpoint, { ...payload, displayName: cleanName });
      sessionStorage.setItem(reconnectKey(result.room.code), result.reconnectToken);
      sessionStorage.setItem(displayNameKey(result.room.code), cleanName);
      sessionStorage.setItem(seatKey(result.room.code), String(result.seat));
      setLocation(roomPath(result.room.code));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'The room could not be opened. Try again.');
    } finally { setPending(false); }
  };
  const joinRoom = async (event: FormEvent) => {
    event.preventDefault();
    const cleanCode = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(cleanCode)) {
      setNotice('Enter a room code between 4 and 8 letters or numbers.');
      return;
    }
    setPending(true);
    setNotice('');
    try {
      if (!user) saveGuestName(displayName);
      const result = await postJson<AccessResult>(`/api/word-yard/rooms/${encodeURIComponent(cleanCode)}/join`, { displayName });
      sessionStorage.setItem(reconnectKey(result.room.code), result.reconnectToken);
      sessionStorage.setItem(displayNameKey(result.room.code), displayName);
      sessionStorage.setItem(seatKey(result.room.code), String(result.seat));
      setLocation(roomPath(result.room.code));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'We could not find an open room with that code.');
    } finally { setPending(false); }
  };
  const joinListedRoom = async (roomCode: string) => {
    setPending(true);
    setNotice('');
    try {
      if (!user) saveGuestName(displayName);
      const result = await postJson<AccessResult>(`/api/word-yard/rooms/${encodeURIComponent(roomCode)}/join`, { displayName });
      sessionStorage.setItem(reconnectKey(result.room.code), result.reconnectToken);
      sessionStorage.setItem(displayNameKey(result.room.code), displayName);
      sessionStorage.setItem(seatKey(result.room.code), String(result.seat));
      setLocation(roomPath(result.room.code));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'That room is no longer open.');
      void rooms.refresh();
    } finally { setPending(false); }
  };
  const sendReady = () => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setNotice('Reconnecting to the room. Try readying up again in a moment.');
      return;
    }
    socket.current.send(JSON.stringify({ type: 'ready' }));
    setNotice('Ready status sent.');
  };
  const submitGuess = (rawGuess = guessInput) => {
    const guess = rawGuess.trim().toUpperCase();
    if (!snapshot || guess.length !== snapshot.wordLength || !/^[A-Z]+$/.test(guess)) {
      setNotice(`Enter a ${snapshot?.wordLength ?? 5}-letter word.`);
      return;
    }
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setNotice('Reconnecting to the room. Your guess was not sent.');
      return;
    }
    socket.current.send(JSON.stringify({ type: 'guess', word: guess }));
    setGuessInput('');
    setNotice('');
  };
  const copyInvite = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${roomPath(code)}`);
      setNotice('Invite link copied. Share it with your players.');
    } catch {
      setNotice(`Room code ${code} is ready to share.`);
    }
  };
  const sendFriendInvite = (friendId: string) => {
    if (!code) return;
    inviteFriend.mutate({ data: { friendId, roomCode: code } }, {
      onSuccess: () => setNotice('Invite sent to your 509 Yard inbox.'),
      onError: () => setNotice('The invite could not be sent. Check that the room is still open.'),
    });
  };

  if (code) {
    return <RoomView
      code={code}
      snapshot={snapshot}
      connection={connection}
      notice={notice}
      guessInput={guessInput}
      setGuessInput={setGuessInput}
      clockNow={clockNow}
      username={user?.username}
      friends={friends.data?.friends ?? []}
      signedIn={Boolean(user)}
      invitePending={inviteFriend.isPending}
      onGuess={submitGuess}
      onReady={sendReady}
      onCopyInvite={() => void copyInvite()}
      onInviteFriend={sendFriendInvite}
      onRetry={() => {
        if (socket.current) socket.current.close();
        setConnection('reconnecting');
        setNotice('Reconnecting to your room…');
      }}
    />;
  }

  return <div className="yard-app word-yard-page">
    <YardHeader active="games" username={user?.username} notifications={0} onLogout={() => {}} />
    <main className="word-yard-main">
      <Link href="/games" className="word-yard-back"><ArrowLeft size={14} /> All games</Link>
      <div className="word-yard-heading">
        <div>
          <p className="word-yard-kicker">509 Yard · multiplayer word rounds</p>
          <h1>Word Yard</h1>
          <p>Find the hidden word at your own pace. Every player gets six guesses; the board keeps your words private while the yard tracks progress.</p>
        </div>
        <span className="word-yard-status-chip"><i /> Live rooms</span>
      </div>
      {notice && <p className="word-yard-notice" role="alert">{notice}</p>}
      <div className="word-yard-lobby-grid">
        <section className="word-yard-panel" aria-labelledby="word-yard-create-title">
          <div className="word-yard-panel-head"><h2 id="word-yard-create-title">Set up a match</h2><span className="word-yard-kicker">Play together, guess independently</span></div>
          <div className="word-yard-panel-body">
            <div className="word-yard-control-grid">
              <label className="word-yard-field">Your name
                <input value={user?.username ?? settings.displayName} disabled={Boolean(user)} maxLength={24} onChange={(event) => mutateSettings('displayName', event.target.value)} autoComplete="nickname" />
              </label>
              <label className="word-yard-field">Game mode
                <select value={settings.mode} onChange={(event) => mutateSettings('mode', event.target.value as Mode)}>
                  <option value="classic">Classic · steady pace</option>
                  <option value="speed">Speed · race the clock</option>
                  <option value="party">Party · room to rally</option>
                </select>
              </label>
              <div className="word-yard-field"><span>Players</span>
                <div className="word-yard-choice-row" role="group" aria-label="Number of players">
                  {([2, 3, 4] as const).map((count) => <button type="button" key={count} aria-pressed={settings.playerCount === count} onClick={() => mutateSettings('playerCount', count)}>{count} players</button>)}
                </div>
              </div>
              <div className="word-yard-field"><span>Word length</span>
                <div className="word-yard-choice-row" role="group" aria-label="Word length">
                  {[4, 5, 6, 7].map((length) => <button type="button" key={length} aria-pressed={settings.wordLength === length} onClick={() => mutateSettings('wordLength', length)}>{length} letters</button>)}
                </div>
              </div>
              <label className="word-yard-field">Round timer
                <select value={settings.timeLimitMs} onChange={(event) => mutateSettings('timeLimitMs', Number(event.target.value))}>
                  <option value={120000}>2 minutes</option><option value={180000}>3 minutes</option><option value={300000}>5 minutes</option><option value={600000}>10 minutes</option>
                </select>
              </label>
              <label className="word-yard-field">Rounds
                <select value={settings.roundsToPlay} onChange={(event) => mutateSettings('roundsToPlay', Number(event.target.value))}>
                  {[1, 3, 5, 7, 10].map((rounds) => <option key={rounds} value={rounds}>{rounds} {rounds === 1 ? 'round' : 'rounds'}</option>)}
                </select>
              </label>
            </div>
            <div className="word-yard-buttons">
              <button type="button" className="word-yard-button is-primary" disabled={isSubmitting || !displayName} onClick={() => void beginRoom('/api/word-yard/quick-match', { ...settings, isPrivate: false })}>
                <Users size={15} /> {isSubmitting ? 'Finding a match…' : 'Quick Match'}
              </button>
              <Link className="word-yard-button" href="/games/words/practice">Practice vs Yard bot</Link>
              <button type="button" className="word-yard-button" disabled={isSubmitting || !displayName} onClick={() => void beginRoom('/api/word-yard/rooms', settings)}>
                <DoorOpen size={15} /> Create {settings.isPrivate ? 'private' : 'public'} room
              </button>
            </div>
            <label className="word-yard-toggle" style={{ marginTop: 13 }}>
              <input type="checkbox" checked={settings.isPrivate} onChange={(event) => mutateSettings('isPrivate', event.target.checked)} />
              Private room · keep it out of public discovery
            </label>
            <p className="word-yard-note">Quick Match looks for a public room with these same settings. If none is waiting, it opens one for others to find.</p>
          </div>
        </section>

        <div style={{ display: 'grid', gap: 18 }}>
          <section className="word-yard-panel" aria-labelledby="word-yard-join-title">
            <div className="word-yard-panel-head"><h2 id="word-yard-join-title">Join by code</h2></div>
            <div className="word-yard-panel-body">
              <form className="word-yard-join" onSubmit={(event) => void joinRoom(event)}>
                <label className="word-yard-hidden-label" htmlFor="word-yard-room-code">Room code</label>
                <input id="word-yard-room-code" value={joinCode} placeholder="Enter room code" maxLength={8} autoCapitalize="characters" onChange={(event) => setJoinCode(event.target.value.toUpperCase())} />
                <button className="word-yard-button is-primary" type="submit" disabled={pending || !joinCode.trim()}>{pending ? 'Joining…' : 'Join room'}</button>
              </form>
            </div>
          </section>
          <section className="word-yard-panel" aria-labelledby="word-yard-open-title">
            <div className="word-yard-panel-head">
              <h2 id="word-yard-open-title">Open rooms</h2>
              <button type="button" className="word-yard-button" onClick={() => void rooms.refresh()} aria-label="Refresh public rooms"><RotateCw size={14} /> Refresh</button>
            </div>
            <div className="word-yard-panel-body">
              {rooms.loading ? <div className="word-yard-room-list" aria-label="Loading public rooms"><i className="word-yard-skeleton" /><i className="word-yard-skeleton" /></div>
                : rooms.error ? <div className="word-yard-empty" role="alert"><strong>Rooms did not load</strong><span>{rooms.error}</span><button type="button" className="word-yard-button" onClick={() => void rooms.refresh()}>Try again</button></div>
                : rooms.rooms.length ? <div className="word-yard-room-list">{rooms.rooms.map((room) => <div className="word-yard-room" key={room.code}>
                  <div><strong>{modeLabel[room.mode] ?? room.mode} · {room.wordLength} letters</strong><small>Room {room.code} · {room.seatsTaken} of {room.playerCount} seats</small></div>
                  <button className="word-yard-button" type="button" disabled={pending} onClick={() => void joinListedRoom(room.code)}>Join</button>
                </div>)}</div>
                : <div className="word-yard-empty"><strong>No open tables right now</strong><span>Start a Quick Match or create a room; it will appear here for the next player.</span></div>}
            </div>
          </section>
        </div>
      </div>
      <footer className="word-yard-note" style={{ marginTop: 22 }}>Word Yard is its own guessing game: no shared rack, no letter values, just six chances to find the word.</footer>
    </main>
  </div>;
}

function RoomView(props: {
  code: string;
  snapshot: RoomSnapshot | null;
  connection: string;
  notice: string;
  guessInput: string;
  setGuessInput: (value: string) => void;
  clockNow: number;
  username?: string;
  friends: { id: string; username: string }[];
  signedIn: boolean;
  invitePending: boolean;
  onGuess: (word?: string) => void;
  onReady: () => void;
  onCopyInvite: () => void;
  onInviteFriend: (id: string) => void;
  onRetry: () => void;
}) {
  const { snapshot, code } = props;
  const seat = Number(sessionStorage.getItem(seatKey(code)));
  const me = snapshot?.players.find((player) => player.seat === seat)
    ?? snapshot?.players.find((player) => player.name === sessionStorage.getItem(displayNameKey(code)))
    ?? snapshot?.players.find((player) => player.name === props.username);
  const ownMatch = snapshot?.match?.players?.find((player) => player.playerId === me?.playerId);
  const ownRound = ownMatch?.ownRound;
  const guesses = ownRound?.guesses ?? [];
  const currentStatus = snapshot?.status;
  const active = currentStatus === 'playing';
  const finished = currentStatus === 'finished';
  const roundComplete = currentStatus === 'round-complete';
  const deadline = ownRound?.deadlineAt ?? snapshot?.match?.deadlineAt ?? snapshot?.match?.endsAt;
  const deadlineMs = typeof deadline === 'string' ? Date.parse(deadline) : deadline;
  const remainingMs = typeof deadlineMs === 'number' && Number.isFinite(deadlineMs) ? Math.max(0, deadlineMs - props.clockNow) : snapshot?.timeLimitMs ?? 0;
  const remaining = Math.ceil(remainingMs / 1000);
  const answer = snapshot ? revealAnswer(snapshot) : undefined;
  const settled = roundComplete || finished;
  const mayGuess = active && (ownMatch?.status === 'playing' || ownRound?.status === 'playing' || ownMatch?.status === 'active');
  const keyboardStates = new Map<string, string>();
  guesses.forEach((guess, index) => {
    const word = guessWord(guess);
    guessFeedback(guess, ownRound ?? {}, index).forEach((tile, tileIndex) => {
      const state = feedbackState(tile);
      const letter = word[tileIndex];
      const rank = (value?: string) => value === 'correct' ? 3 : value === 'present' ? 2 : value === 'absent' ? 1 : 0;
      if (letter && rank(state) > rank(keyboardStates.get(letter))) keyboardStates.set(letter, state!);
    });
  });
  const remainingAttempts = Math.max(0, 6 - guesses.length);
  const feedbackLabel = (state?: string) => state === 'correct' ? 'correct position' : state === 'present' ? 'in the word, different position' : state === 'absent' ? 'not in the word' : 'no feedback';
  const currentGuess = props.guessInput.toUpperCase().replace(/[^A-Z]/g, '').slice(0, snapshot?.wordLength ?? 7);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!mayGuess || event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement) return;
      if (event.key === 'Enter') { event.preventDefault(); props.onGuess(currentGuess); }
      else if (event.key === 'Backspace') props.setGuessInput(currentGuess.slice(0, -1));
      else if (/^[a-z]$/i.test(event.key)) props.setGuessInput((currentGuess + event.key.toUpperCase()).slice(0, snapshot?.wordLength ?? 7));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mayGuess, currentGuess, snapshot?.wordLength, props.onGuess, props.setGuessInput]);

  if (!snapshot) {
    return <div className="yard-app word-yard-page">
      <YardHeader active="games" username={props.username} notifications={0} onLogout={() => {}} />
      <main className="word-yard-main">
        <Link href="/games/words" className="word-yard-back"><ArrowLeft size={14} /> Word Yard lobby</Link>
        <div className="word-yard-panel word-yard-panel-body" role="status">
          <strong>{props.connection === 'reconnecting' ? 'Reconnecting to your room' : props.connection === 'offline' ? 'Room connection failed' : 'Opening your room'}</strong>
          <p className="word-yard-note">{props.notice || `Room ${code} is loading. Your seat is rehydrated from its reconnect token.`}</p>
          {props.connection === 'offline' && <button className="word-yard-button" type="button" onClick={props.onRetry}>Reconnect</button>}
        </div>
      </main>
    </div>;
  }

  return <div className="yard-app word-yard-page">
    <YardHeader active="games" username={props.username} notifications={0} onLogout={() => {}} />
    <main className="word-yard-main">
      <Link href="/games/words" className="word-yard-back"><ArrowLeft size={14} /> Word Yard lobby</Link>
      <div className="word-yard-heading">
        <div><p className="word-yard-kicker">509 Yard · room {code}</p><h1>{modeLabel[snapshot.mode]} round</h1>
          <p>{snapshot.wordLength} letters · {snapshot.roundsToPlay} {snapshot.roundsToPlay === 1 ? 'round' : 'rounds'} · {snapshot.playerCount} player seats</p>
        </div>
        <span className="word-yard-status-chip">{props.connection === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}{props.connection === 'connected' ? 'Connected' : props.connection === 'reconnecting' ? 'Reconnecting' : 'Connecting'}</span>
      </div>
      <div className="word-yard-board-layout">
        <section className="word-yard-panel word-yard-game-panel" aria-label="Word Yard game board">
          <div className="word-yard-game-top">
            <span className="word-yard-room-code">ROOM {code} · ROUND {snapshot.match?.roundNumber ?? 1}/{snapshot.roundsToPlay}</span>
            <span className={`word-yard-clock${remaining < 20 ? ' is-low' : ''}`} aria-live="off"><span aria-hidden="true">◷</span>{active ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '—:—'}</span>
          </div>
          <div className="word-yard-game-content">
            <p className="word-yard-round-copy" role="status" aria-live="polite">
              <strong>{active ? mayGuess ? 'Your guesses are yours alone.' : 'Waiting for the next round.' : currentStatus === 'waiting' ? 'The table is gathering.' : finished ? 'Match complete.' : 'Round settled.'}</strong>
              <span>{active ? `Six attempts · ${remainingAttempts} left · other players keep guessing too` : currentStatus === 'waiting' ? `${snapshot.players.length} of ${snapshot.playerCount} players joined. Everyone must be ready to begin.` : 'Round results are in. Ready players advance together.'}</span>
            </p>
            {active || settled ? <div className="word-yard-board" style={{ '--word-length': snapshot.wordLength } as CSSProperties} aria-label="Your guesses">
              {Array.from({ length: 6 }, (_, rowIndex) => {
                const recorded = guesses[rowIndex];
                const word = recorded ? guessWord(recorded).toUpperCase() : rowIndex === guesses.length && active ? currentGuess : '';
                const feedback = recorded ? guessFeedback(recorded, ownRound ?? {}, rowIndex) : [];
                return <div className="word-yard-tiles" key={rowIndex}>
                  {Array.from({ length: snapshot.wordLength }, (_, columnIndex) => {
                    const letter = word[columnIndex] ?? '';
                    const state = recorded ? feedbackState(feedback[columnIndex]) : undefined;
                    return <div key={columnIndex} className={`word-yard-tile${letter ? ' is-filled' : ''}${rowIndex === guesses.length && active ? ' is-current' : ''}`} data-state={state}
                      aria-label={`Guess ${rowIndex + 1}, letter ${columnIndex + 1}: ${letter || 'empty'}${recorded ? `, ${feedbackLabel(state)}` : ''}`}>{letter}</div>;
                  })}
                </div>;
              })}
            </div> : <div className="word-yard-empty"><strong>Ready when you are</strong><span>Set your status to ready. The round begins once every seat is filled and ready.</span></div>}
            {mayGuess && <form className="word-yard-actions" onSubmit={(event) => { event.preventDefault(); props.onGuess(currentGuess); }}>
              <label className="word-yard-hidden-label" htmlFor="word-yard-guess">Your {snapshot.wordLength}-letter guess</label>
              <input id="word-yard-guess" className="word-yard-select" style={{ maxWidth: 220, textTransform: 'uppercase', letterSpacing: '.12em', textAlign: 'center' }} value={currentGuess} maxLength={snapshot.wordLength} autoComplete="off" spellCheck={false} onChange={(event) => props.setGuessInput(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, snapshot.wordLength))} />
              <button className="word-yard-button is-primary" type="submit" disabled={currentGuess.length !== snapshot.wordLength || props.connection !== 'connected'}>Submit guess</button>
            </form>}
            {mayGuess && <div className="word-yard-keyboard" aria-label="On-screen keyboard">
              {keyboardRows.map((row, index) => <div className="word-yard-key-row" key={row}>
                {index === 2 && <button type="button" className="word-yard-key is-wide" onClick={() => props.onGuess(currentGuess)} disabled={currentGuess.length !== snapshot.wordLength}>Enter</button>}
                {row.split('').map((letter) => <button type="button" className="word-yard-key" key={letter} data-state={keyboardStates.get(letter)} aria-label={letter} onClick={() => props.setGuessInput((currentGuess + letter).slice(0, snapshot.wordLength))}>{letter}</button>)}
                {index === 2 && <button type="button" className="word-yard-key is-wide" aria-label="Delete last letter" onClick={() => props.setGuessInput(currentGuess.slice(0, -1))}>Delete</button>}
              </div>)}
            </div>}
            {props.notice && <p className="word-yard-notice" role="alert">{props.notice}</p>}
            <div className="word-yard-actions">
              {(currentStatus === 'waiting' || roundComplete) && <button type="button" className="word-yard-button is-primary" onClick={props.onReady} disabled={me?.ready || props.connection !== 'connected'}>
                <Check size={14} /> {me?.ready ? 'You are ready' : currentStatus === 'waiting' ? 'Ready up' : 'Ready for next round'}
              </button>}
              <button type="button" className="word-yard-button" onClick={props.onCopyInvite}><Copy size={14} /> Copy invite</button>
              {props.connection !== 'connected' && <button type="button" className="word-yard-button" onClick={props.onRetry}>Reconnect</button>}
            </div>
            {settled && <div className="word-yard-round-result" role="status">
              <strong>{finished ? 'Final round' : `Round ${snapshot.match?.roundNumber ?? 1} result`}</strong>
              {answer && <div className="word-yard-result-answer" aria-label={`The word was ${answer}`}>{answer}</div>}
              {!answer && <p>The server has settled this round.</p>}
              <span>{guesses.length ? `You used ${guesses.length} of 6 guesses.` : 'Your round is complete.'}</span>
            </div>}
          </div>
        </section>
        <aside className="word-yard-panel">
          <div className="word-yard-panel-head"><h2>At the table</h2><span className="word-yard-kicker">{snapshot.players.length}/{snapshot.playerCount} seats</span></div>
          <div className="word-yard-panel-body">
            <div className="word-yard-player-list">
              {Array.from({ length: snapshot.playerCount }, (_, seatIndex) => {
                const player = snapshot.players.find((entry) => entry.seat === seatIndex);
                const isYou = player?.playerId === me?.playerId;
                const playerMatch = snapshot.match?.players?.find((entry) => entry.playerId === player?.playerId);
                const used = player?.guessesUsed ?? playerMatch?.guessesUsed ?? 0;
                const status = cleanStatus(player?.roundStatus ?? playerMatch?.status);
                return <div className="word-yard-player-row" key={player?.playerId ?? seatIndex}>
                  <span className="word-yard-seat">{String(seatIndex + 1).padStart(2, '0')}</span>
                  <span><strong>{player?.name ?? 'Open seat'}{isYou ? ' · You' : ''}</strong>
                    <small>{!player ? 'Waiting for a player' : player.ready && currentStatus !== 'playing' ? 'Ready' : status === 'solved' ? 'Solved' : status === 'failed' || status === 'timed-out' ? 'Round complete' : active ? `${used} of 6 guesses used` : player.ready ? 'Ready' : 'Not ready'}</small>
                  </span>
                  <span className="word-yard-player-score">{player ? `${player.totalScore} pts` : '—'}</span>
                  {player && active && <div className="word-yard-progress" aria-label={`${player.name}: ${used} of 6 guesses used`}><span style={{ width: `${Math.min(100, used / 6 * 100)}%` }} /></div>}
                </div>;
              })}
            </div>
            {settled && <div className="word-yard-standings">
              <h3>{finished ? 'Final standings' : 'Round scores'}</h3>
              {[...snapshot.players].sort((a, b) => b.totalScore - a.totalScore).map((player, index) => <div className="word-yard-standing" key={player.playerId}>
                <span>{index + 1}. {player.name}{player.playerId === me?.playerId ? ' (you)' : ''}</span><strong>{player.totalScore} pts</strong>
              </div>)}
            </div>}
            {props.signedIn && currentStatus === 'waiting' && props.friends.length > 0 && <div className="word-yard-friends">
              <label htmlFor="word-yard-friend">Invite a 509 Yard friend</label>
              <select id="word-yard-friend" className="word-yard-select" defaultValue="" onChange={(event) => event.target.value && props.onInviteFriend(event.target.value)} disabled={props.invitePending}>
                <option value="">Choose a friend</option>{props.friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.username}</option>)}
              </select>
            </div>}
            <p className="word-yard-help">You can guess at the same time as everyone else. Other players’ words and tile feedback stay hidden until they choose to share them.</p>
            {currentStatus === 'finished' && <p className="word-yard-round-result"><strong>Match complete</strong><br />Final totals are shown above. Create another room from the lobby to play again.</p>}
          </div>
        </aside>
      </div>
      <p className="word-yard-note" style={{ marginTop: 14 }}>{props.connection === 'connected' ? 'Your room is live. Refreshing this page will reconnect your seat.' : 'Connection interrupted. Reconnecting automatically…'}</p>
    </main>
  </div>;
}
