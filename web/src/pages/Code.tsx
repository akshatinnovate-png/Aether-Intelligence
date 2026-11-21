import { GithubMark } from '../components/ui';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Code2, GitBranch, Lock, Plus, Star } from 'lucide-react';
import { api } from '../lib/api';
import { qc, useMe, useProjects } from '../lib/data';
import { ago, can } from '../lib/derive';
import { toast, toastError } from '../lib/store';
import { Empty, Field, Modal, SearchInput, Seg } from '../components/ui';

export interface GhStatus {
  configured: boolean;
  connected: boolean;
  login: string | null;
  callbackUrl: string;
}
export interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
  default_branch: string;
  html_url: string;
  open_issues_count: number;
}
export const useGhStatus = () => useQuery({ queryKey: ['gh-status'], queryFn: () => api.get<GhStatus>('/api/github/status') });

export function ConnectGithub({ status }: { status?: GhStatus }) {
  const me = useMe()!;
  if (!status) return null;
  if (!status.configured)
    return (
      <div className="panel" style={{ maxWidth: 680 }}>
        <Empty icon={<GithubMark />} title="GitHub isn’t set up for this workspace yet">
          {can(me.role, 'admin') ? (
            <>
              Create a free GitHub OAuth app and paste its client ID and secret in{' '}
              <Link to="/settings/integrations" className="accent-text">
                Settings → Integrations
              </Link>
              . It takes two minutes.
            </>
          ) : (
            'Ask an administrator to connect a GitHub OAuth app in Settings → Integrations.'
          )}
        </Empty>
      </div>
    );
  return (
    <div className="panel" style={{ maxWidth: 680 }}>
      <Empty
        icon={<GithubMark />}
        title="Connect your GitHub account"
        action={
          <a className="btn primary" href="/api/github/connect">
            <GithubMark /> Connect GitHub
          </a>
        }
      >
        Browse every repository you can access, edit files, commit, branch, open and merge pull requests and create new repositories — all from Aether, using your own GitHub permissions.
      </Empty>
    </div>
  );
}

