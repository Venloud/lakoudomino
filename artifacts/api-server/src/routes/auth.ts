import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db, dominoUsers, dominoUserIdentities, dominoSessions, dominoMatches, dominoMatchResults, ticTacToeResults } from "@workspace/db";
import { createAuthSession, getIdentityFromRequest, hashSessionToken, setAuthCookie, clearAuthCookie } from "../lib/auth-session";
import { GetTicTacToeResultsResponse } from "@workspace/api-zod";

const router = Router();
const usernamePattern = /^[A-Za-z0-9_]{3,16}$/;
const attempts = new Map<string, { count: number; at: number }>();
const GOOGLE_STATE_COOKIE = "lakou.google.state";
const GOOGLE_NONCE_COOKIE = "lakou.google.nonce";
const OAUTH_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 10 * 60 * 1000, path: "/api/auth/google" };
function limited(key: string): boolean {
  const now = Date.now(), item = attempts.get(key);
  if (!item || now - item.at > 60_000) { attempts.set(key, { count: 1, at: now }); return false; }
  item.count++; return item.count > 10;
}
const publicUser = (u: typeof dominoUsers.$inferSelect) => ({
  id: u.id, username: u.username, crownPoints: u.crownPoints, games: u.games, wins: u.wins,
  gold: u.gold, silver: u.silver, bronze: u.bronze,
});
function googleRedirectUri(req: Parameters<Parameters<typeof router.get>[1]>[0]): string {
  const proto = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) throw new Error("Invalid OAuth callback host");
  return `${proto}://${host}/api/auth/google/callback`;
}
function googleOAuthClient(req: Parameters<Parameters<typeof router.get>[1]>[0]): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google sign-in is not configured");
  return new OAuth2Client(clientId, clientSecret, googleRedirectUri(req));
}
function clearGoogleOAuthCookies(res: Parameters<Parameters<typeof router.get>[1]>[1]): void {
  res.clearCookie(GOOGLE_STATE_COOKIE, { ...OAUTH_COOKIE_OPTIONS, maxAge: undefined });
  res.clearCookie(GOOGLE_NONCE_COOKIE, { ...OAUTH_COOKIE_OPTIONS, maxAge: undefined });
}
function sameSecret(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
async function findOrCreateGoogleUser(providerUserId: string, email: string, displayName: string) {
  return db.transaction(async (tx) => {
    const [existingIdentity] = await tx.select().from(dominoUserIdentities).where(and(
      eq(dominoUserIdentities.provider, "google"),
      eq(dominoUserIdentities.providerUserId, providerUserId),
    )).limit(1);
    if (existingIdentity) {
      const [user] = await tx.select().from(dominoUsers).where(eq(dominoUsers.id, existingIdentity.userId)).limit(1);
      if (user) return user;
    }

    const source = (displayName || email.split("@")[0]).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 10);
    const stem = source.length >= 3 ? source : "yardplayer";
    let user: typeof dominoUsers.$inferSelect | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      const username = `${stem.slice(0, 11)}_${randomBytes(2).toString("hex")}`.slice(0, 16);
      const [created] = await tx.insert(dominoUsers).values({ username, passwordHash: null }).onConflictDoNothing().returning();
      if (created) { user = created; break; }
    }
    if (!user) throw new Error("Could not create a unique Google account username");
    await tx.insert(dominoUserIdentities).values({
      userId: user.id,
      provider: "google",
      providerUserId,
      email: email.toLowerCase(),
    });
    return user;
  });
}

