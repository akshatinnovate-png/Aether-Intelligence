import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { GitCommitHorizontal, Link2, Lock, MessageSquare, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { destroy, patchTask, qc, useMe, useMilestones, useProjects, useTasks, useUsers } from '../lib/data';
import { ago, can, collapseActivity, dueLabel, fmtDate, STATUS_LABEL } from '../lib/derive';
import { toast, toastError } from '../lib/store';
import { Avatar, confirmDialog, Drawer, Picker, PriorityPicker, StatusIcon, StatusPicker, UserPicker } from './ui';
import { Markdown } from './Markdown';
import { Composer, encodeMentions } from './Composer';
import type { Activity, Submission, Task } from '../types';
import { DeliverablePanel } from './Deliverable';

interface Detail {
  comments: { id: string; userId: string | null; body: string; createdAt: string }[];
  commits: { sha: string; repo: string; message: string; author: string; url: string; createdAt: string }[];
  activity: Activity[];
  submissions: Submission[];
}

export function TaskDrawer({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const tasks = useTasks();
  const projects = useProjects();
  const milestones = useMilestones();
  const users = useUsers();
  const me = useMe()!;
  const task = tasks.find((t) => t.id === id);
  const project = projects.find((p) => p.id === task?.projectId);
  const close = () => {
    params.delete('task');
    setParams(params, { replace: true });
  };
  const detail = useQuery({ queryKey: ['task-detail', id], queryFn: () => api.get<Detail>(`/api/tasks/${id}/detail`), staleTime: 0 });
  const canWrite = !!project && (can(me.role, 'admin') || (me.role !== 'guest' && (project.members.includes(me.id) || project.leadId === me.id)));

  const [title, setTitle] = useState(task?.title ?? '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(task?.description ?? '');
  const [comment, setComment] = useState('');
  useEffect(() => {
    setTitle(task?.title ?? '');
    setDesc(task?.description ?? '');
  }, [task?.id, task?.title, task?.description]);

  const pmap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const umap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  if (!task || !project) {
    return (
      <Drawer onClose={close} head={<span className="muted">Task</span>}>
        <div className="empty">{tasks.length ? 'This task no longer exists or you cannot see it.' : 'Loading…'}</div>
      </Drawer>
    );
  }
  const key = `${project.key}-${task.number}`;
  const set = (patch: Partial<Task>) => patchTask(task.id, patch).catch(toastError);
  const blockers = task.blockedBy.map((b) => tasks.find((t) => t.id === b)).filter(Boolean) as Task[];
  const blocking = tasks.filter((t) => t.blockedBy.includes(task.id));
  const openBlockers = blockers.filter((b) => b.status !== 'done');
  const due = dueLabel(task.dueDate, task.status === 'done');
  const projectMilestones = milestones.filter((m) => m.projectId === project.id);
  const sendComment = async () => {
    const body = encodeMentions(comment.trim(), users);
    if (!body) return;
    setComment('');
    try {
      await api.post(`/api/tasks/${task.id}/comments`, { body });
      qc.invalidateQueries({ queryKey: ['task-detail', task.id] });
    } catch (e) {
      setComment(comment);
      toastError(e);
    }
  };
  return (
    <Drawer
      wide
      onClose={close}
      head={
        <>
          <span className="swatch" style={{ background: project.color }} />
          <Link to={`/projects/${project.key}`} className="small muted">
            {project.name}
          </Link>
          <span className="faint">/</span>
          <span className="key">{key}</span>
          <div className="grow" />
          <button
            className="btn ghost icon sm"
            title="Copy link"
            onClick={() => {
              navigator.clipboard.writeText(`${location.origin}/projects/${project.key}?task=${task.id}`);
              toast({ title: 'Link copied' });
            }}
          >
            <Link2 />
          </button>
          {canWrite && (
            <button
              className="btn ghost icon sm"
              title="Delete task"
              onClick={async () => {
                if (!(await confirmDialog(`Delete ${key}?`, 'Comments and links are removed with it. This cannot be undone.', { danger: true, ok: 'Delete' }))) return;
                await destroy('tasks', `/api/tasks/${task.id}`, task.id).catch(toastError);
                close();
              }}
            >
              <Trash2 />
            </button>
          )}
        </>
      }
    >
      <div className="drawer-split">
        <div style={{ padding: '20px 24px 40px', minWidth: 0 }} className="col gap-16">
          <textarea
            className="input bare h1"
            style={{ height: 'auto', resize: 'none', padding: '2px 4px', fontFamily: 'var(--serif)', fontSize: 24, lineHeight: 1.25 }}
            rows={Math.max(1, Math.ceil(title.length / 48))}
            value={title}
            disabled={!canWrite}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && set({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
          />
          {(task.deliverable || task.submission) && <DeliverablePanel task={task} history={detail.data?.submissions ?? (task.submission ? [task.submission] : [])} />}
          {openBlockers.length > 0 && (
            <div className="err-box row">
              <Lock size={13} /> Blocked by {openBlockers.map((b) => `${pmap.get(b.projectId)?.key}-${b.number}`).join(', ')}
            </div>
          )}
          <section>
            <div className="row between" style={{ marginBottom: 6 }}>
              <span className="eyebrow">Description</span>
              {canWrite && !editingDesc && (
                <button className="btn ghost xs" onClick={() => setEditingDesc(true)}>
                  Edit
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="col">
                <textarea className="textarea mono" style={{ minHeight: 180, fontSize: 12.5 }} autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Markdown supported: lists, tables, code, links." />
                <div className="row end">
                  <button className="btn ghost sm" onClick={() => (setDesc(task.description), setEditingDesc(false))}>
                    Cancel
                  </button>
                  <button className="btn primary sm" onClick={() => (set({ description: desc }), setEditingDesc(false))}>
                    Save
                  </button>
                </div>
              </div>
            ) : task.description ? (
              <Markdown text={task.description} />
            ) : (
              <div className="faint small" style={{ cursor: canWrite ? 'pointer' : 'default' }} onClick={() => canWrite && setEditingDesc(true)}>
                {canWrite ? 'Add a description…' : 'No description.'}
              </div>
            )}
          </section>

          {(blockers.length > 0 || blocking.length > 0 || canWrite) && (
            <section>
              <div className="row between" style={{ marginBottom: 6 }}>
                <span className="eyebrow">Dependencies</span>
                {canWrite && (
                  <Picker
                    value={task.blockedBy}
                    search
                    width={340}
                    className="btn ghost xs"
                    options={tasks
                      .filter((t) => t.id !== task.id && t.projectId === task.projectId)
                      .map((t) => ({ value: t.id, label: `${pmap.get(t.projectId)?.key}-${t.number} ${t.title}`, icon: <StatusIcon status={t.status} /> }))}
                    onChange={(v) => v && set({ blockedBy: task.blockedBy.includes(v) ? task.blockedBy.filter((x) => x !== v) : [...task.blockedBy, v] })}
                  >
                    + Blocked by
                  </Picker>
                )}
              </div>
              <div className="panel">
                <div className="list">
                  {blockers.map((b) => (
                    <TaskLine key={b.id} t={b} prefix="Blocked by" onRemove={canWrite ? () => set({ blockedBy: task.blockedBy.filter((x) => x !== b.id) }) : undefined} />
                  ))}
                  {blocking.map((b) => (
                    <TaskLine key={b.id} t={b} prefix="Blocks" />
                  ))}
                  {!blockers.length && !blocking.length && <div className="li faint small">No dependencies.</div>}
                </div>
              </div>
            </section>
          )}

          {(detail.data?.commits.length ?? 0) > 0 && (
            <section>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Linked commits</div>
              <div className="panel">
                <div className="list">
                  {detail.data!.commits.map((c) => (
                    <a key={c.sha} className="li" href={c.url} target="_blank" rel="noreferrer">
                      <GitCommitHorizontal size={14} className="muted" />
                      <span className="mono xs muted">{c.sha.slice(0, 7)}</span>
                      <span className="trunc grow">{c.message.split('\n')[0]}</span>
                      <span className="xs faint">{c.author}</span>
                    </a>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Discussion & history</div>
            <div className="col gap-12">
              {mergeTimeline(detail.data).map((item) =>
                item.type === 'comment' ? (
                  <div key={item.id} className="row start gap-12">
                    <Avatar user={umap.get(item.userId ?? '')} size={24} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row small">
                        <strong style={{ fontWeight: 500 }}>{umap.get(item.userId ?? '')?.name ?? 'Former member'}</strong>
                        <span className="faint xs">{ago(item.createdAt)}</span>
                        {(item.userId === me.id || can(me.role, 'admin')) && (
                          <button
                            className="btn ghost icon xs"
                            style={{ marginLeft: 'auto' }}
                            title="Delete comment"
                            onClick={async () => {
                              await api.del(`/api/comments/${item.id}`).catch(toastError);
                              qc.invalidateQueries({ queryKey: ['task-detail', task.id] });
                            }}
                          >
                            <X />
                          </button>
                        )}
                      </div>
                      <Markdown text={item.body} />
                    </div>
                  </div>
                ) : (
                  <div key={item.id} className="row small muted" style={{ paddingLeft: 6 }}>
                    <span className="dot" style={{ background: 'var(--line-strong)', marginRight: 8 }} />
                    <span className="trunc">
                      <span className="t2">{umap.get(item.actorId ?? '')?.name ?? 'GitHub'}</span> {item.summary}
                    </span>
                    <span className="faint xs" style={{ marginLeft: 'auto', flex: 'none' }}>{ago(item.createdAt)}</span>
                  </div>
                ),
              )}
              {me.role !== 'guest' || project.members.includes(me.id) ? (
                <Composer
                  value={comment}
                  onChange={setComment}
                  onSubmit={sendComment}
                  multilineEnter
                  placeholder="Write a comment. @ to mention, ⌘↵ to send."
                  footer={
                    <>
                      <span className="xs faint grow">Markdown supported</span>
                      <button className="btn primary sm" disabled={!comment.trim()} onClick={sendComment}>
                        <MessageSquare /> Comment
                      </button>
                    </>
                  }
                />
              ) : null}
            </div>
          </section>
        </div>

        <aside>
          <Prop label="Status">
            <StatusPicker value={task.status} disabled={!canWrite} onChange={(status) => set({ status })} />
          </Prop>
          <Prop label="Priority">
            <PriorityPicker value={task.priority} disabled={!canWrite} onChange={(priority) => set({ priority })} />
          </Prop>
          <Prop label="Assignee">
            <UserPicker value={task.assigneeId} disabled={!canWrite} onChange={(assigneeId) => set({ assigneeId })} />
          </Prop>
          <Prop label="Due">
            <div className="col gap-4" style={{ alignItems: 'flex-start' }}>
              <input type="date" className="input sm" disabled={!canWrite} value={task.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} />
              {due.text && <span className={`xs ${due.tone}`}>{due.text}</span>}
            </div>
          </Prop>
          <Prop label="Start">
            <input type="date" className="input sm" disabled={!canWrite} value={task.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value || null })} />
          </Prop>
          <Prop label="Estimate">
            <Picker value={String(task.estimate)} disabled={!canWrite} options={[1, 2, 3, 5, 8, 13].map((n) => ({ value: String(n), label: `${n} point${n > 1 ? 's' : ''}` }))} onChange={(v) => set({ estimate: Number(v) })} width={160}>
              <span className="mono">{task.estimate}</span> pts
            </Picker>
          </Prop>
          <Prop label="Milestone">
            <Picker value={task.milestoneId} disabled={!canWrite} options={[{ value: null, label: 'None' }, ...projectMilestones.map((m) => ({ value: m.id, label: m.name, hint: fmtDate(m.dueDate) }))]} onChange={(milestoneId) => set({ milestoneId })} width={240}>
              <span className="trunc">{projectMilestones.find((m) => m.id === task.milestoneId)?.name ?? 'None'}</span>
            </Picker>
          </Prop>
          <Prop label="Labels">
            <LabelEditor labels={task.labels} disabled={!canWrite} onChange={(labels) => set({ labels })} />
          </Prop>
          <Prop label="Deliverable">
            <label className="check small" title="The assignee hands in a Google Drive link, which the requester reviews">
              <input type="checkbox" disabled={!canWrite} checked={task.deliverable} onChange={(e) => set({ deliverable: e.target.checked })} /> Drive link required
            </label>
          </Prop>
          <hr className="sep" />
          <div className="col gap-6 xs muted">
            <div>
              Reported by <span className="t2">{umap.get(task.reporterId ?? '')?.name ?? '—'}</span>
            </div>
            <div>Created {ago(task.createdAt)}</div>
            <div>Updated {ago(task.updatedAt)}</div>
            {task.completedAt && <div>Completed {fmtDate(task.completedAt, 'd MMM yyyy')}</div>}
            {project.repoFullName && (
              <div className="code-box" style={{ marginTop: 8 }}>
                Reference <span className="accent-text">{key}</span> in a commit to link it; “fixes {key}” closes it.
              </div>
            )}
          </div>
        </aside>
      </div>
    </Drawer>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop">
      <span className="label">{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function TaskLine({ t, prefix, onRemove }: { t: Task; prefix: string; onRemove?: () => void }) {
  const projects = useProjects();
  const p = projects.find((x) => x.id === t.projectId);
  const [params, setParams] = useSearchParams();
  return (
    <div
      className="li clickable"
      onClick={() => {
        params.set('task', t.id);
        setParams(params);
      }}
    >
      <span className="xs faint" style={{ width: 70 }}>{prefix}</span>
      <StatusIcon status={t.status} />
      <span className="key">{p?.key}-{t.number}</span>
      <span className="trunc grow">{t.title}</span>
      <span className="xs muted">{STATUS_LABEL[t.status]}</span>
      {onRemove && (
        <button className="btn ghost icon xs" onClick={(e) => (e.stopPropagation(), onRemove())} title="Remove dependency">
          <X />
        </button>
      )}
    </div>
  );
}

export function LabelEditor({ labels, onChange, disabled }: { labels: string[]; onChange: (l: string[]) => void; disabled?: boolean }) {
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="row wrap gap-4">
      {labels.map((l) => (
        <span key={l} className="tag" style={{ cursor: disabled ? 'default' : 'pointer' }} onClick={() => !disabled && onChange(labels.filter((x) => x !== l))} title={disabled ? l : 'Remove'}>
          {l}
        </span>
      ))}
      {!disabled && (
        <input
          ref={ref}
          className="input bare sm"
          style={{ width: 80, height: 20 }}
          placeholder="+ label"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && v.trim()) {
              e.preventDefault();
              if (!labels.includes(v.trim())) onChange([...labels, v.trim().toLowerCase()]);
              setV('');
            }
          }}
        />
      )}
    </div>
  );
}

function mergeTimeline(d?: Detail) {
  if (!d) return [];
  const items = [
    ...d.comments.map((c) => ({ ...c, type: 'comment' as const })),
    ...collapseActivity(d.activity.filter((a) => a.verb !== 'commented')).map((a) => ({ ...a, type: 'activity' as const })),
  ];
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
