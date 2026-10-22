// The full UI check (Oct 15, for "double and triple check everything"): a walk through every screen of Tally,
// for every role (about 90 states), with checks on each: sideways overflow, text cut off, small tap targets,
// buttons covered by the fixed bars, duplicate ids, unnamed controls, page errors, and axe-core's WCAG 2.1 AA
// rules (contrast included). A screenshot of each screen, a screen-height at a time, for looking at by eye.
// Not part of run-all.sh (it takes about 10 minutes); tests/ui/layout.js runs the quick version every build.
// usage (from the repo root, after scripts/build.py):
//   node tests/ui/audit.js <outdir> <width> <height> <light|dark> [screen-name-prefixes,comma,separated] [noaxe]
//   env: THEME=<look id>:<light|dark> picks a look first; NOSHOTS=1 skips screenshots; NOCHECK=1 skips the layout
//   checks; AXRULES=color-contrast runs only that axe rule. Prints every distinct finding, with the screens.
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('playwright-core')); }
const fs = require('fs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const [OUT, W, Hh, SCHEME, ONLY, NOAXE] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5] || 'light', process.argv[6] || '', process.argv[7] === 'noaxe'];
const FILE = 'file://' + require('path').resolve(__dirname + '/../../build/tally-artifact.html');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tap(p, sel, w) { await p.click(sel); await sleep(w || 250); }
async function pv(p, role, staff) {
  await tap(p, '[data-act="more:open"]'); await tap(p, '[data-act="more:preview"]');
  await tap(p, `#more [data-act="pv:set"][data-role="${role}"][data-staff="${staff}"]`, 500);
}
async function more(p, tab, sec) {
  await tap(p, '[data-act="more:open"]');
  await tap(p, `#more [data-act="more:go"][data-tab="${tab}"]${tab === 'settings' ? ':not([data-sec])' : ''}`, 400);
  if (sec) await tap(p, `[data-act="set:open"][data-sec="${sec}"]`, 400);
}
async function tabTo(p, tab) {
  const b = await p.$(`#tabs [data-act="tab"][data-tab="${tab}"]`);
  if (b) { await b.click(); await sleep(350); } else await more(p, tab);
}
async function newQuote(p) { if (await p.isVisible('#fab')) await tap(p, '#fab', 400); else await tap(p, '#tabs [data-act="tab"][data-tab="quote"]', 400); }   // the side list on a wide screen
async function jobId(p, name) { return p.evaluate((n) => window.__tally.state().jobs.find((j) => j.d.name === n).id, name); }
async function openJob(p, name, from) {
  const id = await jobId(p, name);
  await tabTo(p, from || 'jobs');
  let b = await p.$(`[data-act="job:open"][data-id="${id}"]`);
  if (!b) { await more(p, 'history'); b = await p.$(`[data-act="job:open"][data-id="${id}"]`); }
  await b.click(); await sleep(500);
  return id;
}
async function openAllSecs(p, root) { await p.evaluate((r) => { document.querySelectorAll((r || '') + ' details').forEach((d) => { d.open = true; }); }, root); await sleep(200); }
async function clockIn(p, names) { await p.evaluate((ns) => { const st = window.__tally.state(); ns.forEach((n) => { if (!st.shifts.some((x) => x.who === n && !x.outAt)) st.shifts.push({ id: 'au' + n, who: n, inAt: Date.now() - 36e5, outAt: 0, activity: 'Job day', note: '', late: 0, breaks: [] }); }); window.__tally.render(); }, names); await sleep(200); }
async function startPriya(p) {
  await p.evaluate(() => {
    const st = window.__tally.state(), j = st.jobs.find((x) => x.d.name === 'Priya Nair'), t = Date.now();
    ['Marcus', 'Dee', 'Luis'].forEach((n) => { if (!st.shifts.some((x) => x.who === n && !x.outAt)) st.shifts.push({ id: 'au' + n, who: n, inAt: t - 2 * 36e5, outAt: 0, activity: 'Job day', note: '', late: 0, breaks: [] }); });
    j.status = 'active'; j.startedAt = t - 90 * 6e4; j.phases = { loadStart: t - 80 * 6e4, loadEnd: t - 30 * 6e4 };
    j.crewOn = { Marcus: [{ in: j.startedAt, out: 0 }], Dee: [{ in: j.startedAt, out: 0 }], Luis: [{ in: j.startedAt, out: 0 }] };
    window.__tally.render();
  }); await sleep(200);
}

const V = [];
const add = (name, go, opt) => V.push(Object.assign({ name, go }, opt || {}));
/* ---------- owner ---------- */
add('owner-today', async () => {});
add('owner-jobs', async (p) => { await tabTo(p, 'jobs'); });
add('owner-jobs-booked', async (p) => { await tabTo(p, 'jobs'); await tap(p, '[data-act="filter"][data-f="booked"]'); });
add('owner-board', async (p) => { await tabTo(p, 'dispatch'); });
add('owner-board-needs', async (p) => { await tabTo(p, 'dispatch'); await p.evaluate(() => { const st = window.__tally.state(); const j = st.jobs.find((x) => x.d.name === 'Ortega family'); j.status = 'booked'; window.__tally.render(); }); });
add('owner-chat', async (p) => { await tabTo(p, 'chat'); });
add('owner-chat-all', async (p) => { await tabTo(p, 'chat'); await tap(p, '[data-act="chat:open"][data-t="all"]', 400); });
add('owner-more', async (p) => { await tap(p, '[data-act="more:open"]', 400); });
add('owner-preview-list', async (p) => { await tap(p, '[data-act="more:open"]'); await tap(p, '[data-act="more:preview"]', 400); });
add('owner-setup', async (p) => { await more(p, 'settings'); });
add('owner-setup-search', async (p) => { await more(p, 'settings'); await p.fill('#setQ', 'clock'); await sleep(300); });
for (const sec of ['options', 'company', 'rates', 'mats', 'catalog', 'fleet', 'employees', 'access', 'roles', 'clock', 'forms', 'fields', 'sources', 'bid', 'pay', 'vault', 'comms', 'data'])
  add('owner-setup-' + sec, async (p) => { await more(p, 'settings', sec); });
add('owner-reports', async (p) => { await tabTo(p, 'reports'); });
add('owner-history', async (p) => { await more(p, 'history'); });
add('owner-field', async (p) => { await more(p, 'crew'); });
add('owner-quote-1', async (p) => { await newQuote(p); });
add('owner-quote-2', async (p) => { await newQuote(p); await p.evaluate(() => { const d = window.__tally.state().draft; Object.assign(d, { name: 'Test Person', phone: '512-555-0100', from: '1 Main St, Austin', to: '9 Oak Ave, Round Rock', miles: '18' }); window.__tally.render(); }); await tap(p, '[data-act="q:step"][data-s="2"]', 400); });
add('owner-quote-3', async (p) => { await newQuote(p); await p.evaluate(() => { const d = window.__tally.state().draft; Object.assign(d, { name: 'Test Person', phone: '512-555-0100', from: '1 Main St, Austin', to: '9 Oak Ave, Round Rock', miles: '18', items: { boxm: 30, sofa3: 1, bedq: 1 } }); window.__tally.render(); }); await tap(p, '[data-act="q:step"][data-s="3"]', 400); });
const sheetVisit = (label, name, prep) => add('owner-sheet-' + label, async (p) => { if (prep) await prep(p); await openJob(p, name); await openAllSecs(p, '#sheet'); }, { sheet: true });
sheetVisit('lead', 'Sam Kowalski');
sheetVisit('quoted', 'Ortega family');
sheetVisit('booked', 'Priya Nair');
sheetVisit('active', 'Priya Nair', startPriya);
sheetVisit('done', 'Marcus Tull');
sheetVisit('paid', 'Lena Wu');
sheetVisit('lost', 'Grace Pham');
add('owner-sheet-unsaved', async (p) => { await openJob(p, 'Priya Nair'); await openAllSecs(p, '#sheet'); await p.fill('#sheet textarea[data-j="notes"]', 'Gate code 4411'); await sleep(200); await tap(p, '#sheet .sheet-head [data-act="sheet:close"]', 400); }, { sheet: true });
add('owner-start', async (p) => { await openJob(p, 'Priya Nair'); await tap(p, '#sheet [data-act="sh:next"]', 500); });
add('owner-matpick', async (p) => { await openJob(p, 'Priya Nair'); await openAllSecs(p, '#sheet'); await tap(p, '#sheet [data-act="mp:open"]', 500); });
add('owner-call', async (p) => { await openJob(p, 'Priya Nair'); await openAllSecs(p, '#sheet'); await tap(p, '#sheet [data-act="call:cust"]', 500); });
add('owner-flow-sign', async (p) => { await openJob(p, 'Marcus Tull'); await openAllSecs(p, '#sheet'); await tap(p, '#sheet [data-act="flow:open"]', 600); });
add('owner-flow-pay', async (p) => { await p.evaluate(() => { const st = window.__tally.state(), j = st.jobs.find((x) => x.d.name === 'Marcus Tull'); (st.settings.forms || []).filter((f) => f.required).forEach((f) => { if (!j.signed.some((s) => s.formId === f.id)) j.signed.push({ id: 'au' + f.id, formId: f.id, title: f.title, name: 'Marcus Tull', sig: '', ts: Date.now(), by: 'Owner' }); }); }); await openJob(p, 'Marcus Tull'); await openAllSecs(p, '#sheet'); await tap(p, '#sheet [data-act="flow:open"]', 600); });
add('owner-theme', async (p) => { await tap(p, '[data-act="theme:open"]', 500); });
add('owner-emp-new', async (p) => { await more(p, 'settings', 'employees'); const b = await p.$('[data-act="emp:new"]'); if (b) { await b.click(); await sleep(500); } }, { overlay: '#emp' });
add('owner-today-onjob', async (p) => { await p.evaluate(() => { const st = window.__tally.state(), j = st.jobs.find((x) => x.d.name === 'Priya Nair'); j.assign.crew.push('Owner'); window.__tally.render(); }); });
/* ---------- dispatch ---------- */
add('dispatch-today', async (p) => { await pv(p, 'dispatch', 'Dispatch'); });
add('dispatch-jobs', async (p) => { await pv(p, 'dispatch', 'Dispatch'); await tabTo(p, 'jobs'); });
add('dispatch-board', async (p) => { await pv(p, 'dispatch', 'Dispatch'); await tabTo(p, 'dispatch'); });
add('dispatch-more', async (p) => { await pv(p, 'dispatch', 'Dispatch'); await tap(p, '[data-act="more:open"]', 400); });
add('dispatch-reports', async (p) => { await pv(p, 'dispatch', 'Dispatch'); await tabTo(p, 'reports'); });
add('dispatch-field', async (p) => { await pv(p, 'dispatch', 'Dispatch'); await more(p, 'crew'); });
add('dispatch-sheet', async (p) => { await pv(p, 'dispatch', 'Dispatch'); await openJob(p, 'Marcus Tull'); await openAllSecs(p, '#sheet'); }, { sheet: true });
/* ---------- crew lead ---------- */
// the crew's app (Richie's drawing, Oct 21): Jobs (Today | History), Chat, More
const hist = async (p) => { await tap(p, '[data-act="cr:view"][data-v="history"]', 400); };
const openHist = async (p) => { await hist(p); await p.evaluate(() => { document.querySelectorAll('#view details.hcard').forEach((d) => { d.open = true; }); }); await sleep(300); };
add('lead-jobs', async (p) => { await pv(p, 'lead', 'Marcus'); });
add('lead-jobs-on', async (p) => { await pv(p, 'lead', 'Marcus'); await tap(p, '.tclock [data-act="clk:in"]', 3000); });
add('lead-jobs-ready', async (p) => { await pv(p, 'lead', 'Marcus'); await clockIn(p, ['Marcus', 'Dee', 'Luis']); });
add('lead-jobs-active', async (p) => { await startPriya(p); await pv(p, 'lead', 'Marcus'); });
add('lead-jobs-costform', async (p) => { await pv(p, 'lead', 'Marcus'); await openAllSecs(p, '#view .crewcard'); });
// a job finished today (folded under Today) and the one still to bill, both opened: the quote and the bill
const finishPriya = (p) => p.evaluate(() => { const st = window.__tally.state(), j = st.jobs.find((x) => x.d.name === 'Priya Nair'), t = Date.now(); Object.assign(j, { status: 'done', startedAt: t - 372 * 6e4, finishedAt: t, actualHours: 6.2 }); window.__tally.render(); });
add('lead-jobs-done-open', async (p) => { await finishPriya(p); await pv(p, 'lead', 'Marcus'); await p.evaluate(() => { document.querySelectorAll('#view details.hcard').forEach((d) => { d.open = true; }); }); await sleep(300); });
add('lead-jobs-soon-open', async (p) => { await pv(p, 'lead', 'Marcus'); await p.evaluate(() => { document.querySelectorAll('#view details.hcard').forEach((d) => { d.open = true; }); }); await sleep(300); });
add('lead-start', async (p) => { await pv(p, 'lead', 'Marcus'); await clockIn(p, ['Marcus', 'Dee', 'Luis']); const id = await jobId(p, 'Priya Nair'); await tap(p, `[data-act="cr:start"][data-id="${id}"]`, 500); });
add('lead-flow', async (p) => { await pv(p, 'lead', 'Marcus'); const id = await jobId(p, 'Marcus Tull'); await tap(p, `#view [data-act="flow:open"][data-id="${id}"]`, 600); });
add('lead-matpick', async (p) => { await pv(p, 'lead', 'Marcus'); const id = await jobId(p, 'Priya Nair'); await tap(p, `[data-act="mp:open"][data-id="${id}"]`, 500); });
// a new quote on site (Oct 21): room by room, check it, the customer signs, sent to the office to approve
async function rqTo(p, step) {
  await pv(p, 'lead', 'Marcus'); const id = await jobId(p, 'Priya Nair');
  await tap(p, `#view [data-job="${id}"] [data-act="rq:open"]`, 500);
  await tap(p, '#rq [data-act="rq:inc"][data-id="sofa3"]', 100); await tap(p, '#rq [data-act="rq:inc"][data-id="piano"]', 100);
  if (step !== 'items') await tap(p, '#rq [data-act="rq:step"][data-s="review"]', 400);
  if (step === 'sign') await tap(p, '#rq [data-act="rq:step"][data-s="sign"]', 400);
}
// a mover joining on site (Oct 21): the panel, and the finished job's bill with the crew change
async function moversJob(p, billed) {
  return p.evaluate((b) => {
    const T = window.__tally, st = T.state(), N = st.jobs.find((j) => j.d.name === 'Nadia Farouk'), H = 36e5, now = Date.now(), t0 = now - 5 * H, d = new Date();
    N.d.moveDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    Object.assign(N, { status: 'active', startedAt: t0, phases: { loadStart: t0 }, crewOn: { Marcus: [{ in: t0, out: 0 }], Kim: [{ in: t0, out: 0 }] } });
    if (b) { T.mvAdd(N, 'Dee', 1, t0 + 2 * H, 'Marcus'); T.mvAdd(N, 'Luis', 1, t0 + 2 * H, 'Marcus'); Object.assign(N, { status: 'done', finishedAt: now, actualHours: 5 }); N.phases.unloadEnd = now; T.applyClock(N); }
    T.render(); return N.id;
  }, !!billed);
}
add('lead-movers', async (p) => { const id = await moversJob(p); await pv(p, 'lead', 'Marcus'); await tap(p, `#view [data-job="${id}"] .cc-movers [data-act="mv:open"]`, 500); await tap(p, '#mover [data-act="mv:pick"][data-n="Dee"]', 300); }, { overlay: '#mover' });
add('lead-movers-left', async (p) => { const id = await moversJob(p, true); await pv(p, 'lead', 'Marcus'); await p.evaluate((jid) => { const d = document.querySelector(`#view details.hcard[data-job="${jid}"]`); if (d) d.open = true; }, id); await sleep(300); await tap(p, `#view [data-job="${id}"] .cc-movers [data-act="mv:open"]`, 500); }, { overlay: '#mover' });
add('owner-movers-bill', async (p) => { const id = await moversJob(p, true); await tabTo(p, 'jobs'); await tap(p, `[data-act="job:open"][data-id="${id}"]`, 600); });
add('lead-rq-rooms', async (p) => { await rqTo(p, 'items'); }, { overlay: '#rq' });
add('lead-rq-review', async (p) => { await rqTo(p, 'review'); }, { overlay: '#rq' });
add('lead-rq-sign', async (p) => { await rqTo(p, 'sign'); }, { overlay: '#rq' });
add('lead-rq-leave', async (p) => { await rqTo(p, 'items'); await tap(p, '#rq [data-act="rq:exit"]', 300); }, { overlay: '#rq' });
add('owner-rq-approve', async (p) => { await p.evaluate(() => { window.__tally.state().settings.opt.rqOffice = true; }); await rqTo(p, 'review'); await tap(p, '#rq [data-act="rq:send"]', 400); await tap(p, '#rq [data-act="rq:exit"]', 400); await tap(p, '[data-act="pv:end"]', 500); const id = await jobId(p, 'Priya Nair'); await tabTo(p, 'jobs'); await tap(p, `[data-act="job:open"][data-id="${id}"]`, 600); });
add('lead-rq-approved', async (p) => { await p.evaluate(() => { window.__tally.state().settings.opt.rqOffice = true; }); await rqTo(p, 'review'); await tap(p, '#rq [data-act="rq:send"]', 400); await tap(p, '#rq [data-act="rq:exit"]', 400); await tap(p, '[data-act="pv:end"]', 500); const id = await jobId(p, 'Priya Nair'); await tabTo(p, 'jobs'); await tap(p, `[data-act="job:open"][data-id="${id}"]`, 600); await tap(p, '#sheet [data-act="rq:ok"]', 400); await tap(p, '#sheet [data-act="sheet:close"].btn', 400); await pv(p, 'lead', 'Marcus'); await p.evaluate(() => { const n = document.querySelector('#view .rqnote'); if (n) window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - 200); }); await sleep(300); });
add('lead-history', async (p) => { await pv(p, 'lead', 'Marcus'); await hist(p); });
add('lead-history-open', async (p) => { await pv(p, 'lead', 'Marcus'); await openHist(p); });
add('lead-chat', async (p) => { await pv(p, 'lead', 'Marcus'); await tabTo(p, 'chat'); });
add('lead-more', async (p) => { await pv(p, 'lead', 'Marcus'); await tap(p, '[data-act="more:open"]', 400); });
add('lead-sos', async (p) => { await pv(p, 'lead', 'Marcus'); await tap(p, '[data-act="more:open"]'); await tap(p, '#more [data-act="sos:open"]', 500); }, { overlay: '#sos' });

