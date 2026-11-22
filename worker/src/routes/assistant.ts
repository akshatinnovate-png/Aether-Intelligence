import { Hono } from 'hono';
import { type AppEnv, type C, bad, body, HttpError, now, requireRank, getSetting, id, setSetting } from '../lib/core';
import { callApi } from '../lib/internal';
import { ctxOf } from '../lib/auth';
import { publish } from '../lib/events';

/**
 * "Ask Aether": a Groq-hosted model that turns plain requests into actions.
 * Every action runs through Aether's own API as the person asking, so it can only do what they could do by hand.
 */
export const assistant = new Hono<AppEnv>();

const DEFAULT_GROQ = 'https://api.groq.com/openai/v1';
const PREFERRED_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const MAX_STEPS = 6;

interface User {
  id: string;
  name: string;
  title: string;
  email: string;
  status: string;
  role: string;
}
interface Project {
  id: string;
  key: string;
  name: string;
  archived: boolean;
  members: string[];
  leadId: string | null;
}
interface Task {
  id: string;
  projectId: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  reporterId: string | null;
  dueDate: string | null;
  deliverable: boolean;
  submission: { id: string; status: string; url: string } | null;
}
interface Action {
  label: string;
  link?: string;
}

async function groqKey(c: C) {
  const key = await getSetting(c.env, 'groq_api_key');
  if (!key) throw new HttpError(412, 'The assistant is not set up yet. An administrator adds a free Groq API key in Settings → Assistant.');
  return key;
}
async function groqFetch(c: C, path: string, init: RequestInit = {}) {
  const base = c.env.GROQ_BASE_URL || DEFAULT_GROQ;
  const res = await fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${await groqKey(c)}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const msg = (data.error as { message?: string })?.message ?? text.slice(0, 200);
    if (res.status === 401) throw new HttpError(412, 'Groq rejected the API key. An administrator can update it in Settings → Assistant.');
    if (res.status === 429) throw new HttpError(429, 'The assistant hit Groq’s free rate limit. Try again in a minute.');
    throw new HttpError(502, `Groq: ${msg}`);
  }
  return data;
}
async function pickModel(c: C): Promise<string> {
  const saved = await getSetting(c.env, 'groq_model');
  if (saved) return saved;
  const list = (await groqFetch(c, '/models')) as { data?: { id: string; active?: boolean }[] };
  const ids = (list.data ?? []).filter((m) => m.active !== false).map((m) => m.id);
  const model = PREFERRED_MODELS.find((m) => ids.includes(m)) ?? ids.find((m) => !/whisper|guard|tts|orpheus|prompt/i.test(m));
  if (!model) throw new HttpError(502, 'No suitable Groq model is available for this key.');
  await setSetting(c.env, 'groq_model', model);
  return model;
}

