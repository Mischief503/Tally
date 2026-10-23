// The call center on the hosted app (Richie, Oct 22: "Call center is a service that the moving companys will be able
// to purchase to help get bookings . So call center will only be able to see companys that pay for that service ."):
// Jess is on Tally's call center team (not one of the company's people), and Tally admin has switched the service on
// for Ace Moving and Bluebonnet Moving. The database lets her read their rate card copies, open quotes and schedule
// copies, nothing else (stood in for here: db.__visible, db.__sched), and she saves only through cc_save.
const { load, ok, sleep, summary, schedOf, ratecardOf } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html', ORG = 'org-1', ORG2 = 'org-2';
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = iso(new Date()), later = iso(new Date(Date.now() + 9 * 864e5));
const open = (d) => d && (d.status === 'lead' || d.status === 'quoted');
const quote = (total, crew) => ({ cf: 193, count: 18, crew: crew || 2, hours: 3, truckId: 't16', truckName: 'Van (16 ft)', nTrucks: 1, total, nte: 595, deposit: 129, kind: 'local', rate: 140, fixed: 95, taxPct: 0, minHours: 3,
  lines: [{ label: '2 movers, 3 hr at $140/hr', amt: 420, k: 'hours' }, { label: 'Truck and fuel', amt: 45, k: 'fixed' }, { label: 'Stairs: 2 flights', amt: 50, k: 'fixed' }] });
