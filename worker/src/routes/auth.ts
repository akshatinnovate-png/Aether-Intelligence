import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { type AppEnv, bad, body, HttpError, hashPassword, id, now, sha256, verifyPassword } from '../lib/core';
import { COOKIE, createSession, ctxOf, destroySession, randomColor, recordFailure, requireAuth, tooManyFailures, userFromRequest } from '../lib/auth';
import { record } from '../lib/events';
import { seedWorkspace } from '../lib/seed';

export const auth = new Hono<AppEnv>();

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function checkPassword(p: string) {
  if (p.length < 8) throw bad('Password must be at least 8 characters.');
  if (p.length > 200) throw bad('Password is too long.');
}

auth.get('/state', async (c) => {
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
  const found = await userFromRequest(c.env, getCookie(c, COOKIE));
  const labName = await c.env.DB.prepare(`SELECT value FROM settings WHERE key='lab_name'`).first<{ value: string }>();
  return c.json({ setupNeeded: (count?.n ?? 0) === 0, signedIn: !!found, labName: labName?.value ?? 'Aether' });
});

/** First run only: creates the Owner account and the workspace. */
auth.post('/setup', async (c) => {
  if (c.req.header('x-aether') !== '1') throw new HttpError(403, 'Missing request header.');
  const b = await body(c);
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
  if ((count?.n ?? 0) > 0) throw new HttpError(409, 'This workspace is already set up.');
  const name = String(b.name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  const labName = String(b.labName ?? 'Aether Lab').trim().slice(0, 80) || 'Aether Lab';
  if (!name) throw bad('Your name is required.');
  if (!validEmail(email)) throw bad('A valid email is required.');
  checkPassword(password);
  const uid = id('usr');
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, title, avatar_color, created_at, updated_at) VALUES (?,?,?,?, 'owner', ?, ?, ?, ?)`,
  )
    .bind(uid, email, name, await hashPassword(password), String(b.title ?? 'Lab Lead').slice(0, 80), '#d4ff3a', t, t)
    .run();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('lab_name', ?, ?)`).bind(labName, t),
    c.env.DB.prepare(`INSERT INTO channels (id, name, kind, topic, created_by, created_at) VALUES (?, 'general', 'channel', 'Lab-wide announcements and conversation', ?, ?)`).bind(id('chn'), uid, t),
    c.env.DB.prepare(`INSERT INTO channels (id, name, kind, topic, created_by, created_at) VALUES (?, 'random', 'channel', 'Everything else', ?, ?)`).bind(id('chn'), uid, t),
  ]);
  if (b.seed) await seedWorkspace(c.env, uid);
  await createSession(c, uid);
  await record(ctxOf(c), { actorId: uid, verb: 'created', entityType: 'workspace', entityId: 'lab', summary: `set up the ${labName} workspace`, audit: true });
  return c.json({ ok: true });
});

