import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { ArrowLeft, Copy, RotateCcw, Users } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import {
  getGetAuthMeQueryKey,
  getListFriendsQueryKey,
  useCreateFriendInvite,
  useCreateTicTacToeRoom,
  useGetAuthMe,
  useJoinTicTacToeRoom,
  useListFriends,
} from '@workspace/api-client-react';
import { YardHeader } from './social';
import {
  createTicTacToeState,
  createYardTicTacToeState,
  playTicTacToeMove,
  playYardTicTacToeMove,
  type TicTacToeGameState,
  type TicTacToeMode,
  type TicTacToeState,
  type YardTicTacToeState,
} from '@/lib/tic-tac-toe';
import { getGuestName, saveGuestName } from '@/lib/lakou-session';
import './tic-tac-toe.css';

type RoomPlayer = { seat: 0 | 1; mark: 'X' | 'O'; name: string };
type RoomSnapshot = {
  code: string;
  mode: TicTacToeMode;
  status: 'waiting' | 'playing' | 'finished';
  players: RoomPlayer[];
  state: TicTacToeGameState;
  myMark: 'X' | 'O';
};

const reconnectKey = (code: string) => `tic-tac-toe-reconnect-${code}`;
const displayNameKey = (code: string) => `tic-tac-toe-display-name-${code}`;
const sharePath = (code: string) => `/games/tic-tac-toe/${code}`;

async function apiError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = await response.json() as { error?: unknown };
    if (typeof data.error === 'string') return new Error(data.error);
  } catch {
    // Keep the user-facing fallback when the server does not return JSON.
  }
  return new Error(fallback);
}

function isYardState(state: TicTacToeGameState): state is YardTicTacToeState {
  return 'boards' in state;
}

function isRegularState(state: TicTacToeGameState): state is TicTacToeState {
  return 'board' in state;
}