// where the fake OpenStreetMap puts addresses
const GEO = { 'round rock': [30.5083, -97.6789], 'austin': [30.2672, -97.7431], 'georgetown': [30.6333, -97.6779] };
function seed() {
  const docs = [], put = (org, path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: org, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  const settings = { company: 'Ace Moving', crew: ['Marcus', 'Kim'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
    contacts: { Owner: '512-555-0100', Marcus: '512-555-0101' }, crewCost: 24, rates: { r2: 140, r3: 195, r4: 250 }, minHours: 3, includedMiles: 20, mileRate: 1.5,
    shopAddress: '1200 Industrial Blvd, Austin, TX', shopGeo: { lat: 30.33, lon: -97.7, addr: '1200 Industrial Blvd, Austin, TX' },
    trucks: [{ id: 't16', name: 'Van (16 ft)', cf: 800 }, { id: 't26', name: 'Box 1 (26 ft)', cf: 1700 }],
    forms: [{ id: 'f_bol', title: 'Bill of lading', kind: 'pages', required: false, pages: [], pageIds: ['fp1'] }], opt: {} };
  const blue = { company: 'Bluebonnet Moving', crew: ['Ty'], contacts: { Ty: '512-555-0177' }, rates: { r2: 135, r3: 190, r4: 245 }, minHours: 2, includedMiles: 30, mileRate: 1.6,
    shopAddress: '500 Leander Rd, Georgetown, TX', trucks: [{ id: 'b1', name: 'Box (26 ft)', cf: 1700 }], opt: {} };
  put(ORG, 'meta/init', { ts: 1 }); put(ORG, 'org/settings', settings);
  put(ORG2, 'meta/init', { ts: 1 }); put(ORG2, 'org/settings', blue);
  const job = (id, status, over) => Object.assign({ id, status, createdAt: Date.now() - 864e5, d: { name: 'Customer ' + id, phone: '512-555-01' + id.length + '0', moveDate: '', time: '08:00', from: '1 A St', to: '2 B St', items: [{ id: 'sofa3', q: 1 }], custom: {}, discount: '' },
    quote: quote(515), items: [{ id: 'sofa3', name: 'Sofa (3-seat)', cf: 55, qty: 1 }], assign: { truckId: '', crew: [] }, tally: {}, payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} }, over || {});
  put(ORG, 'jobs/q1', job('q1', 'quoted', { d: { name: 'Ortega family', phone: '512-555-0170', moveDate: later, time: '09:00', from: '88 Elm Ct', to: '12 Lakeview Dr', items: [{ id: 'sofa3', q: 1 }], custom: {}, discount: '50' },
    photos: { ph1: { id: 'ph1', kind: 'before', ts: 1 } } }));
  put(ORG, 'jobs/l1', job('l1', 'lead', { d: { name: 'Sam Kowalski', phone: '512-555-0180', moveDate: '', time: '08:00', from: 'Austin', to: 'San Antonio', items: [], custom: {}, discount: '' }, quote: { cf: 0, total: 0, lines: [] }, items: [] }));
  put(ORG, 'jobs/b1', job('b1', 'booked', { d: { name: 'Priya Nair', phone: '512-555-0142', moveDate: today, time: '08:00', from: '418 Oak St', to: '77 Ridge Rd', notes: 'Gate 4411', items: [{ id: 'sofa3', q: 1 }], custom: {} },
    assign: { truckId: 't26', crew: ['Marcus', 'Kim'] }, payments: { p1: { id: 'p1', amt: 129, method: 'Card', ts: 1 } } }));
  put(ORG2, 'jobs/z1', job('z1', 'booked', { d: { name: 'Bluebonnet customer', phone: '512-555-0199', moveDate: later, time: '10:00', from: '9 Oak', to: '8 Elm', items: [], custom: {} }, assign: { truckId: 'b1', crew: ['Ty'] } }));
  // the database's copies: the schedule without the money, and the rate cards (supabase-callcenter.sql)
  docs.filter((r) => r.collection === 'jobs' && ['booked', 'active'].indexOf(r.data.status) >= 0).forEach((r) => put(r.org_id, 'sched/' + r.doc_id, schedOf(r.data)));
  docs.filter((r) => r.path === 'org/settings').forEach((r) => put(r.org_id, 'ratecard/main', ratecardOf(r.data)));
  // the team's own: a photo on the open quote, a form's page, a chat message and a crew location
  put(ORG, 'photos/ph1', { id: 'ph1', jobId: 'q1', kind: 'before', ts: 1, data: 'data:image/jpeg;base64,xx' });
  put(ORG, 'formpages/fp1', { id: 'fp1', data: 'data:image/png;base64,xx' });
  put(ORG, 'chat/m1', { id: 'm1', from: 'Dispatch', to: 'all', text: 'Gate code is 4411', ts: Date.now() - 6e4 });
  put(ORG, 'locs/marcus', { name: 'Marcus', lat: 30.27, lng: -97.74, ts: Date.now() });
  return { docs, access_requests: [], comm_log: [], comm_lines: [], __sched: true, __orgNames: { [ORG]: 'Ace Moving' },
    __ccTeam: { 'u-jess': 'Jess' }, __ccOrgs: [{ id: ORG, name: 'Ace Moving' }, { id: ORG2, name: 'Bluebonnet Moving' }],
    // the row rules, for Jess (Tally's team, both companies switched on): the rate cards, the open quotes and
    // leads, the schedule copies and the start mark; never the settings themselves, the booked jobs, the people or
    // the team's own things
    __visible: (r) => ['meta', 'ratecard', 'sched'].indexOf(r.collection) >= 0 || (r.collection === 'jobs' && open(r.data)),
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }] };
}
const net = async (url) => {
  const m = /nominatim\.openstreetmap\.org\/search\?.*&q=([^&]+)/.exec(url);
  if (m) { const q = decodeURIComponent(m[1]).toLowerCase(), k = Object.keys(GEO).find((x) => q.indexOf(x) >= 0); return { ok: true, json: async () => (k ? [{ lat: String(GEO[k][0]), lon: String(GEO[k][1]) }] : []) }; }
  return { ok: false, json: async () => ({}) };
};

