import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, dominoSessions, dominoUsers } from "@workspace/db";

export type AuthIdentity = { sessionId: string; userId: string; username: string };
const COOKIE = "lakou.sid";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function parseCookie(header?: string): string | undefined {
  return header?.split(";").map((x) => x.trim()).find((x) => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}
export async function getIdentityFromCookieHeader(cookieHeader: string | undefined): Promise<AuthIdentity | null> {
  const token = parseCookie(cookieHeader);
  if (!token) return null;
  const rows = await db.select({ session: dominoSessions, username: dominoUsers.username })
    .from(dominoSessions).leftJoin(dominoUsers, eq(dominoSessions.userId, dominoUsers.id))
    .where(and(eq(dominoSessions.tokenHash, hash(token)), gt(dominoSessions.expiresAt, new Date())));
  const row = rows[0];
  return row?.session.userId && row.username ? { sessionId: row.session.tokenHash, userId: row.session.userId, username: row.username } : null;
}
export const getIdentityFromRequest = (req: Request) => getIdentityFromCookieHeader(req.headers.cookie);
export async function createAuthSession(userId: string): Promise<{ token: string; identity: AuthIdentity }> {
  const token = randomBytes(32).toString("base64url");
  const [user] = await db.select({ username: dominoUsers.username }).from(dominoUsers).where(eq(dominoUsers.id, userId));
  if (!user) throw new Error("User not found");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const tokenHash = hash(token);
  await db.insert(dominoSessions).values({ tokenHash, userId, expiresAt });
  return { token, identity: { sessionId: tokenHash, userId, username: user.username } };
}
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 86400000, path: "/" });
}
export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
}
export { hash as hashSessionToken, parseCookie };