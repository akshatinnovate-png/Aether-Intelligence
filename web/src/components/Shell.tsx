import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bell,
  Boxes,
  Calendar,
  CheckSquare,
  FileUp,
  Sparkles,
  Download,
  ChevronsLeft,
  Code2,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MessagesSquare,
  Plus,
  Search,
  Settings,
  Trophy,
  Users,
} from 'lucide-react';
import { useUI } from '../lib/store';
import { installApp, setAppBadge, usePwa } from '../lib/pwa';
import { connectRealtime, useChannels, useMe, useNotifications, useProjects, useTasks, useUsers } from '../lib/data';
import { api } from '../lib/api';
import { qc } from '../lib/data';
import { Avatar, ConfirmHost, Toasts } from './ui';
import { CommandPalette } from './CommandPalette';
import { AssistantPanel } from './Assistant';
import { canReviewTask, deliverableState } from './Deliverable';
import { TaskDrawer } from './TaskDrawer';
import { CreateTaskModal } from './CreateTask';
import { CreateProjectModal } from './CreateProject';
import { isOverdue, ROLE_LABEL } from '../lib/derive';
import type { Prefs } from '../types';

declare global {
  interface Window {
    aetherDesktop?: { setBadge(n: number): void; notify(title: string, body: string): void; isDesktop: true; version: string };
  }
}

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = p.theme === 'light' || (p.theme === 'system' && !sysDark) ? 'light' : 'dark';
  root.dataset.theme = theme;
  root.dataset.density = p.density ?? 'compact';
  root.dataset.motion = p.motion ?? 'full';
}

export function savePrefs(next: Prefs) {
  qc.setQueryData(['me'], (old: object | undefined) => (old ? { ...old, prefs: next } : old));
  applyPrefs(next);
  return api.put('/api/me/prefs', next);
}

