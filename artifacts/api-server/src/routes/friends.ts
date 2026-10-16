import { Router } from "express";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { db, dominoFriendInvites, dominoFriendships, dominoRooms, dominoUsers } from "@workspace/db";
import { getIdentityFromRequest } from "../lib/auth-session";
import { getPresenceForUser, sendToUser } from "../lib/presence";

const router = Router();
function pair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }
async function identity(req: Parameters<typeof getIdentityFromRequest>[0], res: any) {
  const value = await getIdentityFromRequest(req); if (!value) { res.status(401).json({ error: "Authentication required" }); return null; } return value;
}
function protectedMutation(req: any): boolean {
  if (req.headers["x-lakou-client"] !== "lakou") return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host.toLowerCase() === String(req.get("host") ?? "").toLowerCase();
  } catch {
    return false;
  }
}
router.get("/friends", async (req, res): Promise<void> => {
  const me = await identity(req, res); if (!me) return;
  const links = await db.select().from(dominoFriendships).where(or(eq(dominoFriendships.userLow, me.userId), eq(dominoFriendships.userHigh, me.userId)));
  const acceptedLinks = links.filter((link) => link.status === "accepted");
  const ids = acceptedLinks.flatMap((f) => [f.userLow, f.userHigh]).filter((id, i, a) => id !== me.userId && a.indexOf(id) === i);
  const users = ids.length ? await db.select().from(dominoUsers).where(inArray(dominoUsers.id, ids)) : [];
  const inbound = links.filter((f) => f.status === "pending" && f.requesterId !== me.userId);
  const requesterIds = [...new Set(inbound.map((request) => request.requesterId))];
  const requesters = requesterIds.length
    ? await db.select({ id: dominoUsers.id, username: dominoUsers.username }).from(dominoUsers).where(inArray(dominoUsers.id, requesterIds))
    : [];
  const requesterNames = new Map(requesters.map((user) => [user.id, user.username]));
  const invites = await db.select({ invite: dominoFriendInvites, username: dominoUsers.username }).from(dominoFriendInvites)
    .innerJoin(dominoUsers, eq(dominoFriendInvites.inviterId, dominoUsers.id))
    .where(and(eq(dominoFriendInvites.inviteeId, me.userId), eq(dominoFriendInvites.status, "pending")));
  res.json({
    friends: users.map((u) => ({ id: u.id, username: u.username, status: getPresenceForUser(u.id) })),
    requests: inbound.map((request) => ({
      id: request.id,
      requesterId: request.requesterId,
      username: requesterNames.get(request.requesterId) ?? "Player",
      status: "pending" as const,
    })),
    invites: invites.map((x) => ({
      id: x.invite.id,
      inviterId: x.invite.inviterId,
      inviterName: x.username,
      roomCode: x.invite.roomCode,
      status: "pending" as const,
    })),
  });
});
router.post("/friends/requests", async (req, res): Promise<void> => {
  const me = await identity(req, res); if (!me) return;
  if (!protectedMutation(req)) { res.status(403).json({ error: "Invalid client" }); return; }
  const username = typeof req.body?.username === "string" ? req.body.username.toLowerCase() : "";
  const [other] = await db.select().from(dominoUsers).where(eq(dominoUsers.username, username));
  if (!other || other.id === me.userId) { res.status(404).json({ error: "User not found" }); return; }
  const [userLow, userHigh] = pair(me.userId, other.id);
  const [existing] = await db.select().from(dominoFriendships).where(and(eq(dominoFriendships.userLow, userLow), eq(dominoFriendships.userHigh, userHigh)));
  if (existing) { res.json(existing); return; }
  const [friendship] = await db.insert(dominoFriendships).values({ userLow, userHigh, requesterId: me.userId }).returning();
  sendToUser(other.id, { type: "friendRequest", friendshipId: friendship.id }); res.status(201).json(friendship);
});
router.post("/friends/requests/:id/accept", async (req, res): Promise<void> => updateRequest(req, res, "accepted"));
router.post("/friends/requests/:id/decline", async (req, res): Promise<void> => updateRequest(req, res, "declined"));
async function updateRequest(req: any, res: any, status: string) {
  const me = await identity(req, res); if (!me) return; if (!protectedMutation(req)) { res.status(403).json({ error: "Invalid client" }); return; }
  const isInboundRequest = or(
    and(eq(dominoFriendships.userLow, me.userId), ne(dominoFriendships.requesterId, me.userId)),
    and(eq(dominoFriendships.userHigh, me.userId), ne(dominoFriendships.requesterId, me.userId)),
  );
  const [row] = await db.update(dominoFriendships).set({ status }).where(and(
    eq(dominoFriendships.id, req.params.id),
    eq(dominoFriendships.status, "pending"),
    isInboundRequest,
  )).returning();
  if (!row) { res.status(404).json({ error: "Request not found" }); return; }
  const recipientId = row.requesterId;
  sendToUser(recipientId, { type: "friendRequestUpdated", friendshipId: row.id, status });
  res.json(row);
}
router.post("/friends/invites", async (req, res): Promise<void> => {
  const me = await identity(req, res); if (!me) return; if (!protectedMutation(req)) { res.status(403).json({ error: "Invalid client" }); return; }
  const friendId = typeof req.body?.friendId === "string" ? req.body.friendId : "";
  const roomCode = typeof req.body?.roomCode === "string" ? req.body.roomCode.toUpperCase() : "";
  if (!/^[A-Z0-9]{4,8}$/.test(roomCode) || !friendId || friendId === me.userId) {
    res.status(400).json({ error: "Invalid invite" }); return;
  }
  const [friend] = await db.select().from(dominoFriendships).where(and(
    eq(dominoFriendships.status, "accepted"),
    or(
      and(eq(dominoFriendships.userLow, me.userId), eq(dominoFriendships.userHigh, friendId)),
      and(eq(dominoFriendships.userLow, friendId), eq(dominoFriendships.userHigh, me.userId)),
    ),
  ));
  if (!friend) { res.status(404).json({ error: "Friendship not found" }); return; }
  const [room] = await db.select({ code: dominoRooms.code }).from(dominoRooms).where(and(
    eq(dominoRooms.code, roomCode),
    eq(dominoRooms.status, "waiting"),
  ));
  if (!room) { res.status(404).json({ error: "Waiting room not found" }); return; }
  const invitee = friend.userLow === me.userId ? friend.userHigh : friend.userLow;
  const [invite] = await db.insert(dominoFriendInvites).values({ inviterId: me.userId, inviteeId: invitee, roomCode }).returning();
  sendToUser(invitee, { type: "roomInvite", roomCode: invite.roomCode, id: invite.id }); res.status(201).json(invite);
});
router.post("/friends/invites/:id/accept", async (req, res): Promise<void> => inviteAction(req, res, "accepted"));
router.post("/friends/invites/:id/dismiss", async (req, res): Promise<void> => inviteAction(req, res, "dismissed"));
async function inviteAction(req: any, res: any, status: string) {
  const me = await identity(req, res); if (!me) return; if (!protectedMutation(req)) { res.status(403).json({ error: "Invalid client" }); return; }
  const [invite] = await db.update(dominoFriendInvites).set({ status }).where(and(eq(dominoFriendInvites.id, req.params.id), eq(dominoFriendInvites.inviteeId, me.userId), eq(dominoFriendInvites.status, "pending"))).returning();
  if (!invite) { res.status(404).json({ error: "Invite not found" }); return; } res.json(status === "accepted" ? { roomCode: invite.roomCode } : { ok: true });
}
export { pair };
export default router;