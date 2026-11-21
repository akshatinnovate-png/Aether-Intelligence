import { create } from 'zustand';

/** Installable-app (PWA) state: the browser's install prompt, and whether we're already running installed. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface PwaState {
  prompt: InstallPrompt | null;
  installed: boolean;
}
export const usePwa = create<PwaState>(() => ({
  prompt: null,
  installed: matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
}));

export function initPwa() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    usePwa.setState({ prompt: e as InstallPrompt });
  });
  window.addEventListener('appinstalled', () => usePwa.setState({ prompt: null, installed: true }));
}

export async function installApp() {
  const p = usePwa.getState().prompt;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  usePwa.setState({ prompt: null });
  return outcome === 'accepted';
}

/** System notification that works in installed apps on Android, desktop and iOS (16.4+). */
export async function systemNotify(title: string, body: string, link: string, tag: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { link } });
    new Notification(title, { body, tag });
  } catch {
    /* unsupported */
  }
}

/** Unread count on the installed app's icon (desktop Chrome/Edge, Android, iOS 16.4+). */
export function setAppBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) nav.setAppBadge?.(n).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  } catch {
    /* unsupported */
  }
}
