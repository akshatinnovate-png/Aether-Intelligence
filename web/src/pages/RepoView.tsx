import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, CircleCheck, CircleDot, CircleX, Clock, ExternalLink, File, FilePlus, Folder, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, Loader, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { qc, useProjects, useTasks } from '../lib/data';
import { ago } from '../lib/derive';
import { toast, toastError } from '../lib/store';
import { confirmDialog, Empty, Field, Modal, Picker, Seg } from '../components/ui';
import { CodeEditor } from '../components/CodeEditor';
import { Markdown } from '../components/Markdown';
import { ConnectGithub, type GhRepo, useGhStatus } from './Code';

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}
interface Change {
  original: string | null; // null = new file
  current: string | null; // null = deleted
}
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|mp4|mov|mp3|wav|woff2?|ttf|otf|jar|exe|dll|so|bin|onnx|pt|pth|h5|pkl|parquet)$/i;

export default function RepoView() {
  const { owner, repo } = useParams();
  const full = `${owner}/${repo}`;
  const status = useGhStatus();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'code') as 'code' | 'commits' | 'branches' | 'pulls' | 'actions';
  const projects = useProjects();
  const project = projects.find((p) => p.repoFullName?.toLowerCase() === full.toLowerCase());
  const info = useQuery({ queryKey: ['gh-repo', full], queryFn: () => api.gh<GhRepo>(`/repos/${full}`), enabled: !!status.data?.connected });
  const [branch, setBranch] = useState<string | null>(params.get('branch'));
  useEffect(() => {
    if (!branch && info.data) setBranch(info.data.default_branch);
  }, [info.data, branch]);
  if (status.data && !status.data.connected) return <div className="page"><ConnectGithub status={status.data} /></div>;
  const setTab = (t: string) => {
    params.set('tab', t);
    setParams(params, { replace: true });
  };
  return (
    <div className="page full">
      <div style={{ padding: '16px 20px 0', borderBottom: '1px solid var(--line)' }}>
        <div className="row between wrap gap-12">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow row gap-6">
              {project ? (
                <Link to={`/projects/${project.key}`} className="row gap-6">
                  <span className="swatch" style={{ background: project.color }} />
                  {project.name}
                </Link>
              ) : (
                'Not linked to a project'
              )}
              {info.data?.private && <span className="badge">Private</span>}
            </div>
            <h1 className="h1 mono" style={{ fontSize: 22, marginTop: 8 }}>
              <span className="muted">{owner}/</span>
              {repo}
            </h1>
            {info.data?.description && <div className="small muted" style={{ marginTop: 4 }}>{info.data.description}</div>}
          </div>
          <div className="row gap-6">
            {branch && <BranchPicker full={full} branch={branch} onChange={setBranch} />}
            <a className="btn ghost sm" href={`https://github.com/${full}`} target="_blank" rel="noreferrer">
              <ExternalLink /> GitHub
            </a>
          </div>
        </div>
        <div className="tabs" style={{ marginTop: 12, borderBottom: 0 }}>
          {[
            ['code', 'Code', <File key="i" />],
            ['commits', 'Commits', <GitCommitHorizontal key="i" />],
            ['branches', 'Branches', <GitBranch key="i" />],
            ['pulls', 'Pull requests', <GitPullRequest key="i" />],
            ['actions', 'Actions', <CircleDot key="i" />],
          ].map(([id, label, icon]) => (
            <button key={id as string} className={tab === id ? 'active' : ''} onClick={() => setTab(id as string)}>
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {info.error ? (
          <div className="pad">
            <div className="err-box">{(info.error as Error).message}</div>
          </div>
        ) : !branch ? (
          <div className="empty">
            <span className="spin" />
          </div>
        ) : tab === 'code' ? (
          <CodeTab full={full} branch={branch} onBranch={setBranch} />
        ) : tab === 'commits' ? (
          <Commits full={full} branch={branch} />
        ) : tab === 'branches' ? (
          <Branches full={full} defaultBranch={info.data?.default_branch ?? 'main'} onOpen={(b) => (setBranch(b), setTab('code'))} />
        ) : tab === 'pulls' ? (
          <Pulls full={full} branch={branch} defaultBranch={info.data?.default_branch ?? 'main'} />
        ) : (
          <Actions full={full} />
        )}
      </div>
    </div>
  );
}

function BranchPicker({ full, branch, onChange }: { full: string; branch: string; onChange: (b: string) => void }) {
  const branches = useQuery({ queryKey: ['gh-branches', full], queryFn: () => api.gh<{ name: string }[]>(`/repos/${full}/branches?per_page=100`) });
  return (
    <Picker value={branch} search options={(branches.data ?? [{ name: branch }]).map((b) => ({ value: b.name, label: b.name, icon: <GitBranch /> }))} onChange={(v) => v && onChange(v)} width={260}>
      <GitBranch />
      <span className="mono">{branch}</span>
      <ChevronDown />
    </Picker>
  );
}

// ---------- code tab ----------
function CodeTab({ full, branch, onBranch }: { full: string; branch: string; onBranch: (b: string) => void }) {
  const tree = useQuery({
    queryKey: ['gh-tree', full, branch],
    queryFn: async () => {
      try {
        return (await api.gh<{ tree: TreeEntry[]; truncated: boolean }>(`/repos/${full}/git/trees/${encodeURIComponent(branch)}?recursive=1`)).tree;
      } catch (e) {
        if ((e as { status?: number }).status === 409 || /empty/i.test(String((e as Error).message))) return [];
        throw e;
      }
    },
  });
  const [open, setOpen] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [loaded, setLoaded] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [newFile, setNewFile] = useState(false);
  useEffect(() => {
    setChanges({});
    setLoaded({});
    setOpen(null);
  }, [branch]);

  const entries = useMemo(() => {
    const base = (tree.data ?? []).filter((t) => !(changes[t.path]?.current === null));
    const extra = Object.entries(changes)
      .filter(([p, c]) => c.original === null && c.current !== null && !base.some((b) => b.path === p))
      .map(([p]) => ({ path: p, type: 'blob' as const, sha: 'new' }));
    // Ensure parent folders of new files exist in the tree.
    const dirs = new Set(base.filter((b) => b.type === 'tree').map((b) => b.path));
    const extraDirs: TreeEntry[] = [];
    for (const e of extra) {
      const parts = e.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const d = parts.slice(0, i).join('/');
        if (!dirs.has(d)) {
          dirs.add(d);
          extraDirs.push({ path: d, type: 'tree', sha: 'new' });
        }
      }
    }
    return [...base, ...extraDirs, ...extra];
  }, [tree.data, changes]);
  const readme = entries.find((e) => /^readme\.md$/i.test(e.path));
  const readmeQ = useQuery({ queryKey: ['gh-file', full, branch, readme?.path], queryFn: () => api.ghRaw(`/repos/${full}/contents/${readme!.path}?ref=${encodeURIComponent(branch)}`), enabled: !!readme && !open });

  const openFile = async (path: string) => {
    setOpen(path);
    if (loaded[path] !== undefined || changes[path]) return;
    if (BINARY.test(path)) return;
    try {
      const text = await qc.fetchQuery({ queryKey: ['gh-file', full, branch, path], queryFn: () => api.ghRaw(`/repos/${full}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`) });
      setLoaded((l) => ({ ...l, [path]: text }));
    } catch (e) {
      toastError(e);
    }
  };
  const content = open ? changes[open]?.current ?? loaded[open] : undefined;
  const edit = (path: string, value: string) => {
    setChanges((c) => {
      const original = c[path] ? c[path].original : loaded[path] ?? null;
      if (original === value) {
        const n = { ...c };
        delete n[path];
        return n;
      }
      return { ...c, [path]: { original, current: value } };
    });
  };
  const changed = Object.keys(changes);
  return (
    <div className="code-layout" style={{ flex: 1, minHeight: 0 }}>
      <div className="tree">
        <div className="row between" style={{ padding: '4px 10px 8px' }}>
          <span className="eyebrow">Files</span>
          <div className="row gap-2">
            <button className="btn ghost icon xs" title="New file" onClick={() => setNewFile(true)}>
              <FilePlus />
            </button>
            <label className="btn ghost icon xs" title="Upload files">
              <Upload />
              <input
                type="file"
                multiple
                hidden
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])];
                  for (const f of files) {
                    const text = await f.text();
                    setChanges((c) => ({ ...c, [f.name]: { original: null, current: text } }));
                  }
                  toast({ title: `${files.length} file${files.length > 1 ? 's' : ''} staged`, body: 'Commit to push them.' });
                }}
              />
            </label>
          </div>
        </div>
        {tree.isLoading && <div className="empty"><span className="spin" /></div>}
        {tree.data && !entries.length && <div className="xs muted" style={{ padding: 12 }}>Empty repository. Create a file to make the first commit.</div>}
        <TreeLevel entries={entries} prefix="" depth={0} expanded={expanded} setExpanded={setExpanded} open={open} onOpen={openFile} changes={changes} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        {changed.length > 0 && (
          <div className="row" style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', background: 'var(--amber-soft)' }}>
            <span className="small amber">
              {changed.length} uncommitted change{changed.length > 1 ? 's' : ''}
            </span>
            <span className="grow" />
            <button className="btn ghost sm" onClick={async () => (await confirmDialog('Discard all changes?', undefined, { danger: true, ok: 'Discard' })) && setChanges({})}>
              <RotateCcw /> Discard
            </button>
            <button className="btn primary sm" onClick={() => setCommitting(true)}>
              <GitCommitHorizontal /> Commit {changed.length}
            </button>
          </div>
        )}
        {open ? (
          <>
            <div className="row" style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)' }}>
              <span className="mono small trunc grow">{open}</span>
              {changes[open] && <span className="badge amber">{changes[open].original === null ? 'new' : 'modified'}</span>}
              <a className="btn ghost xs" href={`https://github.com/${full}/blob/${branch}/${open}`} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
              <button
                className="btn ghost xs"
                title="Delete file"
                onClick={async () => {
                  if (!(await confirmDialog(`Delete ${open}?`, 'Staged as a deletion until you commit.', { danger: true, ok: 'Stage deletion' }))) return;
                  setChanges((c) => (c[open]?.original === null ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== open)) : { ...c, [open]: { original: loaded[open] ?? '', current: null } }));
                  setOpen(null);
                }}
              >
                <Trash2 />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {BINARY.test(open) ? (
                <Empty title="Binary file">
                  <a className="accent-text" href={`https://github.com/${full}/blob/${branch}/${open}`} target="_blank" rel="noreferrer">
                    View on GitHub
                  </a>
                </Empty>
              ) : content === undefined ? (
                <div className="empty">
                  <span className="spin" />
                </div>
              ) : (
                <CodeEditor key={open} value={content} filename={open} onChange={(v) => edit(open, v)} onSave={() => changed.length && setCommitting(true)} />
              )}
            </div>
          </>
        ) : (
          <div className="scroll" style={{ flex: 1 }}>
            {readme ? (
              <div style={{ maxWidth: 860, padding: '28px 32px' }}>
                <div className="eyebrow" style={{ marginBottom: 14 }}>README.md</div>
                {readmeQ.data ? <Markdown text={readmeQ.data} /> : <span className="spin" />}
              </div>
            ) : (
              <Empty title="Select a file">Edit any file, then commit. ⌘S opens the commit dialog.</Empty>
            )}
          </div>
        )}
      </div>
      {committing && <CommitDialog full={full} branch={branch} changes={changes} onClose={() => setCommitting(false)} onDone={(b) => {
        setChanges({});
        setLoaded({});
        qc.invalidateQueries({ queryKey: ['gh-tree', full] });
        qc.invalidateQueries({ queryKey: ['gh-file', full] });
        qc.invalidateQueries({ queryKey: ['gh-commits', full] });
        qc.invalidateQueries({ queryKey: ['gh-branches', full] });
        if (b !== branch) onBranch(b);
      }} />}
      {newFile && <NewFileDialog onClose={() => setNewFile(false)} onCreate={(p) => {
        setChanges((c) => ({ ...c, [p]: { original: null, current: '' } }));
        setLoaded((l) => ({ ...l, [p]: '' }));
        setOpen(p);
        setExpanded((e) => new Set([...e, ...p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))]));
      }} />}
    </div>
  );
}

