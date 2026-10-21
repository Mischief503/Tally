// The owner's on/off switches (Setup › Options) and the new layout around them: Setup as a list of
// sections with search, the More menu in groups, Jobs · Chat · More on the crew's bottom bar, and the
// crew's job card in one order, all open. Each switch is flipped and its effect checked where people meet it.
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'options';
const L = (m) => label + ': ' + m;
const H = 36e5;
// the app's own idea of today: the phone's local date, not UTC
const dayISO = (n) => { const d = new Date(); d.setDate(d.getDate() + (n || 0)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T } = A;
  const st = () => T.state(), S = st().settings;
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const flow = () => $('#flow').hidden ? '' : $('#flow').textContent.replace(/\s+/g, ' ');
  const toastTxt = () => $('#toast').textContent;
  const byName = (n) => st().jobs.find((j) => j.d.name === n);
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  const endPreview = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const flip = (k, on) => { const i = $('input[role="switch"][data-s="' + k + '"]'); i.checked = on; i.dispatchEvent(new w.Event('input', { bubbles: true })); return i; };
  const set = (k, v) => { S.opt[k] = v; T.render(); };
  const blank = (d) => Object.assign({ name: 'Test', phone: '', email: '', source: '', moveDate: '', time: '09:00', from: 'A', to: 'B', miles: '8', flights: '', crew: '', truckId: '', hoursOverride: '', discount: '', notes: '', pack: false, items: {}, custom: {}, milesOut: '', milesBack: '', moveKind: '' }, d);
  st().ui.me = 'Marcus';

  /* ---------------- Setup: a list of sections, search, each section on its own page ---------------- */
  await A.go('settings');
  const rows = $$('#setList [data-act="set:open"]').map((b) => b.dataset.sec);
  ok(rows[0] === 'options' && ['company', 'rates', 'mats', 'catalog', 'fleet', 'employees', 'roles', 'clock', 'forms', 'fields', 'sources', 'bid', 'pay', 'vault', 'comms', 'data'].every((s) => rows.includes(s)), L('Setup lists Options first, then every section: ' + rows.join(', ')));
  ok(['Your company', 'Pricing', 'People', 'Jobs and paperwork', 'Payments and texts', 'Data'].every((g) => $$('#setList .glabel').some((x) => x.textContent === g)), L('in groups'));
  ok(/36 of 39 switches on/.test($('[data-sec="options"]').textContent) && /\$140\/h for 2 movers · 20-mile local radius · 3 h minimum/.test($('[data-sec="rates"]').textContent), L('each row says how it is set: "36 of 39 switches on", the rate card in a line'));
  ok(!$('details.acc.card') && !$('input[data-s="rates.r2"]'), L('no section is open on the list itself'));
  const q = $('#setQ'); q.value = 'deposit'; q.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  ok(!!$('#setList input[role="switch"][data-s="opt.deposit"]') && !!$('#setList [data-act="set:open"][data-sec="rates"]') && !$('#setList [data-sec="fleet"]'), L('search "deposit" shows the Deposit switch itself and the Rate card, nothing else'));
  q.value = 'zzzz'; q.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  ok(/Nothing matches “zzzz”/.test(view()), L('no match says so'));
  q.value = ''; q.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  click('[data-act="set:open"][data-sec="fleet"]'); await sleep(10);
  ok(!!$('[data-act="set:back"]') && /Fleet/.test(view()) && !!$('[data-act="st:addtruck"]') && !$('#setList'), L('a section opens on its own page with ‹ Setup'));
  click('[data-act="set:back"]'); await sleep(10);
  ok(!!$('#setList') && !$('[data-act="set:back"]'), L('‹ Setup goes back to the list'));

  /* ---------------- Options: every switch, its number, the count ---------------- */
  click('[data-act="set:open"][data-sec="options"]'); await sleep(10);
  const sws = $$('#view input[role="switch"]');
  ok(sws.length === 39 && $$('#view .optgrp h3').map((h) => h.textContent).join('|') === 'Crew and field|Billing out|Time clock|Quotes and pricing|Paperwork|Payments|Texts|Office', L('39 switches in 8 groups'));
  ok(sws.filter((i) => !i.checked).map((i) => i.dataset.s).join() === 'opt.photosReq,opt.tax,opt.rqOffice', L('all on to start except Photos before finishing, Sales tax (no tax % set) and Office approves new quotes from the crew'));
  const dep = $('input[data-s="depositPct"]');
  ok(dep && !dep.closest('.optn').hidden && dep.value === '25', L('a switch that needs a number shows it under it (Deposit 25%)'));
  flip('opt.deposit', false); await sleep(5);
  ok(S.opt.deposit === false && dep.closest('.optn').hidden && dep.closest('.opt').classList.contains('off') && /35 of 39 on/.test($('#optCount').textContent), L('switched off: saved, its number hides, and the count drops'));
  flip('opt.deposit', true); await sleep(5);
  ok(S.opt.deposit === true && !dep.closest('.optn').hidden, L('and back on'));
  ok(!!$('input[role="switch"][data-s="comms.alerts.tomorrow"]') && !!$('input[role="switch"][data-s="payMin"]') && !!$('input[role="switch"][data-s="nteCap"]'), L('older settings sit here too (texts, minimum pay, not-to-exceed)'));
  click('[data-act="set:back"]'); await sleep(5);
  click('[data-act="set:open"][data-sec="roles"]'); await sleep(10);
  ok(['opt.eta', 'opt.leadPay', 'opt.dispatchPay'].every((k) => !!$('input[data-s="' + k + '"]')) && /Crew lead/.test(view()), L('each section page carries its own switches (Roles: crew, billing out, office)'));
  click('[data-act="set:back"]'); await sleep(5);

  /* ---------------- More, in groups ---------------- */
  click('[data-act="more:open"]'); await sleep(5);
  ok($$('#more .glabel').map((g) => g.textContent).join('|') === 'Work|Company|You' && !!$('#more .sosrow'), L('More: Work, Company, You, and Truck down apart'));
  click('#more [data-act="more:go"][data-sec="options"]'); await sleep(15);
  ok(T.ui.tab === 'settings' && T.ui.setSec === 'options' && $$('#view input[role="switch"]').length === 39, L('More › Options opens Setup › Options'));

  /* ---------------- the quote's switches ---------------- */
  const base = blank({ miles: '8', flights: '2', pack: true, items: { boxm: 40, sofa3: 1 } });
  let qt = T.calc(base, S);
  const has = (q, re) => q.lines.some((l) => re.test(l.label));
  ok(has(qt, /^Truck and fuel/) && has(qt, /^Stairs/) && has(qt, /^Packing/) && qt.deposit > 0 && !qt.flat, L('to start, a quote has truck and fuel, stairs, packing and a deposit'));
  S.opt.truckFee = false; S.opt.stairs = false; S.opt.packing = false; S.opt.deposit = false;
  qt = T.calc(base, S);
  ok(!has(qt, /^Truck and fuel/) && !has(qt, /^Stairs/) && !has(qt, /^Packing/) && qt.deposit === 0, L('those switched off: none of them on the quote'));
  click('#fab'); await sleep(10); Object.assign(st().draft, blank({ name: 'Peek', miles: '8', items: { boxm: 60 } })); T.render(); await sleep(5);
  ok(!$('[data-d="flights"]') && !$('[data-d="pack"]'), L('and the quote form drops the stairs and packing boxes'));
  click('[data-act="q:step"][data-s="3"]'); await sleep(10);
  ok(!/Deposit at booking/.test($('#qLines').textContent), L('no deposit line'));
  S.opt.truckFee = true; S.opt.stairs = true; S.opt.packing = true; S.opt.deposit = true;
  S.taxPct = 8; S.opt.tax = false; qt = T.calc(base, S);
  ok(!has(qt, /^Tax/) && qt.taxPct === 0, L('a tax % with Sales tax off: no tax'));
  S.opt.tax = true; qt = T.calc(base, S);
  ok(has(qt, /^Tax \(8%\)/) && qt.taxPct === 8, L('Sales tax on: Tax (8%)'));
  S.taxPct = 0; delete S.opt.tax;
  const far = blank({ miles: '110', items: { boxm: 60 } });
  ok(T.calc(far, S).kind === 'mileage', L('a 110 mi move is a mileage move'));
  S.opt.mileage = false;
  ok(T.calc(far, S).kind === 'local' && /Mileage moves are off in Setup › Options, so every move is local\./.test(T.kindLine(far, S)), L('Mileage moves off: local, and the quote says why'));
  S.opt.mileage = true;
  S.opt.byClock = false; qt = T.calc(blank({ miles: '8', items: { boxm: 60 } }), S); S.opt.byClock = true;
  ok(qt.flat === true, L('Final bill by the clock off: a flat-price quote'));
  click('[data-act="q:clear"]'); await sleep(5); click('[data-act="q:clear"]'); await sleep(5);

  // a flat-price job bills at its quote
  const N = byName('Nadia Farouk');
  N.quote = Object.assign(T.calc(Object.assign({}, N.d, { milesOut: '', milesBack: '', miles: '8', items: { boxm: 60 } }), S), { flat: true });
  const t0 = Date.now() - 9 * H;
  Object.assign(N, { status: 'active', startedAt: t0, phases: { loadStart: t0, loadEnd: t0 + 3 * H, unloadStart: t0 + 4 * H, unloadEnd: t0 + 8 * H }, extras: [], payments: [], signed: [] });
  ok(T.clockBill(N) === null, L('a flat-price job has no bill by the clock'));
  N.assign.crew = ['Marcus', 'Kim'];
  await A.go('crew'); await A.openCard(N.id);
  click('[data-act="cr:finish"][data-id="' + N.id + '"]'); await sleep(20);
  ok(!N.extras.some((e) => e.id === 'clock') && !/Before you bill out/.test(flow()), L('finished after 8 hours: billed at the quote, no drive-back step'));
  click('#flow [data-act="flow:close"]'); await sleep(5);

  /* ---------------- the crew's job card: one order, all open (Richie's drawing, Oct 21) ---------------- */
  const P = byName('Priya Nair');
  const card = (j) => $('#view .crewcard[data-job="' + j.id + '"]');
  // the card's own parts (the run part below them has the lead's Quote and Bill)
  const heads = (c) => Array.from(c.querySelectorAll('.cc-sec>h4')).filter((h) => !h.closest('.cc-run')).map((h) => h.textContent).join(' · ');
  const inOrder = (c, sels) => { let prev = null; return sels.every((q) => { const e = c.querySelector(q); const good = !!e && (!prev || !!(prev.compareDocumentPosition(e) & 4)); prev = e || prev; return good; }); };
  ok(!!card(P) && heads(card(P)) === 'Notes for the job · Materials · Photos' && !!card(P).querySelector('.cc-run .cc-tally'), L('a booked job’s card: Notes for the job · Materials · Photos, then running the job with Load tally (' + (card(P) ? heads(card(P)) : 'no card') + ')'));
  ok(inOrder(card(P), ['.cc-head h3', '.cc-head > .pill', '.cc-date', '.cc-truck', '.cc-route', '.cc-sec textarea', '.cc-sec [data-act="mp:open"]', '.cc-photos', '.cc-run']) && /Crew: /.test(card(P).textContent), L('in the drawing’s order: status, name, date, crew and trucks, pickup and delivery, notes, materials, photos'));
  ok(!card(P).querySelector('details:not(.cc-tally):not(.cc-cost)') && !Array.from(card(P).querySelectorAll('[hidden]')).some((e) => !e.closest('.cc-cost')), L('nothing folded away but the load tally and the job-cost form'));
  // a job in a few days: Marcus is put on Hollis & Reed's crew for it
  const later = byName('Hollis & Reed Law');
  if (later && later.status === 'booked') {
    later.d.moveDate = dayISO(3); if (!later.assign.crew.includes('Marcus')) later.assign.crew.push('Marcus'); T.render(); await sleep(5);
    const cu = $$('#view .secline h2').find((h) => h.textContent === 'Coming up');
    const row = $('#view details.hcard[data-job="' + later.id + '"]');
    // folded: the name, then the day, the start time and how long it should take (Richie, Oct 21)
    const q = later.quote || {}, est = Math.round(((q.hours || 3) + (q.kind === 'mileage' ? (+q.driveH || 0) : 0)) * 2) / 2;
    const tp = later.d.time.split(':').map(Number), tm = ((tp[0] + 11) % 12 + 1) + ':' + String(tp[1]).padStart(2, '0') + (tp[0] >= 12 ? ' PM' : ' AM');
    const dd = later.d.moveDate.split('-').map(Number), dayTxt = new w.Date(dd[0], dd[1] - 1, dd[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const small = row ? row.querySelector('summary .hsum small').textContent : '';
    ok(!!row && !row.open && !!cu && !!(cu.compareDocumentPosition(row) & 4) && row.querySelector('summary .hsum b').textContent === later.d.name && small === dayTxt + ' · ' + tm + ' · Est. ' + est + ' h',
      L('a later job is folded under Coming up: ' + later.d.name + ', ' + small));
    await A.openCard(later.id);
    ok(row.open && heads(row) === heads(card(P)) && !!row.querySelector('[data-act="cr:start"]'), L('tapped, it opens to the same full card'));
    const pe = Math.round(((P.quote.hours || 3) + (P.quote.kind === 'mileage' ? (+P.quote.driveH || 0) : 0)) * 2) / 2;
    ok(new RegExp('· Est\\. ' + String(pe).replace('.', '\\.') + ' h$').test(card(P).querySelector('.cc-date').textContent), L('today’s card has the estimate on its date line: ' + card(P).querySelector('.cc-date').textContent));
  } else ok(false, L('sample data has Hollis & Reed booked'));
  if (!P.d.notes) { P.d.notes = 'Elevator reserved'; T.render(); await sleep(5); }
  const onote = card(P).querySelector('.cc-onote');
  ok(!!onote && /^From the office/.test(onote.textContent.trim()) && onote.textContent.includes(P.d.notes.split('\n')[0]), L('the office note shows on the card, in its own box under Notes for the job'));

  // switches on the card
  set('tally', false); set('materials', false); set('updates', false); await sleep(5);
  ok(!card(P).querySelector('.cc-tally') && !card(P).querySelector('[data-act="mp:open"]') && !card(P).querySelector('[data-act="cost:add"]') && !$('[data-act="cr:update"][data-id="' + P.id + '"]'), L('Load tally, Materials and Quick updates off: no load tally, nothing to add materials or costs with, no update chips'));
  ok(P.materials.length ? heads(card(P)) === 'Notes for the job · Materials · Photos' && P.materials.every((m) => Array.from(card(P).querySelectorAll('.cc-sec')).find((x) => x.querySelector('h4').textContent === 'Materials').textContent.includes(m.name)) : heads(card(P)) === 'Notes for the job · Photos', L('the materials already on the job still show, to read'));
  set('tally', true); set('materials', true); set('updates', true);

  /* ---------------- Start job: the arrival text ---------------- */
  P.d.phone = '512-555-0177'; T.render(); await sleep(5);
  A.clockIn(P.assign.crew); await sleep(5);
  click('[data-act="cr:start"][data-id="' + P.id + '"]'); await sleep(10);
  ok(!!$('#etaOn') && /Text Priya Nair how long until you arrive/.test($('#start').textContent), L('Start job offers the arrival text'));
  click('[data-act="go:close"]'); await sleep(5);
  set('eta', false);
  click('[data-act="cr:start"][data-id="' + P.id + '"]'); await sleep(10);
  ok(!$('#etaOn') && !/arrival text|how long until/.test($('#start').textContent) && $('#start [data-act="go:start"]').textContent === 'Start job', L('Arrival text off: no text option, no note about it, just Start job'));
  click('#start [data-act="go:start"]'); await sleep(15);
  ok(P.status === 'active' && !P.log.some((l) => /Arrival text/.test(l.ev)), L('started with no arrival text'));
  set('eta', true);

  /* ---------------- photos before finishing ---------------- */
  set('photosReq', true);
  Object.assign(P, { startedAt: Date.now() - 4 * H, phases: { loadStart: Date.now() - 3.5 * H, loadEnd: Date.now() - 3 * H, unloadStart: Date.now() - 2 * H, unloadEnd: Date.now() - H }, photos: [] });
  T.render(); await sleep(5);
  ok(/Before Finish job: take a pickup photo and a delivery photo\./.test(card(P).querySelector('.cc-photos').textContent), L('Photos says which photos are needed before Finish job'));
  let toPhotos = false; card(P).querySelector('.cc-photos').scrollIntoView = () => { toPhotos = true; };
  click('[data-act="cr:finish"][data-id="' + P.id + '"]'); await sleep(15);
  ok(P.status === 'active' && $('#flow').hidden && /Take a pickup photo and a delivery photo before you finish the job\./.test(toastTxt()) && toPhotos, L('Finish job waits for both photos and takes you to Photos'));
  P.photos.push({ id: 'p1', kind: 'Pickup', data: 'data:,', ts: Date.now() }); T.render(); await sleep(5);
  click('[data-act="cr:finish"][data-id="' + P.id + '"]'); await sleep(15);
  ok(/Take a delivery photo before you finish the job\./.test(toastTxt()), L('one in: it asks for the other'));
  P.photos.push({ id: 'p2', kind: 'Delivery', data: 'data:,', ts: Date.now() }); T.render(); await sleep(5);
  click('[data-act="cr:finish"][data-id="' + P.id + '"]'); await sleep(20);
  ok(!$('#flow').hidden, L('both in: Finish job goes on'));
  click('#flow [data-act="flow:close"]'); await sleep(5);
  set('photosReq', false);

  /* ---------------- signatures, and who collects ---------------- */
  set('forms', false);
  ok(T.state().settings.forms.some((f) => f.required) && !$$('.crewcard').some((c) => /Forms signed/.test(c.textContent)), L('Signatures before payment off: no form is asked for'));
  set('forms', true);
  await preview('lead', 'Marcus');
  await A.go('crew');
  const MT = byName('Marcus Tull');
  ok(MT && MT.status === 'done' && !!card(MT) && !!$('[data-act="flow:open"][data-id="' + MT.id + '"]'), L('a lead sees Collect payment on a finished job'));
  set('leadPay', false); await sleep(5);
  ok(!!card(MT) && /Get signatures/.test(card(MT).textContent) && !/Collect payment/.test(card(MT).textContent), L('Crew leads collect payment off: the lead gets the signatures only'));
  click($('[data-act="flow:open"][data-id="' + MT.id + '"]')); await sleep(15);
  ok(/Delivery receipt/.test(flow()), L('the forms come first'));
  $('#sigName').value = 'Marcus Tull'; $('#sigAgree').checked = true; $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  click('#flow [data-act="flow:sign"]'); await sleep(20);
  ok(/Forms signed/.test(flow()) && /is still owed\. The office collects the payment\./.test(flow()) && !$('#flowAmt'), L('signed: no payment screen, the office collects'));
  click('#flow [data-act="flow:close"]'); await sleep(5);
  ok(MT.d.moveDate === dayISO() ? !!card(MT) : !card(MT), L('nothing left for the lead: it leaves Finished, needs billing'));
  click('[data-act="cr:view"][data-v="history"]'); await sleep(10);
  const mtRow = $('#view details.hcard[data-job="' + MT.id + '"]');
  ok(!!mtRow && /The office collects the payment/.test(mtRow.textContent), L('it is in History, and its card says the office collects'));
  set('leadPay', true);
  ok(!!$('[id="ce_l_' + MT.id + '"]'), L('a lead can add a charge or credit'));
  set('leadCharges', false); await sleep(5);
  ok(!$('[id="ce_l_' + MT.id + '"]'), L('Crew leads add charges and credits off: the box is gone'));
  set('leadCharges', true);
  await endPreview();

  /* ---------------- crew members: Call, the clock, Truck down ---------------- */
  await preview('crew', 'Dee');
  ok($$('#tabs [data-act="tab"]').map((b) => b.dataset.tab).join() === 'crew,chat' && /Jobs/.test($('#tabs').textContent) && $('#fab').hidden && !$('#tabs .spacer') && !!$('.tclock'), L('a crew member has Jobs and Chat on the bottom bar, and clocks in on the clock card (no round button over the screen)'));
  await A.go('crew');
  const dj = st().jobs.find((j) => ['booked', 'active'].includes(j.status) && j.assign.crew.includes('Dee') && j.d.moveDate <= dayISO());
  if (dj) {
    dj.d.phone = dj.d.phone || '512-555-0123'; T.render(); await sleep(5);
    ok(!!$('[data-act="call:cust"][data-id="' + dj.id + '"]'), L('Dee can call the customer'));
    set('callCust', false); await sleep(5);
    ok(!$('[data-act="call:cust"][data-id="' + dj.id + '"]'), L('Crew members can call the customer off: no Call for Dee'));
    set('callCust', true);
  } else ok(false, L('Dee has a job today'));
  click('[data-act="more:open"]'); await sleep(5);
  ok(!!($('[data-act="clk:in"]') || $('[data-act="clk:out"]')) && !!$('#more .sosrow [data-act="sos:open"], #more [data-act="sos:open"]'), L('Dee has the time clock, and Truck down in More'));
  click('[data-act="more:close"]'); await sleep(5);
  set('clock', false); set('truckDown', false); await sleep(5);
  ok(!$('[data-act="clk:in"]') && $('#fab').hidden && !$('#tabs .spacer') && !$('#view [data-act="sos:open"]'), L('Time clock and Truck down off: no clock card, no round button'));
  click('[data-act="more:open"]'); await sleep(5);
  ok(!$('#more .sosrow'), L('and no Truck down in More'));
  click('[data-act="more:close"]'); await sleep(5);
  ok(!/Not clocked in|On the clock/.test(view()), L('her Jobs screen has no clock line'));
  set('clock', true); set('truckDown', true);
  await endPreview();

  /* ---------------- the time clock's own switches ---------------- */
  // A late clock-out is measured from the last job that ended the same day, so the clock is pinned
  // to 3 PM today here (run just after midnight, "two hours ago" would be yesterday).
  const realNow = w.Date.now, at3 = (() => { const d = new w.Date(); d.setHours(15, 0, 0, 0); return d.getTime(); })();
  w.Date.now = () => at3;
  try {
    st().shifts = st().shifts.filter((x) => !(x.who === 'Marcus' && !x.outAt));   // clocked in earlier for Start job
    st().shifts.push({ id: 'sh-late', who: 'Marcus', inAt: at3 - 10 * H, outAt: 0, activity: 'Job day', note: '', late: 0 });
    const lastEnd = at3 - 2 * H;
    P.status = 'done'; P.finishedAt = lastEnd; P.phases.unloadEnd = lastEnd; T.render();
    await A.go('crew');
    const ms = $('#meSel'); if (ms) { ms.value = 'Marcus'; ms.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(10); }
    ok(/needs a note|Add a note to clock out/.test(view()), L('clocking out long after the last job asks for a note'));
    set('lateNote', false); await sleep(5);
    ok(!/needs a note|Add a note to clock out/.test(view()), L('Note for late clock-outs off: it doesn’t'));
    click('[data-act="clk:out"][data-who="Marcus"]'); await sleep(10);
    ok(st().shifts.find((x) => x.id === 'sh-late').outAt > 0, L('and clocking out goes through without one'));
    set('lateNote', true);
    set('clockGps', false); await sleep(5);
    ok(!!$('.tclock [data-act="clk:in"]') && !/location/i.test($('.tclock').textContent), L('Location while clocked in off: the clock card doesn’t mention sharing'));
    set('clockGps', true); await sleep(5);
    ok(/Your location is shared only while you’re clocked in\./.test($('.tclock').textContent), L('and on, it does'));
  } finally { w.Date.now = realNow; }

  /* ---------------- confirmations ---------------- */
  const HR = byName('Hollis & Reed Law');
  if (!HR.assign.crew.includes('Dee')) HR.assign.crew.push('Dee');
  if (HR.confirm) delete HR.confirm.Dee;
  await preview('crew', 'Dee');
  ok(/Confirm your jobs/.test(view()) && !!$('[data-act="jm:confirm"][data-id="' + HR.id + '"]'), L('Dee is asked to confirm Hollis & Reed on Today'));
  set('confirm', false); await sleep(5);
  ok(!/Confirm your jobs/.test(view()) && !$('[data-act="jm:confirm"]'), L('Crew confirm their jobs off: nothing to confirm on Today'));
  click('[data-act="tab"][data-tab="chat"]'); await sleep(10);
  ok(/Job messages\s*1 upcoming job/.test(view()) && !$('[data-act="chat:open"][data-t="jobs"]').parentNode.querySelector('.dot'), L('Chat lists Job messages with no count to confirm'));
  click('[data-act="chat:open"][data-t="jobs"]'); await sleep(10);
  ok(!$('[data-act="jm:confirm"]') && /Booked/.test(view()) && !/Confirm each one/.test(view()), L('Job messages just lists the jobs, each marked Booked'));
  set('confirm', true); await sleep(5);
  ok(!!$('[data-act="jm:confirm"][data-id="' + HR.id + '"]'), L('back on: the Confirm button is back'));
  await endPreview();

  /* ---------------- the office: dispatch's payments and revenue ---------------- */
  await preview('dispatch', 'Dispatch');
  ok(!!$('#tabs [data-act="tab"][data-tab="dispatch"]'), L('dispatch preview'));
  click('[data-act="more:open"]'); await sleep(5);
  ok(!!$('#more [data-act="more:go"][data-tab="reports"]') && /Revenue/.test($('#more').textContent), L('dispatch has Revenue'));
  click('[data-act="more:close"]'); await sleep(5);
  set('dispatchMoney', false); await sleep(5);
  click('[data-act="more:open"]'); await sleep(5);
  ok(!$('#more [data-act="more:go"][data-tab="reports"]'), L('Dispatch sees revenue off: no Revenue in More'));
  click('[data-act="more:close"]'); await sleep(5);
  click('[data-act="tab"][data-tab="today"]'); await sleep(10);
  ok(/to schedule/.test(view()) && !/still owed/.test(view()), L('and Today shows what’s to schedule instead of what’s owed'));
  set('dispatchMoney', true);
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + MT.id + '"]'); await sleep(15);
  ok(!!$('#sheet [data-act="flow:open"]') && !!$('#sheet [data-act="sh:addpay"]'), L('dispatch can collect and record payments'));
  set('dispatchPay', false); await sleep(5);
  ok(!$('#sheet [data-act="flow:open"]') && !$('#sheet [data-act="sh:addpay"]') && /The owner takes payments on this job\./.test($('#sheet').textContent), L('Dispatch can take payments off: no payment buttons, it says the owner takes them'));
  set('dispatchPay', true);
  click('[data-act="sheet:close"]'); await sleep(5);
  await endPreview();

  /* ---------------- ways to pay (the claude.ai copy's demo screen; the hosted ones are in pay.js) ---------------- */
  if (!w.tallyPay) {
    MT.payments = []; T.render();
    click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
    click('[data-act="job:open"][data-id="' + MT.id + '"]'); await sleep(15);
    click('#sheet [data-act="flow:open"]'); await sleep(15);
    const ways = () => $$('#flow [data-act="flow:method"]').map((b) => b.dataset.m).join();
    ok(/card,ach,other/.test(ways()), L('the demo offers card, bank and cash: ' + ways()));
    set('payCard', false); T.render(); await sleep(5);
    ok(!/card|ach/.test(ways()) && /other/.test(ways()), L('Typing a card in off: no card or bank'));
    set('payCash', false); await sleep(5);
    ok(ways() === 'vault', L('Cash and checks off too: just the card on file (' + ways() + ')'));
    set('payVault', false); await sleep(5);
    ok(ways() === 'other', L('every way off: cash and checks stay, so a payment can always be recorded (' + ways() + ')'));
    set('payCard', true); set('payCash', true); set('payVault', true);
    click('#flow [data-act="flow:close"]'); await sleep(5); click('[data-act="sheet:close"]'); await sleep(5);
  }

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
