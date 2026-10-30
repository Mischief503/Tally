'use strict';
/*
 * MoveCrew for Windows: the MoveCrew app in its own window, for the office, dispatch and the call
 * center (the crews have the Android app). The same web/index.html as the website and the phone app,
 * packed inside by scripts/prepare_windows.py.
 *
 * - The page is served from app://movecrew/, a private secure address only this app opens, so it
 *   needs no website, and sign-in and settings stay put between starts.
 * - Websites, Stripe's pages, documents, maps, calls, texts and email open in the computer's own
 *   apps: the browser, and Phone Link or Teams for calls. Stripe's card box loads in place.
 * - A truck-down alert flashes MoveCrew on the taskbar and shows a Windows notice; the chime plays
 *   and the board stays live while the window is in the background.
 * - It keeps itself up to date from the GitHub release: a new version downloads in the background,
 *   and MoveCrew offers to restart into it (or it goes in the next time the app is closed).
 * - Right-click has Cut, Copy, Paste and spelling; Ctrl + and Ctrl - zoom; F5 reloads; the mouse's
 *   back button closes what's open. One window: starting it again brings that window up.
 * - Started with --smoke=<folder>, it opens once, checks itself, saves screenshots and quits. That
 *   is how GitHub checks every build on a Windows computer before publishing it.
 */
const { app, BrowserWindow, Menu, Notification, clipboard, ipcMain, nativeTheme, protocol, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const rules = require('./rules');

const APP_DIR = path.join(__dirname, 'app');
const APP_ID = 'com.movecrew.desktop';
const smokeArg = process.argv.find((a) => a.startsWith('--smoke='));
const SMOKE = smokeArg ? path.resolve(smokeArg.slice('--smoke='.length)) : '';

protocol.registerSchemesAsPrivileged([{ scheme: rules.SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

if (SMOKE) {
  fs.mkdirSync(SMOKE, { recursive: true });
  app.setPath('userData', path.join(SMOKE, 'profile'));   // a fresh computer: nobody signed in
  app.disableHardwareAcceleration();   // GitHub's computers have no graphics card
}
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

let win = null;
let pendingUpdate = '';
let updater = null;

// a slip in the app's own code goes in the log, never an error box in front of the office
process.on('uncaughtException', (e) => log('main error: ' + ((e && e.stack) || e)));
process.on('unhandledRejection', (e) => log('main error: ' + ((e && e.stack) || e)));

/* ---------- a small log in the app's folder, for when something needs looking into ---------- */
function log(msg) {
  const line = new Date().toISOString() + ' ' + msg + '\n';
  try { if (SMOKE) process.stdout.write(line); } catch (e) { /* no console on a Windows app */ }
  try {
    const f = path.join(app.getPath('userData'), 'movecrew.log');
    try { if (fs.statSync(f).size > 1e6) fs.renameSync(f, f + '.old'); } catch (e) { /* no log yet */ }
    fs.appendFileSync(f, line);
  } catch (e) { /* the log is best effort */ }
}

/* ---------- the app's own files, at app://movecrew/ ---------- */
async function serve(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('', { status: 405 });
  const file = rules.fileFor(req.url, APP_DIR);
  if (!file) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.promises.readFile(file);
    return new Response(req.method === 'HEAD' ? null : body, {
      status: 200, headers: { 'content-type': rules.typeOf(file), 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' },
    });
  } catch (e) {
    return new Response('Not found', { status: 404 });
  }
}

/* ---------- links that leave MoveCrew ---------- */
function goOutside(url) {
  const u = rules.outside(url);
  if (!u) { if (url && !rules.inside(url)) log('not opened: ' + String(url).slice(0, 80)); return false; }
  shell.openExternal(u).catch((e) => log('could not open ' + u.split(':')[0] + ' link: ' + e.message));
  return true;
}

/* ---------- the window: where it was, how big, how zoomed ---------- */
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadState() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}; } catch (e) { /* first start */ }
  const out = { width: 1280, height: 840, maximized: !!s.maximized, zoom: Number(s.zoom) || 0 };
  if (s.width >= 380 && s.height >= 560) { out.width = s.width; out.height = s.height; }
  if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
    // only where a screen still is (a laptop off its dock has lost the second monitor)
    const seen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return s.x + 80 < a.x + a.width && s.x + out.width - 80 > a.x && s.y >= a.y - 10 && s.y + 40 < a.y + a.height;
    });
    if (seen) { out.x = s.x; out.y = s.y; }
  }
  return out;
}
function saveState() {
  if (!win || SMOKE) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized(), zoom: win.webContents.getZoomLevel() }));
  } catch (e) { /* not saved this time */ }
}

