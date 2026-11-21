import { useMemo, useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, differenceInCalendarDays, eachDayOfInterval, format, isWeekend, startOfDay } from 'date-fns';
import { patchTask, save, useMilestones, useUsers } from '../../lib/data';
import { d, fmtDate } from '../../lib/derive';
import { toastError } from '../../lib/store';
import { Avatar, Seg, StatusIcon } from '../../components/ui';
import type { Milestone, Project, Task } from '../../types';

const ZOOM = { day: 34, week: 14, month: 5 } as const;
type Zoom = keyof typeof ZOOM;
const ROW = 34;
const LEFT = 300;

interface Bar {
  task: Task;
  start: Date;
  end: Date;
  estimated: boolean;
}

function barFor(t: Task): Bar {
  const due = d(t.dueDate);
  const st = d(t.startDate);
  if (st && due) return { task: t, start: st, end: due < st ? st : due, estimated: false };
  if (due) return { task: t, start: addDays(due, -Math.max(1, t.estimate) + 1), end: due, estimated: true };
  if (st) return { task: t, start: st, end: addDays(st, Math.max(1, t.estimate) - 1), estimated: true };
  const c = startOfDay(d(t.createdAt) ?? new Date());
  return { task: t, start: c, end: addDays(c, Math.max(1, t.estimate) - 1), estimated: true };
}

