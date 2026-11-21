import { Hono } from 'hono';
import { type AppEnv, type C, type SessionUser, type Spec, bad, body, forbidden, HttpError, id, insertSql, isAdmin, notFound, now, pick, RANK, run, toApi, updateSql } from '../lib/core';
import { ctxOf } from '../lib/auth';
import { type EntityName, list, one } from '../lib/entities';
import { broadcast, publish, publishDelete, record } from '../lib/events';

export const lab = new Hono<AppEnv>();

interface CrudDef {
  entity: EntityName;
  table: string;
  prefix: string;
  path: string;
  label: string;
  spec: Spec;
  name: (row: Record<string, unknown>) => string;
  canCreate?: (u: SessionUser) => boolean;
  canEdit?: (u: SessionUser, row: Record<string, unknown>) => boolean;
  canDelete?: (u: SessionUser, row: Record<string, unknown>) => boolean;
  defaults?: (u: SessionUser) => Record<string, unknown>;
  timestamps?: boolean;
  /** Runs after insert/update with the raw body; returns extra statements (e.g. member lists). */
  extra?: (c: C, rowId: string, b: Record<string, unknown>) => D1PreparedStatement[];
  afterCreate?: (c: C, row: Record<string, unknown>) => Promise<void>;
  afterUpdate?: (c: C, before: Record<string, unknown>, after: Record<string, unknown>) => Promise<boolean>;
}
const notGuest = (u: SessionUser) => u.role !== 'guest';

function crud(def: CrudDef) {
  lab.get(`/${def.path}`, async (c) => c.json(await list(c.env, def.entity)));

  lab.post(`/${def.path}`, async (c) => {
    const me = c.get('user');
    if (!(def.canCreate ?? notGuest)(me)) throw forbidden();
    const b = await body(c);
    const data = { ...(def.defaults?.(me) ?? {}), ...pick(b, def.spec, 'create') };
    const rid = id(def.prefix);
    const t = now();
    Object.assign(data, { id: rid, created_at: t });
    if (def.timestamps !== false) data.updated_at = t;
    const ins = insertSql(def.table, data);
    await c.env.DB.batch([c.env.DB.prepare(ins.sql).bind(...ins.args), ...(def.extra?.(c, rid, b) ?? [])]);
    const ctx = ctxOf(c);
    const [row] = await publish(ctx, def.entity, [rid]);
    if (def.afterCreate) await def.afterCreate(c, row as Record<string, unknown>);
    else await record(ctx, { actorId: me.id, verb: 'created', entityType: def.label, entityId: rid, summary: `added ${def.label} “${def.name(data)}”` });
    return c.json(row);
  });

  lab.patch(`/${def.path}/:id`, async (c) => {
    const me = c.get('user');
    const rid = c.req.param('id');
    const before = await one<Record<string, unknown>>(c.env, def.entity, rid);
    if (!before) throw notFound(def.label);
    if (!(def.canEdit ?? notGuest)(me, before)) throw forbidden();
    const b = await body(c);
    const data = pick(b, def.spec, 'update');
    if (def.timestamps !== false) data.updated_at = now();
    const stmts: D1PreparedStatement[] = [];
    const upd = updateSql(def.table, rid, data);
    if (upd) stmts.push(c.env.DB.prepare(upd.sql).bind(...upd.args));
    stmts.push(...(def.extra?.(c, rid, b) ?? []));
    if (stmts.length) await c.env.DB.batch(stmts);
    const ctx = ctxOf(c);
    const [row] = await publish(ctx, def.entity, [rid]);
    const handled = def.afterUpdate ? await def.afterUpdate(c, before, row as Record<string, unknown>) : false;
    if (!handled) await record(ctx, { actorId: me.id, verb: 'updated', entityType: def.label, entityId: rid, summary: `updated ${def.label} “${def.name(row as Record<string, unknown>)}”` });
    return c.json(row);
  });

  lab.delete(`/${def.path}/:id`, async (c) => {
    const me = c.get('user');
    const rid = c.req.param('id');
    const before = await one<Record<string, unknown>>(c.env, def.entity, rid);
    if (!before) throw notFound(def.label);
    if (!(def.canDelete ?? def.canEdit ?? notGuest)(me, before)) throw forbidden();
    await c.env.DB.prepare(`DELETE FROM ${def.table} WHERE id=?`).bind(rid).run();
    const ctx = ctxOf(c);
    publishDelete(ctx, def.entity, [rid]);
    await record(ctx, { actorId: me.id, verb: 'deleted', entityType: def.label, entityId: rid, summary: `removed ${def.label} “${def.name(before)}”` });
    return c.json({ ok: true });
  });
}