router.get("/auth/google", (req, res): void => {
  try {
    const client = googleOAuthClient(req);
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    res.cookie(GOOGLE_STATE_COOKIE, state, OAUTH_COOKIE_OPTIONS);
    res.cookie(GOOGLE_NONCE_COOKIE, nonce, OAUTH_COOKIE_OPTIONS);
    res.redirect(client.generateAuthUrl({
      response_type: "code",
      scope: ["openid", "email", "profile"],
      state,
      nonce,
      prompt: "select_account",
    }));
  } catch (error) {
    req.log.warn({ err: error }, "Google sign-in unavailable");
    res.redirect("/sign-in?error=google_setup");
  }
});

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const stateCookie = req.cookies?.[GOOGLE_STATE_COOKIE] as string | undefined;
  const nonceCookie = req.cookies?.[GOOGLE_NONCE_COOKIE] as string | undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  clearGoogleOAuthCookies(res);
  if (!sameSecret(stateCookie, state) || typeof req.query.code !== "string" || !nonceCookie) {
    res.redirect("/sign-in?error=google_state"); return;
  }
  try {
    const client = googleOAuthClient(req);
    const { tokens } = await client.getToken({ code: req.query.code, redirect_uri: googleRedirectUri(req) });
    if (!tokens.id_token) throw new Error("Google did not return an ID token");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || profile.email_verified !== true || profile.nonce !== nonceCookie) {
      throw new Error("Google identity is missing verified claims");
    }
    const user = await findOrCreateGoogleUser(profile.sub, profile.email, profile.name ?? "");
    await db.update(dominoUsers).set({ lastSeenAt: new Date() }).where(eq(dominoUsers.id, user.id));
    const session = await createAuthSession(user.id);
    setAuthCookie(res, session.token);
    res.redirect("/");
  } catch (error) {
    req.log.warn({ err: error }, "Google sign-in failed");
    res.redirect("/sign-in?error=google_failed");
  }
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const identity = await getIdentityFromRequest(req);
  if (!identity) { res.json({ user: null }); return; }
  const [user] = await db.select().from(dominoUsers).where(eq(dominoUsers.id, identity.userId));
  res.json({ user: user ? publicUser(user) : null });
});
router.get("/auth/recent-matches", async (req, res): Promise<void> => {
  const identity = await getIdentityFromRequest(req);
  if (!identity) { res.status(401).json({ error: "Authentication required" }); return; }
  const matches = await db.select({
    matchId: dominoMatches.matchId,
    roomCode: dominoMatches.roomCode,
    mode: dominoMatches.mode,
    recordedAt: dominoMatches.recordedAt,
    rank: dominoMatchResults.rank,
    medal: dominoMatchResults.medal,
    crownPoints: dominoMatchResults.crownPoints,
    won: dominoMatchResults.won,
  }).from(dominoMatchResults)
    .innerJoin(dominoMatches, eq(dominoMatchResults.matchId, dominoMatches.matchId))
    .where(eq(dominoMatchResults.userId, identity.userId))
    .orderBy(desc(dominoMatches.recordedAt))
    .limit(8);
  res.json({ matches });
});
router.get("/auth/tic-tac-toe-results", async (req, res): Promise<void> => {
  const identity = await getIdentityFromRequest(req);
  if (!identity) { res.status(401).json({ error: "Authentication required" }); return; }
  const [totals] = await db.select({
    games: count(),
    wins: sql<number>`count(*) filter (where ${ticTacToeResults.outcome} = 'win')`,
    losses: sql<number>`count(*) filter (where ${ticTacToeResults.outcome} = 'loss')`,
    draws: sql<number>`count(*) filter (where ${ticTacToeResults.outcome} = 'draw')`,
  }).from(ticTacToeResults).where(eq(ticTacToeResults.userId, identity.userId));
  const results = await db.select({
    id: ticTacToeResults.id,
    roomCode: ticTacToeResults.roomCode,
    mode: ticTacToeResults.mode,
    outcome: ticTacToeResults.outcome,
    mark: ticTacToeResults.mark,
    opponentName: ticTacToeResults.opponentName,
    completedAt: ticTacToeResults.completedAt,
  }).from(ticTacToeResults)
    .where(eq(ticTacToeResults.userId, identity.userId))
    .orderBy(desc(ticTacToeResults.completedAt))
    .limit(8);
  res.json(GetTicTacToeResultsResponse.parse({
    summary: {
      games: Number(totals?.games ?? 0),
      wins: Number(totals?.wins ?? 0),
      losses: Number(totals?.losses ?? 0),
      draws: Number(totals?.draws ?? 0),
    },
    results,
  }));
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
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) { res.status(401).json({ error: "Invalid username or password" }); return; }
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