/* ---------- right-click: cut, copy, paste and spelling, like any Windows app ---------- */
function contextMenu(wc, p) {
  const items = [];
  if (p.misspelledWord) {
    (p.dictionarySuggestions || []).slice(0, 5).forEach((s) => items.push({ label: s, click: () => wc.replaceMisspelling(s) }));
    items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) {
    items.push({ label: 'Undo', role: 'undo', enabled: p.editFlags.canUndo }, { label: 'Redo', role: 'redo', enabled: p.editFlags.canRedo }, { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Copy', role: 'copy', enabled: p.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { label: 'Select all', role: 'selectAll' });
  } else if (p.selectionText && p.selectionText.trim()) {
    items.push({ label: 'Copy', role: 'copy' });
  }
  const link = rules.outside(p.linkURL);
  if (link) {
    if (items.length) items.push({ type: 'separator' });
    const what = /^tel:/.test(link) ? 'phone number' : /^sms:/.test(link) ? 'number' : /^mailto:/.test(link) ? 'email address' : 'link';
    const bare = link.replace(/^[a-z]+:/i, '').replace(/\?.*$/, '');
    let text = bare;
    try { text = decodeURIComponent(bare); } catch (e) { /* keep it as written */ }
    items.push({ label: 'Copy ' + what, click: () => clipboard.writeText(what === 'link' ? link : text) });
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

/* ---------- keys: zoom, reload, full screen, the tools for looking into a problem ---------- */
function keys(wc, e, input) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta, k = String(input.key || '');
  const zoom = (z) => { e.preventDefault(); wc.setZoomLevel(Math.max(-3, Math.min(4, z))); saveState(); };
  if (ctrl && (k === '=' || k === '+')) return zoom(wc.getZoomLevel() + 0.5);
  if (ctrl && (k === '-' || k === '_')) return zoom(wc.getZoomLevel() - 0.5);
  if (ctrl && k === '0') return zoom(0);
  if (k === 'F5' || (ctrl && k.toLowerCase() === 'r')) { e.preventDefault(); if (input.shift) wc.reloadIgnoringCache(); else wc.reload(); return; }
  if (k === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); return; }
  if (ctrl && input.shift && k.toLowerCase() === 'i') { e.preventDefault(); wc.toggleDevTools(); }
}

/* ---------- a truck-down alert: flash on the taskbar, and a Windows notice when MoveCrew isn't in front ---------- */
let notice = null;
function attention(info) {
  if (!win) return;
  if (!info) { win.flashFrame(false); return; }
  if (win.isFocused()) return;
  win.flashFrame(true);
  if (Notification.isSupported()) {
    notice = new Notification({ title: String(info.title || 'MoveCrew').slice(0, 120), body: String(info.body || '').slice(0, 240), urgency: 'critical' });
    notice.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
    notice.show();
  }
}

/* ---------- keeping up to date from the GitHub release (package.json: build.publish) ---------- */
function updates() {
  if (SMOKE || !app.isPackaged) return;
  let au;
  try { au = require('electron-updater').autoUpdater; } catch (e) { log('updater not available: ' + e.message); return; }
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.disableDifferentialDownload = true;   // one whole installer per version (no .blockmap files)
  au.disableWebInstaller = true;
  au.logger = { info: (m) => log('update: ' + m), warn: (m) => log('update: ' + m), error: (m) => log('update error: ' + m), debug: () => {} };
  au.on('update-downloaded', (info) => {
    pendingUpdate = String((info && info.version) || 'new');
    log('update ready: ' + pendingUpdate);
    if (win) win.webContents.send('movecrew:update', pendingUpdate);
  });
  updater = au;
  const check = () => au.checkForUpdates().catch((e) => log('update check: ' + e.message));
  setTimeout(check, 20000);
  setInterval(check, 3 * 3600e3);
}

// only MoveCrew's own page talks to the app (never a frame inside it, like Stripe's card box)
function fromApp(e) {
  const f = e && e.senderFrame;
  return !!f && !f.parent && rules.inside(f.url);
}

function createWindow() {
  const st = SMOKE ? { width: 1280, height: 800, zoom: 0 } : loadState();
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height, minWidth: 380, minHeight: 560,
    show: !!SMOKE, title: 'MoveCrew', backgroundColor: dark ? '#0E1422' : '#F4F6F9', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      spellcheck: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', webviewTag: false,
    },
  });
  const wc = win.webContents;
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  wc.on('did-finish-load', () => { if (st.zoom) wc.setZoomLevel(st.zoom); if (pendingUpdate) wc.send('movecrew:update', pendingUpdate); });

  wc.setWindowOpenHandler(({ url }) => { goOutside(url); return { action: 'deny' }; });
  // the page itself leaving MoveCrew opens outside; frames inside it (Stripe's card box) load in place
  wc.on('will-navigate', (e) => {
    if (rules.inside(e.url)) return;
    e.preventDefault();
    goOutside(e.url);
  });
  wc.on('will-redirect', (e) => {
    if (e.isMainFrame === false || rules.inside(e.url)) return;
    e.preventDefault();
  });
  wc.on('context-menu', (e, p) => contextMenu(wc, p));
  wc.on('before-input-event', (e, input) => keys(wc, e, input));
  win.on('app-command', (e, cmd) => {
    const h = wc.navigationHistory;
    if (cmd === 'browser-backward' && h && h.canGoBack()) h.goBack();
    if (cmd === 'browser-forward' && h && h.canGoForward()) h.goForward();
  });
  win.on('focus', () => win.flashFrame(false));
  win.on('close', saveState);
  win.on('closed', () => { win = null; });
  wc.on('render-process-gone', (e, d) => {
    log('page stopped: ' + (d && d.reason));
    if (!SMOKE && win) setTimeout(() => { if (win) win.loadURL(rules.START); }, 1000);
  });
  if (SMOKE) smoke(wc);
  win.loadURL(rules.START);
}

