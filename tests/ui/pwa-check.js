let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('playwright-core')); }
const { spawn } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: __dirname + '/../../build/site', stdio: 'ignore' });
  await sleep(800);
  let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const prof = require('fs').mkdtempSync(require('os').tmpdir() + '/tally-prof-');
  const ctx = await chromium.launchPersistentContext(prof, Object.assign({ viewport: { width: 390, height: 844 } }, process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}));
  const b = { close: () => ctx.close() };
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://localhost:8765/', { waitUntil: 'load' });
  await sleep(1500);
  const cdp = await ctx.newCDPSession(p);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  ok(inst.installabilityErrors.length === 0, 'Chrome sees it as an installable app' + (inst.installabilityErrors.length ? ': ' + JSON.stringify(inst.installabilityErrors) : ''));
  const man = await cdp.send('Page.getAppManifest');
  ok(man.errors.length === 0 && /"short_name": "Tally"/.test(man.data), 'manifest parses with no errors');
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  ok(sw, 'offline helper installed and active');
  await p.reload({ waitUntil: 'load' }); await sleep(800);
  ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'app is controlled by the helper after reload');
  ok(await p.evaluate(() => document.querySelector('#view').textContent.length > 50), 'app renders');
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' }).catch(() => {}); await sleep(800);
  ok(await p.evaluate(() => !!document.querySelector('#view') && document.querySelector('#view').textContent.length > 50), 'opens with no signal');
  await ctx.setOffline(false);
  // a new version shows up on the next open
  const fs = require('fs'); const f = __dirname + '/../../build/site/index.html'; const orig = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, orig.replace('<title>Tally: moving company software</title>', '<title>Tally NEW</title>'));
  await p.reload({ waitUntil: 'load' }); await sleep(500);
  ok((await p.title()) === 'Tally NEW', 'an updated site shows on the next open (no stale copy)');
  fs.writeFileSync(f, orig);
  ok(errs.length === 0, 'no page errors ' + errs.slice(0, 2).join(' | '));
  await b.close(); srv.kill();
  console.log(`\npwa: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