export default function TicTacToePage() {
  const { code: rawCode } = useParams<{ code?: string }>();
  const code = rawCode?.toUpperCase();
  const [, setLocation] = useLocation();
  const auth = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey() } });
  const user = auth.data?.user;
  const friends = useListFriends({
    query: { queryKey: getListFriendsQueryKey(), enabled: Boolean(user) },
  });
  const createRoom = useCreateTicTacToeRoom();
  const joinRoom = useJoinTicTacToeRoom();
  const inviteFriend = useCreateFriendInvite();
  const [mode, setMode] = useState<TicTacToeMode>('regular');
  const [name, setName] = useState(() => getGuestName() || 'Guest');
  const [joinCode, setJoinCode] = useState('');
  const [notice, setNotice] = useState('');
  const [localMode, setLocalMode] = useState(false);
  const [localRegular, setLocalRegular] = useState(createTicTacToeState);
  const [localYard, setLocalYard] = useState(createYardTicTacToeState);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [joiningFromLink, setJoiningFromLink] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const linkJoinAttempt = useRef<Promise<string> | null>(null);
  const linkJoinCode = useRef<string | null>(null);

  useEffect(() => {
    if (user?.username) setName(user.username);
  }, [user?.username]);

  useEffect(() => {
    if (!code) {
      setSnapshot(null);
      setNotice('');
      setConnection('connecting');
      return;
    }
    let closed = false;
    let retry: number | undefined;
    let ws: WebSocket | null = null;
    const connect = async () => {
      if (closed) return;
      setConnection(retry ? 'reconnecting' : 'connecting');
      let token = sessionStorage.getItem(reconnectKey(code));
      if (!token) {
        setJoiningFromLink(true);
        if (linkJoinCode.current !== code) {
          linkJoinCode.current = code;
          linkJoinAttempt.current = null;
        }
        if (!linkJoinAttempt.current) {
          const playerName = (user?.username || sessionStorage.getItem(displayNameKey(code)) || name || 'Guest')
            .trim().slice(0, 24);
          linkJoinAttempt.current = fetch(`/api/tic-tac-toe/rooms/${encodeURIComponent(code)}/join`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName: playerName }),
          }).then(async (response) => {
            if (!response.ok) throw await apiError(response, 'We could not join that Tic-Tac-Toe room.');
            const result = await response.json() as { reconnectToken: string };
            return result.reconnectToken;
          });
        }
        try {
          token = await linkJoinAttempt.current;
        } catch (error) {
          if (!closed) setNotice(error instanceof Error ? error.message : 'We could not join that room.');
          linkJoinAttempt.current = null;
          setJoiningFromLink(false);
          return;
        }
        sessionStorage.setItem(reconnectKey(code), token);
        sessionStorage.setItem(displayNameKey(code), user?.username || name || 'Guest');
        setJoiningFromLink(false);
      }
      if (closed) return;
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws?ticCode=${encodeURIComponent(code)}`;
      ws = new WebSocket(wsUrl);
      socket.current = ws;
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'hello', reconnectToken: token }));
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as RoomSnapshot | { type: 'error'; message?: string };
          if ('type' in message && message.type === 'error') {
            setNotice(message.message || 'The room rejected that request.');
            return;
          }
          if ('state' in message && 'myMark' in message) {
            setSnapshot(message);
            setMode(message.mode);
            setNotice('');
            setConnection('connected');
          }
        } catch {
          setNotice('The room sent an unreadable update. Reconnecting may help.');
        }
      };
      ws.onclose = () => {
        if (socket.current === ws) socket.current = null;
        if (!closed) {
          setConnection('reconnecting');
          retry = window.setTimeout(connect, 1200);
        }
      };
      ws.onerror = () => setConnection('reconnecting');
    };
    void connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      ws?.close();
      if (socket.current === ws) socket.current = null;
    };
  }, [code, user?.username]);

  const displayName = (user?.username || name || 'Guest').trim().slice(0, 24);

  const createOnlineRoom = () => {
    const cleanName = displayName || 'Guest';
    setName(cleanName);
    if (!user) saveGuestName(cleanName);
    setNotice('');
    createRoom.mutate({ data: { mode, displayName: cleanName } }, {
      onSuccess: (room) => {
        sessionStorage.setItem(reconnectKey(room.code), room.reconnectToken);
        sessionStorage.setItem(displayNameKey(room.code), cleanName);
        setLocation(sharePath(room.code));
      },
      onError: () => setNotice('That room could not be opened. Try again.'),
    });
  };

  const joinOnlineRoom = (event: FormEvent) => {
    event.preventDefault();
    const cleanCode = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(cleanCode)) {
      setNotice('Enter a room code between 4 and 8 letters or numbers.');
      return;
    }
    const cleanName = displayName || 'Guest';
    setNotice('');
    if (!user) saveGuestName(cleanName);
    joinRoom.mutate({ code: cleanCode, data: { displayName: cleanName } }, {
      onSuccess: (room) => {
        sessionStorage.setItem(reconnectKey(room.code), room.reconnectToken);
        sessionStorage.setItem(displayNameKey(room.code), cleanName);
        setLocation(sharePath(room.code));
      },
      onError: () => setNotice('We could not find an open room with that code.'),
    });
  };

  const sendMove = (move: Record<string, unknown>) => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setNotice('Reconnecting to the room. Try your move again in a moment.');
      return;
    }
    socket.current.send(JSON.stringify({ type: 'move', ...move }));
  };

  const copyInvite = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${sharePath(code)}`);
      setNotice('Invite link copied. Send it to your friend.');
    } catch {
      setNotice(`Room code ${code} is ready to share.`);
    }
  };

  const sendFriendInvite = (friendId: string) => {
    if (!code) return;
    inviteFriend.mutate({ data: { friendId, roomCode: code } }, {
      onSuccess: () => setNotice('Invite sent. Your friend can join from their 509 Yard inbox.'),
      onError: () => setNotice('We could not send that invite. Check that the room is still waiting.'),
    });
  };

  const showLocal = () => {
    setLocalMode(true);
    setSnapshot(null);
  };

  if (code && (joiningFromLink || !snapshot)) {
    return <div className="yard-app">
      <YardHeader active="games" notifications={0} onLogout={() => {}} />
      <main className="yard-main yard-tic-main">
        <Link href="/games/tic-tac-toe" className="yard-tic-back"><ArrowLeft size={14} /> Tic-Tac-Toe rooms</Link>
        <p className="yard-tic-status" role="status">{notice || (connection === 'reconnecting' ? 'Reconnecting to your match…' : 'Opening your match…')}</p>
      </main>
    </div>;
  }

  if (localMode) {
    return <LocalGame mode={mode} onModeChange={setMode} regular={localRegular} setRegular={setLocalRegular} yard={localYard} setYard={setLocalYard} onBack={() => setLocalMode(false)} />;
  }

  if (code && snapshot) {
    return <OnlineGame
      code={code}
      snapshot={snapshot}
      connection={connection}
      notice={notice}
      userId={user?.id}
      username={user?.username}
      friends={friends.data?.friends ?? []}
      invitePending={inviteFriend.isPending}
      onCopyInvite={() => void copyInvite()}
      onInviteFriend={sendFriendInvite}
      onMove={sendMove}
      onNewRound={() => socket.current?.readyState === WebSocket.OPEN && socket.current.send(JSON.stringify({ type: 'newRound' }))}
    />;
  }

  return <div className="yard-app">
    <YardHeader active="games" username={user?.username} notifications={0} onLogout={() => {}} />
    <main className="yard-main yard-tic-main">
      <Link href="/games" className="yard-tic-back"><ArrowLeft size={14} /> All games</Link>
      <div className="yard-heading">
        <div><p className="yard-kicker">509 YARD / GAMES</p><h1>Tic-Tac-Toe</h1><p className="yard-subtitle">Start a match with a friend on another device.</p></div>
      </div>
      <div className="yard-tic-mode-picker" role="group" aria-label="Game mode">
        <button type="button" aria-pressed={mode === 'regular'} className={mode === 'regular' ? 'is-selected' : ''} onClick={() => setMode('regular')}>
          <b>Regular</b><span>Classic 3 × 3</span>
        </button>
        <button type="button" aria-pressed={mode === 'yard'} className={mode === 'yard' ? 'is-selected' : ''} onClick={() => setMode('yard')}>
          <b>Yard Mode</b><span>Nine grids in one</span>
        </button>
      </div>
      <section className="yard-tic-lobby yard-tic-board-card" aria-label="Online Tic-Tac-Toe">
        <label className="yard-tic-name-field">Your name
          <input className="yard-input" value={user?.username ?? name} disabled={Boolean(user)} maxLength={24} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="yard-tic-room-actions">
          <button type="button" className="yard-button primary" onClick={createOnlineRoom} disabled={createRoom.isPending || !displayName}>
            <Users size={14} /> {createRoom.isPending ? 'Opening room…' : 'Create a room'}
          </button>
          <span className="yard-tic-or">or join a friend</span>
          <form className="yard-tic-join-form" onSubmit={joinOnlineRoom}>
            <input className="yard-input" aria-label="Room code" placeholder="Room code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={8} />
            <button className="yard-button" type="submit" disabled={joinRoom.isPending || !joinCode.trim()}>{joinRoom.isPending ? 'Joining…' : 'Join room'}</button>
          </form>
        </div>
        {notice && <p className="yard-tic-notice" role="alert">{notice}</p>}
        <div className="yard-tic-room-copy">
          <h2>How rooms work</h2>
          <p>Create a room and share its link or code. Your friend takes the other mark, and each move is checked and saved by the server.</p>
        </div>
        <button type="button" className="yard-tic-local-link" onClick={showLocal}>Play locally on this device</button>
      </section>
    </main>
  </div>;
}