const memberStmts = (table: string, col: string) => (c: C, rid: string, b: Record<string, unknown>) => {
  if (!Array.isArray(b.members)) return [];
  return [
    c.env.DB.prepare(`DELETE FROM ${table} WHERE ${col}=?`).bind(rid),
    ...(b.members as string[]).map((u) => c.env.DB.prepare(`INSERT OR IGNORE INTO ${table} (${col}, user_id) SELECT ?, id FROM users WHERE id=?`).bind(rid, String(u))),
  ];
};

// ---------- competitions ----------
const STAGES = ['discovered', 'registered', 'building', 'submitted', 'finalist', 'result'] as const;
const STAGE_LABEL: Record<string, string> = { discovered: 'Discovered', registered: 'Registered', building: 'Building', submitted: 'Submitted', finalist: 'Finalist', result: 'Result' };
crud({
  entity: 'competitions',
  table: 'competitions',
  prefix: 'cmp',
  path: 'competitions',
  label: 'competition',
  name: (r) => String(r.name),
  defaults: (u) => ({ created_by: u.id }),
  spec: {
    name: { col: 'name', type: 'string', max: 200, required: true },
    organizer: { col: 'organizer', type: 'string', max: 200 },
    url: { col: 'url', type: 'string', max: 500 },
    stage: { col: 'stage', type: 'enum', values: STAGES },
    description: { col: 'description', type: 'text', max: 20_000 },
    registrationDeadline: { col: 'registration_deadline', type: 'datetime' },
    deadline: { col: 'deadline', type: 'datetime' },
    eventDate: { col: 'event_date', type: 'date' },
    requirements: { col: 'requirements', type: 'json' },
    submissionLinks: { col: 'submission_links', type: 'json' },
    prize: { col: 'prize', type: 'string', max: 300 },
    result: { col: 'result', type: 'text', max: 5000 },
    outcome: { col: 'outcome', type: 'enum', values: ['', 'won', 'placed', 'finalist', 'not_selected'] },
    projectId: { col: 'project_id', type: 'id', nullable: true },
  },
  extra: memberStmts('competition_members', 'competition_id'),
  async afterCreate(c, row) {
    const me = c.get('user');
    await record(ctxOf(c), {
      actorId: me.id,
      verb: 'created',
      entityType: 'competition',
      entityId: String(row.id),
      summary: `added competition “${row.name}”${row.deadline ? `, due ${String(row.deadline).slice(0, 10)}` : ''}`,
      notify: [{ userIds: row.members as string[], kind: 'competition', title: `You’re on the team for ${row.name}`, link: `/competitions?c=${row.id}` }],
    });
  },
  async afterUpdate(c, before, after) {
    const me = c.get('user');
    const ctx = ctxOf(c);
    let handled = false;
    const members = after.members as string[];
    if (before.stage !== after.stage) {
      handled = true;
      await record(ctx, {
        actorId: me.id,
        verb: 'stage',
        entityType: 'competition',
        entityId: String(after.id),
        projectId: (after.projectId as string) ?? null,
        summary: `moved ${after.name} to ${STAGE_LABEL[String(after.stage)]}`,
        data: { from: before.stage, to: after.stage },
        notify: [{ userIds: members, kind: 'competition', title: `${after.name}: ${STAGE_LABEL[String(after.stage)]}`, link: `/competitions?c=${after.id}` }],
      });
    }
    if (before.outcome !== after.outcome && after.outcome) {
      handled = true;
      const label = { won: 'won', placed: 'placed at', finalist: 'reached the finals of', not_selected: 'completed' }[String(after.outcome)] ?? 'completed';
      await record(ctx, { actorId: me.id, verb: 'result', entityType: 'competition', entityId: String(after.id), summary: `recorded: the team ${label} ${after.name}`, notify: [{ userIds: members, kind: 'competition', title: `Result recorded for ${after.name}`, body: String(after.result ?? ''), link: `/competitions?c=${after.id}` }] });
      // Wins and placements become achievements for every team member.
      if (after.outcome === 'won' || after.outcome === 'placed' || after.outcome === 'finalist') {
        const t = now();
        const title = `${after.outcome === 'won' ? 'Winner' : after.outcome === 'placed' ? 'Placed' : 'Finalist'} — ${after.name}`;
        const stmts = members.map((u) =>
          c.env.DB.prepare(`INSERT INTO achievements (id, user_id, title, description, kind, date, created_by, created_at) VALUES (?,?,?,?, 'competition', ?, ?, ?)`).bind(id('ach'), u, title, String(after.result ?? ''), t.slice(0, 10), me.id, t),
        );
        if (stmts.length) {
          await c.env.DB.batch(stmts);
          broadcast(ctx, { t: 'reload', e: 'achievements' });
        }
      }
    }
    const beforeMembers = new Set(before.members as string[]);
    const added = members.filter((m) => !beforeMembers.has(m));
    if (added.length) {
      handled = true;
      await record(ctx, { actorId: me.id, verb: 'members', entityType: 'competition', entityId: String(after.id), summary: `updated the team for ${after.name}`, notify: [{ userIds: added, kind: 'competition', title: `You’re on the team for ${after.name}`, link: `/competitions?c=${after.id}` }] });
    }
    if (before.deadline !== after.deadline) {
      handled = true;
      await record(ctx, { actorId: me.id, verb: 'rescheduled', entityType: 'competition', entityId: String(after.id), summary: `set the ${after.name} deadline to ${String(after.deadline ?? '—').slice(0, 10)}`, notify: [{ userIds: members, kind: 'deadline', title: `${after.name} deadline changed`, body: String(after.deadline ?? '').slice(0, 16).replace('T', ' '), link: `/competitions?c=${after.id}` }] });
    }
    const reqBefore = (before.requirements as { done: boolean }[]) ?? [];
    const reqAfter = (after.requirements as { done: boolean; text: string }[]) ?? [];
    if (!handled && reqBefore.filter((r) => r.done).length !== reqAfter.filter((r) => r.done).length) {
      handled = true;
      await record(ctx, { actorId: me.id, verb: 'progress', entityType: 'competition', entityId: String(after.id), summary: `${after.name}: ${reqAfter.filter((r) => r.done).length}/${reqAfter.length} requirements done` });
    }
    return handled;
  },
});

