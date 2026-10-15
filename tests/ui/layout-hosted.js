// The hosted app's own screens in a real browser (Chromium, like a phone): Membership, Payments, App access,
// Employees and one employee's file, Texts and calls, the More menu, Tally admin, a job sheet with card
// payments on, a crew lead's Today and My profile, and the company picker. On each one nothing runs off the
// side, nothing to tap sits under the bars, every button is 36 px or more, and axe-core's colour-contrast
// rule passes in light and in dark. The hosted build runs against the tests' stand-in Supabase (lib.js) and
// a stand-in for the Edge Function's replies, so nothing leaves the machine.
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('playwright-core')); }
const fs = require('fs'), path = require('path'), os = require('os');
const { CHECK } = require('./layoutcheck');
let AXE = ''; try { AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { /* the contrast rule needs axe-core (npm install in tests/ui) */ }
const lib = fs.readFileSync(__dirname + '/lib.js', 'utf8');
const SB = lib.slice(lib.indexOf('function deepFreeze'), lib.indexOf('async function load('));
const HF = path.join(os.tmpdir(), 'tally-layout-hosted-app.html');
fs.writeFileSync(HF, fs.readFileSync(__dirname + '/../../build/tally-supabase.html', 'utf8').replace('PASTE_YOUR_PROJECT_URL', 'https://proj.supabase.co').replace('PASTE_YOUR_ANON_PUBLIC_KEY', 'anon'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

/* ---------- a company: settings, one booked job, two people with access, one asking, two employees ---------- */
const ORG = 'org-1', inDays = (n) => new Date(Date.now() + n * 864e5).toISOString();
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function seed(twoOrgs) {
  const docs = [], put = (p, data) => { const [c, id] = p.split('/'); docs.push({ org_id: ORG, path: p, collection: c, doc_id: id, data, updated_at: new Date().toISOString() }); };
  put('meta/init', { ts: 1, mode: 'fresh' });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee', 'Luis'], leads: ['Marcus'], office: [{ name: 'Ana', kind: 'owner' }, { name: 'Dot', kind: 'dispatch' }],
    contacts: { Ana: '512-555-0100', Dot: '512-555-0199', Marcus: '512-555-0101', Dee: '512-555-0102', Luis: '' }, trucks: [{ id: 't26', name: 'Box 1 (26 ft)', cf: 1700 }], forms: [], comms: { ring: ['Ana'] } });
  put('jobs/j1', { id: 'j1', status: 'booked', createdAt: 1, d: { name: 'Priya Nair', phone: '512-555-0142', moveDate: day(0), time: '08:00', from: '418 Oak St, Austin', to: '77 Ridge Rd, Round Rock', items: [], custom: {} },
    quote: { total: 1615, cf: 958, crew: 3, hours: 7.5, lines: [{ label: '3 movers, 7.5 hr', amt: 1463 }], deposit: 386, nte: 0, kind: 'local' }, items: [], assign: { truckId: 't26', crew: ['Marcus', 'Dee'] }, tally: {},
    payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} });
  return {
    docs, comm_log: [], comm_lines: [{ org_id: ORG, phone_number: '+15125550000', enabled: true }],
    members: [{ org_id: ORG, user_id: 'u-ana', email: 'ana@x.com', staff: 'Ana', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-marcus', email: 'marcus@x.com', staff: 'Marcus', role: 'lead', ts: 1 }]
      .concat(twoOrgs ? [{ org_id: 'org-2', user_id: 'u-ana', email: 'ana@x.com', staff: 'Ana', role: 'owner', ts: 1 }] : []),
    access_requests: [{ org_id: ORG, user_id: 'u-new', email: 'dee.r@x.com', ts: 1 }],
    employees: [{ id: 'e-marcus', org_id: ORG, name: 'Marcus', role: 'lead', email: 'marcus@x.com', user_id: 'u-marcus', active: true,
      info: { phone: '512-555-0101', payType: 'Hourly', payRate: '24', title: 'Crew lead', dlExpires: day(10), medExpires: day(-3), ssnLast4: '4321' }, notes: 'Owner only: great with pianos' },
      { id: 'e-dee', org_id: ORG, name: 'Dee', role: 'crew', email: '', user_id: null, active: false, info: { phone: '512-555-0102' }, notes: '' }],
  };
}
const ST = (o) => Object.assign({ ok: true, admin: false, test: false, state: 'trial', trial_ends: inDays(2), list_cents: 14900, price_cents: 14900, discount_pct: 0, billing: false, payments: true }, o || {});
const COMPANIES = [
  { id: 'org-blue', name: 'Blue Moving', created: inDays(-3), trial_ends: inDays(11), owners: ['ana@bluemoving.example'], invited: [], members: 4, test: false, waived: false, discount_pct: 0, note: '', member: { state: 'active', price_cents: 14900, list_cents: 14900, discount_pct: 0, period_end: inDays(20) }, cards: 'connected' },
  { id: 'org-green', name: 'Green Movers', created: inDays(-1), trial_ends: inDays(13), owners: [], invited: ['gus@green.example'], members: 0, test: false, waived: false, discount_pct: 0, note: '', member: { state: 'trial', trial_ends: inDays(13), price_cents: 14900, list_cents: 14900, discount_pct: 0 }, cards: 'none' },
  { id: ORG, name: 'Live company test', created: inDays(-5), trial_ends: inDays(20), owners: ['richie@tally.example'], invited: [], members: 1, test: true, waived: true, discount_pct: 0, note: 'My test company', member: { state: 'test', price_cents: 14900, list_cents: 14900, discount_pct: 0 }, cards: 'connecting' },
];
const PAY = { none: { ok: true, ready: false, test: true, publishableKey: '', reason: 'connect', connect: { state: 'none', due: [] } },
  ready: { ok: true, ready: true, test: true, publishableKey: 'pk_test_x', connect: { state: 'ready', due: [] }, account: 'acct_1' } };
const owner = { uid: 'u-ana', email: 'ana@x.com' }, lead = { uid: 'u-marcus', email: 'marcus@x.com' };
const REPLIES = { member_status: ST(), pay_config: PAY.none, admin_list: { ok: true, plan: { monthly_cents: 14900, trial_days: 14 }, payments: 'test', companies: COMPANIES } };
const init = (cfg) => `(function(){ ${SB}
  var db=${JSON.stringify(cfg.db)}, me=${JSON.stringify(cfg.me)}, calls={fn:[],writes:[],rpc:[],storage:[]};
  window.__calls=calls; window.__TALLY_TEST=true; window.open=function(){return null};
  Object.defineProperty(window,'supabase',{configurable:true,get:function(){return {createClient:function(){return (window.__sb=makeSupabase(db,me,calls))}}},set:function(){}});
  var R=${JSON.stringify(cfg.replies)}, of=window.fetch;
  window.fetch=function(url,init){ if(/\\/functions\\/v1\\//.test(String(url))){ var b={}; try{b=JSON.parse(init.body)}catch(e){} calls.fn.push(b); var r=R[b.action]||{ok:true,sent:0}; return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(JSON.parse(JSON.stringify(r)))}}) } return of?of(url,init):Promise.reject(new Error('offline')) };
  try{ ${cfg.org ? `localStorage.setItem('tally.org','${cfg.org}')` : `localStorage.removeItem('tally.org')`} }catch(e){}
  document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='*{scroll-behavior:auto!important}';document.head.appendChild(s)});
})();`;

/* ---------- getting to each screen ---------- */
const tap = async (p, sel, w) => { await p.click(sel); await sleep(w || 250); };
const more = async (p, tab, sec) => { await tap(p, '[data-act="more:open"]'); await tap(p, `#more [data-act="more:go"][data-tab="${tab}"]${tab === 'settings' ? ':not([data-sec])' : ''}`, 400); if (sec) await tap(p, `[data-act="set:open"][data-sec="${sec}"]`, 500); };
const R = (o) => Object.assign({}, REPLIES, o);
const SCREENS = {
  'Today, trial ending': [{}, async () => {}],
  'Today, membership ended': [{ replies: R({ member_status: ST({ state: 'ended', trial_ends: inDays(-1) }) }) }, async () => {}],
  'Setup': [{}, async (p) => { await more(p, 'settings'); }],
  'Setup › Membership, on trial': [{}, async (p) => { await more(p, 'settings', 'member'); }],
  'Setup › Membership, paying with a discount': [{ replies: R({ member_status: ST({ state: 'active', period_end: inDays(10), billing: true, price_cents: 11175, discount_pct: 25 }) }) }, async (p) => { await more(p, 'settings', 'member'); }],
  'Setup › Payments, not connected': [{}, async (p) => { await more(p, 'settings', 'pay'); }],
  'Setup › Payments, ready': [{ replies: R({ pay_config: PAY.ready }) }, async (p) => { await more(p, 'settings', 'pay'); }],
  'Setup › App access, someone asking': [{}, async (p) => { await more(p, 'settings', 'access'); }],
  'Setup › Employees': [{}, async (p) => { await more(p, 'settings', 'employees'); }],
  'an employee’s file': [{}, async (p) => { await more(p, 'settings', 'employees'); await tap(p, '[data-act="emp:open"][data-id="e-marcus"]', 700); }],
  'Setup › Texts and calls': [{}, async (p) => { await more(p, 'settings', 'comms'); }],
  'the More menu': [{}, async (p) => { await tap(p, '[data-act="more:open"]', 400); }],
  'Tally admin': [{ replies: R({ member_status: ST({ admin: true }) }) }, async (p) => { await more(p, 'admin'); }],
  'a job sheet with cards on': [{ replies: R({ pay_config: PAY.ready }) }, async (p) => { await tap(p, '#tabs [data-act="tab"][data-tab="jobs"]', 300); await tap(p, '[data-act="job:open"][data-id="j1"]', 500); await p.evaluate(() => document.querySelectorAll('#sheet details').forEach((d) => { d.open = true; })); }],
  'taking a deposit by card': [{ replies: R({ pay_config: PAY.ready }) }, async (p) => { await tap(p, '#tabs [data-act="tab"][data-tab="jobs"]', 300); await tap(p, '[data-act="job:open"][data-id="j1"]', 500); await p.evaluate(() => { const b = Array.from(document.querySelectorAll('#sheet [data-act="flow:open"]')).find((x) => /Take a payment/.test(x.textContent)); b.click(); }); await sleep(600); }],
  'crew lead Today': [{ me: lead }, async () => {}],
  'crew lead My profile': [{ me: lead }, async (p) => { await tap(p, '[data-act="more:open"]'); await tap(p, '#more [data-act="me:open"]', 700); }],
  'the company picker': [{ org: '', twoOrgs: true }, async () => {}],
};
const NARROW = ['Setup › Membership, paying with a discount', 'Setup › Payments, ready', 'Setup › App access, someone asking', 'an employee’s file', 'Tally admin', 'taking a deposit by card', 'the company picker'];
const AXE_ON = ['Setup › Membership, on trial', 'Setup › Payments, ready', 'Setup › App access, someone asking', 'an employee’s file', 'Tally admin', 'taking a deposit by card', 'the company picker'];

(async () => {
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errors = [];
  const open = async (n, w, h, scheme) => {
    const [cfg, go] = SCREENS[n];
    const full = Object.assign({ me: owner, org: ORG, replies: REPLIES }, cfg, { db: seed(cfg.twoOrgs) });
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme || 'light' });
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    p.on('pageerror', (e) => errors.push(n + ': ' + String(e).slice(0, 200)));
    await p.route(/^https?:/, (r) => r.abort());
    await p.addInitScript(init(full));
    await p.goto('file://' + HF); await sleep(1100);
    // the app came up: the bottom bar for someone signed in, or the list of companies to pick from
    await p.waitForFunction(() => Array.from(document.querySelectorAll('#tabs [data-act], #login button')).some((e) => e.getClientRects().length), null, { timeout: 6000 });
    await go(p); await sleep(400);
    await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; });
    return p;
  };
  for (const [w, h, list] of [[390, 844, Object.keys(SCREENS)], [360, 740, NARROW], [320, 568, NARROW]]) {
    for (const n of list) {
      let p;
      try {
        p = await open(n, w, h);
        const r = await p.evaluate(CHECK);
        ok(r.overflow <= 0 && !r.wide.length, `${w}px, ${n}: nothing runs off the side` + (r.overflow > 0 || r.wide.length ? ` (page ${r.overflow}px wider; ${r.wide.slice(0, 3).join(', ')})` : ''));
        ok(!r.covered.length, `${w}px, ${n}: nothing to tap is hidden under the bars` + (r.covered.length ? ` (${r.covered.slice(0, 3).join('; ')})` : ''));
        if (w === 390) ok(!r.small.length, `${n}: buttons are at least 36 px` + (r.small.length ? ` (${r.small.slice(0, 4).join('; ')})` : ''));
      } catch (e) { ok(false, `${w}px, ${n}: ${String(e).slice(0, 200)}`); }
      if (p) await p.context().close();
    }
  }
  if (!AXE) ok(false, 'axe-core is installed for the contrast check (npm install in tests/ui)');
  else for (const scheme of ['light', 'dark']) {
    const found = [];
    for (const n of AXE_ON) {
      let p;
      try {
        p = await open(n, 390, 844, scheme);
        await p.addScriptTag({ content: AXE });
        const v = await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'] })).violations.flatMap((x) => x.nodes.map((nd) => nd.target.join(' ') + (nd.any[0] && nd.any[0].data ? ' ' + nd.any[0].data.contrastRatio + ':1' : ''))));
        v.forEach((x) => found.push(n + ': ' + x));
      } catch (e) { found.push(n + ': ' + String(e).slice(0, 120)); }
      if (p) await p.context().close();
    }
    ok(!found.length, `a phone set to ${scheme}: Membership, Payments, App access, an employee’s file, Tally admin, a card payment and the company picker pass axe’s colour-contrast rule` + (found.length ? ' (' + found.slice(0, 4).join('; ') + ')' : ''));
  }
  ok(!errors.length, 'no page errors' + (errors.length ? ' (' + errors.slice(0, 3).join(' | ') + ')' : ''));
  await b.close();
  console.log(`\nlayout-hosted: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