add('crew-jobs', async (p) => { await pv(p, 'crew', 'Dee'); });
add('crew-jobs-break', async (p) => { await pv(p, 'crew', 'Dee'); await tap(p, '.tclock [data-act="clk:in"]'); await tap(p, '.tclock [data-act="clk:break"]', 3000); });
add('crew-jobs-active', async (p) => { await startPriya(p); await pv(p, 'crew', 'Dee'); });
add('crew-history', async (p) => { await pv(p, 'crew', 'Dee'); await hist(p); });
add('crew-history-open', async (p) => { await pv(p, 'crew', 'Dee'); await openHist(p); });
add('crew-chat', async (p) => { await pv(p, 'crew', 'Dee'); await tabTo(p, 'chat'); });
add('crew-jobmsgs', async (p) => { await pv(p, 'crew', 'Dee'); await tabTo(p, 'chat'); await tap(p, '[data-act="chat:open"][data-t="jobs"]', 400); });
add('crew-more', async (p) => { await pv(p, 'crew', 'Dee'); await tap(p, '[data-act="more:open"]', 400); });
const empty = async (p) => { await p.evaluate(() => { const st = window.__tally.state(); st.jobs = []; st.shifts = []; window.__tally.render(); }); await sleep(200); };
add('empty-owner-today', async (p) => { await empty(p); });
add('empty-owner-jobs', async (p) => { await empty(p); await tabTo(p, 'jobs'); });
add('empty-owner-board', async (p) => { await empty(p); await tabTo(p, 'dispatch'); });
add('empty-owner-reports', async (p) => { await empty(p); await tabTo(p, 'reports'); });
add('empty-crew-jobs', async (p) => { await empty(p); await pv(p, 'crew', 'Dee'); });
add('empty-crew-history', async (p) => { await empty(p); await pv(p, 'crew', 'Dee'); await hist(p); });
add('crew-sos', async (p) => { await pv(p, 'crew', 'Dee'); await tap(p, '[data-act="more:open"]'); await tap(p, '#more [data-act="sos:open"]', 500); }, { overlay: '#sos' });

