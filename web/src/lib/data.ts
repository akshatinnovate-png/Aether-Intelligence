import { QueryClient, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './api';
import { toast, useUI } from './store';
import type {
  Achievement,
  Activity,
  Booking,
  CalEvent,
  Channel,
  Collection,
  Competition,
  Equipment,
  Me,
  Message,
  Milestone,
  Notification,
  Paper,
  Project,
  Task,
  User,
} from '../types';

export const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 } },
});

/** Collections the client mirrors in full. Realtime upserts keep them current without refetching. */
export const COLLECTIONS = {
  users: '/api/users',
  projects: '/api/projects',
  milestones: '/api/milestones',
  tasks: '/api/tasks',
  competitions: '/api/competitions',
  equipment: '/api/equipment',
  bookings: '/api/bookings',
  events: '/api/events',
  papers: '/api/papers',
  collections: '/api/collections',
  achievements: '/api/achievements',
} as const;
export type CollectionName = keyof typeof COLLECTIONS;
type RowOf = {
  users: User;
  projects: Project;
  milestones: Milestone;
  tasks: Task;
  competitions: Competition;
  equipment: Equipment;
  bookings: Booking;
  events: CalEvent;
  papers: Paper;
  collections: Collection;
  achievements: Achievement;
};

function useCollection<K extends CollectionName>(name: K) {
  const q = useQuery({ queryKey: [name], queryFn: () => api.get<RowOf[K][]>(COLLECTIONS[name]) });
  return q.data ?? (EMPTY as RowOf[K][]);
}
const EMPTY: never[] = [];

export const useUsers = () => useCollection('users');
export const useProjects = () => useCollection('projects');
export const useMilestones = () => useCollection('milestones');
export const useTasks = () => useCollection('tasks');
export const useCompetitions = () => useCollection('competitions');
export const useEquipment = () => useCollection('equipment');
export const useBookings = () => useCollection('bookings');
export const useEvents = () => useCollection('events');
export const usePapers = () => useCollection('papers');
export const useCollections = () => useCollection('collections');
export const useAchievements = () => useCollection('achievements');

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me'), staleTime: Infinity }).data;
}
export function useActivity() {
  return useQuery({ queryKey: ['activity'], queryFn: () => api.get<Activity[]>('/api/activity?limit=120') }).data ?? (EMPTY as Activity[]);
}
export function useNotifications() {
  return useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/api/notifications') }).data ?? (EMPTY as Notification[]);
}
export function useChannels() {
  return useQuery({ queryKey: ['channels'], queryFn: () => api.get<Channel[]>('/api/channels') }).data ?? (EMPTY as Channel[]);
}
export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, string | boolean>>('/api/settings') }).data ?? {};
}

export function useById<T extends { id: string }>(rows: T[]) {
  return useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
}

// ---------- cache patching ----------
export function upsertRows<K extends CollectionName>(name: K, rows: RowOf[K][]) {
  qc.setQueryData<RowOf[K][]>([name], (old) => {
    if (!old) return old;
    const byId = new Map(old.map((r) => [r.id, r]));
    for (const r of rows) byId.set(r.id, r);
    return [...byId.values()];
  });
}
export function removeRows(name: CollectionName, ids: string[]) {
  const set = new Set(ids);
  qc.setQueryData<{ id: string }[]>([name], (old) => old?.filter((r) => !set.has(r.id)));
}

/** Write helpers: call the API, then put the returned row into the cache immediately. */
export async function save<K extends CollectionName>(name: K, path: string, method: 'post' | 'patch' | 'put', body: unknown): Promise<RowOf[K]> {
  const row = await api[method]<RowOf[K]>(path, body);
  if (row && (row as { id?: string }).id) upsertRows(name, [row]);
  return row;
}
export async function destroy(name: CollectionName, path: string, id: string) {
  await api.del(path);
  removeRows(name, [id]);
}

/** Optimistic task patch: update the cache first (drag and drop must feel instant), roll back on failure. */
export async function patchTask(id: string, patch: Partial<Task>) {
  const prev = qc.getQueryData<Task[]>(['tasks']);
  qc.setQueryData<Task[]>(['tasks'], (old) => old?.map((t) => (t.id === id ? { ...t, ...patch, ...(patch.status ? { completedAt: patch.status === 'done' ? t.completedAt ?? new Date().toISOString() : null } : {}) } : t)));
  try {
    const row = await api.patch<Task>(`/api/tasks/${id}`, patch);
    upsertRows('tasks', [row]);
    return row;
  } catch (e) {
    if (prev) qc.setQueryData(['tasks'], prev);
    throw e;
  }
}