function TreeLevel({ entries, prefix, depth, expanded, setExpanded, open, onOpen, changes }: { entries: TreeEntry[]; prefix: string; depth: number; expanded: Set<string>; setExpanded: (s: Set<string>) => void; open: string | null; onOpen: (p: string) => void; changes: Record<string, Change> }) {
  const children = entries
    .filter((e) => {
      if (!e.path.startsWith(prefix)) return false;
      const rest = e.path.slice(prefix.length);
      return rest && !rest.includes('/');
    })
    .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === 'tree' ? -1 : 1));
  return (
    <>
      {children.map((e) => {
        const name = e.path.slice(prefix.length);
        const isOpen = expanded.has(e.path);
        const dirty = e.type === 'blob' ? !!changes[e.path] : Object.keys(changes).some((p) => p.startsWith(`${e.path}/`));
        return (
          <div key={e.path}>
            <div
              className={`tree-item${open === e.path ? ' active' : ''}${dirty ? ' changed' : ''}`}
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => {
                if (e.type === 'tree') {
                  const n = new Set(expanded);
                  isOpen ? n.delete(e.path) : n.add(e.path);
                  setExpanded(n);
                } else onOpen(e.path);
              }}
            >
              {e.type === 'tree' ? isOpen ? <ChevronDown /> : <ChevronRight /> : <span style={{ width: 13 }} />}
              {e.type === 'tree' ? <Folder /> : <File />}
              <span className="trunc">{name}</span>
            </div>
            {e.type === 'tree' && isOpen && <TreeLevel entries={entries} prefix={`${e.path}/`} depth={depth + 1} expanded={expanded} setExpanded={setExpanded} open={open} onOpen={onOpen} changes={changes} />}
          </div>
        );
      })}
    </>
  );
}

function NewFileDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (path: string) => void }) {
  const [p, setP] = useState('');
  return (
    <Modal title="New file" onClose={onClose} footer={<button className="btn primary" disabled={!p.trim() || p.endsWith('/')} onClick={() => (onCreate(p.trim().replace(/^\/+/, '')), onClose())}>Create</button>}>
      <Field label="Path" hint="Use / for folders, e.g. src/model/train.py">
        <input className="input mono" autoFocus value={p} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && p.trim() && (onCreate(p.trim()), onClose())} />
      </Field>
    </Modal>
  );
}

function CommitDialog({ full, branch, changes, onClose, onDone }: { full: string; branch: string; changes: Record<string, Change>; onClose: () => void; onDone: (branch: string) => void }) {
  const tasks = useTasks();
  const projects = useProjects();
  const project = projects.find((p) => p.repoFullName?.toLowerCase() === full.toLowerCase());
  const openTasks = project ? tasks.filter((t) => t.projectId === project.id && t.status !== 'done') : [];
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'direct' | 'branch'>('direct');
  const [newBranch, setNewBranch] = useState(`update-${new Date().toISOString().slice(0, 10)}`);
  const [pr, setPr] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const target = mode === 'branch' ? newBranch.trim() : branch;
    try {
      const files = Object.entries(changes).map(([path, c]) => ({ path, content: c.current }));
      const r = await api.post<{ sha: string; url: string }>('/api/github/commit', { repo: full, branch: target, fromBranch: mode === 'branch' ? branch : undefined, message, files });
      toast({ title: `Committed ${r.sha.slice(0, 7)} to ${target}` });
      if (mode === 'branch' && pr) {
        const p = await api.gh<{ number: number; html_url: string }>(`/repos/${full}/pulls`, 'POST', { title: message.split('\n')[0], head: target, base: branch, body: message.split('\n').slice(1).join('\n') });
        toast({ title: `Opened PR #${p.number}` });
      }
      onDone(target);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Commit changes" sub={`${full} · ${Object.keys(changes).length} file(s)`} size="lg" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!message.trim() || busy || (mode === 'branch' && !newBranch.trim())} onClick={submit}><GitCommitHorizontal /> {busy ? 'Committing…' : mode === 'branch' && pr ? 'Commit & open PR' : 'Commit'}</button></>}>
      <div className="panel">
        <div className="list">
          {Object.entries(changes).map(([p, c]) => (
            <div key={p} className="li small">
              <span className={`badge mono ${c.current === null ? 'red' : c.original === null ? 'green' : 'amber'}`}>{c.current === null ? 'D' : c.original === null ? 'A' : 'M'}</span>
              <span className="mono trunc">{p}</span>
            </div>
          ))}
        </div>
      </div>
      <Field label="Message" hint={project ? `Mention ${project.key}-N to link a task, or “fixes ${project.key}-N” to complete it.` : undefined}>
        <textarea className="textarea mono" autoFocus style={{ fontSize: 13 }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Short summary on the first line" />
      </Field>
      {openTasks.length > 0 && (
        <div className="row wrap gap-4">
          <span className="xs muted">Reference:</span>
          {openTasks.slice(0, 8).map((t) => (
            <button key={t.id} className="chip" onClick={() => setMessage((m) => `${m}${m.includes('\n') || !m ? '' : '\n\n'}fixes ${project!.key}-${t.number}`)} title={t.title}>
              {project!.key}-{t.number} <span className="faint trunc" style={{ maxWidth: 120 }}>{t.title}</span>
            </button>
          ))}
        </div>
      )}
      <Seg value={mode} onChange={setMode} options={[{ id: 'direct', label: `Commit to ${branch}` }, { id: 'branch', label: 'New branch' }]} />
      {mode === 'branch' && (
        <div className="grid-2">
          <Field label="Branch name">
            <input className="input mono" value={newBranch} onChange={(e) => setNewBranch(e.target.value.replace(/\s+/g, '-'))} />
          </Field>
          <label className="check small" style={{ alignSelf: 'end', height: 32 }}>
            <input type="checkbox" checked={pr} onChange={(e) => setPr(e.target.checked)} /> Open a pull request into {branch}
          </label>
        </div>
      )}
    </Modal>
  );
}

// ---------- commits ----------
interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } };
  author: { login: string; avatar_url: string } | null;
  files?: { filename: string; status: string; additions: number; deletions: number; patch?: string }[];
  stats?: { additions: number; deletions: number };
}
function TaskKeys({ text }: { text: string }) {
  const projects = useProjects();
  const tasks = useTasks();
  const keys = [...new Set([...text.matchAll(/\b([A-Z][A-Z0-9]{1,6})-(\d+)\b/g)].map((m) => m[0]))];
  return (
    <>
      {keys.map((k) => {
        const [pk, n] = k.split('-');
        const p = projects.find((x) => x.key === pk);
        const t = p && tasks.find((x) => x.projectId === p.id && x.number === Number(n));
        return t ? (
          <Link key={k} to={`/projects/${pk}?task=${t.id}`} className="badge accent mono" onClick={(e) => e.stopPropagation()}>
            {k}
          </Link>
        ) : null;
      })}
    </>
  );
}
function Commits({ full, branch }: { full: string; branch: string }) {
  const list = useQuery({ queryKey: ['gh-commits', full, branch], queryFn: () => api.gh<GhCommit[]>(`/repos/${full}/commits?sha=${encodeURIComponent(branch)}&per_page=60`) });
  const [sel, setSel] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['gh-commit', full, sel], queryFn: () => api.gh<GhCommit>(`/repos/${full}/commits/${sel}`), enabled: !!sel });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: sel ? 'minmax(320px, 420px) 1fr' : '1fr', flex: 1, minHeight: 0 }}>
      <div className="scroll" style={{ borderRight: sel ? '1px solid var(--line)' : 0 }}>
        {list.isLoading && <div className="empty"><span className="spin" /></div>}
        {list.error && <div className="pad"><div className="err-box">{(list.error as Error).message}</div></div>}
        <div className="list">
          {(list.data ?? []).map((c) => (
            <button key={c.sha} className="li" style={{ alignItems: 'flex-start', padding: '10px 16px', background: sel === c.sha ? 'var(--panel-2)' : undefined }} onClick={() => setSel(c.sha)}>
              {c.author?.avatar_url ? <img src={c.author.avatar_url} alt="" width={22} height={22} style={{ borderRadius: '50%' }} /> : <span className="avatar empty" />}
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small trunc" style={{ fontWeight: 500 }}>{c.commit.message.split('\n')[0]}</div>
                <div className="row xs muted" style={{ marginTop: 3 }}>
                  <span className="mono">{c.sha.slice(0, 7)}</span>
                  <span>{c.author?.login ?? c.commit.author.name}</span>
                  <span>{ago(c.commit.author.date)}</span>
                  <TaskKeys text={c.commit.message} />
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      {sel && (
        <div className="scroll">
          {detail.data ? (
            <div>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
                <div className="h2" style={{ fontSize: 17 }}>{detail.data.commit.message.split('\n')[0]}</div>
                <pre className="small muted" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--sans)', margin: '6px 0' }}>{detail.data.commit.message.split('\n').slice(1).join('\n').trim()}</pre>
                <div className="row xs muted">
                  <span className="mono">{detail.data.sha.slice(0, 10)}</span>
                  <span className="green">+{detail.data.stats?.additions}</span>
                  <span className="red">−{detail.data.stats?.deletions}</span>
                  <a className="accent-text" href={detail.data.html_url} target="_blank" rel="noreferrer">
                    GitHub ↗
                  </a>
                </div>
              </div>
              <Diff files={detail.data.files ?? []} />
            </div>
          ) : (
            <div className="empty"><span className="spin" /></div>
          )}
        </div>
      )}
    </div>
  );
}

