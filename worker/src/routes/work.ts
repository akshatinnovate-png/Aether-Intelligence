import { Hono } from 'hono';
import {
  type AppEnv,
  type C,
  type Spec,
  assertWriteProject,
  bad,
  body,
  canManageProject,
  forbidden,
  id,
  insertSql,
  isAdmin,
  notFound,
  now,
  pick,
  RANK,
  run,
  toApi,
  updateSql,
  visibleProjects,
} from '../lib/core';
import { ctxOf } from '../lib/auth';
import { listForProjects } from '../lib/entities';
import { broadcast, mentionedIds, plainMentions, publish, publishDelete, record } from '../lib/events';

export const work = new Hono<AppEnv>();

const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
const STATUS_LABEL: Record<string, string> = { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done' };

const projectSpec: Spec = {
  name: { col: 'name', type: 'string', max: 120, required: true },
  description: { col: 'description', type: 'text', max: 20_000 },
  kind: { col: 'kind', type: 'enum', values: ['engineering', 'research', 'competition', 'operations'] },
  status: { col: 'status', type: 'enum', values: ['planning', 'active', 'paused', 'done'] },
  priority: { col: 'priority', type: 'enum', values: PRIORITIES },
  color: { col: 'color', type: 'string', max: 20 },
  leadId: { col: 'lead_id', type: 'id', nullable: true },
  startDate: { col: 'start_date', type: 'date' },
  dueDate: { col: 'due_date', type: 'date' },
  repo: { col: 'repo_full_name', type: 'string', max: 200, nullable: true },
  archived: { col: 'archived', type: 'bool' },
};

async function projectRow(c: C, pid: string) {
  const p = await c.env.DB.prepare(`SELECT * FROM projects WHERE id=?`).bind(pid).first<Record<string, string | number | null>>();
  if (!p) throw notFound('Project');
  return p;
}

// ---------- projects ----------
work.get('/projects', async (c) => c.json(await listForProjects(c.env, 'projects', await visibleProjects(c.env, c.get('user')))));
work.get('/milestones', async (c) => c.json(await listForProjects(c.env, 'milestones', await visibleProjects(c.env, c.get('user')))));
work.get('/tasks', async (c) => c.json(await listForProjects(c.env, 'tasks', await visibleProjects(c.env, c.get('user')))));

work.post('/projects', async (c) => {
  const me = c.get('user');
  if (RANK[me.role] < RANK.lead) throw forbidden('Leads and administrators create projects.');
  const b = await body(c);
  const data = pick(b, projectSpec, 'create');
  let key = String(b.key ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!key) key = String(data.name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 4) || 'PRJ';
  if (key.length < 2) key = (key + String(data.name).toUpperCase().replace(/[^A-Z]/g, '')).slice(0, 3);
  let finalKey = key;
  for (let i = 2; await c.env.DB.prepare(`SELECT 1 FROM projects WHERE key=?`).bind(finalKey).first(); i++) finalKey = `${key}${i}`;
  const pid = id('prj');
  const t = now();
  Object.assign(data, { id: pid, key: finalKey, created_by: me.id, created_at: t, updated_at: t });
  if (!data.lead_id) data.lead_id = me.id;
  await run(c.env.DB, insertSql('projects', data));
  const members = new Set<string>([me.id, String(data.lead_id), ...((b.members as string[]) ?? [])]);
  const stmts = [...members].map((u) => c.env.DB.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, added_at) SELECT ?, id, ? FROM users WHERE id=?`).bind(pid, t, u));
  for (const d of (b.deps as string[]) ?? []) stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO project_deps (project_id, depends_on_id) VALUES (?,?)`).bind(pid, d));
  // Every project gets its own chat channel.
  const chId = id('chn');
  stmts.push(
    c.env.DB.prepare(`INSERT INTO channels (id, name, kind, topic, project_id, created_by, created_at) VALUES (?,?, 'project', ?, ?, ?, ?)`).bind(
      chId,
      finalKey.toLowerCase(),
      `Project channel for ${data.name}`,
      pid,
      me.id,
      t,
    ),
  );
  await c.env.DB.batch(stmts);
  const ctx = ctxOf(c);
  const [row] = await publish(ctx, 'projects', [pid]);
  broadcast(ctx, { t: 'channels' });
  await record(ctx, {
    actorId: me.id,
    verb: 'created',
    entityType: 'project',
    entityId: pid,
    projectId: pid,
    summary: `created project ${data.name}`,
    notify: [{ userIds: [...members], kind: 'project', title: `You were added to ${data.name}`, link: `/projects/${finalKey}` }],
  });
  return c.json(row);
});

