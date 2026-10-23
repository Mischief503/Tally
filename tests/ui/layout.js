// What only a real browser can see (Chromium, like a phone): on each role's screens, nothing runs off the
// side of the screen (on a 390, 360 and 320 wide phone, a tablet, and a phone turned sideways), nothing a
// person taps sits under the bottom bar, the round New quote button or the
// preview bar, every button is big enough for a thumb (36 px or more each way), and the text is readable:
// the status colours and greys on every look reach 4.5:1, and axe-core's colour-contrast rule passes on
// the busiest screens in six looks. (Richie, Oct 15: "Is everything well organized in the ui double and
// triple check everything".)
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('playwright-core')); }
const fs = require('fs'), path = require('path');
let AXE = ''; try { AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { /* the contrast rule needs axe-core (npm install in tests/ui) */ }
const FILE = 'file://' + path.resolve(__dirname + '/../../build/tally-artifact.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

/* ---------- getting to each screen ---------- */
const tap = async (p, sel, w) => { await p.click(sel); await sleep(w || 120); };
const pv = async (p, role, staff) => { await tap(p, '[data-act="more:open"]'); await tap(p, '[data-act="more:preview"]'); await tap(p, `#more [data-act="pv:set"][data-role="${role}"][data-staff="${staff}"]`, 250); };
const more = async (p, tab, sec) => {
  await tap(p, '[data-act="more:open"]');
  await tap(p, `#more [data-act="more:go"][data-tab="${tab}"]${tab === 'settings' ? ':not([data-sec])' : ''}`, 200);
  if (sec) await tap(p, `[data-act="set:open"][data-sec="${sec}"]`, 200);
};
const tabTo = async (p, tab) => { const b = await p.$(`#tabs [data-act="tab"][data-tab="${tab}"]`); if (b) { await b.click(); await sleep(150); } else await more(p, tab); };
const jobId = (p, name) => p.evaluate((n) => window.__tally.state().jobs.find((j) => j.d.name === n).id, name);
const openJob = async (p, name) => {
  const id = await jobId(p, name); await tabTo(p, 'jobs');
  await p.click(`[data-act="job:open"][data-id="${id}"]`); await sleep(250);
  await p.evaluate(() => document.querySelectorAll('#sheet details').forEach((d) => { d.open = true; })); await sleep(80);
};
const clockIn = (p, names) => p.evaluate((ns) => { const st = window.__tally.state(); ns.forEach((n) => { if (!st.shifts.some((x) => x.who === n && !x.outAt)) st.shifts.push({ id: 'lt' + n, who: n, inAt: Date.now() - 36e5, outAt: 0, activity: 'Job day', note: '', late: 0, breaks: [] }); }); window.__tally.render(); }, names);
const startPriya = (p) => p.evaluate(() => {
  const st = window.__tally.state(), j = st.jobs.find((x) => x.d.name === 'Priya Nair'), t = Date.now();
  ['Marcus', 'Dee', 'Luis'].forEach((n) => { if (!st.shifts.some((x) => x.who === n && !x.outAt)) st.shifts.push({ id: 'lt' + n, who: n, inAt: t - 2 * 36e5, outAt: 0, activity: 'Job day', note: '', late: 0, breaks: [] }); });
  j.status = 'active'; j.startedAt = t - 90 * 6e4; j.phases = { loadStart: t - 80 * 6e4, loadEnd: t - 30 * 6e4 };
  j.crewOn = { Marcus: [{ in: j.startedAt, out: 0 }], Dee: [{ in: j.startedAt, out: 0 }], Luis: [{ in: j.startedAt, out: 0 }] };
  window.__tally.render();
});
// Nadia Farouk's job running for 5 hours, Marcus's movers panel open with Dee picked; or (billed) two more 2 hours in, finished
const moversTo = (p, billed) => p.evaluate((b) => {
  const T = window.__tally, st = T.state(), N = st.jobs.find((j) => j.d.name === 'Nadia Farouk'), H = 36e5, now = Date.now(), t0 = now - 5 * H, d = new Date();
  N.d.moveDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  Object.assign(N, { status: 'active', startedAt: t0, phases: { loadStart: t0 }, crewOn: { Marcus: [{ in: t0, out: 0 }], Kim: [{ in: t0, out: 0 }] } });
  if (b) { T.mvAdd(N, 'Dee', 1, t0 + 2 * H, 'Marcus'); T.mvAdd(N, 'Luis', 1, t0 + 2 * H, 'Marcus'); Object.assign(N, { status: 'done', finishedAt: now, actualHours: 5 }); N.phases.unloadEnd = now; T.applyClock(N); }
  T.render(); return N.id;
}, !!billed).then(async (id) => { await pv(p, 'lead', 'Marcus'); if (!billed) { await tap(p, `#view [data-job="${id}"] .cc-movers [data-act="mv:open"]`, 250); await tap(p, '#mover [data-act="mv:pick"][data-n="Dee"]', 150); } });
// Marcus makes a new quote on Priya Nair's job, as far as the given step
const rqTo = async (p, step) => {
  await pv(p, 'lead', 'Marcus'); const id = await jobId(p, 'Priya Nair');
  await tap(p, `#view [data-job="${id}"] [data-act="rq:open"]`, 250);
  await tap(p, '#rq [data-act="rq:inc"][data-id="sofa3"]', 60); await tap(p, '#rq [data-act="rq:inc"][data-id="piano"]', 60);
  if (step !== 'items') await tap(p, '#rq [data-act="rq:step"][data-s="review"]', 200);
  if (step === 'sign') await tap(p, '#rq [data-act="rq:step"][data-s="sign"]', 200);
};
const fillDraft = (p, step) => p.evaluate(() => { Object.assign(window.__tally.state().draft, { name: 'Test Person', phone: '512-555-0100', from: '1 Main St, Austin', to: '9 Oak Ave, Round Rock', miles: '18', items: { boxm: 30, sofa3: 1, bedq: 1 } }); window.__tally.render(); }).then(() => tap(p, `[data-act="q:step"][data-s="${step}"]`, 200));

const SCREENS = {
  'owner Today': async () => {},
  'owner Jobs': async (p) => { await tabTo(p, 'jobs'); },
  'owner Board': async (p) => { await tabTo(p, 'dispatch'); },
  'owner Chat': async (p) => { await tabTo(p, 'chat'); },
  'owner Reports': async (p) => { await tabTo(p, 'reports'); },
  'owner Setup': async (p) => { await more(p, 'settings'); },
  'owner Setup › Fleet': async (p) => { await more(p, 'settings', 'fleet'); },
  'owner Setup › Custom job fields': async (p) => { await more(p, 'settings', 'fields'); },
  'owner Setup › Inventory catalog': async (p) => { await more(p, 'settings', 'catalog'); await p.evaluate(() => document.querySelectorAll('#view details').forEach((d) => { d.open = true; })); },
  'owner Setup › Rate card': async (p) => { await more(p, 'settings', 'rates'); },
  'owner Setup › Materials': async (p) => { await more(p, 'settings', 'mats'); },
  'owner Setup › Options': async (p) => { await more(p, 'settings', 'options'); },
  'owner new quote, step 1': async (p) => { await tap(p, '#fab', 200); },
  'owner new quote, price': async (p) => { await tap(p, '#fab', 200); await fillDraft(p, 3); },
  'owner job sheet, booked': async (p) => { await openJob(p, 'Priya Nair'); },
  'owner job sheet, finished': async (p) => { await openJob(p, 'Marcus Tull'); },
  'owner job sheet, lead': async (p) => { await openJob(p, 'Sam Kowalski'); },
  'dispatch Today': async (p) => { await pv(p, 'dispatch', 'Dispatch'); },
  'dispatch Jobs': async (p) => { await pv(p, 'dispatch', 'Dispatch'); await tabTo(p, 'jobs'); },
  // the crew's app (Richie's drawing, Oct 21): Jobs (Today | History), Chat and More
  'crew lead Jobs': async (p) => { await pv(p, 'lead', 'Marcus'); },
  'crew lead Jobs, all clocked in': async (p) => { await pv(p, 'lead', 'Marcus'); await clockIn(p, ['Marcus', 'Dee', 'Luis']); await tabTo(p, 'crew'); },
  'crew lead Jobs, job running': async (p) => { await startPriya(p); await pv(p, 'lead', 'Marcus'); await tabTo(p, 'crew'); },
  'crew lead History, a job opened': async (p) => { await pv(p, 'lead', 'Marcus'); await tap(p, '[data-act="cr:view"][data-v="history"]', 200); await tap(p, '#view details.hcard summary', 200); },
  // a new quote on site (Richie, Oct 21): room by room, check it, the customer signs; the office approves
  'crew lead new quote, rooms': async (p) => { await rqTo(p, 'items'); },
  'crew lead new quote, check it': async (p) => { await rqTo(p, 'review'); },
  'crew lead new quote, signature': async (p) => { await rqTo(p, 'sign'); },
  'owner job sheet, new quote to approve': async (p) => { await p.evaluate(() => { window.__tally.state().settings.opt.rqOffice = true; }); await rqTo(p, 'review'); await tap(p, '#rq [data-act="rq:send"]', 200); await tap(p, '#rq [data-act="rq:exit"]', 200); await tap(p, '[data-act="pv:end"]', 250); await openJob(p, 'Priya Nair'); },
  // a mover joining on site (Richie, Oct 21): the panel, and the job sheet with the bill line
  'crew lead movers panel': async (p) => { await moversTo(p); },
  'owner job sheet, crew changes': async (p) => { await moversTo(p, true); await tap(p, '[data-act="pv:end"]', 250); await openJob(p, 'Nadia Farouk'); await p.evaluate(() => { const d = document.querySelector('#sheet details.acc[data-k="sh:Quote"]'); if (d) d.open = true; }); },
  // the lead's bill of that job: the quote, then the hours by the movers on the bill (Oct 21)
  'crew lead bill, crew changes': async (p) => { await moversTo(p, true); await p.evaluate(() => { document.querySelectorAll('#view details.hcard').forEach((d) => { d.open = true; }); }); },
  // the call center (Oct 22): the Companies map (a pickup and a date, one rate card opened), the schedule (a month,
  // and the day's jobs, one opened), the open quotes, a new quote's date
  'call center Companies': async (p) => { await pv(p, 'callcenter', ''); await p.fill('#dkAddr', '77 Ridge Rd, Round Rock'); await p.dispatchEvent('#dkAddr', 'change'); await sleep(120);
    await p.fill('#dkDate', await p.evaluate(() => { const d = new Date(Date.now() + 2 * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })); await p.dispatchEvent('#dkDate', 'change'); await sleep(120);
    await p.evaluate(() => { const d = document.querySelector('#view details.deskcard'); if (d) d.open = true; }); },
  'call center Schedule': async (p) => { await pv(p, 'callcenter', ''); await tabTo(p, 'sched'); await p.evaluate(() => { const d = document.querySelector('#view details.schedcard'); if (d) d.open = true; }); },
  'call center Quotes': async (p) => { await pv(p, 'callcenter', ''); await tabTo(p, 'quotes'); },
  'call center new quote, the move date': async (p) => { await pv(p, 'callcenter', ''); await tap(p, '#fab', 250); await p.fill('[data-d="moveDate"]', await p.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })); await sleep(150); },
  'crew Jobs': async (p) => { await pv(p, 'crew', 'Dee'); },
  'crew History': async (p) => { await pv(p, 'crew', 'Dee'); await tap(p, '[data-act="cr:view"][data-v="history"]', 200); },
  'crew More': async (p) => { await pv(p, 'crew', 'Dee'); await tap(p, '[data-act="more:open"]', 250); },
  'crew Chat': async (p) => { await pv(p, 'crew', 'Dee'); await tabTo(p, 'chat'); },
};
// the smallest phones (320 wide), a tablet held upright, and a phone turned sideways
const SMALL = ['call center Companies', 'call center Schedule', 'call center Quotes', 'crew lead bill, crew changes', 'owner Today', 'owner Jobs', 'owner Reports', 'owner Setup › Inventory catalog', 'owner new quote, price', 'owner job sheet, booked', 'owner job sheet, finished', 'crew lead Jobs, all clocked in', 'crew lead Jobs, job running', 'crew Jobs', 'crew lead new quote, rooms', 'crew lead new quote, check it', 'crew lead new quote, signature', 'owner job sheet, new quote to approve', 'crew lead movers panel', 'owner job sheet, crew changes'];
const TABLET = ['owner Today', 'owner Reports', 'owner job sheet, booked', 'crew lead Jobs, job running'];
const SIDEWAYS = ['call center Companies', 'call center Schedule', 'owner Today', 'owner job sheet, booked', 'owner new quote, price', 'crew lead Jobs, all clocked in', 'crew Jobs', 'crew lead new quote, rooms'];
const NARROW = ['owner Today', 'owner Jobs', 'owner Setup › Fleet', 'owner Setup › Custom job fields', 'owner Setup › Inventory catalog', 'owner Setup › Rate card', 'owner new quote, price', 'owner job sheet, booked', 'crew lead Jobs, all clocked in', 'crew Jobs'];

/* ---------- the checks, in the page (shared with layout-hosted.js) ---------- */
const { CHECK } = require('./layoutcheck');

(async () => {
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = async (w, h, scheme) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme || 'light' });
    const p = await ctx.newPage(); p.errs = [];
    p.on('pageerror', (e) => p.errs.push(String(e)));
    await p.addInitScript(() => { window.__TALLY_TEST = true; document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*{scroll-behavior:auto!important}'; document.head.appendChild(s); }); });
    await p.goto(FILE); await sleep(350);
    return p;
  };
  const errors = [];
  for (const [w, h, list] of [[390, 844, Object.keys(SCREENS)], [360, 740, NARROW], [320, 568, SMALL], [768, 1024, TABLET], [844, 390, SIDEWAYS]]) {
    for (const n of list) {
      const p = await page(w, h);
      try {
        await SCREENS[n](p); await sleep(150);
        const r = await p.evaluate(CHECK);
        ok(r.overflow <= 0 && !r.wide.length, `${w}×${h}, ${n}: nothing runs off the side` + (r.overflow > 0 || r.wide.length ? ` (page ${r.overflow}px wider; ${r.wide.slice(0, 3).join(', ')})` : ''));
        ok(!r.covered.length, `${w}×${h}, ${n}: nothing to tap is hidden under the bars` + (r.covered.length ? ` (${r.covered.slice(0, 3).join('; ')})` : ''));
        if (w === 390) ok(!r.small.length, `${n}: buttons are at least 36 px` + (r.small.length ? ` (${r.small.slice(0, 4).join('; ')})` : ''));
      } catch (e) { ok(false, `${w}×${h}, ${n}: ${String(e).slice(0, 200)}`); }
      errors.push(...p.errs); await p.context().close();
    }
  }

  // every look, light and dark: the status colours and the grey text reach 4.5:1 on the page and the cards
  {
    const p = await page(390, 844);
    const bad = await p.evaluate(() => {
      const T = window.__tally, out = [];
      T.themes.forEach((t) => ['light', 'dark'].forEach((m) => {
        if (m === 'light' && !t.light) return;
        const v = T.varsFor(t, m);
        ['ok', 'bad', 'info', 'warn', 'muted', 'text'].forEach((k) => [['card', v.card], ['page', v.bg]].forEach(([bn, bg]) => { const c = T.contrastOf(v[k], bg); if (c < 4.5) out.push(t.name + ' ' + m + ': ' + k + ' on ' + bn + ' ' + c.toFixed(2)); }));
        const pb = T.contrastOf(v.accInk, v.acc); if (pb < 4.5) out.push(t.name + ' ' + m + ': button text ' + pb.toFixed(2));
        const hd = T.contrastOf(v.ht, v.header); if (hd < 4.5) out.push(t.name + ' ' + m + ': header text ' + hd.toFixed(2));
      }));
      return out;
    });
    ok(!bad.length, 'every look, light and dark: status colours, grey text, button text and header text reach 4.5:1' + (bad.length ? ' (' + bad.slice(0, 6).join('; ') + ')' : ''));
    errors.push(...p.errs); await p.context().close();
  }

  // the rendered text, by axe-core's colour-contrast rule, on the busiest screens in six looks
  if (!AXE) ok(false, 'axe-core is installed for the contrast check (npm install in tests/ui)');
  else {
    const looks = [['movingday', 'light'], ['movingday', 'dark'], ['contrast', 'light'], ['hivis', 'dark'], ['cardboard', 'light'], ['terminal', 'dark']];
    const shots = ['owner Today', 'owner job sheet, finished', 'owner new quote, price', 'owner Setup › Options', 'crew lead Jobs, job running', 'crew Jobs', 'crew lead History, a job opened', 'crew lead new quote, rooms', 'crew lead new quote, check it', 'owner job sheet, new quote to approve', 'crew lead movers panel', 'owner job sheet, crew changes'];
    for (const [t, m] of looks) {
      const found = [];
      for (const n of shots) {
        const p = await page(390, 844, m);
        try {
          await tap(p, '[data-act="theme:open"]'); await tap(p, `[data-act="theme:set"][data-t="${t}"]`); await tap(p, `[data-act="theme:mode"][data-m="${m}"]`); await tap(p, '#pick .panel [data-act="theme:close"]');
          await SCREENS[n](p); await sleep(150);
          await p.addScriptTag({ content: AXE });
          const v = await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'] })).violations.flatMap((x) => x.nodes.map((nd) => nd.target.join(' ') + (nd.any[0] && nd.any[0].data ? ' ' + nd.any[0].data.contrastRatio + ':1' : ''))));
          v.forEach((x) => found.push(n + ': ' + x));
        } catch (e) { found.push(n + ': ' + String(e).slice(0, 120)); }
        errors.push(...p.errs); await p.context().close();
      }
      ok(!found.length, `${t} ${m}: the text on Today, a finished job's sheet, a quote's price, Options, a running job, the crew's Jobs and an opened History job passes axe's colour-contrast rule` + (found.length ? ' (' + found.slice(0, 4).join('; ') + ')' : ''));
    }
  }
  // the hosted app's sign-in screen, on a phone set to light and to dark (it was a white box with white
  // writing in dark), with no chat bubble under the button
  {
    const hosted = fs.readFileSync(__dirname + '/../../build/tally-supabase.html', 'utf8').replace('PASTE_YOUR_PROJECT_URL', 'https://proj.supabase.co').replace('PASTE_YOUR_ANON_PUBLIC_KEY', 'anon');
    const hf = require('os').tmpdir() + '/tally-layout-hosted.html'; fs.writeFileSync(hf, hosted);
    for (const scheme of ['light', 'dark']) {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      const p = await ctx.newPage();
      await p.route(/^https?:/, (r) => r.abort());
      await p.addInitScript(() => {
        const q = () => { const api = { select: () => api, eq: () => api, filter: () => api, order: () => api, limit: () => api, maybeSingle: () => api, upsert: () => api, insert: () => api, update: () => api, delete: () => api, then: (res) => Promise.resolve({ data: [], error: null }).then(res) }; return api; };
        const client = { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, from: q, rpc: () => Promise.resolve({ data: [], error: null }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} };
        Object.defineProperty(window, 'supabase', { configurable: true, get: () => ({ createClient: () => client }), set() {} });
      });
      await p.goto('file://' + hf); await sleep(500);
      const r = await p.evaluate(() => {
        const lum = (c) => { const a = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
        const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number), cr = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const box = document.querySelector('#login .box'); if (!box) return null;
        const bg = getComputedStyle(box).backgroundColor, m = document.querySelector('#login .msg');
        return { title: cr(getComputedStyle(box.querySelector('h1')).color, bg), label: cr(getComputedStyle(box.querySelector('label')).color, bg), bubble: m ? getComputedStyle(m).borderTopWidth : '0px' };
      });
      ok(r && r.title >= 4.5 && r.label >= 4.5 && r.bubble === '0px', `the sign-in screen reads on a phone set to ${scheme}` + (r ? ` (title ${r.title.toFixed(1)}:1, label ${r.label.toFixed(1)}:1)` : ' (it did not show)'));
      await ctx.close();
    }
  }
  ok(!errors.length, 'no page errors' + (errors.length ? ' (' + errors.slice(0, 3).join(' | ') + ')' : ''));
  await b.close();
  console.log(`\nlayout: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
