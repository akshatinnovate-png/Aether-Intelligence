import { Hono } from 'hono';
import { type AppEnv, type C, type Role, type Spec, bad, body, forbidden, HttpError, id, isAdmin, notFound, now, parseJson, pick, RANK, requireRank, run, sha256, token, toApi, updateSql } from '../lib/core';
import { ctxOf } from '../lib/auth';
import { list, one } from '../lib/entities';
import { publish, publishDelete, record } from '../lib/events';
import { emailLayout, mailConfigured, sendMail } from '../lib/mail';

export const team = new Hono<AppEnv>();
const ROLES: Role[] = ['owner', 'admin', 'lead', 'member', 'guest'];

team.get('/users', async (c) => c.json(await list(c.env, 'users')));

team.get('/users/:id/activity', async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM activity WHERE actor_id=? AND audit=0 ORDER BY created_at DESC LIMIT 100`).bind(c.req.param('id')).all();
  return c.json(rs.results.map((r) => toApi(r, ['data'], ['audit'])));
});

const selfSpec: Spec = {
  name: { col: 'name', type: 'string', max: 80, required: true },
  title: { col: 'title', type: 'string', max: 80 },
  bio: { col: 'bio', type: 'text', max: 2000 },
  avatarColor: { col: 'avatar_color', type: 'string', max: 20 },
  skills: { col: 'skills', type: 'json' },
  responsibilities: { col: 'responsibilities', type: 'json' },
  capacity: { col: 'capacity', type: 'int' },
};

team.patch('/users/:id', async (c) => {
  const me = c.get('user');
  const uid = c.req.param('id');
  const target = await c.env.DB.prepare(`SELECT id, name, role, status FROM users WHERE id=?`).bind(uid).first<{ id: string; name: string; role: Role; status: string }>();
  if (!target) throw notFound('Member');
  const b = await body(c);
  const self = uid === me.id;
  if (!self && !isAdmin(me) && me.role !== 'lead') throw forbidden('You can only edit your own profile.');
  // Leads may edit skills/responsibilities/capacity of others, not identity.
  const data: Record<string, unknown> = {};
  if (self || isAdmin(me)) Object.assign(data, pick(b, selfSpec, 'update'));
  else Object.assign(data, pick(b, { responsibilities: selfSpec.responsibilities, capacity: selfSpec.capacity, skills: selfSpec.skills }, 'update'));
  if ('skills' in b) {
    const skills = (b.skills ?? {}) as Record<string, unknown>;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(skills)) {
      const name = String(k).trim().slice(0, 40);
      const lvl = Math.max(1, Math.min(5, Math.round(Number(v))));
      if (name && Number.isFinite(lvl)) clean[name] = lvl;
    }
    data.skills = JSON.stringify(clean);
  }
  const ctx = ctxOf(c);
  const audits: string[] = [];
  if ('role' in b && b.role !== target.role) {
    const role = String(b.role) as Role;
    if (!ROLES.includes(role) || role === 'owner') throw bad('Use "Transfer ownership" to change the owner.');
    if (self) throw forbidden('You cannot change your own role.');
    if (target.role === 'owner') throw forbidden('The owner’s role cannot be changed.');
    if (me.role === 'admin' && (target.role === 'admin' || role === 'admin')) throw forbidden('Only the owner can appoint or change administrators.');
    if (!isAdmin(me)) throw forbidden();
    data.role = role;
    audits.push(`changed ${target.name}’s role from ${target.role} to ${role}`);
  }
  if ('status' in b && b.status !== target.status) {
    const status = String(b.status);
    if (!['active', 'disabled'].includes(status)) throw bad('Invalid status.');
    if (self) throw forbidden('You cannot disable yourself.');
    if (!isAdmin(me) || target.role === 'owner' || (me.role === 'admin' && target.role === 'admin')) throw forbidden();
    data.status = status;
    audits.push(`${status === 'disabled' ? 'disabled' : 're-enabled'} ${target.name}’s account`);
    if (status === 'disabled') await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(uid).run();
  }
  if (!Object.keys(data).length) return c.json(await one(c.env, 'users', uid));
  data.updated_at = now();
  await run(c.env.DB, updateSql('users', uid, data));
  const [row] = await publish(ctx, 'users', [uid]);
  for (const s of audits)
    await record(ctx, {
      actorId: me.id,
      verb: 'role',
      entityType: 'user',
      entityId: uid,
      summary: s,
      audit: true,
      notify: [{ userIds: [uid], kind: 'team', title: s.replace(target.name + '’s', 'your').replace(/^./, (x) => x.toUpperCase()), link: `/members/${uid}` }],
    });
  if (!audits.length && !self) await record(ctx, { actorId: me.id, verb: 'updated', entityType: 'user', entityId: uid, summary: `updated ${target.name}’s profile` });
  return c.json(row);
});

team.post('/team/transfer-ownership', async (c) => {
  const me = c.get('user');
  if (me.role !== 'owner') throw forbidden('Only the owner can transfer ownership.');
  const b = await body(c);
  const to = String(b.userId ?? '');
  const target = await c.env.DB.prepare(`SELECT id, name, status FROM users WHERE id=?`).bind(to).first<{ id: string; name: string; status: string }>();
  if (!target || target.status !== 'active' || to === me.id) throw bad('Choose an active member.');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET role='owner', updated_at=? WHERE id=?`).bind(now(), to),
    c.env.DB.prepare(`UPDATE users SET role='admin', updated_at=? WHERE id=?`).bind(now(), me.id),
  ]);
  const ctx = ctxOf(c);
  await publish(ctx, 'users', [to, me.id]);
  await record(ctx, { actorId: me.id, verb: 'role', entityType: 'user', entityId: to, summary: `transferred ownership to ${target.name}`, audit: true, notify: [{ userIds: [to], kind: 'team', title: 'You are now the owner of this workspace' }] });
  return c.json({ ok: true });
});