work.patch('/projects/:id', async (c) => {
  const me = c.get('user');
  const pid = c.req.param('id');
  const before = await projectRow(c, pid);
  if (!(await canManageProject(c.env, me, pid))) throw forbidden('Only the project lead or an administrator can edit project settings.');
  const b = await body(c);
  const data = pick(b, projectSpec, 'update');
  const ctx = ctxOf(c);
  const stmts: D1PreparedStatement[] = [];
  const t = now();
  let added: string[] = [];
  if (Array.isArray(b.members)) {
    const next = new Set((b.members as string[]).map(String));
    if (data.lead_id ?? before.lead_id) next.add(String(data.lead_id ?? before.lead_id));
    const prev = await c.env.DB.prepare(`SELECT user_id FROM project_members WHERE project_id=?`).bind(pid).all<{ user_id: string }>();
    const prevSet = new Set(prev.results.map((r) => r.user_id));
    added = [...next].filter((u) => !prevSet.has(u));
    stmts.push(c.env.DB.prepare(`DELETE FROM project_members WHERE project_id=?`).bind(pid));
    for (const u of next) stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, added_at) SELECT ?, id, ? FROM users WHERE id=?`).bind(pid, t, u));
  }
  if (Array.isArray(b.deps)) {
    const deps = (b.deps as string[]).filter((d) => d !== pid);
    // Reject cycles: a project cannot depend on something that already depends on it.
    for (const d of deps) {
      const cyc = await c.env.DB.prepare(
        `WITH RECURSIVE up(id) AS (SELECT ? UNION SELECT pd.depends_on_id FROM project_deps pd JOIN up ON pd.project_id=up.id) SELECT 1 FROM up WHERE id=?`,
      )
        .bind(d, pid)
        .first();
      if (cyc) throw bad('That dependency would create a cycle.');
    }
    stmts.push(c.env.DB.prepare(`DELETE FROM project_deps WHERE project_id=?`).bind(pid));
    for (const d of deps) stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO project_deps (project_id, depends_on_id) VALUES (?,?)`).bind(pid, d));
  }
  if (data.lead_id) stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, added_at) VALUES (?,?,?)`).bind(pid, data.lead_id, t));
  data.updated_at = t;
  const upd = updateSql('projects', pid, data)!;
  stmts.unshift(c.env.DB.prepare(upd.sql).bind(...upd.args));
  await c.env.DB.batch(stmts);
  const [row] = await publish(ctx, 'projects', [pid]);
  const changes: string[] = [];
  if (data.status && data.status !== before.status) changes.push(`moved ${before.name} to ${data.status}`);
  if ('due_date' in data && data.due_date !== before.due_date) changes.push(`set ${before.name}’s deadline to ${data.due_date ?? 'none'}`);
  if ('repo_full_name' in data && data.repo_full_name !== before.repo_full_name) changes.push(data.repo_full_name ? `linked ${before.name} to ${data.repo_full_name}` : `unlinked the repository from ${before.name}`);
  if (data.archived !== undefined && data.archived !== before.archived) changes.push(`${data.archived ? 'archived' : 'restored'} ${before.name}`);
  for (const s of changes) await record(ctx, { actorId: me.id, verb: 'updated', entityType: 'project', entityId: pid, projectId: pid, summary: s });
  if (added.length)
    await record(ctx, {
      actorId: me.id,
      verb: 'members',
      entityType: 'project',
      entityId: pid,
      projectId: pid,
      summary: `added ${added.length} member${added.length > 1 ? 's' : ''} to ${before.name}`,
      notify: [{ userIds: added, kind: 'project', title: `You were added to ${before.name}`, link: `/projects/${before.key}` }],
    });
  if (!changes.length && !added.length) await record(ctx, { actorId: me.id, verb: 'updated', entityType: 'project', entityId: pid, projectId: pid, summary: `updated ${before.name}` });
  return c.json(row);
});

work.delete('/projects/:id', async (c) => {
  const me = c.get('user');
  const pid = c.req.param('id');
  const p = await projectRow(c, pid);
  if (!isAdmin(me)) throw forbidden('Only administrators can delete projects. Leads can archive them.');
  const taskIds = await c.env.DB.prepare(`SELECT id FROM tasks WHERE project_id=?`).bind(pid).all<{ id: string }>();
  const msIds = await c.env.DB.prepare(`SELECT id FROM milestones WHERE project_id=?`).bind(pid).all<{ id: string }>();
  await c.env.DB.prepare(`DELETE FROM projects WHERE id=?`).bind(pid).run();
  const ctx = ctxOf(c);
  publishDelete(ctx, 'projects', [pid]);
  if (taskIds.results.length) publishDelete(ctx, 'tasks', taskIds.results.map((r) => r.id));
  if (msIds.results.length) publishDelete(ctx, 'milestones', msIds.results.map((r) => r.id));
  broadcast(ctx, { t: 'channels' });
  await record(ctx, { actorId: me.id, verb: 'deleted', entityType: 'project', entityId: pid, summary: `deleted project ${p.name}`, audit: true });
  return c.json({ ok: true });
});

// ---------- milestones ----------
const milestoneSpec: Spec = {
  name: { col: 'name', type: 'string', max: 160, required: true },
  description: { col: 'description', type: 'text', max: 5000 },
  dueDate: { col: 'due_date', type: 'date' },
  done: { col: 'done', type: 'bool' },
};
work.post('/projects/:id/milestones', async (c) => {
  const me = c.get('user');
  const pid = c.req.param('id');
  const p = await projectRow(c, pid);
  await assertWriteProject(c.env, me, pid);
  const data = pick(await body(c), milestoneSpec, 'create');
  const mid = id('mil');
  Object.assign(data, { id: mid, project_id: pid, created_at: now() });
  await run(c.env.DB, insertSql('milestones', data));
  const ctx = ctxOf(c);
  const [row] = await publish(ctx, 'milestones', [mid]);
  await record(ctx, { actorId: me.id, verb: 'created', entityType: 'milestone', entityId: mid, projectId: pid, summary: `added milestone “${data.name}” to ${p.name}` });
  return c.json(row);
});
work.patch('/milestones/:id', async (c) => {
  const me = c.get('user');
  const m = await c.env.DB.prepare(`SELECT m.*, p.name AS pname FROM milestones m JOIN projects p ON p.id=m.project_id WHERE m.id=?`).bind(c.req.param('id')).first<Record<string, string | number>>();
  if (!m) throw notFound('Milestone');
  await assertWriteProject(c.env, me, String(m.project_id));
  const data = pick(await body(c), milestoneSpec, 'update');
  await run(c.env.DB, updateSql('milestones', String(m.id), data));
  const ctx = ctxOf(c);
  const [row] = await publish(ctx, 'milestones', [String(m.id)]);
  if (data.done !== undefined && data.done !== m.done)
    await record(ctx, { actorId: me.id, verb: data.done ? 'completed' : 'reopened', entityType: 'milestone', entityId: String(m.id), projectId: String(m.project_id), summary: `${data.done ? 'reached' : 'reopened'} milestone “${m.name}” in ${m.pname}` });
  return c.json(row);
});
work.delete('/milestones/:id', async (c) => {
  const me = c.get('user');
  const m = await c.env.DB.prepare(`SELECT * FROM milestones WHERE id=?`).bind(c.req.param('id')).first<{ id: string; project_id: string }>();
  if (!m) throw notFound('Milestone');
  await assertWriteProject(c.env, me, m.project_id);
  const tids = await c.env.DB.prepare(`SELECT id FROM tasks WHERE milestone_id=?`).bind(m.id).all<{ id: string }>();
  await c.env.DB.prepare(`DELETE FROM milestones WHERE id=?`).bind(m.id).run();
  const ctx = ctxOf(c);
  publishDelete(ctx, 'milestones', [m.id]);
  if (tids.results.length) await publish(ctx, 'tasks', tids.results.map((r) => r.id));
  return c.json({ ok: true });
});

// ---------- tasks ----------
const taskSpec: Spec = {
  title: { col: 'title', type: 'string', max: 300, required: true },
  description: { col: 'description', type: 'text', max: 50_000 },
  status: { col: 'status', type: 'enum', values: STATUSES },
  priority: { col: 'priority', type: 'enum', values: PRIORITIES },
  assigneeId: { col: 'assignee_id', type: 'id', nullable: true },
  milestoneId: { col: 'milestone_id', type: 'id', nullable: true },
  labels: { col: 'labels', type: 'json' },
  estimate: { col: 'estimate', type: 'int' },
  startDate: { col: 'start_date', type: 'date' },
  dueDate: { col: 'due_date', type: 'date' },
  position: { col: 'position', type: 'num' },
  deliverable: { col: 'deliverable', type: 'bool' },
  deliverableNote: { col: 'deliverable_note', type: 'text', max: 2000 },
};

type TaskRow = { id: string; project_id: string; number: number; title: string; status: string; assignee_id: string | null; reporter_id: string | null; due_date: string | null; priority: string };

async function taskWithProject(c: C, tid: string) {
  const t = await c.env.DB.prepare(`SELECT t.*, p.key AS pkey, p.name AS pname FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?`)
    .bind(tid)
    .first<TaskRow & { pkey: string; pname: string }>();
  if (!t) throw notFound('Task');
  return t;
}

async function ensureMember(c: C, projectId: string, userId: string | null | undefined, stmts: D1PreparedStatement[]) {
  if (!userId) return;
  stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, added_at) SELECT ?, id, ? FROM users WHERE id=?`).bind(projectId, now(), userId));
}

