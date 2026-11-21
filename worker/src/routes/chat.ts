import { Hono } from 'hono';
import { type AppEnv, type C, bad, body, forbidden, id, isAdmin, notFound, now, parseJson, toApi, visibleProjects } from '../lib/core';
import { ctxOf } from '../lib/auth';
import { broadcast, mentionedIds, notify, plainMentions, record } from '../lib/events';

export const chat = new Hono<AppEnv>();

interface ChannelRow {
  id: string;
  name: string;
  kind: 'channel' | 'project' | 'dm';
  topic: string;
  project_id: string | null;
  is_private: number;
  dm_key: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string | null;
}

/** Who may read a channel. null = everyone signed in (except guests outside the project). */
async function audience(c: C, ch: ChannelRow): Promise<string[] | null> {
  if (ch.kind === 'dm' || ch.is_private) {
    const rs = await c.env.DB.prepare(`SELECT user_id FROM channel_members WHERE channel_id=?`).bind(ch.id).all<{ user_id: string }>();
    return rs.results.map((r) => r.user_id);
  }
  return null;
}
async function assertCanRead(c: C, ch: ChannelRow) {
  const me = c.get('user');
  const aud = await audience(c, ch);
  if (aud && !aud.includes(me.id)) throw forbidden('You are not in this conversation.');
  if (!aud && me.role === 'guest') {
    const vis = await visibleProjects(c.env, me);
    if (!ch.project_id || !vis?.includes(ch.project_id)) throw forbidden();
  }
}
async function channel(c: C, cid: string) {
  const ch = await c.env.DB.prepare(`SELECT * FROM channels WHERE id=?`).bind(cid).first<ChannelRow>();
  if (!ch) throw notFound('Channel');
  return ch;
}

chat.get('/channels', async (c) => {
  const me = c.get('user');
  const vis = await visibleProjects(c.env, me);
  const rs = await c.env.DB.prepare(
    `SELECT ch.*, cm.last_read_at,
       (SELECT json_group_array(user_id) FROM channel_members m WHERE m.channel_id=ch.id) AS members,
       (SELECT COUNT(*) FROM messages msg WHERE msg.channel_id=ch.id AND msg.parent_id IS NULL AND msg.deleted=0 AND msg.user_id<>?
          AND msg.created_at > COALESCE(cm.last_read_at, '')) AS unread,
       (SELECT COUNT(*) FROM messages msg WHERE msg.channel_id=ch.id AND msg.deleted=0 AND msg.body LIKE ?
          AND msg.created_at > COALESCE(cm.last_read_at, '')) AS mentions
     FROM channels ch LEFT JOIN channel_members cm ON cm.channel_id=ch.id AND cm.user_id=?
     ORDER BY ch.kind, ch.name`,
  )
    .bind(me.id, `%<@${me.id}>%`, me.id)
    .all<ChannelRow & { members: string; last_read_at: string | null; unread: number }>();
  const out = rs.results
    .filter((ch) => {
      const members = parseJson<string[]>(ch.members, []);
      if (ch.kind === 'dm' || ch.is_private) return members.includes(me.id);
      if (vis) return !!ch.project_id && vis.includes(ch.project_id);
      return true;
    })
    .map((r) => toApi(r as unknown as Record<string, unknown>, ['members'], ['is_private']));
  return c.json(out);
});

chat.post('/channels', async (c) => {
  const me = c.get('user');
  if (me.role === 'guest') throw forbidden();
  const b = await body(c);
  const name = String(b.name ?? '').toLowerCase().trim().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!name) throw bad('Channel name is required.');
  if (await c.env.DB.prepare(`SELECT 1 FROM channels WHERE name=? AND kind='channel'`).bind(name).first()) throw bad('A channel with that name exists.');
  const cid = id('chn');
  const isPrivate = b.isPrivate ? 1 : 0;
  const stmts = [c.env.DB.prepare(`INSERT INTO channels (id, name, kind, topic, is_private, created_by, created_at) VALUES (?,?, 'channel', ?, ?, ?, ?)`).bind(cid, name, String(b.topic ?? '').slice(0, 300), isPrivate, me.id, now())];
  const members = new Set<string>([me.id, ...((b.members as string[]) ?? [])]);
  if (isPrivate) for (const u of members) stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?,?)`).bind(cid, u));
  await c.env.DB.batch(stmts);
  const ctx = ctxOf(c);
  broadcast(ctx, { t: 'channels' }, isPrivate ? { to: [...members] } : {});
  if (!isPrivate) await record(ctx, { actorId: me.id, verb: 'created', entityType: 'channel', entityId: cid, summary: `created #${name}` });
  return c.json({ id: cid });
});

