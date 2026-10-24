// A new quote on site (Richie, Oct 21: "if the crew shows up and the inventory is off . Then the lead show be able
// to go room for room entering items to make a new quote and then summit it to the dispatch for approval. Or maybe
// just have a place to sign by the customer so its approved by customer."). Customer signs by default; Options ›
// Office approves new quotes makes it wait for the office first.
// It also checks the app still prices the cases in tests/function/rq-fixtures.json the way they were written down;
// the server is checked against the same file (tests/function/requote.ts), so the two agree. After a pricing change
// on purpose: REGEN=1 node tests/ui/requote.js, then run both.
const { load, ok, sleep, summary } = require('./lib');
const fs = require('fs');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'requote';
const L = (m) => label + ': ' + m;
const FIX = __dirname + '/../function/rq-fixtures.json';
const money = (n) => { n = Math.round(n * 100) / 100; const whole = Math.abs(n - Math.round(n)) < 0.005; return '$' + (whole ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
const canon = (v) => v === null || v === undefined ? 'null' : typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';

function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// jobs priced on one rate card, the rate card changed after booking, and what's really moving
function cases(T) {
  const D = T.defaultSettings(), out = [], R = rng(20261021);
  const pick = (a) => a[Math.floor(R() * a.length)], int = (a, b) => a + Math.floor(R() * (b - a + 1)), chance = (p) => R() < p;
  for (let n = 0; out.length < 48 && n < 400; n++) {
    const S = JSON.parse(JSON.stringify(D));
    S.shopAddress = chance(0.6) ? '100 Shop Rd, Austin' : ''; S.shopTravel = chance(0.8);
    S.rates = { r2: pick([120, 140, 155]), r3: pick([180, 195, 210.5]), r4: pick([240, 250, 275]) };
    S.truckFee = pick([0, 45, 60, 72.5]); S.stairFee = pick([25, 30, 17.5]); S.packPerBox = pick([8, 7.5, 9.25]);
    S.taxPct = pick([0, 0, 8.25, 6]); S.ntePct = pick([15, 10, 20]); S.depositPct = pick([25, 30]); S.minHours = pick([2, 3, 4]); S.mileRate = pick([1.5, 2, 1.75]); S.includedMiles = pick([20, 30, 0]);
    S.opt = {};
    if (chance(0.2)) S.opt.truckFee = false; if (chance(0.15)) S.opt.stairs = false; if (chance(0.2)) S.opt.packing = false; if (chance(0.2)) S.opt.byClock = false;
    if (chance(0.15)) S.opt.deposit = false; if (chance(0.15)) S.opt.mileage = false; if (S.taxPct && chance(0.3)) S.opt.tax = false; if (chance(0.15)) S.nteCap = false;
    const d = { name: 'Case ' + n, items: {}, miles: String(int(3, 260)), milesOut: S.shopAddress ? String(int(1, 40)) : '', milesBack: S.shopAddress ? String(int(1, 40)) : '', flights: chance(0.5) ? String(int(1, 4)) : '', pack: chance(0.4),
      discount: chance(0.2) ? String(pick([25, 50, 100])) : '', crew: pick(['', '', '2', '3', '4']), truckId: pick(['', '', 't20', 't26', 't16']), hoursOverride: chance(0.25) ? String(pick([4, 5.5, 7, 9])) : '', moveKind: pick(['', '', 'local', 'mileage']), custom: {} };
    for (let i = int(2, 18); i > 0; i--) { const it = pick(S.catalog); d.items[it.id] = (d.items[it.id] || 0) + (it.cat === 'Boxes' ? int(1, 30) : int(1, 3)); }
    const q0 = T.calc(d, S);
    if (!q0.cf || !(q0.kind === 'local' || q0.kind === 'mileage')) continue;
    const job = { id: 'case' + n, status: pick(['booked', 'active']), createdAt: 1, d: Object.assign({}, d, { items: T.rqItemsArr(d.items) }), quote: q0,
      items: S.catalog.filter((it) => d.items[it.id] > 0).map((it) => ({ id: it.id, name: it.name, cf: it.cf, qty: d.items[it.id] })), assign: { truckId: pick(['', 't20', 't26']), crew: ['Marcus'] }, tally: {} };
    const S2 = JSON.parse(JSON.stringify(S));
    if (chance(0.7)) S2.rates = { r2: S.rates.r2 + 15, r3: S.rates.r3 + 20, r4: S.rates.r4 + 25 };
    if (chance(0.5)) S2.truckFee = S.truckFee + 10; if (chance(0.4)) S2.stairFee = S.stairFee + 5; if (chance(0.4)) S2.packPerBox = S.packPerBox + 1;
    if (chance(0.3)) S2.taxPct = S.taxPct ? 0 : 7; if (chance(0.3)) S2.ntePct = S.ntePct + 5; if (chance(0.3)) S2.minHours = S.minHours + 1; if (chance(0.2)) S2.prod = 50;
    if (chance(0.3)) S2.opt.byClock = S.opt.byClock === false; if (chance(0.25)) S2.opt.truckFee = S.opt.truckFee === false;
    if (chance(0.25)) S2.opt.stairs = S.opt.stairs === false; if (chance(0.25)) S2.opt.packing = S.opt.packing === false;
    if (chance(0.1)) { const gone = pick(Object.keys(d.items)); S2.catalog = S.catalog.filter((it) => it.id !== gone); }   // an item taken out of Setup since
    const items = {};
    Object.keys(d.items).forEach((id) => { if (S2.catalog.some((c) => c.id === id)) items[id] = d.items[id]; });
    for (let i = int(1, 6); i > 0; i--) { const it = pick(S2.catalog), v = (items[it.id] || 0) + (chance(0.65) ? int(1, it.cat === 'Boxes' ? 10 : 2) : -int(1, 3)); if (v > 0) items[it.id] = v; else delete items[it.id]; }
    if (!Object.keys(items).length) items.sofa3 = 1;
    out.push({ name: 'case ' + n + ' (' + q0.kind + (q0.flat ? ', flat' : '') + ')', settings: S2, job, dr: { items: T.rqItemsArr(items), flights: chance(0.3) ? int(0, 5) : (Number(d.flights) || 0), pack: chance(0.2) ? !d.pack : !!d.pack } });
  }
  return out;
}
// the new quote the app makes for a case
function expectOf(T, f) {
  T.state().settings = Object.assign(T.defaultSettings(), JSON.parse(JSON.stringify(f.settings)));
  const dr = { items: {}, flights: f.dr.flights, pack: f.dr.pack };
  f.dr.items.forEach((x) => { dr.items[x.id] = x.q; });
  const b = T.rqBuild(T.docToJob(f.job), dr), items = T.rqItemsArr(b.d.items);
  return { d: { items, flights: b.d.flights, pack: b.d.pack, hoursOverride: b.d.hoursOverride }, q: b.q, items: b.items, key: T.rqKey({ d: { items, flights: b.d.flights, pack: b.d.pack }, quote: b.q }) };
}
const PRICE_KEYS = ['rates', 'minHours', 'prod', 'mph', 'shopAddress', 'shopTravel', 'truckFee', 'includedMiles', 'mileRate', 'stairFee', 'packPerBox', 'taxPct', 'depositPct', 'ntePct', 'opt', 'trucks', 'catalog'];

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T } = A;
  const st = () => T.state();

  /* ---------------- the same prices as the server (tests/function/rq-fixtures.json) ---------------- */
  const keepS = JSON.parse(JSON.stringify(st().settings));
  const defs = {}; const D0 = T.defaultSettings(); PRICE_KEYS.forEach((k) => { defs[k] = D0[k]; });
  if (process.env.REGEN && label.indexOf('supabase') < 0) {
    const cs = cases(T).map((f) => Object.assign(f, { expect: expectOf(T, f) }));
    // the item list and the trucks only when a case changed them (otherwise the defaults below apply, as in the app)
    cs.forEach((f) => { ['catalog', 'trucks'].forEach((k) => { if (canon(f.settings[k]) === canon(D0[k])) delete f.settings[k]; }); });
    fs.writeFileSync(FIX, '{"note": ' + JSON.stringify('Written by REGEN=1 node tests/ui/requote.js. The app (tests/ui/requote.js) and the server (tests/function/requote.ts) must both price every case this way.') +
      ',\n"defaults": ' + JSON.stringify(defs) + ',\n"cases": [\n' + cs.map((f) => JSON.stringify(f)).join(',\n') + '\n]}\n');
    console.log('wrote ' + cs.length + ' cases to ' + FIX);
  }
  const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'));
  ok(canon(fx.defaults) === canon(defs), L('the app’s default rate card is the one written down for the server'));
  const bad = fx.cases.filter((f) => canon(expectOf(T, f)) !== canon(f.expect));
  ok(fx.cases.length >= 40 && !bad.length, L(fx.cases.length + ' written-down cases priced the same by the app' + (bad.length ? ' (differ: ' + bad.slice(0, 4).map((f) => f.name).join(', ') + ')' : '')));
  ok(fx.cases.some((f) => f.expect.q.kind === 'mileage') && fx.cases.some((f) => f.expect.q.kind === 'local') && fx.cases.some((f) => f.expect.q.flat) && fx.cases.some((f) => f.expect.q.nTrucks > 1) && fx.cases.some((f) => num(f.job.d.hoursOverride) > 0) && fx.cases.some((f) => f.expect.q.lines.some((l) => /^Tax/.test(l.label))) && fx.cases.some((f) => f.expect.q.lines.some((l) => /^Packing/.test(l.label))) && fx.cases.some((f) => f.expect.q.lines.some((l) => /^Stairs/.test(l.label))),
    L('the cases cover local and mileage moves, flat prices, two trucks, hours set by hand, tax, packing and stairs'));
  st().settings = keepS;
  function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ---------------- helpers ---------------- */
  const P = st().jobs.find((j) => j.d.name === 'Priya Nair'), HR = st().jobs.find((j) => j.d.name === 'Hollis & Reed Law'), MT = st().jobs.find((j) => j.d.name === 'Marcus Tull');
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  const endPreview = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const card = (j) => $('#view [data-job="' + j.id + '"]');
  const openBtn = (j) => card(j) && card(j).querySelector('[data-act="rq:open"]:not([data-step])');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const foot = () => [$('#rq .rq-foot small').textContent, $('#rqTot').textContent, $('#rqDiff').textContent, $('#rq .rq-foot .btn').textContent].join(' | ');
  const body = () => $('#rq .flow-body').textContent.replace(/\s+/g, ' ');
  const tap = async (sel, ms) => { click(sel); await sleep(ms || 5); };
  const sign = async (name) => { if (name != null) $('#sigName').value = name; $('#sigAgree').checked = true; $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); await tap('#rq [data-act="rq:sign"]', 15); };
  const before = JSON.parse(JSON.stringify(P));
  const opts = st().settings.opt;

  /* ---------------- who gets the button ---------------- */
  await preview('crew', 'Dee');
  ok(!!card(P) && !openBtn(P) && !card(P).querySelector('.cc-quote'), L('a crew member (Dee) has no quote and no new-quote button'));
  await endPreview();
  await preview('lead', 'Tanya');
  ok(!card(P) && !!card(HR), L('Tanya, a lead on another job, doesn’t see Priya Nair’s job'));
  if (card(HR).tagName === 'DETAILS') { click(card(HR).querySelector('summary b')); await sleep(10); }
  ok(!!openBtn(HR) && openBtn(HR).textContent === 'Items different? Make a new quote', L('Tanya has the button on her own booked job, under its quote'));
  await endPreview();
  await preview('lead', 'Marcus');
  ok(!!openBtn(P) && !!openBtn(P).closest('.cc-quote'), L('Marcus, the lead on Priya Nair’s job, has it in the Quote part of his card'));
  if (card(MT).tagName === 'DETAILS') { click(card(MT).querySelector('summary b')); await sleep(10); }
  ok(!!card(MT) && !openBtn(MT), L('not on a job that’s finished (Marcus Tull)'));

  /* ---------------- room by room ---------------- */
  await tap(openBtn(P), 10);
  ok(!$('#rq').hidden && /Priya Nair/.test($('#rq .flow-head').textContent) && /Room by room/.test($('#rq .flow-head').textContent) && document_lock(), L('opens over the screen: the customer’s name, “Room by room”'));
  function document_lock() { return w.document.body.classList.contains('lock'); }
  const rooms = $$('#rq .rqrooms details.grp');
  ok(rooms.length === 7 && rooms.map((g) => g.querySelector('summary span').firstChild.textContent.trim()).join('|') === 'Living room|Bedroom|Dining|Kitchen & laundry|Office|Boxes|Specialty', L('the rooms, in order: ' + rooms.map((g) => g.querySelector('summary span').firstChild.textContent.trim()).join(', ')));
  ok(rooms.filter((g) => g.open).length === 6 && !rooms[4].open && /^9 items$/.test(rooms[0].querySelector('.rqn').textContent) && rooms[4].querySelector('.rqn').textContent === '', L('rooms with something on the quote start open, with their count (Office has nothing, so it’s shut)'));
  ok(foot() === 'Quote was ' + money(P.quote.total) + ' | ' + money(P.quote.total) + ' | no change | Check it', L('the bar at the bottom: ' + foot()));
  await tap('#rq [data-act="rq:inc"][data-id="sofa3"]');
  await tap('#rq [data-act="rq:inc"][data-id="piano"]');
  await tap('#rq [data-act="rq:dec"][data-id="boxm"]'); await tap('#rq [data-act="rq:dec"][data-id="boxm"]');
  const exp1 = (() => { const dr = { items: Object.assign({}, P.d.items), flights: 0, pack: !!P.d.pack }; dr.items.sofa3 = 2; dr.items.piano = 1; dr.items.boxm -= 2; return T.rqBuild(P, dr); })();
  ok($('#rq_sofa3').textContent === '2' && $('#rqw_sofa3').textContent === ' · was 1' && $('#rq_piano').textContent === '1' && $('#rqw_piano').textContent === ' · was 0' && $('#rqw_loveseat').textContent === '', L('each change shows its count and what it was'));
  ok(rooms[0].querySelector('.rqn').textContent === '10 items' && rooms[6].querySelector('.rqn').textContent === '4 items', L('the room counts follow (' + rooms.map((g) => g.querySelector('.rqn').textContent).join(', ') + ')'));
  const d1 = Math.round((exp1.q.total - P.quote.total) * 100) / 100;
  ok(foot() === 'Quote was ' + money(P.quote.total) + ' | ' + money(exp1.q.total) + ' | +' + money(d1) + ' | Check it' && $('#rqDiff').classList.contains('money-due'), L('the new price as you go: ' + foot()));
  // the search
  $('#rqSearch').value = 'pian'; $('#rqSearch').dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  ok($$('#rq .rqrooms .grp').filter((g) => !g.hidden).length === 1 && $$('#rq .rqrooms .item').filter((i) => !i.hidden).length === 1, L('finding an item shows just it'));
  $('#rqSearch').value = ''; $('#rqSearch').dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  ok($$('#rq .rqrooms .grp').every((g) => !g.hidden), L('and clearing it shows every room again'));
  // stairs and packing
  await tap('#rq [data-act="rq:fl"][data-d="1"]');
  ok($('#rq_fl').textContent === '1' && $('#rqw_fl').textContent === 'was 0', L('a flight of stairs: “was 0”'));
  await tap('#rq [data-act="rq:fl"][data-d="-1"]');
  // leaving with changes asks first
  await tap('#rq [data-act="rq:exit"]', 5);
  ok(!$('#rq').hidden && !!$('#rq .rq-leave') && /Leave without saving the new quote\?/.test($('#rq .rq-leave').textContent), L('Exit with changes asks: “Leave without saving the new quote?”'));
  await tap('#rq [data-act="rq:stay"]');
  ok(!$('#rq .rq-leave') && $('#rq_sofa3').textContent === '2', L('Keep going: still there, nothing lost'));
  // the phone's Back button does the same
  w.dispatchEvent(new w.PopStateEvent('popstate')); await sleep(5);
  ok(!!$('#rq .rq-leave'), L('the phone’s Back button asks the same'));
  await tap('#rq [data-act="rq:stay"]');

  /* ---------------- check it ---------------- */
  await tap('#rq [data-act="rq:step"][data-s="review"]', 10);
  const kp = $$('#rq .kpi').map((k) => k.textContent);
  ok(kp.join('|') === money(P.quote.total) + 'Quote was|' + money(exp1.q.total) + 'New quote|+' + money(d1) + 'Difference', L('three tiles: ' + kp.join(' / ')));
  const ch = $$('#rq .rqch li').map((l) => l.textContent);
  ok(ch.join('|') === '+1 Sofa (3-seat) (1 → 2)|−2 Medium box (30 → 28)|+1 Upright piano', L('what’s different: ' + ch.join(', ')));
  ok(exp1.q.lines.every((l) => body().includes(l.label)) && /New quote\$/.test(body()) && body().includes('Deposit (as booked)' + money(P.quote.deposit)) && body().includes('Not to exceed' + money(exp1.q.nte)), L('the new quote’s lines, not-to-exceed, and the deposit as booked'));
  ok(exp1.q.rate === P.quote.rate && exp1.q.crew === P.quote.crew && exp1.q.deposit === P.quote.deposit, L('the same crew, hourly rate and deposit as the job’s quote'));
  ok(!!$('#rq [data-act="rq:step"][data-s="sign"]') && !$('#rq [data-act="rq:send"]'), L('next: “The customer signs” (no office approval by default)'));
  $('#rqNote').value = 'Piano in the garage'; $('#rqNote').dispatchEvent(new w.Event('input', { bubbles: true }));

  /* ---------------- the customer signs ---------------- */
  await tap('#rq [data-act="rq:step"][data-s="sign"]', 10);
  ok(/^New estimate: /.test($('#rq h2').textContent) && $('#rq h2').textContent === 'New estimate: ' + money(exp1.q.total) && $('#sigName').value === 'Priya Nair', L('the customer sees the new estimate, with their name filled in'));
  ok(body().includes('The quote was $1,541. The bill still follows the time the move takes and the miles driven. The not-to-exceed price, ' + money(exp1.q.nte) + ', is a guide, not a limit.'), L('and how the bill works: by the time and miles; the not-to-exceed price is a guide'));
  ok($('#sigAgree').parentNode.textContent.trim() === 'I agree to the new estimate of ' + money(exp1.q.total) + '.', L('what they agree to, with no limit promised: ' + $('#sigAgree').parentNode.textContent.trim()));
  $('#sigName').value = ''; await tap('#rq [data-act="rq:sign"]');
  ok($('#rqErr').textContent === 'Type the customer’s printed name.', L('no name: ' + $('#rqErr').textContent));
  $('#sigName').value = 'Priya Nair'; await tap('#rq [data-act="rq:sign"]');
  ok($('#rqErr').textContent === 'Tick the box to show the customer agrees to the new estimate.', L('not ticked: ' + $('#rqErr').textContent));
  $('#sigAgree').checked = true; await tap('#rq [data-act="rq:sign"]');
  ok($('#rqErr').textContent === 'The customer needs to sign in the box.', L('not signed: ' + $('#rqErr').textContent));
  ok(st().jobs.find((j) => j.id === P.id).quote.total === before.quote.total, L('nothing changes on the job until they sign'));
  const pad = $('#sigPad'); pad.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  await tap('#rq [data-act="rq:exit"]');
  ok(!!$('#rq .rq-leave') && $('#sigPad') === pad, L('Exit while the customer signs asks first, without wiping the signature'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(5);
  ok(!$('#rq .rq-leave') && $('#sigPad') === pad && !$('#rq').hidden, L('Escape: back to signing, the signature still there'));
  await sign();
  const P1 = st().jobs.find((j) => j.id === P.id);
  ok(P1.quote.total === exp1.q.total && canon(P1.quote) === canon(exp1.q) && canon(P1.items) === canon(exp1.items), L('signed: the new quote is on the job (' + money(before.quote.total) + ' → ' + money(P1.quote.total) + ')'));
  ok(P1.d.items.sofa3 === 2 && P1.d.items.piano === 1 && P1.d.items.boxm === 28 && P1.d.items.loveseat === 1, L('and its items'));
  const h = (P1.quoteHist || [])[0] || {};
  ok(P1.quoteHist.length === 1 && h.was.total === before.quote.total && canon(h.was) === canon(before.quote) && h.now === exp1.q.total && h.by === 'Marcus' && h.why === 'Piano in the garage' && h.sign && h.sign.name === 'Priya Nair' && /^data:/.test(h.sign.img) && canon(h.wasItems) === canon(before.items), L('the quote it replaced stays on the job, with who, why and the customer’s signature'));
  ok(P1.rq && P1.rq.state === 'done' && P1.rq.by === 'Marcus' && P1.rq.sig.name === 'Priya Nair' && !P1.rq.sig.img && P1.rq.applied > 0, L('the new quote’s record: done, signed (the signature itself is kept once, in the history)'));
  ok(P1.log.slice(-1)[0].ev === 'New quote on site by Marcus: ' + money(before.quote.total) + ' → ' + money(exp1.q.total) + ', signed by Priya Nair', L('in the job’s activity: ' + P1.log.slice(-1)[0].ev));
  ok(/^The new quote is on the job/.test(body()) && body().includes(money(exp1.q.total) + ', signed by Priya Nair. The office has been told.') && toast() === 'The new quote is on the job.' && !$('#rq [data-act="rq:exit"]').closest('.flow-head'), L('the last screen: “The new quote is on the job”, with just Close'));
  await tap('#rq [data-act="rq:exit"]', 10);
  ok($('#rq').hidden && !$('#rq').innerHTML, L('Close'));
  const q1 = card(P).querySelector('.cc-quote');
  ok(q1.querySelector('tr.sub').textContent === 'Quote' + money(exp1.q.total) && /Earlier quotes/.test(q1.textContent) && q1.querySelector('.rqhist b').textContent === money(before.quote.total) + ' → ' + money(exp1.q.total), L('the card has the new quote, and the earlier one under it'));
  ok(/new quote on site by Marcus · signed by Priya Nair · “Piano in the garage”/.test(q1.querySelector('.rqhist').textContent) && /\+1 Sofa \(3-seat\) \(1 → 2\), −2 Medium box \(30 → 28\), \+1 Upright piano/.test(q1.querySelector('.rqhist').textContent), L('who made it, who signed, why, and what changed'));
  ok(!!openBtn(P), L('another new quote can be made after it'));
  await endPreview();

  /* ---------------- the office is told ---------------- */
  const al = $$('#view .alert').find((a) => /New quote signed on site/.test(a.textContent));
  ok(!!al && al.textContent.includes('New quote signed on site: Priya Nair') && al.textContent.includes(money(before.quote.total) + ' → ' + money(exp1.q.total) + ' · by Marcus · signed by Priya Nair'), L('the office’s Today: ' + (al && al.textContent.replace(/[!›]/g, ''))));
  await tap(al, 15);
  const top = $('#sheet .rqnote');
  ok(!!top && /New quote signed on site: /.test(top.textContent) && /By Marcus, signed by Priya Nair at /.test(top.textContent) && /“Piano in the garage”/.test(top.textContent) && !!top.querySelector('[data-act="rq:seen"]'), L('the job sheet opens on it: who, the customer’s signature, why, and “Got it”'));
  const qsec = $$('#sheet details.acc').find((dd) => dd.dataset.k === 'sh:Quote');
  ok(!!qsec && /Earlier quotes/.test(qsec.textContent), L('the earlier quote is under Quote on the sheet too'));
  await tap('#sheet [data-act="rq:seen"]', 10);
  ok(!$('#sheet .rqnote') && !$$('#view .alert').some((a) => /New quote signed/.test(a.textContent)) && P1.rq.seen && P1.rq.seen.by, L('Got it: gone from the sheet and from Today'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);

  /* ---------------- the rates the job was quoted at ---------------- */
  st().settings.rates.r3 = 260; st().settings.truckFee = 99;
  const P1b = st().jobs.find((j) => j.id === P.id), dr2 = { items: Object.assign({}, P1b.d.items), flights: 0, pack: false }; dr2.items.dresser += 1;
  const exp2 = T.rqBuild(P1b, dr2);
  ok(exp2.q.rate === P1b.quote.rate && exp2.q.lines.some((l) => l.label === 'Truck and fuel' && l.amt === 45), L('with the rate card raised since, a new quote still uses the job’s rates ($' + exp2.q.rate + '/hr, $45 truck)'));
  st().settings.rates.r3 = 195; st().settings.truckFee = 45;

  /* ---------------- started, billed out, switched off ---------------- */
  P1b.status = 'active'; P1b.startedAt = Date.now() - 36e5; T.render(); await sleep(5);
  await preview('lead', 'Marcus');
  ok(!!openBtn(P), L('a job that’s started can still get a new quote'));
  P1b.clockAt = Date.now(); T.render(); await sleep(5);
  ok(!openBtn(P), L('not once it’s billed out'));
  delete P1b.clockAt; opts.rqCrew = false; T.render(); await sleep(5);
  ok(!openBtn(P), L('Options › Crew leads make new quotes on site, off: no button'));
  delete opts.rqCrew; T.render(); await sleep(5);
  // nothing moving can't be a quote
  await tap(openBtn(P), 10);
  Object.keys(P1b.d.items).forEach((id) => { ui().rqo.dr.items[id] = 0; delete ui().rqo.dr.items[id]; });
  function ui() { return T.ui; }
  await tap('#rq [data-act="rq:step"][data-s="review"]');
  ok($('#rq').dataset.step === 'items' && toast() === 'Put in what’s moving first.', L('with nothing moving, it won’t go on: “Put in what’s moving first.”'));
  ui().rqo.dr = { items: Object.assign({}, P1b.d.items), flights: 0, pack: false };
  await tap('#rq [data-act="rq:step"][data-s="review"]');
  ok(!$('#rq [data-act="rq:step"][data-s="sign"]') && /Nothing is different yet\./.test(body()), L('with nothing changed, there’s nothing to sign'));
  await tap('#rq [data-act="rq:exit"]');
  ok($('#rq').hidden, L('and Exit closes without asking'));
  await endPreview();

  /* ---------------- Options › Office approves new quotes ---------------- */
  opts.rqOffice = true; T.render(); await sleep(5);
  await preview('lead', 'Marcus');
  await tap(openBtn(P), 10);
  await tap('#rq [data-act="rq:inc"][data-id="dresser"]');
  await tap('#rq [data-act="rq:step"][data-s="review"]', 10);
  ok(!!$('#rq [data-act="rq:send"]') && !$('#rq [data-act="rq:step"][data-s="sign"]') && /The owner or dispatch approves it, then the customer signs\./.test(body()), L('with office approval on: “Send to the office to approve”'));
  const q2before = JSON.parse(JSON.stringify(P1b.quote));
  await tap('#rq [data-act="rq:send"]', 10);
  ok(P1b.rq.state === 'waiting' && P1b.rq.by === 'Marcus' && canon(P1b.quote) === canon(q2before) && /^Sent to the office/.test(body()), L('sent: waiting for the office, and the job’s quote hasn’t changed'));
  await tap('#rq [data-act="rq:exit"]', 10);
  const wn = card(P).querySelector('.rqnote');
  ok(!!wn && /New quote sent to the office/.test(wn.textContent) && /Waiting for the owner or dispatch to approve it\./.test(wn.textContent) && !!wn.querySelector('[data-act="rq:cancel"]') && !openBtn(P), L('the card says it’s waiting, with “Take it back”, and no second new quote meanwhile'));
  await endPreview();
  const al2 = $$('#view .alert').find((a) => /New quote to approve/.test(a.textContent));
  ok(!!al2 && al2.textContent.includes('New quote to approve: Priya Nair') && al2.textContent.includes(money(P1b.rq.was) + ' → ' + money(P1b.rq.quote.total) + ' · from Marcus'), L('the office’s Today: ' + (al2 && al2.textContent.replace(/[!›]/g, ''))));
  await tap(al2, 15);
  ok(!!$('#sheet .rqask [data-act="rq:ok"]') && !!$('#sheet .rqask [data-act="rq:no"]') && /\+1 Dresser \(6-drawer\) \(3 → 4\)/.test($('#sheet .rqask').textContent), L('the sheet: what changed, the new lines, Approve and Don’t approve'));
  $('#rqWhy').value = 'OK, go ahead';
  await tap('#sheet [data-act="rq:ok"]', 10);
  const ok1 = P1b.quote.rqOk;
  ok(P1b.rq.state === 'approved' && P1b.rq.ok.by === 'Owner' && P1b.rq.ok.note === 'OK, go ahead' && ok1 && ok1.id === P1b.rq.id && ok1.total === P1b.rq.quote.total && ok1.key === T.rqKey(P1b.rq) && P1b.quote.total === q2before.total, L('approved: the office’s yes is on the job’s quote (for the server to check); the price itself waits for the customer'));
  ok(/New quote approved by Owner \(.+\)\. Waiting for the customer to sign it\./.test($('#sheet .sheet-body').textContent), L('the sheet says it waits for the customer to sign'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  await preview('lead', 'Marcus');
  const an = card(P).querySelector('.rqnote');
  ok(!!an && /Owner approved the new quote/.test(an.textContent) && /“OK, go ahead”/.test(an.textContent) && !!an.querySelector('[data-act="rq:open"][data-step="sign"]') && !!an.querySelector('[data-act="rq:refuse"]'), L('Marcus’s card: approved, with the office’s note, “The customer signs” and “The customer doesn’t agree”'));
  await tap(an.querySelector('[data-act="rq:open"][data-step="sign"]'), 10);
  ok($('#rq').dataset.step === 'sign' && /Approved by Owner\./.test(body()) && !$('#rq [data-act="rq:step"][data-s="review"]'), L('it opens straight to the signature'));
  await sign('Priya Nair');
  ok(P1b.quote.total === P1b.rq.quote.total && P1b.quote.rqOk === null && P1b.rq.state === 'done' && P1b.quoteHist.length === 2 && P1b.quoteHist[1].ok.by === 'Owner', L('signed: the new quote is on the job, the office’s yes is used up, and the history says who approved it'));
  await tap('#rq [data-act="rq:exit"]', 10);
  // the customer doesn't agree
  await tap(openBtn(P), 10); await tap('#rq [data-act="rq:inc"][data-id="desk"]'); await tap('#rq [data-act="rq:step"][data-s="review"]'); await tap('#rq [data-act="rq:send"]'); await tap('#rq [data-act="rq:exit"]', 10);
  await endPreview();
  await tap($$('#view .alert').find((a) => /New quote to approve/.test(a.textContent)), 15);
  await tap('#sheet [data-act="rq:ok"]', 10);
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  const q3 = P1b.quote.total;
  await preview('lead', 'Marcus');
  await tap(card(P).querySelector('[data-act="rq:refuse"]'), 10);
  ok(P1b.rq.state === 'refused' && P1b.quote.total === q3 && toast() === 'The office has been told. The job stays at ' + money(q3) + '.' && /The customer didn’t agree to the new quote/.test(card(P).querySelector('.rqnote').textContent) && !!openBtn(P), L('the customer doesn’t agree: the job stays at its quote, the office is told, and a new one can be made'));
  await endPreview();
  const al3 = $$('#view .alert').find((a) => /didn’t agree/.test(a.textContent));
  ok(!!al3, L('the office’s Today: “The customer didn’t agree to the new quote”'));
  await tap(al3, 15); await tap('#sheet [data-act="rq:seen"]', 10);
  ok(!P1b.quote.rqOk && P1b.rq.seen && !$$('#view .alert').some((a) => /didn’t agree/.test(a.textContent)), L('Got it: the unused yes is cleared, and the alert goes'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  // don't approve
  await preview('lead', 'Marcus');
  await tap(openBtn(P), 10); await tap('#rq [data-act="rq:inc"][data-id="bike"]'); await tap('#rq [data-act="rq:step"][data-s="review"]'); await tap('#rq [data-act="rq:send"]'); await tap('#rq [data-act="rq:exit"]', 10);
  await endPreview();
  await tap($$('#view .alert').find((a) => /New quote to approve/.test(a.textContent)), 15);
  $('#rqWhy').value = 'Call me first';
  await tap('#sheet [data-act="rq:no"]', 10);
  ok(P1b.rq.state === 'declined' && P1b.rq.no.why === 'Call me first' && !P1b.quote.rqOk, L('Don’t approve: declined, with the note'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  await preview('lead', 'Marcus');
  ok(/Owner didn’t approve the new quote/.test(card(P).querySelector('.rqnote').textContent) && /“Call me first”/.test(card(P).querySelector('.rqnote').textContent) && !!openBtn(P), L('Marcus sees it wasn’t approved, and why'));
  // take it back
  await tap(openBtn(P), 10); await tap('#rq [data-act="rq:inc"][data-id="bike"]'); await tap('#rq [data-act="rq:step"][data-s="review"]'); await tap('#rq [data-act="rq:send"]'); await tap('#rq [data-act="rq:exit"]', 10);
  await tap(card(P).querySelector('[data-act="rq:cancel"]'), 10);
  ok(P1b.rq.state === 'cancelled' && !card(P).querySelector('.rqnote') && !!openBtn(P), L('Take it back: cancelled, and the card is back to the button'));
  // the office changes the quote while one waits: it stops counting
  await tap(openBtn(P), 10); await tap('#rq [data-act="rq:inc"][data-id="bike"]'); await tap('#rq [data-act="rq:step"][data-s="review"]'); await tap('#rq [data-act="rq:send"]'); await tap('#rq [data-act="rq:exit"]', 10);
  await endPreview();
  P1b.quote = Object.assign({}, P1b.quote, { total: P1b.quote.total + 100 }); T.render(); await sleep(5);
  ok(!$$('#view .alert').some((a) => /New quote to approve/.test(a.textContent)), L('the office changed the quote meanwhile: no “to approve” alert'));
  T.ui.jobId = P.id; T.render(); await sleep(10);
  ok(!$('#sheet [data-act="rq:ok"]') && !!$('#sheet [data-act="rq:no"]') && /so it can’t be approved/.test($('#sheet .rqask').textContent), L('and on the sheet it can’t be approved, only turned down'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  await preview('lead', 'Marcus');
  ok(/The quote on the job changed/.test(card(P).querySelector('.rqnote').textContent) && !!openBtn(P), L('Marcus sees it no longer counts, and can make a new one'));
  await endPreview();
  delete opts.rqOffice;

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
