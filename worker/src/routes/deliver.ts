import { Hono } from 'hono';
import { type AppEnv, type C, bad, body, forbidden, id, isAdmin, notFound, now, toApi, visibleProjects } from '../lib/core';
import { ctxOf } from '../lib/auth';
import { publish, record } from '../lib/events';

/**
 * Deliverables: work is handed in as a Google Drive link. Submitting moves the task to review and
 * notifies whoever asked for it; they approve (task done) or request changes (back to in progress).
 */
export const deliver = new Hono<AppEnv>();

const DRIVE_HOSTS = ['drive.google.com', 'docs.google.com'];
export function checkDriveUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw bad('Paste the full Google Drive link (it starts with https://drive.google.com or https://docs.google.com).');
  }
  if (u.protocol !== 'https:' || !DRIVE_HOSTS.includes(u.hostname)) throw bad('Deliverables must be Google Drive links (drive.google.com or docs.google.com).');
  return u.toString();
}

/** Readable name from a Drive URL when the submitter gives none. */
function guessTitle(url: string): string {
  const m = /docs\.google\.com\/(document|presentation|spreadsheets|forms)\//.exec(url);
  if (m) return { document: 'Google Doc', presentation: 'Google Slides', spreadsheets: 'Google Sheet', forms: 'Google Form' }[m[1]]!;
  return /\/folders\//.test(url) ? 'Drive folder' : 'Drive file';
}

interface TaskCtx {
  id: string;
  project_id: string;
  number: number;
  title: string;
  status: string;
  assignee_id: string | null;
  reporter_id: string | null;
  pkey: string;
  lead_id: string | null;
}
async function task(c: C, tid: string) {
  const t = await c.env.DB.prepare(`SELECT t.*, p.key AS pkey, p.lead_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?`).bind(tid).first<TaskCtx>();
  if (!t) throw notFound('Task');
  return t;
}
const reviewersOf = (t: TaskCtx) => [...new Set([t.reporter_id, t.lead_id].filter((x): x is string => !!x))];
function canReview(c: C, t: TaskCtx) {
  const me = c.get('user');
  return isAdmin(me) || reviewersOf(t).includes(me.id);
}