/* ---------- --smoke: how GitHub checks a build on a Windows computer ---------- */
function smoke(wc) {
  const t0 = Date.now(), out = { ok: false, version: app.getVersion(), electron: process.versions.electron, ua: '' };
  let done = false;
  const finish = (why) => {
    if (done) return;
    done = true;
    out.secs = Math.round((Date.now() - t0) / 100) / 10;
    if (why) out.why = why;
    fs.writeFileSync(path.join(SMOKE, 'result.json'), JSON.stringify(out, null, 2));
    log('smoke: ' + JSON.stringify(out));
    setTimeout(() => app.exit(out.ok ? 0 : 3), 300);
  };
  const shot = (name) => wc.capturePage().then((img) => fs.writeFileSync(path.join(SMOKE, name), img.toPNG()));
  setTimeout(() => finish('MoveCrew did not finish loading in 150 seconds'), 150000);
  wc.on('console-message', (e) => {
    const m = String((e && e.message) || '');
    if (e && e.level === 'error') log('page error: ' + m.slice(0, 300));
    const r = /^TALLY_READY nodes=(\d+)/.exec(m);
    if (!r || out.nodes) return;
    out.nodes = Number(r[1]);
    out.readySecs = Math.round((Date.now() - t0) / 100) / 10;
    wc.executeJavaScript(SMOKE_CHECKS, true).then((c) => {
      Object.assign(out, c);
      return shot('screenshot.png').then(() => wc.executeJavaScript(SMOKE_STRIPE, true)).then((s) => {
        out.stripe = s;
        return shot('stripe.png');
      });
    }).then(() => {
      out.ok = out.nodes > 200 && out.title === 'MoveCrew' && out.signIn && out.supabase === 200 && !!out.desktop && out.handOff;
      finish(out.ok ? '' : 'a check did not pass');
    }, (err) => finish('checks failed: ' + err.message));
  });
}
// what a new office computer should see: the sign-in screen, Supabase answering from the app's
// address, and the page knowing it is the Windows app
const SMOKE_CHECKS = `(async () => {
  const c = { title: document.title, signIn: !!document.getElementById('lgEmail'), ua: navigator.userAgent,
    origin: location.origin, desktop: !!(window.tallyDesktop && window.tallyDesktop.platform === 'windows'),
    handOff: typeof window.tallyDesktop?.open === 'function' && /MoveCrewWindows\\//.test(navigator.userAgent) };
  try {
    const S = window.TALLY_SUPABASE || {};
    const r = await fetch(String(S.url).replace(/\\/+$/, '') + '/auth/v1/settings', { headers: { apikey: S.anonKey } });
    c.supabase = r.status;
  } catch (e) { c.supabase = 'failed: ' + e.message; }
  return c;
})()`;
// Stripe's card box, as the office's Take payment uses it, with Stripe's public sample test key
const SMOKE_STRIPE = `new Promise((res) => {
  const t = setTimeout(() => res('timeout'), 45000);
  const go = () => {
    try {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;z-index:99999;left:50%;top:80px;transform:translateX(-50%);width:420px;max-width:90vw;background:#fff;padding:16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25)';
      document.body.appendChild(box);
      // the same options as the app's own card box (cardOpts in web/index.html)
      const opts = { mode: 'payment', currency: 'usd', amount: 5000, allowedPaymentMethodTypes: ['card'], paymentMethodOptions: { card: { setup_future_usage: 'none' } } };
      const el = window.Stripe('pk_test_TYooMQauvdEDq54NiTphI7jx').elements(opts).create('payment', { layout: 'tabs' });
      el.on('ready', () => { clearTimeout(t); setTimeout(() => res('ready'), 1500); });
      el.on('loaderror', (ev) => { clearTimeout(t); res('loaderror: ' + ((ev && ev.error && ev.error.message) || '?')); });
      el.mount(box);
    } catch (e) { clearTimeout(t); res('error: ' + e.message); }
  };
  if (window.Stripe) return go();
  const s = document.createElement('script');
  s.src = 'https://js.stripe.com/endive/stripe.js';   // STRIPE_JS in web/index.html
  s.onload = go;
  s.onerror = () => { clearTimeout(t); res('stripe.js did not load'); };
  document.head.appendChild(s);
})`;