chat.patch('/channels/:id', async (c) => {
  const me = c.get('user');
  const ch = await channel(c, c.req.param('id'));
  await assertCanRead(c, ch);
  if (me.role === 'guest') throw forbidden();
  const b = await body(c);
  if ('topic' in b) await c.env.DB.prepare(`UPDATE channels SET topic=? WHERE id=?`).bind(String(b.topic ?? '').slice(0, 300), ch.id).run();
  if (Array.isArray(b.members) && ch.is_private && ch.kind === 'channel') {
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM channel_members WHERE channel_id=? AND user_id NOT IN (${(b.members as string[]).map(() => '?').join(',') || "''"})`).bind(ch.id, ...(b.members as string[])),
      ...(b.members as string[]).map((u) => c.env.DB.prepare(`INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?,?)`).bind(ch.id, u)),
    ]);
  }
  broadcast(ctxOf(c), { t: 'channels' });
  return c.json({ ok: true });
});

chat.delete('/channels/:id', async (c) => {
  const me = c.get('user');
  const ch = await channel(c, c.req.param('id'));
  if (ch.kind !== 'channel' || !(isAdmin(me) || ch.created_by === me.id)) throw forbidden('Only the creator or an admin can delete a channel. Project channels go with their project.');
  if (ch.name === 'general') throw bad('#general cannot be deleted.');
  await c.env.DB.prepare(`DELETE FROM channels WHERE id=?`).bind(ch.id).run();
  broadcast(ctxOf(c), { t: 'channels' });
  return c.json({ ok: true });
});

/** Opens (or creates) the direct-message channel between me and one or more people. */
chat.post('/dm', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const others = ((b.userIds as string[]) ?? []).filter((u) => u !== me.id);
  if (!others.length) throw bad('Choose someone to message.');
  const all = [...new Set([me.id, ...others])].sort();
  const key = all.join(':');
  const existing = await c.env.DB.prepare(`SELECT id FROM channels WHERE dm_key=?`).bind(key).first<{ id: string }>();
  if (existing) return c.json({ id: existing.id });
  const cid = id('chn');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO channels (id, name, kind, dm_key, created_by, created_at) VALUES (?, 'dm', 'dm', ?, ?, ?)`).bind(cid, key, me.id, now()),
    ...all.map((u) => c.env.DB.prepare(`INSERT INTO channel_members (channel_id, user_id) VALUES (?,?)`).bind(cid, u)),
  ]);
  broadcast(ctxOf(c), { t: 'channels' }, { to: all });
  return c.json({ id: cid });
});

const MSG_SQL = `SELECT m.*, a.name AS att_name, a.mime AS att_mime, a.size AS att_size,
  (SELECT COUNT(*) FROM messages r WHERE r.parent_id=m.id AND r.deleted=0) AS reply_count,
  (SELECT MAX(created_at) FROM messages r WHERE r.parent_id=m.id) AS last_reply_at
  FROM messages m LEFT JOIN attachments a ON a.id=m.attachment_id`;
function shapeMessage(r: Record<string, unknown>) {
  const m = toApi<Record<string, unknown>>(r, ['reactions'], ['deleted'], ['att_name', 'att_mime', 'att_size']);
  m.attachment = r.attachment_id ? { id: r.attachment_id, name: r.att_name, mime: r.att_mime, size: r.att_size } : null;
  if (m.deleted) m.body = '';
  return m;
}
async function loadMessage(c: C, mid: string) {
  const r = await c.env.DB.prepare(`${MSG_SQL} WHERE m.id=?`).bind(mid).first();
  return r ? shapeMessage(r) : null;
}

chat.get('/channels/:id/messages', async (c) => {
  const ch = await channel(c, c.req.param('id'));
  await assertCanRead(c, ch);
  const before = c.req.query('before');
  const parent = c.req.query('parent');
  const limit = Math.min(100, Number(c.req.query('limit') ?? 60));
  let rs;
  if (parent) rs = await c.env.DB.prepare(`${MSG_SQL} WHERE m.channel_id=? AND (m.parent_id=? OR m.id=?) ORDER BY m.created_at`).bind(ch.id, parent, parent).all();
  else
    rs = await c.env.DB.prepare(`${MSG_SQL} WHERE m.channel_id=? AND m.parent_id IS NULL ${before ? 'AND m.created_at < ?' : ''} ORDER BY m.created_at DESC LIMIT ?`)
      .bind(...(before ? [ch.id, before, limit] : [ch.id, limit]))
      .all();
  const rows = rs.results.map((r) => shapeMessage(r));
  return c.json(parent ? rows : rows.reverse());
});

