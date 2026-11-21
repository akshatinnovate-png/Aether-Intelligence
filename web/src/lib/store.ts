import { create } from 'zustand';
import type { Task } from '../types';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  kind?: 'info' | 'error';
  link?: string;
}

interface UI {
  paletteOpen: boolean;
  mobileNav: boolean;
  online: string[];
  typing: Record<string, Record<string, number>>; // channelId -> userId -> expiry
  toasts: Toast[];
  createTask: Partial<Task> | null;
  createTaskSeq: number;
  createProject: boolean;
  connected: boolean;
  setPalette(open: boolean): void;
  setMobileNav(open: boolean): void;
  setOnline(ids: string[]): void;
  setTyping(channelId: string, userId: string): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
  openCreateTask(defaults?: Partial<Task>): void;
  closeCreateTask(): void;
  setCreateProject(open: boolean): void;
  setConnected(c: boolean): void;
}

let toastId = 1;
export const useUI = create<UI>((set, get) => ({
  paletteOpen: false,
  mobileNav: false,
  online: [],
  typing: {},
  toasts: [],
  createTask: null,
  createTaskSeq: 0,
  createProject: false,
  connected: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setMobileNav: (mobileNav) => set({ mobileNav }),
  setOnline: (online) => set({ online }),
  setTyping(channelId, userId) {
    const typing = { ...get().typing, [channelId]: { ...(get().typing[channelId] ?? {}), [userId]: Date.now() + 4000 } };
    set({ typing });
    setTimeout(() => {
      const cur = { ...get().typing };
      const ch = { ...(cur[channelId] ?? {}) };
      if ((ch[userId] ?? 0) <= Date.now()) {
        delete ch[userId];
        cur[channelId] = ch;
        set({ typing: cur });
      }
    }, 4100);
  },
  toast(t) {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.kind === 'error' ? 7000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  openCreateTask: (defaults = {}) => set({ createTask: defaults, createTaskSeq: get().createTaskSeq + 1 }),
  closeCreateTask: () => set({ createTask: null }),
  setCreateProject: (createProject) => set({ createProject }),
  setConnected: (connected) => set({ connected }),
}));

export const toast = (t: Omit<Toast, 'id'>) => useUI.getState().toast(t);
export const toastError = (e: unknown) => toast({ title: e instanceof Error ? e.message : String(e), kind: 'error' });
