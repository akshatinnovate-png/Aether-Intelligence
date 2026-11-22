import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { AlertTriangle, ArrowUpRight, EyeOff, GitBranch, Sparkles } from 'lucide-react';
import { useActivity, useBookings, useCompetitions, useEquipment, useEvents, useMe, useMilestones, usePapers, useProjects, useTasks, useUsers } from '../lib/data';
import { ago, collapseActivity, countdown, d, deadlines, dueLabel, equipmentState, EQUIP_CAT, HEALTH, isOverdue, KIND_LABEL, loadTone, projectStats, STAGE_LABEL, today, workload } from '../lib/derive';
import { useUI } from '../lib/store';
import { canReviewTask, deliverableState } from '../components/Deliverable';
import { Avatar, AvatarStack, Bar, Empty, PriorityIcon, Sparkline, StatusIcon } from '../components/ui';
import { savePrefs } from '../components/Shell';
import type { Activity } from '../types';

export const DASH_PANELS = [
  { id: 'projects', label: 'Project health' },
  { id: 'deadlines', label: 'Upcoming deadlines' },
  { id: 'workload', label: 'Team workload' },
  { id: 'activity', label: 'Lab activity timeline' },
  { id: 'mytasks', label: 'My tasks' },
  { id: 'research', label: 'Research pipeline' },
  { id: 'competitions', label: 'Competition calendar' },
  { id: 'equipment', label: 'Equipment availability' },
] as const;

