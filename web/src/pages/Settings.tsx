import { GithubMark } from '../components/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Building2, Copy, Database, KeyRound, Laptop, Mail, Palette, ShieldCheck, User, Users } from 'lucide-react';
import { api } from '../lib/api';
import { qc, useMe, useSettings, useUsers } from '../lib/data';
import { ago, can, fmtDateTime, RANK, ROLE_DESC, ROLE_LABEL } from '../lib/derive';
import { toast, toastError } from '../lib/store';
import { Avatar, confirmDialog, Field, Seg, Toggle } from '../components/ui';
import { savePrefs } from '../components/Shell';
import { DASH_PANELS } from './Dashboard';
import { useGhStatus } from './Code';
import type { Activity, Prefs, Role } from '../types';

const SECTIONS = [
  { id: 'profile', label: 'Account', icon: User },
  { id: 'preferences', label: 'Appearance & layout', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'integrations', label: 'GitHub', icon: GithubMark },
  { id: 'desktop', label: 'Desktop app', icon: Laptop },
  { id: 'team', label: 'Team & roles', icon: Users, admin: true },
  { id: 'email', label: 'Email delivery', icon: Mail, admin: true },
  { id: 'workspace', label: 'Workspace', icon: Building2, admin: true },
  { id: 'data', label: 'Data & audit log', icon: Database, admin: true },
];

export default function Settings() {
  const { section = 'profile' } = useParams();
  const me = useMe()!;
  const admin = can(me.role, 'admin');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Settings</div>
          <h1 className="h-display">{SECTIONS.find((s) => s.id === section)?.label ?? 'Settings'}</h1>
        </div>
      </div>
      <div className="settings">
        <nav className="settings-nav">
          {SECTIONS.filter((s) => !s.admin || admin).map((s) => (
            <NavLink key={s.id} to={`/settings/${s.id}`}>
              <s.icon />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
          {section === 'profile' && <Account />}
          {section === 'preferences' && <Preferences />}
          {section === 'notifications' && <Notifications />}
          {section === 'integrations' && <Integrations />}
          {section === 'desktop' && <Desktop />}
          {section === 'team' && admin && <Team />}
          {section === 'email' && admin && <Email />}
          {section === 'workspace' && admin && <Workspace />}
          {section === 'data' && admin && <Data />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-section">
      <div>
        <div className="h3">{title}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <div className="col gap-12" style={{ minWidth: 0, maxWidth: 640 }}>
        {children}
      </div>
    </section>
  );
}

function Account() {
  const me = useMe()!;
  const nav = useNavigate();
  const [pw, setPw] = useState({ current: '', next: '' });
  return (
    <>
      <Section title="Profile" desc="Name, title, skills, capacity and responsibilities live on your member profile.">
        <div className="row">
          <Link to={`/members/${me.id}`} className="btn">
            <User /> Open my profile
          </Link>
          <span className="small muted">
            {me.email} · {ROLE_LABEL[me.role]}
          </span>
        </div>
      </Section>
      <Section title="Password" desc="Changing it signs out your other devices.">
        <div className="grid-2">
          <Field label="Current password">
            <input type="password" className="input" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password">
            <input type="password" className="input" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
        </div>
        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          disabled={!pw.current || pw.next.length < 8}
          onClick={() => api.post('/api/auth/password', pw).then(() => (setPw({ current: '', next: '' }), toast({ title: 'Password changed' })), toastError)}
        >
          <KeyRound /> Change password
        </button>
      </Section>
      <Section title="Sessions">
        <div className="row gap-6">
          <button
            className="btn"
            onClick={async () => {
              await api.post('/api/auth/logout');
              qc.clear();
              nav('/login');
            }}
          >
            Sign out
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              if (!(await confirmDialog('Sign out everywhere?', 'Every device, including this one, will need to sign in again.', { danger: true, ok: 'Sign out everywhere' }))) return;
              await api.post('/api/auth/logout-all');
              qc.clear();
              nav('/login');
            }}
          >
            Sign out everywhere
          </button>
        </div>
      </Section>
    </>
  );
}

function Preferences() {
  const me = useMe()!;
  const p = me.prefs;
  const set = (patch: Partial<Prefs>) => {
    const next = { ...p, ...patch };
    try {
      if (patch.theme) localStorage.setItem('aether-theme', patch.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : patch.theme);
    } catch {
      /* ignore */
    }
    savePrefs(next).catch(toastError);
  };
  const hidden = new Set(p.dashboard?.hidden ?? []);
  return (
    <>
      <Section title="Theme">
        <Seg value={p.theme ?? 'dark'} onChange={(theme) => set({ theme })} options={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'Match system' }]} />
      </Section>
      <Section title="Density" desc="Compact fits more rows on screen.">
        <Seg value={p.density ?? 'compact'} onChange={(density) => set({ density })} options={[{ id: 'compact', label: 'Compact' }, { id: 'comfortable', label: 'Comfortable' }]} />
      </Section>
      <Section title="Motion">
        <Seg value={p.motion ?? 'full'} onChange={(motion) => set({ motion })} options={[{ id: 'full', label: 'Animations on' }, { id: 'reduce', label: 'Reduce motion' }]} />
      </Section>
      <Section title="Sidebar">
        <div className="row">
          <Toggle on={!!p.sidebarCollapsed} onChange={(v) => set({ sidebarCollapsed: v })} />
          <span className="small">Collapse to icons</span>
        </div>
      </Section>
      <Section title="Default project view" desc="Which tab opens when you open a project.">
        <Seg value={p.defaultProjectView ?? 'board'} onChange={(defaultProjectView) => set({ defaultProjectView })} options={[{ id: 'board', label: 'Board' }, { id: 'list', label: 'List' }, { id: 'timeline', label: 'Timeline' }]} />
      </Section>
      <Section title="Dashboard panels" desc="Choose what your command dashboard shows.">
        {DASH_PANELS.map((d) => (
          <div key={d.id} className="row">
            <Toggle on={!hidden.has(d.id)} onChange={(on) => set({ dashboard: { ...p.dashboard, hidden: on ? [...hidden].filter((x) => x !== d.id) : [...hidden, d.id] } })} />
            <span className="small">{d.label}</span>
          </div>
        ))}
      </Section>
    </>
  );
}

