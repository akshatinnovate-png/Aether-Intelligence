import { type Env, id, now, parseJson, toApi } from './core';
import { byIds, type EntityName, PROJECT_SCOPED } from './entities';
import { sendMail, mailConfigured, emailLayout } from './mail';

/** Everything that happens asynchronously after a request: realtime fan-out, email. */
export interface Ctx {
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
  origin?: string;
}

export interface BroadcastOpts {
  /** Only these users receive it. Omitted = everyone connected. */
  to?: string[];
  /** Guests get a lightweight "refresh" instead of rows (they refetch their own scoped view). */
  guests?: 'send' | 'skip' | 'refresh';
}

export function hub(env: Env) {
  return env.HUB.get(env.HUB.idFromName('lab'));
}

export function broadcast(ctx: Ctx, msg: Record<string, unknown>, opts: BroadcastOpts = {}) {
  ctx.waitUntil(
    hub(ctx.env)
      .broadcast(JSON.stringify(msg), opts)
      .catch((e: unknown) => console.error('broadcast failed', e)),
  );
}

/** Push the current version of rows to every client cache. */
export async function publish(ctx: Ctx, entity: EntityName, ids: string[]) {
  const rows = await byIds(ctx.env, entity, ids);
  const found = new Set(rows.map((r) => (r as { id: string }).id));
  const gone = ids.filter((i) => !found.has(i));
  const guests = PROJECT_SCOPED.includes(entity) ? 'refresh' : 'send';
  if (rows.length) broadcast(ctx, { t: 'upsert', e: entity, rows }, { guests });
  if (gone.length) broadcast(ctx, { t: 'delete', e: entity, ids: gone }, { guests });
  return rows;
}
export function publishDelete(ctx: Ctx, entity: EntityName, ids: string[]) {
  const guests = PROJECT_SCOPED.includes(entity) ? 'refresh' : 'send';
  broadcast(ctx, { t: 'delete', e: entity, ids }, { guests });
}

export interface NotifySpec {
  userIds: (string | null | undefined)[];
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  dedupe?: string;
}
export type NotificationKind = 'assigned' | 'mention' | 'comment' | 'status' | 'deadline' | 'competition' | 'booking' | 'team' | 'github' | 'message' | 'project';

export interface RecordOpts {
  actorId: string | null;
  verb: string;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  summary: string;
  data?: Record<string, unknown>;
  audit?: boolean;
  notify?: NotifySpec[];
}

/** Write to the single event log, fan out notifications, and stream the activity row to clients. */
export async function record(ctx: Ctx, o: RecordOpts) {
  const row = {
    id: id('act'),
    actor_id: o.actorId,
    verb: o.verb,
    entity_type: o.entityType,
    entity_id: o.entityId,
    project_id: o.projectId ?? null,
    summary: o.summary,
    data: JSON.stringify(o.data ?? {}),
    audit: o.audit ? 1 : 0,
    created_at: now(),
  };
  await ctx.env.DB.prepare(
    `INSERT INTO activity (id, actor_id, verb, entity_type, entity_id, project_id, summary, data, audit, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(row.id, row.actor_id, row.verb, row.entity_type, row.entity_id, row.project_id, row.summary, row.data, row.audit, row.created_at)
    .run();
  broadcast(ctx, { t: 'activity', row: toApi(row, ['data'], ['audit']) }, { guests: 'skip' });
  for (const n of o.notify ?? []) await notify(ctx, n, o.actorId);
}

export async function notify(ctx: Ctx, n: NotifySpec, actorId: string | null) {
  const ids = [...new Set(n.userIds.filter((u): u is string => !!u && u !== actorId))];
  if (!ids.length) return;
  const users = await ctx.env.DB.prepare(
    `SELECT id, email, name, prefs, status FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<{ id: string; email: string; name: string; prefs: string; status: string }>();
  const created = now();
  const emailTo: { email: string; name: string }[] = [];
  for (const u of users.results) {
    if (u.status !== 'active') continue;
    const prefs = parseJson<{ notify?: Record<string, boolean>; email?: Record<string, boolean> }>(u.prefs, {});
    if (prefs.notify?.[n.kind] === false) continue;
    const nid = id('ntf');
    const res = await ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, kind, title, body, link, actor_id, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
      .bind(nid, u.id, n.kind, n.title, n.body ?? '', n.link ?? '', actorId, n.dedupe ? `${n.dedupe}` : null, created)
      .run();
    if (!res.meta.changes) continue; // deduped
    broadcast(
      ctx,
      { t: 'notification', row: { id: nid, userId: u.id, kind: n.kind, title: n.title, body: n.body ?? '', link: n.link ?? '', actorId, readAt: null, createdAt: created } },
      { to: [u.id] },
    );
    if (prefs.email?.[n.kind]) emailTo.push({ email: u.email, name: u.name });
  }
  if (emailTo.length) {
    ctx.waitUntil(
      (async () => {
        if (!(await mailConfigured(ctx.env))) return;
        const base = ctx.origin ?? ctx.env.APP_URL ?? '';
        for (const r of emailTo) {
          await sendMail(ctx.env, {
            to: r.email,
            subject: n.title,
            text: `${n.title}\n\n${n.body ?? ''}\n\n${base}${n.link ?? ''}`,
            html: emailLayout(n.title, `<p>${escapeHtml(n.body ?? '')}</p>`, n.link ? { label: 'Open in Aether', url: `${base}${n.link}` } : undefined),
          }).catch((e) => console.error('notify email failed', e));
        }
      })(),
    );
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Mentions are stored as <@usr_xxx> tokens. */
export function mentionedIds(text: string): string[] {
  return [...new Set([...text.matchAll(/<@(usr_[a-z0-9]+)>/g)].map((m) => m[1]))];
}
export async function plainMentions(env: Env, text: string): Promise<string> {
  const ids = mentionedIds(text);
  if (!ids.length) return text;
  const rs = await env.DB.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; name: string }>();
  const names = Object.fromEntries(rs.results.map((r) => [r.id, r.name]));
  return text.replace(/<@(usr_[a-z0-9]+)>/g, (_, u) => `@${names[u] ?? 'someone'}`);
}