work.post('/tasks', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const pid = String(b.projectId ?? '');
  const p = await projectRow(c, pid);
  await assertWriteProject(c.env, me, pid);
  const data = pick(b, taskSpec, 'create');
  if (data.assignee_id && !(await c.env.DB.prepare(`SELECT 1 FROM users WHERE id=?`).bind(data.assignee_id).first())) throw bad('Unknown assignee.');
  const seq = await c.env.DB.prepare(`UPDATE projects SET task_seq=task_seq+1, updated_at=? WHERE id=? RETURNING task_seq`).bind(now(), pid).first<{ task_seq: number }>();
  const tid = id('tsk');
  const t = now();
  if (data.position === undefined) {
    const max = await c.env.DB.prepare(`SELECT MAX(position) AS m FROM tasks WHERE project_id=?`).bind(pid).first<{ m: number | null }>();
    data.position = (max?.m ?? 0) + 1024;
  }
  Object.assign(data, { id: tid, project_id: pid, number: seq!.task_seq, reporter_id: me.id, created_at: t, updated_at: t });
  if (data.status === 'done') data.completed_at = t;
  const stmts: D1PreparedStatement[] = [];
  const ins = insertSql('tasks', data);
  stmts.push(c.env.DB.prepare(ins.sql).bind(...ins.args));
  await ensureMember(c, pid, data.assignee_id as string | null, stmts);
  for (const dep of (b.blockedBy as string[]) ?? []) stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO task_deps (task_id, blocked_by_id) VALUES (?,?)`).bind(tid, dep));
  await c.env.DB.batch(stmts);
  const ctx = ctxOf(c);
  const [row] = await publish(ctx, 'tasks', [tid]);
  if (data.assignee_id) await publish(ctx, 'projects', [pid]);
  const key = `${p.key}-${seq!.task_seq}`;
  await record(ctx, {
    actorId: me.id,
    verb: 'created',
    entityType: 'task',
    entityId: tid,
    projectId: pid,
    summary: `created ${key} “${data.title}”`,
    data: { key },
    notify: data.assignee_id
      ? [{ userIds: [data.assignee_id as string], kind: 'assigned', title: `${me.name} assigned you ${key}`, body: String(data.title), link: `/projects/${p.key}?task=${tid}` }]
      : [],
  });
  return c.json(row);
});

work.patch('/tasks/:id', async (c) => {
  const me = c.get('user');
  const before = await taskWithProject(c, c.req.param('id'));
  await assertWriteProject(c.env, me, before.project_id);
  const b = await body(c);
  const data = pick(b, taskSpec, 'update');
  const stmts: D1PreparedStatement[] = [];
  const t = now();
  if (data.status && data.status !== before.status) data.completed_at = data.status === 'done' ? t : null;
  data.updated_at = t;
  if ('assignee_id' in data) await ensureMember(c, before.project_id, data.assignee_id as string | null, stmts);
  if (Array.isArray(b.blockedBy)) {
    stmts.push(c.env.DB.prepare(`DELETE FROM task_deps WHERE task_id=?`).bind(before.id));
    for (const dep of b.blockedBy as string[]) if (dep !== before.id) stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO task_deps (task_id, blocked_by_id) VALUES (?,?)`).bind(before.id, dep));
  }
  const upd = updateSql('tasks', before.id, data)!;
  stmts.unshift(c.env.DB.prepare(upd.sql).bind(...upd.args));
  await c.env.DB.batch(stmts);
  const ctx = ctxOf(c);
  const [row] = await publish(ctx, 'tasks', [before.id]);
  if ('assignee_id' in data) await publish(ctx, 'projects', [before.project_id]);
  await taskSideEffects(ctx, me, before, data);
  return c.json(row);
});

