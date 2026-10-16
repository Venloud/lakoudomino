import { createHash } from "node:crypto";
import type { MatchState } from "lakou-engine";
import { publicView } from "./lakou-engine-adapter.ts";
import type { PersistedRoomState, PersistedSeatState } from "./room-types";
type BoardEnd = "left" | "right" | "top" | "bottom";

export type SocketEvent =
  | { type: "hello"; reconnectToken?: string; displayName?: string }
  | { type: "play"; tileId: string; side: BoardEnd }
  | { type: "pass" }
  | { type: "draw" }
  | { type: "nextHand" }
  | { type: "playAgain" }
  | { type: "changeSettings"; mode: "regular" | "points"; rowBoxes: number; turnSeconds: number; isPrivate: boolean }
  | { type: "chat"; text: string };
export const SOCKET_PROTOCOL_ERROR = "That message was not understood";
export const SOCKET_AUTHENTICATION_ERROR = "Introduce yourself before playing";
export const hashReconnectToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function emptySeats(): PersistedSeatState[] {
  return [0, 1, 2, 3].map((seat) => ({
    seat: seat as 0 | 1 | 2 | 3, status: "open", name: null,
    reconnectTokenHash: null, hand: [], score: 0,
  }));
}
export function resolveSeatForReconnect(
  seats: readonly PersistedSeatState[], token: string,
): number | undefined {
  const hash = hashReconnectToken(token);
  return seats.find((s) => s.reconnectTokenHash === hash)?.seat;
}
type NextHandRoom = Pick<PersistedRoomState, "mode" | "engineState" | "seats" | "playNow">;

export function nextHandSeatEligibility(room: NextHandRoom, seat: number | undefined) {
  if (!room.engineState || room.engineState.over || !room.engineState.hand.over)
    return { allowed: false as const, reason: "This room is not ready for another hand" };
  if (room.mode !== "points" || room.engineState.config.mode !== "points")
    return { allowed: false as const, reason: "This game does not have another hand" };
  const player = room.seats.find((candidate) => candidate.seat === seat);
  if (seat === undefined || !player || player.status === "open" ||
    player.status === "bot" || !player.reconnectTokenHash)
    return { allowed: false as const, reason: "Only a seated player can start the next hand" };
  const sharedStart = Boolean(room.playNow || room.seats.some((candidate) => candidate.status === "bot"));
  if (seat !== 0 && !sharedStart)
    return { allowed: false as const, reason: "Only the host can start the next hand" };
  return {
    allowed: true as const,
    requestingSeat: player.seat,
    starterSeat: room.engineState.hand.winner ?? 0,
  };
}

export function nextHandEligibility(room: NextHandRoom, token: string) {
  return nextHandSeatEligibility(room, resolveSeatForReconnect(room.seats, token));
}
export function parseSocketEvent(value: string) {
  try {
    const e = JSON.parse(value) as Partial<SocketEvent>;
    if (e.type === "hello" &&
      (e.reconnectToken === undefined || typeof e.reconnectToken === "string") &&
      (e.displayName === undefined || typeof e.displayName === "string"))
      return { ok: true as const, event: e as SocketEvent };
    if (e.type === "play" && typeof e.tileId === "string" &&
      typeof e.side === "string" && ["left", "right", "top", "bottom"].includes(e.side))
      return { ok: true as const, event: e as SocketEvent };
    if (e.type === "pass" || e.type === "draw" || e.type === "playAgain")
      return { ok: true as const, event: e as SocketEvent };
    if (e.type === "nextHand")
      return { ok: true as const, event: e as SocketEvent };
    if (e.type === "changeSettings" &&
      (e.mode === "regular" || e.mode === "points") &&
      typeof e.rowBoxes === "number" && Number.isInteger(e.rowBoxes) &&
      typeof e.turnSeconds === "number" && Number.isInteger(e.turnSeconds) &&
      typeof e.isPrivate === "boolean")
      return { ok: true as const, event: e as SocketEvent };
    if (e.type === "chat" && typeof e.text === "string" &&
      e.text.trim().length > 0 && e.text.trim().length <= 160)
      return { ok: true as const, event: { type: "chat", text: e.text.trim() } as SocketEvent };
  } catch { /* handled below */ }
  return { ok: false as const, error: SOCKET_PROTOCOL_ERROR };
}
export function validateSocketMessage(value: string, seat: number | undefined) {
  const parsed = parseSocketEvent(value);
  if (!parsed.ok) return parsed;
  if ((parsed.event.type === "play" || parsed.event.type === "pass" ||
    parsed.event.type === "draw" || parsed.event.type === "playAgain" ||
    parsed.event.type === "nextHand" || parsed.event.type === "changeSettings") && seat === undefined)
    return { ok: false as const, error: SOCKET_AUTHENTICATION_ERROR };
  return parsed;
}
export function gameSnapshot(room: PersistedRoomState, seat: number | null = null) {
  if (!room.engineState) throw new Error("Room has no engine match");
  const view = publicView(room.engineState as MatchState, seat);
  const tile = (t: [number, number]) => ({ id: `${t[0]}-${t[1]}`, left: t[0], right: t[1] });
  const engineView = view.revealedHands
    ? { ...view, revealedHands: view.revealedHands.map((hand) => hand.map(tile)) }
    : view;
  return {
    code: room.code, mode: room.mode, hand: view.myHand.map(tile),
    players: room.seats.filter((s) => s.name).map((s) => ({
      seat: s.seat, name: s.name!, tileCount: view.handCounts[s.seat] ?? 0,
      score: view.scores[s.seat] ?? 0,
    })),
    turnSeat: view.turn, board: view.board.history.map((h) => tile(h.tile)),
    branchTiles: [], openEnds: Object.entries(view.board.arms).map(([id, arm]) => ({
      id: ({ W: "left", E: "right", N: "top", S: "bottom" } as Record<string, string>)[id],
      value: arm!.value,
    })),
    yourSeat: seat, lastAction: room.lastAction, handNumber: view.handNumber,
    handPoints: view.scores, winnerSeat: view.ranking?.[0] ?? null,
    gameFinished: view.matchOver, engine: engineView,
  };
}