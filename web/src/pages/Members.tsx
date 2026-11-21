import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Grid3x3, Users } from 'lucide-react';
import { useMe, useProjects, useTasks, useUsers } from '../lib/data';
import { ago, can, loadTone, ROLE_LABEL, workload } from '../lib/derive';
import { useUI } from '../lib/store';
import { Avatar, Bar, Empty, SearchInput } from '../components/ui';

export default function Members({ matrix }: { matrix?: boolean }) {
  const users = useUsers();
  const tasks = useTasks();
  const projects = useProjects();
  const me = useMe()!;
  const online = useUI((s) => s.online);
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [minLevel, setMinLevel] = useState(1);
  const [showDisabled, setShowDisabled] = useState(false);
  const allSkills = useMemo(() => {
    const count = new Map<string, number>();
    for (const u of users) for (const s of Object.keys(u.skills)) count.set(s, (count.get(s) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  }, [users]);
  const list = users
    .filter((u) => showDisabled || u.status === 'active')
    .filter((u) => !q || `${u.name} ${u.title} ${u.email} ${Object.keys(u.skills).join(' ')} ${u.responsibilities.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .filter((u) => skills.every((s) => (u.skills[s] ?? 0) >= minLevel));
  const toggleSkill = (s: string) => setSkills((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Team directory</div>
          <h1 className="h-display">Members</h1>
          <p>Profiles, skills, responsibilities and live workload. Assigning a task anywhere updates the numbers here.</p>
        </div>
        <div className="row gap-6">
          <div className="seg">
            <button className={!matrix ? 'on' : ''} onClick={() => nav('/members')}>
              <Users /> Directory
            </button>
            <button className={matrix ? 'on' : ''} onClick={() => nav('/members/skills')}>
              <Grid3x3 /> Skills matrix
            </button>
          </div>
          {can(me.role, 'admin') && (
            <Link to="/settings/team" className="btn primary sm">
              Invite people
            </Link>
          )}
        </div>
      </div>
      <div className="col gap-12" style={{ marginBottom: 14 }}>
        <div className="row wrap gap-6">
          <SearchInput value={q} onChange={setQ} placeholder="Name, title, skill…" />
          {skills.length > 0 && (
            <>
              <span className="xs muted">min level</span>
              <select className="select sm" style={{ width: 70 }} value={minLevel} onChange={(e) => setMinLevel(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <button className="btn ghost sm" onClick={() => setSkills([])}>
                Clear skills
              </button>
            </>
          )}
          {can(me.role, 'admin') && (
            <label className="check small muted" style={{ marginLeft: 'auto' }}>
              <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} /> Show disabled
            </label>
          )}
        </div>
        {allSkills.length > 0 && (
          <div className="row wrap gap-4">
            {allSkills.map((s) => (
              <button key={s} className={`chip${skills.includes(s) ? ' on' : ''}`} onClick={() => toggleSkill(s)}>
                {s} <span className="mono faint">{users.filter((u) => u.skills[s]).length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {matrix ? (
        <SkillsMatrix users={list} skills={skills.length ? skills : allSkills} selected={skills} onToggle={toggleSkill} />
      ) : list.length ? (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Top skills</th>
                <th>Projects</th>
                <th style={{ width: 200 }}>Workload</th>
                <th className="num">Open</th>
                <th className="num">Done</th>
                <th className="num">On time</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => {
                const w = workload(u, tasks);
                const mine = projects.filter((p) => !p.archived && p.members.includes(u.id));
                const top = Object.entries(u.skills)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3);
                return (
                  <tr key={u.id} className="clickable" onClick={() => nav(`/members/${u.id}`)} style={{ opacity: u.status === 'disabled' ? 0.5 : 1 }}>
                    <td>
                      <div className="row">
                        <Avatar user={u} size={28} online={online.includes(u.id)} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{u.name}</div>
                          <div className="xs muted">{u.title || u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge${u.role === 'owner' || u.role === 'admin' ? ' accent' : ''}`}>{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td>
                      <div className="row gap-4">
                        {top.map(([s, l]) => (
                          <span key={s} className="tag">
                            {s}·{l}
                          </span>
                        ))}
                        {!top.length && <span className="faint xs">—</span>}
                      </div>
                    </td>
                    <td>
                      <div className="row gap-4">
                        {mine.slice(0, 4).map((p) => (
                          <span key={p.id} className="swatch" style={{ background: p.color }} title={p.name} />
                        ))}
                        <span className="xs muted">{mine.length}</span>
                      </div>
                    </td>
                    <td>
                      <div className="row">
                        <Bar pct={w.load} tone={w.load > 100 ? 'over' : w.load > 80 ? 'warn' : 'accent'} />
                        <span className={`mono xs ${loadTone(w.load)}`} style={{ width: 38, textAlign: 'right' }}>
                          {w.load}%
                        </span>
                      </div>
                    </td>
                    <td className="num mono">{w.open}</td>
                    <td className="num mono">{w.done}</td>
                    <td className="num mono muted">{w.onTime !== null ? `${w.onTime}%` : '—'}</td>
                    <td className="xs muted">{online.includes(u.id) ? <span className="green">Online</span> : ago(u.lastSeenAt) || 'never'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <Empty title="Nobody matches">Try fewer skills or a lower level.</Empty>
        </div>
      )}
      {!matrix && <div className="xs faint" style={{ marginTop: 10 }}>Workload = points of active (non-backlog) open tasks ÷ weekly capacity. Edit capacity on a profile.</div>}
    </div>
  );
}

function SkillsMatrix({ users, skills, selected, onToggle }: { users: ReturnType<typeof useUsers>; skills: string[]; selected: string[]; onToggle: (s: string) => void }) {
  const nav = useNavigate();
  if (!skills.length)
    return (
      <div className="panel">
        <Empty title="No skills recorded yet">Each member adds skills (1–5) on their profile. They appear here as a matrix you can filter.</Empty>
      </div>
    );
  const shade = (l: number) => (l ? `color-mix(in srgb, var(--accent) ${l * 19}%, var(--panel-2))` : 'transparent');
  return (
    <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
      <table className="matrix">
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--panel-2)', textAlign: 'left', padding: '0 10px 10px', verticalAlign: 'bottom' }}>
              <span className="eyebrow">{users.length} people × {skills.length} skills</span>
            </th>
            {skills.map((s) => (
              <th key={s} className={selected.includes(s) ? 'on' : ''} onClick={() => onToggle(s)}>
                <div className="vlabel">{s}</div>
              </th>
            ))}
            <th style={{ verticalAlign: 'bottom', padding: '0 10px 10px' }}>
              <span className="eyebrow">Breadth</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <th onClick={() => nav(`/members/${u.id}`)} style={{ cursor: 'pointer' }}>
                <div className="row">
                  <Avatar user={u} size={22} />
                  <div style={{ minWidth: 0 }}>
                    <div className="small trunc">{u.name}</div>
                    <div className="xs faint trunc">{u.title}</div>
                  </div>
                </div>
              </th>
              {skills.map((s) => {
                const l = u.skills[s] ?? 0;
                return (
                  <td key={s} className="lvl">
                    <div className="cell" style={{ background: shade(l), color: l >= 3 ? 'var(--accent-ink)' : 'var(--text-2)' }} title={`${u.name} · ${s}: ${l || 'none'}`}>
                      {l || ''}
                    </div>
                  </td>
                );
              })}
              <td className="mono xs muted">{Object.keys(u.skills).length}</td>
            </tr>
          ))}
          <tr>
            <th className="xs muted">Coverage (people at ≥3)</th>
            {skills.map((s) => {
              const n = users.filter((u) => (u.skills[s] ?? 0) >= 3).length;
              return (
                <td key={s} className="lvl mono xs" style={{ color: n === 0 ? 'var(--red)' : n === 1 ? 'var(--amber)' : 'var(--text-2)' }} title={n <= 1 ? 'Single point of failure' : undefined}>
                  {n}
                </td>
              );
            })}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
