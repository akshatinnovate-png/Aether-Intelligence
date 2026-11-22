import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ExternalLink, FileUp, Inbox as InboxIcon, Plus, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useMe, useProjects, useTasks, useUsers } from '../lib/data';
import { ago, dueLabel } from '../lib/derive';
import { useUI } from '../lib/store';
import { Avatar, Empty } from '../components/ui';
import { canReviewTask, deliverableState, ReviewButtons, SUB_LABEL, SubmissionCard, SubmitForm } from '../components/Deliverable';
import type { Task } from '../types';

interface Recent {
  id: string;
  taskId: string;
  url: string;
  title: string;
  status: 'pending' | 'approved' | 'changes_requested';
  userId: string | null;
  createdAt: string;
  taskTitle: string;
  number: number;
  pkey: string;
  pname: string;
  color: string;
}

export default function Submissions() {
  const me = useMe()!;
  const tasks = useTasks();
  const projects = useProjects();
  const users = useUsers();
  const { openCreateTask, setAssistant } = useUI();
  const recent = useQuery({ queryKey: ['submissions', 'overview', tasks.length], queryFn: () => api.get<{ recent: Recent[] }>('/api/submissions/overview') });
  const proj = (t: Task) => projects.find((p) => p.id === t.projectId);
  const toHandIn = tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done' && ['to_submit', 'changes'].includes(deliverableState(t)));
  const toReview = tasks.filter((t) => t.submission?.status === 'pending' && canReviewTask(me, t, proj(t)));
  const waitingOn = tasks.filter((t) => t.reporterId === me.id && t.assigneeId !== me.id && t.status !== 'done' && ['to_submit', 'changes'].includes(deliverableState(t)));

  const TaskHead = ({ t }: { t: Task }) => {
    const p = proj(t);
    const due = dueLabel(t.dueDate);
    const by = users.find((u) => u.id === (t.assigneeId === me.id ? t.reporterId : t.assigneeId));
    return (
      <div className="row between wrap gap-6">
        <Link to={`/projects/${p?.key}?task=${t.id}`} className="row gap-6" style={{ minWidth: 0 }}>
          <span className="swatch" style={{ background: p?.color }} />
          <span className="key">
            {p?.key}-{t.number}
          </span>
          <span style={{ fontWeight: 500 }} className="trunc">
            {t.title}
          </span>
        </Link>
        <span className="row gap-6 xs muted">
          {by && (
            <>
              <Avatar user={by} size={16} /> {t.assigneeId === me.id ? `for ${by.name}` : by.name}
            </>
          )}
          {due.text && <span className={due.tone}>· due {due.text}</span>}
        </span>
      </div>
    );
  };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Deliverables · Google Drive</div>
          <h1 className="h-display">Submissions</h1>
          <p>Everything is handed in as a Google Drive link. Submit here, review here, and the task moves on by itself.</p>
        </div>
        <div className="row gap-6">
          <button className="btn sm" onClick={() => setAssistant(true)}>
            <Sparkles /> Ask Aether
          </button>
          {me.role !== 'guest' && (
            <button className="btn primary sm" onClick={() => openCreateTask({ deliverable: true })}>
              <Plus /> Request a deliverable
            </button>
          )}
        </div>
      </div>

      <section style={{ marginBottom: 28 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 className="h2">You need to hand in</h2>
          <span className="badge mono">{toHandIn.length}</span>
        </div>
        {toHandIn.length ? (
          <div className="col gap-12">
            {toHandIn.map((t) => (
              <div key={t.id} className="panel" style={{ padding: 14, borderColor: 'var(--accent-line)' }}>
                <TaskHead t={t} />
                {t.deliverableNote && <div className="small t2" style={{ margin: '8px 0 0' }}>Expected: {t.deliverableNote}</div>}
                {t.submission?.status === 'changes_requested' && (
                  <div className="err-box" style={{ marginTop: 10 }}>
                    Changes requested: {t.submission.reviewNote}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <SubmitForm task={t} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel">
            <Empty icon={<FileUp />} title="Nothing to hand in">When someone asks you for a deck, report or video, it appears here with a box for the Drive link.</Empty>
          </div>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 className="h2">Waiting for your review</h2>
          <span className="badge mono">{toReview.length}</span>
        </div>
        {toReview.length ? (
          <div className="col gap-12">
            {toReview.map((t) => (
              <div key={t.id} className="panel" style={{ padding: 14 }}>
                <TaskHead t={t} />
                <div className="col gap-12" style={{ marginTop: 12 }}>
                  <SubmissionCard sub={t.submission!} />
                  <ReviewButtons sub={t.submission!} taskId={t.id} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel">
            <Empty icon={<InboxIcon />} title="Nothing to review">Hand-ins from people you asked will appear here.</Empty>
          </div>
        )}
      </section>

      {waitingOn.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 className="h2">Waiting on others</h2>
            <span className="badge mono">{waitingOn.length}</span>
          </div>
          <div className="panel">
            <div className="list">
              {waitingOn.map((t) => {
                const p = proj(t);
                const who = users.find((u) => u.id === t.assigneeId);
                const due = dueLabel(t.dueDate);
                return (
                  <Link key={t.id} to={`/projects/${p?.key}?task=${t.id}`} className="li">
                    <Avatar user={who} size={20} />
                    <span className="small">{who?.name ?? 'Unassigned'}</span>
                    <span className="key">
                      {p?.key}-{t.number}
                    </span>
                    <span className="small trunc grow">{t.title}</span>
                    {t.submission?.status === 'changes_requested' && <span className="badge red">changes requested</span>}
                    {due.text && <span className={`xs ${due.tone || 'muted'}`}>{due.text}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="h2" style={{ marginBottom: 10 }}>Recent submissions</h2>
        <div className="panel">
          <div className="list">
            {(recent.data?.recent ?? []).map((s) => {
              const by = users.find((u) => u.id === s.userId);
              return (
                <div key={s.id} className="li">
                  <Avatar user={by} size={20} />
                  <a href={s.url} target="_blank" rel="noreferrer" className="row gap-6 small" style={{ minWidth: 0 }}>
                    <span className="trunc">{s.title}</span> <ExternalLink size={11} className="muted" />
                  </a>
                  <Link to={`/projects/${s.pkey}?task=${s.taskId}`} className="xs muted trunc grow">
                    {s.pkey}-{s.number} · {s.taskTitle}
                  </Link>
                  <span className={`badge ${SUB_LABEL[s.status].tone}`}>{SUB_LABEL[s.status].text}</span>
                  <span className="xs faint">{ago(s.createdAt)}</span>
                </div>
              );
            })}
            {recent.data && !recent.data.recent.length && <div className="li faint small">No submissions yet.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
