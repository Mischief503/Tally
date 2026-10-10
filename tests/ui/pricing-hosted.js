// Hosted edition: the radius is the company's own setting, and the final bill of a mileage move
// (miles driven, the clock line, the office's corrections) reaches every phone through the database.
const { load, ok, sleep, summary } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html', ORG = 'org-1', H = 36e5;
const t0 = Date.now() - 10 * H;
function seed() {
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  put('meta/init', { ts: 1 });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }], contacts: {}, trucks: [{ id: 't20', name: 'Box 2', cf: 1000 }],
    forms: [{ id: 'f1', title: 'Delivery receipt', kind: 'text', required: true, text: 'I accept.', pageIds: [] }] });
  // a mileage move quoted at 6.5 h and 110 mi ($1,120), loaded in 4 h and unloaded in 3 h
  put('jobs/m1', { id: 'm1', status: 'active', createdAt: t0 - 864e5, startedAt: t0,
    phases: { loadStart: t0 + 0.5 * H, loadEnd: t0 + 4.5 * H, unloadStart: t0 + 6.5 * H, unloadEnd: t0 + 9.5 * H },
    d: { name: 'Long haul', phone: '', email: '', source: 'Google', moveDate: '', time: '08:00', from: 'Austin', to: 'Waco', miles: '110', milesOut: '', milesBack: '', flights: '', pack: false, crew: '2', truckId: '', hoursOverride: '', discount: '', notes: '', custom: {}, items: [{ id: 'boxm', q: 190 }], moveKind: '' },
    quote: { cf: 570, count: 190, lbs: 3990, crew: 2, hours: 6.5, truckId: 't20', truckName: 'Box 2', truckCf: 1000, nTrucks: 1, pct: 0.57, total: 1120, nte: 1290, deposit: 280,
      lines: [{ label: '2 movers, 6.5 hr loading and unloading at $140/hr', amt: 910, k: 'hours' }, { label: 'Truck and fuel', amt: 45, k: 'fixed' }, { label: 'Mileage: 110 mi at $1.50/mi', amt: 165, k: 'miles' }],
      kind: 'mileage', rate: 140, miles: 110, mileRate: 1.5, fixed: 45, taxPct: 0, minHours: 3, shopTravel: false, backH: 0 },
    items: [{ id: 'boxm', name: 'Medium box', cf: 3, qty: 190 }], assign: { truckId: 't20', crew: ['Marcus', 'Dee'] }, tally: {},
    payments: {}, signed: { s1: { id: 's1', formId: 'f1', title: 'Delivery receipt', name: 'Long haul', sig: '', ts: t0 + 9.6 * H, by: 'Marcus' } }, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} });
  // a local move with all four taps, to undo one
  const m2 = JSON.parse(JSON.stringify(docs.find((r) => r.path === 'jobs/m1').data));
  Object.assign(m2, { id: 'm2', d: Object.assign(m2.d, { name: 'Undo me', miles: '8' }), signed: {} });
  Object.assign(m2.quote, { kind: 'local', miles: 0, hours: 3, total: 465, nte: 535, lines: [] });
  put('jobs/m2', m2);
  return { docs, access_requests: [], comm_log: [], comm_lines: [],
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-marcus', email: 'm@x', staff: 'Marcus', role: 'lead', ts: 1 }] };
}
const row = (db, path) => db.docs.find((r) => r.path === path).data;
(async () => {
  const db = seed();
  // ---- Marcus, the lead, on his phone
  const M = await load(FILE, { db, org: ORG, me: { uid: 'u-marcus', email: 'm@x' } });
  const go = async (P, tab) => { P.click('[data-act="more:open"]'); await sleep(5); P.click('[data-act="more:go"][data-tab="' + tab + '"]'); await sleep(20); };
  if (M.$('[data-act="tab"][data-tab="crew"]')) { M.click('[data-act="tab"][data-tab="crew"]'); await sleep(20); } else await go(M, 'crew');
  const md = M.$('[data-mdrive="m1"]');
  ok(!!md && M.T.state().ui.role === 'lead', 'the lead sees the Miles driven box on the mileage move');
  md.value = '120'; md.dispatchEvent(new M.w.Event('change', { bubbles: true })); await sleep(400);
  let pw = M.calls.writes.filter((x) => x.op === 'patch' && x.row.path === 'jobs/m1');
  ok(pw.some((x) => x.patch.milesDriven === 120) && row(db, 'jobs/m1').milesDriven === 120, 'the miles reach the database');
  M.click('[data-act="cr:finish"][data-id="m1"]'); await sleep(500);
  const J = row(db, 'jobs/m1');
  ok(J.status === 'done' && J.extras.clock && J.extras.clock.amt === 85 && J.clockAt > 0, 'finished: the clock line (+$85) and status reach the database');
  ok(J.extras.clock.label === 'By the clock: 7h 0m loading and unloading, billed 7 h, 120 mi driven (quoted 6.5 h, 110 mi)', 'with its label: ' + J.extras.clock.label);
  ok(J.quote.total === 1120 && !pw.concat(M.calls.writes.filter((x) => x.op === 'patch')).some((x) => x.patch.quote), 'the lead never writes the quote (the database keeps the quote the office\'s)');

  // ---- the owner on another phone: the same bill
  const O = await load(FILE, { db, org: ORG, me: { uid: 'u-owner', email: 'o@x' } });
  const oj = O.T.state().jobs.find((x) => x.id === 'm1');
  ok(oj && oj.milesDriven === 120 && oj.clockAt === J.clockAt && Math.abs(oj.quote.total + oj.extras.reduce((a, e) => a + e.amt, 0) - 1205) < 0.01, 'the office phone reads 120 mi and a $1,205 bill');
  O.click('[data-act="tab"][data-tab="jobs"]'); await sleep(15);
  O.click('[data-act="job:open"][data-id="m1"]'); await sleep(30);
  ok(/120 mi driven, from the crew\. Bill \$1,205 \(\+\$85 on the quote\)\./.test(O.$('#sheet').textContent), 'its job sheet explains the bill');
  O.$('#clkH_m1').value = '6'; O.click('[data-act="clk:set"][data-id="m1"]'); await sleep(400);
  ok(row(db, 'jobs/m1').clockFix && row(db, 'jobs/m1').clockFix.hours === 6 && row(db, 'jobs/m1').extras.clock.amt === -55, 'the office sets 6 h: saved with the new line (−$55)');
  O.click('[data-act="clk:reset"][data-id="m1"]'); await sleep(400);
  const cf = row(db, 'jobs/m1').clockFix;
  ok(cf && cf.hours == null && cf.miles == null && row(db, 'jobs/m1').extras.clock.amt === 85, 'back to the clock: the correction is cleared in the database too');
  // the lead clears the miles: the empty value is saved, so the other phone clears it as well
  if (M.$('[data-mdrive="m1"]')) {
    const md2 = M.$('[data-mdrive="m1"]'); md2.value = ''; md2.dispatchEvent(new M.w.Event('change', { bubbles: true })); await sleep(400);
    ok(row(db, 'jobs/m1').milesDriven === '' && row(db, 'jobs/m1').extras.clock.amt === 70, 'miles cleared: saved as empty, and the bill goes back to the quoted 110 mi (+$70)');
  } else ok(false, 'the finished job still shows the miles box to the lead');
  // ---- two phones changed the job at once: the bill line is worked out again from what's in the database
  const md3 = M.$('[data-mdrive="m1"]'); md3.value = '120'; md3.dispatchEvent(new M.w.Event('change', { bubbles: true })); await sleep(400);
  ok(row(db, 'jobs/m1').extras.clock.amt === 85 && row(db, 'jobs/m1').clockSig === M.T.clockSig(M.T.state().jobs.find((x) => x.id === 'm1')), 'the lead puts 120 mi back: +$85, saved with what it was worked out from');
  // meanwhile another office phone re-quoted the move at 100 mi ($1,105); the server merged both changes
  const srv = row(db, 'jobs/m1');
  srv.quote = Object.assign({}, srv.quote, { miles: 100, total: 1105, nte: 1275, lines: [srv.quote.lines[0], srv.quote.lines[1], { label: 'Mileage: 100 mi at $1.50/mi', amt: 150, k: 'miles' }] });
  O.w.__sb.__fire('docs', { collection: 'jobs', path: 'jobs/m1' }); await sleep(700);
  const fixed = row(db, 'jobs/m1');
  ok(fixed.extras.clock.amt === 100 && fixed.quote.total + Object.values(fixed.extras).reduce((a, e) => a + e.amt, 0) === 1205, 'the office phone sees the line was worked out against the old quote and fixes it: $1,105 + $100 = $1,205 (7 h, 120 mi)');
  ok(Object.values(fixed.log).some((l) => /\(worked out again\)$/.test(l.ev)), 'and says so in the job history');
  const n0 = O.calls.writes.filter((x) => x.op === 'patch' && x.row.path === 'jobs/m1').length;
  O.w.__sb.__fire('docs', { collection: 'jobs', path: 'jobs/m1' }); await sleep(700);
  ok(O.calls.writes.filter((x) => x.op === 'patch' && x.row.path === 'jobs/m1').length === n0, 'once it matches, nothing more is written (no back-and-forth)');
  // ---- an undone tap reaches the database
  const undo = M.$('[data-act="cr:phaseundo"][data-id="m2"]');
  ok(!!undo, 'the lead can undo the last tap on the open job');
  M.click(undo); await sleep(500);
  ok(row(db, 'jobs/m2').phases && !('unloadEnd' in row(db, 'jobs/m2').phases) && row(db, 'jobs/m2').phases.unloadStart > 0, 'Undo removes "Done unloading" in the database too');
  await sleep(300);
  ok(!M.T.state().jobs.find((x) => x.id === 'm2').phases.unloadEnd && /Done unloading/.test((M.$('.crewcard [data-id="m2"].primary') || {}).textContent || ''), 'and it stays undone after the database echoes it back');
  // ---- the radius is each company's own: it is saved with the company's settings
  await go(O, 'settings');
  const rad = O.$('input[data-s="includedMiles"]');
  rad.value = '35'; rad.dispatchEvent(new O.w.Event('input', { bubbles: true })); await sleep(500);
  const sw = O.calls.writes.filter((x) => x.row.path === 'org/settings').pop();
  ok(sw && sw.row.data.includedMiles === 35, 'the 35-mile radius is saved with the company, so every phone quotes with it');
  ok(M.errors.length === 0 && O.errors.length === 0, 'no errors (' + M.errors.concat(O.errors).slice(0, 3).join(' | ') + ')');
  process.exit(summary('pricing hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