function OnlineGame(props: {
  code: string;
  snapshot: RoomSnapshot;
  connection: string;
  notice: string;
  userId?: string;
  username?: string;
  friends: { id: string; username: string }[];
  invitePending: boolean;
  onCopyInvite: () => void;
  onInviteFriend: (id: string) => void;
  onMove: (move: Record<string, unknown>) => void;
  onNewRound: () => void;
}) {
  const { code, snapshot, connection, notice } = props;
  const game = snapshot.state;
  const finished = snapshot.status === 'finished';
  const myTurn = snapshot.status === 'playing' && game.currentPlayer === snapshot.myMark;
  const otherPlayer = snapshot.players.find((player) => player.mark !== snapshot.myMark);
  return <div className="yard-app">
    <YardHeader active="games" username={props.username} notifications={0} onLogout={() => {}} />
    <main className={`yard-main yard-tic-main${snapshot.mode === 'yard' ? ' is-yard-mode' : ''}`}>
      <Link href="/games/tic-tac-toe" className="yard-tic-back"><ArrowLeft size={14} /> Tic-Tac-Toe rooms</Link>
      <div className="yard-heading yard-tic-room-heading">
        <div><p className="yard-kicker">509 YARD / ROOM {code}</p><h1>{snapshot.mode === 'regular' ? 'Regular' : 'Yard Mode'}</h1><p className="yard-subtitle">{connection === 'connected' ? 'Match connected' : 'Reconnecting to your match…'}</p></div>
        <button type="button" className="yard-button" onClick={props.onCopyInvite}><Copy size={14} /> Copy invite link</button>
      </div>
      <div className="yard-tic-layout">
        <section className="yard-tic-board-card" aria-label="Online Tic-Tac-Toe game">
          <p className="yard-tic-status" role="status" aria-live="polite">
            {finished ? game.winner ? <><strong>{game.winner}</strong> wins this round</> : "It's a draw" :
              snapshot.status === 'waiting' ? 'Waiting for your friend to join…' :
                myTurn ? <><strong>Your turn</strong> · You are {snapshot.myMark}</> :
                  <><strong>{otherPlayer?.name ?? 'Your friend'}</strong> is taking a turn</>}
            {snapshot.mode === 'yard' && !finished && snapshot.status === 'playing' && 'nextBoard' in game &&
              <span>{game.nextBoard === null ? ' · Choose any open grid' : ` · Play in grid ${game.nextBoard + 1}`}</span>}
          </p>
          {isRegularState(game)
            ? <div className="yard-tic-board" role="grid" aria-label="Tic-Tac-Toe board">
              {game.board.map((mark, index) => <button
                key={index}
                type="button"
                className="yard-tic-cell"
                data-mark={mark ?? undefined}
                role="gridcell"
                aria-label={`Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}${mark ? `, ${mark}` : ', empty'}`}
                disabled={Boolean(mark || !myTurn)}
                onClick={() => props.onMove({ index })}
              >{mark}</button>)}
            </div>
            : isYardState(game) ? <div className="yard-ultimate-scroll">
              <div className="yard-ultimate-board" role="grid" aria-label="Yard Mode: nine Tic-Tac-Toe grids">
                {game.boards.map((board, boardIndex) => {
                  const result = game.gridResults[boardIndex];
                  const isTarget = game.nextBoard === null || game.nextBoard === boardIndex;
                  return <div
                    key={boardIndex}
                    className={`yard-ultimate-mini${isTarget && !result && !finished ? ' is-target' : ''}${!isTarget && !result && !finished ? ' is-locked' : ''}${result ? ' is-resolved' : ''}`}
                    role="group"
                    aria-label={`Small grid ${boardIndex + 1}${result ? `, ${result === 'draw' ? 'draw' : `${result} won`}` : ''}`}
                  >
                    {board.map((mark, cellIndex) => <button
                      key={cellIndex}
                      type="button"
                      className="yard-ultimate-cell"
                      data-mark={mark ?? undefined}
                      aria-label={`Grid ${boardIndex + 1}, row ${Math.floor(cellIndex / 3) + 1}, column ${(cellIndex % 3) + 1}${mark ? `, ${mark}` : ', empty'}`}
                      disabled={Boolean(result || !isTarget || !myTurn || mark)}
                      onClick={() => props.onMove({ boardIndex, cellIndex })}
                    >{mark}</button>)}
                    {result && <span className={`yard-ultimate-result${result === 'draw' ? ' is-draw' : ''}`} aria-hidden="true">{result === 'draw' ? '—' : result}</span>}
                  </div>;
                })}
              </div>
            </div> : null}
          {notice && <p className="yard-tic-notice" role="alert">{notice}</p>}
          <div className="yard-tic-actions">
            {finished && <button type="button" className="yard-button" onClick={props.onNewRound}><RotateCcw size={14} /> Play another round</button>}
          </div>
        </section>
        <aside className="yard-tic-info">
          <h2>Players</h2>
          <div className="yard-tic-players">
            {(['X', 'O'] as const).map((mark) => {
              const player = snapshot.players.find((entry) => entry.mark === mark);
              return <div className={`yard-tic-player${!finished && game.currentPlayer === mark ? ' is-active' : ''}`} key={mark}>
                <b>{mark}</b>{player?.name ?? (mark === 'X' ? 'Player one' : 'Waiting for player two')}
                {snapshot.myMark === mark && <small> You</small>}
              </div>;
            })}
          </div>
          {snapshot.mode === 'yard' && <p className="yard-tic-rule-note">Your move routes the other player to the matching small grid. If that grid is closed, they can choose any open one.</p>}
          {props.userId && snapshot.status === 'waiting' && props.friends.length > 0 && <div className="yard-tic-friend-invites">
            <label htmlFor="tic-friend-invite">Invite a 509 Yard friend</label>
            <select id="tic-friend-invite" className="yard-input" defaultValue="" onChange={(event) => event.target.value && props.onInviteFriend(event.target.value)} disabled={props.invitePending}>
              <option value="">Choose a friend</option>
              {props.friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.username}</option>)}
            </select>
          </div>}
          <small className="yard-tic-note">Room state and completed rounds are saved, so reconnecting brings you back to this match.</small>
        </aside>
      </div>
    </main>
  </div>;
}

