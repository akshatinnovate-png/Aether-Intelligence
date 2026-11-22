import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, startOfWeek } from 'date-fns';
import { Award, GitBranch, KeyRound, Mail, MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { destroy, save, useAchievements, useCompetitions, useMe, useProjects, useTasks, useUsers } from '../lib/data';
import { ago, can, collapseActivity, dueLabel, fmtDate, loadTone, RANK, ROLE_DESC, ROLE_LABEL, SKILL_SUGGESTIONS, workload } from '../lib/derive';
import { toast, toastError, useUI } from '../lib/store';
import { Avatar, Bar, confirmDialog, Empty, Field, Modal, PriorityIcon, StatusIcon } from '../components/ui';
import { AVATAR_COLORS } from './settings/colors';
import type { Activity, Role, User } from '../types';

export default function MemberProfile() {
  const { id } = useParams();
  const users = useUsers();
  const tasks = useTasks();
  const projects = useProjects();
  const comps = useCompetitions();
  const achievements = useAchievements();
  const me = useMe()!;
  const nav = useNavigate();
  const online = useUI((s) => s.online);
  const u = users.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [award, setAward] = useState(false);
  const activity = useQuery({ queryKey: ['user-activity', id], queryFn: () => api.get<Activity[]>(`/api/users/${id}/activity`), enabled: !!id }).data ?? [];
  const heat = useMemo(() => {
    const start = startOfWeek(addDays(new Date(), -7 * 15), { weekStartsOn: 1 });
    const days = [...Array(16 * 7)].map((_, i) => format(addDays(start, i), 'yyyy-MM-dd'));
    const counts = new Map<string, number>();
    for (const t of tasks) if (t.assigneeId === id && t.completedAt) counts.set(t.completedAt.slice(0, 10), (counts.get(t.completedAt.slice(0, 10)) ?? 0) + 1);
    for (const a of activity) counts.set(a.createdAt.slice(0, 10), (counts.get(a.createdAt.slice(0, 10)) ?? 0) + 0.34);
    return days.map((d) => ({ d, n: counts.get(d) ?? 0 }));
  }, [tasks, activity, id]);
  if (!u) return <div className="page">{users.length ? <Empty title="Member not found" /> : null}</div>;
  const w = workload(u, tasks);
  const self = u.id === me.id;
  const canEdit = self || can(me.role, 'admin');
  const memberOf = projects.filter((p) => p.members.includes(u.id) && !p.archived);
  const open = w.tasks.filter((t) => t.status !== 'done').sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  const myComps = comps.filter((c) => c.members.includes(u.id));
  const mine = achievements.filter((a) => a.userId === u.id);
  // Derived achievements: earned automatically from real work.
  const auto: { title: string; detail: string }[] = [];
  if (w.done >= 1) auto.push({ title: 'First task shipped', detail: 'Completed a task' });
  for (const n of [10, 25, 50, 100, 250]) if (w.done >= n) auto.push({ title: `${n} tasks completed`, detail: 'Delivery milestone' });
  if (w.onTime !== null && w.done >= 10 && w.onTime >= 90) auto.push({ title: 'Reliable', detail: `${w.onTime}% of tasks on time` });
  if (memberOf.filter((p) => p.leadId === u.id).length) auto.push({ title: 'Project lead', detail: memberOf.filter((p) => p.leadId === u.id).map((p) => p.name).join(', ') });
  if (Object.values(u.skills).filter((l) => l >= 4).length >= 3) auto.push({ title: 'Multi-disciplinary', detail: '3+ skills at level 4–5' });
  const canManage = can(me.role, 'admin') && !self && u.role !== 'owner' && !(me.role === 'admin' && u.role === 'admin');
  const dm = async () => {
    const r = await api.post<{ id: string }>('/api/dm', { userIds: [u.id] });
    nav(`/chat/${r.id}`);
  };
  return (
    <div className="page">
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div className="row gap-16 start">
          <Avatar user={u} size={72} online={online.includes(u.id)} square />
          <div>
            <div className="eyebrow">{ROLE_LABEL[u.role]}{u.status === 'disabled' ? ' · Disabled' : ''}</div>
            <h1 className="h-display" style={{ marginTop: 6 }}>{u.name}</h1>
            <div className="row gap-12 small muted" style={{ marginTop: 8 }}>
              {u.title && <span className="t2">{u.title}</span>}
              <a href={`mailto:${u.email}`} className="row gap-4">
                <Mail size={13} /> {u.email}
              </a>
              {u.githubLogin && (
                <a href={`https://github.com/${u.githubLogin}`} target="_blank" rel="noreferrer" className="row gap-4">
                  <GitBranch size={13} /> @{u.githubLogin}
                </a>
              )}
              <span>{online.includes(u.id) ? <span className="green">● Online</span> : `Seen ${ago(u.lastSeenAt) || 'never'}`}</span>
            </div>
            {u.bio && <p style={{ maxWidth: 640, color: 'var(--text-2)' }}>{u.bio}</p>}
          </div>
        </div>
        <div className="row gap-6 wrap">
          {!self && (
            <button className="btn sm" onClick={dm}>
              <MessageSquare /> Message
            </button>
          )}
          {canEdit && (
            <button className="btn sm" onClick={() => setEdit(true)}>
              <Pencil /> Edit profile
            </button>
          )}
          {can(me.role, 'lead') && (
            <button className="btn sm" onClick={() => setAward(true)}>
              <Award /> Recognise
            </button>
          )}
          {can(me.role, 'admin') && !self && (u.role !== 'owner' || me.role === 'owner') && (
            <button
              className="btn ghost sm"
              onClick={async () => {
                try {
                  const r = await api.post<{ link: string; emailStatus: string }>(`/api/users/${u.id}/reset-link`);
                  await navigator.clipboard.writeText(r.link).catch(() => {});
                  toast({ title: r.emailStatus === 'sent' ? `Reset link emailed to ${u.email}` : 'Reset link copied to clipboard', body: r.emailStatus === 'sent' ? undefined : 'Email is not configured; send it yourself.' });
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              <KeyRound /> Reset password
            </button>
          )}
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 12 }}>
        <div className="stat">
          <div className="eyebrow">Workload</div>
          <div className={`v ${loadTone(w.load)}`}>{w.load}%</div>
          <div className="d">
            {w.points}/{u.capacity} pts per week
          </div>
        </div>
        <div className="stat">
          <div className="eyebrow">Open tasks</div>
          <div className="v">{w.open}</div>
          <div className="d">{w.dueSoon} due within 7 days</div>
        </div>
        <div className={`stat${w.overdue ? ' alert' : ''}`}>
          <div className="eyebrow">Overdue</div>
          <div className="v">{w.overdue}</div>
          <div className="d">needs attention</div>
        </div>
        <div className="stat">
          <div className="eyebrow">Completed</div>
          <div className="v">{w.done}</div>
          <div className="d">{w.done30} in last 30 days</div>
        </div>
        <div className="stat">
          <div className="eyebrow">Completion</div>
          <div className="v">{w.completion}%</div>
          <div className="d">of all assigned</div>
        </div>
        <div className="stat">
          <div className="eyebrow">On time</div>
          <div className="v">{w.onTime ?? '—'}{w.onTime !== null ? '%' : ''}</div>
          <div className="d">of completed</div>
        </div>
      </div>

      <div className="dash">
        <section className="panel span-8">
          <div className="panel-head">
            <span className="eyebrow grow">Open work</span>
          </div>
          <div className="list">
            {open.map((t) => {
              const p = projects.find((x) => x.id === t.projectId);
              const due = dueLabel(t.dueDate);
              return (
                <Link key={t.id} to={`?task=${t.id}`} className="li">
                  <StatusIcon status={t.status} />
                  <PriorityIcon p={t.priority} />
                  <span className="swatch" style={{ background: p?.color }} />
                  <span className="key">{p?.key}-{t.number}</span>
                  <span className="small trunc grow">{t.title}</span>
                  <span className="mono xs faint">{t.estimate}p</span>
                  {due.text && <span className={`xs ${due.tone || 'muted'}`} style={{ width: 80, textAlign: 'right' }}>{due.text}</span>}
                </Link>
              );
            })}
            {!open.length && <div className="empty">No open tasks.</div>}
          </div>
        </section>
        <section className="panel span-4">
          <div className="panel-head">
            <span className="eyebrow grow">Skills</span>
          </div>
          <div className="panel-body col gap-8">
            {Object.entries(u.skills)
              .sort((a, b) => b[1] - a[1])
              .map(([s, l]) => (
                <div key={s} className="row">
                  <span className="small" style={{ width: 130 }}>{s}</span>
                  <div className="row gap-2 grow">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n} style={{ height: 6, flex: 1, background: n <= l ? 'var(--accent)' : 'var(--line)' }} />
                    ))}
                  </div>
                  <span className="mono xs muted">{l}</span>
                </div>
              ))}
            {!Object.keys(u.skills).length && <span className="faint small">No skills listed{canEdit ? ' — add them via Edit profile.' : '.'}</span>}
            {u.responsibilities.length > 0 && (
              <>
                <hr className="sep" style={{ margin: '6px 0' }} />
                <span className="eyebrow">Responsibilities</span>
                <div className="row wrap gap-4">
                  {u.responsibilities.map((r) => (
                    <span key={r} className="badge">
                      {r}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
        <section className="panel span-4">
          <div className="panel-head">
            <span className="eyebrow grow">Projects · {memberOf.length}</span>
          </div>
          <div className="list">
            {memberOf.map((p) => (
              <Link key={p.id} to={`/projects/${p.key}`} className="li">
                <span className="swatch" style={{ background: p.color }} />
                <span className="small grow trunc">{p.name}</span>
                {p.leadId === u.id && <span className="badge accent">Lead</span>}
                <span className="mono xs muted">{tasks.filter((t) => t.projectId === p.id && t.assigneeId === u.id && t.status !== 'done').length}</span>
              </Link>
            ))}
            {myComps.map((c) => (
              <Link key={c.id} to={`/competitions?c=${c.id}`} className="li">
                <span className="xs faint">Competition</span>
                <span className="small grow trunc">{c.name}</span>
              </Link>
            ))}
            {!memberOf.length && !myComps.length && <div className="empty">Not on any project.</div>}
          </div>
        </section>
        <section className="panel span-4">
          <div className="panel-head">
            <span className="eyebrow grow">Achievements</span>
          </div>
          <div className="list">
            {mine.map((a) => (
              <div key={a.id} className="li">
                <Award size={14} className="accent-text" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small">{a.title}</div>
                  <div className="xs faint">{fmtDate(a.date, 'd MMM yyyy')}{a.description ? ` · ${a.description}` : ''}</div>
                </div>
                {can(me.role, 'lead') && (
                  <button className="btn ghost icon xs" onClick={() => destroy('achievements', `/api/achievements/${a.id}`, a.id).catch(toastError)} title="Remove">
                    <X />
                  </button>
                )}
              </div>
            ))}
            {auto.map((a) => (
              <div key={a.title} className="li">
                <span className="swatch" style={{ background: 'var(--line-strong)' }} />
                <div className="grow">
                  <div className="small">{a.title}</div>
                  <div className="xs faint">{a.detail}</div>
                </div>
                <span className="xs faint">auto</span>
              </div>
            ))}
            {!mine.length && !auto.length && <div className="empty">Achievements appear as work ships.</div>}
          </div>
        </section>
        <section className="panel span-4">
          <div className="panel-head">
            <span className="eyebrow grow">Contribution · 16 weeks</span>
          </div>
          <div className="panel-body">
            <div className="heat" style={{ gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gridAutoColumns: '1fr' }}>
              {heat.map((h) => (
                <i key={h.d} title={`${h.d}: ${Math.round(h.n)}`} style={{ background: h.n ? `color-mix(in srgb, var(--accent) ${Math.min(100, 25 + h.n * 25)}%, var(--panel-2))` : undefined }} />
              ))}
            </div>
          </div>
        </section>
        <section className="panel span-12">
          <div className="panel-head">
            <span className="eyebrow grow">Activity history</span>
          </div>
          <div className="list" style={{ maxHeight: 360, overflow: 'auto' }}>
            {collapseActivity(activity).map((a) => (
              <div key={a.id} className="li small">
                <span className="mono xs faint" style={{ width: 110 }}>{fmtDate(a.createdAt, 'd MMM HH:mm')}</span>
                <span className="t2 trunc grow">{a.summary}</span>
              </div>
            ))}
            {!activity.length && <div className="empty">No activity yet.</div>}
          </div>
        </section>
        {canManage && <AdminPanel u={u} meRole={me.role} />}
      </div>
      {edit && <EditProfile u={u} onClose={() => setEdit(false)} />}
      {award && <AwardModal u={u} onClose={() => setAward(false)} />}
    </div>
  );
}

function AdminPanel({ u, meRole }: { u: User; meRole: Role }) {
  const roles: Role[] = meRole === 'owner' ? ['admin', 'lead', 'member', 'guest'] : ['lead', 'member', 'guest'];
  return (
    <section className="panel span-12">
      <div className="panel-head">
        <span className="eyebrow grow">Administration</span>
      </div>
      <div className="panel-body col gap-12">
        <div className="row wrap gap-6">
          {roles.map((r) => (
            <button
              key={r}
              className={`btn sm${u.role === r ? ' on' : ''}`}
              onClick={async () => {
                if (u.role === r) return;
                if (RANK[r] >= RANK.admin && !(await confirmDialog(`Make ${u.name} an administrator?`, ROLE_DESC.admin, { ok: 'Make administrator' }))) return;
                save('users', `/api/users/${u.id}`, 'patch', { role: r }).then(() => toast({ title: `${u.name} is now ${ROLE_LABEL[r]}` }), toastError);
              }}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
          <span className="grow" />
          <button
            className={`btn sm ${u.status === 'active' ? 'danger' : ''}`}
            onClick={async () => {
              const next = u.status === 'active' ? 'disabled' : 'active';
              if (next === 'disabled' && !(await confirmDialog(`Disable ${u.name}?`, 'They are signed out everywhere and cannot sign in. Their work stays.', { danger: true, ok: 'Disable' }))) return;
              save('users', `/api/users/${u.id}`, 'patch', { status: next }).catch(toastError);
            }}
          >
            {u.status === 'active' ? 'Disable account' : 'Re-enable account'}
          </button>
        </div>
        <div className="xs muted">{ROLE_DESC[u.role]}</div>
      </div>
    </section>
  );
}

function EditProfile({ u, onClose }: { u: User; onClose: () => void }) {
  const me = useMe()!;
  const [f, setF] = useState({ name: u.name, title: u.title, bio: u.bio, avatarColor: u.avatarColor, capacity: u.capacity, skills: { ...u.skills }, responsibilities: [...u.responsibilities] });
  const [skill, setSkill] = useState('');
  const [resp, setResp] = useState('');
  const submit = async () => {
    try {
      await save('users', `/api/users/${u.id}`, 'patch', f);
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  const addSkill = (s: string) => {
    const name = s.trim();
    if (name && !f.skills[name]) setF({ ...f, skills: { ...f.skills, [name]: 3 } });
    setSkill('');
  };
  return (
    <Modal title={u.id === me.id ? 'Edit your profile' : `Edit ${u.name}`} size="lg" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>Save profile</button></>}>
      <div className="grid-2">
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Title">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="ML Engineer" />
        </Field>
      </div>
      <Field label="Bio">
        <textarea className="textarea" value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label="Weekly capacity (points)" hint="Workload % is measured against this.">
          <input type="number" min={1} max={200} className="input" value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} />
        </Field>
        <Field label="Avatar colour">
          <div className="row gap-4 wrap" style={{ minHeight: 32 }}>
            {AVATAR_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setF({ ...f, avatarColor: c })} style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: f.avatarColor === c ? '2px solid var(--text)' : '1px solid var(--line)', cursor: 'pointer' }} aria-label={c} />
            ))}
          </div>
        </Field>
      </div>
      <Field label="Skills (level 1–5)">
        <div className="col gap-6">
          {Object.entries(f.skills).map(([s, l]) => (
            <div key={s} className="row">
              <span className="small" style={{ width: 160 }}>{s}</span>
              <div className="row gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setF({ ...f, skills: { ...f.skills, [s]: n } })} style={{ width: 26, height: 18, border: '1px solid var(--line-2)', background: n <= l ? 'var(--accent)' : 'var(--panel-2)', cursor: 'pointer' }} aria-label={`${s} level ${n}`} />
                ))}
              </div>
              <button
                className="btn ghost icon xs"
                onClick={() => {
                  const next = { ...f.skills };
                  delete next[s];
                  setF({ ...f, skills: next });
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))}
          <div className="row gap-6">
            <input className="input sm" style={{ width: 200 }} list="skill-suggest" value={skill} onChange={(e) => setSkill(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSkill(skill))} placeholder="Add a skill" />
            <datalist id="skill-suggest">
              {SKILL_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <button className="btn sm" onClick={() => addSkill(skill)}>
              <Plus /> Add
            </button>
          </div>
        </div>
      </Field>
      <Field label="Responsibilities">
        <div className="row wrap gap-4">
          {f.responsibilities.map((r) => (
            <span key={r} className="badge" style={{ cursor: 'pointer' }} onClick={() => setF({ ...f, responsibilities: f.responsibilities.filter((x) => x !== r) })}>
              {r} <X size={10} />
            </span>
          ))}
          <input
            className="input sm"
            style={{ width: 200 }}
            value={resp}
            placeholder="e.g. Infra, code reviews — Enter"
            onChange={(e) => setResp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && resp.trim()) {
                e.preventDefault();
                setF({ ...f, responsibilities: [...f.responsibilities, resp.trim()] });
                setResp('');
              }
            }}
          />
        </div>
      </Field>
    </Modal>
  );
}

function AwardModal({ u, onClose }: { u: User; onClose: () => void }) {
  const [f, setF] = useState({ title: '', description: '', date: new Date().toISOString().slice(0, 10), kind: 'award' });
  return (
    <Modal
      title={`Recognise ${u.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!f.title.trim()} onClick={() => save('achievements', '/api/achievements', 'post', { ...f, userId: u.id }).then(onClose, toastError)}>
            Award
          </button>
        </>
      }
    >
      <Field label="Title">
        <input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Shipped Saathi-Alexa beta" />
      </Field>
      <Field label="Details">
        <textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label="Date">
          <input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Kind">
          <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="award">Award</option>
            <option value="publication">Publication</option>
            <option value="competition">Competition</option>
            <option value="certification">Certification</option>
            <option value="milestone">Milestone</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