// ---------- equipment ----------
const canManageEquipment = (u: SessionUser) => RANK[u.role] >= RANK.lead;
crud({
  entity: 'equipment',
  table: 'equipment',
  prefix: 'eqp',
  path: 'equipment',
  label: 'equipment',
  name: (r) => String(r.name),
  canCreate: canManageEquipment,
  canEdit: (u) => canManageEquipment(u),
  spec: {
    name: { col: 'name', type: 'string', max: 200, required: true },
    category: { col: 'category', type: 'enum', values: ['computer', 'server', 'component', 'electronics', 'license', 'other'] },
    tag: { col: 'tag', type: 'string', max: 60 },
    serial: { col: 'serial', type: 'string', max: 120 },
    location: { col: 'location', type: 'string', max: 120 },
    specs: { col: 'specs', type: 'text', max: 5000 },
    notes: { col: 'notes', type: 'text', max: 5000 },
    condition: { col: 'condition', type: 'enum', values: ['operational', 'maintenance', 'broken', 'retired'] },
    quantity: { col: 'quantity', type: 'int' },
    assignedTo: { col: 'assigned_to', type: 'id', nullable: true },
    bookable: { col: 'bookable', type: 'bool' },
    licenseSeats: { col: 'license_seats', type: 'int' },
    licenseExpiry: { col: 'license_expiry', type: 'date' },
    nextMaintenance: { col: 'next_maintenance', type: 'date' },
    purchaseDate: { col: 'purchase_date', type: 'date' },
  },
  async afterUpdate(c, before, after) {
    const me = c.get('user');
    const ctx = ctxOf(c);
    if (before.condition !== after.condition) {
      await c.env.DB.prepare(`INSERT INTO maintenance_logs (id, equipment_id, user_id, note, created_at) VALUES (?,?,?,?,?)`).bind(id('mnt'), after.id, me.id, `Status changed: ${before.condition} → ${after.condition}`, now()).run();
      const upcoming = await c.env.DB.prepare(`SELECT DISTINCT user_id FROM bookings WHERE equipment_id=? AND ends_at>?`).bind(after.id, now()).all<{ user_id: string }>();
      await record(ctx, {
        actorId: me.id,
        verb: 'condition',
        entityType: 'equipment',
        entityId: String(after.id),
        summary: `marked ${after.name} as ${after.condition}`,
        notify: after.condition !== 'operational' ? [{ userIds: upcoming.results.map((r) => r.user_id), kind: 'booking', title: `${after.name} is now ${after.condition}`, body: 'You have an upcoming booking for this item.', link: `/equipment?e=${after.id}` }] : [],
      });
      return true;
    }
    if (before.assignedTo !== after.assignedTo) {
      const name = after.assignedTo ? (await c.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(after.assignedTo).first<{ name: string }>())?.name : null;
      await record(ctx, { actorId: me.id, verb: 'assigned', entityType: 'equipment', entityId: String(after.id), summary: name ? `assigned ${after.name} to ${name}` : `returned ${after.name} to the pool`, notify: [{ userIds: [after.assignedTo as string], kind: 'booking', title: `${after.name} is assigned to you`, link: `/equipment?e=${after.id}` }] });
      return true;
    }
    return false;
  },
});

