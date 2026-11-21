import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { qc } from '../lib/data';
import { Field } from '../components/ui';
import { ROLE_LABEL } from '../lib/derive';

function AuthFrame({ children, lab }: { children: ReactNode; lab?: string }) {
  return (
    <div className="auth">
      <div className="auth-art">
        <div className="auth-grid" />
        <div className="row" style={{ position: 'relative' }}>
          <div className="brand-mark">Æ</div>
          <div>
            <div className="brand-name">{lab ?? 'Aether'}</div>
            <div className="brand-sub">Lab operating system</div>
          </div>
        </div>
        <div style={{ position: 'relative', maxWidth: 520 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Projects · Code · Research · Competitions · Equipment</div>
          <h1 className="h-display" style={{ fontSize: 46 }}>
            The operating system
            <br />
            for your <em style={{ color: 'var(--accent-text)' }}>lab.</em>
          </h1>
          <p className="t2" style={{ fontSize: 15, lineHeight: 1.6, marginTop: 18 }}>
            One workspace where projects, tasks, repositories, papers, competitions, equipment and the team’s conversation stay connected. Change something once; everything that depends on it updates.
          </p>
        </div>
        <div className="row gap-16 xs muted mono" style={{ position: 'relative' }}>
          <span>LIVE SYNC</span>
          <span>·</span>
          <span>GITHUB</span>
          <span>·</span>
          <span>ROLES & INVITES</span>
        </div>
      </div>
      <div className="auth-form">{children}</div>
    </div>
  );
}

const useAuthState = () => useQuery({ queryKey: ['auth-state'], queryFn: () => api.get<{ setupNeeded: boolean; signedIn: boolean; labName: string }>('/api/auth/state') });

export function Login() {
  const nav = useNavigate();
  const st = useAuthState().data;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (st?.setupNeeded) nav('/setup', { replace: true });
    else if (st?.signedIn) nav('/', { replace: true });
  }, [st, nav]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/api/auth/login', { email, password });
      await qc.invalidateQueries();
      nav('/', { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame lab={st?.labName}>
      <form className="auth-card" onSubmit={submit}>
        <div>
          <div className="eyebrow">Sign in</div>
          <h2 className="h1" style={{ marginTop: 10 }}>Welcome back</h2>
        </div>
        {err && <div className="err-box">{err}</div>}
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn primary" style={{ height: 38 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small" style={{ margin: 0 }}>
          New here? You join by invitation. Forgot your password? Ask an administrator for a reset link.
        </p>
      </form>
    </AuthFrame>
  );
}

export function Setup() {
  const nav = useNavigate();
  const st = useAuthState().data;
  const [f, setF] = useState({ labName: '', name: '', title: 'Team Lead', email: '', password: '', seed: true });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (st && !st.setupNeeded) nav('/login', { replace: true });
  }, [st, nav]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/api/auth/setup', f);
      await qc.invalidateQueries();
      nav('/', { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame>
      <form className="auth-card" onSubmit={submit}>
        <div>
          <div className="eyebrow">First run · Create the workspace</div>
          <h2 className="h1" style={{ marginTop: 10 }}>Set up your lab</h2>
          <p className="muted small" style={{ marginTop: 8 }}>You become the Owner. You can appoint a vice administrator and invite the team by email afterwards.</p>
        </div>
        {err && <div className="err-box">{err}</div>}
        <Field label="Lab name">
          <input className="input" autoFocus value={f.labName} onChange={(e) => setF({ ...f, labName: e.target.value })} placeholder="e.g. Aether AI Lab" required />
        </Field>
        <div className="grid-2">
          <Field label="Your name">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </Field>
          <Field label="Title">
            <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
        </div>
        <Field label="Email">
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        </Field>
        <label className="check small t2">
          <input type="checkbox" checked={f.seed} onChange={(e) => setF({ ...f, seed: e.target.checked })} />
          Start with example projects (Saathi-Alexa, Gridsphere, TS-GLDC), papers and equipment — all editable
        </label>
        <button className="btn primary" style={{ height: 38 }} disabled={busy}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </AuthFrame>
  );
}

export function AcceptInvite({ kind }: { kind: 'invite' | 'reset' }) {
  const { token } = useParams();
  const nav = useNavigate();
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ email: string; role: keyof typeof ROLE_LABEL; kind: string; invitedBy: string | null; labName: string; name: string }>(`/api/auth/invite/${token}`), retry: false });
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post(`/api/auth/invite/${token}`, { name, title, password });
      await qc.invalidateQueries();
      nav('/', { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const d = info.data;
  return (
    <AuthFrame lab={d?.labName}>
      <form className="auth-card" onSubmit={submit}>
        {info.isLoading && <div className="muted">Checking your link…</div>}
        {info.error && (
          <>
            <div className="eyebrow">Link problem</div>
            <h2 className="h1">This link can’t be used</h2>
            <div className="err-box">{(info.error as Error).message}</div>
            <button type="button" className="btn" onClick={() => nav('/login')}>
              Go to sign in
            </button>
          </>
        )}
        {d && (
          <>
            <div>
              <div className="eyebrow">{kind === 'reset' ? 'Password reset' : `Invitation · ${ROLE_LABEL[d.role]}`}</div>
              <h2 className="h1" style={{ marginTop: 10 }}>{kind === 'reset' ? `Set a new password${d.name ? `, ${d.name.split(' ')[0]}` : ''}` : `Join ${d.labName}`}</h2>
              {kind === 'invite' && (
                <p className="muted small" style={{ marginTop: 8 }}>
                  {d.invitedBy ? `${d.invitedBy} invited ` : 'You were invited '}
                  <span className="t2">{d.email}</span> as {ROLE_LABEL[d.role].toLowerCase()}.
                </p>
              )}
            </div>
            {err && <div className="err-box">{err}</div>}
            {kind === 'invite' && (
              <div className="grid-2">
                <Field label="Full name">
                  <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
                </Field>
                <Field label="Title">
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ML Engineer" />
                </Field>
              </div>
            )}
            <Field label={kind === 'reset' ? 'New password' : 'Choose a password'} hint="At least 8 characters.">
              <input className="input" type="password" autoComplete="new-password" minLength={8} autoFocus={kind === 'reset'} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <button className="btn primary" style={{ height: 38 }} disabled={busy}>
              {busy ? 'Working…' : kind === 'reset' ? 'Save password' : 'Join the lab'}
            </button>
          </>
        )}
      </form>
    </AuthFrame>
  );
}