/** Shared by PATCH and the GitHub webhook (commit "fixes ABC-12"). */
export async function taskSideEffects(
  ctx: ReturnType<typeof ctxOf>,
  me: { id: string | null; name: string },
  before: TaskRow & { pkey: string; pname: string },
  data: Record<string, unknown>,
  via?: string,
) {
  const key = `${before.pkey}-${before.number}`;
  const link = `/projects/${before.pkey}?task=${before.id}`;
  const actor = me.id;
  if (data.status && data.status !== before.status) {
    const done = data.status === 'done';
    await record(ctx, {
      actorId: actor,
      verb: done ? 'completed' : 'moved',
      entityType: 'task',
      entityId: before.id,
      projectId: before.project_id,
      summary: done ? `completed ${key} “${before.title}”${via ? ` ${via}` : ''}` : `moved ${key} to ${STATUS_LABEL[String(data.status)]}`,
      data: { key, from: before.status, to: data.status },
      notify: [{ userIds: [before.reporter_id, before.assignee_id], kind: 'status', title: `${key} → ${STATUS_LABEL[String(data.status)]}`, body: before.title, link }],
    });
    if (done) {
      // Tell owners of tasks this one was blocking.
      const blocked = await ctx.env.DB.prepare(
        `SELECT t.id, t.title, t.assignee_id, t.number FROM task_deps d JOIN tasks t ON t.id=d.task_id WHERE d.blocked_by_id=? AND t.status<>'done'`,
      )
        .bind(before.id)
        .all<{ id: string; title: string; assignee_id: string | null; number: number }>();
      for (const bt of blocked.results) {
        const open = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM task_deps d JOIN tasks t ON t.id=d.blocked_by_id WHERE d.task_id=? AND t.status<>'done'`).bind(bt.id).first<{ n: number }>();
        if (!open?.n && bt.assignee_id)
          await record(ctx, {
            actorId: actor,
            verb: 'unblocked',
            entityType: 'task',
            entityId: bt.id,
            projectId: before.project_id,
            summary: `unblocked ${before.pkey}-${bt.number}`,
            notify: [{ userIds: [bt.assignee_id], kind: 'status', title: `${before.pkey}-${bt.number} is unblocked`, body: bt.title, link: `/projects/${before.pkey}?task=${bt.id}` }],
          });
      }
    }
  }
  if ('assignee_id' in data && data.assignee_id !== before.assignee_id) {
    let name = 'nobody';
    if (data.assignee_id) name = (await ctx.env.DB.prepare(`SELECT name FROM users WHERE id=?`).bind(data.assignee_id).first<{ name: string }>())?.name ?? 'someone';
    await record(ctx, {
      actorId: actor,
      verb: 'assigned',
      entityType: 'task',
      entityId: before.id,
      projectId: before.project_id,
      summary: data.assignee_id ? `assigned ${key} to ${name}` : `unassigned ${key}`,
      data: { key, assigneeId: data.assignee_id },
      notify: data.assignee_id ? [{ userIds: [data.assignee_id as string], kind: 'assigned', title: `${me.name} assigned you ${key}`, body: before.title, link }] : [],
    });
  }
  if ('due_date' in data && data.due_date !== before.due_date && !('status' in data && data.status !== before.status)) {
    await record(ctx, {
      actorId: actor,
      verb: 'rescheduled',
      entityType: 'task',
      entityId: before.id,
      projectId: before.project_id,
      summary: data.due_date ? `set ${key} due ${data.due_date}` : `cleared the deadline on ${key}`,
      notify: [{ userIds: [before.assignee_id], kind: 'deadline', title: `${key} is now due ${data.due_date ?? '—'}`, body: before.title, link }],
    });
  }
  if ('priority' in data && data.priority !== before.priority && (data.priority === 'urgent' || data.priority === 'high'))
    await record(ctx, { actorId: actor, verb: 'prioritised', entityType: 'task', entityId: before.id, projectId: before.project_id, summary: `raised ${key} to ${data.priority}` });
}

work.delete('/tasks/:id', async (c) => {
  const me = c.get('user');
  const t = await taskWithProject(c, c.req.param('id'));
  await assertWriteProject(c.env, me, t.project_id);
  const affected = await c.env.DB.prepare(`SELECT task_id FROM task_deps WHERE blocked_by_id=?`).bind(t.id).all<{ task_id: string }>();
  await c.env.DB.prepare(`DELETE FROM tasks WHERE id=?`).bind(t.id).run();
  const ctx = ctxOf(c);
  publishDelete(ctx, 'tasks', [t.id]);
  if (affected.results.length) await publish(ctx, 'tasks', affected.results.map((r) => r.task_id));
  await record(ctx, { actorId: me.id, verb: 'deleted', entityType: 'task', entityId: t.id, projectId: t.project_id, summary: `deleted ${t.pkey}-${t.number} “${t.title}”` });
  return c.json({ ok: true });
});

work.get('/tasks/:id/detail', async (c) => {
  const t = await taskWithProject(c, c.req.param('id'));
  const vis = await visibleProjects(c.env, c.get('user'));
  if (vis && !vis.includes(t.project_id)) throw forbidden();
  const [comments, commits, activity, submissions] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM task_comments WHERE task_id=? ORDER BY created_at`).bind(t.id).all(),
    c.env.DB.prepare(`SELECT * FROM task_commits WHERE task_id=? ORDER BY created_at DESC`).bind(t.id).all(),
    c.env.DB.prepare(`SELECT * FROM activity WHERE entity_type='task' AND entity_id=? ORDER BY created_at DESC LIMIT 50`).bind(t.id).all(),
    c.env.DB.prepare(`SELECT * FROM submissions WHERE task_id=? ORDER BY created_at DESC`).bind(t.id).all(),
  ]);
  return c.json({
    comments: comments.results.map((r) => toApi(r)),
    commits: commits.results.map((r) => toApi(r)),
    activity: activity.results.map((r) => toApi(r, ['data'], ['audit'])),
    submissions: submissions.results.map((r) => toApi(r)),
  });
});

