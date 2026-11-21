import { Command } from 'cmdk';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Bell, Boxes, Calendar, CheckSquare, Code2, FileText, FlaskConical, FolderKanban, LayoutDashboard, MessageSquare, MessagesSquare, Moon, Plus, Settings, Trophy, UserPlus, Users } from 'lucide-react';
import { useUI } from '../lib/store';
import { useCompetitions, useEquipment, useMe, usePapers, useProjects, useTasks, useUsers } from '../lib/data';
import { api } from '../lib/api';
import { savePrefs } from './Shell';
import { Avatar, StatusIcon } from './ui';
import type { SearchHit } from '../types';

export function CommandPalette() {
  const { paletteOpen, setPalette, openCreateTask, setCreateProject } = useUI();
  const nav = useNavigate();
  const me = useMe();
  const projects = useProjects();
  const tasks = useTasks();
  const users = useUsers();
  const papers = usePapers();
  const comps = useCompetitions();
  const equipment = useEquipment();
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (!paletteOpen) setQ('');
  }, [paletteOpen]);
  useEffect(() => {
    if (q.trim().length < 2) return setRemote([]);
    const t = setTimeout(() => {
      api.get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q.trim())}`).then(setRemote).catch(() => setRemote([]));
    }, 160);
    return () => clearTimeout(t);
  }, [q]);

  const pmap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const ql = q.trim().toLowerCase();
  const localTasks = ql
    ? tasks
        .filter((t) => {
          const k = `${pmap.get(t.projectId)?.key}-${t.number}`.toLowerCase();
          return t.title.toLowerCase().includes(ql) || k === ql || k.startsWith(ql + '');
        })
        .slice(0, 8)
    : tasks.filter((t) => t.assigneeId === me?.id && t.status !== 'done').slice(0, 5);
  const localProjects = projects.filter((p) => !ql || p.name.toLowerCase().includes(ql) || p.key.toLowerCase().includes(ql)).slice(0, 6);
  const localUsers = ql ? users.filter((u) => u.name.toLowerCase().includes(ql) || Object.keys(u.skills).some((s) => s.toLowerCase().includes(ql)) || u.title.toLowerCase().includes(ql)).slice(0, 6) : [];
  const localPapers = ql ? papers.filter((p) => p.title.toLowerCase().includes(ql) || p.authors.toLowerCase().includes(ql) || p.tags.some((t) => t.toLowerCase().includes(ql))).slice(0, 5) : [];
  const localComps = ql ? comps.filter((c) => c.name.toLowerCase().includes(ql)).slice(0, 4) : [];
  const localEq = ql ? equipment.filter((e) => e.name.toLowerCase().includes(ql) || e.tag.toLowerCase().includes(ql)).slice(0, 4) : [];
  const seen = new Set([...localTasks, ...localProjects, ...localUsers, ...localPapers, ...localComps, ...localEq].map((x) => x.id));
  const extra = remote.filter((r) => !seen.has(r.id));

  if (!paletteOpen) return null;
  const go = (path: string) => {
    setPalette(false);
    nav(path);
  };
  const run = (fn: () => void) => {
    setPalette(false);
    fn();
  };
  const taskLink = (projectId: string, id: string) => `/projects/${pmap.get(projectId)?.key}?task=${id}`;
  const hitLink = (h: SearchHit) => {
    switch (h.type) {
      case 'project':
        return `/projects/${h.sub}`;
      case 'task':
        return `/projects/${h.detail}?task=${h.id}`;
      case 'member':
        return `/members/${h.id}`;
      case 'paper':
        return `/research/${h.id}`;
      case 'competition':
        return `/competitions?c=${h.id}`;
      case 'equipment':
        return `/equipment?e=${h.id}`;
      case 'event':
        return `/calendar?event=${h.id}`;
      case 'message':
        return `/chat/${h.detail}`;
    }
  };
  return createPortal(
    <>
      <div className="scrim" onClick={() => setPalette(false)} />
      <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
        <Command className="palette" shouldFilter={false} onKeyDown={(e) => e.key === 'Escape' && setPalette(false)} label="Command palette">
          <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Search projects, tasks, people, papers, competitions, equipment, messages…" />
          <Command.List>
            <Command.Empty>Nothing found for “{q}”.</Command.Empty>
            {localTasks.length > 0 && (
              <Command.Group heading={ql ? 'Tasks' : 'Your open tasks'}>
                {localTasks.map((t) => (
                  <Command.Item key={t.id} value={`task-${t.id}`} onSelect={() => go(taskLink(t.projectId, t.id))}>
                    <StatusIcon status={t.status} />
                    <span className="key">{pmap.get(t.projectId)?.key}-{t.number}</span>
                    <span className="trunc">{t.title}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {localProjects.length > 0 && (
              <Command.Group heading="Projects">
                {localProjects.map((p) => (
                  <Command.Item key={p.id} value={`project-${p.id}`} onSelect={() => go(`/projects/${p.key}`)}>
                    <span className="swatch" style={{ background: p.color }} />
                    <span className="trunc">{p.name}</span>
                    <span className="key" style={{ marginLeft: 'auto' }}>{p.key}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {localUsers.length > 0 && (
              <Command.Group heading="People">
                {localUsers.map((u) => (
                  <Command.Item key={u.id} value={`user-${u.id}`} onSelect={() => go(`/members/${u.id}`)}>
                    <Avatar user={u} size={18} />
                    <span>{u.name}</span>
                    <span className="muted small trunc">{u.title}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {(localPapers.length > 0 || localComps.length > 0 || localEq.length > 0) && (
              <Command.Group heading="Lab">
                {localPapers.map((p) => (
                  <Command.Item key={p.id} value={`paper-${p.id}`} onSelect={() => go(`/research/${p.id}`)}>
                    <FileText />
                    <span className="trunc">{p.title}</span>
                    <span className="muted small trunc">{p.authors}</span>
                  </Command.Item>
                ))}
                {localComps.map((c) => (
                  <Command.Item key={c.id} value={`comp-${c.id}`} onSelect={() => go(`/competitions?c=${c.id}`)}>
                    <Trophy />
                    <span className="trunc">{c.name}</span>
                  </Command.Item>
                ))}
                {localEq.map((e) => (
                  <Command.Item key={e.id} value={`eq-${e.id}`} onSelect={() => go(`/equipment?e=${e.id}`)}>
                    <Boxes />
                    <span className="trunc">{e.name}</span>
                    <span className="key">{e.tag}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {extra.length > 0 && (
              <Command.Group heading="More results">
                {extra.map((h) => (
                  <Command.Item key={`${h.type}-${h.id}`} value={`hit-${h.type}-${h.id}`} onSelect={() => go(hitLink(h))}>
                    {h.type === 'message' ? <MessageSquare /> : h.type === 'event' ? <Calendar /> : <FileText />}
                    <span className="trunc">{h.type === 'message' ? h.title.replace(/<@usr_[a-z0-9]+>/g, '@…') : h.title}</span>
                    <span className="muted small trunc">{h.type === 'message' ? `#${h.sub}` : h.sub}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {!ql && (
              <>
                <Command.Group heading="Actions">
                  {me?.role !== 'guest' && (
                    <Command.Item value="new-task" onSelect={() => run(() => openCreateTask({}))}>
                      <Plus /> New task <span className="kbd" style={{ marginLeft: 'auto' }}>C</span>
                    </Command.Item>
                  )}
                  {(me?.role === 'owner' || me?.role === 'admin' || me?.role === 'lead') && (
                    <Command.Item value="new-project" onSelect={() => run(() => setCreateProject(true))}>
                      <FolderKanban /> New project
                    </Command.Item>
                  )}
                  {(me?.role === 'owner' || me?.role === 'admin') && (
                    <Command.Item value="invite" onSelect={() => go('/settings/team')}>
                      <UserPlus /> Invite someone by email
                    </Command.Item>
                  )}
                  <Command.Item value="theme" onSelect={() => run(() => me && savePrefs({ ...me.prefs, theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }))}>
                    <Moon /> Toggle light / dark
                  </Command.Item>
                </Command.Group>
                <Command.Group heading="Go to">
                  {[
                    ['/', 'Dashboard', LayoutDashboard],
                    ['/my-work', 'My work', CheckSquare],
                    ['/inbox', 'Inbox', Bell],
                    ['/chat', 'Chat', MessagesSquare],
                    ['/calendar', 'Calendar', Calendar],
                    ['/projects', 'Projects', FolderKanban],
                    ['/code', 'Code', Code2],
                    ['/members', 'Members', Users],
                    ['/members/skills', 'Skills matrix', Users],
                    ['/research', 'Research vault', FlaskConical],
                    ['/competitions', 'Competitions', Trophy],
                    ['/equipment', 'Equipment', Boxes],
                    ['/settings', 'Settings', Settings],
                  ].map(([to, label, Icon]) => {
                    const I = Icon as typeof Bell;
                    return (
                      <Command.Item key={to as string} value={`go-${to}`} onSelect={() => go(to as string)}>
                        <I /> {label as string}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              </>
            )}
          </Command.List>
          <div className="palette-foot">
            <span>
              <span className="kbd">↑↓</span> navigate
            </span>
            <span>
              <span className="kbd">↵</span> open
            </span>
            <span>
              <span className="kbd">esc</span> close
            </span>
            <span style={{ marginLeft: 'auto' }}>Tip: type a task key like SAA-3</span>
          </div>
        </Command>
      </div>
    </>,
    document.body,
  );
}