export default function Dashboard() {
  const me = useMe()!;
  const users = useUsers();
  const projects = useProjects();
  const tasks = useTasks();
  const milestones = useMilestones();
  const comps = useCompetitions();
  const equipment = useEquipment();
  const bookings = useBookings();
  const events = useEvents();
  const papers = usePapers();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const hidden = new Set(me.prefs.dashboard?.hidden ?? []);
  const hide = (id: string) => savePrefs({ ...me.prefs, dashboard: { ...me.prefs.dashboard, hidden: [...hidden, id] } });

  const active = projects.filter((p) => !p.archived && p.status === 'active');
  const assigned = new Set(tasks.filter((t) => t.status !== 'done' && t.assigneeId).map((t) => t.assigneeId!));
  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter(isOverdue);
  const in7 = format(addDays(new Date(), 7), 'yyyy-MM-dd');
  const dueWeek = open.filter((t) => t.dueDate && t.dueDate >= today() && t.dueDate <= in7);
  const eqStates = equipment.filter((e) => e.condition !== 'retired').map((e) => ({ e, s: equipmentState(e, bookings) }));
  const available = eqStates.filter((x) => x.s.state === 'available').length;
  const doneByDay = useMemo(() => {
    const days = [...Array(14)].map((_, i) => format(addDays(new Date(), i - 13), 'yyyy-MM-dd'));
    return days.map((day) => tasks.filter((t) => t.completedAt?.slice(0, 10) === day).length);
  }, [tasks]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const myOverdue = overdue.filter((t) => t.assigneeId === me.id).length;
  const myOpen = open.filter((t) => t.assigneeId === me.id).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{format(new Date(), 'EEEE, d MMMM yyyy')} · Command</div>
          <h1 className="h-display">
            {greet}, {me.name.split(' ')[0]}.
          </h1>
          <p>
            {active.length} active project{active.length === 1 ? '' : 's'}, {open.length} open task{open.length === 1 ? '' : 's'}
            {overdue.length ? (
              <>
                , <span className="red">{overdue.length} overdue</span>
              </>
            ) : null}
            . You have {myOpen} open{myOverdue ? <span className="red"> ({myOverdue} overdue)</span> : ''}.
          </p>
        </div>
        <div className="row gap-6">
          <Link to="/my-work" className="btn sm">
            My work
          </Link>
          <Link to="/calendar" className="btn sm">
            Calendar
          </Link>
        </div>
      </div>

      <Attention />

      <div className="stats" style={{ marginBottom: 12 }}>
        <Stat to="/projects" label="Active projects" value={active.length} detail={`${projects.filter((p) => !p.archived).length} total · ${projects.filter((p) => p.status === 'done').length} done`} />
        <Stat to="/members" label="Members assigned" value={assigned.size} detail={`of ${users.filter((u) => u.status === 'active').length} in the lab`} />
        <Stat to="/my-work?view=all" label="Open tasks" value={open.length} detail={`${tasks.filter((t) => t.status === 'in_progress').length} in progress`} extra={<Sparkline values={doneByDay} />} />
        <Stat to="/my-work?view=overdue" label="Overdue" value={overdue.length} detail={overdue.length ? `oldest ${dueLabel(overdue.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]?.dueDate).text}` : 'nothing late'} alert={overdue.length > 0} />
        <Stat to="/calendar" label="Due this week" value={dueWeek.length} detail={`${milestones.filter((m) => !m.done && m.dueDate && m.dueDate <= in7 && m.dueDate >= today()).length} milestones`} />
        <Stat to="/equipment" label="Equipment free" value={`${available}/${eqStates.length}`} detail={`${eqStates.filter((x) => x.s.state === 'in_use').length} in use · ${eqStates.filter((x) => x.s.state === 'maintenance' || x.s.state === 'broken').length} down`} />
      </div>

      <div className="dash">
        {!hidden.has('projects') && <ProjectHealth onHide={() => hide('projects')} />}
        {!hidden.has('deadlines') && <Deadlines onHide={() => hide('deadlines')} src={{ tasks, projects, milestones, competitions: comps, events, bookings, equipment, users }} />}
        {!hidden.has('workload') && <Workload onHide={() => hide('workload')} />}
        {!hidden.has('activity') && <Timeline onHide={() => hide('activity')} />}
        {!hidden.has('mytasks') && <MyTasks onHide={() => hide('mytasks')} />}
        {!hidden.has('research') && <ResearchPipeline onHide={() => hide('research')} papers={papers} />}
        {!hidden.has('competitions') && <CompetitionPanel onHide={() => hide('competitions')} />}
        {!hidden.has('equipment') && (
          <Panel span={4} title="Equipment availability" link="/equipment" onHide={() => hide('equipment')}>
            <div className="list">
              {(Object.keys(EQUIP_CAT) as (keyof typeof EQUIP_CAT)[])
                .map((cat) => ({ cat, items: eqStates.filter((x) => x.e.category === cat) }))
                .filter((g) => g.items.length)
                .map(({ cat, items }) => {
                  const free = items.filter((x) => x.s.state === 'available').length;
                  const use = items.filter((x) => x.s.state === 'in_use' || x.s.state === 'assigned').length;
                  const down = items.length - free - use;
                  return (
                    <Link key={cat} to={`/equipment?cat=${cat}`} className="li">
                      <span className="grow small">{EQUIP_CAT[cat]}</span>
                      <span className="segbar" style={{ width: 110 }}>
                        <i style={{ flexGrow: free, background: 'var(--green)' }} />
                        <i style={{ flexGrow: use, background: 'var(--blue)' }} />
                        <i style={{ flexGrow: down, background: 'var(--amber)' }} />
                      </span>
                      <span className="mono xs muted" style={{ width: 34, textAlign: 'right' }}>
                        {free}/{items.length}
                      </span>
                    </Link>
                  );
                })}
              {bookings
                .filter((b) => b.startsAt <= new Date().toISOString() && b.endsAt > new Date().toISOString())
                .slice(0, 4)
                .map((b) => {
                  const e = equipment.find((x) => x.id === b.equipmentId);
                  const u = users.find((x) => x.id === b.userId);
                  return (
                    <Link key={b.id} to={`/equipment?e=${b.equipmentId}`} className="li">
                      <span className="dot" style={{ background: 'var(--blue)' }} />
                      <span className="small trunc grow">{e?.name}</span>
                      <Avatar user={u} size={16} />
                      <span className="xs muted">until {format(d(b.endsAt)!, 'd MMM HH:mm')}</span>
                    </Link>
                  );
                })}
              {!eqStates.length && <Empty title="No equipment yet">Add computers, servers, components and licences.</Empty>}
            </div>
            <div className="panel-foot xs muted">
              <span className="dot" style={{ background: 'var(--green)' }} /> free <span className="dot" style={{ background: 'var(--blue)' }} /> in use <span className="dot" style={{ background: 'var(--amber)' }} /> maintenance
            </div>
          </Panel>
        )}
      </div>
      {hidden.size > 0 && (
        <div className="row" style={{ marginTop: 16 }}>
          <span className="xs muted">{hidden.size} panel{hidden.size > 1 ? 's' : ''} hidden.</span>
          <button className="btn ghost xs" onClick={() => savePrefs({ ...me.prefs, dashboard: { ...me.prefs.dashboard, hidden: [] } })}>
            Show all
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, detail, to, alert, extra }: { label: string; value: ReactNode; detail: ReactNode; to: string; alert?: boolean; extra?: ReactNode }) {
  return (
    <Link to={to} className={`stat${alert ? ' alert' : ''}`}>
      <div className="eyebrow">{label}</div>
      {extra}
      <div className="v">{value}</div>
      <div className="d">{detail}</div>
    </Link>
  );
}

export function Panel({ span, title, link, children, onHide, right }: { span: number; title: string; link?: string; children: ReactNode; onHide?: () => void; right?: ReactNode }) {
  return (
    <section className={`panel span-${span}`}>
      <div className="panel-head">
        <span className="eyebrow grow">{title}</span>
        {right}
        {onHide && (
          <button className="btn ghost icon xs" title="Hide panel" onClick={onHide}>
            <EyeOff />
          </button>
        )}
        {link && (
          <Link to={link} className="btn ghost icon xs" title="Open">
            <ArrowUpRight />
          </Link>
        )}
      </div>
      <div className="panel-body flush" style={{ flex: 1, minHeight: 0, overflow: 'auto', maxHeight: 440 }}>
        {children}
      </div>
    </section>
  );
}

function ProjectHealth({ onHide }: { onHide: () => void }) {
  const projects = useProjects();
  const tasks = useTasks();
  const milestones = useMilestones();
  const users = useUsers();
  const nav = useNavigate();
  const rows = projects
    .filter((p) => !p.archived && p.status !== 'done')
    .map((p) => ({ p, s: projectStats(p, tasks, milestones) }))
    .sort((a, b) => (a.p.dueDate ?? '9').localeCompare(b.p.dueDate ?? '9'));
  return (
    <Panel span={8} title="Active projects · health" link="/projects" onHide={onHide}>
      {rows.length ? (
        <table className="t">
          <thead>
            <tr>
              <th>Project</th>
              <th>Lead</th>
              <th style={{ width: '26%' }}>Progress</th>
              <th className="num">Open</th>
              <th className="num">Late</th>
              <th>Deadline</th>
              <th>Health</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, s }) => {
              const due = dueLabel(p.dueDate);
              const blockedBy = p.deps.map((id) => projects.find((x) => x.id === id)).filter((x) => x && x.status !== 'done');
              return (
                <tr key={p.id} className="clickable" onClick={() => nav(`/projects/${p.key}`)}>
                  <td>
                    <div className="row">
                      <span className="swatch" style={{ background: p.color }} />
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <span className="key">{p.key}</span>
                      {blockedBy.length > 0 && (
                        <span className="badge mono" title={`Depends on ${blockedBy.map((x) => x!.name).join(', ')}`}>
                          <GitBranch size={10} /> {blockedBy.length}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <Avatar user={users.find((u) => u.id === p.leadId)} size={18} />
                  </td>
                  <td>
                    <div className="row">
                      <Bar pct={s.pct} tone="accent" />
                      <span className="mono xs muted" style={{ width: 32, textAlign: 'right' }}>
                        {s.pct}%
                      </span>
                    </div>
                  </td>
                  <td className="num mono">{s.open}</td>
                  <td className={`num mono${s.overdue ? ' red' : ' faint'}`}>{s.overdue}</td>
                  <td className={`small ${due.tone}`}>{p.dueDate ? due.text : <span className="faint">—</span>}</td>
                  <td>
                    <span className={`badge ${HEALTH[s.health as keyof typeof HEALTH].tone}`}>{HEALTH[s.health as keyof typeof HEALTH].label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Empty title="No active projects">Create one to see its health here.</Empty>
      )}
    </Panel>
  );
}

function Deadlines({ onHide, src }: { onHide: () => void; src: Parameters<typeof deadlines>[0] }) {
  const items = useMemo(() => {
    const from = new Date(Date.now() - 864e5 * 2).toISOString().slice(0, 10);
    const to = addDays(new Date(), 21).toISOString();
    return deadlines(src).filter((x) => !x.done && x.kind !== 'booking' && x.date >= from && x.date <= to);
  }, [src]);
  const groups = new Map<string, typeof items>();
  for (const it of items.slice(0, 40)) {
    const k = it.date.slice(0, 10) < today() ? 'Overdue' : it.date.slice(0, 10);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return (
    <Panel span={4} title="Upcoming deadlines · 21 days" link="/calendar" onHide={onHide}>
      {items.length ? (
        [...groups.entries()].map(([day, list]) => (
          <div key={day}>
            <div className="row" style={{ padding: '8px 14px 4px', background: 'var(--bg-2)', borderBottom: '1px solid var(--line)' }}>
              <span className={`eyebrow${day === 'Overdue' ? ' red' : ''}`}>{day === 'Overdue' ? 'Overdue' : day === today() ? 'Today' : format(d(day)!, 'EEE d MMM')}</span>
            </div>
            {list.map((it) => (
              <Link key={it.id} to={it.link} className="li">
                <span className="swatch" style={{ background: it.color }} />
                <span className="small trunc grow">{it.title}</span>
                <span className="xs faint">{KIND_LABEL[it.kind]}</span>
              </Link>
            ))}
          </div>
        ))
      ) : (
        <Empty title="Clear horizon">Nothing due in the next three weeks.</Empty>
      )}
    </Panel>
  );
}

function Workload({ onHide }: { onHide: () => void }) {
  const users = useUsers().filter((u) => u.status === 'active' && u.role !== 'guest');
  const tasks = useTasks();
  const online = useUI((s) => s.online);
  const rows = users.map((u) => ({ u, w: workload(u, tasks) })).sort((a, b) => b.w.load - a.w.load);
  return (
    <Panel span={4} title="Team workload · vs weekly capacity" link="/members" onHide={onHide}>
      <div className="list">
        {rows.map(({ u, w }) => (
          <Link key={u.id} to={`/members/${u.id}`} className="li">
            <Avatar user={u} size={22} online={online.includes(u.id)} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row between">
                <span className="small trunc">{u.name}</span>
                <span className={`mono xs ${loadTone(w.load)}`}>{w.load}%</span>
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                <Bar pct={w.load} tone={w.load > 100 ? 'over' : w.load > 80 ? 'warn' : 'accent'} />
              </div>
              <div className="xs faint" style={{ marginTop: 3 }}>
                {w.active} active · {w.points}/{u.capacity} pts{w.overdue ? <span className="red"> · {w.overdue} late</span> : ''}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function Timeline({ onHide }: { onHide: () => void }) {
  const activity = useActivity();
  return (
    <Panel span={4} title="Lab activity · live" onHide={onHide} right={<span className="dot" style={{ background: 'var(--green)', animation: 'spin 2s linear infinite' }} />}>
      <div className="timeline-feed">
        {collapseActivity(activity).slice(0, 40).map((a) => (
          <FeedItem key={a.id} a={a} />
        ))}
        {!activity.length && <Empty title="Quiet so far">Everything the team does shows up here as it happens.</Empty>}
      </div>
    </Panel>
  );
}
export function FeedItem({ a }: { a: Activity }) {
  const users = useUsers();
  const projects = useProjects();
  const u = users.find((x) => x.id === a.actorId);
  const p = projects.find((x) => x.id === a.projectId);
  const link = feedLink(a, p?.key);
  const body = (
    <>
      <Avatar user={u ?? { name: 'GitHub', avatarColor: '#3a3a40' }} size={20} />
      <div style={{ minWidth: 0 }}>
        <span className="who">{u?.name ?? 'GitHub'}</span> <span className="what">{a.summary}</span>
        {p && (
          <div className="xs faint row gap-4" style={{ marginTop: 2 }}>
            <span className="swatch" style={{ background: p.color, width: 6, height: 6 }} />
            {p.name}
          </div>
        )}
      </div>
      <span className="xs faint" style={{ whiteSpace: 'nowrap' }}>{ago(a.createdAt)}</span>
    </>
  );
  return link ? (
    <Link to={link} className="feed-item">
      {body}
    </Link>
  ) : (
    <div className="feed-item">{body}</div>
  );
}
function feedLink(a: Activity, pkey?: string) {
  if (a.entityType === 'task' && pkey && a.verb !== 'deleted') return `/projects/${pkey}?task=${a.entityId}`;
  if (a.entityType === 'project' && pkey) return `/projects/${pkey}`;
  if (a.entityType === 'competition') return `/competitions?c=${a.entityId}`;
  if (a.entityType === 'equipment') return `/equipment?e=${a.entityId}`;
  if (a.entityType === 'paper') return `/research/${a.entityId}`;
  if (a.entityType === 'user') return `/members/${a.entityId}`;
  if (a.entityType === 'repo') return `/code/${a.entityId}`;
  if (a.entityType === 'event') return `/calendar?event=${a.entityId}`;
  return null;
}

function MyTasks({ onHide }: { onHide: () => void }) {
  const me = useMe()!;
  const tasks = useTasks();
  const projects = useProjects();
  const mine = tasks
    .filter((t) => t.assigneeId === me.id && t.status !== 'done')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    .slice(0, 12);
  return (
    <Panel span={4} title="My tasks" link="/my-work" onHide={onHide}>
      <div className="list">
        {mine.map((t) => {
          const p = projects.find((x) => x.id === t.projectId);
          const due = dueLabel(t.dueDate);
          return (
            <Link key={t.id} to={`?task=${t.id}`} className="li">
              <StatusIcon status={t.status} />
              <PriorityIcon p={t.priority} />
              <span className="key">{p?.key}-{t.number}</span>
              <span className="small trunc grow">{t.title}</span>
              {due.text && <span className={`xs ${due.tone || 'muted'}`}>{due.text}</span>}
            </Link>
          );
        })}
        {!mine.length && <Empty title="Nothing assigned">Press C to create a task.</Empty>}
      </div>
    </Panel>
  );
}

function ResearchPipeline({ onHide, papers }: { onHide: () => void; papers: ReturnType<typeof usePapers> }) {
  const me = useMe()!;
  const stages = [
    { id: 'to_read', label: 'To read', c: 'var(--line-strong)' },
    { id: 'reading', label: 'Reading', c: 'var(--amber)' },
    { id: 'read', label: 'Read', c: 'var(--accent)' },
    { id: 'draft', label: 'Drafts', c: 'var(--blue)' },
    { id: 'published', label: 'Published', c: 'var(--green)' },
  ];
  const counts = stages.map((s) => ({ ...s, n: papers.filter((p) => p.status === s.id).length }));
  const reading = papers.filter((p) => (p.progress[me.id] ?? 0) > 0 && (p.progress[me.id] ?? 0) < 100).slice(0, 5);
  const recent = papers.slice(0, 5);
  return (
    <Panel span={4} title="Research pipeline" link="/research" onHide={onHide}>
      <div style={{ padding: 14 }}>
        <div className="segbar" style={{ height: 10 }}>
          {counts.map((s) => (
            <i key={s.id} style={{ flexGrow: s.n || 0.0001, background: s.c }} title={`${s.label}: ${s.n}`} />
          ))}
        </div>
        <div className="row wrap gap-12" style={{ marginTop: 10 }}>
          {counts.map((s) => (
            <Link key={s.id} to={`/research?status=${s.id}`} className="row gap-6 xs muted">
              <span className="swatch" style={{ background: s.c }} />
              {s.label} <span className="mono t2">{s.n}</span>
            </Link>
          ))}
        </div>
      </div>
      <hr className="sep" />
      <div className="list">
        {(reading.length ? reading : recent).map((p) => (
          <Link key={p.id} to={`/research/${p.id}`} className="li">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small trunc serif" style={{ fontSize: 14 }}>{p.title}</div>
              <div className="xs faint trunc">{p.authors || p.kind}</div>
            </div>
            {p.progress[me.id] !== undefined && <span className="mono xs muted">{p.progress[me.id]}%</span>}
          </Link>
        ))}
        {!papers.length && <Empty title="Vault is empty">Add papers, documents and notes.</Empty>}
      </div>
    </Panel>
  );
}

function CompetitionPanel({ onHide }: { onHide: () => void }) {
  const comps = useCompetitions();
  const upcoming = comps
    .filter((c) => !['result'].includes(c.stage) && (c.deadline || c.registrationDeadline))
    .map((c) => ({ c, when: c.stage === 'discovered' && c.registrationDeadline ? c.registrationDeadline : c.deadline }))
    .filter((x) => x.when && x.when >= new Date(Date.now() - 864e5).toISOString())
    .sort((a, b) => a.when!.localeCompare(b.when!))
    .slice(0, 6);
  return (
    <Panel span={4} title="Competition calendar" link="/competitions" onHide={onHide}>
      <div className="list">
        {upcoming.map(({ c, when }) => {
          const cd = countdown(when);
          const req = c.requirements.length ? Math.round((c.requirements.filter((r) => r.done).length / c.requirements.length) * 100) : null;
          return (
            <Link key={c.id} to={`/competitions?c=${c.id}`} className="li" style={{ alignItems: 'flex-start', paddingTop: 10, paddingBottom: 10 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small trunc" style={{ fontWeight: 500 }}>{c.name}</div>
                <div className="row xs muted" style={{ marginTop: 4 }}>
                  <span className="badge mono">{STAGE_LABEL[c.stage]}</span>
                  {req !== null && <span>{req}% ready</span>}
                  <AvatarStack ids={c.members} size={16} max={3} />
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={`mono small ${cd && cd.days < 3 ? 'red' : 't2'}`}>{cd?.text}</div>
                <div className="xs faint">{c.stage === 'discovered' ? 'to register' : 'to submit'}</div>
              </div>
            </Link>
          );
        })}
        {!upcoming.length && (
          <Empty title="No live competitions" icon={<AlertTriangle />}>
            Track a competition from discovery to result.
          </Empty>
        )}
      </div>
    </Panel>
  );
}

/** The first thing on Home: what needs you right now, each with a one-click way to act. */
function Attention() {
  const me = useMe()!;
  const tasks = useTasks();
  const projects = useProjects();
  const setAssistant = useUI((s) => s.setAssistant);
  const proj = (id: string) => projects.find((p) => p.id === id);
  const handIn = tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done' && ['to_submit', 'changes'].includes(deliverableState(t)));
  const review = tasks.filter((t) => t.submission?.status === 'pending' && canReviewTask(me, t, proj(t.projectId)));
  const late = tasks.filter((t) => t.assigneeId === me.id && isOverdue(t));
  const Card = ({ title, items, empty, to, tone }: { title: string; items: typeof tasks; empty: string; to: string; tone?: string }) => (
    <section className="panel" style={{ borderColor: items.length ? `var(--${tone ?? 'accent'}-line, var(--accent-line))` : undefined }}>
      <Link to={to} className="panel-head">
        <span className="eyebrow grow">{title}</span>
        <span className={`badge mono${items.length ? ' solid' : ''}`}>{items.length}</span>
      </Link>
      <div className="list">
        {items.slice(0, 4).map((t) => (
          <Link key={t.id} to={`/projects/${proj(t.projectId)?.key}?task=${t.id}`} className="li">
            <span className="key">{proj(t.projectId)?.key}-{t.number}</span>
            <span className="small trunc grow">{t.title}</span>
            {t.dueDate && <span className={`xs ${dueLabel(t.dueDate).tone || 'muted'}`}>{dueLabel(t.dueDate).text}</span>}
          </Link>
        ))}
        {!items.length && <div className="li faint small">{empty}</div>}
      </div>
    </section>
  );
  return (
    <>
      <button className="ask-trigger" style={{ width: '100%', height: 44, fontSize: 14, marginBottom: 12, justifyContent: 'flex-start', padding: '0 16px' }} onClick={() => setAssistant(true)}>
        <Sparkles />
        <span className="grow" style={{ textAlign: 'left', fontWeight: 400 }}>Ask Aether — “Ask Soumya to make the pitch deck by Friday and submit the Drive link”</span>
        <span className="kbd">⌘J</span>
      </button>
      <div className="attention">
        <Card title="Hand in · Google Drive" items={handIn} empty="Nothing to hand in." to="/submissions" />
        <Card title="Waiting for your review" items={review} empty="Nothing to review." to="/submissions" />
        <Card title="Your overdue tasks" items={late} empty="Nothing overdue." to="/my-work?view=overdue" tone="red" />
      </div>
    </>
  );
}