export function Gantt({ project, tasks, canWrite }: { project: Project; tasks: Task[]; canWrite: boolean }) {
  const milestones = useMilestones().filter((m) => m.projectId === project.id);
  const users = useUsers();
  const [zoom, setZoom] = useState<Zoom>('week');
  const [params, setParams] = useSearchParams();
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'l' | 'r'; x0: number; delta: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const px = ZOOM[zoom];

  const bars = useMemo(() => tasks.map(barFor), [tasks]);
  const range = useMemo(() => {
    const dates = [
      new Date(),
      ...bars.flatMap((b) => [b.start, b.end]),
      ...milestones.map((m) => d(m.dueDate)).filter(Boolean),
      d(project.startDate),
      d(project.dueDate),
    ].filter(Boolean) as Date[];
    const min = new Date(Math.min(...dates.map((x) => x.getTime())));
    const max = new Date(Math.max(...dates.map((x) => x.getTime())));
    return { from: startOfDay(addDays(min, -7)), to: startOfDay(addDays(max, 21)) };
  }, [bars, milestones, project]);
  const days = useMemo(() => eachDayOfInterval({ start: range.from, end: range.to }), [range]);
  const width = days.length * px;
  const xOf = (date: Date) => differenceInCalendarDays(date, range.from) * px;

  // Group by milestone, ordered by milestone date; tasks without a milestone last.
  const groups = useMemo(() => {
    const ms: (Milestone | null)[] = [...milestones].sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
    ms.push(null);
    return ms
      .map((m) => ({ m, bars: bars.filter((b) => (b.task.milestoneId ?? null) === (m?.id ?? null)).sort((a, b) => a.start.getTime() - b.start.getTime()) }))
      .filter((g) => g.m || g.bars.length);
  }, [milestones, bars]);

  const rows: ({ type: 'group'; m: Milestone | null; count: number } | { type: 'bar'; bar: Bar })[] = [];
  for (const g of groups) {
    rows.push({ type: 'group', m: g.m, count: g.bars.length });
    for (const b of g.bars) rows.push({ type: 'bar', bar: b });
  }
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => r.type === 'bar' && rowIndex.set(r.bar.task.id, i));

  useEffect(() => {
    // Start scrolled to just before today.
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, xOf(new Date()) - 240);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const shifted = (b: Bar): { start: Date; end: Date } => {
    if (!drag || drag.id !== b.task.id) return b;
    const n = drag.delta;
    if (drag.mode === 'move') return { start: addDays(b.start, n), end: addDays(b.end, n) };
    if (drag.mode === 'l') return { start: addDays(b.start, Math.min(n, differenceInCalendarDays(b.end, b.start))), end: b.end };
    return { start: b.start, end: addDays(b.end, Math.max(n, -differenceInCalendarDays(b.end, b.start))) };
  };
  const onDown = (e: React.PointerEvent, b: Bar, mode: 'move' | 'l' | 'r') => {
    if (!canWrite) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: b.task.id, mode, x0: e.clientX, delta: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x0) / px);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  };
  const onUp = (b: Bar) => {
    if (!drag) return;
    const moved = drag.delta !== 0;
    const next = shifted(b);
    setDrag(null);
    if (!moved) {
      params.set('task', b.task.id);
      setParams(params);
      return;
    }
    patchTask(b.task.id, { startDate: format(next.start, 'yyyy-MM-dd'), dueDate: format(next.end, 'yyyy-MM-dd') }).catch(toastError);
  };

  const months: { label: string; x: number; w: number }[] = [];
  for (const day of days) {
    const label = format(day, 'MMMM yyyy');
    const last = months[months.length - 1];
    if (last?.label === label) last.w += px;
    else months.push({ label, x: xOf(day), w: px });
  }
  const todayX = xOf(new Date());

  return (
    <div className="col" style={{ height: '100%', gap: 0 }}>
      <div className="row between" style={{ padding: '10px 20px', borderBottom: '1px solid var(--line)' }}>
        <div className="row gap-12 xs muted">
          <span>Drag bars to reschedule · drag edges to resize · click to open</span>
          <span className="row gap-4">
            <span style={{ width: 14, height: 8, background: project.color, opacity: 0.5, display: 'inline-block' }} /> estimated dates
          </span>
        </div>
        <Seg value={zoom} onChange={setZoom} options={[{ id: 'day', label: 'Days' }, { id: 'week', label: 'Weeks' }, { id: 'month', label: 'Months' }]} />
      </div>
      <div ref={scroller} className="scroll" style={{ flex: 1, position: 'relative' }} onPointerMove={onMove}>
        <div style={{ width: LEFT + width, position: 'relative', minHeight: '100%' }}>
          {/* scale */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 4, height: 46, background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: LEFT, flex: 'none', position: 'sticky', left: 0, zIndex: 5, background: 'var(--panel-2)', borderRight: '1px solid var(--line)', display: 'flex', alignItems: 'flex-end', padding: '0 12px 8px' }}>
              <span className="eyebrow">Task</span>
            </div>
            <div style={{ position: 'relative', width }}>
              {months.map((m) => (
                <div key={m.label} style={{ position: 'absolute', left: m.x, width: m.w, top: 6, paddingLeft: 8, borderLeft: '1px solid var(--line)', overflow: 'hidden' }} className="xs muted trunc">
                  {m.label}
                </div>
              ))}
              {days.map((day) =>
                zoom === 'day' || (zoom === 'week' && day.getDay() === 1) || (zoom === 'month' && day.getDate() === 1) ? (
                  <div key={day.toISOString()} className="mono" style={{ position: 'absolute', left: xOf(day), bottom: 6, fontSize: 10, color: isWeekend(day) ? 'var(--faint)' : 'var(--muted)', paddingLeft: 3 }}>
                    {zoom === 'day' ? format(day, 'd') : format(day, 'd MMM')}
                  </div>
                ) : null,
              )}
            </div>
          </div>
          {/* background columns */}
          <div style={{ position: 'absolute', left: LEFT, top: 46, width, height: rows.length * ROW, pointerEvents: 'none' }}>
            {zoom !== 'month' &&
              days.map((day) =>
                isWeekend(day) ? <div key={day.toISOString()} style={{ position: 'absolute', left: xOf(day), width: px, top: 0, bottom: 0, background: 'var(--bg-2)' }} /> : null,
              )}
            {project.dueDate && <div style={{ position: 'absolute', left: xOf(d(project.dueDate)!) + px, top: 0, bottom: 0, width: 0, borderLeft: '1px dashed var(--red)' }} title="Project deadline" />}
            <div className="today-line" style={{ left: todayX + px / 2 }} />
          </div>
          {/* dependency arrows */}
          <svg style={{ position: 'absolute', left: LEFT, top: 46, width, height: rows.length * ROW, pointerEvents: 'none', overflow: 'visible' }}>
            <defs>
              <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--muted)" />
              </marker>
            </defs>
            {rows.map((r) => {
              if (r.type !== 'bar') return null;
              return r.bar.task.blockedBy.map((bid) => {
                const from = rows[rowIndex.get(bid) ?? -1];
                if (!from || from.type !== 'bar') return null;
                const a = shifted(from.bar);
                const b = shifted(r.bar);
                const x1 = xOf(a.end) + px;
                const y1 = rowIndex.get(bid)! * ROW + ROW / 2;
                const x2 = xOf(b.start);
                const y2 = rowIndex.get(r.bar.task.id)! * ROW + ROW / 2;
                const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 16));
                const late = x2 < x1;
                return <path key={`${bid}-${r.bar.task.id}`} d={`M${x1},${y1} H${mid} V${y2} H${x2 - 2}`} fill="none" stroke={late ? 'var(--red)' : 'var(--muted)'} strokeWidth="1" markerEnd="url(#arr)" strokeDasharray={late ? '3 2' : undefined} />;
              });
            })}
          </svg>
          {rows.map((r, i) =>
            r.type === 'group' ? (
              <div key={`g-${r.m?.id ?? 'none'}`} style={{ display: 'flex', height: ROW, borderBottom: '1px solid var(--line)', background: 'color-mix(in srgb, var(--bg-2) 70%, transparent)' }}>
                <div className="row" style={{ width: LEFT, flex: 'none', padding: '0 12px', position: 'sticky', left: 0, zIndex: 3, background: 'var(--bg-2)', borderRight: '1px solid var(--line)' }}>
                  <span style={{ width: 9, height: 9, transform: 'rotate(45deg)', border: '1.5px solid var(--text-2)', background: r.m?.done ? 'var(--accent)' : 'transparent', flex: 'none' }} />
                  <span className="small trunc" style={{ fontWeight: 500 }}>{r.m ? r.m.name : 'No milestone'}</span>
                  <span className="mono xs faint">{r.count}</span>
                  {r.m?.dueDate && <span className="xs muted" style={{ marginLeft: 'auto' }}>{fmtDate(r.m.dueDate)}</span>}
                </div>
                <div style={{ position: 'relative', width }}>
                  {r.m?.dueDate && <div className={`gantt-diamond${r.m.done ? ' done' : ''}`} style={{ left: xOf(d(r.m.dueDate)!) + px / 2 - 6, top: ROW / 2 - 6 }} title={`${r.m.name} · ${fmtDate(r.m.dueDate)}`} />}
                </div>
              </div>
            ) : (
              <GanttRow key={r.bar.task.id} bar={r.bar} shifted={shifted(r.bar)} xOf={xOf} px={px} width={width} color={project.color} project={project} index={i} onDown={onDown} onUp={onUp} canWrite={canWrite} assignee={users.find((u) => u.id === r.bar.task.assigneeId)} dragging={drag?.id === r.bar.task.id} />
            ),
          )}
          {!rows.length && <div className="empty">No tasks to schedule yet.</div>}
          {canWrite && <AddMilestoneRow project={project} />}
        </div>
      </div>
    </div>
  );
}

