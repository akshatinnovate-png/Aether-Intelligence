import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { destroy, save, useBookings, useCompetitions, useEquipment, useEvents, useMe, useMilestones, useProjects, useTasks, useUsers } from '../lib/data';
import { can, d, deadlines, type DeadlineItem, type DeadlineKind, fmtDateTime, fromLocalInput, KIND_COLOR, KIND_LABEL, toLocalInput, today } from '../lib/derive';
import { toastError } from '../lib/store';
import { AvatarStack, confirmDialog, Field, Modal, MultiUserPicker, Seg } from '../components/ui';
import type { CalEvent } from '../types';

const FILTERS: DeadlineKind[] = ['task', 'milestone', 'project', 'competition', 'registration', 'meeting', 'event', 'booking', 'license', 'maintenance'];

export default function Calendar() {
  const tasks = useTasks();
  const projects = useProjects();
  const milestones = useMilestones();
  const competitions = useCompetitions();
  const events = useEvents();
  const bookings = useBookings();
  const equipment = useEquipment();
  const users = useUsers();
  const me = useMe()!;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'month' | 'week' | 'agenda'>(() => (window.innerWidth < 820 ? 'agenda' : 'month'));
  const [cursor, setCursor] = useState(() => (params.get('d') ? d(params.get('d'))! : new Date()));
  const [hidden, setHidden] = useState<Set<DeadlineKind>>(new Set());
  const [mine, setMine] = useState(false);
  const [create, setCreate] = useState<string | null>(null);
  const eventId = params.get('event');
  useEffect(() => {
    const x = params.get('d');
    if (x) setCursor(d(x)!);
  }, [params]);

  const all = useMemo(() => deadlines({ tasks, projects, milestones, competitions, events, bookings, equipment, users }), [tasks, projects, milestones, competitions, events, bookings, equipment, users]);
  const items = all.filter((i) => !hidden.has(i.kind) && (!mine || i.people.includes(me.id)));
  const byDay = useMemo(() => {
    const m = new Map<string, DeadlineItem[]>();
    for (const it of items) {
      const start = d(it.date)!;
      const end = it.end ? d(it.end)! : start;
      // Multi-day items (bookings, events) appear on each day they cover, up to 14 days.
      const span = Math.min(14, Math.max(0, Math.floor((end.getTime() - start.getTime()) / 864e5)));
      for (let i = 0; i <= span; i++) {
        const k = format(addDays(start, i), 'yyyy-MM-dd');
        m.set(k, [...(m.get(k) ?? []), it]);
      }
    }
    return m;
  }, [items]);

  const range =
    view === 'month'
      ? eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) })
      : eachDayOfInterval({ start: startOfWeek(cursor, { weekStartsOn: 1 }), end: endOfWeek(cursor, { weekStartsOn: 1 }) });
  const step = (n: number) => setCursor(view === 'month' ? addMonths(cursor, n) : addWeeks(cursor, n));
  const openEvent = events.find((e) => e.id === eventId);
  const openItem = (it: DeadlineItem) => nav(it.link);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Unified schedule</div>
          <h1 className="h-display">Calendar</h1>
          <p>Task deadlines, milestones, project due dates, competitions, meetings, bookings, licence renewals and maintenance — one calendar.</p>
        </div>
        {me.role !== 'guest' && (
          <button className="btn primary sm" onClick={() => setCreate(format(cursor, 'yyyy-MM-dd'))}>
            <Plus /> Event
          </button>
        )}
      </div>
      <div className="row wrap between" style={{ marginBottom: 12 }}>
        <div className="row gap-6">
          <button className="btn ghost icon sm" onClick={() => step(-1)}>
            <ChevronLeft />
          </button>
          <span className="h2" style={{ minWidth: 180 }}>
            {view === 'month' ? format(cursor, 'MMMM yyyy') : `${format(range[0], 'd MMM')} – ${format(range[6], 'd MMM yyyy')}`}
          </span>
          <button className="btn ghost icon sm" onClick={() => step(1)}>
            <ChevronRight />
          </button>
          <button className="btn sm" onClick={() => setCursor(new Date())}>
            Today
          </button>
        </div>
        <div className="row gap-6">
          <label className="check small muted">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine
          </label>
          <Seg value={view} onChange={setView} options={[{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: 'agenda', label: 'Agenda' }]} />
        </div>
      </div>
      <div className="row wrap gap-4" style={{ marginBottom: 12 }}>
        {FILTERS.map((k) => (
          <button
            key={k}
            className={`chip${hidden.has(k) ? '' : ' on'}`}
            style={hidden.has(k) ? undefined : { background: 'transparent', borderColor: 'var(--line-2)', color: 'var(--text-2)' }}
            onClick={() =>
              setHidden((h) => {
                const n = new Set(h);
                n.has(k) ? n.delete(k) : n.add(k);
                return n;
              })
            }
          >
            <span className="swatch" style={{ background: hidden.has(k) ? 'var(--line-2)' : KIND_COLOR[k] }} />
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {view === 'agenda' ? (
        <Agenda items={items.filter((i) => i.date.slice(0, 10) >= format(addDays(cursor, -1), 'yyyy-MM-dd'))} onOpen={openItem} />
      ) : (
        <div className="panel" style={{ overflow: 'hidden' }}>
          <div className="cal" style={{ borderLeft: 0, borderTop: 0 }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => (
              <div key={x} className="cal-dow eyebrow">{x}</div>
            ))}
            {range.map((day) => {
              const k = format(day, 'yyyy-MM-dd');
              const list = byDay.get(k) ?? [];
              const max = view === 'week' ? 40 : 4;
              return (
                <div key={k} className={`cal-day${view === 'month' && !isSameMonth(day, cursor) ? ' other' : ''}${k === today() ? ' today' : ''}`} style={{ minHeight: view === 'week' ? 420 : 118 }} onDoubleClick={() => me.role !== 'guest' && setCreate(k)}>
                  <div className="row between">
                    <span className="cal-num">{format(day, 'd')}</span>
                    {me.role !== 'guest' && (
                      <button className="btn ghost icon xs" style={{ opacity: 0.5 }} onClick={() => setCreate(k)} title="Add event">
                        <Plus />
                      </button>
                    )}
                  </div>
                  {list.slice(0, max).map((it) => (
                    <div key={it.id + k} className={`cal-ev${it.done ? ' done' : ''}`} style={{ '--c': it.color } as React.CSSProperties} onClick={() => openItem(it)} title={`${KIND_LABEL[it.kind]}: ${it.title}${it.sub ? ` — ${it.sub}` : ''}`}>
                      {!it.allDay && <span className="mono" style={{ fontSize: 10, opacity: 0.8 }}>{format(d(it.date)!, 'HH:mm')}</span>}
                      <span className="trunc">{it.title}</span>
                    </div>
                  ))}
                  {list.length > max && (
                    <button className="btn ghost xs" style={{ alignSelf: 'flex-start' }} onClick={() => (setCursor(day), setView('week'))}>
                      +{list.length - max} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {create && <EventForm date={create} onClose={() => setCreate(null)} />}
      {openEvent && <EventDetail ev={openEvent} canEdit={can(me.role, 'admin') || openEvent.createdBy === me.id || me.role === 'lead'} onClose={() => (params.delete('event'), setParams(params))} />}
    </div>
  );
}

function Agenda({ items, onOpen }: { items: DeadlineItem[]; onOpen: (i: DeadlineItem) => void }) {
  const groups = new Map<string, DeadlineItem[]>();
  for (const it of items.slice(0, 200)) groups.set(it.date.slice(0, 10), [...(groups.get(it.date.slice(0, 10)) ?? []), it]);
  return (
    <div className="panel">
      {[...groups.entries()].map(([day, list]) => (
        <div key={day} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', borderBottom: '1px solid var(--line)' }}>
          <div style={{ padding: 12, borderRight: '1px solid var(--line)' }}>
            <div className={`serif ${day === today() ? 'accent-text' : ''}`} style={{ fontSize: 22 }}>{format(d(day)!, 'd')}</div>
            <div className="eyebrow">{format(d(day)!, 'EEE MMM')}</div>
          </div>
          <div className="list">
            {list.map((it) => (
              <button key={it.id} className="li" onClick={() => onOpen(it)}>
                <span className="swatch" style={{ background: it.color }} />
                <span className="mono xs muted" style={{ width: 44 }}>{it.allDay ? 'all day' : format(d(it.date)!, 'HH:mm')}</span>
                <span className={`small trunc grow${it.done ? ' faint' : ''}`}>{it.title}</span>
                <span className="xs faint">{it.sub}</span>
                <span className="badge">{KIND_LABEL[it.kind]}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!groups.size && <div className="empty">Nothing scheduled.</div>}
    </div>
  );
}

function EventForm({ date, onClose, initial }: { date?: string; onClose: () => void; initial?: CalEvent }) {
  const projects = useProjects();
  const me = useMe()!;
  const [f, setF] = useState({
    title: initial?.title ?? '',
    kind: initial?.kind ?? 'meeting',
    startsAt: initial ? toLocalInput(initial.startsAt) : `${date}T10:00`,
    endsAt: initial ? toLocalInput(initial.endsAt) : `${date}T11:00`,
    allDay: initial?.allDay ?? false,
    location: initial?.location ?? '',
    description: initial?.description ?? '',
    projectId: initial?.projectId ?? '',
    attendees: initial?.attendees ?? [me.id],
  });
  const submit = async () => {
    const body = { ...f, startsAt: fromLocalInput(f.allDay ? `${f.startsAt.slice(0, 10)}T00:00` : f.startsAt), endsAt: f.allDay ? null : fromLocalInput(f.endsAt), projectId: f.projectId || null };
    try {
      initial ? await save('events', `/api/events/${initial.id}`, 'patch', body) : await save('events', '/api/events', 'post', body);
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Modal title={initial ? 'Edit event' : 'New event'} sub="Attendees are notified and reminded before it starts." onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.title.trim()} onClick={submit}>Save</button></>}>
      <Field label="Title">
        <input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Weekly stand-up" />
      </Field>
      <div className="grid-2">
        <Field label="Kind">
          <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CalEvent['kind'] })}>
            <option value="meeting">Meeting</option>
            <option value="review">Review</option>
            <option value="deadline">Deadline</option>
            <option value="event">Event</option>
          </select>
        </Field>
        <Field label="Project">
          <select className="select" value={f.projectId ?? ''} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
            <option value="">None</option>
            {projects.filter((p) => !p.archived).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="check small">
        <input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} /> All day
      </label>
      <div className="grid-2">
        <Field label="Starts">
          <input type={f.allDay ? 'date' : 'datetime-local'} className="input" value={f.allDay ? f.startsAt.slice(0, 10) : f.startsAt} onChange={(e) => setF({ ...f, startsAt: f.allDay ? `${e.target.value}T00:00` : e.target.value })} />
        </Field>
        {!f.allDay && (
          <Field label="Ends">
            <input type="datetime-local" className="input" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
          </Field>
        )}
      </div>
      <div className="grid-2">
        <Field label="Location / link">
          <input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Lab, or a meeting URL" />
        </Field>
        <Field label="Attendees">
          <MultiUserPicker value={f.attendees} onChange={(attendees) => setF({ ...f, attendees })} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
    </Modal>
  );
}

function EventDetail({ ev, onClose, canEdit }: { ev: CalEvent; onClose: () => void; canEdit: boolean }) {
  const projects = useProjects();
  const [editing, setEditing] = useState(false);
  const p = projects.find((x) => x.id === ev.projectId);
  if (editing) return <EventForm initial={ev} onClose={onClose} />;
  return (
    <Modal
      title={ev.title}
      sub={`${ev.kind} · ${ev.allDay ? format(d(ev.startsAt)!, 'EEE d MMM yyyy') : `${fmtDateTime(ev.startsAt)} → ${ev.endsAt ? format(d(ev.endsAt)!, 'HH:mm') : ''}`}`}
      onClose={onClose}
      footer={
        canEdit ? (
          <>
            <button
              className="btn ghost"
              onClick={async () => {
                if (await confirmDialog('Delete this event?', undefined, { danger: true, ok: 'Delete' })) {
                  await destroy('events', `/api/events/${ev.id}`, ev.id).catch(toastError);
                  onClose();
                }
              }}
            >
              <Trash2 /> Delete
            </button>
            <button className="btn primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          </>
        ) : undefined
      }
    >
      {ev.location && <div className="small">{/^https?:/.test(ev.location) ? <a href={ev.location} target="_blank" rel="noreferrer" className="accent-text">{ev.location}</a> : ev.location}</div>}
      {p && (
        <Link to={`/projects/${p.key}`} className="row gap-6 small">
          <span className="swatch" style={{ background: p.color }} /> {p.name}
        </Link>
      )}
      {ev.description && <p className="t2" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{ev.description}</p>}
      <AvatarStack ids={ev.attendees} max={10} size={24} />
    </Modal>
  );
}