work.post('/tasks/:id/comments', async (c) => {
  const me = c.get('user');
  const t = await taskWithProject(c, c.req.param('id'));
  if (me.role === 'guest') {
    const vis = await visibleProjects(c.env, me);
    if (!vis?.includes(t.project_id)) throw forbidden();
  }
  const text = String((await body(c)).body ?? '').trim();
  if (!text) throw bad('Comment is empty.');
  if (text.length > 20_000) throw bad('Comment is too long.');
  const cid = id('cmt');
  await c.env.DB.prepare(`INSERT INTO task_comments (id, task_id, user_id, body, created_at) VALUES (?,?,?,?,?)`).bind(cid, t.id, me.id, text, now()).run();
  const ctx = ctxOf(c);
  const key = `${t.pkey}-${t.number}`;
  const link = `/projects/${t.pkey}?task=${t.id}`;
  const plain = await plainMentions(c.env, text);
  const mentioned = mentionedIds(text);
  await publish(ctx, 'tasks', [t.id]);
  broadcast(ctx, { t: 'comment', taskId: t.id });
  await record(ctx, {
    actorId: me.id,
    verb: 'commented',
    entityType: 'task',
    entityId: t.id,
    projectId: t.project_id,
    summary: `commented on ${key}`,
    data: { key, excerpt: plain.slice(0, 140) },
    notify: [
      { userIds: mentioned, kind: 'mention', title: `${me.name} mentioned you on ${key}`, body: plain.slice(0, 200), link },
      { userIds: [t.assignee_id, t.reporter_id].filter((u) => u && !mentioned.includes(u)), kind: 'comment', title: `${me.name} commented on ${key}`, body: plain.slice(0, 200), link },
    ],
  });
  return c.json(toApi(await c.env.DB.prepare(`SELECT * FROM task_comments WHERE id=?`).bind(cid).first()));
});