chat.post('/channels/:id/messages', async (c) => {
  const me = c.get('user');
  const ch = await channel(c, c.req.param('id'));
  await assertCanRead(c, ch);
  const b = await body(c);
  const text = String(b.body ?? '').trim();
  const attachmentId = b.attachmentId ? String(b.attachmentId) : null;
  if (!text && !attachmentId) throw bad('Message is empty.');
  if (text.length > 10_000) throw bad('Message is too long.');
  const parentId = b.parentId ? String(b.parentId) : null;
  if (parentId) {
    const p = await c.env.DB.prepare(`SELECT channel_id FROM messages WHERE id=?`).bind(parentId).first<{ channel_id: string }>();
    if (!p || p.channel_id !== ch.id) throw bad('Thread not found.');
  }
  const mid = id('msg');
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO messages (id, channel_id, user_id, parent_id, body, attachment_id, created_at) VALUES (?,?,?,?,?,?,?)`).bind(mid, ch.id, me.id, parentId, text, attachmentId, t),
    c.env.DB.prepare(`UPDATE channels SET last_message_at=? WHERE id=?`).bind(t, ch.id),
    c.env.DB.prepare(`INSERT INTO channel_members (channel_id, user_id, last_read_at) VALUES (?,?,?) ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_at=excluded.last_read_at`).bind(ch.id, me.id, t),
  ]);
  const msg = await loadMessage(c, mid);
  const ctx = ctxOf(c);
  const aud = await audience(c, ch);
  broadcast(ctx, { t: 'message', row: msg }, aud ? { to: aud } : { guests: ch.project_id ? 'send' : 'skip' });
  if (parentId) {
    const parent = await loadMessage(c, parentId);
    broadcast(ctx, { t: 'message_update', row: parent }, aud ? { to: aud } : {});
  }
  // Notifications: mentions everywhere; every message in a DM.
  const plain = await plainMentions(c.env, text);
  const where = ch.kind === 'dm' ? 'a direct message' : `#${ch.name}`;
  const link = `/chat/${ch.id}${parentId ? `?thread=${parentId}` : ''}`;
  const mentioned = mentionedIds(text);
  if (mentioned.length) await notify(ctx, { userIds: mentioned, kind: 'mention', title: `${me.name} mentioned you in ${where}`, body: plain.slice(0, 200), link }, me.id);
  if (ch.kind === 'dm' && aud) await notify(ctx, { userIds: aud.filter((u) => !mentioned.includes(u)), kind: 'message', title: `${me.name} sent you a message`, body: plain.slice(0, 200) || 'Sent a file', link }, me.id);
  if (parentId) {
    const thread = await c.env.DB.prepare(`SELECT DISTINCT user_id FROM messages WHERE (id=? OR parent_id=?) AND user_id IS NOT NULL`).bind(parentId, parentId).all<{ user_id: string }>();
    const ids = thread.results.map((r) => r.user_id).filter((u) => !mentioned.includes(u) && !(ch.kind === 'dm'));
    if (ids.length) await notify(ctx, { userIds: ids, kind: 'message', title: `${me.name} replied in a thread in ${where}`, body: plain.slice(0, 200), link }, me.id);
  }
  return c.json(msg);
});

chat.patch('/messages/:id', async (c) => {
  const me = c.get('user');
  const m = await c.env.DB.prepare(`SELECT * FROM messages WHERE id=?`).bind(c.req.param('id')).first<{ id: string; user_id: string; channel_id: string; reactions: string }>();
  if (!m) throw notFound('Message');
  const ch = await channel(c, m.channel_id);
  await assertCanRead(c, ch);
  const b = await body(c);
  if ('reaction' in b) {
    const emoji = String(b.reaction).slice(0, 16);
    const reactions = parseJson<Record<string, string[]>>(m.reactions, {});
    const users = new Set(reactions[emoji] ?? []);
    users.has(me.id) ? users.delete(me.id) : users.add(me.id);
    if (users.size) reactions[emoji] = [...users];
    else delete reactions[emoji];
    await c.env.DB.prepare(`UPDATE messages SET reactions=? WHERE id=?`).bind(JSON.stringify(reactions), m.id).run();
  } else {
    if (m.user_id !== me.id) throw forbidden('You can only edit your own messages.');
    const text = String(b.body ?? '').trim();
    if (!text) throw bad('Message is empty.');
    await c.env.DB.prepare(`UPDATE messages SET body=?, edited_at=? WHERE id=?`).bind(text.slice(0, 10_000), now(), m.id).run();
  }
  const msg = await loadMessage(c, m.id);
  const aud = await audience(c, ch);
  broadcast(ctxOf(c), { t: 'message_update', row: msg }, aud ? { to: aud } : {});
  return c.json(msg);
});

chat.delete('/messages/:id', async (c) => {
  const me = c.get('user');
  const m = await c.env.DB.prepare(`SELECT * FROM messages WHERE id=?`).bind(c.req.param('id')).first<{ id: string; user_id: string; channel_id: string }>();
  if (!m) throw notFound('Message');
  if (m.user_id !== me.id && !isAdmin(me)) throw forbidden();
  await c.env.DB.prepare(`UPDATE messages SET deleted=1, body='' WHERE id=?`).bind(m.id).run();
  const ch = await channel(c, m.channel_id);
  const msg = await loadMessage(c, m.id);
  const aud = await audience(c, ch);
  broadcast(ctxOf(c), { t: 'message_update', row: msg }, aud ? { to: aud } : {});
  return c.json({ ok: true });
});

chat.post('/channels/:id/read', async (c) => {
  const me = c.get('user');
  const ch = await channel(c, c.req.param('id'));
  await c.env.DB.prepare(`INSERT INTO channel_members (channel_id, user_id, last_read_at) VALUES (?,?,?) ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_at=excluded.last_read_at`)
    .bind(ch.id, me.id, now())
    .run();
  return c.json({ ok: true });
});
