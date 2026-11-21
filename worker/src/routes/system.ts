import { Hono } from 'hono';
import { type AppEnv, bad, body, forbidden, getSetting, id, isAdmin, notFound, now, requireRank, setSetting, toApi, visibleProjects } from '../lib/core';
import { ctxOf } from '../lib/auth';
import { broadcast, hub, record } from '../lib/events';
import { mailConfig, sendMail, emailLayout } from '../lib/mail';

export const system = new Hono<AppEnv>();

// ---------- activity ----------
system.get('/activity', async (c) => {
  const me = c.get('user');
  if (me.role === 'guest') {
    const vis = (await visibleProjects(c.env, me)) ?? [];
    if (!vis.length) return c.json([]);
    const rs = await c.env.DB.prepare(`SELECT * FROM activity WHERE audit=0 AND project_id IN (${vis.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 80`).bind(...vis).all();
    return c.json(rs.results.map((r) => toApi(r, ['data'], ['audit'])));
  }
  const before = c.req.query('before');
  const project = c.req.query('project');
  const where = ['audit=0'];
  const args: unknown[] = [];
  if (before) where.push('created_at < ?'), args.push(before);
  if (project) where.push('project_id = ?'), args.push(project);
  const rs = await c.env.DB.prepare(`SELECT * FROM activity WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).bind(...args, Math.min(200, Number(c.req.query('limit') ?? 80))).all();
  return c.json(rs.results.map((r) => toApi(r, ['data'], ['audit'])));
});

system.get('/audit', async (c) => {
  requireRank(c.get('user'), 'admin');
  const rs = await c.env.DB.prepare(`SELECT * FROM activity WHERE audit=1 ORDER BY created_at DESC LIMIT 300`).all();
  return c.json(rs.results.map((r) => toApi(r, ['data'], ['audit'])));
});

// ---------- notifications ----------
system.get('/notifications', async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 150`).bind(c.get('user').id).all();
  return c.json(rs.results.map((r) => toApi(r, [], [], ['dedupe_key'])));
});
system.post('/notifications/read', async (c) => {
  const b = await body(c);
  const me = c.get('user');
  const ids = (b.ids as string[]) ?? null;
  if (ids?.length) await c.env.DB.prepare(`UPDATE notifications SET read_at=? WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')})`).bind(now(), me.id, ...ids).run();
  else await c.env.DB.prepare(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL`).bind(now(), me.id).run();
  return c.json({ ok: true });
});
system.delete('/notifications', async (c) => {
  await c.env.DB.prepare(`DELETE FROM notifications WHERE user_id=? AND read_at IS NOT NULL`).bind(c.get('user').id).run();
  return c.json({ ok: true });
});

system.get('/presence', async (c) => c.json(await hub(c.env).onlineUsers()));

// ---------- global search ----------
system.get('/search', async (c) => {
  const me = c.get('user');
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json([]);
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const vis = await visibleProjects(c.env, me);
  const scope = (col: string) => (vis ? (vis.length ? ` AND ${col} IN (${vis.map((v) => `'${v.replace(/'/g, '')}'`).join(',')})` : ' AND 0') : '');
  const db = c.env.DB;
  const keyMatch = /^([A-Za-z][A-Za-z0-9]{1,6})-(\d+)$/.exec(q);
  const queries = [
    db.prepare(`SELECT 'project' AS type, id, name AS title, key AS sub, description AS detail FROM projects WHERE (name LIKE ?1 ESCAPE '\\' OR key LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\')${scope('id')} LIMIT 8`).bind(like),
    db.prepare(
      `SELECT 'task' AS type, t.id, t.title, p.key || '-' || t.number AS sub, p.key AS detail FROM tasks t JOIN projects p ON p.id=t.project_id WHERE (t.title LIKE ?1 ESCAPE '\\' OR t.description LIKE ?1 ESCAPE '\\' ${keyMatch ? `OR (p.key=?2 COLLATE NOCASE AND t.number=?3)` : ''})${scope('t.project_id')} ORDER BY t.updated_at DESC LIMIT 12`,
    ).bind(...(keyMatch ? [like, keyMatch[1], Number(keyMatch[2])] : [like])),
    db.prepare(`SELECT 'member' AS type, id, name AS title, title AS sub, email AS detail FROM users WHERE name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\' OR title LIKE ?1 ESCAPE '\\' OR skills LIKE ?1 ESCAPE '\\' LIMIT 8`).bind(like),
  ];
  if (!vis) {
    queries.push(
      db.prepare(`SELECT 'paper' AS type, id, title, authors AS sub, kind AS detail FROM papers WHERE title LIKE ?1 ESCAPE '\\' OR authors LIKE ?1 ESCAPE '\\' OR abstract LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\' LIMIT 8`).bind(like),
      db.prepare(`SELECT 'competition' AS type, id, name AS title, organizer AS sub, stage AS detail FROM competitions WHERE name LIKE ?1 ESCAPE '\\' OR organizer LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\' LIMIT 6`).bind(like),
      db.prepare(`SELECT 'equipment' AS type, id, name AS title, category AS sub, tag AS detail FROM equipment WHERE name LIKE ?1 ESCAPE '\\' OR tag LIKE ?1 ESCAPE '\\' OR serial LIKE ?1 ESCAPE '\\' OR specs LIKE ?1 ESCAPE '\\' LIMIT 6`).bind(like),
      db.prepare(`SELECT 'event' AS type, id, title, starts_at AS sub, kind AS detail FROM calendar_events WHERE title LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\' LIMIT 6`).bind(like),
      db.prepare(
        `SELECT 'message' AS type, m.id, m.body AS title, ch.name AS sub, ch.id AS detail FROM messages m JOIN channels ch ON ch.id=m.channel_id
         WHERE m.deleted=0 AND m.body LIKE ?1 ESCAPE '\\' AND (ch.kind<>'dm' AND ch.is_private=0 OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id=ch.id AND cm.user_id=?2)) ORDER BY m.created_at DESC LIMIT 8`,
      ).bind(like, me.id),
    );
  }
  const results = await db.batch(queries);
  return c.json(results.flatMap((r) => r.results.map((x) => toApi(x as Record<string, unknown>))));
});

// ---------- settings ----------
const PUBLIC_KEYS = ['lab_name', 'lab_tagline', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_from_name', 'smtp_from_email', 'github_client_id'];
system.get('/settings', async (c) => {
  const me = c.get('user');
  const rs = await c.env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${PUBLIC_KEYS.map(() => '?').join(',')})`).bind(...PUBLIC_KEYS).all<{ key: string; value: string }>();
  const out: Record<string, unknown> = Object.fromEntries(rs.results.map((r) => [r.key, r.value]));
  if (!isAdmin(me)) {
    for (const k of Object.keys(out)) if (k.startsWith('smtp_') || k.startsWith('github_')) delete out[k];
  } else {
    out.smtp_pass_set = !!(await c.env.DB.prepare(`SELECT 1 FROM settings WHERE key='smtp_pass'`).first());
    out.github_client_secret_set = !!(await c.env.DB.prepare(`SELECT 1 FROM settings WHERE key='github_client_secret'`).first());
  }
  return c.json(out);
});
system.put('/settings', async (c) => {
  const me = c.get('user');
  requireRank(me, 'admin');
  const b = await body(c);
  const allowed = [...PUBLIC_KEYS, 'smtp_pass', 'github_client_secret'];
  const changed: string[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!allowed.includes(k)) continue;
    // Empty secret fields mean "keep the current value".
    if ((k === 'smtp_pass' || k === 'github_client_secret') && (v === '' || v === undefined)) continue;
    const val = v === null ? null : String(v).trim().slice(0, 500);
    await setSetting(c.env, k, val === '' ? null : val);
    changed.push(k);
  }
  if (changed.length) await record(ctxOf(c), { actorId: me.id, verb: 'settings', entityType: 'settings', entityId: 'workspace', summary: `changed settings: ${changed.map((k) => k.replace(/_/g, ' ')).join(', ')}`, audit: true });
  return c.json({ ok: true });
});
system.post('/settings/test-email', async (c) => {
  const me = c.get('user');
  requireRank(me, 'admin');
  const cfg = await mailConfig(c.env);
  if (!cfg) throw bad('Add an SMTP username and password first.');
  try {
    await sendMail(c.env, { to: me.email, subject: 'Aether test email', text: 'Email delivery from Aether works.', html: emailLayout('Email works', '<p>Invites and notifications from Aether will be delivered from this address.</p>') });
  } catch (e) {
    throw bad(e instanceof Error ? e.message : String(e));
  }
  return c.json({ ok: true, to: me.email });
});

// ---------- files (chunked into D1; max 10 MB) ----------
const CHUNK = 1_500_000;
system.post('/files', async (c) => {
  const me = c.get('user');
  if (me.role === 'guest') throw forbidden();
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw bad('No file.');
  if (file.size > 10 * 1024 * 1024) throw bad('Files are limited to 10 MB.');
  const buf = new Uint8Array(await file.arrayBuffer());
  const fid = id('fil');
  const chunks = Math.max(1, Math.ceil(buf.length / CHUNK));
  const stmts = [c.env.DB.prepare(`INSERT INTO attachments (id, name, mime, size, chunks, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?)`).bind(fid, file.name.slice(0, 200), file.type || 'application/octet-stream', buf.length, chunks, me.id, now())];
  for (let i = 0; i < chunks; i++) stmts.push(c.env.DB.prepare(`INSERT INTO attachment_chunks (attachment_id, idx, data) VALUES (?,?,?)`).bind(fid, i, buf.slice(i * CHUNK, (i + 1) * CHUNK)));
  await c.env.DB.batch(stmts);
  return c.json({ id: fid, name: file.name, mime: file.type, size: buf.length });
});
system.get('/files/:id', async (c) => {
  const a = await c.env.DB.prepare(`SELECT * FROM attachments WHERE id=?`).bind(c.req.param('id')).first<{ id: string; name: string; mime: string; size: number; chunks: number }>();
  if (!a) throw notFound('File');
  const parts: Uint8Array[] = [];
  for (let i = 0; i < a.chunks; i++) {
    const r = await c.env.DB.prepare(`SELECT data FROM attachment_chunks WHERE attachment_id=? AND idx=?`).bind(a.id, i).first<{ data: ArrayBuffer | number[] }>();
    if (r) parts.push(r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : new Uint8Array(r.data));
  }
  const inline = /^(image\/|application\/pdf|text\/plain)/.test(a.mime);
  return new Response(new Blob(parts, { type: a.mime }), {
    headers: {
      'content-type': a.mime,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(a.name)}"`,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      // PDFs need the browser's viewer; everything else is locked down.
      ...(a.mime === 'application/pdf' ? {} : { 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
    },
  });
});