export default function Code() {
  const status = useGhStatus();
  const projects = useProjects();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'linked' | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const connected = status.data?.connected;
  const repos = useQuery({ queryKey: ['gh-repos'], queryFn: () => api.gh<GhRepo[]>('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member'), enabled: !!connected, staleTime: 60_000 });
  useEffect(() => {
    if (params.get('connected')) {
      toast({ title: 'GitHub connected' });
      qc.invalidateQueries({ queryKey: ['gh-status'] });
      params.delete('connected');
      setParams(params, { replace: true });
    }
    if (params.get('new') && connected) setCreating(true);
  }, [params, setParams, connected]);
  const linked = useMemo(() => new Map(projects.filter((p) => p.repoFullName).map((p) => [p.repoFullName!.toLowerCase(), p])), [projects]);
  const list = (repos.data ?? []).filter((r) => (scope === 'all' || linked.has(r.full_name.toLowerCase())) && (!q || `${r.full_name} ${r.description ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">GitHub · {status.data?.login ? `@${status.data.login}` : 'not connected'}</div>
          <h1 className="h-display">Code</h1>
          <p>Your repositories, grouped by project. Commits that mention a task key link to it; “fixes KEY-12” completes it.</p>
        </div>
        {connected && (
          <button className="btn primary sm" onClick={() => setCreating(true)}>
            <Plus /> New repository
          </button>
        )}
      </div>
      {!connected ? (
        <ConnectGithub status={status.data} />
      ) : (
        <>
          <div className="row wrap gap-6" style={{ marginBottom: 12 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Filter repositories" width={280} />
            <Seg value={scope} onChange={setScope} options={[{ id: 'all', label: `All · ${repos.data?.length ?? 0}` }, { id: 'linked', label: `Linked to projects · ${linked.size}` }]} />
          </div>
          {repos.isLoading ? (
            <div className="panel">
              <div className="empty">
                <span className="spin" />
              </div>
            </div>
          ) : repos.error ? (
            <div className="err-box">{(repos.error as Error).message}</div>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Project</th>
                    <th>Language</th>
                    <th className="num">Stars</th>
                    <th className="num">Issues</th>
                    <th>Pushed</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const p = linked.get(r.full_name.toLowerCase());
                    return (
                      <tr key={r.id} className="clickable" onClick={() => nav(`/code/${r.full_name}`)}>
                        <td style={{ maxWidth: 560 }}>
                          <div className="row">
                            {r.private ? <Lock size={13} className="muted" /> : <Code2 size={13} className="muted" />}
                            <span className="mono small">
                              <span className="muted">{r.owner.login}/</span>
                              <span style={{ fontWeight: 500 }}>{r.name}</span>
                            </span>
                          </div>
                          {r.description && <div className="xs muted trunc" style={{ marginLeft: 21 }}>{r.description}</div>}
                        </td>
                        <td>
                          {p ? (
                            <span className="badge">
                              <span className="swatch" style={{ background: p.color }} />
                              {p.name}
                            </span>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td className="small muted">{r.language ?? '—'}</td>
                        <td className="num mono muted">
                          <span className="row gap-4" style={{ justifyContent: 'flex-end' }}>
                            <Star size={11} />
                            {r.stargazers_count}
                          </span>
                        </td>
                        <td className="num mono muted">{r.open_issues_count}</td>
                        <td className="xs muted">{ago(r.pushed_at)}</td>
                      </tr>
                    );
                  })}
                  {!list.length && (
                    <tr>
                      <td colSpan={6} className="muted" style={{ textAlign: 'center', height: 80 }}>
                        No repositories.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {creating && <NewRepo defaultProject={params.get('project')} onClose={() => (setCreating(false), params.delete('new'), setParams(params, { replace: true }))} />}
    </div>
  );
}

function NewRepo({ onClose, defaultProject }: { onClose: () => void; defaultProject: string | null }) {
  const projects = useProjects();
  const nav = useNavigate();
  const orgs = useQuery({ queryKey: ['gh-orgs'], queryFn: () => api.gh<{ login: string }[]>('/user/orgs') });
  const status = useGhStatus();
  const [f, setF] = useState({ name: '', description: '', private: true, autoInit: true, gitignore: 'Node', license: '', org: '', projectId: defaultProject ?? '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ full_name: string }>('/api/github/repos', { ...f, org: f.org || undefined, projectId: f.projectId || undefined });
      qc.invalidateQueries({ queryKey: ['gh-repos'] });
      toast({ title: `Created ${r.full_name}` });
      onClose();
      nav(`/code/${r.full_name}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New repository" sub="Created on GitHub with your account." onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name.trim() || busy} onClick={submit}><GitBranch /> Create repository</button></>}>
      <div className="grid-2">
        <Field label="Owner">
          <select className="select" value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })}>
            <option value="">{status.data?.login ?? 'You'}</option>
            {(orgs.data ?? []).map((o) => (
              <option key={o.login} value={o.login}>
                {o.login}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <input className="input mono" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.replace(/\s+/g, '-') })} placeholder="saathi-alexa" />
        </Field>
      </div>
      <Field label="Description">
        <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <div className="grid-3">
        <Field label=".gitignore">
          <select className="select" value={f.gitignore} onChange={(e) => setF({ ...f, gitignore: e.target.value })}>
            {['', 'Node', 'Python', 'Kotlin', 'Rust', 'Go', 'Java', 'C++', 'Unity'].map((g) => (
              <option key={g} value={g}>
                {g || 'None'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Licence">
          <select className="select" value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })}>
            {['', 'mit', 'apache-2.0', 'gpl-3.0', 'bsd-3-clause'].map((g) => (
              <option key={g} value={g}>
                {g || 'None'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Link to project">
          <select className="select" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
            <option value="">None</option>
            {projects.filter((p) => !p.archived && !p.repoFullName).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="check small">
        <input type="checkbox" checked={f.private} onChange={(e) => setF({ ...f, private: e.target.checked })} /> Private repository
      </label>
      <label className="check small">
        <input type="checkbox" checked={f.autoInit} onChange={(e) => setF({ ...f, autoInit: e.target.checked })} /> Initialise with a README
      </label>
    </Modal>
  );
}
