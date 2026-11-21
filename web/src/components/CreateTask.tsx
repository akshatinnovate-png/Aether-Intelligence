import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { save, useMe, useMilestones, useProjects } from '../lib/data';
import { useUI, toast, toastError } from '../lib/store';
import { can } from '../lib/derive';
import { Field, Modal, Picker, PriorityPicker, StatusPicker, UserPicker } from './ui';
import { LabelEditor } from './TaskDrawer';
import type { Priority, Task, TaskStatus } from '../types';

export function CreateTaskModal() {
  const { createTask, createTaskSeq } = useUI();
  if (!createTask) return null;
  return <CreateTaskForm key={createTaskSeq} defaults={createTask} />;
}

function CreateTaskForm({ defaults: createTask }: { defaults: Partial<Task> }) {
  const { closeCreateTask } = useUI();
  const projects = useProjects();
  const milestones = useMilestones();
  const me = useMe();
  const nav = useNavigate();
  const writable = projects.filter((p) => !p.archived && (can(me?.role, 'admin') || p.members.includes(me?.id ?? '') || p.leadId === me?.id));
  const [f, setF] = useState(() => ({
    projectId: createTask.projectId ?? writable[0]?.id ?? '',
    title: '',
    description: '',
    status: (createTask.status as TaskStatus) ?? ('todo' as TaskStatus),
    priority: 'medium' as Priority,
    assigneeId: (createTask.assigneeId !== undefined ? createTask.assigneeId : me?.id ?? null) as string | null,
    dueDate: createTask.dueDate ?? '',
    startDate: '',
    estimate: 2,
    milestoneId: (createTask.milestoneId ?? null) as string | null,
    labels: [] as string[],
  }));
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === f.projectId);
  const submit = async (again: boolean) => {
    if (!f.title.trim() || !f.projectId) return;
    setBusy(true);
    try {
      const row = await save('tasks', '/api/tasks', 'post', { ...f, title: f.title.trim(), dueDate: f.dueDate || null, startDate: f.startDate || null });
      toast({ title: `Created ${project?.key}-${row.number}`, body: row.title, link: `/projects/${project?.key}?task=${row.id}` });
      if (again) setF((x) => ({ ...x, title: '', description: '' }));
      else closeCreateTask();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!writable.length)
    return (
      <Modal title="New task" onClose={closeCreateTask} footer={<button className="btn" onClick={closeCreateTask}>Close</button>}>
        <p className="t2" style={{ margin: 0 }}>
          You are not a member of any project yet. {can(me?.role, 'lead') ? 'Create a project first.' : 'Ask a lead to add you to one.'}
        </p>
        {can(me?.role, 'lead') && (
          <button className="btn primary" onClick={() => (closeCreateTask(), nav('/projects?new=1'))}>
            Create a project
          </button>
        )}
      </Modal>
    );
  return (
    <Modal
      title="New task"
      size="lg"
      onClose={closeCreateTask}
      footer={
        <>
          <span className="xs faint grow">⌘↵ create · ⇧⌘↵ create and add another</span>
          <button className="btn ghost" onClick={closeCreateTask}>
            Cancel
          </button>
          <button className="btn" disabled={busy || !f.title.trim()} onClick={() => submit(true)}>
            Create & add another
          </button>
          <button className="btn primary" disabled={busy || !f.title.trim()} onClick={() => submit(false)}>
            Create task
          </button>
        </>
      }
    >
      <div
        className="col gap-12"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit(e.shiftKey);
          }
        }}
      >
        <div className="row wrap gap-6">
          <Picker value={f.projectId} options={writable.map((p) => ({ value: p.id, label: p.name, hint: p.key, icon: <span className="swatch" style={{ background: p.color }} /> }))} onChange={(projectId) => setF({ ...f, projectId: projectId!, milestoneId: null })} width={260}>
            <span className="swatch" style={{ background: project?.color }} />
            {project?.name ?? 'Project'}
          </Picker>
          <StatusPicker value={f.status} onChange={(status) => setF({ ...f, status })} />
          <PriorityPicker value={f.priority} onChange={(priority) => setF({ ...f, priority })} />
          <UserPicker value={f.assigneeId} onChange={(assigneeId) => setF({ ...f, assigneeId })} />
          <input type="date" className="input sm" style={{ width: 150 }} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} title="Due date" />
        </div>
        <input autoFocus className="input" style={{ height: 40, fontSize: 16, fontFamily: 'var(--serif)' }} placeholder="Task title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="textarea" placeholder="Description (markdown)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        {!more ? (
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(true)}>
            More fields…
          </button>
        ) : (
          <div className="grid-3">
            <Field label="Start date">
              <input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
            </Field>
            <Field label="Estimate (points)">
              <select className="select" value={f.estimate} onChange={(e) => setF({ ...f, estimate: Number(e.target.value) })}>
                {[1, 2, 3, 5, 8, 13].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Milestone">
              <select className="select" value={f.milestoneId ?? ''} onChange={(e) => setF({ ...f, milestoneId: e.target.value || null })}>
                <option value="">None</option>
                {milestones
                  .filter((m) => m.projectId === f.projectId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Labels">
              <LabelEditor labels={f.labels} onChange={(labels) => setF({ ...f, labels })} />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
