// A new quote on site, on the hosted app: only the office may change a job's quote there, so a crew lead's signed
// quote goes to the Edge Function (action "requote"), which saves it (tests/function/requote.ts). No signal: it's
// kept on the phone and sent again. The office's own phones save theirs directly.
const { load, ok, sleep, summary } = require('./lib');
const fs = require('fs');
const FILE = __dirname + '/../../build/tally-supabase.html', ORG = 'org-1';
const fx = JSON.parse(fs.readFileSync(__dirname + '/../function/rq-fixtures.json', 'utf8'));
const base = fx.cases.find((f) => f.job.d.items.every((x) => (f.settings.catalog || fx.defaults.catalog).some((c) => c.id === x.id)) && !f.expect.q.flat);
const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const money = (n) => { n = Math.round(n * 100) / 100; const whole = Math.abs(n - Math.round(n)) < 0.005; return '$' + (whole ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
const clone = (o) => JSON.parse(JSON.stringify(o));
function seed(opt) {
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  put('meta/init', { ts: 1 });
  put('org/settings', Object.assign(clone(base.settings), { company: 'Ace Moving', crew: ['Marcus', 'Dee'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
    contacts: { Owner: '512-555-0100', Dispatch: '512-555-0199', Marcus: '512-555-0101', Dee: '512-555-0102' }, forms: [], opt: Object.assign({}, base.settings.opt, opt || {}) }));
  const job = Object.assign(clone(base.job), { id: 'c1', status: 'booked', assign: { truckId: base.job.assign.truckId, crew: ['Marcus', 'Dee'] },
    payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} });
  job.d = Object.assign(job.d, { name: 'Priya Nair', phone: '512-555-0142', moveDate: today, time: '08:00', from: '418 Oak St', to: '77 Ridge Rd' });
  put('jobs/c1', job);
  return { docs, access_requests: [], comm_log: [], comm_lines: [],
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-marcus', email: 'm@x', staff: 'Marcus', role: 'lead', ts: 1 }] };
}
// a phone's signature pad that draws (jsdom has no canvas): a real signature is tens of kilobytes
const BIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(7000);
const canvas = (w) => {
  const g = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  w.HTMLCanvasElement.prototype.getContext = () => g;
  w.HTMLCanvasElement.prototype.toDataURL = () => BIG;
};

(async () => {
  /* ---------------- Marcus, the crew lead: the server saves it ---------------- */
  let reply = () => ({ ok: true, total: base.expect.q.total, message: 'The new quote is on the job.' });
  const db = seed();
  const A = await load(FILE, { db, org: ORG, me: { uid: 'u-marcus', email: 'm@x' }, setup: canvas, fnReply: (b) => (b.action === 'requote' ? reply(b) : { ok: true, sent: 0 }) });
  const { w, $, $$, click, T } = A;
  const card = () => $('#view [data-job="c1"]');
  const btn = () => card() && card().querySelector('[data-act="rq:open"]:not([data-step])');
  const tap = async (sel, ms) => { click(sel); await sleep(ms || 10); };
  const sign = async () => { $('#sigAgree').checked = true; $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); await tap('#rq [data-act="rq:sign"]', 60); };
  const row = () => db.docs.find((d) => d.path === 'jobs/c1').data;
  const q0 = clone(row().quote);
  const make = async () => {
    await tap(btn(), 15);
    const first = base.dr.items[0].id;
    await tap('#rq [data-act="rq:inc"][data-id="' + first + '"]', 5);
    await tap('#rq [data-act="rq:step"][data-s="review"]', 10);
    await tap('#rq [data-act="rq:step"][data-s="sign"]', 10);
  };
  ok(!!btn(), 'hosted: Marcus has the new-quote button on his job');
  await make();
  const n0 = A.calls.fn.length;
  await sign();
  const call = A.calls.fn.slice(n0).find((c) => c.body.action === 'requote');
  const rq = call && call.body.rq;
  ok(!!call && call.body.jobId === 'c1' && call.body.org === ORG && rq.was === q0.total && rq.state === 'done' && rq.sig.name === 'Priya Nair' && rq.sig.img === BIG && rq.by === 'Marcus', 'signed: it goes to the server, with the customer’s signature');
  ok(Array.isArray(rq.d.items) && rq.d.items.every((x, i, a) => !i || a[i - 1].id < x.id) && rq.quote && rq.quote.total > 0 && rq.quote.rate === q0.rate, 'with the items (as a list) and the new quote worked out on the phone');
  ok(call.init.keepalive === false && JSON.stringify(call.body).length > 64000, 'a big signature isn’t sent the closing-page way (phones drop those over 64 KB)');
  ok(A.calls.fn.some((c) => c.body.action !== 'requote' && c.init.keepalive === true) || A.calls.fn.filter((c) => c.body.action !== 'requote').every((c) => JSON.stringify(c.body).length < 60000), 'small requests still are');
  ok(row().quote.total === q0.total && !A.calls.writes.some((x) => x.op === 'patch' && x.patch && x.patch.quote), 'the phone doesn’t try to change the quote itself (the server does)');
  ok(/^The new quote is on the job/.test($('#rq .flow-body').textContent) && /The office has been told\./.test($('#toast').textContent), 'the server said yes: “The new quote is on the job”');
  await tap('#rq [data-act="rq:exit"]', 20);

  /* ---------------- no signal: kept on the phone, and sent again ---------------- */
  reply = () => ({ ok: false, message: 'Could not reach the server. Check your connection.' });
  await make();
  await sign();
  const pend = (T.state().ui.rqPend || {}).c1;
  ok(!!pend && pend.sig.name === 'Priya Nair' && /^Signed/.test($('#rq h2').textContent) && /kept here and sent as soon as there’s signal/.test($('#rq .flow-body').textContent), 'no connection: “Signed”, kept on the phone to send');
  await tap('#rq [data-act="rq:exit"]', 20);
  const pn = card().querySelector('.rqnote');
  ok(!!pn && /The new quote is signed but not saved yet/.test(pn.textContent) && !!pn.querySelector('[data-act="rq:retry"]') && !btn(), 'the card says it isn’t saved yet, with “Try again now”, and no second new quote meanwhile');
  const n1 = A.calls.fn.length;
  await tap(pn.querySelector('[data-act="rq:retry"]'), 60);
  ok(A.calls.fn.slice(n1).some((c) => c.body.action === 'requote' && c.body.rq.id === pend.id) && !!(T.state().ui.rqPend || {}).c1 && /Still no connection/.test($('#toast').textContent), 'Try again, still no signal: it stays, and says so');
  reply = () => ({ ok: true, total: pend.quote.total, message: 'The new quote is on the job.' });
  await tap(card().querySelector('[data-act="rq:retry"]'), 80);
  ok(!(T.state().ui.rqPend || {}).c1 && /The new quote for Priya Nair is saved/.test($('#toast').textContent) && !card().querySelector('[data-act="rq:retry"]'), 'with signal: the same quote goes, and the note goes away');
  // back online sends it by itself
  reply = () => ({ ok: false, message: 'Could not reach the server. Check your connection.' });
  await make(); await sign(); await tap('#rq [data-act="rq:exit"]', 20);
  reply = () => ({ ok: true, total: 1, message: 'The new quote is on the job.' });
  const n2 = A.calls.fn.length;
  w.dispatchEvent(new w.Event('online')); await sleep(80);
  ok(A.calls.fn.slice(n2).some((c) => c.body.action === 'requote') && !(T.state().ui.rqPend || {}).c1, 'the phone back online sends it on its own');

  /* ---------------- the server says no ---------------- */
  reply = () => ({ ok: false, final: true, message: 'The quote on this job changed while the new one was being made. Make the new quote again.' });
  await make(); await sign();
  ok($('#rq').dataset.step === 'sign' && $('#rqErr').textContent === 'The quote on this job changed while the new one was being made. Make the new quote again.' && !(T.state().ui.rqPend || {}).c1 && !$('#rq [data-act="rq:sign"]').disabled, 'refused: it says why, right there, and nothing is kept to send again');
  await tap('#rq [data-act="rq:exit"]', 20); if (!$('#rq').hidden) await tap('#rq [data-act="rq:leave"]', 20);

  ok(A.errors.length === 0, 'hosted lead: no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- Office approves: the lead's phone sends it to the office, not the server ---------------- */
  const db2 = seed({ rqOffice: true });
  const B = await load(FILE, { db: db2, org: ORG, me: { uid: 'u-marcus', email: 'm@x' }, setup: canvas, fnReply: () => ({ ok: true, sent: 0 }) });
  const bcard = () => B.$('#view [data-job="c1"]');
  B.click(bcard().querySelector('[data-act="rq:open"]')); await sleep(15);
  B.click('#rq [data-act="rq:inc"][data-id="' + base.dr.items[0].id + '"]'); await sleep(5);
  B.click('#rq [data-act="rq:step"][data-s="review"]'); await sleep(10);
  B.click('#rq [data-act="rq:send"]'); await sleep(600);
  const r2 = db2.docs.find((d) => d.path === 'jobs/c1').data;
  ok(r2.rq && r2.rq.state === 'waiting' && r2.rq.by === 'Marcus' && r2.quote.total === q0.total && !B.calls.fn.some((c) => c.body.action === 'requote'), 'office approval on: the new quote waits on the job for the office, and the quote is unchanged');
  ok(B.errors.length === 0, 'hosted approval: no errors (' + B.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- the owner's own phone saves it directly ---------------- */
  const db3 = seed();
  const C = await load(FILE, { db: db3, org: ORG, me: { uid: 'u-owner', email: 'o@x' }, setup: canvas, fnReply: () => ({ ok: true, sent: 0 }) });
  C.T.state().ui.me = 'Marcus'; C.T.ui.tab = 'crew'; C.T.render(); await sleep(10);   // the owner, on Field view, looking at Marcus's day
  const ob = C.$('#view [data-job="c1"] [data-act="rq:open"]');
  ok(!!ob, 'the owner, on Field view, can make one too');
  C.click(ob); await sleep(15);
  C.click('#rq [data-act="rq:inc"][data-id="' + base.dr.items[0].id + '"]'); await sleep(5);
  C.click('#rq [data-act="rq:step"][data-s="review"]'); await sleep(10);
  C.click('#rq [data-act="rq:step"][data-s="sign"]'); await sleep(10);
  C.$('#sigAgree').checked = true; C.$('#sigPad').dispatchEvent(new C.w.MouseEvent('pointerdown', { bubbles: true }));
  C.click('#rq [data-act="rq:sign"]'); await sleep(700);
  const r3 = db3.docs.find((d) => d.path === 'jobs/c1').data;
  const was1 = (base.job.d.items.find((x) => x.id === base.dr.items[0].id) || { q: 0 }).q;
  ok(!C.calls.fn.some((c) => c.body.action === 'requote') && r3.d.items.find((x) => x.id === base.dr.items[0].id).q === was1 + 1 && r3.quote.cf > q0.cf && r3.rq.state === 'done' && Array.isArray(r3.quoteHist) && r3.quoteHist.length === 1 && r3.quoteHist[0].sign.img === BIG && Array.isArray(r3.quoteHist[0].wasD.items), 'the office’s phone saves the new quote itself (' + money(q0.total) + ' → ' + money(r3.quote.total) + '), with the history');
  ok(C.errors.length === 0, 'hosted office: no errors (' + C.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- the office's phone is told, and the lead's phone hears back ---------------- */
  const db4 = seed({ rqOffice: true });
  const D = await load(FILE, { db: db4, org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: () => ({ ok: true, sent: 0 }) });
  const E = await load(FILE, { db: db4, org: ORG, me: { uid: 'u-marcus', email: 'm@x' }, fnReply: () => ({ ok: true, sent: 0 }) });
  await sleep(300);
  const nq = Object.assign(clone(q0), { total: q0.total + 200 });
  // a change saved on one phone reaches both (each test phone hears its own store's changes)
  const put = async (X, f) => { const r = clone(db4.docs.find((d) => d.path === 'jobs/c1')); f(r.data); await D.w.__sb.from('docs').upsert(r); await E.w.__sb.from('docs').upsert(clone(r)); await sleep(700); };
  const rq4 = { id: 'rqx', by: 'Marcus', ts: Date.now(), was: q0.total, d: { items: [], flights: '', pack: false, hoursOverride: '' }, quote: nq, items: [], note: 'Garage', changes: ['+1 Upright piano'], state: 'waiting', sig: null, ok: null, no: null, seen: null, applied: null, refused: null, cancel: null };
  await put(E, (d) => { d.rq = clone(rq4); });
  ok(D.$('#toast').textContent === 'Marcus made a new quote for Priya Nair: ' + money(nq.total) + ' (was ' + money(q0.total) + '). It’s waiting for you to approve it.', 'the office’s phone is told: ' + D.$('#toast').textContent);
  ok(D.$$('#view .alert').some((a) => /New quote to approve: Priya Nair/.test(a.textContent)), 'and it’s on the office’s Today');
  ok(!/made a new quote/.test(E.$('#toast').textContent), 'Marcus’s own phone isn’t told about his own new quote');
  await put(D, (d) => { d.rq.state = 'approved'; d.rq.ok = { by: 'Owner', ts: Date.now() }; d.quote.rqOk = { id: 'rqx', total: nq.total, key: 'k', by: 'Owner', ts: Date.now() }; });
  ok(E.$('#toast').textContent === 'Owner approved the new quote for Priya Nair. Have the customer sign it.', 'Marcus’s phone hears it was approved: ' + E.$('#toast').textContent);
  ok(!!E.$('#view [data-job="c1"] [data-act="rq:open"][data-step="sign"]'), 'and his card has “The customer signs”');
  await put(E, (d) => { d.rq.state = 'done'; d.rq.sig = { name: 'Priya Nair', ts: Date.now() }; d.quote = clone(nq); });
  ok(D.$('#toast').textContent === 'Marcus made a new quote for Priya Nair: ' + money(nq.total) + ' (was ' + money(q0.total) + '), signed by Priya Nair.', 'the office’s phone is told when the customer signs: ' + D.$('#toast').textContent);
  await put(D, (d) => { d.rq = Object.assign(clone(rq4), { id: 'rqy', state: 'declined', no: { by: 'Dispatch', ts: Date.now(), why: 'Call me' } }); });
  ok(E.$('#toast').textContent === 'Dispatch didn’t approve the new quote for Priya Nair.', 'and when the office doesn’t approve one: ' + E.$('#toast').textContent);
  ok(D.errors.length === 0 && E.errors.length === 0, 'two phones: no errors (' + D.errors.concat(E.errors).slice(0, 3).join(' | ') + ')');
  process.exit(summary('requote-hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
