import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FolderKanban, GitBranch, LayoutGrid, List, Plus } from 'lucide-react';
import { useMe, useMilestones, useProjects, useTasks, useUsers } from '../lib/data';
import { can, dueLabel, fmtDate, HEALTH, PROJECT_STATUS, projectStats } from '../lib/derive';
import { useUI } from '../lib/store';
import { Avatar, AvatarStack, Bar, Empty, Ring, SearchInput, Seg } from '../components/ui';

export default function Projects() {
  const projects = useProjects();
  const tasks = useTasks();
  const milestones = useMilestones();
  const users = useUsers();
  const me = useMe()!;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { setCreateProject } = useUI();
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'table'>(() => (localStorage.getItem('aether-projects-view') as 'grid' | 'table') || 'grid');
  const [filter, setFilter] = useState<'active' | 'mine' | 'all' | 'archived'>('active');
  const [kind, setKind] = useState<string>('all');
  useEffect(() => {
    if (params.get('new')) {
      setCreateProject(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams, setCreateProject]);
  useEffect(() => {
    try {
      localStorage.setItem('aether-projects-view', view);
    } catch {
      /* ignore */
    }
  }, [view]);
  const list = useMemo(
    () =>
      projects
        .filter((p) => (filter === 'archived' ? p.archived : !p.archived))
        .filter((p) => filter !== 'active' || p.status !== 'done')
        .filter((p) => filter !== 'mine' || p.members.includes(me.id) || p.leadId === me.id)
        .filter((p) => kind === 'all' || p.kind === kind)
        .filter((p) => !q || `${p.name} ${p.key} ${p.description}`.toLowerCase().includes(q.toLowerCase()))
        .map((p) => ({ p, s: projectStats(p, tasks, milestones) })),
    [projects, tasks, milestones, filter, kind, q, me.id],
  );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1 className="h-display">Projects</h1>
          <p>Every project has a board, list, timeline, milestones, a repository and its own channel.</p>
        </div>
        {can(me.role, 'lead') && (
          <button className="btn primary" onClick={() => setCreateProject(true)}>
            <Plus /> New project
          </button>
        )}
      </div>
      <div className="row wrap between" style={{ marginBottom: 14 }}>
        <div className="row wrap gap-6">
          <Seg value={filter} onChange={setFilter} options={[{ id: 'active', label: 'Active' }, { id: 'mine', label: 'Mine' }, { id: 'all', label: 'All' }, { id: 'archived', label: 'Archived' }]} />
          <select className="select sm" style={{ width: 150 }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All types</option>
            <option value="engineering">Engineering</option>
            <option value="research">Research</option>
            <option value="competition">Competition</option>
            <option value="operations">Operations</option>
          </select>
          <SearchInput value={q} onChange={setQ} placeholder="Filter projects" />
        </div>
        <Seg value={view} onChange={setView} options={[{ id: 'grid', label: '', icon: <LayoutGrid /> }, { id: 'table', label: '', icon: <List /> }]} />
      </div>
      {!list.length ? (
        <div className="panel">
          <Empty icon={<FolderKanban />} title="No projects here" action={can(me.role, 'lead') ? <button className="btn primary" onClick={() => setCreateProject(true)}>Create a project</button> : undefined}>
            {filter === 'mine' ? 'You are not on any projects yet.' : 'Try another filter.'}
          </Empty>
        </div>
      ) : view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {list.map(({ p, s }) => {
            const due = dueLabel(p.dueDate, p.status === 'done');
            const lead = users.find((u) => u.id === p.leadId);
            return (
              <Link key={p.id} to={`/projects/${p.key}`} className="panel hoverable" style={{ padding: 16, gap: 14 }}>
                <div className="row between start">
                  <div style={{ minWidth: 0 }}>
                    <div className="row gap-6">
                      <span className="swatch" style={{ background: p.color }} />
                      <span className="key">{p.key}</span>
                      <span className="badge">{p.kind}</span>
                    </div>
                    <div className="h2 trunc" style={{ marginTop: 10 }}>{p.name}</div>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <Ring pct={s.pct} size={44} />
                    <span className="mono xs" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{s.pct}</span>
                  </div>
                </div>
                <p className="muted small clamp2" style={{ margin: 0, minHeight: 38 }}>{p.description || 'No description.'}</p>
                <div className="row gap-12 xs muted">
                  <span>
                    <span className="mono t2">{s.open}</span> open
                  </span>
                  <span>
                    <span className="mono t2">{s.doneCount}</span> done
                  </span>
                  {s.overdue > 0 && <span className="red">{s.overdue} late</span>}
                  <span>
                    {s.msDone}/{s.milestones.length} milestones
                  </span>
                  {p.repoFullName && <GitBranch size={12} />}
                </div>
                <hr className="sep" />
                <div className="row between">
                  <div className="row gap-6">
                    <Avatar user={lead} size={20} />
                    <AvatarStack ids={p.members.filter((m) => m !== p.leadId)} size={18} max={4} />
                  </div>
                  <div className="row gap-6">
                    <span className={`badge ${HEALTH[s.health as keyof typeof HEALTH].tone}`}>{p.status === 'active' ? HEALTH[s.health as keyof typeof HEALTH].label : PROJECT_STATUS[p.status]}</span>
                    {p.dueDate && <span className={`xs mono ${due.tone || 'muted'}`}>{due.text}</span>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Project</th>
                <th>Type</th>
                <th>Status</th>
                <th>Lead</th>
                <th>Members</th>
                <th style={{ width: 180 }}>Progress</th>
                <th className="num">Open</th>
                <th>Start</th>
                <th>Deadline</th>
                <th>Repository</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ p, s }) => (
                <tr key={p.id} className="clickable" onClick={() => nav(`/projects/${p.key}`)}>
                  <td>
                    <div className="row">
                      <span className="swatch" style={{ background: p.color }} />
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <span className="key">{p.key}</span>
                    </div>
                  </td>
                  <td className="muted">{p.kind}</td>
                  <td>{PROJECT_STATUS[p.status]}</td>
                  <td>
                    <div className="row gap-6">
                      <Avatar user={users.find((u) => u.id === p.leadId)} size={18} />
                      <span className="small">{users.find((u) => u.id === p.leadId)?.name}</span>
                    </div>
                  </td>
                  <td>
                    <AvatarStack ids={p.members} size={18} />
                  </td>
                  <td>
                    <div className="row">
                      <Bar pct={s.pct} tone="accent" />
                      <span className="mono xs muted">{s.pct}%</span>
                    </div>
                  </td>
                  <td className="num mono">{s.open}</td>
                  <td className="mono xs muted">{fmtDate(p.startDate)}</td>
                  <td className={`mono xs ${dueLabel(p.dueDate, p.status === 'done').tone}`}>{fmtDate(p.dueDate)}</td>
                  <td className="mono xs muted">{p.repoFullName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
