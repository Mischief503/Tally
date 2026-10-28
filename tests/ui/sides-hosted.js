// A company's own call center people in the phone app (Richie, Oct 28: the profile's Call center switch; "every company
// will have their own assigned call center person"). Riley has only the call center side; Marcus is a crew lead and the
// call center too. The database lets them read the open quotes and the schedule's copy and save quotes and bookings
// through cc_save (tests/sql/callcenter.sh); stood in for here by db.__visible.
const { load, ok, sleep, summary, schedOf, ratecardOf } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html', ORG = 'org-1';
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const later = iso(new Date(Date.now() + 9 * 864e5));
const open = (d) => d && (d.status === 'lead' || d.status === 'quoted');
function seed() {
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  const settings = { company: 'Ace Moving', crew: ['Marcus', 'Kim'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }], ccStaff: ['Riley', 'Marcus'],
    contacts: { Owner: '512-555-0100' }, rates: { r2: 140, r3: 195, r4: 250 }, minHours: 3, trucks: [{ id: 't16', name: 'Van (16 ft)', cf: 800 }, { id: 't26', name: 'Box 1 (26 ft)', cf: 1700 }], opt: {} };
  put('meta/init', { ts: 1 }); put('org/settings', settings);
  const job = (id, status, over) => Object.assign({ id, status, createdAt: Date.now() - 864e5, d: { name: 'Customer ' + id, phone: '512-555-0170', moveDate: later, time: '08:00', from: '1 A St', to: '2 B St', items: [{ id: 'sofa3', q: 1 }], custom: {}, discount: '' },
    quote: { cf: 193, count: 18, crew: 2, hours: 3, truckId: 't16', truckName: 'Van (16 ft)', nTrucks: 1, total: 515, kind: 'local', rate: 140, lines: [] }, items: [{ id: 'sofa3', name: 'Sofa (3-seat)', cf: 55, qty: 1 }],
    assign: { truckId: '', crew: [] }, tally: {}, payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} }, over || {});
  put('jobs/q1', job('q1', 'quoted', { d: { name: 'Ortega family', phone: '512-555-0170', moveDate: later, time: '09:00', from: '88 Elm Ct', to: '12 Lakeview Dr', items: [], custom: {}, discount: '50' } }));
  put('jobs/b1', job('b1', 'booked', { d: { name: 'Priya Nair', phone: '512-555-0142', moveDate: later, time: '13:00', from: '418 Oak St', to: '77 Ridge Rd', items: [], custom: {}, slots: ['t26'] }, assign: { truckId: 't26', crew: ['Marcus'] } }));
  put('jobs/b2', job('b2', 'booked', { d: { name: 'Nadia Farouk', phone: '512-555-0110', moveDate: later, time: '08:00', from: '1502 E 6th', to: '34 Barton Hills Dr', items: [], custom: {} } }));
  docs.filter((r) => r.collection === 'jobs' && ['booked', 'active'].indexOf(r.data.status) >= 0).forEach((r) => put('sched/' + r.doc_id, schedOf(r.data)));
  put('ratecard/main', ratecardOf(settings));
  return { docs, access_requests: [], comm_log: [], comm_lines: [], __sched: true, __orgNames: { [ORG]: 'Ace Moving' },
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 },
              { org_id: ORG, user_id: 'u-riley', email: 'riley@x', staff: 'Riley', role: 'crew', ts: 1 },
              { org_id: ORG, user_id: 'u-marcus', email: 'marcus@x', staff: 'Marcus', role: 'lead', ts: 1 }] };
}
// the row rules for a company's own call center person: the company's own (settings, chat), the jobs they're on, and
// the call center's share (the open quotes, the schedule's copies, the rate card)
const rules = (staff) => (r) => ['org', 'meta', 'chat', 'locs', 'photos', 'formpages', 'sched', 'ratecard'].indexOf(r.collection) >= 0 ||
  (r.collection === 'jobs' && (open(r.data) || ((r.data.assign || {}).crew || []).indexOf(staff) >= 0));

