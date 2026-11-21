import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { useMilestones, useUsers } from '../../lib/data';
import { PRIORITY, PRIORITY_LABEL } from '../../lib/derive';
import { Picker, PriorityIcon, SearchInput, Avatar } from '../../components/ui';
import type { Priority, Project, Task } from '../../types';

export interface TaskFilter {
  q: string;
  assignee: string | null;
  priority: Priority | null;
  label: string | null;
  milestone: string | null;
  hideDone: boolean;
}

/** Filters live in the URL so a filtered board can be shared as a link. */
export function useTaskFilter(): [TaskFilter, (f: Partial<TaskFilter>) => void] {
  const [params, setParams] = useSearchParams();
  const f: TaskFilter = {
    q: params.get('q') ?? '',
    assignee: params.get('assignee'),
    priority: params.get('priority') as Priority | null,
    label: params.get('label'),
    milestone: params.get('milestone'),
    hideDone: params.get('done') === 'hide',
  };
  const set = (patch: Partial<TaskFilter>) => {
    const next = new URLSearchParams(params);
    const map: Record<string, string | null> = {
      q: patch.q !== undefined ? patch.q || null : f.q || null,
      assignee: patch.assignee !== undefined ? patch.assignee : f.assignee,
      priority: patch.priority !== undefined ? patch.priority : f.priority,
      label: patch.label !== undefined ? patch.label : f.label,
      milestone: patch.milestone !== undefined ? patch.milestone : f.milestone,
      done: (patch.hideDone !== undefined ? patch.hideDone : f.hideDone) ? 'hide' : null,
    };
    for (const [k, v] of Object.entries(map)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };
  return [f, set];
}

export function applyFilter(tasks: Task[], f: TaskFilter) {
  const q = f.q.toLowerCase();
  return tasks.filter(
    (t) =>
      (!q || t.title.toLowerCase().includes(q) || String(t.number) === q || t.labels.some((l) => l.includes(q))) &&
      (!f.assignee || (f.assignee === 'none' ? !t.assigneeId : t.assigneeId === f.assignee)) &&
      (!f.priority || t.priority === f.priority) &&
      (!f.label || t.labels.includes(f.label)) &&
      (!f.milestone || t.milestoneId === f.milestone) &&
      (!f.hideDone || t.status !== 'done'),
  );
}

export function FilterBar({ project, tasks, f, set, right }: { project: Project; tasks: Task[]; f: TaskFilter; set: (p: Partial<TaskFilter>) => void; right?: React.ReactNode }) {
  const users = useUsers();
  const milestones = useMilestones().filter((m) => m.projectId === project.id);
  const labels = useMemo(() => [...new Set(tasks.flatMap((t) => t.labels))].sort(), [tasks]);
  const active = f.q || f.assignee || f.priority || f.label || f.milestone || f.hideDone;
  const members = users.filter((u) => project.members.includes(u.id) || tasks.some((t) => t.assigneeId === u.id));
  return (
    <div className="row wrap gap-6" style={{ padding: '10px 20px', borderBottom: '1px solid var(--line)' }}>
      <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="Filter tasks" width={200} />
      <Picker value={f.assignee} search options={[{ value: null, label: 'Anyone' }, { value: 'none', label: 'Unassigned' }, ...members.map((u) => ({ value: u.id, label: u.name, icon: <Avatar user={u} size={16} /> }))]} onChange={(assignee) => set({ assignee })} className={`btn sm${f.assignee ? ' on' : ''}`}>
        {f.assignee ? (f.assignee === 'none' ? 'Unassigned' : users.find((u) => u.id === f.assignee)?.name) : 'Assignee'}
      </Picker>
      <Picker value={f.priority} options={[{ value: null, label: 'Any priority' }, ...PRIORITY.map((p) => ({ value: p.id, label: p.label, icon: <PriorityIcon p={p.id} /> }))]} onChange={(priority) => set({ priority: priority as Priority | null })} className={`btn sm${f.priority ? ' on' : ''}`} width={180}>
        {f.priority ? PRIORITY_LABEL[f.priority] : 'Priority'}
      </Picker>
      {labels.length > 0 && (
        <Picker value={f.label} options={[{ value: null, label: 'Any label' }, ...labels.map((l) => ({ value: l, label: l }))]} onChange={(label) => set({ label })} className={`btn sm${f.label ? ' on' : ''}`} width={200}>
          {f.label ?? 'Label'}
        </Picker>
      )}
      {milestones.length > 0 && (
        <Picker value={f.milestone} options={[{ value: null, label: 'Any milestone' }, ...milestones.map((m) => ({ value: m.id, label: m.name }))]} onChange={(milestone) => set({ milestone })} className={`btn sm${f.milestone ? ' on' : ''}`} width={240}>
          {milestones.find((m) => m.id === f.milestone)?.name ?? 'Milestone'}
        </Picker>
      )}
      <label className="check small muted" style={{ marginLeft: 4 }}>
        <input type="checkbox" checked={f.hideDone} onChange={(e) => set({ hideDone: e.target.checked })} /> Hide done
      </label>
      {active && (
        <button className="btn ghost sm" onClick={() => set({ q: '', assignee: null, priority: null, label: null, milestone: null, hideDone: false })}>
          <X /> Clear
        </button>
      )}
      <div className="grow" />
      {right}
    </div>
  );
}
