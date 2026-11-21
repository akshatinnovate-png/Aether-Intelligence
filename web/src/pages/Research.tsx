import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, FileText, FolderPlus, Library, NotebookPen, Plus, Quote, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { save, useCollections, useMe, usePapers, useProjects, useUsers } from '../lib/data';
import { ago, PAPER_STATUS } from '../lib/derive';
import { toastError } from '../lib/store';
import { Avatar, Bar, Empty, Field, Modal, SearchInput, Seg } from '../components/ui';
import type { Paper } from '../types';

const KIND_ICON = { paper: FileText, document: BookOpen, note: NotebookPen, reference: Quote };
const KIND_LABEL = { paper: 'Paper', document: 'Document', note: 'Note', reference: 'Reference' };

export default function Research() {
  const papers = usePapers();
  const collections = useCollections();
  const projects = useProjects();
  const users = useUsers();
  const me = useMe()!;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<Paper['kind'] | null>(null);
  const [newCol, setNewCol] = useState(false);
  const col = params.get('collection');
  const kind = params.get('kind');
  const status = params.get('status');
  const tag = params.get('tag');
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    v ? n.set(k, v) : n.delete(k);
    setParams(n, { replace: true });
  };
  const tags = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of papers) for (const t of p.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [papers]);
  const list = papers.filter(
    (p) =>
      (!col || p.collectionId === col) &&
      (!kind || p.kind === kind) &&
      (!status || p.status === status) &&
      (!tag || p.tags.includes(tag)) &&
      (!q || `${p.title} ${p.authors} ${p.abstract} ${p.tags.join(' ')} ${p.venue}`.toLowerCase().includes(q.toLowerCase())),
  );
  const reading = papers.filter((p) => (p.progress[me.id] ?? 0) > 0 && (p.progress[me.id] ?? 0) < 100);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Knowledge</div>
          <h1 className="h-display">Research vault</h1>
          <p>Papers, technical documents, project notes and references — with collections, tags, reading progress and a proper reading view.</p>
        </div>
        {me.role !== 'guest' && (
          <div className="row gap-6">
            <button className="btn sm" onClick={() => setAdding('note')}>
              <NotebookPen /> New note
            </button>
            <button className="btn sm" onClick={() => setAdding('document')}>
              <BookOpen /> Document
            </button>
            <button className="btn primary sm" onClick={() => setAdding('paper')}>
              <Plus /> Add paper
            </button>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 240px) 1fr', gap: 20 }} className="research-grid">
        <aside className="col gap-16">
          <div>
            <div className="row between" style={{ marginBottom: 6 }}>
              <span className="eyebrow">Collections</span>
              {me.role !== 'guest' && (
                <button className="btn ghost icon xs" title="New collection" onClick={() => setNewCol(true)}>
                  <FolderPlus />
                </button>
              )}
            </div>
            <div className="nav" style={{ padding: 0 }}>
              <button className={`nav-item${!col ? ' active' : ''}`} style={!col ? { background: 'var(--panel-2)', color: 'var(--text)' } : undefined} onClick={() => setParam('collection', null)}>
                <Library /> <span className="nav-text">Everything</span> <span className="count">{papers.length}</span>
              </button>
              {collections.map((c) => (
                <button key={c.id} className="nav-item" style={col === c.id ? { background: 'var(--panel-2)', color: 'var(--text)' } : undefined} onClick={() => setParam('collection', c.id)} title={c.description}>
                  <span className="swatch" style={{ background: 'var(--line-strong)' }} /> <span className="nav-text trunc">{c.name}</span> <span className="count">{c.count}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Status</div>
            <div className="row wrap gap-4">
              {(Object.keys(PAPER_STATUS) as Paper['status'][]).map((s) => (
                <button key={s} className={`chip${status === s ? ' on' : ''}`} onClick={() => setParam('status', status === s ? null : s)}>
                  {PAPER_STATUS[s]} <span className="mono faint">{papers.filter((p) => p.status === s).length}</span>
                </button>
              ))}
            </div>
          </div>
          {tags.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Tags</div>
              <div className="row wrap gap-4">
                {tags.slice(0, 30).map(([t, n]) => (
                  <button key={t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setParam('tag', tag === t ? null : t)}>
                    #{t} <span className="mono faint">{n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {reading.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Continue reading</div>
              <div className="col gap-6">
                {reading.slice(0, 5).map((p) => (
                  <Link key={p.id} to={`/research/${p.id}`} className="col gap-4">
                    <span className="small serif clamp2" style={{ fontSize: 14 }}>{p.title}</span>
                    <Bar pct={p.progress[me.id]} tone="accent" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>
        <div className="col gap-12" style={{ minWidth: 0 }}>
          <div className="row wrap gap-6">
            <SearchInput value={q} onChange={setQ} placeholder="Title, author, abstract, tag" width={300} />
            <Seg value={(kind ?? 'all') as string} onChange={(v) => setParam('kind', v === 'all' ? null : v)} options={[{ id: 'all', label: 'All' }, { id: 'paper', label: 'Papers' }, { id: 'document', label: 'Documents' }, { id: 'note', label: 'Notes' }, { id: 'reference', label: 'References' }]} />
          </div>
          {list.length ? (
            <div className="panel">
              <div className="list">
                {list.map((p) => {
                  const I = KIND_ICON[p.kind];
                  const proj = projects.find((x) => x.id === p.projectId);
                  const mine = p.progress[me.id];
                  const readers = Object.keys(p.progress).length;
                  return (
                    <button key={p.id} className="li" style={{ alignItems: 'flex-start', padding: '14px 16px', gap: 14 }} onClick={() => nav(`/research/${p.id}`)}>
                      <I size={16} className="muted" style={{ marginTop: 3, flex: 'none' }} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="serif" style={{ fontSize: 17, lineHeight: 1.3, color: 'var(--text)' }}>{p.title}</div>
                        <div className="small muted trunc" style={{ marginTop: 3 }}>
                          {[p.authors, p.venue, p.year].filter(Boolean).join(' · ') || KIND_LABEL[p.kind]}
                        </div>
                        {p.abstract && <div className="small t2 clamp2" style={{ marginTop: 6, maxWidth: 820 }}>{p.abstract}</div>}
                        <div className="row wrap gap-6" style={{ marginTop: 8 }}>
                          <span className={`badge${p.status === 'reading' ? ' amber' : p.status === 'read' || p.status === 'published' ? ' accent' : ''}`}>{PAPER_STATUS[p.status]}</span>
                          {p.tags.map((t) => (
                            <span key={t} className="tag">
                              #{t}
                            </span>
                          ))}
                          {proj && (
                            <span className="badge">
                              <span className="swatch" style={{ background: proj.color }} />
                              {proj.name}
                            </span>
                          )}
                          {p.attachmentId && <span className="badge mono">PDF</span>}
                        </div>
                      </div>
                      <div className="col gap-6" style={{ width: 130, flex: 'none', alignItems: 'flex-end' }}>
                        {mine !== undefined ? (
                          <>
                            <span className="mono xs muted">{mine}% read</span>
                            <Bar pct={mine} tone="accent" />
                          </>
                        ) : (
                          <span className="xs faint">not started</span>
                        )}
                        <span className="xs faint">{readers ? `${readers} reader${readers > 1 ? 's' : ''}` : ''}</span>
                        <span className="row gap-4 xs faint">
                          <Avatar user={users.find((u) => u.id === p.addedBy)} size={14} /> {ago(p.updatedAt)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="panel">
              <Empty icon={<Library />} title={papers.length ? 'Nothing matches' : 'The vault is empty'}>
                {papers.length ? 'Clear a filter.' : 'Add a paper by arXiv id or DOI, upload a PDF, or start a note.'}
              </Empty>
            </div>
          )}
        </div>
      </div>
      {adding && <PaperForm kind={adding} onClose={() => setAdding(null)} defaultCollection={col} />}
      {newCol && <CollectionForm onClose={() => setNewCol(false)} />}
      <style>{`@media (max-width: 820px) { .research-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function CollectionForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  return (
    <Modal title="New collection" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => save('collections', '/api/collections', 'post', { name, description }).then(onClose, toastError)}>Create</button></>}>
      <Field label="Name">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Speech & voice" />
      </Field>
      <Field label="Description">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function PaperForm({ kind, onClose, initial, defaultCollection }: { kind: Paper['kind']; onClose: () => void; initial?: Paper & { body?: string }; defaultCollection?: string | null }) {
  const collections = useCollections();
  const projects = useProjects();
  const nav = useNavigate();
  const [f, setF] = useState({
    kind: initial?.kind ?? kind,
    title: initial?.title ?? '',
    authors: initial?.authors ?? '',
    venue: initial?.venue ?? '',
    year: initial?.year ?? ('' as number | ''),
    url: initial?.url ?? '',
    doi: initial?.doi ?? '',
    abstract: initial?.abstract ?? '',
    body: initial?.body ?? '',
    tags: initial?.tags.join(', ') ?? '',
    status: initial?.status ?? (kind === 'note' || kind === 'document' ? 'draft' : 'to_read'),
    collectionId: initial?.collectionId ?? defaultCollection ?? '',
    projectId: initial?.projectId ?? '',
    attachmentId: initial?.attachmentId ?? null,
  });
  const [lookup, setLookup] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const doLookup = async () => {
    setBusy(true);
    try {
      const r = await api.get<Partial<typeof f>>(`/api/papers/lookup?q=${encodeURIComponent(lookup.trim())}`);
      setF((x) => ({ ...x, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)) }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    try {
      const body = { ...f, year: f.year || null, tags: f.tags.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean), collectionId: f.collectionId || null, projectId: f.projectId || null };
      const row = initial ? await save('papers', `/api/papers/${initial.id}`, 'patch', body) : await save('papers', '/api/papers', 'post', body);
      onClose();
      if (!initial) nav(`/research/${row.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const isLit = f.kind === 'paper' || f.kind === 'reference';
  return (
    <Modal
      title={initial ? 'Edit entry' : `Add ${KIND_LABEL[f.kind].toLowerCase()}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !f.title.trim()} onClick={submit}>
            {initial ? 'Save' : 'Add to vault'}
          </button>
        </>
      }
    >
      {!initial && isLit && (
        <div className="row gap-6">
          <input className="input mono" placeholder="arXiv id (2212.04356), arXiv URL or DOI — fills the fields" value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLookup()} />
          <button className="btn" disabled={!lookup.trim() || busy} onClick={doLookup}>
            Look up
          </button>
        </div>
      )}
      <div className="grid-3">
        <Field label="Type">
          <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Paper['kind'] })}>
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Paper['status'] })}>
            {Object.entries(PAPER_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Collection">
          <select className="select" value={f.collectionId ?? ''} onChange={(e) => setF({ ...f, collectionId: e.target.value })}>
            <option value="">None</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Title">
        <input className="input serif" style={{ fontSize: 16, height: 38 }} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      {isLit && (
        <div className="grid-3">
          <Field label="Authors">
            <input className="input" value={f.authors} onChange={(e) => setF({ ...f, authors: e.target.value })} />
          </Field>
          <Field label="Venue">
            <input className="input" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="NeurIPS" />
          </Field>
          <Field label="Year">
            <input className="input mono" type="number" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value ? Number(e.target.value) : '' })} />
          </Field>
          <Field label="URL">
            <input className="input mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          </Field>
          <Field label="DOI">
            <input className="input mono" value={f.doi} onChange={(e) => setF({ ...f, doi: e.target.value })} />
          </Field>
        </div>
      )}
      <div className="grid-2">
        <Field label="Tags" hint="Comma separated">
          <input className="input" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="speech, asr" />
        </Field>
        <Field label="Project">
          <select className="select" value={f.projectId ?? ''} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
            <option value="">None</option>
            {projects.filter((p) => !p.archived).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Abstract / summary">
        <textarea className="textarea serif" style={{ fontSize: 15 }} value={f.abstract} onChange={(e) => setF({ ...f, abstract: e.target.value })} />
      </Field>
      {!initial && (
        <Field label={isLit ? 'Your notes (markdown)' : 'Content (markdown)'}>
          <textarea className="textarea mono" style={{ minHeight: 140, fontSize: 12.5 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
      )}
      <Field label="Attachment" hint="PDF or any file up to 10 MB, stored in the lab database.">
        <label className="btn sm" style={{ alignSelf: 'flex-start' }}>
          <Upload /> {file ?? (f.attachmentId ? 'Replace file' : 'Upload file')}
          <input
            type="file"
            hidden
            onChange={async (e) => {
              const fl = e.target.files?.[0];
              if (!fl) return;
              setBusy(true);
              try {
                const r = await api.upload(fl);
                setF((x) => ({ ...x, attachmentId: r.id }));
                setFile(r.name);
              } catch (er) {
                toastError(er);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </Field>
    </Modal>
  );
}