function LocalGame(props: {
  mode: TicTacToeMode;
  onModeChange: (mode: TicTacToeMode) => void;
  regular: TicTacToeState;
  setRegular: Dispatch<SetStateAction<TicTacToeState>>;
  yard: YardTicTacToeState;
  setYard: Dispatch<SetStateAction<YardTicTacToeState>>;
  onBack: () => void;
}) {
  const game = props.mode === 'regular' ? props.regular : props.yard;
  const finished = Boolean(game.winner || game.isDraw);
  return <div className="yard-app">
    <YardHeader active="games" notifications={0} onLogout={() => {}} />
    <main className={`yard-main yard-tic-main${props.mode === 'yard' ? ' is-yard-mode' : ''}`}>
      <button type="button" className="yard-tic-back" onClick={props.onBack}><ArrowLeft size={14} /> Online rooms</button>
      <div className="yard-heading"><div><p className="yard-kicker">509 YARD / LOCAL GAME</p><h1>Tic-Tac-Toe</h1><p className="yard-subtitle">Two players share this device.</p></div></div>
      <div className="yard-tic-mode-picker" role="group" aria-label="Game mode">
        <button type="button" aria-pressed={props.mode === 'regular'} className={props.mode === 'regular' ? 'is-selected' : ''} onClick={() => props.onModeChange('regular')}><b>Regular</b><span>Classic 3 × 3</span></button>
        <button type="button" aria-pressed={props.mode === 'yard'} className={props.mode === 'yard' ? 'is-selected' : ''} onClick={() => props.onModeChange('yard')}><b>Yard Mode</b><span>Nine grids in one</span></button>
      </div>
      <div className="yard-tic-layout">
        <section className="yard-tic-board-card" aria-label="Tic-Tac-Toe game">
          <p className="yard-tic-status" role="status" aria-live="polite">
            {game.winner ? <><strong>{game.winner}</strong> wins this round</> : game.isDraw ? "It's a draw" : <><strong>{game.currentPlayer}</strong>'s turn</>}
            {props.mode === 'yard' && !finished && <span>{props.yard.nextBoard === null ? ' · Choose any open grid' : ` · Play in grid ${props.yard.nextBoard + 1}`}</span>}
          </p>
          {props.mode === 'regular'
            ? <div className="yard-tic-board" role="grid" aria-label="Tic-Tac-Toe board">
              {props.regular.board.map((mark, index) => <button key={index} type="button" className="yard-tic-cell" data-mark={mark ?? undefined} role="gridcell"
                aria-label={`Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}${mark ? `, ${mark}` : ', empty'}`}
                disabled={Boolean(mark || props.regular.winner || props.regular.isDraw)}
                onClick={() => props.setRegular((current) => playTicTacToeMove(current, index))}>{mark}</button>)}
            </div>
            : <div className="yard-ultimate-scroll"><div className="yard-ultimate-board" role="grid" aria-label="Yard Mode: nine Tic-Tac-Toe grids">
              {props.yard.boards.map((board, boardIndex) => {
                const result = props.yard.gridResults[boardIndex];
                const isTarget = props.yard.nextBoard === null || props.yard.nextBoard === boardIndex;
                return <div key={boardIndex} className={`yard-ultimate-mini${isTarget && !result && !finished ? ' is-target' : ''}${!isTarget && !result && !finished ? ' is-locked' : ''}${result ? ' is-resolved' : ''}`}
                  role="group" aria-label={`Small grid ${boardIndex + 1}${result ? `, ${result === 'draw' ? 'draw' : `${result} won`}` : ''}`}>
                  {board.map((mark, cellIndex) => <button key={cellIndex} type="button" className="yard-ultimate-cell" data-mark={mark ?? undefined}
                    aria-label={`Grid ${boardIndex + 1}, row ${Math.floor(cellIndex / 3) + 1}, column ${(cellIndex % 3) + 1}${mark ? `, ${mark}` : ', empty'}`}
                    disabled={Boolean(result || !isTarget || finished || mark)}
                    onClick={() => props.setYard((current) => playYardTicTacToeMove(current, boardIndex, cellIndex))}>{mark}</button>)}
                  {result && <span className={`yard-ultimate-result${result === 'draw' ? ' is-draw' : ''}`} aria-hidden="true">{result === 'draw' ? '—' : result}</span>}
                </div>;
              })}
            </div></div>}
          <div className="yard-tic-actions"><button type="button" className="yard-button" onClick={() => props.mode === 'regular' ? props.setRegular(createTicTacToeState()) : props.setYard(createYardTicTacToeState())}><RotateCcw size={14} /> New round</button></div>
        </section>
        <aside className="yard-tic-info">
          <h2>{props.mode === 'regular' ? 'Regular mode' : 'Yard Mode'}</h2>
          <p>{props.mode === 'regular' ? 'Take turns marking a square. First to line up three wins.' : 'Win small grids to claim their matching space on the big board. Your move sends your opponent to the small grid in the same position.'}</p>
          {props.mode === 'yard' && <p className="yard-tic-rule-note">If your move sends the other player to a grid that is already won or full, they may choose any open grid.</p>}
          <div className="yard-tic-players">
            <div className={`yard-tic-player${!finished && game.currentPlayer === 'X' ? ' is-active' : ''}`}><b>X</b> Player one</div>
            <div className={`yard-tic-player${!finished && game.currentPlayer === 'O' ? ' is-active' : ''}`}><b>O</b> Player two</div>
          </div>
          <small className="yard-tic-note">Local pass-and-play.</small>
        </aside>
      </div>
    </main>
  </div>;
}
