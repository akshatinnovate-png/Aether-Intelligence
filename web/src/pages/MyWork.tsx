import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMe, useProjects, useTasks, useUsers } from '../lib/data';
import { can, isOverdue, loadTone, today, workload } from '../lib/derive';
import { Bar, Seg } from '../components/ui';
import { TaskTable } from './project/TaskTable';

export default function MyWork() {
  const me = useMe()!;
  const tasks = useTasks();
  const projects = useProjects();
  const users = useUsers();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') ?? 'mine') as 'mine' | 'reported' | 'overdue' | 'all';
  const meUser = users.find((u) => u.id === me.id);
  const w = meUser ? workload(meUser, tasks) : null;
  const list = useMemo(() => {
    if (view === 'mine') return tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done');
    if (view === 'reported') return tasks.filter((t) => t.reporterId === me.id && t.assigneeId !== me.id);
    if (view === 'overdue') return tasks.filter(isOverdue);
    return tasks.filter((t) => t.status !== 'done');
  }, [tasks, view, me.id]);
  const canWrite = (projectId: string) => {
    const p = projects.find((x) => x.id === projectId);
    return !!p && (can(me.role, 'admin') || (me.role !== 'guest' && (p.members.includes(me.id) || p.leadId === me.id)));
  };
  const dueToday = tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done' && t.dueDate === today()).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Focus</div>
          <h1 className="h-display">My work</h1>
          <p>
            {dueToday ? `${dueToday} due today. ` : ''}
            {w ? `${w.active} active task${w.active === 1 ? '' : 's'}, ${w.points} of ${meUser!.capacity} points this week.` : ''}
          </p>
        </div>
        {w && (
          <div style={{ width: 260 }} className="col gap-6">
            <div className="row between xs muted">
              <span>Load vs capacity</span>
              <span className={`mono ${loadTone(w.load)}`}>{w.load}%</span>
            </div>
            <Bar pct={w.load} tone={w.load > 100 ? 'over' : w.load > 80 ? 'warn' : 'accent'} thick />
            <div className="row between xs faint">
              <span>{w.done30} done in 30 days</span>
              <span>{w.onTime !== null ? `${w.onTime}% on time` : ''}</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ marginBottom: 14 }}>
        <Seg
          value={view}
          onChange={(v) => setParams({ view: v })}
          options={[
            { id: 'mine', label: `Assigned to me · ${tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done').length}` },
            { id: 'reported', label: 'Created by me' },
            { id: 'overdue', label: `Overdue · ${tasks.filter(isOverdue).length}` },
            { id: 'all', label: 'All open' },
          ]}
        />
      </div>
      <TaskTable tasks={list} showProject canWrite={(t) => canWrite(t.projectId)} defaultGroup={view === 'all' ? 'project' : 'status'} />
    </div>
  );
}
