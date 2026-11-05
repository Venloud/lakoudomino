import { useEffect, useMemo, useRef, useState } from "react";

type PublicRoom = {
  code: string;
  game: string;
  capacity: number;
  status: "waiting" | "playing";
  players: { name: string; seat: number }[];
  state: unknown;
  turn: number;
};
type Access = { code: string; reconnectToken: string; seat: number };
type Props = {
  game: string;
  playerCount?: 2 | 3 | 4;
  turn: number;
  state: unknown;
  onRemoteState: (state: unknown) => void;
  onRoomChange?: (session: { seat: number; connected: boolean; turn: number | null } | null) => void;
};

const storageKey = (game: string) => `509-yard-arcade-room:${game}`;
const isRoom = (value: unknown): value is PublicRoom =>
  !!value && typeof value === "object" &&
  typeof (value as PublicRoom).code === "string" &&
  Array.isArray((value as PublicRoom).players);

export function ArcadeOnlinePanel({ game, playerCount = 2, turn, state, onRemoteState, onRoomChange }: Props) {
  const [name, setName] = useState(() => localStorage.getItem("yard-display-name") ?? "");
  const [codeInput, setCodeInput] = useState("");
  const [access, setAccess] = useState<Access | null>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey(game)) ?? "null");
      return value && typeof value.code === "string" && typeof value.reconnectToken === "string" &&
        Number.isInteger(value.seat) ? value as Access : null;
    } catch { return null; }
  });
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const lastReceivedRef = useRef("");
  const stateJson = useMemo(() => JSON.stringify(state), [state]);

  useEffect(() => {
    onRoomChange?.(access ? { seat: access.seat, connected, turn: room?.turn ?? null } : null);
  }, [access, connected, room?.turn, onRoomChange]);

  useEffect(() => {
    if (!access) return;
    let socket: WebSocket;
    let disposed = false;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${protocol}://${window.location.host}/ws?arcadeCode=${encodeURIComponent(access.code)}&token=${encodeURIComponent(access.reconnectToken)}`);
    socketRef.current = socket;
    socket.addEventListener("open", () => { if (!disposed) setConnected(true); });
    socket.addEventListener("close", () => { if (!disposed) setConnected(false); });
    socket.addEventListener("error", () => { if (!disposed) setNotice("Connection interrupted. Reconnecting may help."); });
    socket.addEventListener("message", (event) => {
      let message: unknown;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message || typeof message !== "object") return;
      const data = message as Record<string, unknown>;
      if (data.type === "error" && typeof data.message === "string") {
        setNotice(data.message);
      } else if ((data.type === "room" || data.type === "state") && isRoom(data.room)) {
        setRoom(data.room);
        if (data.room.state !== null && data.room.state !== undefined) {
            const ownState = game === "block-drop" && Array.isArray(data.room.state)
              ? data.room.state[access.seat]
              : data.room.state;
            const serialized = JSON.stringify(ownState);
          lastReceivedRef.current = serialized;
          onRemoteState(data.room.state);
        }
      } else if (data.type === "resigned") {
        setNotice("Your opponent resigned.");
      }
    });
    return () => {
      disposed = true;
      socketRef.current = null;
      socket.close();
    };
  }, [access, onRemoteState]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!access || !room || !connected || socket?.readyState !== WebSocket.OPEN ||
        (game !== "block-drop" && access.seat !== room.turn) || stateJson === lastReceivedRef.current) return;
    const publish = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "state", state, turn }));
      lastReceivedRef.current = stateJson;
    };
    if (game === "block-drop") {
      const timer = window.setTimeout(publish, 180);
      return () => window.clearTimeout(timer);
    }
    publish();
    return undefined;
  }, [access, room, connected, game, state, stateJson, turn]);

  const requestRoom = async (endpoint: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game, displayName: name, playerCount, ...payload }),
      });
      const result = await response.json() as Access & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not join that room.");
      localStorage.setItem("yard-display-name", name.trim());
      const next = { code: result.code, seat: result.seat, reconnectToken: result.reconnectToken };
      sessionStorage.setItem(storageKey(game), JSON.stringify(next));
      lastReceivedRef.current = "";
      setAccess(next);
      setRoom(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not reach the game server.");
    } finally {
      setBusy(false);
    }
  };

  const leaveRoom = () => {
    socketRef.current?.send(JSON.stringify({ type: "resign" }));
    socketRef.current?.close();
    sessionStorage.removeItem(storageKey(game));
    setAccess(null);
    setRoom(null);
    setConnected(false);
    lastReceivedRef.current = "";
  };

  return <section className="yard-panel" aria-label="Online match" style={{ padding: 14, marginBottom: 14 }}>
    {access ? <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <strong>Room {access.code}</strong>
        <span role="status">{connected ? room?.status === "playing" ? "Opponent connected" : "Waiting for players" : "Connecting…"}</span>
        <button className="yard-button" type="button" onClick={leaveRoom}>Leave online game</button>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, color: "#a6a6aa", fontSize: 12 }}>
        {room?.players.map((player) => <span key={player.seat}>{player.seat === access.seat ? "You" : player.name} · Player {player.seat + 1}</span>)}
      </div>
      {room?.status === "waiting" && <p style={{ margin: "8px 0 0", color: "#a6a6aa", fontSize: 12 }}>Share this room code with a friend: <b>{access.code}</b></p>}
    </> : <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "center", gap: 8 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Your name
          <input className="yard-input" value={name} maxLength={24} onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="yard-button primary" type="button" disabled={busy || !name.trim()} onClick={() => void requestRoom("/api/arcade/quick-match", {})}>Find a match</button>
        <button className="yard-button" type="button" disabled={busy || !name.trim()} onClick={() => void requestRoom("/api/arcade/rooms", { isPrivate: true })}>Create private room</button>
        <form style={{ display: "flex", gap: 6 }} onSubmit={(event) => { event.preventDefault(); if (codeInput.trim()) void requestRoom(`/api/arcade/rooms/${encodeURIComponent(codeInput.trim())}/join`, {}); }}>
          <input className="yard-input" value={codeInput} maxLength={8} placeholder="Room code" aria-label="Room code" onChange={(event) => setCodeInput(event.target.value.toUpperCase())} />
          <button className="yard-button" disabled={busy || !name.trim() || !codeInput.trim()}>Join</button>
        </form>
      </div>
    </>}
    {notice && <p role="alert" style={{ margin: "8px 0 0", color: "#ef9b8d", textAlign: "center" }}>{notice}</p>}
  </section>;
}