(async () => {
  const db = seed();
  const asks = [];   // every read her phone makes, to see it never asks for the team's photos or form pages
  db.__failSelect = (table, asked) => { asks.push(table + ':' + asked.map(([c, v]) => c + '=' + v).join('&')); return false; };
  let reloads = 0;
  const A = await load(FILE, { db, org: ORG, me: { uid: 'u-jess', email: 'j@x' }, net, fnReply: () => ({ ok: true, sent: 0 }), setup: (w) => { w.__tallyReload = () => { reloads++; }; } });
  const { $, $$, click, T, w } = A;
  await sleep(300);
  const row = (p, o) => (db.docs.find((d) => d.path === p && d.org_id === (o || ORG)) || {}).data;
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const ccWrites = () => A.calls.writes.filter((x) => x.op === 'cc_save');
  const change = (sel, v) => { const e = $(sel); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); e.dispatchEvent(new w.Event('change', { bubbles: true })); };
  ok(A.calls.rpc.some((c) => c.name === 'claim_cc_team') && T.sync.identity.role === 'callcenter' && T.sync.identity.staff === 'Jess', 'Jess signs in: linked to Tally’s call center team, the call center in Ace Moving, under her name');
  ok(T.state().ui.role === 'callcenter' && T.ui.tab === 'desk' && $$('#tabs button').map((b) => b.textContent).filter(Boolean).join('|') === 'Companies|Schedule|Quotes|More' && !$('#fab').hidden, 'her app: Companies first, then Schedule and Quotes, and the round button for a new quote');
  const S = T.state().settings;
  ok(S.company === 'Ace Moving' && S.rates.r2 === 140 && S.crew.length === 0 && !Object.keys(S.contacts).length && S.crewCost === 0 && (S.office || []).length === 0, 'her settings are the rate card: the prices, and none of the company’s crew, phones, costs or office (not even the sample ones)');
  ok(asks.some((a) => a === 'docs:org_id=org-1&path=ratecard/main') && !asks.some((a) => /path=org\/settings/.test(a)), 'she reads the rate card copy, never the settings');
  ok((T.state().sched || []).map((r) => r.id).join(',') === 'b1' && T.state().jobs.map((j) => j.id).sort().join(',') === 'l1,q1', 'the schedule comes from the database’s copies; the jobs she reads are the open quotes');
  click('[data-act="more:open"]'); await sleep(10);
  ok(!$('[data-act="more:company"]') && /Change the look/.test($('#more').textContent), 'More has no Switch company (Companies is where she switches)');
  click('#more [data-act="more:close"]'); await sleep(5);
  ok(!asks.some((a) => /path=(photos|formpages)\//.test(a)) && T.chat.msgs.length === 0 && !Object.keys(T.chat.locs || {}).length, 'nothing of the team’s: no chat, no crew locations, and her phone doesn’t ask for the quote’s photo or the form’s page');

  /* ---------- Companies: every company with the service ---------- */
  await sleep(50);
  const cards = () => $$('#view details.deskcard');
  ok(cards().length === 2 && cards().map((d) => d.querySelector('.hsum b').textContent).join(',') === 'Ace Moving,Bluebonnet Moving' && !/\(sample\)/.test(view()), 'Companies: the two companies with the service, no samples');
  ok(asks.some((a) => /^docs:path=ratecard\/main&org_id=org-1,org-2$/.test(a)) && asks.some((a) => /^docs:collection=sched&org_id=org-1,org-2$/.test(a)), 'their rate cards and schedule copies, in one read each');
  change('#dkAddr', '77 Ridge Rd, Round Rock'); await sleep(1300);
  ok(T.ui.desk.geo && T.ui.desk.geo.lat === 30.5083 && cards()[0].querySelector('.hsum b').textContent === 'Bluebonnet Moving', 'the pickup looked up (OpenStreetMap): Bluebonnet, in Georgetown, is nearest');
  ok(/Georgetown · 8\.6 mi from the pickup/.test(cards()[0].textContent) && /Austin · 12 mi from the pickup/.test(cards()[1].textContent), 'each says how far: ' + cards().map((d) => (d.querySelector('.hsum small') || {}).textContent).join(' / '));
  ok(A.calls.rpc.length >= 0 && asks.length && !A.calls.writes.some((x) => /^ratecard|^org\//.test(x.row && x.row.path || '')), 'and nothing is written');
  change('#dkDate', later); await sleep(20);
  const av = (n) => { const d = cards().find((x) => x.querySelector('.hsum b').textContent === n); return d.querySelector('.dkav').textContent; };
  ok(av('Bluebonnet Moving') === 'Full' && av('Ace Moving') === 'Open', 'that day: Bluebonnet’s one truck is taken (from its schedule copy), Ace is open');
  cards()[0].open = true;
  ok(/2 movers\s*\$135\/hr/.test(cards()[0].querySelector('.ratecard').textContent) && /Inside their 30-mile local area/.test(cards()[0].textContent), 'Bluebonnet’s rate card, and the move is local for them');
  click('#view [data-act="desk:quote"][data-co="' + ORG2 + '"]'); await sleep(20);
  let pre = null; try { pre = JSON.parse(w.sessionStorage.getItem('tally.deskOpen')); } catch (e) {}
  ok(reloads === 1 && w.localStorage.getItem('tally.org') === ORG2 && pre && pre.tab === 'quote' && pre.from === '77 Ridge Rd, Round Rock' && pre.moveDate === later, 'Make a quote for Bluebonnet: the app opens Bluebonnet, carrying the pickup and the date');
  w.localStorage.setItem('tally.org', ORG); w.sessionStorage.removeItem('tally.deskOpen');

  /* ---------- in Ace Moving: an open quote, changed, then booked ---------- */
  T.ui.tab = 'sched'; T.render(); await sleep(15);
  ok(/Priya Nair/.test(view()) && /418 Oak St → 77 Ridge Rd/.test(view()) && !/\$/.test(view()), 'today’s booked job is on her schedule, with no money on the screen');
  const pri = $('#view details.schedcard[data-job="b1"]');
  ok(!!pri && /Gate 4411/.test(pri.textContent) && /Truck: Box 1 \(26 ft\)/.test(pri.textContent) && /2 movers \(2 on the job so far\)/.test(pri.textContent) && !/Marcus|Kim/.test(pri.textContent), 'opened: the notes, the truck and how many movers (not who)');
  click('[data-act="tab"][data-tab="quotes"]'); await sleep(15);
  ok(/Ortega family/.test(view()) && /Sam Kowalski/.test(view()) && /\$515/.test(view()), 'Quotes: both open ones, with their prices');
  click('#view [data-act="cc:open"][data-id="q1"]'); await sleep(15);
  ok(T.ui.tab === 'quote' && T.state().draft.editId === 'q1' && T.state().draft.discount === '50', 'Open quote: into the quote builder (the office’s discount comes along, unseen)');
  click('[data-act="q:step"][data-s="3"]'); await sleep(15);
  ok(!$('[data-d="discount"]'), 'the price step has no discount for her');
  const crewSel = $('[data-d="crew"]'); crewSel.value = '3'; crewSel.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(10);
  const n0 = ccWrites().length;
  click('#qSave'); await sleep(700);
  const w1 = ccWrites().slice(n0);
  ok(w1.length === 1 && w1[0].path === 'jobs/q1' && w1[0].patch && w1[0].patch.quote && w1[0].patch.quote.crew === 3 && w1[0].patch.d.discount === '50' && w1[0].patch.quote.lines.some((l) => l.label === 'Discount' && l.amt === -50), 'Save: one change through cc_save, the new crew in it and the office’s discount as it was');
  ok(row('jobs/q1').quote.crew === 3 && row('jobs/q1').d.discount === '50' && T.ui.tab === 'quotes' && /Saved\. It’s in Quotes\./.test(toast()), 'saved in the database, with the office’s discount; back to Quotes');
  ok(!A.calls.writes.some((x) => (x.op === 'patch' || (x.table === 'docs' && !x.op)) && /^jobs\//.test((x.row && x.row.path) || '')), 'nothing went to the jobs any other way');
  click('#view [data-act="cc:open"][data-id="q1"]'); await sleep(15);
  click('[data-act="q:step"][data-s="3"]'); await sleep(10);
  click('[data-act="q:book"]'); await sleep(900);
  ok(row('jobs/q1').status === 'booked' && !!row('sched/q1') && T.ui.tab === 'sched' && T.ui.schedDay === later, 'Book job: booked in the database, its copy is on the schedule, and she’s on its day');
  ok(Object.values(row('jobs/q1').log || {}).some((l) => l.ev === 'Booked by Jess (call center)'), 'the job’s activity: “Booked by Jess (call center)”');
  ok(!T.state().jobs.some((j) => j.id === 'q1') && (T.state().sched || []).some((r) => r.id === 'q1') && /Ortega family/.test(view()) && !/\$/.test(view()), 'the job itself leaves her phone; the schedule shows it from the copy, without the money');

  /* ---------- a new quote, booked straight away ---------- */
  click('#fab'); await sleep(15);
  const type = (sel, v) => { const e = $(sel); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); };
  type('[data-d="name"]', 'Dana Whit'); type('[data-d="moveDate"]', later); await sleep(10);
  ok(/: 1 job booked, 1 of 2 trucks taken\.$/.test($('#dayNote').textContent), 'the move date says how busy that day is already: ' + $('#dayNote').textContent);
  click('[data-act="q:step"][data-s="2"]'); await sleep(10);
  click($$('[data-act="inc"]')[0]); await sleep(10);
  click('[data-act="q:step"][data-s="3"]'); await sleep(10);
  const n1 = ccWrites().length;
  click('[data-act="q:book"]'); await sleep(900);
  const nw = ccWrites().slice(n1), nid = nw[0] && nw[0].path.slice(5);
  ok(nw.length === 1 && nw[0].doc && nw[0].doc.status === 'booked' && nw[0].doc.createdBy === 'Jess' && nw[0].doc.createdCC === true && JSON.stringify(nw[0].doc.payments) === '{}', 'a new booking goes in whole through cc_save: booked, made by Jess of the call center, no payments');
  ok(!!row('sched/' + nid) && (T.state().sched || []).some((r) => r.id === nid) && /Dana Whit/.test(view()), 'and it’s on her schedule');

  /* ---------- the office books one while she's changing it ---------- */
  const l1 = db.docs.find((d) => d.path === 'jobs/l1'); l1.data = Object.assign({}, l1.data, { status: 'booked' });   // no word to her phone yet
  T.state().jobs.find((j) => j.id === 'l1').d.notes = 'Call after 5'; T.save(); await sleep(900);
  ok(!T.state().jobs.some((j) => j.id === 'l1') && /Sam Kowalski was booked or closed by the office meanwhile, so your last change to it didn’t save\./.test(toast()), 'her change to a quote the office booked meanwhile: it leaves her phone, and she’s told');
  const nl = ccWrites().length; await sleep(1500);
  ok(ccWrites().length === nl && row('jobs/l1').d.notes == null, 'no retrying, and the office’s booking is as it was');
  ok(A.errors.length === 0, 'no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ---------- arriving in Bluebonnet from Make a quote ---------- */
  const B = await load(FILE, { db, org: ORG2, me: { uid: 'u-jess', email: 'j@x' }, net, setup: (w2) => { w2.sessionStorage.setItem('tally.deskOpen', JSON.stringify({ tab: 'quote', from: '77 Ridge Rd, Round Rock', moveDate: later })); } });
  await sleep(400);
  ok(B.T.sync.identity.role === 'callcenter' && B.T.ui.tab === 'quote' && B.T.state().draft.from === '77 Ridge Rd, Round Rock' && B.T.state().draft.moveDate === later && B.T.state().settings.company === 'Bluebonnet Moving', 'in Bluebonnet: its quote builder, the pickup and the date filled in, its rate card behind it');
  ok(!B.w.sessionStorage.getItem('tally.deskOpen') && B.errors.length === 0, 'and the hand-off is used up (' + B.errors.slice(0, 2).join(' | ') + ')');

  /* ---------- on the team, but no company switched on ---------- */
  const db3 = seed(); db3.__ccOrgs = [];
  const C = await load(FILE, { db: db3, me: { uid: 'u-jess', email: 'j@x' }, net });
  await sleep(300);
  const pk = C.$('#login') ? C.$('#login').textContent : '';
  ok(/You’re on Tally’s call center team\. No company has the call center switched on yet/.test(pk) && !C.$('#pkNew') && !C.$('#pkJoin') && !!C.$('#pkOut'), 'on the team with no company switched on: it says so, with nothing to start or join');
  process.exit(summary('callcenter-hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