/* ---------- start ---------- */
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, '') + ' MoveCrewWindows/' + app.getVersion();
    protocol.handle(rules.SCHEME, serve);

    const ses = require('electron').session.defaultSession;
    const ALLOW = new Set(['notifications', 'geolocation', 'clipboard-sanitized-write', 'fullscreen']);
    ses.setPermissionRequestHandler((wc, perm, cb, d) => {
      if (perm === 'openExternal') { cb(false); goOutside(d && d.externalURL); return; }
      cb(ALLOW.has(perm) && rules.inside((d && (d.requestingUrl || d.requestingOrigin)) || ''));
    });
    ses.setPermissionCheckHandler((wc, perm, origin) => ALLOW.has(perm) && rules.inside(origin || ''));

    ipcMain.on('movecrew:open', (e, url) => { if (fromApp(e)) goOutside(url); });
    ipcMain.on('movecrew:attention', (e, info) => { if (fromApp(e)) attention(info); });
    ipcMain.handle('movecrew:pending', (e) => (fromApp(e) ? pendingUpdate : ''));
    // Restart now, from the bar MoveCrew shows when a new version has downloaded: installs it quietly and opens again
    ipcMain.handle('movecrew:restart', (e) => {
      if (!fromApp(e) || !pendingUpdate || !updater) return false;
      saveState();
      setImmediate(() => updater.quitAndInstall(true, true));
      return true;
    });

    log('MoveCrew ' + app.getVersion() + (SMOKE ? ' (check run)' : '') + ' starting');
    createWindow();
    updates();
  });
  app.on('window-all-closed', () => app.quit());
}
