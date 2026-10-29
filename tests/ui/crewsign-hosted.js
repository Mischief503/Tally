// The hosted app: a crew lead who starts a job short, or puts in someone leaving, has the server text the office
// (Richie, Oct 25: "a short crew should alert the office"); the office's own changes text nobody; and the customer's
// signature for a bigger crew, and that the job asks for it, are in the shared copy.
const { load, ok, sleep, summary } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html', ORG = 'org-1';
const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const quote = (crew, rate) => ({ cf: 400, count: 30, crew, hours: 4, truckId: 't16', nTrucks: 1, lines: [{ label: crew + ' movers, 4 hr at $' + rate + '/hr', amt: 4 * rate, k: 'hours' }, { label: 'Truck and fuel', amt: 45, k: 'fixed' }],
  total: 4 * rate + 45, nte: Math.ceil((4 * rate + 45) * 1.15 / 5) * 5, deposit: 0, kind: 'local', rate, miles: 0, mileRate: 1.5, fixed: 45, taxPct: 0, minHours: 3, flat: false, shopTravel: false, backH: 0, capNte: true, driveH: 0 });
function job(id, name, q, crew) {
  return { id, status: 'booked', createdAt: 1, d: { name, phone: '512-555-0110', moveDate: today, time: '08:00', from: '1502 E 6th, Austin', to: '34 Barton Hills Dr, Austin', items: [{ id: 'sofa3', q: 1 }], custom: {} },
    quote: q, items: [], assign: { truckId: 't16', crew }, tally: {}, payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} };
}
function seed() {
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  put('meta/init', { ts: 1 });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Kim', 'Dee', 'Luis'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
    contacts: { Owner: '512-555-0100', Marcus: '512-555-0101' }, rates: { r2: 140, r3: 195, r4: 250 }, trucks: [{ id: 't16', name: 'Van (16 ft)', cf: 800 }], forms: [], opt: { clock: false, eta: false } });
  put('jobs/s1', job('s1', 'Hollis & Reed Law', quote(3, 195), ['Marcus', 'Kim']));
  put('jobs/b1', job('b1', 'Nadia Farouk', quote(2, 140), ['Marcus', 'Kim', 'Dee']));
  return { docs, access_requests: [], comm_log: [], comm_lines: [{ org_id: ORG, phone_number: '+15125550000', enabled: true }],
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-marcus', email: 'm@x', staff: 'Marcus', role: 'lead', ts: 1 }] };
}

(async () => {
  const db = seed();
  const reply = (b) => (b.action === 'short' ? { ok: true, sent: 2 } : { ok: true, sent: 0 });
  const A = await load(FILE, { db, org: ORG, me: { uid: 'u-marcus', email: 'm@x' }, fnReply: reply });
  const { w, $, $$, click, openCard } = A;
  const row = (id) => db.docs.find((d) => d.path === 'jobs/' + id).data;
  const shorts = () => A.calls.fn.filter((c) => c.body.action === 'short');
  const card = (id) => $('#view [data-job="' + id + '"]');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  ok(w.tallyComms && w.tallyComms.number() === '+15125550000', 'hosted: the company line is on');

  /* ---------------- Marcus starts Hollis & Reed short ---------------- */
  await openCard('s1');
  ok(/Short crew: 2 on the job, quoted for 3\. The bill is for 2\./.test(card('s1').textContent), 'his card says the crew is short');
  click(card('s1').querySelector('[data-act="cr:start"]')); await sleep(20);
  ok(!$('#start').hidden && /The office gets a text when you start\./.test($('#start').textContent), 'the start screen: the office gets a text');
  A.calls.fn.length = 0;
  click('#start [data-act="go:start"]'); await sleep(1200);
  ok(row('s1').status === 'active' && row('s1').crewAsk === 1, 'started, in the shared copy, asking for a bigger crew’s signature from now on');
  ok(shorts().length === 1 && shorts()[0].body.jobId === 's1', 'the server is asked to text the office (' + A.calls.fn.map((c) => c.body.action).join(', ') + ')');
  ok(toast() === 'The office has been texted that the crew is short.', 'and the lead is told: ' + toast());

  /* ---------------- Kim leaves: down to 1 ---------------- */
  await openCard('s1');
  click(card('s1').querySelector('.cc-movers [data-act="mv:open"]')); await sleep(10);
  click('#mover [data-act="mv:mode"][data-m="left"]'); await sleep(8);
  click($$('#mover [data-act="mv:pick"]').find((b) => b.dataset.n === 'Kim')); await sleep(8);
  A.calls.fn.length = 0;
  click('#mover [data-act="mv:save"]'); await sleep(1200);
  ok(shorts().length === 1, 'Kim put in as leaving: the office is texted again (the server decides if it’s news)');

  /* ---------------- not short: nothing asked ---------------- */
  // Nadia Farouk: 2 quoted, 3 on it, so Marcus gets her signature for the bigger crew before loading (not at Start job)
  await openCard('b1');
  click(card('b1').querySelector('[data-act="cr:start"]')); await sleep(20);
  ok($('#flow').hidden && !$('#start').hidden, 'Nadia Farouk, 3 on a 2-man move: Start job asks nothing (the crew isn’t with her yet)');
  A.calls.fn.length = 0;
  click('#start [data-act="go:start"]'); await sleep(1200);
  ok(row('b1').status === 'active' && row('b1').crewAsk === 1 && !Object.values(row('b1').signed || {}).some((x) => x.formId === 'crew:3'), 'started, in the shared copy: asking for her signature, not signed yet');
  await openCard('b1');
  click(card('b1').querySelector('[data-act="cr:phase"][data-k="loadStart"]')); await sleep(20);
  ok(!$('#flow').hidden && /Bigger crew: 3 movers/.test($('#flow').textContent), 'Start loading: she signs first');
  $('#sigName').value = 'Nadia Farouk'; $('#sigAgree').checked = true; $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  click('#flow [data-act="flow:sign"]'); await sleep(1200);
  const sg = Object.values(row('b1').signed || {}).find((x) => x.formId === 'crew:3') || {};
  ok(row('b1').phases && row('b1').phases.loadStart > 0 && sg.n === 3 && sg.rate === 195 && sg.name === 'Nadia Farouk' && sg.by === 'Marcus', 'her signature for 3 movers at $195/hr is in the shared copy, with the job’s forms, and loading started');
  ok(shorts().length === 0, 'a crew bigger than quoted texts nobody');
  ok(A.errors.length === 0, 'hosted lead: no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- the office takes someone off a running job: no text from its phone ---------------- */
  const B = await load(FILE, { db, org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: reply });
  await sleep(300);
  B.T.ui.jobId = 'b1'; B.T.render(); await sleep(15);
  B.calls.fn.length = 0;
  B.click(B.$$('#sheet [data-act="sh:crew"]').find((b) => b.dataset.n === 'Dee')); await sleep(5);
  B.click(B.$$('#sheet [data-act="sh:crew"]').find((b) => b.dataset.n === 'Kim')); await sleep(1200);
  const bj = B.T.state().jobs.find((j) => j.id === 'b1');
  ok(B.T.billCrewAt(bj, Date.now()) === 1 && B.calls.fn.filter((c) => c.body.action === 'short').length === 0, 'the office takes Dee and Kim off: it knows, so no text (' + B.calls.fn.map((c) => c.body.action).join(', ') + ')');
  ok(B.errors.length === 0, 'hosted office: no errors (' + B.errors.slice(0, 3).join(' | ') + ')');

  process.exit(summary('crewsign-hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