export async function submitDeliverable(c: C, tid: string, input: { url: string; title?: string; note?: string }) {
  const me = c.get('user');
  const t = await task(c, tid);
  if (me.role === 'guest') throw forbidden();
  const isMember = !!(await c.env.DB.prepare(`SELECT 1 FROM project_members WHERE project_id=? AND user_id=?`).bind(t.project_id, me.id).first());
  if (t.assignee_id !== me.id && !isMember && !isAdmin(me)) throw forbidden('Only the assignee or project members can submit this.');
  const url = checkDriveUrl(input.url);
  const title = (input.title ?? '').trim().slice(0, 200) || guessTitle(url);
  const sid = id('sub');
  const ts = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO submissions (id, task_id, user_id, url, title, note, created_at) VALUES (?,?,?,?,?,?,?)`).bind(sid, t.id, me.id, url, title, (input.note ?? '').slice(0, 2000), ts),
    // Submitting sends the task to review (unless it was already finished).
    c.env.DB.prepare(`UPDATE tasks SET deliverable=1, status=CASE WHEN status='done' THEN status ELSE 'review' END, updated_at=? WHERE id=?`).bind(ts, t.id),
  ]);
  const ctx = ctxOf(c);
  await publish(ctx, 'tasks', [t.id]);
  const key = `${t.pkey}-${t.number}`;
  await record(ctx, {
    actorId: me.id,
    verb: 'submitted',
    entityType: 'task',
    entityId: t.id,
    projectId: t.project_id,
    summary: `submitted “${title}” for ${key}`,
    data: { url, key },
    notify: [{ userIds: reviewersOf(t), kind: 'status', title: `${me.name} submitted ${key} for review`, body: `${t.title} — ${title}`, link: `/projects/${t.pkey}?task=${t.id}` }],
  });
  return { id: sid, url, title, taskId: t.id, key };
}

deliver.post('/tasks/:id/submissions', async (c) => {
  const b = await body(c);
  return c.json(await submitDeliverable(c, c.req.param('id'), { url: String(b.url ?? ''), title: b.title ? String(b.title) : undefined, note: b.note ? String(b.note) : undefined }));
});

export async function reviewSubmission(c: C, sid: string, decision: 'approve' | 'changes', note: string) {
  const me = c.get('user');
  const s = await c.env.DB.prepare(`SELECT * FROM submissions WHERE id=?`).bind(sid).first<{ id: string; task_id: string; user_id: string | null; title: string; status: string }>();
  if (!s) throw notFound('Submission');
  const t = await task(c, s.task_id);
  if (!canReview(c, t)) throw forbidden('Only the person who asked for this, the project lead or an admin can review it.');
  if (s.status !== 'pending') throw bad('This submission was already reviewed.');
  if (decision === 'changes' && !note.trim()) throw bad('Say what needs to change.');
  const ts = now();
  const status = decision === 'approve' ? 'approved' : 'changes_requested';
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE submissions SET status=?, reviewer_id=?, review_note=?, reviewed_at=? WHERE id=?`).bind(status, me.id, note.slice(0, 2000), ts, s.id),
    decision === 'approve'
      ? c.env.DB.prepare(`UPDATE tasks SET status='done', completed_at=?, updated_at=? WHERE id=?`).bind(ts, ts, t.id)
      : c.env.DB.prepare(`UPDATE tasks SET status='in_progress', completed_at=NULL, updated_at=? WHERE id=?`).bind(ts, t.id),
  ]);
  const ctx = ctxOf(c);
  await publish(ctx, 'tasks', [t.id]);
  const key = `${t.pkey}-${t.number}`;
  await record(ctx, {
    actorId: me.id,
    verb: decision === 'approve' ? 'approved' : 'changes_requested',
    entityType: 'task',
    entityId: t.id,
    projectId: t.project_id,
    summary: decision === 'approve' ? `approved “${s.title}” and completed ${key}` : `requested changes on “${s.title}” for ${key}`,
    data: { key, note },
    notify: [
      {
        userIds: [s.user_id, t.assignee_id],
        kind: 'status',
        title: decision === 'approve' ? `${me.name} approved your submission for ${key}` : `${me.name} requested changes on ${key}`,
        body: note || t.title,
        link: `/projects/${t.pkey}?task=${t.id}`,
      },
    ],
  });
  return { ok: true, status, taskId: t.id, key };
}

deliver.post('/submissions/:id/review', async (c) => {
  const b = await body(c);
  const decision = b.decision === 'approve' ? 'approve' : b.decision === 'changes' ? 'changes' : null;
  if (!decision) throw bad('decision must be approve or changes.');
  return c.json(await reviewSubmission(c, c.req.param('id'), decision, String(b.note ?? '')));
});

/** Everything for the Submissions page: what I must hand in, what I must review, and recent history. */
deliver.get('/submissions/overview', async (c) => {
  const me = c.get('user');
  const vis = await visibleProjects(c.env, me);
  const scope = vis ? (vis.length ? `AND t.project_id IN (${vis.map(() => '?').join(',')})` : 'AND 0') : '';
  const args = vis ?? [];
  const db = c.env.DB;
  const [toReview, recent] = await Promise.all([
    db
      .prepare(
        `SELECT s.*, t.title AS task_title, t.number, t.reporter_id, p.key AS pkey, p.name AS pname, p.color, p.lead_id
         FROM submissions s JOIN tasks t ON t.id=s.task_id JOIN projects p ON p.id=t.project_id
         WHERE s.status='pending' ${scope} AND (? = 1 OR t.reporter_id = ? OR p.lead_id = ?)
         ORDER BY s.created_at`,
      )
      .bind(...args, isAdmin(me) ? 1 : 0, me.id, me.id)
      .all(),
    db
      .prepare(
        `SELECT s.*, t.title AS task_title, t.number, p.key AS pkey, p.name AS pname, p.color
         FROM submissions s JOIN tasks t ON t.id=s.task_id JOIN projects p ON p.id=t.project_id
         WHERE 1=1 ${scope} ORDER BY s.created_at DESC LIMIT 100`,
      )
      .bind(...args)
      .all(),
  ]);
  return c.json({ toReview: toReview.results.map((r) => toApi(r)), recent: recent.results.map((r) => toApi(r)) });
});
