// Aether desktop — a native shell around your Aether workspace.
// It remembers the workspace address, keeps a tray icon, shows the unread count as a badge,
// delivers system notifications, can launch at login, and opens outside links in your browser.
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, Notification, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG(), 'utf8'));
  } catch {
    return {};
  }
}
function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(CONFIG()), { recursive: true });
  fs.writeFileSync(CONFIG(), JSON.stringify(next, null, 2));
  return next;
}

let win = null;
let tray = null;
let quitting = false;
let unread = 0;

const ALLOWED_AUTH_HOSTS = ['github.com'];

function workspaceOrigin() {
  const url = readConfig().workspace;
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

function createWindow() {
  const cfg = readConfig();
  const bounds = cfg.bounds ?? { width: 1440, height: 920 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 560,
    show: false,
    backgroundColor: '#0a0a0b',
    title: 'Aether',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (cfg.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  const saveBounds = () => {
    if (!win || win.isMinimized()) return;
    writeConfig({ bounds: win.isMaximized() ? cfg.bounds : win.getBounds(), maximized: win.isMaximized() });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('close', (e) => {
    // Closing hides to the tray so notifications keep arriving; Quit from the tray menu exits.
    if (!quitting && tray) {
      e.preventDefault();
      win.hide();
    }
  });

  // Links: stay in-app for the workspace and the GitHub sign-in round trip, open everything else in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const origin = workspaceOrigin();
    if (origin && url.startsWith(`${origin}/api/files/`)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const origin = workspaceOrigin();
    const u = new URL(url);
    if (url.startsWith('file:')) return;
    if (origin && u.origin === origin) return;
    if (ALLOWED_AUTH_HOSTS.includes(u.hostname)) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return; // aborted (redirects)
    if (url && url.startsWith('file:')) return;
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: url ?? '', reason: desc } });
  });

  load();
}

function load() {
  const url = readConfig().workspace;
  if (url) win.loadURL(url);
  else win.loadFile(path.join(__dirname, 'setup.html'));
}

function trayImage() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', file));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 18, height: 18 }) : img;
}

function buildTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Aether');
  tray.on('click', show);
  refreshTrayMenu();
}
function refreshTrayMenu() {
  if (!tray) return;
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setToolTip(unread ? `Aether — ${unread} unread` : 'Aether');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: unread ? `Open Aether (${unread} unread)` : 'Open Aether', click: show },
      { type: 'separator' },
      { label: 'Reload', click: () => win && win.reload() },
      { label: 'Change workspace…', click: changeWorkspace },
      { label: 'Launch at login', type: 'checkbox', checked: login, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, openAsHidden: true }) },
      { type: 'separator' },
      { label: 'Quit Aether', click: () => ((quitting = true), app.quit()) },
    ]),
  );
}
function show() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
async function changeWorkspace() {
  show();
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Change', 'Cancel'], defaultId: 1, message: 'Connect to a different Aether workspace?', detail: `Current: ${readConfig().workspace ?? 'none'}` });
  if (r.response !== 0) return;
  writeConfig({ workspace: null });
  load();
}

function appMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Change workspace…', click: changeWorkspace }, { type: 'separator' }, isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'Ctrl+Q', click: () => ((quitting = true), app.quit()) }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => win?.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => win?.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC from the page (through preload.js) ----
ipcMain.on('aether:version', (e) => (e.returnValue = app.getVersion()));
ipcMain.on('aether:set-badge', (_e, n) => {
  const next = Math.max(0, Number(n) || 0);
  if (next > unread && win && !win.isFocused()) win.flashFrame(true);
  unread = next;
  app.setBadgeCount(unread);
  refreshTrayMenu();
});
ipcMain.on('aether:notify', (_e, { title, body }) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title: String(title).slice(0, 120), body: String(body ?? '').slice(0, 300), silent: false });
    n.on('click', show);
    n.show();
  }
});
ipcMain.handle('aether:set-workspace', async (_e, raw) => {
  let url;
  try {
    url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: 'That does not look like a web address.' };
  }
  try {
    const res = await fetch(`${url.origin}/api/health`, { signal: AbortSignal.timeout(10_000) });
    const json = await res.json();
    if (!json.ok) throw new Error('unexpected response');
  } catch (e) {
    return { ok: false, error: `Could not reach an Aether workspace at ${url.origin} (${e.message}).` };
  }
  writeConfig({ workspace: url.origin });
  load();
  return { ok: true };
});
ipcMain.handle('aether:retry', () => load());

// ---- lifecycle ----
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.setAppUserModelId('lab.aether.desktop');
  app.whenReady().then(() => {
    appMenu();
    createWindow();
    buildTray();
    app.on('activate', show);
  });
  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
