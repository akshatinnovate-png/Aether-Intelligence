import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, ExternalLink, FolderPlus, List, Plus, Trash2, Trophy, X } from 'lucide-react';
import { destroy, save, useCompetitions, useMe, useProjects } from '../lib/data';
import { countdown, d, fmtDate, fmtDateTime, fromLocalInput, STAGE_LABEL, STAGES, toLocalInput, today } from '../lib/derive';
import { toast, toastError } from '../lib/store';
import { AvatarStack, Bar, confirmDialog, Drawer, Empty, Field, Modal, MultiUserPicker, Seg } from '../components/ui';
import { Markdown } from '../components/Markdown';
import type { Competition, Stage } from '../types';

export default function Competitions() {
  const comps = useCompetitions();
  const me = useMe()!;
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'pipeline' | 'calendar' | 'table'>('pipeline');
  const [adding, setAdding] = useState(false);
  const open = params.get('c');
  const openC = (id: string) => {
    params.set('c', id);
    setParams(params);
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Discovery → result</div>
          <h1 className="h-display">Competitions</h1>
          <p>
            <span className="mono">DISCOVERED → REGISTERED → BUILDING → SUBMITTED → FINALIST → RESULT</span>. Deadlines flow into the calendar, the dashboard and team notifications.
          </p>
        </div>
        <div className="row gap-6">
          <Seg value={view} onChange={setView} options={[{ id: 'pipeline', label: 'Pipeline', icon: <Columns3 /> }, { id: 'calendar', label: 'Calendar', icon: <CalendarDays /> }, { id: 'table', label: 'Table', icon: <List /> }]} />
          {me.role !== 'guest' && (
            <button className="btn primary sm" onClick={() => setAdding(true)}>
              <Plus /> Competition
            </button>
          )}
        </div>
      </div>
      {!comps.length ? (
        <div className="panel">
          <Empty icon={<Trophy />} title="No competitions tracked" action={me.role !== 'guest' ? <button className="btn primary" onClick={() => setAdding(true)}>Track a competition</button> : undefined}>
            Add one the moment you discover it; the team, deadlines and requirements follow it to the result.
          </Empty>
        </div>
      ) : view === 'pipeline' ? (
        <div className="pipeline">
          {STAGES.map((s, i) => {
            const items = comps.filter((c) => c.stage === s.id).sort((a, b) => (a.deadline ?? '9').localeCompare(b.deadline ?? '9'));
            return (
              <div key={s.id} className="panel" style={{ minHeight: 200 }}>
                <div className="stage-head">
                  <span className="mono xs faint">{String(i + 1).padStart(2, '0')}</span>
                  <span className="eyebrow" style={{ color: 'var(--text-2)' }}>{s.label}</span>
                  <span className="mono xs muted" style={{ marginLeft: 'auto' }}>{items.length}</span>
                </div>
                <div className="col gap-6" style={{ padding: 8 }}>
                  {items.map((c) => (
                    <CompCard key={c.id} c={c} onOpen={() => openC(c.id)} />
                  ))}
                  {!items.length && <div className="xs faint" style={{ padding: 10, textAlign: 'center' }}>—</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : view === 'calendar' ? (
        <CompCalendar comps={comps} onOpen={openC} />
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Competition</th>
                <th>Organizer</th>
                <th>Stage</th>
                <th>Team</th>
                <th style={{ width: 160 }}>Requirements</th>
                <th>Registration</th>
                <th>Deadline</th>
                <th>Countdown</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {[...comps]
                .sort((a, b) => (a.deadline ?? '9').localeCompare(b.deadline ?? '9'))
                .map((c) => {
                  const cd = countdown(c.deadline);
                  const req = c.requirements.length ? Math.round((c.requirements.filter((r) => r.done).length / c.requirements.length) * 100) : 0;
                  return (
                    <tr key={c.id} className="clickable" onClick={() => openC(c.id)}>
                      <td style={{ fontWeight: 500 }}>{c.name}</td>
                      <td className="muted">{c.organizer}</td>
                      <td>
                        <span className="badge mono">{STAGE_LABEL[c.stage]}</span>
                      </td>
                      <td>
                        <AvatarStack ids={c.members} size={18} />
                      </td>
                      <td>
                        <div className="row">
                          <Bar pct={req} tone="accent" />
                          <span className="mono xs muted">{c.requirements.filter((r) => r.done).length}/{c.requirements.length}</span>
                        </div>
                      </td>
                      <td className="mono xs muted">{fmtDate(c.registrationDeadline)}</td>
                      <td className="mono xs">{fmtDateTime(c.deadline)}</td>
                      <td className={`mono xs ${cd && !cd.past && cd.days < 3 ? 'red' : 'muted'}`}>{cd?.text ?? '—'}</td>
                      <td className="small">{c.outcome ? <span className={`badge ${c.outcome === 'won' ? 'solid' : c.outcome === 'not_selected' ? '' : 'accent'}`}>{c.outcome.replace('_', ' ')}</span> : '—'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      {open && <CompDrawer id={open} onClose={() => (params.delete('c'), setParams(params))} />}
      {adding && <CompForm onClose={() => setAdding(false)} onCreated={(id) => openC(id)} />}
    </div>
  );
}

function CompCard({ c, onOpen }: { c: Competition; onOpen: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const target = c.stage === 'discovered' && c.registrationDeadline ? c.registrationDeadline : c.deadline;
  const cd = countdown(target);
  const req = c.requirements.length ? Math.round((c.requirements.filter((r) => r.done).length / c.requirements.length) * 100) : null;
  const closed = ['submitted', 'finalist', 'result'].includes(c.stage);
  return (
    <div className="panel hoverable comp-card" onClick={onOpen}>
      <div className="small" style={{ fontWeight: 500, lineHeight: 1.35 }}>{c.name}</div>
      <div className="xs muted trunc">{c.organizer || '—'}</div>
      {!closed && cd && (
        <div className="row between">
          <span className={`countdown ${cd.past ? 'faint' : cd.days < 3 ? 'red' : ''}`} style={{ fontSize: 22 }}>
            {cd.text}
          </span>
          <span className="xs faint">{c.stage === 'discovered' ? 'to register' : 'to submit'}</span>
        </div>
      )}
      {c.outcome && <span className={`badge ${c.outcome === 'won' ? 'solid' : 'accent'}`} style={{ alignSelf: 'flex-start' }}>{c.outcome.replace('_', ' ')}</span>}
      {req !== null && (
        <div className="row">
          <Bar pct={req} tone="accent" />
          <span className="mono xs muted">{req}%</span>
        </div>
      )}
      <AvatarStack ids={c.members} size={18} />
    </div>
  );
}

function CompCalendar({ comps, onOpen }: { comps: Competition[]; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const days = eachDayOfInterval({ start: startOfWeek(month, { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) });
  const items = comps.flatMap((c) => [
    c.registrationDeadline && { c, date: c.registrationDeadline, label: 'Registration', color: 'var(--amber)' },
    c.deadline && { c, date: c.deadline, label: 'Submission', color: 'var(--red)' },
    c.eventDate && { c, date: c.eventDate, label: 'Event', color: 'var(--blue)' },
  ]).filter(Boolean) as { c: Competition; date: string; label: string; color: string }[];
  return (
    <div className="panel">
      <div className="panel-head">
        <button className="btn ghost icon sm" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft />
        </button>
        <span className="h2" style={{ fontSize: 17 }}>{format(month, 'MMMM yyyy')}</span>
        <button className="btn ghost icon sm" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight />
        </button>
        <button className="btn ghost sm" onClick={() => setMonth(startOfMonth(new Date()))}>
          Today
        </button>
      </div>
      <div className="cal" style={{ borderLeft: 0 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => (
          <div key={x} className="cal-dow eyebrow">{x}</div>
        ))}
        {days.map((day) => {
          const k = format(day, 'yyyy-MM-dd');
          const evs = items.filter((i) => format(d(i.date)!, 'yyyy-MM-dd') === k);
          return (
            <div key={k} className={`cal-day${isSameMonth(day, month) ? '' : ' other'}${k === today() ? ' today' : ''}`} style={{ minHeight: 96 }}>
              <span className="cal-num">{format(day, 'd')}</span>
              {evs.map((e, i) => (
                <div key={i} className="cal-ev" style={{ '--c': e.color } as React.CSSProperties} onClick={() => onOpen(e.c.id)} title={`${e.c.name} — ${e.label}`}>
                  {e.label[0]} · {e.c.name}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const comps = useCompetitions();
  const projects = useProjects();
  const me = useMe()!;
  const c = comps.find((x) => x.id === id);
  const [req, setReq] = useState('');
  const [link, setLink] = useState({ label: '', url: '' });
  const [editing, setEditing] = useState(false);
  if (!c) return <Drawer onClose={onClose} head={<span className="muted">Competition</span>}><div className="empty">Not found.</div></Drawer>;
  const set = (patch: Partial<Competition>) => save('competitions', `/api/competitions/${c.id}`, 'patch', patch).catch(toastError);
  const editable = me.role !== 'guest';
  const stageIdx = STAGES.findIndex((s) => s.id === c.stage);
  const cd = countdown(c.deadline);
  const rcd = countdown(c.registrationDeadline);
  const done = c.requirements.filter((r) => r.done).length;
  const proj = projects.find((p) => p.id === c.projectId);
  const createProject = async () => {
    try {
      const p = await save('projects', '/api/projects', 'post', {
        name: c.name.replace(/^Sample:\s*/, ''),
        kind: 'competition',
        priority: 'high',
        description: `Competition entry for **${c.name}**${c.organizer ? ` (${c.organizer})` : ''}.\n\n${c.description}`,
        dueDate: c.deadline?.slice(0, 10) ?? null,
        members: c.members,
      });
      await set({ projectId: p.id });
      // Each open requirement becomes a task.
      for (const r of c.requirements.filter((x) => !x.done)) await save('tasks', '/api/tasks', 'post', { projectId: p.id, title: r.text, dueDate: c.deadline?.slice(0, 10) ?? null, priority: 'high' });
      toast({ title: `Project ${p.name} created`, body: `${c.requirements.filter((x) => !x.done).length} requirements became tasks.`, link: `/projects/${p.key}` });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Drawer
      wide
      onClose={onClose}
      head={
        <>
          <Trophy size={15} className="muted" />
          <span className="small muted">Competition</span>
          <div className="grow" />
          {c.url && (
            <a className="btn ghost sm" href={c.url} target="_blank" rel="noreferrer">
              <ExternalLink /> Website
            </a>
          )}
          {editable && (
            <>
              <button className="btn ghost sm" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button
                className="btn ghost icon sm"
                onClick={async () => {
                  if (await confirmDialog(`Delete ${c.name}?`, undefined, { danger: true, ok: 'Delete' })) {
                    await destroy('competitions', `/api/competitions/${c.id}`, c.id).catch(toastError);
                    onClose();
                  }
                }}
              >
                <Trash2 />
              </button>
            </>
          )}
        </>
      }
    >
      <div style={{ padding: '22px 26px 40px' }} className="col gap-24">
        <div>
          <div className="eyebrow">{c.organizer || 'Organizer unknown'}</div>
          <h2 className="h1" style={{ marginTop: 8 }}>{c.name}</h2>
          {c.prize && <div className="small accent-text" style={{ marginTop: 6 }}>Prize: {c.prize}</div>}
        </div>
        <div className="stepper">
          {STAGES.map((s, i) => (
            <button key={s.id} className={`step${i < stageIdx ? ' done' : i === stageIdx ? ' cur' : ''}`} disabled={!editable} onClick={() => set({ stage: s.id as Stage })}>
              <span className="n">{i + 1}</span>
              {s.label}
            </button>
          ))}
        </div>
        <div className="grid-3">
          <div className="panel" style={{ padding: 14 }}>
            <div className="eyebrow">Registration</div>
            <div className={`countdown`} style={{ marginTop: 10, fontSize: 22 }}>{c.stage !== 'discovered' ? 'Done' : rcd?.text ?? '—'}</div>
            <div className="xs muted" style={{ marginTop: 4 }}>{fmtDateTime(c.registrationDeadline)}</div>
          </div>
          <div className="panel" style={{ padding: 14, borderColor: cd && !cd.past && cd.days < 3 ? 'var(--red)' : undefined }}>
            <div className="eyebrow">Submission</div>
            <div className={`countdown ${cd && !cd.past && cd.days < 3 ? 'red' : ''}`} style={{ marginTop: 10 }}>{['submitted', 'finalist', 'result'].includes(c.stage) ? 'Submitted' : cd?.text ?? '—'}</div>
            <div className="xs muted" style={{ marginTop: 4 }}>{fmtDateTime(c.deadline)}</div>
          </div>
          <div className="panel" style={{ padding: 14 }}>
            <div className="eyebrow">Readiness</div>
            <div className="countdown" style={{ marginTop: 10 }}>{c.requirements.length ? Math.round((done / c.requirements.length) * 100) : 0}%</div>
            <div className="xs muted" style={{ marginTop: 4 }}>
              {done}/{c.requirements.length} requirements
            </div>
          </div>
        </div>
        {c.description && <Markdown text={c.description} />}
        <section className="grid-2">
          <Field label="Team">
            <MultiUserPicker value={c.members} disabled={!editable} onChange={(members) => set({ members } as Partial<Competition>)} label="Add team members" />
          </Field>
          <Field label="Project">
            {proj ? (
              <Link to={`/projects/${proj.key}`} className="btn sm" style={{ alignSelf: 'flex-start' }}>
                <span className="swatch" style={{ background: proj.color }} />
                {proj.name}
              </Link>
            ) : editable ? (
              <div className="row gap-6">
                <select className="select sm" value="" onChange={(e) => e.target.value && set({ projectId: e.target.value })}>
                  <option value="">Link existing…</option>
                  {projects.filter((p) => !p.archived).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {(me.role === 'owner' || me.role === 'admin' || me.role === 'lead') && (
                  <button className="btn sm" onClick={createProject} title="Create a project; open requirements become tasks">
                    <FolderPlus /> New
                  </button>
                )}
              </div>
            ) : (
              <span className="faint small">—</span>
            )}
          </Field>
        </section>
        <section>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Requirements</div>
          <div className="panel">
            <div className="list">
              {c.requirements.map((r) => (
                <div key={r.id} className="li">
                  <label className="check grow">
                    <input type="checkbox" disabled={!editable} checked={r.done} onChange={() => set({ requirements: c.requirements.map((x) => (x.id === r.id ? { ...x, done: !x.done } : x)) })} />
                    <span className="small" style={{ textDecoration: r.done ? 'line-through' : undefined, color: r.done ? 'var(--muted)' : undefined }}>{r.text}</span>
                  </label>
                  {editable && (
                    <button className="btn ghost icon xs" onClick={() => set({ requirements: c.requirements.filter((x) => x.id !== r.id) })}>
                      <X />
                    </button>
                  )}
                </div>
              ))}
              {editable && (
                <div className="li">
                  <input
                    className="input bare sm grow"
                    placeholder="+ Add a requirement (Enter)"
                    value={req}
                    onChange={(e) => setReq(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && req.trim()) {
                        set({ requirements: [...c.requirements, { id: Math.random().toString(36).slice(2, 9), text: req.trim(), done: false }] });
                        setReq('');
                      }
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </section>
        <section>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Submission links</div>
          <div className="panel">
            <div className="list">
              {c.submissionLinks.map((l, i) => (
                <div key={i} className="li">
                  <ExternalLink size={13} className="muted" />
                  <a href={l.url} target="_blank" rel="noreferrer" className="small grow trunc">
                    {l.label || l.url}
                  </a>
                  <span className="mono xs faint trunc" style={{ maxWidth: 220 }}>{l.url}</span>
                  {editable && (
                    <button className="btn ghost icon xs" onClick={() => set({ submissionLinks: c.submissionLinks.filter((_, j) => j !== i) })}>
                      <X />
                    </button>
                  )}
                </div>
              ))}
              {editable && (
                <div className="li gap-6">
                  <input className="input sm" style={{ width: 160 }} placeholder="Label (Demo video)" value={link.label} onChange={(e) => setLink({ ...link, label: e.target.value })} />
                  <input className="input sm mono grow" placeholder="https://…" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} />
                  <button
                    className="btn sm"
                    disabled={!/^https?:\/\//.test(link.url)}
                    onClick={() => {
                      set({ submissionLinks: [...c.submissionLinks, link] });
                      setLink({ label: '', url: '' });
                    }}
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
        {(c.stage === 'finalist' || c.stage === 'result' || c.outcome) && (
          <section className="col gap-12">
            <div className="eyebrow">Result</div>
            <div className="row gap-6 wrap">
              {(['won', 'placed', 'finalist', 'not_selected'] as const).map((o) => (
                <button key={o} className={`btn sm${c.outcome === o ? ' on' : ''}`} disabled={!editable} onClick={() => set({ outcome: o, stage: 'result' })}>
                  {o === 'won' ? '🏆 Won' : o === 'placed' ? 'Placed' : o === 'finalist' ? 'Finalist' : 'Not selected'}
                </button>
              ))}
            </div>
            <textarea className="textarea" disabled={!editable} defaultValue={c.result} placeholder="What happened, feedback from judges, lessons" onBlur={(e) => e.target.value !== c.result && set({ result: e.target.value })} />
            <div className="xs faint">Wins, placements and finals become achievements on each team member’s profile.</div>
          </section>
        )}
      </div>
      {editing && <CompForm initial={c} onClose={() => setEditing(false)} />}
    </Drawer>
  );
}

function CompForm({ onClose, initial, onCreated }: { onClose: () => void; initial?: Competition; onCreated?: (id: string) => void }) {
  const me = useMe()!;
  const [f, setF] = useState({
    name: initial?.name ?? '',
    organizer: initial?.organizer ?? '',
    url: initial?.url ?? '',
    stage: initial?.stage ?? 'discovered',
    description: initial?.description ?? '',
    registrationDeadline: toLocalInput(initial?.registrationDeadline),
    deadline: toLocalInput(initial?.deadline),
    eventDate: initial?.eventDate ?? '',
    prize: initial?.prize ?? '',
    members: initial?.members ?? [me.id],
  });
  const reqs = useMemo(() => initial?.requirements ?? [], [initial]);
  const submit = async () => {
    try {
      const body = { ...f, registrationDeadline: fromLocalInput(f.registrationDeadline), deadline: fromLocalInput(f.deadline), eventDate: f.eventDate || null, ...(initial ? {} : { requirements: reqs, submissionLinks: [] }) };
      const row = initial ? await save('competitions', `/api/competitions/${initial.id}`, 'patch', body) : await save('competitions', '/api/competitions', 'post', body);
      onClose();
      if (!initial) onCreated?.(row.id);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Modal title={initial ? 'Edit competition' : 'Track a competition'} size="lg" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name.trim()} onClick={submit}>{initial ? 'Save' : 'Add'}</button></>}>
      <div className="grid-2">
        <Field label="Name">
          <input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Organizer">
          <input className="input" value={f.organizer} onChange={(e) => setF({ ...f, organizer: e.target.value })} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Website">
          <input className="input mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" />
        </Field>
        <Field label="Stage">
          <select className="select" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Stage })}>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-3">
        <Field label="Registration closes">
          <input type="datetime-local" className="input" value={f.registrationDeadline} onChange={(e) => setF({ ...f, registrationDeadline: e.target.value })} />
        </Field>
        <Field label="Submission deadline">
          <input type="datetime-local" className="input" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
        </Field>
        <Field label="Event / finals date">
          <input type="date" className="input" value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Prize">
          <input className="input" value={f.prize} onChange={(e) => setF({ ...f, prize: e.target.value })} />
        </Field>
        <Field label="Team">
          <MultiUserPicker value={f.members} onChange={(members) => setF({ ...f, members })} />
        </Field>
      </div>
      <Field label="Description / rules (markdown)">
        <textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
    </Modal>
  );
}
