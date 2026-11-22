import { differenceInCalendarDays, format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import type { Booking, CalEvent, Competition, Equipment, Milestone, Paper, Priority, Project, Stage, Task, TaskStatus, User } from '../types';

// ---------- labels ----------
export const STATUS: { id: TaskStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'review', label: 'In review' },
  { id: 'done', label: 'Done' },
];
export const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.id, s.label])) as Record<TaskStatus, string>;
export const PRIORITY: { id: Priority; label: string }[] = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
  { id: 'none', label: 'No priority' },
];
export const PRIORITY_LABEL = Object.fromEntries(PRIORITY.map((s) => [s.id, s.label])) as Record<Priority, string>;
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
export const STAGES: { id: Stage; label: string }[] = [
  { id: 'discovered', label: 'Discovered' },
  { id: 'registered', label: 'Registered' },
  { id: 'building', label: 'Building' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'finalist', label: 'Finalist' },
  { id: 'result', label: 'Result' },
];
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<Stage, string>;
export const ROLE_LABEL = { owner: 'Owner', admin: 'Administrator', lead: 'Lead', member: 'Member', guest: 'Guest' } as const;
export const ROLE_DESC = {
  owner: 'Everything, including secrets, appointing administrators and transferring ownership.',
  admin: 'Vice administrator: invites people, assigns roles (below admin), manages every project and the workspace settings.',
  lead: 'Creates and runs projects, sets deadlines, manages equipment, awards achievements.',
  member: 'Works on the projects they belong to: tasks, chat, code, research, bookings.',
  guest: 'Read-only access to the projects they are added to.',
} as const;
export const PROJECT_STATUS = { planning: 'Planning', active: 'Active', paused: 'Paused', done: 'Done' } as const;
export const PAPER_STATUS: Record<Paper['status'], string> = { to_read: 'To read', reading: 'Reading', read: 'Read', draft: 'Draft', published: 'Published', archived: 'Archived' };
export const EQUIP_CAT: Record<Equipment['category'], string> = { computer: 'Computers', server: 'Servers', component: 'Components', electronics: 'Electronics', license: 'Software licences', other: 'Other' };

