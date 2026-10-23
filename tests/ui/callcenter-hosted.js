// The call center on the hosted app (Richie, Oct 22: "I guess i also need a call center side . They will not see
// anything but scheduled jobs and being able to make quotes"): Jess signs in as the call center. The database lets
// her read the open quotes and a copy of the schedule without the money (stood in for here: db.__visible and
// db.__sched), and she saves only through cc_save, which the database checks.
const { load, ok, sleep, summary, schedOf } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html', ORG = 'org-1';
const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const later = (() => { const d = new Date(Date.now() + 9 * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const open = (d) => d && (d.status === 'lead' || d.status === 'quoted');
const quote = (total, crew) => ({ cf: 193, count: 18, crew: crew || 2, hours: 3, truckId: 't16', truckName: 'Van (16 ft)', nTrucks: 1, total, nte: 595, deposit: 129, kind: 'local', rate: 140, fixed: 95, taxPct: 0, minHours: 3,
  lines: [{ label: '2 movers, 3 hr at $140/hr', amt: 420, k: 'hours' }, { label: 'Truck and fuel', amt: 45, k: 'fixed' }, { label: 'Stairs: 2 flights', amt: 50, k: 'fixed' }] });
function seed() {
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  put('meta/init', { ts: 1 });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Kim'], leads: ['Marcus'], callcenter: ['Jess'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
    contacts: { Owner: '512-555-0100', Jess: '512-555-0107' }, rates: { r2: 140, r3: 195, r4: 250 }, trucks: [{ id: 't16', name: 'Van (16 ft)', cf: 800 }, { id: 't26', name: 'Box 1 (26 ft)', cf: 1700 }], forms: [], opt: {} });
  const job = (id, status, over) => Object.assign({ id, status, createdAt: Date.now() - 864e5, d: { name: 'Customer ' + id, phone: '512-555-01' + id.length + '0', moveDate: '', time: '08:00', from: '1 A St', to: '2 B St', items: [{ id: 'sofa3', q: 1 }], custom: {}, discount: '' },
    quote: quote(515), items: [{ id: 'sofa3', name: 'Sofa (3-seat)', cf: 55, qty: 1 }], assign: { truckId: '', crew: [] }, tally: {}, payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} }, over || {});
  put('jobs/q1', job('q1', 'quoted', { d: { name: 'Ortega family', phone: '512-555-0170', moveDate: later, time: '09:00', from: '88 Elm Ct', to: '12 Lakeview Dr', items: [{ id: 'sofa3', q: 1 }], custom: {}, discount: '50' } }));
  put('jobs/l1', job('l1', 'lead', { d: { name: 'Sam Kowalski', phone: '512-555-0180', moveDate: '', time: '08:00', from: 'Austin', to: 'San Antonio', items: [], custom: {}, discount: '' }, quote: { cf: 0, total: 0, lines: [] }, items: [] }));
  put('jobs/b1', job('b1', 'booked', { d: { name: 'Priya Nair', phone: '512-555-0142', moveDate: today, time: '08:00', from: '418 Oak St', to: '77 Ridge Rd', notes: 'Gate 4411', items: [{ id: 'sofa3', q: 1 }], custom: {} },
    assign: { truckId: 't26', crew: ['Marcus', 'Kim'] }, payments: { p1: { id: 'p1', amt: 129, method: 'Card', ts: 1 } } }));
  // the database's copies of the schedule (supabase-callcenter.sql)
  docs.filter((r) => r.collection === 'jobs' && ['booked', 'active'].indexOf(r.data.status) >= 0).forEach((r) => put('sched/' + r.doc_id, schedOf(r.data)));
  return { docs, access_requests: [], comm_log: [], comm_lines: [], __sched: true,
    // the row rules, for Jess: the open quotes and leads, and the copies; never the booked jobs themselves
    __visible: (r) => r.collection !== 'jobs' || open(r.data),
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-jess', email: 'j@x', staff: 'Jess', role: 'callcenter', ts: 1 }] };
}

(async () => {
  const db = seed();
  const A = await load(FILE, { db, org: ORG, me: { uid: 'u-jess', email: 'j@x' }, fnReply: () => ({ ok: true, sent: 0 }) });
  const { $, $$, click, T, w } = A;
  await sleep(300);
  const row = (p) => (db.docs.find((d) => d.path === p) || {}).data;
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const ccWrites = () => A.calls.writes.filter((x) => x.op === 'cc_save');
  ok(T.state().ui.role === 'callcenter' && T.ui.tab === 'sched' && $$('#tabs button').map((b) => b.textContent).join('|') === 'Schedule|Quotes||More' && !$('#fab').hidden, 'Jess signs in as the call center: Schedule, Quotes, the round button for a new quote');
  ok((T.state().sched || []).map((r) => r.id).join(',') === 'b1' && T.state().jobs.map((j) => j.id).sort().join(',') === 'l1,q1', 'the schedule comes from the database’s copies; the jobs she reads are the open quotes');
  ok(/Priya Nair/.test(view()) && /418 Oak St → 77 Ridge Rd/.test(view()) && !/\$/.test(view()), 'today’s booked job is on her schedule, with no money on the screen');
  const pri = $('#view details.schedcard[data-job="b1"]');
  ok(!!pri && /Gate 4411/.test(pri.textContent) && /Truck: Box 1 \(26 ft\)/.test(pri.textContent) && /2 movers \(2 on the job so far\)/.test(pri.textContent) && !/Marcus|Kim/.test(pri.textContent), 'opened: the notes, the truck and how many movers (not who)');

  /* ---------- an open quote: changed, then booked ---------- */
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
  ok(nw.length === 1 && nw[0].doc && nw[0].doc.status === 'booked' && nw[0].doc.createdBy === 'Jess' && JSON.stringify(nw[0].doc.payments) === '{}', 'a new booking goes in whole through cc_save: booked, made by Jess, no payments');
  ok(!!row('sched/' + nid) && (T.state().sched || []).some((r) => r.id === nid) && /Dana Whit/.test(view()), 'and it’s on her schedule');

  /* ---------- the office books one while she's changing it ---------- */
  const l1 = db.docs.find((d) => d.path === 'jobs/l1'); l1.data = Object.assign({}, l1.data, { status: 'booked' });   // no word to her phone yet
  T.state().jobs.find((j) => j.id === 'l1').d.notes = 'Call after 5'; T.save(); await sleep(900);
  ok(!T.state().jobs.some((j) => j.id === 'l1') && /Sam Kowalski was booked or closed by the office meanwhile, so your last change to it didn’t save\./.test(toast()), 'her change to a quote the office booked meanwhile: it leaves her phone, and she’s told');
  const nl = ccWrites().length; await sleep(1500);
  ok(ccWrites().length === nl && row('jobs/l1').d.notes == null, 'no retrying, and the office’s booking is as it was');
  ok(A.errors.length === 0, 'no errors (' + A.errors.slice(0, 3).join(' | ') + ')');
  process.exit(summary('callcenter-hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
