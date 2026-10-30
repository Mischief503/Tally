'use strict';
// What MoveCrew's page can ask of the Windows app (window.tallyDesktop). Nothing else from the
// computer reaches the page; main.js checks every request comes from MoveCrew's own page.
const { contextBridge, ipcRenderer } = require('electron');

let updateSeen = '';
contextBridge.exposeInMainWorld('tallyDesktop', {
  platform: 'windows',
  // a link leaving MoveCrew: the browser, or the computer's app for calls, texts and email
  open: (url) => ipcRenderer.send('movecrew:open', String(url || '')),
  // a truck-down alert ({title, body}) flashes MoveCrew on the taskbar and shows a Windows notice; null stops the flashing
  attention: (info) => ipcRenderer.send('movecrew:attention', info ? { title: String(info.title || ''), body: String(info.body || '') } : null),
  // cb({version}) once a new version has downloaded, now or later
  onUpdate: (cb) => {
    if (typeof cb !== 'function') return;
    const tell = (v) => { v = String(v || ''); if (!v || v === updateSeen) return; updateSeen = v; try { cb({ version: v }); } catch (e) { /* the page's own problem */ } };
    ipcRenderer.on('movecrew:update', (_e, v) => tell(v));
    ipcRenderer.invoke('movecrew:pending').then(tell, () => {});
  },
  // install the downloaded version and open MoveCrew again (resolves false when there is none)
  restart: () => ipcRenderer.invoke('movecrew:restart'),
});