// ---------- clear workspace content (owner only) ----------
// Removes all projects, tasks, research, competitions, equipment, events and history.
// Keeps people, roles, settings (email, GitHub) and the #general / #random channels.
system.post('/admin/clear-content', async (c) => {
  const me = c.get('user');
  if (me.role !== 'owner') throw forbidden('Only the owner can clear the workspace.');
  const b = await body(c);
  const lab = (await getSetting(c.env, 'lab_name')) ?? 'Aether';
  if (String(b.confirm ?? '').trim() !== lab) throw bad(`Type the lab name “${lab}” to confirm.`);
  const db = c.env.DB;
  await db.batch([
    db.prepare(`DELETE FROM projects`), // cascades tasks, milestones, deps, comments, commits, project channels
    db.prepare(`DELETE FROM papers`),
    db.prepare(`DELETE FROM collections`),
    db.prepare(`DELETE FROM competitions`),
    db.prepare(`DELETE FROM equipment`), // cascades bookings, maintenance logs
    db.prepare(`DELETE FROM calendar_events`),
    db.prepare(`DELETE FROM achievements`),
    db.prepare(`DELETE FROM notifications`),
    db.prepare(`DELETE FROM activity WHERE audit=0`),
    db.prepare(`DELETE FROM attachments WHERE id NOT IN (SELECT attachment_id FROM messages WHERE attachment_id IS NOT NULL)`),
  ]);
  const ctx = ctxOf(c);
  for (const e of ['projects', 'tasks', 'milestones', 'papers', 'collections', 'competitions', 'equipment', 'bookings', 'events', 'achievements']) broadcast(ctx, { t: 'reload', e });
  broadcast(ctx, { t: 'channels' });
  await record(ctx, { actorId: me.id, verb: 'cleared', entityType: 'workspace', entityId: 'lab', summary: 'cleared all workspace content (projects, research, competitions, equipment, events)', audit: true });
  return c.json({ ok: true });
});

// ---------- data export (owner/admin) ----------
system.get('/export', async (c) => {
  const me = c.get('user');
  requireRank(me, 'admin');
  const tables = ['users', 'projects', 'project_members', 'project_deps', 'milestones', 'tasks', 'task_deps', 'task_comments', 'task_commits', 'calendar_events', 'collections', 'papers', 'paper_progress', 'competitions', 'competition_members', 'equipment', 'bookings', 'maintenance_logs', 'channels', 'channel_members', 'messages', 'achievements', 'activity'];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rs = await c.env.DB.prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>();
    out[t] = rs.results.map((r) => {
      const copy = { ...r };
      delete copy.password_hash;
      delete copy.github_token_enc;
      return copy;
    });
  }
  await record(ctxOf(c), { actorId: me.id, verb: 'exported', entityType: 'workspace', entityId: 'lab', summary: 'exported workspace data', audit: true });
  return new Response(JSON.stringify({ exportedAt: now(), version: 1, lab: await getSetting(c.env, 'lab_name'), data: out }, null, 1), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="aether-export-${now().slice(0, 10)}.json"` },
  });
});