/* ---------- the checks, run in the page ---------- */
const CHECK = () => {
  const W = innerWidth, H = innerHeight;
  const folded = (el) => { for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) { if (!d.open) { const sm = d.querySelector(':scope > summary'); if (!(sm && sm.contains(el))) return true; } } return false; };
  const vis = (el) => { if (!el.getClientRects().length || folded(el)) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
  const desc = (el) => { const t = (el.getAttribute('aria-label') || el.textContent || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 50); return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.dataset && el.dataset.act ? '[' + el.dataset.act + ']' : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (t ? ' "' + t + '"' : ''); };
  // the overlay on top, if any (its contents are what can be used)
  const ovs = ['#sos', '#matpick', '#mover', '#start', '#call', '#pick', '#more', '#rq', '#emp', '#flow', '#sheet'].map((s) => document.querySelector(s)).filter((e) => e && !e.hidden && vis(e));
  const root = ovs[0] || document.body;
  const out = { overlay: ovs[0] ? '#' + ovs[0].id : '', pageOverflow: document.documentElement.scrollWidth - W, wide: [], small: [], covered: [], clipped: [], truncated: [], dupIds: [], unnamed: [], unlabeled: [] };
  const scroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(cs.overflowX)) return p; } return null; };
  root.querySelectorAll('*').forEach((el) => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // sticking out sideways, past the screen or past a container that clips
    const sc = scroller(el);
    if (!sc && (r.right > W + 1 || r.left < -1)) out.wide.push(desc(el) + ' ' + Math.round(r.left) + '→' + Math.round(r.right));
    // text cut off without an ellipsis
    const cs = getComputedStyle(el);
    if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(cs.overflowX)) {
      (cs.textOverflow === 'ellipsis' ? out.truncated : out.clipped).push(desc(el));
    }
  });
  // controls: size, cover, names
  const ctrls = Array.from(root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [data-act], [role=switch]')).filter((e) => vis(e) && !e.classList.contains('scrim'));
  const seen = new Set();
  ctrls.forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    const r = el.getBoundingClientRect();
    const inText = el.tagName === 'A' && el.closest('p, li, small, span.hint');
    const isChk = el.type === 'checkbox' || el.type === 'radio';
    if (!inText && !isChk && el.getAttribute('role') !== 'switch' && (r.height < 32 || r.width < 32)) out.small.push(desc(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() || (el.labels && el.labels.length && el.labels[0].textContent.trim()) || el.placeholder || (el.tagName === 'SELECT' && el.closest('label') && el.closest('label').textContent.trim());
    if (!name && el.tagName !== 'A') { if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) out.unlabeled.push(desc(el)); else out.unnamed.push(desc(el)); }
  });
  // covered: scroll each control into the middle of its scroller and see what is on top of it
  const top0 = scrollY;
  ctrls.forEach((el) => {
    if (el.closest('#tabs') || el.closest('.fab') || el.id === 'fab' || el.closest('#pvBar') || el.closest('#sosBar')) return;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H) return;
    const x = Math.min(W - 2, Math.max(1, r.left + r.width / 2)), y = Math.min(H - 2, Math.max(1, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit) return;
    if (hit === el || el.contains(hit) || hit.contains(el) || (el.labels && Array.from(el.labels).some((l) => l.contains(hit))) || (hit.closest('label') && hit.closest('label').contains(el))) return;
    if (el.tagName === 'INPUT' && el.closest('.sw') && hit.closest('.sw') === el.closest('.sw')) return;
    out.covered.push(desc(el) + ' under ' + desc(hit));
  });
  scrollTo(0, top0);
  const ids = {}; document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
  out.dupIds = Object.keys(ids).filter((k) => ids[k] > 1);
  ['wide', 'small', 'covered', 'clipped', 'truncated', 'unnamed', 'unlabeled'].forEach((k) => { out[k + 'N'] = out[k].length; out[k] = out[k].slice(0, 25); });
  return out;
};

