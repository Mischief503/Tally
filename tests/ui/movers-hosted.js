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
  const rr = (ex.clock && ex.clock.rows) || [];
  ok(!ex['crew:0'] && ex.clock && ex.clock.amt === 410 && rr.length === 5 && rr[0].label === '2 movers, 2 hr at $140/hr' && rr[0].amt === 280 && rr[1].label === '4 movers, 3 hr at $250/hr' && rr[1].amt === 750 && rr[4].amt === -200, 'the office’s phone works the bill out again: one line (+$410), with its rows: 2 movers 2 hr, then 4 movers 3 hr, held to $595 for the quote’s crew');
  ok(typeof r2.clockSig === 'string' && /^c2:.*\|n:2\|m:\d+\+,\d+\+\/140,195,250$/.test(r2.clockSig), 'and saves the bill’s new signature, with the changes in it');
  B.T.ui.jobId = 'n1'; B.T.render(); await sleep(15);
  ok(/Movers on the bill: 2 \(as quoted\) · 4 from/.test(B.$('#sheet .sheet-body').textContent) && /Billedbytheclock2movers,2hrat\$140\/hr.*\$2804movers,3hrat\$250\/hr.*\$750.*Bill\$925/.test(B.$('#sheet .sheet-body').textContent.replace(/\s+/g, '')), 'its sheet: the movers line, the hours of each crew and the $925 bill');
  // a phone on the version before writes the line again without rows: the rows left in the shared copy don't add up, so they don't show
  const oldLine = { id: 'clock', label: 'By the clock: 5h 0m on the job, billed 5 h (quoted 3 h), held to the not-to-exceed price', amt: 80, ts: now };
  const merged = JSON.parse(JSON.stringify(r2)); merged.extras.clock = Object.assign({}, r2.extras.clock, oldLine); merged.clockSig = 'c1:from-the-version-before';
  ok(Array.isArray(merged.extras.clock.rows) && B.T.clockRows(B.T.docToJob(merged)) === null, 'a line from the version before keeps the old rows in the shared copy (a patch merges), but they don’t add up to it, so they don’t show');
  merged.extras['crew:0'] = { id: 'crew:0', label: '4 movers from 9:00 AM, 3h 0m at $250/hr instead of $140/hr', amt: 330, ts: now };
  ok(B.T.clockRows(B.T.docToJob(merged)) === null && B.T.clockStale(B.T.docToJob(merged)), 'and with its crew line, the bill is worked out again when it comes in');
  ok(B.errors.length === 0, 'hosted office: no errors (' + B.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- a bill from before the rows, worked out again to the same line: it gets its rows ---------------- */
  // (the job's records are frozen copies of the shared one, so the line is replaced, not changed)
  const db3 = seed({ status: 'done', finishedAt: now, actualHours: 5, phases: { loadStart: t0, unloadEnd: now }, clockAt: now, clockSig: 'c1:two-phones-at-once',
    extras: { clock: { id: 'clock', label: 'By the clock: 5h 0m on the job, billed 5 h (quoted 3 h), held to the not-to-exceed price', amt: 80, ts: now } } });
  const C = await load(FILE, { db: db3, org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: () => ({ ok: true, sent: 0 }) });
  await sleep(800);
  const r3 = db3.docs.find((d) => d.path === 'jobs/n1').data, c3 = r3.extras.clock || {};
  ok(c3.amt === 80 && Array.isArray(c3.rows) && c3.rows.length === 4 && c3.rows[0].label === '2 movers, 5 hr at $140/hr' && c3.rows[3].amt === -200 && /^c1:/.test(r3.clockSig), 'the same $80 line, now with its rows (5 hr at $140/hr, the fees, held to $595), signed c1 as before');
  ok(C.errors.length === 0, 'and no errors (' + C.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- the bill follows the people put on the job (Oct 24) ---------------- */
  // a finished job billed for the 2 quoted on Build 43 (c4: held to the not-to-exceed price), and another phone has since
  // put Dee on its crew: the office's phone works the bill out again for the 3 on it, every hour (the price is a guide)
  const db4 = seed({ status: 'done', finishedAt: now, actualHours: 5, phases: { loadStart: t0, unloadEnd: now }, clockAt: now, clockSig: 'c4:before-dee-was-put-on',
    extras: { clock: { id: 'clock', label: 'By the clock: 5h 0m on the job, billed 5 h (quoted 3 h), held to the not-to-exceed price', amt: 80, ts: now } }, assign: { truckId: 't16', crew: ['Marcus', 'Kim', 'Dee'] } });
  const D = await load(FILE, { db: db4, org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: () => ({ ok: true, sent: 0 }) });
  await sleep(800);
  const r4 = db4.docs.find((d) => d.path === 'jobs/n1').data, c4 = (r4.extras || {}).clock || {}, rw4 = c4.rows || [];
  ok(c4.amt === 555 && rw4.length === 3 && rw4[0].label === '3 movers, 5 hr at $195/hr' && rw4[0].amt === 975 && !rw4.some((r) => r.k === 'cap'), 'hosted: a Build 43 bill another phone made before Dee was put on the crew is worked out again for the 3 on it, every hour, past the not-to-exceed price (+$555)');
  ok(/^c5:.*\|n:2\|c:\["Dee","Kim","Marcus"\]\|m:\[\]\/140,195,250$/.test(r4.clockSig) && r4.crewRates && r4.crewRates.r3 === 195, 'and saved with its signature (c5, the crew in it) and the Rate card it used');
  D.T.ui.jobId = 'n1'; D.T.render(); await sleep(15);
  ok(/Movers on the bill: 2 \(as quoted\) · 3 from the start/.test(D.$('#sheet .sheet-body').textContent) && /Bill\$1,070/.test(D.$('#sheet .sheet-body').textContent.replace(/\s+/g, '')) && /past the \$595 estimated top price/.test(D.$('#sheet .sheet-body').textContent), 'its sheet: 3 from the start, and the $1,070 bill, past the $595 not-to-exceed price');
  ok(D.errors.length === 0, 'and no errors (' + D.errors.slice(0, 3).join(' | ') + ')');

  // a crew that went out short ("if it was booked and quoted as a three man, but only two guys go out ... the bill is only
  // two"): a bill a phone on Build 42 made for the 3 quoted (signed c3) is worked out again for the 2 who went out
  const q3 = Object.assign(clone(quote), { crew: 3, rate: 195, total: 680, nte: 840, lines: [{ label: '3 movers, 3 hr at $195/hr', amt: 585, k: 'hours' }, { label: 'Truck and fuel', amt: 45, k: 'fixed' }, { label: 'Stairs: 2 flights', amt: 50, k: 'fixed' }] });
  const db5 = seed({ status: 'done', finishedAt: now, actualHours: 5, phases: { loadStart: t0, unloadEnd: now }, clockAt: now, clockSig: 'c3:billed-for-the-3-quoted', quote: q3,
    extras: { clock: { id: 'clock', label: 'By the clock: 5h 0m on the job, billed 5 h (quoted 3 h), held to the not-to-exceed price', amt: 160, ts: now } }, assign: { truckId: 't16', crew: ['Marcus', 'Kim'] } });
  const E = await load(FILE, { db: db5, org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: () => ({ ok: true, sent: 0 }) });
  await sleep(800);
  const r5 = db5.docs.find((d) => d.path === 'jobs/n1').data, c5 = (r5.extras || {}).clock || {}, rw5 = c5.rows || [];
  ok(rw5[0] && rw5[0].label === '2 movers, 5 hr at $140/hr' && rw5[0].amt === 700 && q3.total + c5.amt === 795 && /^c5:/.test(r5.clockSig), 'hosted: a Build 42 bill for the 3 quoted, when 2 went out, is worked out again: 2 movers at $140/hr, $795 (it was $840)');
  ok(E.errors.length === 0, 'and no errors (' + E.errors.slice(0, 3).join(' | ') + ')');
  process.exit(summary('movers-hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