function GanttRow({ bar, shifted, xOf, px, width, color, project, onDown, onUp, canWrite, assignee, dragging }: {
  bar: Bar;
  shifted: { start: Date; end: Date };
  xOf: (d: Date) => number;
  px: number;
  width: number;
  color: string;
  project: Project;
  index: number;
  onDown: (e: React.PointerEvent, b: Bar, mode: 'move' | 'l' | 'r') => void;
  onUp: (b: Bar) => void;
  canWrite: boolean;
  assignee: Parameters<typeof Avatar>[0]['user'];
  dragging: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const t = bar.task;
  const left = xOf(shifted.start);
  const w = Math.max(px, (differenceInCalendarDays(shifted.end, shifted.start) + 1) * px);
  const done = t.status === 'done';
  return (
    <div style={{ display: 'flex', height: ROW, borderBottom: '1px solid var(--line)' }}>
      <div
        className="row clickable"
        style={{ width: LEFT, flex: 'none', padding: '0 12px 0 28px', position: 'sticky', left: 0, zIndex: 3, background: 'var(--panel)', borderRight: '1px solid var(--line)', cursor: 'pointer' }}
        onClick={() => {
          params.set('task', t.id);
          setParams(params);
        }}
      >
        <StatusIcon status={t.status} />
        <span className="key">{project.key}-{t.number}</span>
        <span className="small trunc grow">{t.title}</span>
        <Avatar user={assignee} size={16} />
      </div>
      <div style={{ position: 'relative', width }}>
        <div
          className="gantt-bar"
          onPointerDown={(e) => onDown(e, bar, 'move')}
          onPointerUp={() => onUp(bar)}
          style={{
            left,
            width: w,
            top: (ROW - 20) / 2,
            background: done ? 'var(--line-strong)' : color,
            opacity: bar.estimated && !dragging ? 0.55 : 1,
            color: done ? 'var(--text-2)' : 'var(--accent-ink)',
            cursor: canWrite ? (dragging ? 'grabbing' : 'grab') : 'pointer',
            outline: dragging ? '1px solid var(--text)' : undefined,
          }}
          title={`${t.title}\n${format(shifted.start, 'd MMM')} → ${format(shifted.end, 'd MMM')}`}
        >
          {t.status === 'in_progress' || t.status === 'review' ? <span className="fill" style={{ width: t.status === 'review' ? '75%' : '45%' }} /> : null}
          {w > 70 && <span style={{ position: 'relative' }}>{dragging ? `${format(shifted.start, 'd MMM')} → ${format(shifted.end, 'd MMM')}` : t.title}</span>}
          {canWrite && (
            <>
              <span className="handle l" onPointerDown={(e) => onDown(e, bar, 'l')} />
              <span className="handle r" onPointerDown={(e) => onDown(e, bar, 'r')} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AddMilestoneRow({ project }: { project: Project }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  return (
    <div style={{ display: 'flex', height: ROW + 6, borderBottom: '1px solid var(--line)' }}>
      <div className="row" style={{ width: LEFT + 260, flex: 'none', padding: '0 12px', position: 'sticky', left: 0, background: 'var(--panel)', zIndex: 3 }}>
        <input className="input bare sm grow" placeholder="+ Add milestone" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="date" className="input sm" style={{ width: 140 }} value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          className="btn sm"
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
          Add
        </button>
      </div>
    </div>
  );
}