lab.get('/equipment/:id/log', async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM maintenance_logs WHERE equipment_id=? ORDER BY created_at DESC LIMIT 100`).bind(c.req.param('id')).all();
  return c.json(rs.results.map((r) => toApi(r)));
});
lab.post('/equipment/:id/log', async (c) => {
  const me = c.get('user');
  if (me.role === 'guest') throw forbidden();
  const eq = await c.env.DB.prepare(`SELECT name FROM equipment WHERE id=?`).bind(c.req.param('id')).first<{ name: string }>();
  if (!eq) throw notFound('Equipment');
  const note = String((await body(c)).note ?? '').trim().slice(0, 2000);
  if (!note) throw bad('Note is empty.');
  await c.env.DB.prepare(`INSERT INTO maintenance_logs (id, equipment_id, user_id, note, created_at) VALUES (?,?,?,?,?)`).bind(id('mnt'), c.req.param('id'), me.id, note, now()).run();
  await record(ctxOf(c), { actorId: me.id, verb: 'logged', entityType: 'equipment', entityId: c.req.param('id'), summary: `logged maintenance on ${eq.name}` });
  return c.json({ ok: true });
});

// ---------- bookings ----------
lab.get('/bookings', async (c) => {
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  return c.json(await list(c.env, 'bookings', 'x.ends_at > ?', [since]));
});
async function checkBooking(c: C, equipmentId: string, start: string, end: string, ignoreId?: string) {
  if (!(end > start)) throw bad('The booking must end after it starts.');
  const eq = await c.env.DB.prepare(`SELECT * FROM equipment WHERE id=?`).bind(equipmentId).first<{ id: string; name: string; condition: string; bookable: number; quantity: number }>();
  if (!eq) throw notFound('Equipment');
  if (!eq.bookable) throw bad(`${eq.name} is not bookable.`);
  if (eq.condition !== 'operational') throw bad(`${eq.name} is ${eq.condition} and cannot be booked.`);
  const overlap = await c.env.DB.prepare(
    `SELECT b.starts_at, b.ends_at, u.name FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.equipment_id=? AND b.starts_at < ? AND b.ends_at > ? AND b.id <> ?`,
  )
    .bind(equipmentId, end, start, ignoreId ?? '')
    .all<{ starts_at: string; ends_at: string; name: string }>();
  if (overlap.results.length >= Math.max(1, eq.quantity)) {
    const o = overlap.results[0];
    throw new HttpError(409, `${eq.name} is already booked by ${o.name} for part of that time.`);
  }
  return eq;
}
lab.post('/bookings', async (c) => {
  const me = c.get('user');
  if (me.role === 'guest') throw forbidden();
  const b = await body(c);
  const data = pick(
    b,
    {
      equipmentId: { col: 'equipment_id', type: 'id', required: true },
      startsAt: { col: 'starts_at', type: 'datetime', required: true },
      endsAt: { col: 'ends_at', type: 'datetime', required: true },
      purpose: { col: 'purpose', type: 'string', max: 300 },
      projectId: { col: 'project_id', type: 'id', nullable: true },
    },
    'create',
  );
  const eq = await checkBooking(c, String(data.equipment_id), String(data.starts_at), String(data.ends_at));
  const bid = id('bkg');
  const userId = isAdmin(me) && b.userId ? String(b.userId) : me.id;
  Object.assign(data, { id: bid, user_id: userId, created_at: now() });
  await run(c.env.DB, insertSql('bookings', data));
  const ctx = ctxOf(c);
  const [row] = await publish(ctx, 'bookings', [bid]);
  await publish(ctx, 'equipment', [eq.id]);
  const day = String(data.starts_at).slice(0, 16).replace('T', ' ');
  await record(ctx, { actorId: me.id, verb: 'booked', entityType: 'equipment', entityId: eq.id, projectId: (data.project_id as string) ?? null, summary: `booked ${eq.name} from ${day} UTC`, notify: userId !== me.id ? [{ userIds: [userId], kind: 'booking', title: `${me.name} booked ${eq.name} for you`, body: day, link: `/equipment?e=${eq.id}` }] : [] });
  return c.json(row);
});
lab.patch('/bookings/:id', async (c) => {
  const me = c.get('user');
  const bk = await c.env.DB.prepare(`SELECT * FROM bookings WHERE id=?`).bind(c.req.param('id')).first<{ id: string; user_id: string; equipment_id: string; starts_at: string; ends_at: string }>();
  if (!bk) throw notFound('Booking');
  if (bk.user_id !== me.id && !isAdmin(me)) throw forbidden('You can only change your own bookings.');
  const b = await body(c);
  const data = pick(b, { startsAt: { col: 'starts_at', type: 'datetime' }, endsAt: { col: 'ends_at', type: 'datetime' }, purpose: { col: 'purpose', type: 'string', max: 300 } }, 'update');
  await checkBooking(c, bk.equipment_id, String(data.starts_at ?? bk.starts_at), String(data.ends_at ?? bk.ends_at), bk.id);
  await run(c.env.DB, updateSql('bookings', bk.id, data));
  const ctx = ctxOf(c);
  const [row] = await publish(ctx, 'bookings', [bk.id]);
  return c.json(row);
});
lab.delete('/bookings/:id', async (c) => {
  const me = c.get('user');
  const bk = await c.env.DB.prepare(`SELECT b.*, e.name FROM bookings b JOIN equipment e ON e.id=b.equipment_id WHERE b.id=?`).bind(c.req.param('id')).first<{ id: string; user_id: string; equipment_id: string; name: string }>();
  if (!bk) throw notFound('Booking');
  if (bk.user_id !== me.id && !isAdmin(me)) throw forbidden('You can only cancel your own bookings.');
  await c.env.DB.prepare(`DELETE FROM bookings WHERE id=?`).bind(bk.id).run();
  const ctx = ctxOf(c);
  publishDelete(ctx, 'bookings', [bk.id]);
  await record(ctx, { actorId: me.id, verb: 'cancelled', entityType: 'equipment', entityId: bk.equipment_id, summary: `cancelled a booking for ${bk.name}`, notify: bk.user_id !== me.id ? [{ userIds: [bk.user_id], kind: 'booking', title: `Your booking for ${bk.name} was cancelled`, link: `/equipment?e=${bk.equipment_id}` }] : [] });
  return c.json({ ok: true });
});

// ---------- calendar events ----------
crud({
  entity: 'events',
  table: 'calendar_events',
  prefix: 'evt',
  path: 'events',
  label: 'event',
  timestamps: false,
  name: (r) => String(r.title),
  defaults: (u) => ({ created_by: u.id }),
  canEdit: (u, r) => isAdmin(u) || r.createdBy === u.id || u.role === 'lead',
  spec: {
    title: { col: 'title', type: 'string', max: 200, required: true },
    kind: { col: 'kind', type: 'enum', values: ['meeting', 'deadline', 'event', 'review'] },
    startsAt: { col: 'starts_at', type: 'datetime', required: true },
    endsAt: { col: 'ends_at', type: 'datetime' },
    allDay: { col: 'all_day', type: 'bool' },
    location: { col: 'location', type: 'string', max: 200 },
    description: { col: 'description', type: 'text', max: 10_000 },
    projectId: { col: 'project_id', type: 'id', nullable: true },
    attendees: { col: 'attendees', type: 'json' },
  },
  async afterCreate(c, row) {
    const me = c.get('user');
    const when = String(row.startsAt).slice(0, 16).replace('T', ' ');
    await record(ctxOf(c), {
      actorId: me.id,
      verb: 'scheduled',
      entityType: 'event',
      entityId: String(row.id),
      projectId: (row.projectId as string) ?? null,
      summary: `scheduled ${row.kind} “${row.title}” for ${when} UTC`,
      notify: [{ userIds: (row.attendees as string[]) ?? [], kind: row.kind === 'deadline' ? 'deadline' : 'project', title: `${me.name} invited you: ${row.title}`, body: `${when} UTC`, link: `/calendar?d=${String(row.startsAt).slice(0, 10)}` }],
    });
  },
});

// ---------- research ----------
crud({
  entity: 'collections',
  table: 'collections',
  prefix: 'col',
  path: 'collections',
  label: 'collection',
  timestamps: false,
  name: (r) => String(r.name),
  defaults: (u) => ({ created_by: u.id }),
  spec: { name: { col: 'name', type: 'string', max: 120, required: true }, description: { col: 'description', type: 'text', max: 2000 } },
});

const paperSpec: Spec = {
  kind: { col: 'kind', type: 'enum', values: ['paper', 'document', 'note', 'reference'] },
  title: { col: 'title', type: 'string', max: 400, required: true },
  authors: { col: 'authors', type: 'string', max: 1000 },
  abstract: { col: 'abstract', type: 'text', max: 20_000 },
  body: { col: 'body', type: 'text', max: 500_000 },
  url: { col: 'url', type: 'string', max: 1000 },
  doi: { col: 'doi', type: 'string', max: 200 },
  venue: { col: 'venue', type: 'string', max: 200 },
  year: { col: 'year', type: 'int' },
  tags: { col: 'tags', type: 'json' },
  status: { col: 'status', type: 'enum', values: ['to_read', 'reading', 'read', 'draft', 'published', 'archived'] },
  collectionId: { col: 'collection_id', type: 'id', nullable: true },
  projectId: { col: 'project_id', type: 'id', nullable: true },
  attachmentId: { col: 'attachment_id', type: 'id', nullable: true },
};
const KIND_LABEL: Record<string, string> = { paper: 'paper', document: 'document', note: 'note', reference: 'reference' };
crud({
  entity: 'papers',
  table: 'papers',
  prefix: 'pap',
  path: 'papers',
  label: 'paper',
  name: (r) => String(r.title),
  defaults: (u) => ({ added_by: u.id }),
  spec: paperSpec,
  async afterCreate(c, row) {
    const me = c.get('user');
    await record(ctxOf(c), { actorId: me.id, verb: 'created', entityType: 'paper', entityId: String(row.id), projectId: (row.projectId as string) ?? null, summary: `added ${KIND_LABEL[String(row.kind)]} “${row.title}” to the research vault` });
  },
  async afterUpdate(c, before, after) {
    if (before.status !== after.status) {
      const me = c.get('user');
      await record(ctxOf(c), { actorId: me.id, verb: 'status', entityType: 'paper', entityId: String(after.id), summary: `marked “${after.title}” as ${String(after.status).replace('_', ' ')}` });
      return true;
    }
    return false;
  },
});
lab.get('/papers/:id/body', async (c) => {
  const r = await c.env.DB.prepare(`SELECT body FROM papers WHERE id=?`).bind(c.req.param('id')).first<{ body: string }>();
  if (!r) throw notFound('Paper');
  return c.json({ body: r.body });
});
lab.put('/papers/:id/progress', async (c) => {
  const me = c.get('user');
  const p = await c.env.DB.prepare(`SELECT id, title, status FROM papers WHERE id=?`).bind(c.req.param('id')).first<{ id: string; title: string; status: string }>();
  if (!p) throw notFound('Paper');
  const progress = Math.max(0, Math.min(100, Math.round(Number((await body(c)).progress ?? 0))));
  const prev = await c.env.DB.prepare(`SELECT progress FROM paper_progress WHERE paper_id=? AND user_id=?`).bind(p.id, me.id).first<{ progress: number }>();
  await c.env.DB.prepare(`INSERT INTO paper_progress (paper_id, user_id, progress, updated_at) VALUES (?,?,?,?) ON CONFLICT(paper_id, user_id) DO UPDATE SET progress=excluded.progress, updated_at=excluded.updated_at`)
    .bind(p.id, me.id, progress, now())
    .run();
  // Moving through a paper moves it through the pipeline.
  if (progress > 0 && progress < 100 && p.status === 'to_read') await c.env.DB.prepare(`UPDATE papers SET status='reading', updated_at=? WHERE id=?`).bind(now(), p.id).run();
  if (progress === 100 && (p.status === 'to_read' || p.status === 'reading')) await c.env.DB.prepare(`UPDATE papers SET status='read', updated_at=? WHERE id=?`).bind(now(), p.id).run();
  const ctx = ctxOf(c);
  const [row] = await publish(ctx, 'papers', [p.id]);
  if (progress === 100 && (prev?.progress ?? 0) < 100) await record(ctx, { actorId: me.id, verb: 'read', entityType: 'paper', entityId: p.id, summary: `finished reading “${p.title}”` });
  else if (!prev && progress > 0) await record(ctx, { actorId: me.id, verb: 'reading', entityType: 'paper', entityId: p.id, summary: `started reading “${p.title}”` });
  return c.json(row);
});