auth.post('/login', async (c) => {
  if (c.req.header('x-aether') !== '1') throw new HttpError(403, 'Missing request header.');
  const b = await body(c);
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  if (await tooManyFailures(c.env, email)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
  const user = await c.env.DB.prepare(`SELECT id, password_hash, status FROM users WHERE email=?`).bind(email).first<{ id: string; password_hash: string; status: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await recordFailure(c.env, email, c.req.header('cf-connecting-ip') ?? '');
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  if (user.status !== 'active') throw new HttpError(403, 'This account has been disabled. Ask an administrator.');
  await createSession(c, user.id);
  return c.json({ ok: true });
});

auth.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

/** Public: what an invite or reset link is for. */
auth.get('/invite/:token', async (c) => {
  const inv = await findInvite(c.env.DB, c.req.param('token'));
  const by = inv.invited_by ? await c.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(inv.invited_by).first<{ name: string }>() : null;
  const labName = await c.env.DB.prepare(`SELECT value FROM settings WHERE key='lab_name'`).first<{ value: string }>();
  let name = '';
  if (inv.kind === 'reset' && inv.user_id) name = (await c.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(inv.user_id).first<{ name: string }>())?.name ?? '';
  return c.json({ email: inv.email, role: inv.role, kind: inv.kind, invitedBy: by?.name ?? null, labName: labName?.value ?? 'Aether', name });
});

auth.post('/invite/:token', async (c) => {
  if (c.req.header('x-aether') !== '1') throw new HttpError(403, 'Missing request header.');
  const inv = await findInvite(c.env.DB, c.req.param('token'));
  const b = await body(c);
  const password = String(b.password ?? '');
  checkPassword(password);
  const t = now();
  const ctx = ctxOf(c);
  let uid: string;
  if (inv.kind === 'reset') {
    uid = inv.user_id!;
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`).bind(await hashPassword(password), t, uid),
      c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(uid),
      c.env.DB.prepare(`UPDATE invites SET accepted_at=? WHERE id=?`).bind(t, inv.id),
    ]);
    await record(ctx, { actorId: uid, verb: 'reset_password', entityType: 'user', entityId: uid, summary: 'reset their password', audit: true });
  } else {
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (!name) throw bad('Your name is required.');
    const exists = await c.env.DB.prepare(`SELECT id FROM users WHERE email=?`).bind(inv.email).first();
    if (exists) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    uid = id('usr');
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, title, avatar_color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(uid, inv.email, name, await hashPassword(password), inv.role, String(b.title ?? '').slice(0, 80), randomColor(), t, t),
      c.env.DB.prepare(`UPDATE invites SET accepted_at=? WHERE id=?`).bind(t, inv.id),
    ]);
    const admins = await c.env.DB.prepare(`SELECT id FROM users WHERE role IN ('owner','admin')`).all<{ id: string }>();
    const { publish } = await import('../lib/events');
    await publish(ctx, 'users', [uid]);
    await record(ctx, {
      actorId: uid,
      verb: 'joined',
      entityType: 'user',
      entityId: uid,
      summary: `joined the lab as ${inv.role}`,
      audit: true,
      notify: [{ userIds: admins.results.map((a) => a.id).concat(inv.invited_by ? [inv.invited_by] : []), kind: 'team', title: `${name} accepted your invite`, body: `${name} joined as ${inv.role}.`, link: `/members/${uid}` }],
    });
  }
  await createSession(c, uid);
  return c.json({ ok: true });
});

async function findInvite(db: D1Database, raw: string) {
  const inv = await db
    .prepare(`SELECT * FROM invites WHERE token_hash=?`)
    .bind(await sha256(raw))
    .first<{ id: string; email: string; role: string; kind: string; user_id: string | null; invited_by: string | null; expires_at: string; accepted_at: string | null; revoked_at: string | null }>();
  if (!inv || inv.revoked_at) throw new HttpError(404, 'This link is not valid. Ask your administrator for a new one.');
  if (inv.accepted_at) throw new HttpError(410, 'This link has already been used.');
  if (inv.expires_at < now()) throw new HttpError(410, 'This link has expired. Ask your administrator for a new one.');
  return inv;
}

// ---- signed-in only ----
auth.use('/me', requireAuth);
auth.use('/password', requireAuth);
auth.use('/logout-all', requireAuth);

auth.get('/me', async (c) => {
  const u = c.get('user');
  return c.json({ ...u });
});

auth.post('/password', async (c) => {
  const u = c.get('user');
  const b = await body(c);
  const row = await c.env.DB.prepare(`SELECT password_hash FROM users WHERE id=?`).bind(u.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(b.current ?? ''), row.password_hash))) throw bad('Current password is incorrect.');
  const next = String(b.next ?? '');
  checkPassword(next);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`).bind(await hashPassword(next), now(), u.id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND id<>?`).bind(u.id, c.get('sessionId')),
  ]);
  return c.json({ ok: true });
});

auth.post('/logout-all', async (c) => {
  const u = c.get('user');
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(u.id).run();
  await destroySession(c);
  return c.json({ ok: true });
});