function Diff({ files }: { files: { filename: string; status: string; additions: number; deletions: number; patch?: string }[] }) {
  return (
    <div className="col gap-12" style={{ padding: 16 }}>
      {files.map((f) => (
        <div key={f.filename} className="panel" style={{ overflow: 'hidden' }}>
          <div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)' }}>
            <span className="mono small trunc grow">{f.filename}</span>
            <span className="badge mono">{f.status}</span>
            <span className="mono xs green">+{f.additions}</span>
            <span className="mono xs red">−{f.deletions}</span>
          </div>
          {f.patch ? (
            <div className="diff">
              {f.patch.split('\n').map((l, i) => (
                <div key={i} className={l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>
                  {l || ' '}
                </div>
              ))}
            </div>
          ) : (
            <div className="xs muted" style={{ padding: 12 }}>Binary or large file — no diff.</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- branches ----------
function Branches({ full, defaultBranch, onOpen }: { full: string; defaultBranch: string; onOpen: (b: string) => void }) {
  const branches = useQuery({ queryKey: ['gh-branches', full], queryFn: () => api.gh<{ name: string; commit: { sha: string }; protected: boolean }[]>(`/repos/${full}/branches?per_page=100`) });
  const [name, setName] = useState('');
  const [from, setFrom] = useState(defaultBranch);
  const create = async () => {
    try {
      const ref = await api.gh<{ object: { sha: string } }>(`/repos/${full}/git/ref/heads/${encodeURIComponent(from)}`);
      await api.gh(`/repos/${full}/git/refs`, 'POST', { ref: `refs/heads/${name.trim()}`, sha: ref.object.sha });
      toast({ title: `Created branch ${name}` });
      setName('');
      qc.invalidateQueries({ queryKey: ['gh-branches', full] });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="scroll" style={{ padding: 20, flex: 1 }}>
      <div className="col gap-12" style={{ maxWidth: 860 }}>
        <div className="panel" style={{ padding: 12 }}>
          <div className="row gap-6 wrap">
            <input className="input mono grow" style={{ minWidth: 200 }} placeholder="new-branch-name" value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))} />
            <span className="xs muted">from</span>
            <select className="select" style={{ width: 200 }} value={from} onChange={(e) => setFrom(e.target.value)}>
              {(branches.data ?? []).map((b) => (
                <option key={b.name}>{b.name}</option>
              ))}
            </select>
            <button className="btn primary" disabled={!name.trim()} onClick={create}>
              <Plus /> Create branch
            </button>
          </div>
        </div>
        <div className="panel">
          <div className="list">
            {(branches.data ?? []).map((b) => (
              <div key={b.name} className="li">
                <GitBranch size={14} className="muted" />
                <button className="mono small grow" style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }} onClick={() => onOpen(b.name)}>
                  {b.name}
                </button>
                {b.name === defaultBranch && <span className="badge accent">default</span>}
                {b.protected && <span className="badge">protected</span>}
                <span className="mono xs faint">{b.commit.sha.slice(0, 7)}</span>
                {b.name !== defaultBranch && !b.protected && (
                  <button
                    className="btn ghost icon xs"
                    title="Delete branch"
                    onClick={async () => {
                      if (!(await confirmDialog(`Delete branch ${b.name}?`, 'This deletes it on GitHub.', { danger: true, ok: 'Delete' }))) return;
                      await api.gh(`/repos/${full}/git/refs/heads/${encodeURIComponent(b.name)}`, 'DELETE').catch(toastError);
                      qc.invalidateQueries({ queryKey: ['gh-branches', full] });
                    }}
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- pull requests ----------
interface GhPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged_at: string | null;
  draft: boolean;
  html_url: string;
  user: { login: string; avatar_url: string };
  head: { ref: string };
  base: { ref: string };
  created_at: string;
  mergeable?: boolean | null;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}
function Pulls({ full, branch, defaultBranch }: { full: string; branch: string; defaultBranch: string }) {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [creating, setCreating] = useState(false);
  const sel = params.get('pr');
  const list = useQuery({ queryKey: ['gh-pulls', full, state], queryFn: () => api.gh<GhPR[]>(`/repos/${full}/pulls?state=${state}&per_page=50`) });
  const pr = useQuery({ queryKey: ['gh-pr', full, sel], queryFn: () => api.gh<GhPR>(`/repos/${full}/pulls/${sel}`), enabled: !!sel });
  const files = useQuery({ queryKey: ['gh-pr-files', full, sel], queryFn: () => api.gh<{ filename: string; status: string; additions: number; deletions: number; patch?: string }[]>(`/repos/${full}/pulls/${sel}/files?per_page=100`), enabled: !!sel });
  const open = (n: number | null) => {
    n ? params.set('pr', String(n)) : params.delete('pr');
    setParams(params, { replace: true });
  };
  const merge = async (method: 'merge' | 'squash' | 'rebase') => {
    if (!pr.data) return;
    if (!(await confirmDialog(`Merge #${pr.data.number} into ${pr.data.base.ref}?`, `Method: ${method}.`, { ok: 'Merge' }))) return;
    try {
      await api.gh(`/repos/${full}/pulls/${pr.data.number}/merge`, 'PUT', { merge_method: method });
      toast({ title: `Merged #${pr.data.number}` });
      qc.invalidateQueries({ queryKey: ['gh-pulls', full] });
      qc.invalidateQueries({ queryKey: ['gh-pr', full, sel] });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: sel ? 'minmax(300px, 400px) 1fr' : '1fr', flex: 1, minHeight: 0 }}>
      <div className="scroll" style={{ borderRight: sel ? '1px solid var(--line)' : 0 }}>
        <div className="row between" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
          <Seg value={state} onChange={setState} options={[{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }]} />
          <button className="btn primary sm" onClick={() => setCreating(true)}>
            <GitPullRequest /> New PR
          </button>
        </div>
        <div className="list">
          {(list.data ?? []).map((p) => (
            <button key={p.number} className="li" style={{ alignItems: 'flex-start', padding: '10px 16px', background: sel === String(p.number) ? 'var(--panel-2)' : undefined }} onClick={() => open(p.number)}>
              {p.merged_at ? <GitMerge size={15} style={{ color: 'var(--violet)' }} /> : p.state === 'open' ? <GitPullRequest size={15} className="green" /> : <CircleX size={15} className="red" />}
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small" style={{ fontWeight: 500 }}>{p.title}</div>
                <div className="row xs muted" style={{ marginTop: 3 }}>
                  <span>#{p.number}</span>
                  <span>{p.user.login}</span>
                  <span className="mono">{p.head.ref} → {p.base.ref}</span>
                  <span>{ago(p.created_at)}</span>
                  <TaskKeys text={`${p.title} ${p.body ?? ''}`} />
                </div>
              </div>
            </button>
          ))}
          {list.data && !list.data.length && <div className="empty">No {state} pull requests.</div>}
        </div>
      </div>
      {sel && pr.data && (
        <div className="scroll">
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)' }} className="col gap-12">
            <div className="h2">
              {pr.data.title} <span className="muted">#{pr.data.number}</span>
            </div>
            <div className="row xs muted wrap">
              <span className={`badge ${pr.data.merged_at ? '' : pr.data.state === 'open' ? 'green' : 'red'}`}>{pr.data.merged_at ? 'Merged' : pr.data.state}</span>
              <span className="mono">{pr.data.head.ref} → {pr.data.base.ref}</span>
              <span>{pr.data.changed_files} files</span>
              <span className="green">+{pr.data.additions}</span>
              <span className="red">−{pr.data.deletions}</span>
              <a href={pr.data.html_url} target="_blank" rel="noreferrer" className="accent-text">
                GitHub ↗
              </a>
            </div>
            {pr.data.body && <Markdown text={pr.data.body} />}
            {pr.data.state === 'open' && !pr.data.merged_at && (
              <div className="row gap-6">
                <button className="btn primary sm" disabled={pr.data.mergeable === false} onClick={() => merge('squash')}>
                  <GitMerge /> Squash & merge
                </button>
                <button className="btn sm" disabled={pr.data.mergeable === false} onClick={() => merge('merge')}>
                  Merge commit
                </button>
                <button className="btn ghost sm" onClick={async () => {
                  await api.gh(`/repos/${full}/pulls/${pr.data!.number}`, 'PATCH', { state: 'closed' }).catch(toastError);
                  qc.invalidateQueries({ queryKey: ['gh-pulls', full] });
                  qc.invalidateQueries({ queryKey: ['gh-pr', full, sel] });
                }}>
                  Close
                </button>
                {pr.data.mergeable === false && <span className="xs red">Conflicts must be resolved on GitHub.</span>}
              </div>
            )}
          </div>
          <Diff files={files.data ?? []} />
        </div>
      )}
      {creating && <NewPR full={full} head={branch} base={defaultBranch} onClose={() => setCreating(false)} onCreated={(n) => (qc.invalidateQueries({ queryKey: ['gh-pulls', full] }), open(n))} />}
    </div>
  );
}

function NewPR({ full, head, base, onClose, onCreated }: { full: string; head: string; base: string; onClose: () => void; onCreated: (n: number) => void }) {
  const branches = useQuery({ queryKey: ['gh-branches', full], queryFn: () => api.gh<{ name: string }[]>(`/repos/${full}/branches?per_page=100`) });
  const [f, setF] = useState({ head: head === base ? '' : head, base, title: '', body: '', draft: false });
  return (
    <Modal
      title="New pull request"
      size="lg"
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={!f.head || !f.title.trim() || f.head === f.base}
          onClick={async () => {
            try {
              const p = await api.gh<{ number: number }>(`/repos/${full}/pulls`, 'POST', f);
              onCreated(p.number);
              onClose();
            } catch (e) {
              toastError(e);
            }
          }}
        >
          Open pull request
        </button>
      }
    >
      <div className="grid-2">
        <Field label="From (head)">
          <select className="select mono" value={f.head} onChange={(e) => setF({ ...f, head: e.target.value })}>
            <option value="">Choose…</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Into (base)">
          <select className="select mono" value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })}>
            {(branches.data ?? []).map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Title">
        <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label="Description" hint="“Fixes KEY-12” here completes the task when the PR is merged.">
        <textarea className="textarea" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </Field>
      <label className="check small">
        <input type="checkbox" checked={f.draft} onChange={(e) => setF({ ...f, draft: e.target.checked })} /> Draft
      </label>
    </Modal>
  );
}

// ---------- actions ----------
function Actions({ full }: { full: string }) {
  const runs = useQuery({ queryKey: ['gh-runs', full], queryFn: () => api.gh<{ workflow_runs: { id: number; name: string; head_branch: string; status: string; conclusion: string | null; html_url: string; created_at: string; event: string; display_title: string }[] }>(`/repos/${full}/actions/runs?per_page=30`), refetchInterval: 20_000 });
  const icon = (s: string, c: string | null) => (s !== 'completed' ? <Loader size={14} className="amber" style={{ animation: 'spin 1.4s linear infinite' }} /> : c === 'success' ? <CircleCheck size={14} className="green" /> : c === 'failure' ? <CircleX size={14} className="red" /> : <Clock size={14} className="muted" />);
  return (
    <div className="scroll" style={{ padding: 20, flex: 1 }}>
      <div className="panel" style={{ maxWidth: 1000 }}>
        <div className="list">
          {(runs.data?.workflow_runs ?? []).map((r) => (
            <a key={r.id} className="li" href={r.html_url} target="_blank" rel="noreferrer">
              {icon(r.status, r.conclusion)}
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small trunc">{r.display_title}</div>
                <div className="xs muted">
                  {r.name} · <span className="mono">{r.head_branch}</span> · {r.event}
                </div>
              </div>
              <span className="xs muted">{r.conclusion ?? r.status}</span>
              <span className="xs faint" style={{ width: 80, textAlign: 'right' }}>{ago(r.created_at)}</span>
            </a>
          ))}
          {runs.data && !runs.data.workflow_runs.length && <div className="empty">No workflow runs. Add a workflow under .github/workflows.</div>}
          {runs.isLoading && <div className="empty"><span className="spin" /></div>}
        </div>
      </div>
    </div>
  );
}
