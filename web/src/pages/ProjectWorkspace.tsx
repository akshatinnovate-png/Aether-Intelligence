import { useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Archive, CalendarRange, Check, Code2, Columns3, GitBranch, LayoutDashboard, List, Milestone as MilestoneIcon, MessagesSquare, Plus, Settings2, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { destroy, save, useActivity, useBookings, useChannels, useCompetitions, useEquipment, useMe, useMilestones, usePapers, useProjects, useTasks, useUsers } from '../lib/data';
import { can, dueLabel, fmtDate, HEALTH, loadTone, PROJECT_STATUS, projectStats, STAGE_LABEL, workload } from '../lib/derive';
import { toast, toastError, useUI } from '../lib/store';
import { Avatar, AvatarStack, Bar, confirmDialog, Empty, Ring } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ProjectForm } from '../components/CreateProject';
import { FeedItem } from './Dashboard';
import { Board } from './project/Board';
import { TaskTable } from './project/TaskTable';
import { Gantt } from './project/Gantt';
import { applyFilter, FilterBar, useTaskFilter } from './project/filters';
import type { Project } from '../types';

export default function ProjectWorkspace() {
  const { key } = useParams();
  const projects = useProjects();
  const tasks = useTasks();
  const milestones = useMilestones();
  const me = useMe()!;
  const channels = useChannels();
  const { openCreateTask } = useUI();
  const [editing, setEditing] = useState(false);
  const project = projects.find((p) => p.key.toLowerCase() === key?.toLowerCase());
  const own = useMemo(() => tasks.filter((t) => t.projectId === project?.id), [tasks, project?.id]);
  const [f, setF] = useTaskFilter();
  if (!project) return <div className="page">{projects.length ? <Empty title="Project not found">It may have been deleted or you may not have access.</Empty> : null}</div>;
  const s = projectStats(project, tasks, milestones);
  const canWrite = can(me.role, 'admin') || (me.role !== 'guest' && (project.members.includes(me.id) || project.leadId === me.id));
  const canManage = can(me.role, 'admin') || (me.role === 'lead' && project.leadId === me.id);
  const channel = channels.find((c) => c.projectId === project.id);
  const filtered = applyFilter(own, f);
  const base = `/projects/${project.key}`;
  const tab = (to: string, icon: React.ReactNode, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
      {icon}
      {label}
    </NavLink>
  );
  const defaultView = me.prefs.defaultProjectView ?? 'board';
  return (
    <div className="page full">
      <div style={{ padding: '20px 20px 0', borderBottom: '1px solid var(--line)' }}>
        <div className="row between start wrap gap-16">
          <div style={{ minWidth: 0 }}>
            <div className="row gap-6 eyebrow">
              <span className="swatch" style={{ background: project.color }} />
              {project.key} · {project.kind} · {PROJECT_STATUS[project.status]}
              {project.archived && <span className="badge amber">Archived</span>}
            </div>
            <h1 className="h1" style={{ marginTop: 8 }}>{project.name}</h1>
          </div>
          <div className="row gap-16 wrap">
            <div className="row gap-12">
              <div style={{ position: 'relative' }}>
                <Ring pct={s.pct} size={40} />
                <span className="mono xs" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{s.pct}%</span>
              </div>
              <div className="xs muted" style={{ lineHeight: 1.5 }}>
                <div>
                  <span className="t2 mono">{s.doneCount}</span>/{s.count} tasks · <span className="t2 mono">{s.done}</span>/{s.total} pts
                </div>
                <div>
                  {project.dueDate ? <span className={dueLabel(project.dueDate, project.status === 'done').tone}>Due {fmtDate(project.dueDate, 'd MMM yyyy')}</span> : 'No deadline'} · <span className={HEALTH[s.health as keyof typeof HEALTH].tone}>{HEALTH[s.health as keyof typeof HEALTH].label}</span>
                </div>
              </div>
            </div>
            <AvatarStack ids={project.members} max={6} size={24} />
            <div className="row gap-6">
              {canWrite && (
                <button className="btn primary sm" onClick={() => openCreateTask({ projectId: project.id })}>
                  <Plus /> Task
                </button>
              )}
              {canManage && (
                <button className="btn sm" onClick={() => setEditing(true)}>
                  <Settings2 /> Settings
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="tabs" style={{ marginTop: 14, borderBottom: 0 }}>
          {tab(`${base}/overview`, <LayoutDashboard />, 'Overview')}
          {tab(`${base}/board`, <Columns3 />, 'Board')}
          {tab(`${base}/list`, <List />, 'List')}
          {tab(`${base}/timeline`, <CalendarRange />, 'Timeline')}
          {tab(`${base}/milestones`, <MilestoneIcon />, `Milestones ${s.msDone}/${s.milestones.length}`)}
          {channel && (
            <Link to={`/chat/${channel.id}`}>
              <MessagesSquare /> Chat{channel.unread ? <span className="badge solid mono">{channel.unread}</span> : null}
            </Link>
          )}
          {project.repoFullName && (
            <Link to={`/code/${project.repoFullName}`}>
              <Code2 /> Code
            </Link>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route index element={<Navigate to={`${base}/${defaultView}${location.search}`} replace />} />
          <Route path="overview" element={<Overview project={project} canManage={canManage} />} />
          <Route
            path="board"
            element={
              <>
                <FilterBar project={project} tasks={own} f={f} set={setF} />
                <div style={{ flex: 1, minHeight: 0 }}>
                  <Board project={project} tasks={filtered} canWrite={canWrite} />
                </div>
              </>
            }
          />
          <Route
            path="list"
            element={
              <>
                <FilterBar project={project} tasks={own} f={f} set={setF} />
                <div className="scroll" style={{ padding: 20, flex: 1 }}>
                  <TaskTable tasks={filtered} canWrite={() => canWrite} />
                </div>
              </>
            }
          />
          <Route
            path="timeline"
            element={
              <>
                <FilterBar project={project} tasks={own} f={f} set={setF} />
                <div style={{ flex: 1, minHeight: 0 }}>
                  <Gantt project={project} tasks={filtered} canWrite={canWrite} />
                </div>
              </>
            }
          />
          <Route path="milestones" element={<Milestones project={project} canWrite={canWrite} />} />
        </Routes>
      </div>
      {editing && <ProjectForm initial={project} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Overview({ project, canManage }: { project: Project; canManage: boolean }) {
  const tasks = useTasks();
  const projects = useProjects();
  const milestones = useMilestones();
  const users = useUsers();
  const activity = useActivity().filter((a) => a.projectId === project.id).slice(0, 25);
  const comps = useCompetitions().filter((c) => c.projectId === project.id);
  const papers = usePapers().filter((p) => p.projectId === project.id);
  const bookings = useBookings().filter((b) => b.projectId === project.id && b.endsAt > new Date().toISOString());
  const equipment = useEquipment();
  const me = useMe()!;
  const nav = useNavigate();
  const s = projectStats(project, tasks, milestones);
  const deps = project.deps.map((id) => projects.find((p) => p.id === id)).filter(Boolean) as Project[];
  const dependents = projects.filter((p) => p.deps.includes(project.id));
  const byStatus = ['backlog', 'todo', 'in_progress', 'review', 'done'].map((st) => s.tasks.filter((t) => t.status === st).length);
  return (
    <div className="scroll" style={{ flex: 1 }}>
      <div className="dash" style={{ padding: 20 }}>
        <section className="panel span-8">
          <div className="panel-head">
            <span className="eyebrow grow">About</span>
          </div>
          <div className="panel-body">
            {project.description ? <Markdown text={project.description} /> : <span className="faint">No description yet.</span>}
            <div className="segbar" style={{ marginTop: 18, height: 10 }}>
              {byStatus.map((n, i) => (
                <i key={i} style={{ flexGrow: n || 0.0001, background: ['var(--faint)', 'var(--text-2)', 'var(--amber)', 'var(--green)', 'var(--accent)'][i] }} />
              ))}
            </div>
            <div className="row wrap gap-16 xs muted" style={{ marginTop: 8 }}>
              {['Backlog', 'To do', 'In progress', 'Review', 'Done'].map((l, i) => (
                <span key={l}>
                  {l} <span className="mono t2">{byStatus[i]}</span>
                </span>
              ))}
              {s.overdue > 0 && <span className="red">{s.overdue} overdue</span>}
            </div>
          </div>
        </section>
        <section className="panel span-4">
          <div className="panel-head">
            <span className="eyebrow grow">Dependencies</span>
          </div>
          <div className="list">
            {deps.map((p) => {
              const ps = projectStats(p, tasks, milestones);
              return (
                <Link key={p.id} to={`/projects/${p.key}`} className="li">
                  <span className="xs faint" style={{ width: 70 }}>Depends on</span>
                  <span className="swatch" style={{ background: p.color }} />
                  <span className="small grow trunc">{p.name}</span>
                  {p.status === 'done' ? <Check size={13} className="green" /> : <span className="mono xs muted">{ps.pct}%</span>}
                </Link>
              );
            })}
            {dependents.map((p) => (
              <Link key={p.id} to={`/projects/${p.key}`} className="li">
                <span className="xs faint" style={{ width: 70 }}>Blocks</span>
                <span className="swatch" style={{ background: p.color }} />
                <span className="small grow trunc">{p.name}</span>
              </Link>
            ))}
            {!deps.length && !dependents.length && <div className="li faint small">Independent project.</div>}
          </div>
        </section>
        <section className="panel span-4">
          <div className="panel-head">
            <span className="eyebrow grow">Team · workload</span>
          </div>
          <div className="list">
            {project.members.map((id) => {
              const u = users.find((x) => x.id === id);
              if (!u) return null;
              const w = workload(u, tasks);
              const here = tasks.filter((t) => t.projectId === project.id && t.assigneeId === id && t.status !== 'done').length;
              return (
                <Link key={id} to={`/members/${id}`} className="li">
                  <Avatar user={u} size={22} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small trunc">
                      {u.name} {project.leadId === id && <span className="badge accent" style={{ marginLeft: 4 }}>Lead</span>}
                    </div>
                    <div className="xs faint">{here} open here</div>
                  </div>
                  <span className={`mono xs ${loadTone(w.load)}`}>{w.load}%</span>
                </Link>
              );
            })}
          </div>
        </section>
        <RepoPanel project={project} canManage={canManage} />
        <section className="panel span-4">
          <div className="panel-head">
            <span className="eyebrow grow">Linked across the lab</span>
          </div>
          <div className="list">
            {comps.map((c) => (
              <Link key={c.id} to={`/competitions?c=${c.id}`} className="li">
                <span className="xs faint" style={{ width: 80 }}>Competition</span>
                <span className="small grow trunc">{c.name}</span>
                <span className="badge mono">{STAGE_LABEL[c.stage]}</span>
              </Link>
            ))}
            {papers.map((p) => (
              <Link key={p.id} to={`/research/${p.id}`} className="li">
                <span className="xs faint" style={{ width: 80 }}>{p.kind}</span>
                <span className="small grow trunc">{p.title}</span>
              </Link>
            ))}
            {bookings.map((b) => (
              <Link key={b.id} to={`/equipment?e=${b.equipmentId}`} className="li">
                <span className="xs faint" style={{ width: 80 }}>Booking</span>
                <span className="small grow trunc">{equipment.find((e) => e.id === b.equipmentId)?.name}</span>
                <span className="xs muted">{fmtDate(b.startsAt)}</span>
              </Link>
            ))}
            {!comps.length && !papers.length && !bookings.length && <div className="li faint small">Link competitions, papers and bookings to this project from their own pages.</div>}
          </div>
        </section>
        <section className="panel span-8">
          <div className="panel-head">
            <span className="eyebrow grow">Recent activity</span>
          </div>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {activity.map((a) => (
              <FeedItem key={a.id} a={a} />
            ))}
            {!activity.length && <div className="empty">No activity yet.</div>}
          </div>
        </section>
        {canManage && (
          <section className="panel span-4">
            <div className="panel-head">
              <span className="eyebrow grow">Manage</span>
            </div>
            <div className="panel-body col gap-6">
              <button className="btn" onClick={() => save('projects', `/api/projects/${project.id}`, 'patch', { archived: !project.archived }).then(() => toast({ title: project.archived ? 'Project restored' : 'Project archived' }), toastError)}>
                <Archive /> {project.archived ? 'Restore project' : 'Archive project'}
              </button>
              {can(me.role, 'admin') && (
                <button
                  className="btn danger"
                  onClick={async () => {
                    if (!(await confirmDialog(`Delete ${project.name}?`, `All ${s.count} tasks, milestones and the project channel are deleted permanently. Archive instead to keep history.`, { danger: true, ok: 'Delete forever' }))) return;
                    await destroy('projects', `/api/projects/${project.id}`, project.id).catch(toastError);
                    nav('/projects');
                  }}
                >
                  <Trash2 /> Delete project
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function RepoPanel({ project, canManage }: { project: Project; canManage: boolean }) {
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  const link = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ webhook: string }>('/api/github/link', { projectId: project.id, repo: repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') });
      toast({ title: 'Repository linked', body: r.webhook === 'installed' ? 'Pushes, PRs and CI now stream into Aether.' : r.webhook === 'skipped' ? 'Webhook skipped on localhost; it installs automatically once deployed.' : `Webhook: ${r.webhook}` });
      setRepo('');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel span-4">
      <div className="panel-head">
        <GitBranch size={14} className="muted" />
        <span className="eyebrow grow">Repository</span>
      </div>
      <div className="panel-body col gap-12">
        {project.repoFullName ? (
          <>
            <Link to={`/code/${project.repoFullName}`} className="row">
              <Code2 size={15} />
              <span className="mono small">{project.repoFullName}</span>
            </Link>
            <div className="xs muted">Commits mentioning <span className="mono accent-text">{project.key}-12</span> link to that task; “fixes {project.key}-12” completes it. PRs and CI failures appear in activity.</div>
            <div className="row gap-6">
              <Link to={`/code/${project.repoFullName}`} className="btn sm">
                Open code
              </Link>
              <a className="btn ghost sm" href={`https://github.com/${project.repoFullName}`} target="_blank" rel="noreferrer">
                GitHub ↗
              </a>
              {canManage && (
                <button className="btn ghost sm" onClick={() => api.post('/api/github/unlink', { projectId: project.id }).catch(toastError)}>
                  Unlink
                </button>
              )}
            </div>
          </>
        ) : canManage ? (
          <>
            <div className="xs muted">Link a GitHub repository to browse code, commit and connect commits to tasks. Needs your GitHub account connected.</div>
            <div className="row gap-6">
              <input className="input sm mono" placeholder="owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
              <button className="btn sm" disabled={!repo.includes('/') || busy} onClick={link}>
                Link
              </button>
            </div>
            <Link to={`/code?new=1&project=${project.id}`} className="btn ghost sm" style={{ alignSelf: 'flex-start' }}>
              + Create a new repository for this project
            </Link>
          </>
        ) : (
          <div className="faint small">No repository linked.</div>
        )}
      </div>
    </section>
  );
}

function Milestones({ project, canWrite }: { project: Project; canWrite: boolean }) {
  const milestones = useMilestones()
    .filter((m) => m.projectId === project.id)
    .sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  const tasks = useTasks().filter((t) => t.projectId === project.id);
  const { openCreateTask } = useUI();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  return (
    <div className="scroll" style={{ padding: 20, flex: 1 }}>
      <div className="col gap-12" style={{ maxWidth: 960 }}>
        {canWrite && (
          <div className="panel" style={{ padding: 12 }}>
            <div className="row gap-6 wrap">
              <input className="input grow" style={{ minWidth: 200 }} placeholder="New milestone, e.g. “Beta with 10 families”" value={name} onChange={(e) => setName(e.target.value)} />
              <input type="date" className="input" style={{ width: 160 }} value={date} onChange={(e) => setDate(e.target.value)} />
              <button
                className="btn primary"
                disabled={!name.trim()}
                onClick={async () => {
                  try {
                    await save('milestones', `/api/projects/${project.id}/milestones`, 'post', { name: name.trim(), dueDate: date || null });
                    setName('');
                    setDate('');
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                Add milestone
              </button>
            </div>
          </div>
        )}
        {milestones.map((m) => {
          const mt = tasks.filter((t) => t.milestoneId === m.id);
          const done = mt.filter((t) => t.status === 'done').length;
          const pct = mt.length ? Math.round((done / mt.length) * 100) : m.done ? 100 : 0;
          const due = dueLabel(m.dueDate, m.done);
          return (
            <div key={m.id} className="panel">
              <div className="row" style={{ padding: '14px 16px', gap: 14 }}>
                <button
                  className="btn ghost icon sm"
                  disabled={!canWrite}
                  title={m.done ? 'Reopen' : 'Mark reached'}
                  onClick={() => save('milestones', `/api/milestones/${m.id}`, 'patch', { done: !m.done }).catch(toastError)}
                  style={{ border: '1px solid var(--line-2)', background: m.done ? 'var(--accent)' : 'transparent', color: 'var(--accent-ink)' }}
                >
                  {m.done && <Check />}
                </button>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="h2" style={{ fontSize: 17, textDecoration: m.done ? 'line-through' : undefined, color: m.done ? 'var(--muted)' : undefined }}>{m.name}</div>
                  <div className="row xs muted" style={{ marginTop: 6 }}>
                    <span className={due.tone}>{m.dueDate ? fmtDate(m.dueDate, 'EEE d MMM yyyy') : 'No date'}</span>
                    <span>·</span>
                    <span>
                      {done}/{mt.length} tasks
                    </span>
                  </div>
                </div>
                <div style={{ width: 200 }} className="row">
                  <Bar pct={pct} tone="accent" />
                  <span className="mono xs muted">{pct}%</span>
                </div>
                {canWrite && (
                  <>
                    <input type="date" className="input sm" style={{ width: 140 }} value={m.dueDate ?? ''} onChange={(e) => save('milestones', `/api/milestones/${m.id}`, 'patch', { dueDate: e.target.value || null }).catch(toastError)} />
                    <button className="btn ghost sm" onClick={() => openCreateTask({ projectId: project.id, milestoneId: m.id, dueDate: m.dueDate })}>
                      <Plus /> Task
                    </button>
                    <button
                      className="btn ghost icon sm"
                      title="Delete milestone"
                      onClick={async () => (await confirmDialog(`Delete milestone “${m.name}”?`, 'Its tasks stay, without a milestone.', { danger: true, ok: 'Delete' })) && destroy('milestones', `/api/milestones/${m.id}`, m.id).catch(toastError)}
                    >
                      <Trash2 />
                    </button>
                  </>
                )}
              </div>
              {mt.length > 0 && (
                <div className="list" style={{ borderTop: '1px solid var(--line)' }}>
                  {mt.slice(0, 8).map((t) => (
                    <Link key={t.id} to={`?task=${t.id}`} className="li small">
                      <span className={`dot`} style={{ background: t.status === 'done' ? 'var(--accent)' : 'var(--line-strong)' }} />
                      <span className="key">{project.key}-{t.number}</span>
                      <span className="trunc grow">{t.title}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!milestones.length && <Empty title="No milestones">Milestones group tasks into checkpoints and show as diamonds on the timeline.</Empty>}
      </div>
    </div>
  );
}
