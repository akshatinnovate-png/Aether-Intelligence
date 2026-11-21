import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api } from '../../lib/api';
import { patchTask, upsertRows, useMilestones, useProjects, useUsers } from '../../lib/data';
import { dueLabel, PRIORITY, PRIORITY_LABEL, PRIORITY_RANK, STATUS, STATUS_LABEL } from '../../lib/derive';
import { toast, toastError } from '../../lib/store';
import { Avatar, Picker, PriorityIcon, PriorityPicker, StatusIcon, StatusPicker, UserPicker } from '../../components/ui';
import type { Task } from '../../types';

type SortKey = 'key' | 'title' | 'status' | 'priority' | 'assignee' | 'due' | 'estimate' | 'updated';
type GroupKey = 'none' | 'status' | 'assignee' | 'priority' | 'milestone' | 'project';
const STATUS_RANK = Object.fromEntries(STATUS.map((s, i) => [s.id, i]));

/** Dense, sortable, groupable task table with inline edits and bulk actions. Used per project and in My work. */
export function TaskTable({ tasks, canWrite, showProject, defaultGroup = 'status' }: { tasks: Task[]; canWrite: (t: Task) => boolean; showProject?: boolean; defaultGroup?: GroupKey }) {
  const users = useUsers();
  const projects = useProjects();
  const milestones = useMilestones();
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'priority', dir: 1 });
  const [group, setGroup] = useState<GroupKey>(defaultGroup);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const pmap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const umap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const sorted = useMemo(() => {
    const cmp: Record<SortKey, (a: Task, b: Task) => number> = {
      key: (a, b) => (pmap.get(a.projectId)?.key ?? '').localeCompare(pmap.get(b.projectId)?.key ?? '') || a.number - b.number,
      title: (a, b) => a.title.localeCompare(b.title),
      status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'),
      assignee: (a, b) => (umap.get(a.assigneeId ?? '')?.name ?? '~').localeCompare(umap.get(b.assigneeId ?? '')?.name ?? '~'),
      due: (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
      estimate: (a, b) => a.estimate - b.estimate,
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    };
    return [...tasks].sort((a, b) => cmp[sort.k](a, b) * sort.dir);
  }, [tasks, sort, pmap, umap]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ key: 'all', label: '', rows: sorted }];
    const by = new Map<string, Task[]>();
    const keyOf = (t: Task) => (group === 'status' ? t.status : group === 'priority' ? t.priority : group === 'assignee' ? t.assigneeId ?? 'none' : group === 'project' ? t.projectId : t.milestoneId ?? 'none');
    for (const t of sorted) by.set(keyOf(t), [...(by.get(keyOf(t)) ?? []), t]);
    const order =
      group === 'status'
        ? STATUS.map((s) => s.id as string)
        : group === 'priority'
          ? PRIORITY.map((p) => p.id as string)
          : [...by.keys()].sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : 0));
    return order
      .filter((k) => by.has(k))
      .map((k) => ({
        key: k,
        label:
          group === 'status'
            ? STATUS_LABEL[k as Task['status']]
            : group === 'priority'
              ? PRIORITY_LABEL[k as Task['priority']]
              : group === 'assignee'
                ? umap.get(k)?.name ?? 'Unassigned'
                : group === 'project'
                  ? pmap.get(k)?.name ?? '—'
                  : milestones.find((m) => m.id === k)?.name ?? 'No milestone',
        rows: by.get(k)!,
      }));
  }, [sorted, group, umap, pmap, milestones]);

  const open = (id: string) => {
    params.set('task', id);
    setParams(params);
  };
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const bulk = async (patch: Partial<Task>) => {
    try {
      const rows = await api.post<Task[]>('/api/tasks/bulk', { ids: [...sel], patch });
      upsertRows('tasks', rows);
      toast({ title: `Updated ${rows.length} task${rows.length === 1 ? '' : 's'}` });
      setSel(new Set());
    } catch (e) {
      toastError(e);
    }
  };
  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={`sortable ${className ?? ''}`} onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
      <span className="row gap-4" style={{ display: 'inline-flex' }}>
        {children}
        {sort.k === k && (sort.dir === 1 ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
      </span>
    </th>
  );
  const allSelectable = tasks.filter(canWrite);
  return (
    <div className="col gap-12">
      <div className="row wrap between">
        <div className="row gap-6">
          <span className="xs muted">Group by</span>
          <select className="select sm" style={{ width: 140 }} value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            <option value="status">Status</option>
            <option value="assignee">Assignee</option>
            <option value="priority">Priority</option>
            <option value="milestone">Milestone</option>
            {showProject && <option value="project">Project</option>}
            <option value="none">Nothing</option>
          </select>
          <span className="xs faint">{tasks.length} tasks</span>
        </div>
        {sel.size > 0 && (
          <div className="row gap-6" style={{ animation: 'pop-in .15s' }}>
            <span className="small">{sel.size} selected</span>
            <Picker value={null} options={STATUS.map((s) => ({ value: s.id, label: s.label, icon: <StatusIcon status={s.id} /> }))} onChange={(v) => bulk({ status: v as Task['status'] })}>
              Set status
            </Picker>
            <Picker value={null} options={PRIORITY.map((s) => ({ value: s.id, label: s.label, icon: <PriorityIcon p={s.id} /> }))} onChange={(v) => bulk({ priority: v as Task['priority'] })}>
              Set priority
            </Picker>
            <Picker value={null} search options={[{ value: '__none', label: 'Unassigned' }, ...users.filter((u) => u.status === 'active').map((u) => ({ value: u.id, label: u.name, icon: <Avatar user={u} size={16} /> }))]} onChange={(v) => bulk({ assigneeId: v === '__none' ? null : v })} width={240}>
              Assign
            </Picker>
            <button className="btn ghost sm" onClick={() => setSel(new Set())}>
              Clear
            </button>
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <label className="check">
                  <input type="checkbox" checked={allSelectable.length > 0 && sel.size === allSelectable.length} onChange={(e) => setSel(e.target.checked ? new Set(allSelectable.map((t) => t.id)) : new Set())} />
                </label>
              </th>
              <Th k="key">Key</Th>
              <Th k="title">Title</Th>
              <Th k="status">Status</Th>
              <Th k="priority">Priority</Th>
              <Th k="assignee">Assignee</Th>
              <Th k="due">Due</Th>
              <Th k="estimate" className="num">
                Pts
              </Th>
              <Th k="updated">Updated</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key}>
                {group !== 'none' && (
                  <tr className="group-row">
                    <td colSpan={9}>
                      <span className="row gap-6">
                        {group === 'status' && <StatusIcon status={g.key as Task['status']} />}
                        {group === 'priority' && <PriorityIcon p={g.key as Task['priority']} />}
                        {group === 'assignee' && <Avatar user={umap.get(g.key)} size={16} />}
                        {g.label}
                        <span className="mono faint">{g.rows.length}</span>
                      </span>
                    </td>
                  </tr>
                )}
                {g.rows.map((t) => {
                  const w = canWrite(t);
                  const due = dueLabel(t.dueDate, t.status === 'done');
                  const p = pmap.get(t.projectId);
                  return (
                    <tr key={t.id} className={`clickable${sel.has(t.id) ? ' selected' : ''}`} onClick={() => open(t.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <label className="check">
                          <input type="checkbox" disabled={!w} checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
                        </label>
                      </td>
                      <td>
                        <span className="row gap-6">
                          {showProject && <span className="swatch" style={{ background: p?.color }} />}
                          <span className="key">
                            {p?.key}-{t.number}
                          </span>
                        </span>
                      </td>
                      <td style={{ maxWidth: 460 }}>
                        <span className="trunc" style={{ display: 'block' }}>{t.title}</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <StatusPicker value={t.status} disabled={!w} onChange={(status) => patchTask(t.id, { status }).catch(toastError)} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <PriorityPicker compact value={t.priority} disabled={!w} onChange={(priority) => patchTask(t.id, { priority }).catch(toastError)} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <UserPicker value={t.assigneeId} disabled={!w} onChange={(assigneeId) => patchTask(t.id, { assigneeId }).catch(toastError)} />
                      </td>
                      <td className={`mono xs ${due.tone}`} onClick={(e) => e.stopPropagation()}>
                        <input type="date" className="input bare sm" style={{ width: 128, color: 'inherit' }} disabled={!w} value={t.dueDate ?? ''} onChange={(e) => patchTask(t.id, { dueDate: e.target.value || null }).catch(toastError)} />
                      </td>
                      <td className="num mono muted">{t.estimate}</td>
                      <td className="xs faint">{new Date(t.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {!tasks.length && (
              <tr>
                <td colSpan={9} className="muted" style={{ textAlign: 'center', height: 80 }}>
                  No tasks match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