// ---------- invites ----------
team.get('/invites', async (c) => {
  requireRank(c.get('user'), 'admin');
  const rs = await c.env.DB.prepare(
    `SELECT i.id, i.email, i.role, i.kind, i.email_status, i.expires_at, i.accepted_at, i.revoked_at, i.created_at, u.name AS invited_by_name
     FROM invites i LEFT JOIN users u ON u.id=i.invited_by WHERE i.kind='invite' ORDER BY i.created_at DESC LIMIT 200`,
  ).all();
  return c.json(rs.results.map((r) => toApi(r)));
});

async function issueLink(c: C, opts: { email: string; role: string; kind: 'invite' | 'reset'; userId?: string; days: number }) {
  const me = c.get('user');
  const raw = token(24);
  const iid = id('inv');
  await c.env.DB.prepare(
    `INSERT INTO invites (id, email, role, token_hash, kind, user_id, invited_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  )
    .bind(iid, opts.email, opts.role, await sha256(raw), opts.kind, opts.userId ?? null, me.id, new Date(Date.now() + opts.days * 864e5).toISOString(), now())
    .run();
  const origin = new URL(c.req.url).origin;
  const link = `${origin}/${opts.kind === 'reset' ? 'reset' : 'invite'}/${raw}`;
  let emailStatus = 'not_configured';
  let emailError: string | null = null;
  if (await mailConfigured(c.env)) {
    const lab = (await c.env.DB.prepare(`SELECT value FROM settings WHERE key='lab_name'`).first<{ value: string }>())?.value ?? 'Aether';
    try {
      if (opts.kind === 'invite') {
        await sendMail(c.env, {
          to: opts.email,
          subject: `${me.name} invited you to ${lab} on Aether`,
          text: `${me.name} invited you to join ${lab} as ${opts.role}.\n\nAccept the invite: ${link}\n\nThe link expires in ${opts.days} days.`,
          html: emailLayout(
            `Join ${lab}`,
            `<p><strong style="color:#f4f4f2">${escape(me.name)}</strong> invited you to join <strong style="color:#f4f4f2">${escape(lab)}</strong> as <strong style="color:#f4f4f2">${opts.role}</strong>.</p><p>Aether is where the lab runs its projects, code, research, competitions and equipment. The link expires in ${opts.days} days.</p>`,
            { label: 'Accept invite', url: link },
          ),
        });
      } else {
        await sendMail(c.env, {
          to: opts.email,
          subject: `Reset your ${lab} password`,
          text: `${me.name} sent you a password reset link: ${link}\n\nIt expires in ${opts.days} days.`,
          html: emailLayout('Reset your password', `<p>${escape(me.name)} sent you a link to set a new password. It expires in ${opts.days} days.</p>`, { label: 'Set new password', url: link }),
        });
      }
      emailStatus = 'sent';
    } catch (e) {
      emailStatus = 'failed';
      emailError = e instanceof Error ? e.message : String(e);
    }
  }
  await c.env.DB.prepare(`UPDATE invites SET email_status=? WHERE id=?`).bind(emailStatus, iid).run();
  return { id: iid, link, emailStatus, emailError };
}
const escape = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

team.post('/invites', async (c) => {
  const me = c.get('user');
  requireRank(me, 'admin');
  const b = await body(c);
  const email = String(b.email ?? '').trim().toLowerCase();
  const role = String(b.role ?? 'member') as Role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid email address.');
  if (!['admin', 'lead', 'member', 'guest'].includes(role)) throw bad('Invalid role.');
  if (role === 'admin' && me.role !== 'owner') throw forbidden('Only the owner can invite administrators.');
  if (await c.env.DB.prepare(`SELECT 1 FROM users WHERE email=?`).bind(email).first()) throw new HttpError(409, 'That person is already a member.');
  await c.env.DB.prepare(`UPDATE invites SET revoked_at=? WHERE email=? AND kind='invite' AND accepted_at IS NULL AND revoked_at IS NULL`).bind(now(), email).run();
  const out = await issueLink(c, { email, role, kind: 'invite', days: 7 });
  await record(ctxOf(c), { actorId: me.id, verb: 'invited', entityType: 'invite', entityId: out.id, summary: `invited ${email} as ${role}`, audit: true });
  return c.json(out);
});

team.delete('/invites/:id', async (c) => {
  const me = c.get('user');
  requireRank(me, 'admin');
  const inv = await c.env.DB.prepare(`SELECT email FROM invites WHERE id=?`).bind(c.req.param('id')).first<{ email: string }>();
  if (!inv) throw notFound('Invite');
  await c.env.DB.prepare(`UPDATE invites SET revoked_at=? WHERE id=?`).bind(now(), c.req.param('id')).run();
  await record(ctxOf(c), { actorId: me.id, verb: 'revoked', entityType: 'invite', entityId: c.req.param('id'), summary: `revoked the invite for ${inv.email}`, audit: true });
  return c.json({ ok: true });
});

team.post('/users/:id/reset-link', async (c) => {
  const me = c.get('user');
  requireRank(me, 'admin');
  const target = await c.env.DB.prepare(`SELECT id, email, name, role FROM users WHERE id=?`).bind(c.req.param('id')).first<{ id: string; email: string; name: string; role: Role }>();
  if (!target) throw notFound('Member');
  if (target.role === 'owner' && me.role !== 'owner') throw forbidden();
  const out = await issueLink(c, { email: target.email, role: target.role, kind: 'reset', userId: target.id, days: 2 });
  await record(ctxOf(c), { actorId: me.id, verb: 'reset_link', entityType: 'user', entityId: target.id, summary: `issued a password reset link for ${target.name}`, audit: true });
  return c.json(out);
});

// ---------- achievements ----------
team.get('/achievements', async (c) => c.json(await list(c.env, 'achievements')));
team.post('/achievements', async (c) => {
  const me = c.get('user');
  if (RANK[me.role] < RANK.lead) throw forbidden('Leads and administrators award achievements.');
  const b = await body(c);
  const userId = String(b.userId ?? '');
  const title = String(b.title ?? '').trim().slice(0, 120);
  if (!title) throw bad('Title is required.');
  const user = await c.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(userId).first<{ name: string }>();
  if (!user) throw notFound('Member');
  const aid = id('ach');
  await c.env.DB.prepare(`INSERT INTO achievements (id, user_id, title, description, kind, date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(aid, userId, title, String(b.description ?? '').slice(0, 1000), String(b.kind ?? 'award').slice(0, 30), String(b.date ?? now().slice(0, 10)).slice(0, 10), me.id, now())
    .run();
  const ctx = ctxOf(c);
  const [row] = await publish(ctx, 'achievements', [aid]);
  await record(ctx, { actorId: me.id, verb: 'awarded', entityType: 'achievement', entityId: aid, summary: `recognised ${user.name}: ${title}`, notify: [{ userIds: [userId], kind: 'team', title: `New achievement: ${title}`, link: `/members/${userId}` }] });
  return c.json(row);
});
team.delete('/achievements/:id', async (c) => {
  const me = c.get('user');
  if (RANK[me.role] < RANK.lead) throw forbidden();
  await c.env.DB.prepare(`DELETE FROM achievements WHERE id=?`).bind(c.req.param('id')).run();
  publishDelete(ctxOf(c), 'achievements', [c.req.param('id')]);
  return c.json({ ok: true });
});

// ---------- my preferences ----------
team.get('/me/prefs', async (c) => {
  const row = await c.env.DB.prepare(`SELECT prefs FROM users WHERE id=?`).bind(c.get('user').id).first<{ prefs: string }>();
  return c.json(parseJson(row?.prefs, {}));
});
team.put('/me/prefs', async (c) => {
  const b = await body(c);
  const s = JSON.stringify(b);
  if (s.length > 20_000) throw bad('Preferences are too large.');
  await c.env.DB.prepare(`UPDATE users SET prefs=? WHERE id=?`).bind(s, c.get('user').id).run();
  return c.json(b);
});