(async () => {
  /* ---------- Riley: the call center side only ---------- */
  let db = seed(); db.__visible = rules('Riley');
  const A = await load(FILE, { db, org: ORG, me: { uid: 'u-riley', email: 'riley@x' } });
  const { $, $$, click, T, w } = A;
  await sleep(400);
  const tabs = () => $$('#tabs button').map((b) => b.textContent.replace(/\d+$/, '').trim()).filter(Boolean);
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const ccWrites = () => A.calls.writes.filter((x) => x.op === 'cc_save');
  const type = (sel, v) => { const e = $(sel); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); };
  ok(T.sync.identity.role === 'crew' && T.sync.identity.staff === 'Riley' && T.state().ui.role === 'callcenter', 'Riley signs in: crew to the database, and her app opens as the call center (her one side)');
  ok(tabs().join('|') === 'Schedule|Quotes|Chat|More' && !$('#fab').hidden && T.ui.tab === 'sched', 'her tabs: Schedule, Quotes, Chat, and the round button for a new quote');
  ok((T.state().sched || []).map((r) => r.id).sort().join() === 'b1,b2' && T.state().jobs.map((j) => j.id).join() === 'q1', 'she reads the schedule’s copies and the open quote, not the booked jobs');
  T.ui.schedDay = later; T.ui.schedMon = later.slice(0, 7); T.render(); await sleep(15);
  ok(/Priya Nair/.test(view()) && /Nadia Farouk/.test(view()) && !/\$/.test(view()) && !!$('#view .dp-card .tl'), 'the Schedule: the day’s jobs and slots, no money');
  click('#fab'); await sleep(15);
  type('[data-d="name"]', 'Lee Park'); type('[data-d="moveDate"]', later); await sleep(10);
  click('[data-act="q:step"][data-s="2"]'); await sleep(10); click($$('[data-act="inc"]')[0]); await sleep(10);
  click('[data-act="q:step"][data-s="3"]'); await sleep(15);
  ok(!$('[data-d="discount"]') && !/Other companies/.test($('#dayPlan').textContent), 'her quote: no discount, and no other companies (she books for this one)');
  click($('#dayPlan [data-act="dp:time"]')); await sleep(10);
  const n0 = ccWrites().length;
  click('[data-act="q:book"]'); await sleep(900);
  const nw = ccWrites().slice(n0);
  ok(nw.length === 1 && nw[0].doc && nw[0].doc.status === 'booked' && nw[0].doc.createdCC === true && nw[0].doc.createdBy === 'Riley' && !nw[0].doc.assign.truckId && nw[0].doc.d.slots.length === 1, 'Book job: through cc_save, made by Riley of the call center, in a slot, no truck');
  ok(Object.values(nw[0].doc.log || {}).some((l) => l.ev === 'Created as Booked by Riley (call center)'), 'the activity: “Created as Booked by Riley (call center)”');
  ok(A.errors.length === 0, 'no errors for Riley (' + A.errors.slice(0, 2).join(' | ') + ')');

  /* ---------- Marcus: a crew lead, and the call center too ---------- */
  db = seed(); db.__visible = rules('Marcus');
  const B = await load(FILE, { db, org: ORG, me: { uid: 'u-marcus', email: 'marcus@x' } });
  await sleep(400);
  const btabs = () => B.$$('#tabs button').map((b) => b.textContent.replace(/\d+$/, '').trim()).filter(Boolean);
  ok(B.T.state().ui.role === 'lead' && btabs().join('|') === 'Jobs|Schedule|Quotes|Chat|More' && !B.$('#fab').hidden, 'Marcus signs in: his Jobs first, then the Schedule, Quotes and Chat, with the round button');
  ok(B.T.state().jobs.map((j) => j.id).sort().join() === 'b1,q1' && (B.T.state().sched || []).length === 2, 'he reads his own job, the open quote and the schedule’s copies');
  const bw = () => B.calls.writes.filter((x) => x.table === 'docs');
  const n1 = bw().length;
  const b1 = B.T.state().jobs.find((j) => j.id === 'b1'); b1.d.notes = 'Gate 4411'; B.T.save(); await sleep(700);
  const mine = bw().slice(n1);
  ok(mine.length >= 1 && mine.every((x) => x.op !== 'cc_save') && mine.some((x) => /jobs\/b1/.test((x.row && x.row.path) || x.path || '')), 'a change to his own job goes the usual way, not through the call center’s');
  const q1 = B.T.state().jobs.find((j) => j.id === 'q1'); q1.d.notes = 'Piano too'; B.T.save(); await sleep(700);
  ok(bw().slice(n1).some((x) => x.op === 'cc_save' && x.path === 'jobs/q1'), 'a change to the open quote goes through cc_save');
  ok(B.errors.length === 0, 'no errors for Marcus (' + B.errors.slice(0, 2).join(' | ') + ')');
  process.exit(summary('sides-hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