// ---------- realtime ----------
type Live =
  | { t: 'hello'; online: string[] }
  | { t: 'presence'; online: string[] }
  | { t: 'upsert'; e: CollectionName; rows: { id: string }[] }
  | { t: 'delete'; e: CollectionName; ids: string[] }
  | { t: 'refresh' | 'reload'; e: CollectionName }
  | { t: 'activity'; row: Activity }
  | { t: 'notification'; row: Notification }
  | { t: 'message' | 'message_update'; row: Message }
  | { t: 'typing'; channelId: string; userId: string }
  | { t: 'channels' }
  | { t: 'comment'; taskId: string }
  | { t: 'pong' };

let socket: WebSocket | null = null;
let retry = 0;
let stopped = false;
let pingTimer: ReturnType<typeof setInterval> | undefined;
export let currentChannel: string | null = null;
export const setCurrentChannel = (id: string | null) => {
  currentChannel = id;
};

export function connectRealtime(meId: string) {
  stopped = false;
  const open = () => {
    if (stopped) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    socket = ws;
    ws.onopen = () => {
      const wasRetry = retry > 0;
      retry = 0;
      useUI.getState().setConnected(true);
      // After a gap, refetch everything once so nothing missed is lost.
      if (wasRetry) qc.invalidateQueries();
      clearInterval(pingTimer);
      pingTimer = setInterval(() => ws.readyState === 1 && ws.send('{"t":"ping"}'), 30_000);
    };
    ws.onclose = () => {
      useUI.getState().setConnected(false);
      clearInterval(pingTimer);
      if (stopped) return;
      retry++;
      setTimeout(open, Math.min(15_000, 500 * 2 ** Math.min(retry, 5)));
    };
    ws.onmessage = (ev) => {
      let m: Live;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      handle(m, meId);
    };
  };
  open();
  return () => {
    stopped = true;
    socket?.close();
  };
}
export function sendTyping(channelId: string) {
  if (socket?.readyState === 1) socket.send(JSON.stringify({ t: 'typing', channelId }));
}

function handle(m: Live, meId: string) {
  switch (m.t) {
    case 'hello':
    case 'presence':
      useUI.getState().setOnline(m.online);
      break;
    case 'upsert':
      upsertRows(m.e, m.rows as never);
      break;
    case 'delete':
      removeRows(m.e, m.ids);
      break;
    case 'refresh':
    case 'reload':
      qc.invalidateQueries({ queryKey: [m.e] });
      break;
    case 'activity':
      qc.setQueryData<Activity[]>(['activity'], (old) => (old ? [m.row, ...old.filter((a) => a.id !== m.row.id)].slice(0, 300) : old));
      break;
    case 'notification':
      qc.setQueryData<Notification[]>(['notifications'], (old) => (old ? [m.row, ...old] : old));
      toast({ title: m.row.title, body: m.row.body, link: m.row.link });
      if (window.aetherDesktop) {
        if (document.hidden || !document.hasFocus()) window.aetherDesktop.notify(m.row.title, m.row.body);
      } else if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(m.row.title, { body: m.row.body, tag: m.row.id });
        } catch {
          /* unsupported */
        }
      }
      break;
    case 'message': {
      const row = m.row;
      const key = row.parentId ? ['thread', row.parentId] : ['messages', row.channelId];
      qc.setQueryData<Message[]>(key, (old) => (old && !old.some((x) => x.id === row.id) ? [...old, row] : old));
      if (row.parentId) qc.setQueryData<Message[]>(['thread', row.parentId], (old) => old);
      qc.setQueryData<Channel[]>(['channels'], (old) =>
        old?.map((c) =>
          c.id === row.channelId
            ? {
                ...c,
                lastMessageAt: row.createdAt,
                unread: row.userId !== meId && currentChannel !== c.id && !row.parentId ? c.unread + 1 : c.unread,
                mentions: row.userId !== meId && currentChannel !== c.id && row.body.includes(`<@${meId}>`) ? c.mentions + 1 : c.mentions,
              }
            : c,
        ),
      );
      if (!qc.getQueryData<Channel[]>(['channels'])?.some((c) => c.id === row.channelId)) qc.invalidateQueries({ queryKey: ['channels'] });
      break;
    }
    case 'message_update': {
      const row = m.row;
      const patch = (old?: Message[]) => old?.map((x) => (x.id === row.id ? row : x));
      qc.setQueryData<Message[]>(['messages', row.channelId], patch);
      if (row.parentId) qc.setQueryData<Message[]>(['thread', row.parentId], patch);
      qc.setQueryData<Message[]>(['thread', row.id], patch);
      break;
    }
    case 'typing':
      if (m.userId !== meId) useUI.getState().setTyping(m.channelId, m.userId);
      break;
    case 'channels':
      qc.invalidateQueries({ queryKey: ['channels'] });
      break;
    case 'comment':
      qc.invalidateQueries({ queryKey: ['task-detail', m.taskId] });
      break;
  }
}
