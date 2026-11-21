import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, FileDown, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { destroy, qc, save, upsertRows, useCollections, useMe, usePapers, useProjects, useUsers } from '../lib/data';
import { fmtDate, PAPER_STATUS } from '../lib/derive';
import { toastError } from '../lib/store';
import { Avatar, Bar, confirmDialog, Empty } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { PaperForm } from './Research';
import type { Paper } from '../types';

export default function PaperReader() {
  const { id } = useParams();
  const papers = usePapers();
  const users = useUsers();
  const projects = useProjects();
  const collections = useCollections();
  const me = useMe()!;
  const nav = useNavigate();
  const paper = papers.find((p) => p.id === id);
  const body = useQuery({ queryKey: ['paper-body', id], queryFn: () => api.get<{ body: string }>(`/api/papers/${id}/body`), enabled: !!id });
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState<string | null>(null);
  const [scrollPct, setScrollPct] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const lastSent = useRef<number>(-1);
  const mine = paper?.progress[me.id] ?? 0;

  // Reading progress follows the scroll position and is saved (debounced) — never moves backwards on its own.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !paper) return;
    let t: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      const pct = max > 40 ? Math.round((el.scrollTop / max) * 100) : 100;
      setScrollPct(pct);
      clearTimeout(t);
      t = setTimeout(() => {
        const next = Math.max(mine, pct);
        if (next > mine && next !== lastSent.current && me.role !== 'guest') {
          lastSent.current = next;
          api.put<Paper>(`/api/papers/${paper.id}/progress`, { progress: next }).then((r) => upsertRows('papers', [r])).catch(() => {});
        }
      }, 900);
    };
    el.addEventListener('scroll', onScroll);
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(t);
    };
  }, [paper?.id, mine, me.role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!paper) return <div className="page">{papers.length ? <Empty title="Not found" /> : null}</div>;
  const setProgress = (p: number) => api.put<Paper>(`/api/papers/${paper.id}/progress`, { progress: p }).then((r) => upsertRows('papers', [r]), toastError);
  const proj = projects.find((p) => p.id === paper.projectId);
  const coll = collections.find((c) => c.id === paper.collectionId);
  const text = body.data?.body ?? '';
  const editable = me.role !== 'guest';
  const isPdf = !!paper.attachmentId;
  return (
    <div className="page full">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', height: '100%', minHeight: 0 }} className="reader-grid">
        <div ref={scroller} className="scroll" style={{ height: '100%' }}>
          <div className="read-progress">
            <i style={{ width: `${scrollPct}%` }} />
          </div>
          <div className="row between" style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 2, background: 'var(--bg)', zIndex: 3 }}>
            <Link to="/research" className="btn ghost sm">
              <ArrowLeft /> Vault
            </Link>
            <div className="row gap-6">
              {paper.url && (
                <a className="btn ghost sm" href={paper.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Source
                </a>
              )}
              {isPdf && (
                <a className="btn ghost sm" href={`/api/files/${paper.attachmentId}`} target="_blank" rel="noreferrer">
                  <FileDown /> File
                </a>
              )}
              {editable && (
                <button className="btn sm" onClick={() => setEditBody(text)}>
                  <Pencil /> {paper.kind === 'paper' || paper.kind === 'reference' ? 'Edit notes' : 'Edit'}
                </button>
              )}
            </div>
          </div>
          {editBody !== null ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 'calc(100% - 60px)' }}>
              <textarea className="textarea mono" style={{ border: 0, borderRight: '1px solid var(--line)', borderRadius: 0, minHeight: '100%', resize: 'none', padding: 24, fontSize: 13 }} autoFocus value={editBody} onChange={(e) => setEditBody(e.target.value)} />
              <div style={{ padding: 24 }}>
                <div className="row end gap-6" style={{ marginBottom: 12 }}>
                  <button className="btn ghost sm" onClick={() => setEditBody(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn primary sm"
                    onClick={async () => {
                      try {
                        await save('papers', `/api/papers/${paper.id}`, 'patch', { body: editBody });
                        qc.setQueryData(['paper-body', paper.id], { body: editBody });
                        setEditBody(null);
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
                <Markdown text={editBody || '*Preview*'} />
              </div>
            </div>
          ) : (
            <article className="reader">
              <div className="eyebrow">
                {paper.kind} {paper.venue && `· ${paper.venue}`} {paper.year && `· ${paper.year}`}
              </div>
              <h1 className="h-display" style={{ fontSize: 40, marginTop: 14, lineHeight: 1.12 }}>
                {paper.title}
              </h1>
              {paper.authors && <div className="serif" style={{ fontSize: 17, color: 'var(--muted)', marginTop: 14, fontStyle: 'italic' }}>{paper.authors}</div>}
              {paper.abstract && <div className="abstract">{paper.abstract}</div>}
              {isPdf && <iframe title="Attachment" src={`/api/files/${paper.attachmentId}`} style={{ width: '100%', height: '80vh', border: '1px solid var(--line)', background: 'var(--panel)', marginBottom: 32 }} />}
              {text ? <Markdown text={text} /> : !paper.abstract && !isPdf ? <p className="muted">Nothing written yet. Use Edit to add content or reading notes.</p> : null}
              <div className="row between" style={{ marginTop: 60, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <span className="muted small">End of document</span>
                {editable && mine < 100 && (
                  <button className="btn primary sm" onClick={() => setProgress(100)}>
                    Mark as read
                  </button>
                )}
              </div>
            </article>
          )}
        </div>
        <aside style={{ borderLeft: '1px solid var(--line)', background: 'var(--panel)', overflow: 'auto', padding: 18 }} className="col gap-16">
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Your progress</div>
            <div className="row">
              <Bar pct={mine} tone="accent" thick />
              <span className="mono small">{mine}%</span>
            </div>
            {editable && (
              <div className="row gap-4" style={{ marginTop: 8 }}>
                {[0, 25, 50, 75, 100].map((p) => (
                  <button key={p} className={`btn xs${mine === p ? ' on' : ''}`} onClick={() => setProgress(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Meta label="Status">
            <select className="select sm" disabled={!editable} value={paper.status} onChange={(e) => save('papers', `/api/papers/${paper.id}`, 'patch', { status: e.target.value }).catch(toastError)}>
              {Object.entries(PAPER_STATUS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Meta>
          <Meta label="Collection">{coll ? <Link to={`/research?collection=${coll.id}`}>{coll.name}</Link> : <span className="faint">—</span>}</Meta>
          <Meta label="Project">
            {proj ? (
              <Link to={`/projects/${proj.key}`} className="row gap-6">
                <span className="swatch" style={{ background: proj.color }} />
                {proj.name}
              </Link>
            ) : (
              <span className="faint">—</span>
            )}
          </Meta>
          <Meta label="Tags">
            <div className="row wrap gap-4">
              {paper.tags.map((t) => (
                <Link key={t} to={`/research?tag=${t}`} className="tag">
                  #{t}
                </Link>
              ))}
              {!paper.tags.length && <span className="faint">—</span>}
            </div>
          </Meta>
          {paper.doi && (
            <Meta label="DOI">
              <a className="mono xs" href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">
                {paper.doi}
              </a>
            </Meta>
          )}
          <Meta label="Added">
            <span className="row gap-6 small">
              <Avatar user={users.find((u) => u.id === paper.addedBy)} size={16} /> {users.find((u) => u.id === paper.addedBy)?.name ?? '—'} · {fmtDate(paper.createdAt, 'd MMM yyyy')}
            </span>
          </Meta>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Team reading</div>
            <div className="col gap-6">
              {Object.entries(paper.progress).map(([uid, p]) => {
                const u = users.find((x) => x.id === uid);
                return (
                  <div key={uid} className="row">
                    <Avatar user={u} size={18} />
                    <span className="small trunc" style={{ width: 100 }}>{u?.name}</span>
                    <Bar pct={p} />
                    <span className="mono xs muted">{p}%</span>
                  </div>
                );
              })}
              {!Object.keys(paper.progress).length && <span className="faint small">Nobody has started yet.</span>}
            </div>
          </div>
          {editable && (
            <div className="row gap-6" style={{ marginTop: 'auto' }}>
              <button className="btn sm grow" onClick={() => setEditing(true)}>
                <Pencil /> Edit details
              </button>
              <button
                className="btn ghost icon sm"
                title="Delete"
                onClick={async () => {
                  if (!(await confirmDialog(`Delete “${paper.title}”?`, 'Reading progress and notes are deleted too.', { danger: true, ok: 'Delete' }))) return;
                  await destroy('papers', `/api/papers/${paper.id}`, paper.id).catch(toastError);
                  nav('/research');
                }}
              >
                <Trash2 />
              </button>
            </div>
          )}
        </aside>
      </div>
      {editing && <PaperForm kind={paper.kind} initial={paper} onClose={() => setEditing(false)} />}
      <style>{`@media (max-width: 1024px) { .reader-grid { grid-template-columns: 1fr !important; } .reader-grid > aside { border-left: 0 !important; border-top: 1px solid var(--line); } }`}</style>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="col gap-4">
      <span className="eyebrow">{label}</span>
      <div className="small">{children}</div>
    </div>
  );
}
