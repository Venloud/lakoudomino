import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, dominoUsers, dominoSessions } from "@workspace/db";
import { createAuthSession, getIdentityFromRequest, hashSessionToken, setAuthCookie, clearAuthCookie } from "../lib/auth-session";

const router = Router();
const usernamePattern = /^[A-Za-z0-9_]{3,16}$/;
const attempts = new Map<string, { count: number; at: number }>();
function limited(key: string): boolean {
  const now = Date.now(), item = attempts.get(key);
  if (!item || now - item.at > 60_000) { attempts.set(key, { count: 1, at: now }); return false; }
  item.count++; return item.count > 10;
}
const publicUser = (u: typeof dominoUsers.$inferSelect) => ({
  id: u.id, username: u.username, crownPoints: u.crownPoints, games: u.games, wins: u.wins,
  gold: u.gold, silver: u.silver, bronze: u.bronze,
});
router.get("/auth/me", async (req, res): Promise<void> => {
  const identity = await getIdentityFromRequest(req);
  if (!identity) { res.json({ user: null }); return; }
  const [user] = await db.select().from(dominoUsers).where(eq(dominoUsers.id, identity.userId));
  res.json({ user: user ? publicUser(user) : null });
});
router.post("/auth/signup", async (req, res): Promise<void> => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!usernamePattern.test(username) || Buffer.byteLength(password, "utf8") < 8 || Buffer.byteLength(password, "utf8") > 72) {
    res.status(400).json({ error: "Invalid username or password" }); return;
  }
  if (limited(req.ip ?? "unknown")) { res.status(429).json({ error: "Too many attempts" }); return; }
  try {
    const [user] = await db.insert(dominoUsers).values({ username: username.toLowerCase(), passwordHash: await bcrypt.hash(password, 12) }).returning();
    const session = await createAuthSession(user.id); setAuthCookie(res, session.token);
    res.status(201).json({ user: publicUser(user) });
  } catch { res.status(409).json({ error: "Unable to create account" }); }
});
router.post("/auth/login", async (req, res): Promise<void> => {
  const username = typeof req.body?.username === "string" ? req.body.username.toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (limited(req.ip ?? "unknown")) { res.status(429).json({ error: "Too many attempts" }); return; }
  const [user] = await db.select().from(dominoUsers).where(eq(dominoUsers.username, username));
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) { res.status(401).json({ error: "Invalid username or password" }); return; }
  await db.update(dominoUsers).set({ lastSeenAt: new Date() }).where(eq(dominoUsers.id, user.id));
  const session = await createAuthSession(user.id); setAuthCookie(res, session.token);
  res.json({ user: publicUser(user) });
});
router.post("/auth/logout", async (req, res): Promise<void> => {
  const cookie = req.headers.cookie?.split(";").map((x) => x.trim()).find((x) => x.startsWith("lakou.sid="))?.slice(10);
  if (cookie) await db.delete(dominoSessions).where(eq(dominoSessions.tokenHash, hashSessionToken(cookie)));
  clearAuthCookie(res); res.status(204).send();
});
export default router;