work.delete('/comments/:id', async (c) => {
  const me = c.get('user');
  const cm = await c.env.DB.prepare(`SELECT * FROM task_comments WHERE id=?`).bind(c.req.param('id')).first<{ id: string; user_id: string; task_id: string }>();
  if (!cm) throw notFound('Comment');
  if (cm.user_id !== me.id && !isAdmin(me)) throw forbidden();
  await c.env.DB.prepare(`DELETE FROM task_comments WHERE id=?`).bind(cm.id).run();
  const ctx = ctxOf(c);
  await publish(ctx, 'tasks', [cm.task_id]);
  broadcast(ctx, { t: 'comment', taskId: cm.task_id });
  return c.json({ ok: true });
});

/** Bulk edits from the list view (select many → set status/assignee/priority). */
work.post('/tasks/bulk', async (c) => {
  const me = c.get('user');
  const b = await body(c);
  const ids = ((b.ids as string[]) ?? []).slice(0, 200);
  const patch = (b.patch ?? {}) as Record<string, unknown>;
  if (!ids.length) throw bad('Nothing selected.');
  const ctx = ctxOf(c);
  for (const tid of ids) {
    const before = await taskWithProject(c, tid);
    await assertWriteProject(c.env, me, before.project_id);
    const data = pick(patch, taskSpec, 'update');
    if (data.status && data.status !== before.status) data.completed_at = data.status === 'done' ? now() : null;
    data.updated_at = now();
    const stmts: D1PreparedStatement[] = [];
    const upd = updateSql('tasks', tid, data)!;
    stmts.push(c.env.DB.prepare(upd.sql).bind(...upd.args));
    if ('assignee_id' in data) await ensureMember(c, before.project_id, data.assignee_id as string | null, stmts);
    await c.env.DB.batch(stmts);
    await taskSideEffects(ctx, me, before, data);
  }
  const rows = await publish(ctx, 'tasks', ids);
  if ('assigneeId' in patch) {
    const pids = [...new Set(rows.map((r) => (r as { projectId: string }).projectId))];
    await publish(ctx, 'projects', pids);
  }
  return c.json(rows);
});
