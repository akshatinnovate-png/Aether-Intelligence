import { useMemo, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSearchParams } from 'react-router-dom';
import { FileUp, GitCommitHorizontal, Lock, MessageSquare, Plus } from 'lucide-react';
import { patchTask, save, useTasks, useUsers } from '../../lib/data';
import { dueLabel, nextPosition, STATUS } from '../../lib/derive';
import { toastError } from '../../lib/store';
import { Avatar, PriorityIcon, StatusIcon } from '../../components/ui';
import type { Project, Task, TaskStatus } from '../../types';

export function Board({ project, tasks, canWrite }: { project: Project; tasks: Task[]; canWrite: boolean }) {
  const all = useTasks();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<TaskStatus | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const lanes = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>(STATUS.map((s) => [s.id, []]));
    for (const t of tasks) m.get(t.status)!.push(t);
    for (const l of m.values()) l.sort((a, b) => a.position - b.position);
    return m;
  }, [tasks]);
  const statusOf = (id: string): TaskStatus | null => {
    if (id.startsWith('lane:')) return id.slice(5) as TaskStatus;
    return tasks.find((t) => t.id === id)?.status ?? null;
  };
  const onStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onEnd = (e: DragEndEvent) => {
    setDragId(null);
    setOverLane(null);
    const id = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    const target = statusOf(overId);
    const task = tasks.find((t) => t.id === id);
    if (!task || !target) return;
    const lane = (lanes.get(target) ?? []).filter((t) => t.id !== id);
    let index = lane.length;
    if (!overId.startsWith('lane:')) {
      const i = lane.findIndex((t) => t.id === overId);
      if (i >= 0) {
        // Dropping onto a card below the dragged one in the same lane means "after it".
        const from = (lanes.get(target) ?? []).findIndex((t) => t.id === id);
        const to = (lanes.get(target) ?? []).findIndex((t) => t.id === overId);
        index = task.status === target && from >= 0 && from < to ? i + 1 : i;
      }
    }
    const position = nextPosition(lane, index);
    if (task.status === target && Math.abs(position - task.position) < 1e-9) return;
    patchTask(id, { status: target, position }).catch(toastError);
  };
  const dragging = all.find((t) => t.id === dragId);
  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={(e) => setOverLane(e.over ? statusOf(String(e.over.id)) : null)} onDragEnd={onEnd} onDragCancel={() => (setDragId(null), setOverLane(null))}>
      <div className="board">
        {STATUS.map((s) => (
          <Lane key={s.id} status={s.id} label={s.label} tasks={lanes.get(s.id)!} project={project} over={overLane === s.id && !!dragId} canWrite={canWrite} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0.7,0.1,1)' }}>{dragging ? <Card task={dragging} project={project} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Lane({ status, label, tasks, project, over, canWrite }: { status: TaskStatus; label: string; tasks: Task[]; project: Project; over: boolean; canWrite: boolean }) {
  const { setNodeRef } = useDroppable({ id: `lane:${status}`, disabled: !canWrite });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const points = tasks.reduce((s, t) => s + t.estimate, 0);
  const add = async () => {
    if (!title.trim()) return setAdding(false);
    const t = title.trim();
    setTitle('');
    try {
      await save('tasks', '/api/tasks', 'post', { projectId: project.id, title: t, status, position: (tasks[tasks.length - 1]?.position ?? 0) + 1024 });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className={`lane${over ? ' over' : ''}`} ref={setNodeRef}>
      <div className="lane-head">
        <StatusIcon status={status} />
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span className="mono xs muted">{tasks.length}</span>
        <span className="grow" />
        <span className="mono xs faint" title="Story points">
          {points}p
        </span>
        {canWrite && (
          <button className="btn ghost icon xs" onClick={() => setAdding(true)} title={`Add to ${label}`}>
            <Plus />
          </button>
        )}
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="lane-body">
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} project={project} disabled={!canWrite} />
          ))}
          {adding && (
            <div className="card" style={{ cursor: 'text' }}>
              <textarea
                autoFocus
                className="input bare"
                style={{ height: 'auto', minHeight: 40, resize: 'none', padding: 0 }}
                placeholder="Task title — Enter to add, Esc to stop"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => !title.trim() && setAdding(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    add();
                  }
                  if (e.key === 'Escape') setAdding(false);
                }}
              />
            </div>
          )}
          {!tasks.length && !adding && <div className="xs faint" style={{ textAlign: 'center', padding: '14px 0' }}>Drop tasks here</div>}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({ task, project, disabled }: { task: Task; project: Project; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners}>
      <Card task={task} project={project} dragging={isDragging} />
    </div>
  );
}

function Card({ task, project, overlay, dragging }: { task: Task; project: Project; overlay?: boolean; dragging?: boolean }) {
  const users = useUsers();
  const all = useTasks();
  const [params, setParams] = useSearchParams();
  const assignee = users.find((u) => u.id === task.assigneeId);
  const due = dueLabel(task.dueDate, task.status === 'done');
  const blocked = task.blockedBy.some((b) => all.find((t) => t.id === b && t.status !== 'done'));
  return (
    <div
      className={`card${overlay ? ' overlay' : ''}${dragging ? ' dragging' : ''}${blocked ? ' blocked' : ''}`}
      onClick={() => {
        params.set('task', task.id);
        setParams(params);
      }}
    >
      <div className="row between">
        <span className="key">
          {project.key}-{task.number}
        </span>
        <Avatar user={assignee} size={20} />
      </div>
      <div className="card-title">{task.title}</div>
      <div className="meta">
        <PriorityIcon p={task.priority} />
        {blocked && <Lock size={12} className="red" />}
        {(task.deliverable || task.submission) && (
          <span
            className={`badge ${task.submission?.status === 'approved' ? 'green' : task.submission?.status === 'pending' ? 'amber' : task.submission?.status === 'changes_requested' ? 'red' : 'accent'}`}
            title={task.submission ? `Drive deliverable: ${task.submission.status.replace('_', ' ')}` : 'Drive deliverable not submitted yet'}
            style={{ height: 17, padding: '0 5px' }}
          >
            <FileUp size={10} />
            {task.submission ? (task.submission.status === 'approved' ? '✓' : task.submission.status === 'pending' ? 'review' : 'redo') : 'due'}
          </span>
        )}
        {due.text && <span className={`mono ${due.tone}`}>{due.text}</span>}
        {task.labels.slice(0, 2).map((l) => (
          <span key={l} className="tag">
            {l}
          </span>
        ))}
        <span className="grow" />
        {task.commentCount > 0 && (
          <span className="row gap-2">
            <MessageSquare size={11} />
            {task.commentCount}
          </span>
        )}
        {task.commitCount > 0 && (
          <span className="row gap-2">
            <GitCommitHorizontal size={11} />
            {task.commitCount}
          </span>
        )}
        <span className="mono faint">{task.estimate}p</span>
      </div>
    </div>
  );
}
