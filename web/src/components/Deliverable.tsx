import { useState } from 'react';
import { Check, ExternalLink, FileUp, RotateCcw, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { qc, upsertRows, useMe, useProjects, useUsers } from '../lib/data';
import { ago, can } from '../lib/derive';
import { toast, toastError } from '../lib/store';
import { Avatar } from './ui';
import type { Project, Submission, Task } from '../types';

export const DRIVE_RE = /^https:\/\/(drive|docs)\.google\.com\//;
export const SUB_LABEL: Record<Submission['status'], { text: string; tone: string }> = {
  pending: { text: 'Waiting for review', tone: 'amber' },
  approved: { text: 'Approved', tone: 'green' },
  changes_requested: { text: 'Changes requested', tone: 'red' },
};

export function deliverableState(t: Task): 'none' | 'to_submit' | 'pending' | 'changes' | 'approved' {
  if (!t.deliverable && !t.submission) return 'none';
  if (!t.submission) return 'to_submit';
  if (t.submission.status === 'pending') return 'pending';
  if (t.submission.status === 'changes_requested') return 'changes';
  return 'approved';
}
export function canReviewTask(me: { id: string; role: string }, t: Task, p?: Project) {
  return can(me.role as never, 'admin') || t.reporterId === me.id || p?.leadId === me.id;
}
export function canSubmitTask(me: { id: string; role: string }, t: Task, p?: Project) {
  if (me.role === 'guest') return false;
  return t.assigneeId === me.id || can(me.role as never, 'admin') || !!p?.members.includes(me.id);
}

async function refreshTask(id: string) {
  const all = await api.get<Task[]>('/api/tasks');
  const t = all.find((x) => x.id === id);
  if (t) upsertRows('tasks', [t]);
  qc.invalidateQueries({ queryKey: ['task-detail', id] });
  qc.invalidateQueries({ queryKey: ['submissions'] });
}

/** Paste a Google Drive link to hand in work. */
export function SubmitForm({ task, compact, onDone }: { task: Task; compact?: boolean; onDone?: () => void }) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = DRIVE_RE.test(url.trim());
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ title: string }>(`/api/tasks/${task.id}/submissions`, { url: url.trim(), note });
      toast({ title: `Submitted ${r.title}`, body: 'Sent for review.' });
      setUrl('');
      setNote('');
      await refreshTask(task.id);
      onDone?.();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col gap-6">
      <div className="row gap-6">
        <input className="input" placeholder="Paste the Google Drive link (Docs, Slides, Sheets, file or folder)" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && valid && submit()} />
        <button className="btn primary" disabled={!valid || busy} onClick={submit}>
          <Upload /> {busy ? 'Submitting…' : 'Submit'}
        </button>
      </div>
      {url && !valid && <span className="xs red">Must be a Google Drive link (drive.google.com or docs.google.com). Set sharing to “Anyone in the lab with the link can view”.</span>}
      {!compact && <input className="input sm" placeholder="Note for the reviewer (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
    </div>
  );
}

export function ReviewButtons({ sub, taskId, onDone }: { sub: Submission; taskId: string; onDone?: () => void }) {
  const [changes, setChanges] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const review = async (decision: 'approve' | 'changes') => {
    setBusy(true);
    try {
      await api.post(`/api/submissions/${sub.id}/review`, { decision, note });
      toast({ title: decision === 'approve' ? 'Approved — task completed' : 'Sent back with your note' });
      await refreshTask(taskId);
      onDone?.();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  if (changes)
    return (
      <div className="col gap-6">
        <textarea className="textarea" autoFocus placeholder="What needs to change?" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row gap-6">
          <button className="btn danger sm" disabled={!note.trim() || busy} onClick={() => review('changes')}>
            <RotateCcw /> Send back
          </button>
          <button className="btn ghost sm" onClick={() => setChanges(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  return (
    <div className="row gap-6">
      <button className="btn primary sm" disabled={busy} onClick={() => review('approve')}>
        <Check /> Approve
      </button>
      <button className="btn sm" disabled={busy} onClick={() => setChanges(true)}>
        <RotateCcw /> Request changes
      </button>
    </div>
  );
}

export function SubmissionCard({ sub }: { sub: Submission }) {
  const users = useUsers();
  const by = users.find((u) => u.id === sub.userId);
  const rv = users.find((u) => u.id === sub.reviewerId);
  const l = SUB_LABEL[sub.status];
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="row between wrap gap-6">
        <a href={sub.url} target="_blank" rel="noreferrer" className="row gap-6" style={{ fontWeight: 500 }}>
          <FileUp size={15} className="accent-text" />
          {sub.title}
          <ExternalLink size={12} className="muted" />
        </a>
        <span className={`badge ${l.tone}`}>{l.text}</span>
      </div>
      <div className="row xs muted" style={{ marginTop: 6 }}>
        <Avatar user={by} size={16} /> {by?.name ?? 'Someone'} · {ago(sub.createdAt)}
      </div>
      {sub.note && <div className="small t2" style={{ marginTop: 6 }}>“{sub.note}”</div>}
      {sub.reviewNote && (
        <div className="small" style={{ marginTop: 8, paddingLeft: 10, borderLeft: `2px solid var(--${l.tone === 'red' ? 'red' : 'accent'})` }}>
          <span className="muted">{rv?.name ?? 'Reviewer'}:</span> {sub.reviewNote}
        </div>
      )}
    </div>
  );
}

/** The deliverable block in the task drawer: what's expected, the latest hand-in, submit or review. */
export function DeliverablePanel({ task, history }: { task: Task; history: Submission[] }) {
  const me = useMe()!;
  const projects = useProjects();
  const p = projects.find((x) => x.id === task.projectId);
  const state = deliverableState(task);
  const reviewer = canReviewTask(me, task, p);
  const submitter = canSubmitTask(me, task, p);
  const latest = task.submission;
  return (
    <section className="panel" style={{ padding: 14, borderColor: state === 'to_submit' || state === 'changes' ? 'var(--accent-line)' : undefined }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="eyebrow">Deliverable · Google Drive</span>
        {latest && <span className={`badge ${SUB_LABEL[latest.status].tone}`}>{SUB_LABEL[latest.status].text}</span>}
        {!latest && <span className="badge accent">Not submitted yet</span>}
      </div>
      {task.deliverableNote && <div className="small t2" style={{ marginBottom: 10 }}>Expected: {task.deliverableNote}</div>}
      <div className="col gap-12">
        {latest && <SubmissionCard sub={latest} />}
        {latest?.status === 'pending' && reviewer && <ReviewButtons sub={latest} taskId={task.id} />}
        {latest?.status === 'pending' && !reviewer && <div className="xs muted">Waiting for the requester to review it.</div>}
        {(state === 'to_submit' || state === 'changes' || (state === 'pending' && submitter && !reviewer)) && submitter && (
          <div className="col gap-6">
            {state !== 'to_submit' && <span className="xs muted">{state === 'changes' ? 'Submit an updated link:' : 'Replace with a newer link:'}</span>}
            <SubmitForm task={task} />
          </div>
        )}
        {history.length > 1 && (
          <details>
            <summary className="xs muted" style={{ cursor: 'pointer' }}>Earlier submissions ({history.length - 1})</summary>
            <div className="col gap-6" style={{ marginTop: 8 }}>
              {history.slice(1).map((s) => (
                <SubmissionCard key={s.id} sub={s} />
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
