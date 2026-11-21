import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { type AppEnv, type C, type Env, type SessionUser, HttpError, id, now, parseJson, sha256, token } from './core';
import type { Ctx } from './events';

export const COOKIE = 'aether_session';
const SESSION_DAYS = 30;

export function ctxOf(c: C): Ctx {
  return { env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p), origin: new URL(c.req.url).origin };
}

export async function createSession(c: C, userId: string) {
  const raw = token(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await c.env.DB.prepare(`INSERT INTO sessions (id, user_id, user_agent, created_at, expires_at) VALUES (?,?,?,?,?)`)
    .bind(await sha256(raw), userId, (c.req.header('user-agent') ?? '').slice(0, 200), now(), expires)
    .run();
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, COOKIE, raw, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 });
}

export async function destroySession(c: C) {
  const raw = getCookie(c, COOKIE);
  if (raw) await c.env.DB.prepare(`DELETE FROM sessions WHERE id=?`).bind(await sha256(raw)).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function userFromRequest(env: Env, raw: string | undefined): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!raw) return null;
  const sid = await sha256(raw);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.status, u.prefs, s.expires_at, u.last_seen_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?`,
  )
    .bind(sid)
    .first<{ id: string; email: string; name: string; role: SessionUser['role']; status: string; prefs: string; expires_at: string; last_seen_at: string | null }>();
  if (!row || row.status !== 'active' || row.expires_at < now()) return null;
  // Touch last_seen at most every 5 minutes.
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 300_000) {
    await env.DB.prepare(`UPDATE users SET last_seen_at=? WHERE id=?`).bind(now(), row.id).run();
  }
  return {
    user: { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status, prefs: parseJson(row.prefs, {}) },
    sessionId: sid,
  };
}

/** All /api routes except the public ones go through this. Mutations also need the x-aether header (CSRF guard). */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-aether') !== '1') {
    throw new HttpError(403, 'Missing request header.');
  }
  const found = await userFromRequest(c.env, getCookie(c, COOKIE));
  if (!found) throw new HttpError(401, 'Please sign in.');
  c.set('user', found.user);
  c.set('sessionId', found.sessionId);
  await next();
};

export async function tooManyFailures(env: Env, email: string): Promise<boolean> {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM login_failures WHERE email=? AND created_at>?`).bind(email, since).first<{ n: number }>();
  return (r?.n ?? 0) >= 10;
}
export async function recordFailure(env: Env, email: string, ip: string) {
  await env.DB.prepare(`INSERT INTO login_failures (email, ip, created_at) VALUES (?,?,?)`).bind(email, ip, now()).run();
}

export const newUserId = () => id('usr');
export const AVATAR_COLORS = ['#d4ff3a', '#7dd3fc', '#f9a8d4', '#fdba74', '#a5b4fc', '#86efac', '#fca5a5', '#e9d5ff', '#fde68a', '#99f6e4'];
export const randomColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
