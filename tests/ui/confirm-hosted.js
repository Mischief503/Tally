const { load, ok, sleep, summary } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html', ORG = 'org-1';
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function jobDoc(id, name, crew, extra) {
  return Object.assign({ id, status: 'booked', createdAt: 1, d: { name, phone: '512-555-0142', moveDate: day(1), time: '08:00', from: '418 Oak St', to: '77 Ridge', items: [], custom: {} },
    quote: { total: 900, cf: 400, crew: 2, hours: 3, lines: [], deposit: 0, nte: 0 }, items: [], assign: { truckId: 't26', crew }, tally: {},
    payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} }, extra || {});
}
function seed() {
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  put('meta/init', { ts: 1 });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
    contacts: { Owner: '512-555-0100', Dispatch: '512-555-0199', Marcus: '512-555-0101', Dee: '512-555-0102' }, trucks: [{ id: 't26', name: 'Box 1', cf: 1700 }], forms: [] });
  put('jobs/c1', jobDoc('c1', 'Priya Nair', ['Marcus', 'Dee'], { confirm: { Dee: { ts: 5, for: day(1) + ' 08:00' } } }));
  put('jobs/c2', jobDoc('c2', 'Nadia Farouk', ['Dee']));
  return { docs, access_requests: [], comm_log: [], comm_lines: [{ org_id: ORG, phone_number: '+15125550000', enabled: true }],
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-marcus', email: 'm@x', staff: 'Marcus', role: 'lead', ts: 1 }] };
}
(async () => {
  // owner: reminder button
  const A = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: (b) => b.action === 'remind' ? { ok: true, message: 'Reminder texted to 1 person.' } : { ok: true, sent: 0 } });
  A.click('[data-act="tab"][data-tab="jobs"]'); await sleep(15);
  A.click('[data-act="job:open"][data-id="c1"]'); await sleep(40);
  ok(/Confirmed: Dee/.test(A.$('#sheet').textContent) && /Waiting on: Marcus/.test(A.$('#sheet').textContent), 'confirmation from the database shows on the sheet');
  const rb = A.$('[data-act="jm:remind"]');
  ok(rb && /Text Marcus a reminder/.test(rb.textContent), 'office can text the people who have not confirmed');
  A.click(rb); await sleep(60);
  ok(A.calls.fn.some((c) => c.body.action === 'remind' && c.body.jobId === 'c1'), 'reminder goes to the Edge Function');
  ok(/Reminder texted to 1 person/.test(A.$('#toast').textContent), 'office told it went out');
  A.click('[data-act="more:open"]'); await sleep(5); A.click('[data-act="more:go"][data-tab="settings"]'); await sleep(30);
  ok(A.$('input[data-s="comms.appUrl"]') && A.$('input[data-s="comms.appUrl"]').value === 'https://tally.example.com/', 'link in texts fills itself in from the hosted site');
  await sleep(400);
  const sw = A.calls.writes.filter((x) => x.row.path === 'org/settings').pop();
  ok(sw && sw.row.data.comms.appUrl === 'https://tally.example.com/', 'and is saved where the texts read it');

  // Marcus confirms; Dee's confirmation is kept
  const db = seed();
  const B = await load(FILE, { db, org: ORG, me: { uid: 'u-marcus', email: 'm@x' } });
  ok(/Confirm your jobs/.test(B.$('#view').textContent), 'Marcus opens the app to his job to confirm');
  B.click('[data-act="jm:confirm"][data-id="c1"]'); await sleep(500);
  const row = db.docs.find((d) => d.path === 'jobs/c1');
  ok(row.data.confirm.Marcus && row.data.confirm.Marcus.for === day(1) + ' 08:00' && row.data.confirm.Dee && row.data.confirm.Dee.ts === 5, 'database has Marcus’s confirmation and still has Dee’s');
  // the office books Marcus on another job from another device
  const c2 = JSON.parse(JSON.stringify(db.docs.find((d) => d.path === 'jobs/c2')));
  c2.data.assign.crew = ['Dee', 'Marcus'];
  await B.w.__sb.from('docs').upsert(c2); await sleep(700);
  ok(/New job: Nadia Farouk tomorrow\. Confirm it in Job messages\./.test(B.$('#toast').textContent), 'a new booking pops up in the app: ' + B.$('#toast').textContent);
  ok(/Nadia Farouk/.test(B.$('#view').textContent), 'and lands on his Today screen');
  ok(B.calls.fn.filter((c) => c.body.action === 'job').length === 0, 'confirming sends no schedule texts');
  ok(A.errors.length === 0 && B.errors.length === 0, 'no errors (' + A.errors.concat(B.errors).slice(0, 3).join(' | ') + ')');
  process.exit(summary('confirm-hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
