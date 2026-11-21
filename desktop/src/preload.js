// The only bridge between the page and the desktop shell. Nothing else from Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aetherDesktop', {
  isDesktop: true,
  version: ipcRenderer.sendSync('aether:version'),
  platform: process.platform,
  setBadge: (n) => ipcRenderer.send('aether:set-badge', n),
  notify: (title, body) => ipcRenderer.send('aether:notify', { title, body }),
  setWorkspace: (url) => ipcRenderer.invoke('aether:set-workspace', url),
  retry: () => ipcRenderer.invoke('aether:retry'),
});