(async () => {
  const b = await chromium.launch();
  const only = ONLY ? ONLY.split(',') : null;
  const report = [];
  for (const v of V) {
    if (only && !only.some((o) => v.name.indexOf(o) === 0)) continue;
    const ctx = await b.newContext({ viewport: { width: W, height: Hh }, deviceScaleFactor: 2, colorScheme: SCHEME });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|net::|fonts\.g/.test(m.text())) errs.push('console: ' + m.text()); });
    await p.addInitScript(() => { window.__TALLY_TEST = true; });
    await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '*{scroll-behavior:auto!important}'; document.head.appendChild(st); }); });
    let res = { name: v.name };
    try {
      await p.goto(FILE); await sleep(700);
      if (process.env.THEME) { const [tid, tm] = process.env.THEME.split(':'); await tap(p, '[data-act="theme:open"]', 200); await tap(p, `[data-act="theme:set"][data-t="${tid}"]`, 150); if (tm) await tap(p, `[data-act="theme:mode"][data-m="${tm}"]`, 150); await tap(p, '#pick .panel [data-act="theme:close"]', 200); }
      await v.go(p); await sleep(400);
      await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; });
      await p.mouse.move(1, 1);
      // what the user sees, a screen at a time: scroll the top overlay's scroller (or the page) and shoot each step
      const steps = process.env.NOSHOTS ? 0 : await p.evaluate(() => {
        const ovs = ['#sos', '#matpick', '#mover', '#start', '#call', '#pick', '#more', '#rq', '#emp', '#flow', '#sheet'].map((s) => document.querySelector(s)).filter((e) => e && !e.hidden && e.getClientRects().length);
        let sc = document.scrollingElement;
        if (ovs[0]) { let best = null; ovs[0].querySelectorAll('*').forEach((e) => { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4 && (!best || e.clientHeight > best.clientHeight)) best = e; }); if (best) { sc = best; best.setAttribute('data-au-sc', '1'); } else sc = null; }
        if (!sc) return 1;
        const step = Math.max(200, sc.clientHeight - 140);
        return Math.min(10, 1 + Math.ceil((sc.scrollHeight - sc.clientHeight) / step));
      });
      for (let i = 0; i < steps; i++) {
        await p.evaluate((i) => { const sc = document.querySelector('[data-au-sc]') || document.scrollingElement; const step = Math.max(200, sc.clientHeight - 140); sc.scrollTop = i * step; }, i);
        await sleep(120);
        await p.screenshot({ path: `${OUT}/${v.name}${i ? '~' + i : ''}.png` });
      }
      await p.evaluate(() => { const sc = document.querySelector('[data-au-sc]') || document.scrollingElement; sc.scrollTop = 0; });
      await sleep(100);
      if (!process.env.NOCHECK) res = Object.assign(res, await p.evaluate(CHECK));
      if (!NOAXE) {
        await p.addScriptTag({ content: AXE });
        const ax = await p.evaluate(async (AXRULES) => {
          const r = await window.axe.run(document, AXRULES ? { runOnly: { type: 'rule', values: AXRULES }, resultTypes: ['violations'] } : { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
          return r.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, t: x.nodes.slice(0, 6).map((nd) => nd.target.join(' ') + (nd.any && nd.any[0] && nd.any[0].data && nd.any[0].data.contrastRatio ? ' (' + nd.any[0].data.contrastRatio + ':1 ' + nd.any[0].data.fgColor + ' on ' + nd.any[0].data.bgColor + ')' : '')) }));
        }, process.env.AXRULES ? process.env.AXRULES.split(',') : null);
        res.axe = ax;
      }
    } catch (e) { res.fail = String(e).slice(0, 300); }
    res.errors = errs;
    report.push(res);
    process.stdout.write(v.name + (res.fail ? ' FAIL ' + res.fail : '') + '\n');
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await b.close();
  // every distinct finding once, with the screens it was seen on
  const agg = {}, put = (k, s, n) => { const a = agg[k] = agg[k] || {}; (a[s] = a[s] || []).push(n); };
  report.forEach((r) => {
    if (r.fail) put('could not open', r.fail.split('\n')[0], r.name);
    (r.errors || []).forEach((e) => put('errors', e, r.name));
    if (r.pageOverflow > 0) put('page wider than the screen', 'by ' + r.pageOverflow + 'px', r.name);
    ['wide', 'clipped', 'small', 'covered', 'dupIds', 'unnamed', 'unlabeled'].forEach((k) => (r[k] || []).forEach((x) => put(k, x, r.name)));
    (r.axe || []).forEach((v) => v.t.forEach((t) => put('axe', v.id + ' ' + t, r.name)));
  });
  Object.keys(agg).forEach((k) => { console.log('\n=== ' + k); Object.entries(agg[k]).forEach(([s, ns]) => console.log('  ' + s + '\n      on ' + ns.length + ': ' + ns.slice(0, 6).join(', ') + (ns.length > 6 ? ' …' : ''))); });
  console.log('\n' + report.length + ' screens' + (Object.keys(agg).length ? '' : ', nothing found'));
})().catch((e) => { console.error(e); process.exit(1); });