// ---------- dates ----------
export const today = () => format(new Date(), 'yyyy-MM-dd');
export function d(s: string | null | undefined): Date | null {
  if (!s) return null;
  const x = s.length === 10 ? parseISO(`${s}T00:00:00`) : parseISO(s);
  return isValid(x) ? x : null;
}
export function fmtDate(s: string | null | undefined, f = 'd MMM') {
  const x = d(s);
  return x ? format(x, f) : '—';
}
export function fmtDateTime(s: string | null | undefined) {
  const x = d(s);
  return x ? format(x, 'd MMM, HH:mm') : '—';
}
export function ago(s: string | null | undefined) {
  const x = d(s);
  if (!x) return '';
  const secs = (Date.now() - x.getTime()) / 1000;
  if (secs < 45) return 'just now';
  return formatDistanceToNowStrict(x, { addSuffix: true }).replace(' minutes', 'm').replace(' minute', 'm').replace(' hours', 'h').replace(' hour', 'h').replace(' seconds', 's');
}
export function daysUntil(s: string | null | undefined): number | null {
  const x = d(s);
  return x ? differenceInCalendarDays(x, new Date()) : null;
}
export function dueLabel(s: string | null | undefined, done = false): { text: string; tone: '' | 'red' | 'amber' | 'muted' } {
  const n = daysUntil(s);
  if (n === null) return { text: '', tone: '' };
  if (done) return { text: fmtDate(s), tone: 'muted' };
  if (n < 0) return { text: `${-n}d overdue`, tone: 'red' };
  if (n === 0) return { text: 'Today', tone: 'amber' };
  if (n === 1) return { text: 'Tomorrow', tone: 'amber' };
  if (n < 7) return { text: `${n}d`, tone: '' };
  return { text: fmtDate(s), tone: '' };
}
export function countdown(s: string | null | undefined) {
  const x = d(s);
  if (!x) return null;
  const ms = x.getTime() - Date.now();
  const past = ms < 0;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 864e5);
  const hours = Math.floor((abs % 864e5) / 36e5);
  const mins = Math.floor((abs % 36e5) / 6e4);
  return { past, days, hours, mins, text: past ? 'closed' : days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins}m` };
}
export const toLocalInput = (iso: string | null | undefined) => {
  const x = d(iso);
  return x ? format(x, "yyyy-MM-dd'T'HH:mm") : '';
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

// ---------- computed state (one source of truth: the task cache) ----------
export const taskKey = (t: Task, projects: Map<string, Project>) => `${projects.get(t.projectId)?.key ?? '?'}-${t.number}`;
export const isOpen = (t: Task) => t.status !== 'done';
export const isOverdue = (t: Task) => isOpen(t) && !!t.dueDate && t.dueDate < today();

export function projectStats(p: Project, tasks: Task[], milestones: Milestone[] = []) {
  const own = tasks.filter((t) => t.projectId === p.id);
  const total = own.reduce((s, t) => s + Math.max(1, t.estimate), 0);
  const done = own.filter((t) => t.status === 'done').reduce((s, t) => s + Math.max(1, t.estimate), 0);
  const ms = milestones.filter((m) => m.projectId === p.id);
  const overdue = own.filter(isOverdue).length;
  // Progress blends task points and milestones: tasks alone, milestones alone, or 75/25 when a project has both.
  const msDone = ms.filter((m) => m.done).length;
  const taskPct = total ? (done / total) * 100 : null;
  const msPct = ms.length ? (msDone / ms.length) * 100 : null;
  const pct =
    p.status === 'done'
      ? 100
      : Math.round(taskPct !== null && msPct !== null ? taskPct * 0.75 + msPct * 0.25 : taskPct ?? msPct ?? 0);
  const open = own.filter(isOpen).length;
  const schedule = scheduleHealth(p, pct);
  return { tasks: own, count: own.length, open, doneCount: own.length - open, total, done, pct, overdue, milestones: ms, msDone, health: overdue > 2 || schedule === 'behind' ? 'at_risk' : overdue > 0 || schedule === 'tight' ? 'watch' : 'on_track' };
}
function scheduleHealth(p: Project, pct: number): 'ok' | 'tight' | 'behind' {
  const s = d(p.startDate);
  const e = d(p.dueDate);
  if (!s || !e || p.status === 'done') return 'ok';
  const span = e.getTime() - s.getTime();
  if (span <= 0) return 'ok';
  const elapsed = Math.min(1, Math.max(0, (Date.now() - s.getTime()) / span));
  const gap = elapsed * 100 - pct;
  return gap > 30 ? 'behind' : gap > 15 ? 'tight' : 'ok';
}
export const HEALTH = { on_track: { label: 'On track', tone: 'green' }, watch: { label: 'Watch', tone: 'amber' }, at_risk: { label: 'At risk', tone: 'red' } } as const;

export function workload(u: User, tasks: Task[]) {
  const mine = tasks.filter((t) => t.assigneeId === u.id);
  const open = mine.filter(isOpen);
  const active = open.filter((t) => t.status !== 'backlog');
  const points = active.reduce((s, t) => s + Math.max(1, t.estimate), 0);
  const in7 = format(new Date(Date.now() + 7 * 864e5), 'yyyy-MM-dd');
  const dueSoon = open.filter((t) => t.dueDate && t.dueDate <= in7);
  const done = mine.filter((t) => t.status === 'done');
  const onTime = done.filter((t) => !t.dueDate || (t.completedAt ?? '').slice(0, 10) <= t.dueDate);
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const cap = Math.max(1, u.capacity || 20);
  return {
    open: open.length,
    active: active.length,
    points,
    load: Math.round((points / cap) * 100),
    dueSoon: dueSoon.length,
    overdue: open.filter(isOverdue).length,
    done: done.length,
    done30: done.filter((t) => (t.completedAt ?? '') >= since30).length,
    completion: mine.length ? Math.round((done.length / mine.length) * 100) : 0,
    onTime: done.length ? Math.round((onTime.length / done.length) * 100) : null,
    tasks: mine,
  };
}
export const loadTone = (load: number) => (load > 100 ? 'red' : load > 80 ? 'amber' : 'green');

export function equipmentState(e: Equipment, bookings: Booking[]) {
  const now = new Date().toISOString();
  const active = bookings.filter((b) => b.equipmentId === e.id && b.startsAt <= now && b.endsAt > now);
  const next = bookings.filter((b) => b.equipmentId === e.id && b.startsAt > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
  if (e.condition === 'retired') return { state: 'retired', label: 'Retired', tone: 'muted', active, next, free: 0 } as const;
  if (e.condition === 'broken') return { state: 'broken', label: 'Out of order', tone: 'red', active, next, free: 0 } as const;
  if (e.condition === 'maintenance') return { state: 'maintenance', label: 'Maintenance', tone: 'amber', active, next, free: 0 } as const;
  if (e.category === 'license') {
    const expired = e.licenseExpiry && e.licenseExpiry < today();
    return { state: expired ? 'broken' : 'available', label: expired ? 'Expired' : 'Active', tone: expired ? 'red' : 'green', active, next, free: e.licenseSeats ?? 0 } as const;
  }
  if (e.assignedTo && !e.bookable) return { state: 'assigned', label: 'Assigned', tone: 'blue', active, next, free: 0 } as const;
  const free = Math.max(0, e.quantity - active.length);
  if (free === 0) return { state: 'in_use', label: 'In use', tone: 'blue', active, next, free } as const;
  return { state: 'available', label: active.length ? `${free}/${e.quantity} free` : 'Available', tone: 'green', active, next, free } as const;
}

// ---------- unified deadlines (calendar + dashboard) ----------
export type DeadlineKind = 'task' | 'milestone' | 'project' | 'competition' | 'registration' | 'event' | 'meeting' | 'booking' | 'license' | 'maintenance';
export interface DeadlineItem {
  id: string;
  kind: DeadlineKind;
  title: string;
  date: string; // ISO or YYYY-MM-DD
  end?: string | null;
  sub: string;
  link: string;
  color: string;
  done: boolean;
  allDay: boolean;
  people: string[];
}
export const KIND_COLOR: Record<DeadlineKind, string> = {
  task: 'var(--text-2)',
  milestone: 'var(--accent)',
  project: 'var(--violet)',
  competition: 'var(--red)',
  registration: 'var(--amber)',
  event: 'var(--blue)',
  meeting: 'var(--blue)',
  booking: 'var(--green)',
  license: 'var(--amber)',
  maintenance: 'var(--amber)',
};
export const KIND_LABEL: Record<DeadlineKind, string> = {
  task: 'Task',
  milestone: 'Milestone',
  project: 'Project due',
  competition: 'Competition',
  registration: 'Registration',
  event: 'Event',
  meeting: 'Meeting',
  booking: 'Booking',
  license: 'Licence',
  maintenance: 'Maintenance',
};

export function deadlines(src: {
  tasks: Task[];
  projects: Project[];
  milestones: Milestone[];
  competitions: Competition[];
  events: CalEvent[];
  bookings: Booking[];
  equipment: Equipment[];
  users: User[];
}): DeadlineItem[] {
  const pm = new Map(src.projects.map((p) => [p.id, p]));
  const em = new Map(src.equipment.map((e) => [e.id, e]));
  const um = new Map(src.users.map((u) => [u.id, u]));
  const out: DeadlineItem[] = [];
  for (const t of src.tasks) {
    const p = pm.get(t.projectId);
    if (!t.dueDate || !p || p.archived) continue;
    out.push({ id: `t:${t.id}`, kind: 'task', title: t.title, date: t.dueDate, sub: `${p.key}-${t.number}`, link: `/projects/${p.key}?task=${t.id}`, color: p.color, done: t.status === 'done', allDay: true, people: t.assigneeId ? [t.assigneeId] : [] });
  }
  for (const m of src.milestones) {
    const p = pm.get(m.projectId);
    if (!m.dueDate || !p || p.archived) continue;
    out.push({ id: `m:${m.id}`, kind: 'milestone', title: m.name, date: m.dueDate, sub: p.name, link: `/projects/${p.key}/milestones`, color: p.color, done: m.done, allDay: true, people: p.members });
  }
  for (const p of src.projects) {
    if (!p.dueDate || p.archived) continue;
    out.push({ id: `p:${p.id}`, kind: 'project', title: `${p.name} due`, date: p.dueDate, sub: p.key, link: `/projects/${p.key}`, color: p.color, done: p.status === 'done', allDay: true, people: p.members });
  }
  for (const c of src.competitions) {
    const closed = ['submitted', 'finalist', 'result'].includes(c.stage);
    if (c.deadline) out.push({ id: `c:${c.id}`, kind: 'competition', title: `${c.name} — submission`, date: c.deadline, sub: c.organizer, link: `/competitions?c=${c.id}`, color: 'var(--red)', done: closed, allDay: false, people: c.members });
    if (c.registrationDeadline) out.push({ id: `r:${c.id}`, kind: 'registration', title: `${c.name} — registration`, date: c.registrationDeadline, sub: c.organizer, link: `/competitions?c=${c.id}`, color: 'var(--amber)', done: c.stage !== 'discovered', allDay: false, people: c.members });
    if (c.eventDate) out.push({ id: `ce:${c.id}`, kind: 'event', title: `${c.name} — event day`, date: c.eventDate, sub: c.organizer, link: `/competitions?c=${c.id}`, color: 'var(--blue)', done: c.stage === 'result', allDay: true, people: c.members });
  }
  for (const e of src.events) out.push({ id: `e:${e.id}`, kind: e.kind === 'meeting' || e.kind === 'review' ? 'meeting' : e.kind === 'deadline' ? 'task' : 'event', title: e.title, date: e.startsAt, end: e.endsAt, sub: e.location || (e.projectId ? pm.get(e.projectId)?.name ?? '' : ''), link: `/calendar?event=${e.id}`, color: e.kind === 'deadline' ? 'var(--red)' : 'var(--blue)', done: (e.endsAt ?? e.startsAt) < new Date().toISOString(), allDay: e.allDay, people: e.attendees });
  for (const b of src.bookings) {
    const eq = em.get(b.equipmentId);
    if (!eq) continue;
    out.push({ id: `b:${b.id}`, kind: 'booking', title: `${eq.name}`, date: b.startsAt, end: b.endsAt, sub: um.get(b.userId)?.name ?? '', link: `/equipment?e=${eq.id}`, color: 'var(--green)', done: b.endsAt < new Date().toISOString(), allDay: false, people: [b.userId] });
  }
  for (const e of src.equipment) {
    if (e.licenseExpiry) out.push({ id: `l:${e.id}`, kind: 'license', title: `${e.name} licence expires`, date: e.licenseExpiry, sub: e.tag, link: `/equipment?e=${e.id}`, color: 'var(--amber)', done: false, allDay: true, people: [] });
    if (e.nextMaintenance) out.push({ id: `mt:${e.id}`, kind: 'maintenance', title: `${e.name} maintenance`, date: e.nextMaintenance, sub: e.tag, link: `/equipment?e=${e.id}`, color: 'var(--amber)', done: false, allDay: true, people: [] });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- misc ----------
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';
export const plural = (n: number, w: string, p = `${w}s`) => `${n} ${n === 1 ? w : p}`;
export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const RANK = { guest: 1, member: 2, lead: 3, admin: 4, owner: 5 } as const;
export const can = (role: keyof typeof RANK | undefined, min: keyof typeof RANK) => !!role && RANK[role] >= RANK[min];
export const SKILL_SUGGESTIONS = ['Python', 'TypeScript', 'Kotlin', 'Rust', 'C++', 'Go', 'Java', 'React', 'Android', 'UI/UX', 'AI/ML', 'Deep learning', 'NLP', 'Computer vision', 'Robotics', 'Embedded', 'PCB design', 'Cloud', 'DevOps', 'Data engineering', 'Research writing', 'Pitching', 'Product'];
export function nextPosition(list: Task[], index: number) {
  const before = list[index - 1]?.position;
  const after = list[index]?.position;
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return after! - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}

// ---------- activity feed ----------
/** Verbs where only the latest state matters: rapid back-and-forth collapses into one line. */
const SETTLING = new Set(['assigned', 'completed', 'reopened', 'moved', 'updated', 'rescheduled', 'prioritised', 'stage', 'condition', 'status', 'progress', 'members']);
const WINDOW_MS = 10 * 60_000;

/**
 * Collapses repeated changes by the same person to the same item within 10 minutes, keeping the newest.
 * "reached → reopened → reached milestone X" becomes one "reached"; three reassignments become the final one.
 * Expects newest-first input; creations, comments, pushes and the like are always kept.
 */
export function collapseActivity<T extends { actorId: string | null; entityType: string; entityId: string; verb: string; createdAt: string }>(rows: T[]): T[] {
  const out: T[] = [];
  const kept = new Map<string, number>(); // actor|entity -> createdAt of the newest kept settling row
  for (const r of rows) {
    if (!SETTLING.has(r.verb)) {
      out.push(r);
      continue;
    }
    const key = `${r.actorId}|${r.entityType}|${r.entityId}`;
    const t = Date.parse(r.createdAt);
    const newer = kept.get(key);
    if (newer !== undefined && newer - t <= WINDOW_MS) {
      kept.set(key, t); // extend the window back through the burst
      continue;
    }
    kept.set(key, t);
    out.push(r);
  }
  return out;
}
