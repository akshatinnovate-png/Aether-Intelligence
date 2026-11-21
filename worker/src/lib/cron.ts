import { type Env, now } from './core';
import { type Ctx, notify } from './events';

/**
 * Runs hourly. Every reminder carries a dedupe key, so running more often never double-notifies.
 */
export async function runSchedule(env: Env, ctx: ExecutionContext) {
  const c: Ctx = { env, waitUntil: (p) => ctx.waitUntil(p) };
  const today = now().slice(0, 10);
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const in3 = new Date(Date.now() + 3 * 864e5).toISOString();
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const db = env.DB;

  // Tasks due today / tomorrow, and newly overdue.
  const due = await db
    .prepare(
      `SELECT t.id, t.title, t.number, t.due_date, t.assignee_id, p.key FROM tasks t JOIN projects p ON p.id=t.project_id
       WHERE t.status<>'done' AND t.assignee_id IS NOT NULL AND t.due_date IS NOT NULL AND t.due_date <= ? AND p.archived=0`,
    )
    .bind(tomorrow)
    .all<{ id: string; title: string; number: number; due_date: string; assignee_id: string; key: string }>();
  for (const t of due.results) {
    const key = `${t.key}-${t.number}`;
    const state = t.due_date < today ? 'overdue' : t.due_date === today ? 'today' : 'tomorrow';
    await notify(
      c,
      {
        userIds: [t.assignee_id],
        kind: 'deadline',
        title: state === 'overdue' ? `${key} is overdue` : `${key} is due ${state}`,
        body: t.title,
        link: `/projects/${t.key}?task=${t.id}`,
        dedupe: `task:${t.id}:${state}:${state === 'overdue' ? 'once' : t.due_date}`,
      },
      null,
    );
  }

  // Competition deadlines within 3 days.
  const comps = await db
    .prepare(`SELECT id, name, deadline, registration_deadline, stage FROM competitions WHERE stage NOT IN ('submitted','finalist','result') AND ((deadline > ? AND deadline <= ?) OR (registration_deadline > ? AND registration_deadline <= ?))`)
    .bind(now(), in3, now(), in3)
    .all<{ id: string; name: string; deadline: string | null; registration_deadline: string | null; stage: string }>();
  for (const cm of comps.results) {
    const members = await db.prepare(`SELECT user_id FROM competition_members WHERE competition_id=?`).bind(cm.id).all<{ user_id: string }>();
    const reg = cm.stage === 'discovered' && cm.registration_deadline && cm.registration_deadline <= in3;
    const when = (reg ? cm.registration_deadline : cm.deadline)!;
    await notify(
      c,
      {
        userIds: members.results.map((m) => m.user_id),
        kind: 'competition',
        title: `${cm.name}: ${reg ? 'registration' : 'submission'} closes ${when.slice(0, 16).replace('T', ' ')} UTC`,
        link: `/competitions?c=${cm.id}`,
        dedupe: `comp:${cm.id}:${reg ? 'reg' : 'sub'}:${when}`,
      },
      null,
    );
  }

  // Bookings that start in the next 2 hours.
  const soon = new Date(Date.now() + 2 * 3600e3).toISOString();
  const bookings = await db
    .prepare(`SELECT b.id, b.user_id, b.starts_at, e.name, e.id AS eid FROM bookings b JOIN equipment e ON e.id=b.equipment_id WHERE b.starts_at > ? AND b.starts_at <= ?`)
    .bind(now(), soon)
    .all<{ id: string; user_id: string; starts_at: string; name: string; eid: string }>();
  for (const b of bookings.results)
    await notify(c, { userIds: [b.user_id], kind: 'booking', title: `Your booking for ${b.name} starts soon`, body: `${b.starts_at.slice(11, 16)} UTC`, link: `/equipment?e=${b.eid}`, dedupe: `booking:${b.id}` }, null);

  // Licences expiring and maintenance due within 14 days → admins.
  const admins = (await db.prepare(`SELECT id FROM users WHERE role IN ('owner','admin') AND status='active'`).all<{ id: string }>()).results.map((r) => r.id);
  const eq = await db
    .prepare(`SELECT id, name, license_expiry, next_maintenance FROM equipment WHERE condition<>'retired' AND ((license_expiry IS NOT NULL AND license_expiry <= ?) OR (next_maintenance IS NOT NULL AND next_maintenance <= ?))`)
    .bind(in14, in14)
    .all<{ id: string; name: string; license_expiry: string | null; next_maintenance: string | null }>();
  for (const e of eq.results) {
    if (e.license_expiry && e.license_expiry <= in14)
      await notify(c, { userIds: admins, kind: 'booking', title: `${e.name} licence ${e.license_expiry < today ? 'has expired' : `expires ${e.license_expiry}`}`, link: `/equipment?e=${e.id}`, dedupe: `lic:${e.id}:${e.license_expiry}` }, null);
    if (e.next_maintenance && e.next_maintenance <= in14)
      await notify(c, { userIds: admins, kind: 'booking', title: `${e.name} maintenance due ${e.next_maintenance}`, link: `/equipment?e=${e.id}`, dedupe: `mnt:${e.id}:${e.next_maintenance}` }, null);
  }

  // Meetings in the next 2 hours → attendees.
  const events = await db.prepare(`SELECT id, title, starts_at, attendees FROM calendar_events WHERE starts_at > ? AND starts_at <= ?`).bind(now(), soon).all<{ id: string; title: string; starts_at: string; attendees: string }>();
  for (const ev of events.results)
    await notify(c, { userIds: JSON.parse(ev.attendees || '[]'), kind: 'deadline', title: `Starting soon: ${ev.title}`, body: `${ev.starts_at.slice(11, 16)} UTC`, link: `/calendar?d=${ev.starts_at.slice(0, 10)}`, dedupe: `evt:${ev.id}` }, null);

  // Housekeeping.
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now()),
    db.prepare(`DELETE FROM login_failures WHERE created_at < ?`).bind(new Date(Date.now() - 864e5).toISOString()),
    db.prepare(`DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?`).bind(new Date(Date.now() - 60 * 864e5).toISOString()),
  ]);
}
