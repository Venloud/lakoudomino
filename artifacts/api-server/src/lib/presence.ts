import { eq } from "drizzle-orm";
import WebSocket from "ws";
import { db, dominoUsers } from "@workspace/db";
import { logger } from "./logger";

export type Presence = { status: "lobby" | "game" | "online"; detail?: string; roomCode?: string };
export type PresenceClient = "lobby" | "room";
export type PresenceRegistration = {
  identityKey: string;
  userId: string | null;
  username: string | null;
  client: PresenceClient;
  status: Presence["status"];
  detail?: string;
  roomCode?: string;
};
type Connection = PresenceRegistration & { socket: WebSocket };

const connections = new Map<WebSocket, Connection>();
const isOpen = (socket: WebSocket) => socket.readyState === WebSocket.OPEN;

function activeConnections(): Connection[] {
  return [...connections.values()].filter(({ socket }) => isOpen(socket));
}

function send(socket: WebSocket, message: unknown): void {
  if (isOpen(socket)) socket.send(JSON.stringify(message));
}

export function broadcastToLobbyClients(message: unknown): void {
  for (const connection of activeConnections()) {
    if (connection.client === "lobby") send(connection.socket, message);
  }
}

export function broadcastPresenceChanged(): void {
  broadcastToLobbyClients({ type: "presenceChanged" });
}

export function trackPresence(socket: WebSocket, registration: PresenceRegistration): void {
  connections.set(socket, { ...registration, socket });
  broadcastPresenceChanged();
}

export function updatePresence(
  socket: WebSocket,
  update: Partial<Pick<PresenceRegistration, "status" | "detail" | "roomCode">>,
): void {
  const previous = connections.get(socket);
  if (!previous) return;
  connections.set(socket, { ...previous, ...update, socket });
  broadcastPresenceChanged();
}

export function clearPresence(socket: WebSocket): void {
  const previous = connections.get(socket);
  if (!previous) return;
  connections.delete(socket);

  if (previous.userId && !activeConnections().some(({ userId }) => userId === previous.userId)) {
    void db.update(dominoUsers)
      .set({ lastSeenAt: new Date() })
      .where(eq(dominoUsers.id, previous.userId))
      .catch((error: unknown) => logger.error({ err: error }, "Failed to save player last-seen time"));
  }
  broadcastPresenceChanged();
}

export function getPresenceForUser(userId: string): Presence | null {
  const candidates = activeConnections().filter((connection) => connection.userId === userId);
  if (!candidates.length) return null;
  const priority: Record<Presence["status"], number> = { game: 3, lobby: 2, online: 1 };
  const current = candidates.reduce((best, item) =>
    priority[item.status] > priority[best.status] ? item : best,
  );
  return {
    status: current.status,
    ...(current.detail ? { detail: current.detail } : {}),
    ...(current.status === "game" && current.roomCode ? { roomCode: current.roomCode } : {}),
  };
}

export function uniqueOnlinePlayerCount(): number {
  return new Set(activeConnections().map(({ userId, identityKey }) =>
    userId ? `user:${userId}` : identityKey,
  )).size;
}

export function sendToUser(userId: string, message: unknown): void {
  for (const connection of activeConnections()) {
    if (connection.userId === userId) send(connection.socket, message);
  }
}