export function Shell() {
  const me = useMe();
  const { mobileNav, setMobileNav, setPalette, openCreateTask } = useUI();
  const loc = useLocation();
  const [params] = useSearchParams();
  const taskId = params.get('task');
  const collapsed = !!me?.prefs.sidebarCollapsed;

  useEffect(() => {
    if (!me) return;
    applyPrefs(me.prefs);
    return connectRealtime(me.id);
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setMobileNav(false), [loc.pathname, setMobileNav]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.closest('.cm-editor');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        useUI.getState().setAssistant(!useUI.getState().assistantOpen);
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'c') {
          e.preventDefault();
          const m = /^\/projects\/([^/]+)/.exec(location.pathname);
          const p = m ? qc.getQueryData<{ id: string; key: string }[]>(['projects'])?.find((x) => x.key === m[1]) : undefined;
          openCreateTask(p ? { projectId: p.id } : {});
        } else if (e.key === '/') {
          e.preventDefault();
          setPalette(true);
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setPalette, openCreateTask]);

  if (!me) return null;
  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${mobileNav ? ' mobile-open' : ''}`}>
      <Sidebar collapsed={collapsed} />
      {mobileNav && <div className="scrim" style={{ zIndex: 44 }} onClick={() => setMobileNav(false)} />}
      <div className="main">
        <Topbar />
        <main className="content" id="content">
          <Outlet />
        </main>
      </div>
      {taskId && <TaskDrawer id={taskId} />}
      <CommandPalette />
      <AssistantPanel />
      <CreateTaskModal />
      <CreateProjectModal />
      <Toasts />
      <ConfirmHost />
      <DesktopBridge />
    </div>
  );
}

function DesktopBridge() {
  const notifications = useNotifications();
  const channels = useChannels();
  const unread = notifications.filter((n) => !n.readAt).length + channels.reduce((s, c) => s + (c.kind === 'dm' ? c.unread : c.mentions), 0);
  useEffect(() => {
    window.aetherDesktop?.setBadge(unread);
    setAppBadge(unread);
    document.title = unread ? `(${unread}) Aether` : 'Aether';
  }, [unread]);
  return null;
}

function Sidebar({ collapsed }: { collapsed: boolean }) {
  const me = useMe()!;
  const projects = useProjects();
  const tasks = useTasks();
  const notifications = useNotifications();
  const channels = useChannels();
  const users = useUsers();
  const meUser = users.find((u) => u.id === me.id);
  const online = useUI((s) => s.online);
  const mine = tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done');
  const subCount =
    tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done' && ['to_submit', 'changes'].includes(deliverableState(t))).length +
    tasks.filter((t) => t.submission?.status === 'pending' && canReviewTask(me, t, projects.find((p) => p.id === t.projectId))).length;
  const overdue = mine.filter(isOverdue).length;
  const unread = notifications.filter((n) => !n.readAt).length;
  const chatUnread = channels.reduce((s, c) => s + c.unread, 0);
  const chatHot = channels.some((c) => c.mentions > 0 || (c.kind === 'dm' && c.unread > 0));
  const active = projects.filter((p) => !p.archived && p.status !== 'done' && (p.members.includes(me.id) || p.leadId === me.id)).slice(0, 8);
  const lab = useQuery({ queryKey: ['auth-state'], queryFn: () => api.get<{ labName: string }>('/api/auth/state') }).data?.labName ?? 'Aether';
  const item = (to: string, icon: ReactNode, label: string, count?: ReactNode, end?: boolean) => (
    <NavLink to={to} end={end} title={collapsed ? label : undefined}>
      {icon}
      <span className="nav-text">{label}</span>
      {count}
    </NavLink>
  );
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">Æ</div>
        <div className="brand-text grow" style={{ minWidth: 0 }}>
          <div className="brand-name trunc">{lab}</div>
          <div className="brand-sub">Lab operating system</div>
        </div>
        <button className="btn ghost icon xs desktop-only brand-text" title="Collapse sidebar" onClick={() => savePrefs({ ...me.prefs, sidebarCollapsed: true })}>
          <ChevronsLeft />
        </button>
      </div>
      <nav className="nav">
        {collapsed && (
          <button className="nav-item desktop-only" title="Expand sidebar" onClick={() => savePrefs({ ...me.prefs, sidebarCollapsed: false })}>
            <Menu />
          </button>
        )}
        {item('/', <LayoutDashboard />, 'Home', null, true)}
        <button className="nav-item" title={collapsed ? 'Ask Aether (⌘J)' : undefined} onClick={() => useUI.getState().setAssistant(true)}>
          <Sparkles style={{ color: 'var(--accent-text)' }} />
          <span className="nav-text">Ask Aether</span>
          <span className="count">⌘J</span>
        </button>
        {item('/submissions', <FileUp />, 'Submissions', subCount ? <span className="count hot">{subCount}</span> : null)}
        {item('/my-work', <CheckSquare />, 'My work', mine.length ? <span className={`count${overdue ? ' hot' : ''}`}>{mine.length}</span> : null)}
        {item('/inbox', <Bell />, 'Inbox', unread ? <span className="count hot">{unread}</span> : null)}
        {item('/chat', <MessagesSquare />, 'Chat', chatUnread ? <span className={`count${chatHot ? ' hot' : ''}`}>{chatUnread}</span> : null)}
        {item('/calendar', <Calendar />, 'Calendar')}
        <div className="nav-label eyebrow">Workspace</div>
        {item('/projects', <FolderKanban />, 'Projects', <span className="count">{projects.filter((p) => !p.archived).length}</span>, true)}
        {item('/code', <Code2 />, 'Code')}
        {item('/members', <Users />, 'Members', <span className="count">{users.filter((u) => u.status === 'active').length}</span>)}
        {item('/research', <FlaskConical />, 'Research vault')}
        {item('/competitions', <Trophy />, 'Competitions')}
        {item('/equipment', <Boxes />, 'Equipment')}
        {active.length > 0 && <div className="nav-label eyebrow">Your projects</div>}
        {active.map((p) => (
          <NavLink key={p.id} to={`/projects/${p.key}`} className="nav-project" title={collapsed ? p.name : undefined}>
            <span className="swatch" style={{ background: p.color }} />
            <span className="nav-text trunc">{p.name}</span>
            <span className="count">{tasks.filter((t) => t.projectId === p.id && t.status !== 'done').length}</span>
          </NavLink>
        ))}
      </nav>
      <div className="side-foot">
        <Link to={`/members/${me.id}`} className="row grow" style={{ minWidth: 0 }}>
          <Avatar user={meUser ?? { name: me.name, avatarColor: '#d4ff3a' }} size={26} online={online.includes(me.id)} />
          <div className="side-foot-text" style={{ minWidth: 0 }}>
            <div className="trunc" style={{ fontWeight: 500 }}>{me.name}</div>
            <div className="xs muted">{ROLE_LABEL[me.role]}</div>
          </div>
        </Link>
        <NavLink to="/settings" className="btn ghost icon sm side-foot-text" title="Settings">
          <Settings />
        </NavLink>
      </div>
    </aside>
  );
}

const SECTION: Record<string, string> = {
  '': 'Home',
  'my-work': 'My work',
  inbox: 'Inbox',
  chat: 'Chat',
  calendar: 'Calendar',
  projects: 'Projects',
  code: 'Code',
  members: 'Members',
  research: 'Research vault',
  submissions: 'Submissions',
  competitions: 'Competitions',
  equipment: 'Equipment',
  settings: 'Settings',
};

function Topbar() {
  const loc = useLocation();
  const nav = useNavigate();
  const { setPalette, setMobileNav, openCreateTask, setCreateProject, online, connected } = useUI();
  const users = useUsers();
  const projects = useProjects();
  const notifications = useNotifications();
  const me = useMe()!;
  const parts = loc.pathname.split('/').filter(Boolean);
  const section = SECTION[parts[0] ?? ''] ?? '';
  let detail: string | null = null;
  if (parts[0] === 'projects' && parts[1]) detail = projects.find((p) => p.key === parts[1])?.name ?? parts[1];
  if (parts[0] === 'members' && parts[1]) detail = users.find((u) => u.id === parts[1])?.name ?? null;
  if (parts[0] === 'code' && parts[1]) detail = `${parts[1]}/${parts[2] ?? ''}`;
  const unread = notifications.filter((n) => !n.readAt).length;
  const onlineUsers = users.filter((u) => online.includes(u.id) && u.id !== me.id);
  return (
    <header className="topbar">
      <button className="btn ghost icon sm mobile-only" onClick={() => setMobileNav(true)} aria-label="Menu">
        <Menu />
      </button>
      <div className="crumbs desktop-only">
        {detail ? (
          <>
            <Link to={`/${parts[0]}`}>{section}</Link>
            <span className="faint">/</span>
            <span className="cur trunc">{detail}</span>
          </>
        ) : (
          <span className="cur">{section}</span>
        )}
      </div>
      <div className="grow desktop-only" />
      <button className="ask-trigger" onClick={() => useUI.getState().setAssistant(true)} title="Ask Aether (⌘J)">
        <Sparkles />
        <span className="desktop-only">Ask Aether</span>
      </button>
      <button className="search-trigger" onClick={() => setPalette(true)}>
        <Search />
        <span className="grow" style={{ textAlign: 'left' }}>
          Search or jump to…
        </span>
        <span className="kbd">⌘K</span>
      </button>
      <div className="row gap-12">
        <span className="row gap-6 desktop-only" title={connected ? 'Live: changes appear instantly' : 'Reconnecting…'}>
          <span className="dot" style={{ background: connected ? 'var(--green)' : 'var(--amber)' }} />
          <span className="xs muted mono">{connected ? 'LIVE' : 'SYNC'}</span>
        </span>
        {onlineUsers.length > 0 && (
          <div className="presence desktop-only" title={`${onlineUsers.map((u) => u.name).join(', ')} online`}>
            {onlineUsers.slice(0, 5).map((u) => (
              <Avatar key={u.id} user={u} size={22} online />
            ))}
          </div>
        )}
        <InstallButton />
        <CreateMenu onTask={() => openCreateTask({})} onProject={() => setCreateProject(true)} canProject={me.role !== 'member' && me.role !== 'guest'} disabled={me.role === 'guest'} />
        <button className="btn ghost icon sm" style={{ position: 'relative' }} onClick={() => nav('/inbox')} aria-label="Notifications">
          <Bell />
          {unread > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 0 2px var(--bg)' }} />}
        </button>
      </div>
    </header>
  );
}

function CreateMenu({ onTask, onProject, canProject, disabled }: { onTask: () => void; onProject: () => void; canProject: boolean; disabled: boolean }) {
  if (disabled) return null;
  return (
    <div className="row gap-2">
      <button className="btn primary sm" onClick={onTask} title="New task (C)">
        <Plus />
        <span className="desktop-only">New task</span>
      </button>
      {canProject && (
        <button className="btn sm desktop-only" onClick={onProject}>
          <FolderKanban />
          Project
        </button>
      )}
    </div>
  );
}

function InstallButton() {
  const { prompt, installed } = usePwa();
  if (installed || !prompt) return null;
  return (
    <button className="btn sm desktop-only" title="Install Aether as an app" onClick={() => installApp()}>
      <Download />
      Install app
    </button>
  );
}
