import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Bell, Calendar, CheckCheck, FolderKanban, GitPullRequest, MessageSquare, Trash2, Trophy, UserPlus, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { qc, useNotifications, useUsers } from '../lib/data';
import { ago, d } from '../lib/derive';
import { toastError } from '../lib/store';
import { Avatar, Empty, Seg } from '../components/ui';
import type { Notification } from '../types';
import { format, isToday, isYesterday } from 'date-fns';

const ICON: Record<string, typeof Bell> = { assigned: FolderKanban, mention: AtSign, comment: MessageSquare, status: CheckCheck, deadline: Calendar, competition: Trophy, booking: Wrench, team: UserPlus, github: GitPullRequest, message: MessageSquare, project: FolderKanban };

export default function Inbox() {
  const notifications = useNotifications();
  const users = useUsers();
  const nav = useNavigate();
  const [filter, setFilter] = useState<'unread' | 'all' | 'mentions'>('unread');
  const list = notifications.filter((n) => (filter === 'unread' ? !n.readAt : filter === 'mentions' ? n.kind === 'mention' || n.kind === 'message' : true));
  const markRead = async (ids?: string[]) => {
    const t = new Date().toISOString();
    qc.setQueryData<Notification[]>(['notifications'], (old) => old?.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? t } : n)));
    await api.post('/api/notifications/read', { ids }).catch(toastError);
  };
  const groups = new Map<string, Notification[]>();
  for (const n of list) {
    const day = d(n.createdAt)!;
    const k = isToday(day) ? 'Today' : isYesterday(day) ? 'Yesterday' : format(day, 'EEEE d MMMM');
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Notifications</div>
          <h1 className="h-display">Inbox</h1>
          <p>Every entry here was caused by a real change: an assignment, a mention, a deadline, a stage change, a booking, a push.</p>
        </div>
        <div className="row gap-6">
          <button className="btn sm" onClick={() => markRead()} disabled={!notifications.some((n) => !n.readAt)}>
            <CheckCheck /> Mark all read
          </button>
          <button
            className="btn ghost sm"
            onClick={async () => {
              await api.del('/api/notifications').catch(toastError);
              qc.setQueryData<Notification[]>(['notifications'], (old) => old?.filter((n) => !n.readAt));
            }}
          >
            <Trash2 /> Clear read
          </button>
          {'Notification' in window && Notification.permission === 'default' && (
            <button className="btn ghost sm" onClick={() => Notification.requestPermission()}>
              <Bell /> Desktop alerts
            </button>
          )}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <Seg value={filter} onChange={setFilter} options={[{ id: 'unread', label: `Unread · ${notifications.filter((n) => !n.readAt).length}` }, { id: 'mentions', label: 'Mentions & DMs' }, { id: 'all', label: 'All' }]} />
      </div>
      {list.length ? (
        [...groups.entries()].map(([day, items]) => (
          <div key={day} style={{ marginBottom: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{day}</div>
            <div className="panel">
              <div className="list">
                {items.map((n) => {
                  const I = ICON[n.kind] ?? Bell;
                  const actor = users.find((u) => u.id === n.actorId);
                  return (
                    <button
                      key={n.id}
                      className="li"
                      style={{ paddingTop: 10, paddingBottom: 10, alignItems: 'flex-start' }}
                      onClick={() => {
                        markRead([n.id]);
                        if (n.link) nav(n.link);
                      }}
                    >
                      <span style={{ width: 8, paddingTop: 7 }}>{!n.readAt && <span className="dot" style={{ background: 'var(--accent)' }} />}</span>
                      {actor ? <Avatar user={actor} size={24} /> : <span className="avatar" style={{ '--s': '24px', background: 'var(--line-2)', color: 'var(--text-2)' } as React.CSSProperties}><I size={12} /></span>}
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row gap-6">
                          <I size={12} className="muted" />
                          <span style={{ fontWeight: n.readAt ? 400 : 500 }} className="trunc">{n.title}</span>
                        </div>
                        {n.body && <div className="small muted clamp2" style={{ marginTop: 2 }}>{n.body.replace(/<@usr_[a-z0-9]+>/g, '@…')}</div>}
                      </div>
                      <span className="xs faint" style={{ flex: 'none' }}>{ago(n.createdAt)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className="panel">
          <Empty icon={<CheckCheck />} title={filter === 'unread' ? 'All caught up' : 'Nothing here'}>
            New assignments, mentions and deadlines will land here, live.
          </Empty>
        </div>
      )}
    </div>
  );
}
