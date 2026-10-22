// Movers joining or leaving on site, on the hosted app: the lead's phone saves the change to the shared copy (keyed by
// id, so two phones can each add one), and another phone that gets a finished job whose bill was worked out before a
// change works the bill out again.
const { load, ok, sleep, summary } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html', ORG = 'org-1';
const H = 36e5, now = Date.now(), t0 = now - 5 * H;
const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const clone = (o) => JSON.parse(JSON.stringify(o));
const quote = { cf: 193, count: 18, crew: 2, hours: 3, truckId: 't16', nTrucks: 1, lines: [{ label: '2 movers, 3 hr at $140/hr', amt: 420, k: 'hours' }, { label: 'Truck and fuel', amt: 45, k: 'fixed' }, { label: 'Stairs: 2 flights', amt: 50, k: 'fixed' }],
  total: 515, nte: 595, deposit: 129, kind: 'local', rate: 140, miles: 0, mileRate: 1.5, fixed: 95, taxPct: 0, minHours: 3, flat: false, shopTravel: false, backH: 0, capNte: true, driveH: 0 };
function seed(extra) {
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  put('meta/init', { ts: 1 });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Kim', 'Dee', 'Luis'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
    contacts: { Owner: '512-555-0100', Marcus: '512-555-0101' }, rates: { r2: 140, r3: 195, r4: 250 }, trucks: [{ id: 't16', name: 'Van (16 ft)', cf: 800 }], forms: [], opt: { clock: false } });
  put('jobs/n1', Object.assign({ id: 'n1', status: 'active', createdAt: 1, startedAt: t0, phases: { loadStart: t0 },
    d: { name: 'Nadia Farouk', phone: '512-555-0110', moveDate: today, time: '08:00', from: '1502 E 6th, Austin', to: '34 Barton Hills Dr, Austin', items: [{ id: 'sofa3', q: 1 }], custom: {} },
    quote: clone(quote), items: [], assign: { truckId: 't16', crew: ['Marcus', 'Kim'] }, tally: {}, crewOn: { Marcus: [{ in: t0, out: 0 }], Kim: [{ in: t0, out: 0 }] },
    payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} }, extra || {}));
  return { docs, access_requests: [], comm_log: [], comm_lines: [],
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-marcus', email: 'm@x', staff: 'Marcus', role: 'lead', ts: 1 }] };
}

(async () => {
  /* ---------------- the lead's phone ---------------- */
  const db = seed();
  const A = await load(FILE, { db, org: ORG, me: { uid: 'u-marcus', email: 'm@x' }, fnReply: () => ({ ok: true, sent: 0 }) });
  const { $, $$, click } = A;
  const row = () => db.docs.find((d) => d.path === 'jobs/n1').data;
  const ln = () => $('#view [data-job="n1"] .cc-movers');
  ok(!!ln() && /^Movers on the bill: 2 \(as quoted\)/.test(ln().textContent), 'hosted: Marcus’s card has the movers line');
  click(ln().querySelector('[data-act="mv:open"]')); await sleep(15);
  click($$('#mover [data-act="mv:pick"]').find((b) => b.dataset.n === 'Dee')); await sleep(10);
  click('#mover [data-act="mv:save"]'); await sleep(700);
  const adj = row().crewAdj || {}, ids = Object.keys(adj), e = adj[ids[0]] || {};
  ok(!Array.isArray(adj) && ids.length === 1 && e.id === ids[0] && e.who === 'Dee' && e.d === 1 && e.by === 'Marcus', 'the change is in the database, keyed by its id');
  ok(row().assign.crew.indexOf('Dee') >= 0 && row().crewRates && row().crewRates.r4 === 250 && (row().crewOn.Dee || []).length === 1, 'with Dee on the crew and on the job (no time clock here), and the rates');
  ok(A.calls.writes.some((w) => w.op === 'patch' && w.patch && w.patch.crewAdj && w.patch.crewAdj[ids[0]] && !w.patch.quote), 'saved as a patch of just that change (no quote)');
  ok(A.errors.length === 0, 'hosted lead: no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- another phone works a finished job's bill out again ---------------- */
  const ev = { id: 'e1', ts: t0 + 2 * H, d: 1, who: 'Dee', by: 'Marcus', at: t0 + 2 * H, added: true }, ev2 = Object.assign({}, ev, { id: 'e2', who: 'Luis' });
  const db2 = seed({ status: 'done', finishedAt: now, actualHours: 5, phases: { loadStart: t0, unloadEnd: now }, clockAt: now, clockSig: 'c1:before-the-crew-changed',
    extras: { clock: { id: 'clock', label: 'By the clock: 5h 0m on the job, billed 5 h (quoted 3 h), held to the not-to-exceed price', amt: 80, ts: now } },
    crewAdj: { e1: ev, e2: ev2 }, crewRates: { r2: 140, r3: 195, r4: 250 }, assign: { truckId: 't16', crew: ['Marcus', 'Kim', 'Dee', 'Luis'] } });
  const B = await load(FILE, { db: db2, org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: () => ({ ok: true, sent: 0 }) });
  await sleep(800);
  const r2 = db2.docs.find((d) => d.path === 'jobs/n1').data, ex = r2.extras || {};
  ok(ex['crew:0'] && ex['crew:0'].amt === 330 && /^4 movers from \d+:\d\d [AP]M, 3h 0m at \$250\/hr instead of \$140\/hr$/.test(ex['crew:0'].label) && ex.clock && ex.clock.amt === 80, 'the office’s phone works the bill out again: the crew line +$330 next to the clock’s +$80');
  ok(typeof r2.clockSig === 'string' && /\|m:\d+\+,\d+\+\/140,195,250$/.test(r2.clockSig), 'and saves the bill’s new signature, with the changes in it');
  B.T.ui.jobId = 'n1'; B.T.render(); await sleep(15);
  ok(/Movers on the bill: 2 \(as quoted\) · 4 from/.test(B.$('#sheet .sheet-body').textContent) && /Total\$925/.test(B.$('#sheet .sheet-body').textContent.replace(/\s+/g, '')), 'its sheet: the movers line and the $925 total');
  ok(B.errors.length === 0, 'hosted office: no errors (' + B.errors.slice(0, 3).join(' | ') + ')');
  process.exit(summary('movers-hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
