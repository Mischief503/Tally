// MoveCrew for Windows, the real app (windows/main.js with Electron), driven by Playwright: it opens on
// its own address, hands links to the computer's apps (and nothing it shouldn't), serves only its own
// files, flashes for a truck-down alert, offers a restart for a new version, and zooms with Ctrl.
// The computer's side (the browser, the taskbar, Windows notices) is recorded instead of done.
// Needs windows/node_modules (npm ci there) and Playwright; on Linux, run it under xvfb-run.
const path = require('path');
const fs = require('fs');
const WIN = path.resolve(__dirname, '../../windows');
const OUT = path.join(WIN, 'check');

function playwright() {
  for (const n of ['playwright-core', 'playwright']) {
    try { return require(require.resolve(n, { paths: [WIN, path.resolve(__dirname, '../ui'), __dirname] })); } catch (e) { /* next */ }
  }
  throw new Error('Playwright is not installed (npm install --no-save playwright-core in windows/)');
}
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(path.join(WIN, 'app', 'index.html'))) throw new Error('windows/app is empty: run python3 scripts/prepare_windows.py first');
  fs.mkdirSync(OUT, { recursive: true });
  const { _electron } = playwright();
  const env = Object.assign({}, process.env, { NODE_OPTIONS: '' });
  const app = await _electron.launch({
    executablePath: require(require.resolve('electron', { paths: [WIN] })), cwd: WIN, env, timeout: 90000,
    args: [WIN].concat(process.platform === 'linux' ? ['--no-sandbox'] : []),
  });
  const page = await app.firstWindow();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.waitForSelector('#lgEmail', { timeout: 60000 });

  // the computer's side, recorded: the browser and other apps, the taskbar, Windows notices
  await app.evaluate(({ shell, BrowserWindow, Notification }) => {
    global.__opened = []; global.__flash = []; global.__notes = [];
    shell.openExternal = async (u) => { global.__opened.push(u); };
    const w = BrowserWindow.getAllWindows()[0];
    w.flashFrame = (f) => global.__flash.push(f);
    w.isFocused = () => false;
    Notification.isSupported = () => true;   // as on Windows (a Linux test computer may have no notice service)
    Notification.prototype.show = function () { global.__notes.push(this.title + ' | ' + this.body); };
  });
  const opened = () => app.evaluate(() => global.__opened.slice());

  /* ---------- the window and the page ---------- */
  ok(page.url() === 'app://movecrew/index.html', 'it opens MoveCrew from its own address (' + page.url() + ')');
  ok((await page.title()) === 'MoveCrew', 'the window is called MoveCrew');
  const info = await page.evaluate(() => ({ ua: navigator.userAgent, desk: !!window.tallyDesktop && window.tallyDesktop.platform, standalone: !!window.TALLY_STANDALONE,
    google: !!document.getElementById('lgGoogle'), secure: window.isSecureContext, node: typeof window.require, store: (() => { try { localStorage.setItem('t', '1'); return localStorage.getItem('t'); } catch (e) { return 'no: ' + e.message; } })() }));
  ok(/ MoveCrewWindows\/\d/.test(info.ua) && !/Electron\//.test(info.ua), 'the page’s user agent says it is the Windows app (' + info.ua.slice(-40) + ')');
  ok(info.desk === 'windows' && info.standalone, 'the page knows it is the installed Windows app');
  ok(!info.google, 'no Continue with Google button (Google refuses sign-in inside an app’s window)');
  ok(info.secure && info.store === '1', 'a secure address that keeps sign-in between starts (storage works)');
  ok(info.node === 'undefined', 'the page can’t reach the computer (no Node in the page)');
  await page.screenshot({ path: path.join(OUT, 'signin.png') });

  /* ---------- links leaving MoveCrew ---------- */
  await page.evaluate(() => {
    const add = (id, href, blank) => { const a = document.createElement('a'); a.id = id; a.href = href; a.textContent = id; if (blank) a.target = '_blank'; document.body.appendChild(a); };
    add('tTel', 'tel:5125550101'); add('tSms', 'sms:5125550101?&body=Hi%20Dana'); add('tTab', 'https://example.com/tab', true);
    add('tAway', 'https://example.com/away'); add('tFile', 'file:///C:/Windows/win.ini'); add('tSettings', 'ms-settings:privacy');
  });
  // clicked the way a person's click reaches them (the sign-in screen covers the rest of the page)
  for (const id of ['tTel', 'tSms', 'tTab', 'tAway', 'tFile', 'tSettings']) { await page.evaluate((i) => document.getElementById(i).click(), id); await sleep(300); }
  await page.evaluate(() => { window.__w = window.open('https://example.com/popup'); });
  await sleep(250);
  await page.evaluate(() => { location.href = 'https://connect.stripe.com/setup/s/abc'; });
  await sleep(400);
  await page.evaluate(() => { window.tallyDesktop.open('https://example.com/doc.pdf'); window.tallyDesktop.open('file:///C:/x.exe'); window.tallyDesktop.open('javascript:alert(1)'); });
  await sleep(400);
  const o = await opened();
  ok(o.filter((u) => u === 'tel:5125550101').length === 1, 'a Call button goes to the computer’s calling app, once');
  ok(o.includes('sms:5125550101?&body=Hi%20Dana'), 'a Text button goes to the computer’s texting app');
  ok(o.includes('https://example.com/tab') && o.includes('https://example.com/away') && o.includes('https://example.com/popup'), 'websites open in the browser, however the page opens them');
  ok(o.includes('https://connect.stripe.com/setup/s/abc'), 'Stripe’s page opens in the browser');
  ok(o.includes('https://example.com/doc.pdf'), 'a document the page hands over opens in the browser');
  ok(!o.some((u) => /^(file|ms-settings|javascript):/.test(u)), 'files on the computer, Windows settings and scripts never open: ' + JSON.stringify(o));
  ok(page.url() === 'app://movecrew/index.html' && !!(await page.$('#lgEmail')), 'and MoveCrew stays on its page');
  ok(await page.evaluate(() => window.__w === null), 'window.open gives the page nothing back (the browser has it)');

  /* ---------- only the app's own files ---------- */
  const got = await page.evaluate(async () => {
    const st = async (u) => { try { return (await fetch(u)).status; } catch (e) { return 'failed'; } };
    return { idx: await st('app://movecrew/index.html'), up: await st('app://movecrew/%2e%2e/main.js'), pkg: await st('app://movecrew/package.json'), other: await st('app://other/index.html'), post: (await fetch('app://movecrew/index.html', { method: 'POST', body: 'x' }).catch(() => ({ status: 'failed' }))).status };
  });
  ok(got.idx === 200, 'the app’s own page loads');
  ok(got.up === 404 && got.pkg === 404 && got.other === 404, 'nothing outside the packed app: ' + JSON.stringify(got));
  ok(got.post === 405, 'and nothing is sent to it');

  /* ---------- a truck-down alert ---------- */
  await page.evaluate(() => window.tallyDesktop.attention({ title: 'Truck down: Box 1 (26 ft)', body: 'Marcus: Flat tire, rear left' }));
  await sleep(300);
  let fx = await app.evaluate(() => ({ flash: global.__flash.slice(), notes: global.__notes.slice() }));
  ok(fx.flash[0] === true, 'a truck-down alert flashes MoveCrew on the taskbar');
  ok(fx.notes[0] === 'Truck down: Box 1 (26 ft) | Marcus: Flat tire, rear left', 'and shows a Windows notice: ' + fx.notes[0]);
  await page.evaluate(() => window.tallyDesktop.attention(null));
  await sleep(200);
  fx = await app.evaluate(() => ({ flash: global.__flash.slice() }));
  ok(fx.flash[fx.flash.length - 1] === false, 'answered, the flashing stops');

  /* ---------- a new version ---------- */
  ok(await page.evaluate(() => document.getElementById('updBar').hidden), 'no update bar until a new version has downloaded');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('movecrew:update', '1.0.99'));
  await sleep(300);
  const bar = await page.evaluate(() => { const b = document.getElementById('updBar'); return { hidden: b.hidden, text: b.textContent }; });
  ok(!bar.hidden && /A new version of MoveCrew is ready/.test(bar.text), 'a downloaded version shows the bar: ' + bar.text.slice(0, 60));
  await page.screenshot({ path: path.join(OUT, 'update.png') });
  const tap = (sel) => page.evaluate((q) => document.querySelector(q).click(), sel);
  await tap('#updBar [data-act="app:restart"]');
  await sleep(400);
  ok(/goes in the next time MoveCrew is closed/.test(await page.evaluate(() => document.getElementById('toast').textContent)), 'Restart now with nothing installed yet says it goes in at the next close');
  await tap('#updBar [data-act="app:later"]');
  ok(await page.evaluate(() => document.getElementById('updBar').hidden), 'Later hides it');

  /* ---------- keys ---------- */
  // pressed on the keyboard (Electron's own input, which goes through the app's key handling as a person's does)
  const press = (keyCode) => app.evaluate(({ BrowserWindow }, k) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.focus(); wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: ['control'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: ['control'] }); }, keyCode);
  const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
  const zb = await zoom();   // where this computer left it last time
  await press('=');
  await sleep(200);
  const z1 = await zoom();
  await press('0');
  await sleep(200);
  const z0 = await zoom();
  ok(z1 === Math.min(4, zb + 0.5) && z0 === 0, 'Ctrl + makes it bigger and Ctrl 0 puts it back (' + zb + ' → ' + z1 + ' → ' + z0 + ')');
  const perms = await page.evaluate(() => Notification.permission);
  ok(perms === 'granted', 'Windows notices are allowed for MoveCrew’s page (' + perms + ')');

  ok(errs.length === 0, 'no page errors ' + errs.slice(0, 2).join(' | '));
  await app.close();
  console.log(`\nwindows app: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
