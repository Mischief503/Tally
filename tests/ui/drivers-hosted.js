// Drivers in the hosted app: dispatch adds a second truck and picks the drivers on one phone, the job
// in the database carries them (assign.more, assign.drivers), the crew lead's phone shows "you drive",
// and the owner's list of who drives (settings.drivers) reaches dispatch's Board.
const { load, ok, sleep, summary } = require('./lib');
const HOSTED = __dirname + '/../../build/tally-supabase.html';
const ORG = 'org-1';
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function row(path, data) { const [collection, doc_id] = path.split('/'); return { org_id: ORG, path, collection, doc_id, data, updated_at: new Date().toISOString() }; }
function seed() {
  return { docs: [row('meta/init', { ts: 1 }),
    row('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee', 'Luis'], leads: ['Marcus'], drivers: ['Marcus', 'Luis'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
      contacts: { Owner: '512-555-0100', Dispatch: '512-555-0199', Marcus: '512-555-0101', Dee: '512-555-0102', Luis: '512-555-0103' },
      trucks: [{ id: 't26', name: 'Box 1 (26 ft)', cf: 1700 }, { id: 't20', name: 'Box 2 (20 ft)', cf: 1000 }], forms: [] }),
    row('jobs/j1', { id: 'j1', status: 'booked', createdAt: 1, d: { name: 'Priya Nair', phone: '512-555-0142', moveDate: day(1), time: '08:00', from: '418 Oak St', to: '77 Ridge Rd', items: [], custom: {} },
      quote: { total: 1615, cf: 1450, crew: 3, hours: 7, lines: [], deposit: 0, nte: 0, nTrucks: 2 }, items: [], assign: { truckId: 't26', crew: ['Marcus', 'Dee', 'Luis'] }, tally: {},
      payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} })],
    access_requests: [], comm_log: [], comm_lines: [],
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-dispatch', email: 'd@x', staff: 'Dispatch', role: 'dispatch', ts: 1 },
      { org_id: ORG, user_id: 'u-marcus', email: 'm@x', staff: 'Marcus', role: 'lead', ts: 1 }] };
}
const as = (uid) => ({ uid, email: uid + '@x' });
(async () => {
  const db = seed(), all = [];
  const D = await load(HOSTED, { db, org: ORG, me: as('u-dispatch'), fnReply: () => ({ ok: true, sent: 0 }) }); all.push(D);
  const job = () => db.docs.find((x) => x.path === 'jobs/j1').data;
  ok(D.T.needsSched(D.T.state().jobs[0]), 'dispatch: the job needs a driver for Box 1');
  D.T.ui.jobId = 'j1'; D.T.render(); await sleep(20);
  ok(/This load is about 1,450 cu ft \(the quote has 2 trucks\); the truck holds 1,700/.test(D.$('#sheet').textContent) === false, 'a truck big enough for the load: no warning about room');
  D.click('#sheet [data-act="trk:add"]'); await sleep(20);
  const sels = D.$$('#sheet select[data-drv="sh"]');
  sels[0].value = 'Marcus'; sels[0].dispatchEvent(new D.w.Event('change', { bubbles: true })); await sleep(20);
  ok(/Marcus driving Box 1 \(26 ft\)\. Luis driving Box 2 \(20 ft\)\./.test(D.$('#toast').textContent), 'picking Marcus for Box 1 leaves Luis, the other driver on the crew, for Box 2: ' + D.$('#toast').textContent);
  await sleep(600);
  const a = job().assign;
  ok(a.truckId === 't26' && JSON.stringify(a.more) === '["t20"]' && a.drivers && a.drivers.t26 === 'Marcus' && a.drivers.t20 === 'Luis', 'the database has both trucks and both drivers: ' + JSON.stringify(a));
  // the crew lead's phone
  const M = await load(HOSTED, { db, org: ORG, me: as('u-marcus'), fnReply: () => ({ ok: true, sent: 0 }) }); all.push(M);
  M.click('[data-act="tab"][data-tab="crew"]'); await sleep(20);
  const card = M.$$('.crewcard,.ccmini').find((c) => /Priya Nair/.test(c.textContent));
  ok(card && /Box 1 \(26 ft\), you drive · Box 2 \(20 ft\), Luis drives/.test(card.textContent), 'Marcus’s phone: Box 1, you drive · Box 2, Luis drives');
  // someone else changes the drivers: dispatch's sheet follows
  // (the stand-in database tells only the client that wrote a row, so the change goes in through dispatch's own connection, as a change from elsewhere arrives)
  await D.w.__sb.from('docs').upsert(row('jobs/j1', Object.assign({}, job(), { assign: Object.assign({}, job().assign, { drivers: { t26: 'Luis', t20: 'Marcus' } }) }))); await sleep(700);
  const dj = D.T.state().jobs.find((x) => x.id === 'j1'), ds = D.$$('#sheet select[data-drv="sh"]');
  ok(dj.assign.drivers.t20 === 'Marcus' && ds[1] && ds[1].value === 'Marcus', 'a change from another phone shows on dispatch’s sheet: ' + JSON.stringify(dj.assign.drivers) + ' / ' + ds.map((x) => x.value).join(','));
  ok(all.every((x) => x.errors.length === 0), 'no errors (' + all.map((x) => x.errors.join(' | ')).join(' ') + ')');
  process.exit(summary('drivers hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