const NOTIFY_KINDS: [string, string][] = [
  ['assigned', 'Someone assigns me a task'],
  ['mention', 'Someone @mentions me'],
  ['comment', 'Comments on tasks I own or created'],
  ['status', 'Status changes on my tasks, unblocked tasks'],
  ['deadline', 'Deadline reminders and changes'],
  ['message', 'Direct messages and thread replies'],
  ['competition', 'Competition stage changes and deadlines'],
  ['booking', 'Bookings, equipment status, licences'],
  ['project', 'Added to a project, meeting invites'],
  ['github', 'Pull requests and CI failures'],
  ['team', 'Role changes, achievements, people joining'],
];
function Notifications() {
  const me = useMe()!;
  const p = me.prefs;
  const settings = useSettings();
  const setKind = (field: 'notify' | 'email', k: string, v: boolean) => savePrefs({ ...p, [field]: { ...(p[field] ?? {}), [k]: v } }).catch(toastError);
  return (
    <>
      <Section title="What reaches you" desc="In-app notifications arrive instantly in the Inbox and as a toast. Email requires an administrator to set up email delivery.">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Event</th>
                <th>In app</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFY_KINDS.map(([k, label]) => (
                <tr key={k}>
                  <td className="small">{label}</td>
                  <td>
                    <Toggle on={p.notify?.[k] !== false} onChange={(v) => setKind('notify', k, v)} />
                  </td>
                  <td>
                    <Toggle on={!!p.email?.[k]} onChange={(v) => setKind('email', k, v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {settings.smtp_user === undefined && can(me.role, 'admin') && (
          <div className="xs muted">
            Email delivery is not configured yet — <Link className="accent-text" to="/settings/email">set it up</Link>.
          </div>
        )}
      </Section>
      <Section title="Desktop alerts" desc="Show a system notification when Aether is in the background.">
        {'Notification' in window ? (
          Notification.permission === 'granted' ? (
            <span className="small green">Enabled for this browser.</span>
          ) : (
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => Notification.requestPermission().then(() => location.reload())}>
              <Bell /> Allow desktop alerts
            </button>
          )
        ) : (
          <span className="small muted">Not supported here.</span>
        )}
      </Section>
    </>
  );
}

function Integrations() {
  const me = useMe()!;
  const status = useGhStatus();
  const settings = useSettings();
  const [params] = useSearchParams();
  const [f, setF] = useState({ github_client_id: '', github_client_secret: '' });
  useEffect(() => setF((x) => ({ ...x, github_client_id: String(settings.github_client_id ?? '') })), [settings.github_client_id]);
  const err = params.get('github');
  return (
    <>
      {err && <div className="err-box" style={{ marginBottom: 16 }}>GitHub: {err === 'not_configured' ? 'an administrator must add the OAuth app below first.' : params.get('reason') ?? err}</div>}
      <Section title="Your GitHub account" desc="Uses your own permissions. Your token is encrypted at rest and only used for your requests.">
        {status.data?.connected ? (
          <div className="row">
            <span className="badge green">Connected</span>
            <span className="mono small">@{status.data.login}</span>
            <Link to="/code" className="btn sm">
              Open Code
            </Link>
            <button className="btn ghost sm" onClick={() => api.post('/api/github/disconnect').then(() => qc.invalidateQueries({ queryKey: ['gh-status'] }), toastError)}>
              Disconnect
            </button>
          </div>
        ) : status.data?.configured ? (
          <a className="btn primary" style={{ alignSelf: 'flex-start' }} href="/api/github/connect">
            <GithubMark /> Connect GitHub
          </a>
        ) : (
          <span className="small muted">Waiting for an administrator to register the workspace’s GitHub OAuth app.</span>
        )}
      </Section>
      {can(me.role, 'admin') && (
        <Section
          title="Workspace OAuth app"
          desc={
            <>
              Free. On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App. Use the homepage and callback URLs shown here, then paste the client ID and a client secret.
            </>
          }
        >
          <Field label="Homepage URL">
            <CopyBox text={location.origin} />
          </Field>
          <Field label="Authorization callback URL">
            <CopyBox text={status.data?.callbackUrl ?? `${location.origin}/api/github/callback`} />
          </Field>
          <Field label="Client ID">
            <input className="input mono" value={f.github_client_id} onChange={(e) => setF({ ...f, github_client_id: e.target.value })} />
          </Field>
          <Field label="Client secret" hint={settings.github_client_secret_set ? 'Saved and encrypted. Leave blank to keep it.' : 'Stored encrypted. Never shown again.'}>
            <input className="input mono" type="password" autoComplete="off" value={f.github_client_secret} onChange={(e) => setF({ ...f, github_client_secret: e.target.value })} placeholder={settings.github_client_secret_set ? '••••••••••••' : ''} />
          </Field>
          <button
            className="btn primary"
            style={{ alignSelf: 'flex-start' }}
            onClick={() =>
              api.put('/api/settings', f).then(() => {
                toast({ title: 'GitHub app saved' });
                setF((x) => ({ ...x, github_client_secret: '' }));
                qc.invalidateQueries({ queryKey: ['settings'] });
                qc.invalidateQueries({ queryKey: ['gh-status'] });
              }, toastError)
            }
          >
            Save
          </button>
        </Section>
      )}
    </>
  );
}

function CopyBox({ text }: { text: string }) {
  return (
    <div className="row gap-6">
      <div className="code-box grow">{text}</div>
      <button className="btn icon sm" onClick={() => (navigator.clipboard.writeText(text), toast({ title: 'Copied' }))} title="Copy">
        <Copy />
      </button>
    </div>
  );
}

function Desktop() {
  const desktop = window.aetherDesktop;
  return (
    <Section title="Aether for desktop" desc="A native app for Windows, macOS and Linux: its own window, tray icon, unread badge, system notifications and launch at login.">
      {desktop ? (
        <div className="ok-box">You are using the desktop app (version {desktop.version}).</div>
      ) : (
        <>
          <p className="small t2" style={{ margin: 0 }}>Installers are built automatically by GitHub Actions on each release of the Aether repository. Download the one for your system from the repository’s Releases page, install it, and enter this workspace address on first launch:</p>
          <CopyBox text={location.origin} />
          <a className="btn primary" style={{ alignSelf: 'flex-start' }} href="https://github.com/akshatinnovate-png/Aether-Intelligence/releases/latest" target="_blank" rel="noreferrer">
            <Laptop /> Download from Releases
          </a>
        </>
      )}
    </Section>
  );
}

interface Invite {
  id: string;
  email: string;
  role: Role;
  emailStatus: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  invitedByName: string | null;
}
function Team() {
  const me = useMe()!;
  const users = useUsers();
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api.get<Invite[]>('/api/invites') });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [last, setLast] = useState<{ link: string; emailStatus: string; emailError: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const roles: Role[] = me.role === 'owner' ? ['admin', 'lead', 'member', 'guest'] : ['lead', 'member', 'guest'];
  const invite = async () => {
    setBusy(true);
    try {
      const emails = email.split(/[\s,;]+/).filter(Boolean);
      for (const e of emails) {
        const r = await api.post<{ link: string; emailStatus: string; emailError: string | null }>('/api/invites', { email: e, role });
        setLast(r);
      }
      setEmail('');
      invites.refetch();
      toast({ title: emails.length > 1 ? `${emails.length} invites created` : 'Invite created' });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const pending = (invites.data ?? []).filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > new Date().toISOString());
  return (
    <>
      <Section title="Invite by email" desc="They get an email with a link; clicking it lets them set a password and join with the role you choose. Links expire after 7 days. Separate several addresses with commas.">
        <div className="row gap-6 wrap">
          <input className="input grow" style={{ minWidth: 240 }} type="email" placeholder="teammate@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && email && invite()} />
          <select className="select" style={{ width: 150 }} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!email || busy} onClick={invite}>
            <Mail /> Send invite
          </button>
        </div>
        <div className="xs muted">{ROLE_DESC[role]}</div>
        {last && (
          <div className={last.emailStatus === 'sent' ? 'ok-box' : 'err-box'}>
            {last.emailStatus === 'sent' ? 'Email sent. ' : last.emailStatus === 'failed' ? `Email failed: ${last.emailError}. ` : 'Email delivery is not configured, so no email was sent. '}
            You can also share the link directly:
            <div className="row gap-6" style={{ marginTop: 6 }}>
              <div className="code-box grow">{last.link}</div>
              <button className="btn icon sm" onClick={() => (navigator.clipboard.writeText(last.link), toast({ title: 'Link copied' }))}>
                <Copy />
              </button>
            </div>
            {last.emailStatus !== 'sent' && (
              <div style={{ marginTop: 6 }}>
                <Link to="/settings/email" className="accent-text">
                  Set up email delivery →
                </Link>
              </div>
            )}
          </div>
        )}
      </Section>
      <Section title={`Pending invites · ${pending.length}`}>
        <div className="panel">
          <div className="list">
            {pending.map((i) => (
              <div key={i.id} className="li">
                <Mail size={13} className="muted" />
                <span className="small grow trunc">{i.email}</span>
                <span className="badge">{ROLE_LABEL[i.role]}</span>
                <span className={`xs ${i.emailStatus === 'sent' ? 'green' : i.emailStatus === 'failed' ? 'red' : 'muted'}`}>{i.emailStatus === 'sent' ? 'emailed' : i.emailStatus === 'failed' ? 'email failed' : 'link only'}</span>
                <span className="xs faint">{ago(i.createdAt)}</span>
                <button className="btn ghost xs" onClick={() => api.del(`/api/invites/${i.id}`).then(() => invites.refetch(), toastError)}>
                  Revoke
                </button>
              </div>
            ))}
            {!pending.length && <div className="li faint small">No pending invites.</div>}
          </div>
        </div>
      </Section>
      <Section title="Members & roles" desc="The owner appoints administrators (vice administrators). Administrators manage everyone below them.">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const editable = u.id !== me.id && u.role !== 'owner' && !(me.role === 'admin' && u.role === 'admin');
                return (
                  <tr key={u.id} style={{ opacity: u.status === 'disabled' ? 0.55 : 1 }}>
                    <td>
                      <Link to={`/members/${u.id}`} className="row">
                        <Avatar user={u} size={22} />
                        <div>
                          <div className="small">{u.name}</div>
                          <div className="xs faint">{u.email}</div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      {editable ? (
                        <select
                          className="select sm"
                          style={{ width: 150 }}
                          value={u.role}
                          onChange={async (e) => {
                            const r = e.target.value as Role;
                            if (RANK[r] >= RANK.admin && !(await confirmDialog(`Make ${u.name} an administrator?`, ROLE_DESC.admin, { ok: 'Confirm' }))) return;
                            api.patch(`/api/users/${u.id}`, { role: r }).then(() => toast({ title: `${u.name} → ${ROLE_LABEL[r]}` }), toastError);
                          }}
                        >
                          {(me.role === 'owner' ? (['admin', 'lead', 'member', 'guest'] as Role[]) : (['lead', 'member', 'guest'] as Role[])).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`badge${u.role === 'owner' || u.role === 'admin' ? ' accent' : ''}`}>{ROLE_LABEL[u.role]}</span>
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <button className={`btn xs ${u.status === 'active' ? '' : 'danger'}`} onClick={() => api.patch(`/api/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' }).catch(toastError)}>
                          {u.status === 'active' ? 'Active' : 'Disabled'}
                        </button>
                      ) : (
                        <span className="xs muted">{u.status}</span>
                      )}
                    </td>
                    <td className="xs muted">{ago(u.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      {me.role === 'owner' && <TransferOwnership />}
    </>
  );
}

function TransferOwnership() {
  const users = useUsers().filter((u) => u.status === 'active');
  const me = useMe()!;
  const [to, setTo] = useState('');
  return (
    <Section title="Transfer ownership" desc="You become an administrator. Only do this when handing the lab over.">
      <div className="row gap-6">
        <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose a member…</option>
          {users
            .filter((u) => u.id !== me.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </select>
        <button
          className="btn danger"
          disabled={!to}
          onClick={async () => {
            if (!(await confirmDialog('Transfer ownership?', 'This cannot be undone by you.', { danger: true, ok: 'Transfer' }))) return;
            await api.post('/api/team/transfer-ownership', { userId: to }).catch(toastError);
            await qc.invalidateQueries();
          }}
        >
          Transfer
        </button>
      </div>
    </Section>
  );
}

function Email() {
  const settings = useSettings();
  const [f, setF] = useState({ smtp_host: '', smtp_port: '465', smtp_user: '', smtp_pass: '', smtp_from_name: '', smtp_from_email: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF((x) => ({
      ...x,
      smtp_host: String(settings.smtp_host ?? 'smtp.gmail.com'),
      smtp_port: String(settings.smtp_port ?? '465'),
      smtp_user: String(settings.smtp_user ?? ''),
      smtp_from_name: String(settings.smtp_from_name ?? ''),
      smtp_from_email: String(settings.smtp_from_email ?? ''),
    }));
  }, [settings.smtp_host, settings.smtp_port, settings.smtp_user, settings.smtp_from_name, settings.smtp_from_email]);
  const saveIt = async () => {
    await api.put('/api/settings', f);
    setF((x) => ({ ...x, smtp_pass: '' }));
    qc.invalidateQueries({ queryKey: ['settings'] });
  };
  return (
    <>
      <Section
        title="Gmail (recommended)"
        desc={
          <>
            Use a Gmail <strong>App Password</strong>, not your normal password: Google Account → Security → 2-Step Verification (must be on) → App passwords → create one named “Aether”. Paste the 16-character code below. Free; Gmail allows about 500 emails a day.
          </>
        }
      >
        <div className="grid-2">
          <Field label="SMTP host">
            <input className="input mono" value={f.smtp_host} onChange={(e) => setF({ ...f, smtp_host: e.target.value })} />
          </Field>
          <Field label="Port" hint="465 (TLS) or 587 (STARTTLS)">
            <input className="input mono" value={f.smtp_port} onChange={(e) => setF({ ...f, smtp_port: e.target.value })} />
          </Field>
          <Field label="Gmail address (username)">
            <input className="input" type="email" value={f.smtp_user} onChange={(e) => setF({ ...f, smtp_user: e.target.value })} placeholder="you@gmail.com" />
          </Field>
          <Field label="App password" hint={settings.smtp_pass_set ? 'Saved and encrypted. Leave blank to keep it.' : 'Encrypted before it is stored; never shown again.'}>
            <input className="input mono" type="password" autoComplete="off" value={f.smtp_pass} onChange={(e) => setF({ ...f, smtp_pass: e.target.value })} placeholder={settings.smtp_pass_set ? '••••••••••••••••' : 'abcd efgh ijkl mnop'} />
          </Field>
          <Field label="Sender name">
            <input className="input" value={f.smtp_from_name} onChange={(e) => setF({ ...f, smtp_from_name: e.target.value })} placeholder="Aether Lab" />
          </Field>
          <Field label="Sender address" hint="Defaults to the username. Gmail only sends as your own address or a verified alias.">
            <input className="input" type="email" value={f.smtp_from_email} onChange={(e) => setF({ ...f, smtp_from_email: e.target.value })} />
          </Field>
        </div>
        <div className="row gap-6">
          <button className="btn primary" onClick={() => saveIt().then(() => toast({ title: 'Email settings saved' }), toastError)}>
            Save
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await saveIt();
                const r = await api.post<{ to: string }>('/api/settings/test-email');
                toast({ title: `Test email sent to ${r.to}` });
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Mail /> {busy ? 'Sending…' : 'Save & send test email'}
          </button>
        </div>
      </Section>
    </>
  );
}

function Workspace() {
  const settings = useSettings();
  const [name, setName] = useState('');
  useEffect(() => setName(String(settings.lab_name ?? '')), [settings.lab_name]);
  return (
    <Section title="Lab name" desc="Shown in the sidebar, emails and invites.">
      <div className="row gap-6">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn primary"
          onClick={() =>
            api.put('/api/settings', { lab_name: name }).then(() => {
              qc.invalidateQueries({ queryKey: ['settings'] });
              qc.invalidateQueries({ queryKey: ['auth-state'] });
              toast({ title: 'Saved' });
            }, toastError)
          }
        >
          Save
        </button>
      </div>
    </Section>
  );
}

function Data() {
  const users = useUsers();
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => api.get<Activity[]>('/api/audit') });
  return (
    <>
      <Section title="Export" desc="Everything in the workspace as one JSON file (passwords and tokens excluded). Cloudflare D1 also keeps point-in-time recovery (7 days on the free plan).">
        <a className="btn" style={{ alignSelf: 'flex-start' }} href="/api/export">
          <Database /> Download export
        </a>
      </Section>
      <Section title="Audit log" desc="Role changes, invites, settings changes, exports and deletions.">
        <div className="panel">
          <div className="list" style={{ maxHeight: 520, overflow: 'auto' }}>
            {(audit.data ?? []).map((a) => (
              <div key={a.id} className="li">
                <ShieldCheck size={13} className="muted" />
                <Avatar user={users.find((u) => u.id === a.actorId)} size={18} />
                <span className="small grow">
                  <span className="t2">{users.find((u) => u.id === a.actorId)?.name ?? 'System'}</span> {a.summary}
                </span>
                <span className="xs faint mono">{fmtDateTime(a.createdAt)}</span>
              </div>
            ))}
            {!audit.data?.length && <div className="li faint small">Nothing yet.</div>}
          </div>
        </div>
      </Section>
    </>
  );
}