// ---------- tools ----------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        'Create a task, usually assigning someone to do something. Use deliverable_required=true whenever the person must hand in a file/link (deck, report, video, document, design, "submit the drive link"): they will be asked to submit a Google Drive link, which the requester reviews.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short imperative title, e.g. "Make the pitch deck"' },
          assignee: { type: 'string', description: 'Name (or first name) of the person who should do it. Omit to leave unassigned. Use "me" for the requester.' },
          project: { type: 'string', description: 'Project key or name. Omit if no project clearly fits.' },
          description: { type: 'string', description: 'Details and acceptance criteria, if any were given.' },
          due_date: { type: 'string', description: 'YYYY-MM-DD, resolved from phrases like "by Friday" relative to today.' },
          priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
          deliverable_required: { type: 'boolean' },
          deliverable_description: { type: 'string', description: 'What exactly must be submitted, e.g. "Pitch deck as Google Slides"' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Change an existing task by its key (e.g. TF1-2): status, assignee, due date or priority.',
      parameters: {
        type: 'object',
        properties: {
          task_key: { type: 'string' },
          status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'review', 'done'] },
          assignee: { type: 'string', description: 'Name, "me", or "nobody"' },
          due_date: { type: 'string', description: 'YYYY-MM-DD or "none"' },
          priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
        },
        required: ['task_key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_tasks',
      description: 'List tasks, optionally filtered. Use to answer questions like "what is Soumya working on" or "what is overdue".',
      parameters: {
        type: 'object',
        properties: {
          assignee: { type: 'string' },
          project: { type: 'string' },
          only_open: { type: 'boolean' },
          only_overdue: { type: 'boolean' },
          awaiting_review: { type: 'boolean', description: 'Tasks with a submitted deliverable waiting for review' },
        },
      },
    },
  },
  {
    type: 'function',
    function: { name: 'lab_overview', description: 'Summary for the requester: their open and overdue tasks, deliverables to hand in or review, and upcoming deadlines.', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function',
    function: {
      name: 'submit_deliverable',
      description: 'Submit a Google Drive link as the deliverable for a task (when the requester hands in their own work).',
      parameters: { type: 'object', properties: { task_key: { type: 'string' }, url: { type: 'string' }, note: { type: 'string' } }, required: ['task_key', 'url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'review_deliverable',
      description: 'Approve a submitted deliverable (completes the task) or request changes (sends it back with a note).',
      parameters: { type: 'object', properties: { task_key: { type: 'string' }, decision: { type: 'string', enum: ['approve', 'changes'] }, note: { type: 'string' } }, required: ['task_key', 'decision'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'Send a chat message: a direct message to a person, or a post in a channel.',
      parameters: { type: 'object', properties: { to_person: { type: 'string' }, channel: { type: 'string', description: 'Channel name without #' }, text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_event',
      description: 'Put a meeting, review, deadline or event on the lab calendar and invite people.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          starts_at: { type: 'string', description: 'ISO date-time in the requester’s local time, e.g. 2026-11-25T15:00' },
          duration_minutes: { type: 'number' },
          kind: { type: 'string', enum: ['meeting', 'review', 'deadline', 'event'] },
          attendees: { type: 'array', items: { type: 'string' }, description: 'Names; "everyone" for the whole lab' },
          location: { type: 'string' },
          project: { type: 'string' },
        },
        required: ['title', 'starts_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Create a new project (leads and admins only).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, description: { type: 'string' }, due_date: { type: 'string' }, members: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['engineering', 'research', 'competition', 'operations'] } },
        required: ['name'],
      },
    },
  },
];

interface World {
  me: { id: string; name: string; role: string };
  users: User[];
  projects: Project[];
  tasks: Task[];
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
class ToolError extends Error {}

function findUser(w: World, name: string | undefined): User | null {
  if (!name) return null;
  const q = norm(name);
  if (['me', 'myself', 'i'].includes(q)) return w.users.find((u) => u.id === w.me.id) ?? null;
  const active = w.users.filter((u) => u.status === 'active');
  const exact = active.filter((u) => norm(u.name) === q || norm(u.email.split('@')[0]) === q);
  if (exact.length === 1) return exact[0];
  const first = active.filter((u) => norm(u.name).split(' ')[0] === q.split(' ')[0] && (q.split(' ').length === 1 || norm(u.name).includes(q)));
  if (first.length === 1) return first[0];
  const partial = active.filter((u) => norm(u.name).includes(q));
  if (partial.length === 1) return partial[0];
  const cands = (first.length ? first : partial).map((u) => u.name);
  if (cands.length > 1) throw new ToolError(`"${name}" matches several people: ${cands.join(', ')}. Ask which one.`);
  throw new ToolError(`Nobody called "${name}" is in the lab. Members: ${active.map((u) => u.name).join(', ')}.`);
}
function findProject(w: World, ref: string | undefined): Project | null {
  if (!ref) return null;
  const q = norm(ref);
  const live = w.projects.filter((p) => !p.archived);
  const hit = live.find((p) => norm(p.key) === q) ?? live.find((p) => norm(p.name) === q) ?? live.filter((p) => norm(p.name).includes(q) || q.includes(norm(p.name)))[0];
  if (!hit) throw new ToolError(`No project matches "${ref}". Projects: ${live.map((p) => `${p.name} (${p.key})`).join(', ')}.`);
  return hit;
}
function findTask(w: World, key: string): Task {
  const m = /^([A-Za-z0-9]+)-(\d+)$/.exec(key.trim());
  const p = m && w.projects.find((x) => x.key.toLowerCase() === m[1].toLowerCase());
  const t = p && w.tasks.find((x) => x.projectId === p.id && x.number === Number(m![2]));
  if (!t) throw new ToolError(`No task with key ${key}.`);
  return t;
}
const keyOf = (w: World, t: Task) => `${w.projects.find((p) => p.id === t.projectId)?.key}-${t.number}`;
const linkOf = (w: World, t: Task) => `/projects/${w.projects.find((p) => p.id === t.projectId)?.key}?task=${t.id}`;

/** A catch-all project for requests that belong to no particular project. Everyone is a member. */
async function generalProject(c: C, w: World): Promise<Project> {
  const existing = w.projects.find((p) => p.key === 'GEN' && !p.archived);
  if (existing) return existing;
  const db = c.env.DB;
  const pid = id('prj');
  const ts = now();
  const owner = w.users.find((u) => u.role === 'owner')?.id ?? w.me.id;
  await db.batch([
    db.prepare(`INSERT INTO projects (id, key, name, description, kind, status, priority, color, lead_id, created_by, created_at, updated_at) VALUES (?, 'GEN', 'General', 'Requests and deliverables that belong to no specific project.', 'operations', 'active', 'medium', '#e8e8e4', ?, ?, ?, ?)`).bind(pid, owner, w.me.id, ts, ts),
    db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, added_at) SELECT ?, id, ? FROM users WHERE status='active'`).bind(pid, ts),
    db.prepare(`INSERT INTO channels (id, name, kind, topic, project_id, created_by, created_at) VALUES (?, 'gen', 'project', 'Project channel for General', ?, ?, ?)`).bind(id('chn'), pid, w.me.id, ts),
  ]);
  await publish(ctxOf(c), 'projects', [pid]);
  const p: Project = { id: pid, key: 'GEN', name: 'General', archived: false, members: w.users.map((u) => u.id), leadId: owner };
  w.projects.push(p);
  return p;
}

async function api<T>(c: C, method: string, path: string, b?: unknown): Promise<T> {
  const r = await callApi<T & { error?: string }>(c, method, path, b);
  if (!r.ok) throw new ToolError((r.data as { error?: string })?.error ?? `Request failed (${r.status})`);
  return r.data;
}

async function runTool(c: C, w: World, name: string, args: Record<string, unknown>, actions: Action[]): Promise<unknown> {
  const s = (k: string) => (typeof args[k] === 'string' && (args[k] as string).trim() ? (args[k] as string).trim() : undefined);
  switch (name) {
    case 'create_task': {
      const assignee = s('assignee') ? findUser(w, s('assignee')) : null;
      const project = findProject(w, s('project')) ?? (await generalProject(c, w));
      const deliverable = args.deliverable_required === true;
      const desc = [s('description'), deliverable ? `**Deliverable:** ${s('deliverable_description') ?? 'Submit the Google Drive link'} — submit it from this task.` : ''].filter(Boolean).join('\n\n');
      const t = await api<Task>(c, 'POST', '/api/tasks', {
        projectId: project.id,
        title: s('title') ?? 'Untitled',
        description: desc,
        assigneeId: assignee?.id ?? null,
        dueDate: s('due_date') ?? null,
        priority: s('priority') ?? 'medium',
        status: 'todo',
        deliverable,
        deliverableNote: s('deliverable_description') ?? (deliverable ? 'Google Drive link' : ''),
      });
      w.tasks.push(t);
      const key = `${project.key}-${t.number}`;
      actions.push({ label: `Created ${key} “${t.title}”${assignee ? ` for ${assignee.name}` : ''}`, link: linkOf(w, t) });
      return { created: key, assignee: assignee?.name ?? null, project: project.name, due: t.dueDate, deliverable, note: assignee ? `${assignee.name} has been notified.` : 'Unassigned.' };
    }
    case 'update_task': {
      const t = findTask(w, s('task_key')!);
      const patch: Record<string, unknown> = {};
      if (s('status')) patch.status = s('status');
      if (s('priority')) patch.priority = s('priority');
      if (s('due_date')) patch.dueDate = s('due_date') === 'none' ? null : s('due_date');
      if (s('assignee')) patch.assigneeId = ['nobody', 'none', 'unassigned'].includes(norm(s('assignee')!)) ? null : findUser(w, s('assignee'))!.id;
      if (!Object.keys(patch).length) throw new ToolError('Nothing to change.');
      const r = await api<Task>(c, 'PATCH', `/api/tasks/${t.id}`, patch);
      actions.push({ label: `Updated ${keyOf(w, t)}`, link: linkOf(w, t) });
      return { updated: keyOf(w, t), status: r.status, assignee: w.users.find((u) => u.id === r.assigneeId)?.name ?? null, due: r.dueDate };
    }
    case 'find_tasks': {
      const today = now().slice(0, 10);
      const who = s('assignee') ? findUser(w, s('assignee')) : null;
      const proj = s('project') ? findProject(w, s('project')) : null;
      const list = w.tasks
        .filter((t) => (!who || t.assigneeId === who.id) && (!proj || t.projectId === proj.id))
        .filter((t) => (args.only_open || args.only_overdue ? t.status !== 'done' : true))
        .filter((t) => (args.only_overdue ? !!t.dueDate && t.dueDate < today : true))
        .filter((t) => (args.awaiting_review ? t.submission?.status === 'pending' : true))
        .slice(0, 40);
      return list.map((t) => ({ key: keyOf(w, t), title: t.title, status: t.status, assignee: w.users.find((u) => u.id === t.assigneeId)?.name ?? null, due: t.dueDate, deliverable: t.deliverable ? t.submission?.status ?? 'not submitted' : undefined }));
    }
    case 'lab_overview': {
      const today = now().slice(0, 10);
      const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
      const mine = w.tasks.filter((t) => t.assigneeId === w.me.id && t.status !== 'done');
      const review = w.tasks.filter((t) => t.submission?.status === 'pending' && (t.reporterId === w.me.id || w.projects.find((p) => p.id === t.projectId)?.leadId === w.me.id || ['owner', 'admin'].includes(w.me.role)));
      return {
        my_open: mine.map((t) => ({ key: keyOf(w, t), title: t.title, due: t.dueDate, status: t.status })),
        my_overdue: mine.filter((t) => t.dueDate && t.dueDate < today).map((t) => keyOf(w, t)),
        deliverables_to_submit: mine.filter((t) => t.deliverable && (!t.submission || t.submission.status === 'changes_requested')).map((t) => keyOf(w, t)),
        waiting_for_my_review: review.map((t) => ({ key: keyOf(w, t), title: t.title, by: w.users.find((u) => u.id === t.assigneeId)?.name })),
        lab_due_next_14_days: w.tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate >= today && t.dueDate <= in14).map((t) => ({ key: keyOf(w, t), title: t.title, due: t.dueDate, assignee: w.users.find((u) => u.id === t.assigneeId)?.name ?? null })),
      };
    }
    case 'submit_deliverable': {
      const t = findTask(w, s('task_key')!);
      const r = await api<{ title: string }>(c, 'POST', `/api/tasks/${t.id}/submissions`, { url: s('url'), note: s('note') });
      actions.push({ label: `Submitted ${r.title} for ${keyOf(w, t)}`, link: linkOf(w, t) });
      return { submitted: keyOf(w, t), status: 'waiting for review' };
    }
    case 'review_deliverable': {
      const t = findTask(w, s('task_key')!);
      if (t.submission?.status !== 'pending') throw new ToolError(`${keyOf(w, t)} has no submission waiting for review.`);
      await api(c, 'POST', `/api/submissions/${t.submission.id}/review`, { decision: s('decision'), note: s('note') ?? '' });
      actions.push({ label: `${s('decision') === 'approve' ? 'Approved' : 'Requested changes on'} ${keyOf(w, t)}`, link: linkOf(w, t) });
      return { reviewed: keyOf(w, t), decision: s('decision') };
    }
    case 'send_message': {
      const text = s('text')!;
      let channelId: string;
      let label: string;
      if (s('to_person')) {
        const u = findUser(w, s('to_person'))!;
        channelId = (await api<{ id: string }>(c, 'POST', '/api/dm', { userIds: [u.id] })).id;
        label = `Messaged ${u.name}`;
      } else {
        const name = norm(s('channel') ?? 'general').replace(/ /g, '-');
        const chans = await api<{ id: string; name: string; kind: string }[]>(c, 'GET', '/api/channels');
        const ch = chans.find((x) => x.kind !== 'dm' && x.name === name);
        if (!ch) throw new ToolError(`No channel #${name}. Channels: ${chans.filter((x) => x.kind !== 'dm').map((x) => '#' + x.name).join(', ')}`);
        channelId = ch.id;
        label = `Posted in #${ch.name}`;
      }
      await api(c, 'POST', `/api/channels/${channelId}/messages`, { body: text });
      actions.push({ label, link: `/chat/${channelId}` });
      return { sent: true };
    }
    case 'schedule_event': {
      const raw = s('attendees') ? [s('attendees')!] : Array.isArray(args.attendees) ? (args.attendees as string[]) : [];
      const everyone = raw.some((n) => /everyone|all|whole lab|team/i.test(n));
      const people = everyone ? w.users.filter((u) => u.status === 'active') : raw.map((n) => findUser(w, n)!).filter(Boolean);
      const tz = Number(c.req.header('x-tz-offset') ?? 0); // minutes, from the browser
      const local = s('starts_at')!;
      const start = /[zZ]|[+-]\d\d:\d\d$/.test(local) ? new Date(local) : new Date(new Date(`${local}Z`).getTime() + tz * 60_000);
      if (isNaN(start.getTime())) throw new ToolError('Could not understand the start time.');
      const end = new Date(start.getTime() + Number(args.duration_minutes ?? 60) * 60_000);
      const proj = s('project') ? findProject(w, s('project')) : null;
      const ev = await api<{ id: string; title: string }>(c, 'POST', '/api/events', {
        title: s('title'),
        kind: s('kind') ?? 'meeting',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        location: s('location') ?? '',
        projectId: proj?.id ?? null,
        attendees: [...new Set([w.me.id, ...people.map((u) => u.id)])],
      });
      actions.push({ label: `Scheduled “${ev.title}”`, link: `/calendar?event=${ev.id}` });
      return { scheduled: ev.title, starts: start.toISOString(), invited: people.map((u) => u.name) };
    }
    case 'create_project': {
      const members = (Array.isArray(args.members) ? (args.members as string[]) : []).map((n) => findUser(w, n)!.id);
      const p = await api<Project>(c, 'POST', '/api/projects', { name: s('name'), description: s('description') ?? '', dueDate: s('due_date') ?? null, kind: s('kind') ?? 'engineering', members: [w.me.id, ...members] });
      w.projects.push(p);
      actions.push({ label: `Created project ${p.name}`, link: `/projects/${p.key}` });
      return { created: p.name, key: p.key };
    }
  }
  throw new ToolError(`Unknown tool ${name}`);
}

function systemPrompt(w: World, tzOffset: number) {
  const local = new Date(Date.now() - tzOffset * 60_000);
  const today = local.toISOString().slice(0, 10);
  const dow = local.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const people = w.users.filter((u) => u.status === 'active').map((u) => `- ${u.name}${u.title ? ` (${u.title})` : ''}, role ${u.role}`).join('\n');
  const projects = w.projects.filter((p) => !p.archived).map((p) => `- ${p.name} [key ${p.key}]`).join('\n') || '- (none yet)';
  return `You are Aether, the operations assistant inside a research lab's workspace. You act for ${w.me.name} (role: ${w.me.role}).
Today is ${dow} ${today}. Resolve relative dates ("Friday", "next week", "tomorrow") against today; "by Friday" means the coming Friday.

Lab members:
${people}

Projects:
${projects}

How to act:
- Requests like "ask Soumya to make the pitch deck and submit me the drive link" → create_task: assignee Soumya, title "Make the pitch deck", deliverable_required true, deliverable_description "Pitch deck (Google Drive link)". The requester becomes the reviewer automatically. The assignee is notified.
- Any request to make, write, prepare, record or design something that must be handed over → deliverable_required true. All deliverables are Google Drive links.
- Pick the project from context (names, keys, topics). If none clearly fits, omit project; the task goes to the General project.
- If a name is ambiguous or unknown, ask a short clarifying question instead of guessing.
- Never invent task keys, links or people. Use tools to look things up.
- After acting, reply in one or two short sentences saying what you did (task key, who, due date). No markdown headings. If you only answered a question, be brief and concrete.`;
}

assistant.post('/assistant', async (c) => {
  const me = c.get('user');
  if (me.role === 'guest') throw new HttpError(403, 'Guests cannot use the assistant.');
  const b = await body(c);
  const history = (Array.isArray(b.messages) ? b.messages : []) as { role: string; content: string }[];
  const clean = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!clean.length || clean[clean.length - 1].role !== 'user') throw bad('Say something to the assistant.');
  const tz = Number(c.req.header('x-tz-offset') ?? 0);

  const [users, projects, tasks] = await Promise.all([api<User[]>(c, 'GET', '/api/users'), api<Project[]>(c, 'GET', '/api/projects'), api<Task[]>(c, 'GET', '/api/tasks')]);
  const w: World = { me: { id: me.id, name: me.name, role: me.role }, users, projects, tasks };
  const model = await pickModel(c);
  const messages: Record<string, unknown>[] = [{ role: 'system', content: systemPrompt(w, tz) }, ...clean];
  const actions: Action[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = (await groqFetch(c, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 900 }),
    })) as { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
    const msg = res.choices?.[0]?.message;
    if (!msg) throw new HttpError(502, 'The assistant returned nothing. Try again.');
    if (!msg.tool_calls?.length) return c.json({ reply: (msg.content ?? '').trim() || 'Done.', actions, model });
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let result: unknown;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        result = await runTool(c, w, call.function.name, args, actions);
      } catch (e) {
        result = { error: e instanceof ToolError || e instanceof HttpError ? e.message : `Failed: ${e instanceof Error ? e.message : e}` };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return c.json({ reply: actions.length ? 'Done — see the actions below.' : 'I could not finish that. Try rephrasing.', actions, model });
});

// ---------- settings (admins) ----------
assistant.get('/assistant/status', async (c) => {
  const key = await c.env.DB.prepare(`SELECT 1 FROM settings WHERE key='groq_api_key'`).first();
  return c.json({ configured: !!key, model: (await getSetting(c.env, 'groq_model')) ?? null });
});
assistant.get('/assistant/models', async (c) => {
  requireRank(c.get('user'), 'admin');
  const list = (await groqFetch(c, '/models')) as { data?: { id: string; active?: boolean; owned_by?: string }[] };
  return c.json((list.data ?? []).filter((m) => m.active !== false && !/whisper|guard|tts|orpheus|prompt/i.test(m.id)).map((m) => m.id).sort());
});
assistant.put('/assistant/settings', async (c) => {
  requireRank(c.get('user'), 'admin');
  const b = await body(c);
  if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
    await setSetting(c.env, 'groq_api_key', b.apiKey.trim());
    await setSetting(c.env, 'groq_model', null); // re-pick for the new key
  }
  if (typeof b.model === 'string') await setSetting(c.env, 'groq_model', b.model.trim() || null);
  if (b.remove === true) {
    await setSetting(c.env, 'groq_api_key', null);
    await setSetting(c.env, 'groq_model', null);
  }
  const model = (await c.env.DB.prepare(`SELECT 1 FROM settings WHERE key='groq_api_key'`).first()) ? await pickModel(c) : null;
  return c.json({ ok: true, model });
});
