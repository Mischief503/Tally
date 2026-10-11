// The drive back to the shop at bill-out. When the bill counts the drive from the shop, the crew lead
// finishes the job at the customer's, before the drive back. So before the customer signs and pays, a
// step asks for the drive back (a local move's minutes, a mileage move's miles so far plus the miles
// back), shows the bill it makes, and puts it on the bill. The office's own path skips it.
const { load, ok, sleep, summary, clone } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'driveback';
const L = (m) => label + ': ' + m;
const H = 36e5;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T } = A;
  const st = () => T.state();
  const byName = (n) => st().jobs.find((j) => j.d.name === n);
  const flow = () => $('#flow').hidden ? '' : $('#flow').textContent.replace(/\s+/g, ' ');
  const toastTxt = () => $('#toast').textContent;
  const more = async (t) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:go"][data-tab="' + t + '"]'); await sleep(15); };
  const type = (sel, v, blur) => { const e = $(sel); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); if (blur) e.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const clockLine = (j) => (j.extras.find((e) => e.id === 'clock') || {});
  const bill = (j) => Math.round((j.quote.total + j.extras.reduce((a, e) => a + e.amt, 0) + (j.materials || []).reduce((a, m) => a + (m.price == null ? 0 : m.qty * m.price), 0)) * 100) / 100;
  const sign = async () => { $('#sigName').value = 'Customer'; $('#sigAgree').checked = true; $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); click('#flow [data-act="flow:sign"]'); await sleep(15); };
  const S = st().settings;
  S.shopAddress = '1200 Industrial Blvd, Austin'; S.nteCap = false;
  st().ui.me = 'Marcus';
  // a local move 10 mi from the shop to the pickup, 8 mi moving, 15 mi back: the quote's drive back is 0.5 h
  const setUp = (name, d, startedHoursAgo, unloaded) => {
    const j = byName(name);
    Object.assign(j.d, { milesOut: '', miles: '', milesBack: '', flights: '', moveKind: '' }, d);
    j.quote = T.calc(j.d, S); j.extras = []; j.payments = []; j.signed = []; j.materials = []; j.costs = []; delete j.back; delete j.clockAt; delete j.clockSig; delete j.clockFix; delete j.milesDriven;
    const t0 = Date.now() - startedHoursAgo * H;
    Object.assign(j, { status: 'active', startedAt: t0, phases: unloaded ? { loadStart: t0 + 0.5 * H, loadEnd: t0 + 1.5 * H, unloadStart: t0 + 2 * H, unloadEnd: t0 + 3.5 * H } : { loadStart: t0 + 0.5 * H } });
    j.assign = { truckId: 't20', crew: ['Marcus', 'Kim'] };
    return j;
  };
  const N = setUp('Nadia Farouk', { milesOut: '10', miles: '8', milesBack: '15', items: { boxm: 60 } }, 5, true);
  ok(N.quote.kind === 'local' && N.quote.shopTravel && N.quote.backH === 0.5 && N.quote.hours === 3.5, L('a local move quoted with the drive from the shop: 3.5 h, 0.5 h of it the drive back'));

  /* ---------------- finishing on the field screen asks for the drive back first ---------------- */
  await more('crew');
  click('[data-act="cr:finish"][data-id="' + N.id + '"]'); await sleep(20);
  ok(/Before you bill out/.test(flow()) && /Drive back to the shop/.test(flow()) && N.status === 'active' && !N.clockAt && !N.back, L('Finish job opens "Drive back to the shop" first; the job is still open and not billed yet'));
  ok($('#backOut').textContent === '30min' && $('[data-act="back:set"][data-m="30"]').classList.contains('on'), L('it starts at the quote’s 30 minutes'));
  ok(/The quote estimated about 30 min \(15 mi from the delivery to the shop\)\./.test(flow()), L('and says where that came from'));
  const bb = () => $('#backBill').textContent.replace(/\s+/g, ' ');
  ok(/On the job.*Left the shop .* done unloading .*3h 30m/.test(bb()) && /Drive back to the shop ?30m/.test(bb()) && /Billed hours ?4 h/.test(bb()), L('the bill below: 3h 30m on the job + 30m back = 4 h: ' + bb()));
  const rate = N.quote.rate, fixed = N.quote.fixed;
  ok(new RegExp('Bill ?\\$' + (rate * 4 + fixed).toLocaleString('en-US')).test(bb()), L('at the rate: 4 h × $' + rate + ' + $' + fixed + ' = $' + (rate * 4 + fixed)));
  click('[data-act="back:mins"][data-d="-5"]'); await sleep(5);
  ok($('#backOut').textContent === '25min' && !$$('[data-act="back:set"]').some((c) => c.classList.contains('on')) && /Drive back to the shop ?25m/.test(bb()) && /Billed hours ?4 h/.test(bb()), L('−5: 25 minutes, still 4 h (3h 55m rounds up to the quarter hour)'));
  click('[data-act="back:mins"][data-d="5"]'); click('[data-act="back:mins"][data-d="5"]'); await sleep(5);
  ok($('#backOut').textContent === '35min' && /Billed hours ?4\.25 h/.test(bb()), L('+5 twice: 35 minutes, 4.25 h'));
  click('[data-act="back:set"][data-m="0"]'); await sleep(5);
  ok(/Drive back to the shop ?None/.test(bb()) && /Billed hours ?3\.5 h/.test(bb()), L('Already back: no drive back, 3.5 h'));
  click('[data-act="back:set"][data-m="45"]'); await sleep(5);
  ok($('[data-act="back:set"][data-m="45"]').classList.contains('on') && /Billed hours ?4\.25 h/.test(bb()), L('45 min: 4.25 h'));
  click('[data-act="back:ok"]'); await sleep(20);
  ok(N.back && N.back.mins === 45 && N.back.by === 'Marcus' && N.log.some((l) => l.ev === 'Drive back to the shop: 45m (Marcus)'), L('Add to the bill: 45 minutes from Marcus, in the job’s history'));
  ok(clockLine(N).label === 'By the clock: 3h 30m on the job + 45m back to the shop, billed 4.25 h (quoted 3.5 h)' && bill(N) === rate * 4.25 + fixed, L('the bill line says so: ' + clockLine(N).label + ' → $' + bill(N)));
  ok(/Sign to close the job/.test(flow()) && N.status === 'active', L('then the customer signs, and only then does the job close'));
  await sign();
  ok(N.status === 'done' && /Payment/.test(flow()) && flow().includes(('$' + (rate * 4.25 + fixed).toLocaleString('en-US'))), L('signed: finished, and the payment screen asks for the new bill'));
  ok(N.log.filter((l) => /^Billed by the clock/.test(l.ev)).length === 1, L('billed once: ' + N.log.filter((l) => /^Billed/.test(l.ev)).map((l) => l.ev).join(' / ')));
  click('#flow [data-act="flow:close"]'); await sleep(10);

  // ---- the field card shows it, and the lead can change it until the job is paid
  const card = () => $$('.crewcard').find((c) => c.querySelector('[data-act="back:open"][data-id="' + N.id + '"]'));
  ok(card() && /Drive back to the shop: 45m \(Marcus\) ?Change/.test(card().textContent), L('Bill out shows the drive back with a Change button'));
  ok(/Drive back to the shop ?about 45m, at bill-out/.test(card().textContent), L('and the job’s times end with the drive back'));
  click('[data-act="back:open"][data-id="' + N.id + '"]'); await sleep(15);
  ok(/Drive back to the shop/.test(flow()) && $('#backOut').textContent === '45min', L('Change opens the step on 45 minutes'));
  click('[data-act="back:set"][data-m="30"]'); await sleep(5);
  click('[data-act="back:ok"]'); await sleep(20);
  ok(N.back.mins === 30 && bill(N) === rate * 4 + fixed && /Bill: \$/.test(toastTxt()) && N.log.some((l) => /^Billed by the clock: 4 h, .*\(drive back changed by Marcus\)$/.test(l.ev)), L('30 minutes: the bill drops to 4 h, and the history says why'));
  ok(/Payment/.test(flow()), L('and it goes on to the payment'));
  click('#flow [data-act="flow:close"]'); await sleep(10);

  // ---- the office sees where the number came from
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + N.id + '"]'); await sleep(15);
  ok(/On the clock 3h 30m, plus 30m back to the shop \(from Marcus at bill-out\): billed 4 h\./.test($('#sheet').textContent), L('job sheet: "plus 30m back to the shop (from Marcus at bill-out)"'));
  ok(/Drive back to the shop ?about 30m, at bill-out/.test($('#sheet').textContent), L('and its on-site times show it'));
  click('[data-act="sheet:close"]'); await sleep(5);

  /* ---------------- leaving the step changes nothing ---------------- */
  const HR = setUp('Hollis & Reed Law', { milesOut: '6', miles: '8', milesBack: '12', items: { boxm: 60 } }, 5, true);
  await more('crew');
  click('[data-act="cr:finish"][data-id="' + HR.id + '"]'); await sleep(20);
  ok(/Drive back to the shop/.test(flow()) && $('#backOut').textContent === '25min', L('12 mi back at 30 mph: the step starts at 25 minutes (rounded to 5)'));
  click('#flow [data-act="flow:close"]'); await sleep(10);
  ok(HR.status === 'active' && !HR.back && !HR.clockAt && !HR.extras.length && /The job stays open until you bill out\./.test(toastTxt()), L('Exit: the job stays open and unbilled, and the lead is told'));

  /* ---------------- Collect payment from Bill out asks first too, then finishing doesn't ask again ---------------- */
  HR.signed.push({ id: 's-hr', formId: 'f_deliv', title: 'Delivery receipt and release', name: 'Hollis', sig: '', ts: Date.now(), by: 'Marcus' });
  T.render(); await sleep(10);
  const hrCard = $$('.crewcard').find((c) => c.querySelector('[data-act="cr:finish"][data-id="' + HR.id + '"]'));
  ok(hrCard && /The drive back to the shop goes on the bill when you bill out\./.test(hrCard.textContent), L('before bill-out, the Bill out panel says the drive back comes then'));
  click($$('[data-act="flow:open"][data-id="' + HR.id + '"]')[0]); await sleep(20);
  ok(/Drive back to the shop/.test(flow()), L('Collect payment on an unloaded job opens the drive-back step'));
  click('[data-act="back:ok"]'); await sleep(20);
  ok(HR.back && HR.back.mins === 25 && HR.clockAt > 0 && HR.status === 'active' && /Payment/.test(flow()), L('in with 25 minutes: billed now, so the payment is for the right amount; the job is still open'));
  click('#flow [data-act="flow:close"]'); await sleep(10);
  click('[data-act="cr:finish"][data-id="' + HR.id + '"]'); await sleep(20);
  ok(HR.status === 'done' && !/Drive back to the shop/.test(flow()) && HR.log.filter((l) => /^Billed by the clock/.test(l.ev)).length === 1, L('Finish job afterwards goes straight on: no second ask, billed once'));
  click('#flow [data-act="flow:close"]'); await sleep(10);

  /* ---------------- the office's own path skips it ---------------- */
  const P = setUp('Priya Nair', { milesOut: '10', miles: '8', milesBack: '15', items: { boxm: 60 } }, 5, true);
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + P.id + '"]'); await sleep(15);
  click('#sheet [data-act="sh:next"]'); await sleep(20);
  ok(!/Drive back to the shop/.test(flow()) && /Sign to close the job/.test(flow()) && P.clockAt > 0 && !P.back, L('finishing from the job sheet: straight to signing, billed with the quote’s drive back'));
  click('#flow [data-act="flow:close"]'); await sleep(10);
  ok(/On the clock 3h 30m, plus about 30m back to the shop: billed 4 h\./.test($('#sheet').textContent), L('the sheet says "about 30m", the quote’s estimate'));
  click($$('#sheet [data-act="flow:open"]')[0]); await sleep(20);
  ok(!/Drive back to the shop/.test(flow()), L('and the office’s Collect payment skips the step'));
  click('#flow [data-act="flow:close"]'); await sleep(5);
  click('[data-act="sheet:close"]'); await sleep(5);
  // with the form already signed, finishing from the sheet goes straight to the payment
  const LW = setUp('Lena Wu', { milesOut: '10', miles: '8', milesBack: '15', items: { boxm: 60 } }, 5, true);
  LW.signed.push({ id: 's-lw', formId: 'f_deliv', title: 'Delivery receipt and release', name: 'Lena', sig: '', ts: Date.now(), by: 'Marcus' });
  T.render(); click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + LW.id + '"]'); await sleep(15);
  click('#sheet [data-act="sh:next"]'); await sleep(20);
  ok(LW.status === 'done' && !/Drive back to the shop/.test(flow()) && /Payment/.test(flow()), L('finishing a signed job from the sheet: done, and straight to the payment'));
  click('#flow [data-act="flow:close"]'); await sleep(5);
  click('[data-act="sheet:close"]'); await sleep(5);
  // the customer pays on another phone while the step is open: the step gives way
  await more('crew');
  click($$('[data-act="flow:open"][data-id="' + LW.id + '"]')[0]); await sleep(20);
  ok(/Drive back to the shop/.test(flow()), L('the lead opens Collect payment on that job: the drive-back step'));
  LW.payments.push({ id: 'p-lw', amt: 99999, method: 'Pay link', date: '2026-10-01', ts: Date.now() }); LW.status = 'paid';
  T.render(); await sleep(10);
  ok(!/Drive back to the shop/.test(flow()) && /Paid in full/.test(flow()), L('paid meanwhile: the step goes, and the receipt shows'));
  click('#flow [data-act="flow:close"]'); await sleep(5);
  // the office's own hours take over: no step, no Change
  N.clockFix = { hours: 5 }; T.render(); await more('crew');
  ok(!$('[data-act="back:open"][data-id="' + N.id + '"]'), L('once the office sets the hours, the lead can’t change the drive back'));
  delete N.clockFix;

  /* ---------------- a mileage move: the odometer at Start job and at bill-out, plus the miles back ---------------- */
  const O = setUp('Ortega family', { milesOut: '10', miles: '90', milesBack: '25', items: { boxm: 60 } }, 12, true);
  ok(O.quote.kind === 'mileage' && O.quote.miles === 125 && O.quote.shopTravel, L('a mileage move: 10 + 90 + 25 = 125 mi from the shop and back'));
  O.status = 'booked'; delete O.startedAt; O.phases = {}; O.signed.push({ id: 's-o', formId: 'f_deliv', title: 'Delivery receipt and release', name: 'Ortega', sig: '', ts: Date.now(), by: 'Marcus' });
  T.render(); await sleep(10);
  click('[data-act="cr:start"][data-id="' + O.id + '"]'); await sleep(10);
  ok(/Odometer leaving the shop/.test($('#start').textContent) && !!$('#odoStartIn'), L('Start job on a mileage move asks for the odometer leaving the shop'));
  type('#odoStartIn', '45210');
  click('#start [data-act="go:set"][data-m="45"]'); await sleep(5);
  ok($('#odoStartIn').value === '45210', L('the reading stays while the arrival time changes'));
  click('#start [data-act="go:start"]'); await sleep(20);
  ok(O.status === 'active' && O.odo && O.odo.start === 45210 && O.odo.by === 'Marcus' && O.log.some((l) => l.ev === 'Odometer leaving the shop: 45,210 (Marcus)'), L('started with 45,210 on the odometer, in the job’s history'));
  const t0 = Date.now() - 12 * H;
  Object.assign(O, { startedAt: t0, phases: { loadStart: t0 + 0.5 * H, loadEnd: t0 + 1.5 * H, unloadStart: t0 + 5 * H, unloadEnd: t0 + 6.5 * H } });
  T.render(); await sleep(10);
  ok($('[data-odo="' + O.id + '"]').value === '45210' && !$('[data-mdrive="' + O.id + '"]'), L('the job card shows the odometer leaving the shop (no miles-driven box)'));
  type('[data-odo="' + O.id + '"]', '45200', true); await sleep(10);
  ok(O.odo.start === 45200 && /Saved: 45,200 on the odometer\./.test(toastTxt()), L('the lead can fix it from the card'));
  type('[data-odo="' + O.id + '"]', '45210', true); await sleep(10);
  click('[data-act="cr:finish"][data-id="' + O.id + '"]'); await sleep(20);
  ok(/Miles for the bill/.test(flow()) && $('#odoA').value === '45210' && $('#odoB').value === '' && $('#backMi').value === '25', L('bill-out: the start reading is in, the odometer now is asked for, and the quote’s 25 mi back to start with'));
  ok(!$('#backOut') && !/min/.test($$('#flow .chip').map((c) => c.textContent).join('')), L('a mileage move adds miles, never time'));
  ok(/This copy of Tally can’t look up the drive, so this is the quote’s 25 mi from the delivery to the shop\./.test(flow()) || /The quote’s 25 mi/.test(flow()), L('without a map service here, it says the miles back are the quote’s'));
  ok(/Put in both odometer readings to see the bill\./.test(bb()), L('no bill until the odometer now is in'));
  type('#odoB', '45200'); await sleep(5);
  ok(/has to be more than when the truck left/.test(bb()), L('a reading below the start is caught'));
  click('[data-act="back:ok"]'); await sleep(10);
  ok(/The odometer now has to be more than when the truck left the shop\./.test($('#flowErr').textContent) && !O.back, L('and not saved'));
  type('#odoB', '45311'); await sleep(5);
  ok(/Odometer ?45,210 → 45,311 ?101 mi/.test(bb()) && /Back to the shop \(the quote’s\) ?25 mi/.test(bb()) && /Miles on the bill ?126 mi/.test(bb()), L('45,311 now: 101 mi on the odometer + 25 back = 126 mi: ' + bb()));
  type('#backMi', '30'); await sleep(5);
  ok(/Back to the shop \(typed in\) ?30 mi/.test(bb()) && /Miles on the bill ?131 mi/.test(bb()), L('typing 30 mi back: 131 mi'));
  click('[data-act="back:ok"]'); await sleep(20);
  ok(O.back && O.back.mi === 30 && O.back.soFar === 101 && O.back.odoStart === 45210 && O.back.odoEnd === 45311 && O.back.src === 'typed' && O.milesDriven === 131, L('in: 101 mi on the odometer + 30 back = 131 mi'));
  ok(O.log.some((l) => l.ev === 'Odometer 45,210 to 45,311: 101 mi, plus 30 mi back to the shop (typed in): 131 mi in all (Marcus)'), L('and the history says how: ' + O.log.slice(-2).map((l) => l.ev).join(' / ')));
  ok(/^By the clock: 2h 30m loading and unloading, billed 3 h, 131 mi driven incl\. 30 mi back to the shop \(quoted 3 h, 125 mi\)$/.test(clockLine(O).label || '') && clockLine(O).amt === 9, L('the bill line, +6 mi at $1.50: ' + clockLine(O).label));
  click('#flow [data-act="flow:close"]'); await sleep(10);
  const oCard = $$('.crewcard').find((c) => c.querySelector('[data-act="back:open"][data-id="' + O.id + '"]'));
  ok(oCard && /Miles: 101 on the odometer \+ 30 back to the shop typed in \(Marcus\) ?Change/.test(oCard.textContent) && !$('[data-odo="' + O.id + '"]'), L('Bill out shows the miles with Change; the odometer box is gone'));
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + O.id + '"]'); await sleep(15);
  ok(/131 mi driven, from the crew \(odometer 45,210 to 45,311, 101 mi, plus 30 mi back to the shop typed in; Marcus at bill-out\)\./.test($('#sheet').textContent), L('the job sheet spells it out'));
  click('[data-act="sheet:close"]'); await sleep(5);
  await more('crew');
  click('[data-act="back:open"][data-id="' + O.id + '"]'); await sleep(15);
  ok($('#odoA').value === '45210' && $('#odoB').value === '45311' && $('#backMi').value === '30', L('Change opens with the readings'));
  click('#flow [data-act="flow:close"]'); await sleep(5);

  // no reading from Start job: the miles so far instead
  const C2 = setUp('Chloe Martin', { milesOut: '10', miles: '90', milesBack: '25', items: { boxm: 60 } }, 12, true);
  Object.assign(C2.phases, { unloadStart: C2.startedAt + 5 * H, unloadEnd: C2.startedAt + 6.5 * H });
  C2.signed.push({ id: 's-c2', formId: 'f_deliv', title: 'Delivery receipt and release', name: 'Chloe', sig: '', ts: Date.now(), by: 'Marcus' });
  T.render(); await sleep(10);
  click('[data-act="cr:finish"][data-id="' + C2.id + '"]'); await sleep(20);
  ok($('#odoA').value === '' && /No reading from when the truck left\?/.test(flow()), L('no start reading: it offers to type the miles so far instead'));
  click('[data-act="back:ok"]'); await sleep(10);
  ok(/Put in the odometer from when the truck left the shop, or type the miles so far instead\./.test($('#flowErr').textContent), L('Add without it says what to do'));
  click('[data-act="back:mode"][data-m="sofar"]'); await sleep(10);
  ok($('#backSoFar').value === '100' && /Miles so far \(typed\) ?100 mi/.test(bb()) && /Miles on the bill ?125 mi/.test(bb()), L('miles so far, starting at the quote’s 100 mi to the delivery: 125 mi'));
  click('[data-act="back:ok"]'); await sleep(20);
  ok(C2.back && C2.back.soFar === 100 && C2.back.odoStart === null && C2.back.src === 'quote' && C2.milesDriven === 125 && C2.log.some((l) => l.ev === 'Miles so far: 100, plus 25 mi back to the shop (the quote’s): 125 mi in all (Marcus)'), L('in: 100 typed + the quote’s 25 back'));
  click('#flow [data-act="flow:close"]'); await sleep(5);

  // an older job whose lead typed the miles in the old box: the step starts from them
  const D2 = setUp('Devon Reyes', { milesOut: '10', miles: '90', milesBack: '25', items: { boxm: 60 } }, 12, true);
  Object.assign(D2.phases, { unloadStart: D2.startedAt + 5 * H, unloadEnd: D2.startedAt + 6.5 * H }); D2.milesDriven = 88;
  D2.signed.push({ id: 's-d2', formId: 'f_deliv', title: 'Delivery receipt and release', name: 'Devon', sig: '', ts: Date.now(), by: 'Marcus' });
  T.render(); await sleep(10);
  click('[data-act="cr:finish"][data-id="' + D2.id + '"]'); await sleep(20);
  ok($('#backSoFar') && $('#backSoFar').value === '88', L('miles typed before this change: the step starts from them'));
  click('#flow [data-act="flow:close"]'); await sleep(5);

  // a local move's Start job has no odometer
  const G2 = setUp('Grace Pham', { milesOut: '5', miles: '6', milesBack: '5', items: { boxm: 60 } }, 1, false);
  G2.status = 'booked'; delete G2.startedAt; G2.phases = {}; T.render(); await sleep(10);
  click('[data-act="cr:start"][data-id="' + G2.id + '"]'); await sleep(10);
  ok(G2.quote.kind === 'local' && !$('#odoStartIn'), L('a local move’s Start job asks for no odometer'));
  click('#start [data-act="go:close"]'); await sleep(5);

  /* ---------------- when the bill doesn't count the drive from the shop, nothing changes ---------------- */
  S.shopAddress = '';
  const K = setUp('Sam Kowalski', { miles: '8', items: { boxm: 60 }, moveDate: '', time: '08:00' }, 4, true);
  K.signed.push({ id: 's-k', formId: 'f_deliv', title: 'Delivery receipt and release', name: 'Sam', sig: '', ts: Date.now(), by: 'Marcus' });
  ok(!K.quote.shopTravel, L('no shop address: the drive from the shop isn’t counted'));
  T.render(); await sleep(10);
  click('[data-act="cr:finish"][data-id="' + K.id + '"]'); await sleep(20);
  ok(!/Drive back to the shop/.test(flow()) && K.status === 'done' && /Payment/.test(flow()), L('finishing goes straight to the payment, as before'));
  click('#flow [data-act="flow:close"]'); await sleep(10);

  /* ---------------- paid: nothing to change ---------------- */
  N.payments.push({ id: 'p-n', amt: 9999, method: 'Cash', date: '2026-10-01', ts: Date.now() }); N.status = 'paid'; T.render(); await sleep(10);
  ok(!$('[data-act="back:open"][data-id="' + N.id + '"]'), L('a paid job has no Change button'));

  /* ---------------- saved with the job; older jobs keep their bill signature ---------------- */
  const doc = T.jobDoc(HR);
  ok(doc.back && doc.back.mins === 25 && doc.back.by === 'Marcus' && doc.back.mi === null, L('the drive back is saved with the job, every key written'));
  ok(!/\|b:/.test(T.clockSig(P)) && /\|b:25,,$/.test(T.clockSig(HR)), L('the bill signature only changes for jobs with a drive back: ' + T.clockSig(HR).slice(-12)));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));

  /* ---------------- hosted: the lead's drive back reaches the office ---------------- */
  if (/supabase/.test(file)) {
    const ORG = 'org-d', t0 = Date.now() - 5 * H;
    const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
    put('meta/init', { ts: 1 });
    const settings = { company: 'Ace Moving', crew: ['Marcus', 'Dee'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }], contacts: {}, trucks: [{ id: 't20', name: 'Box 2', cf: 1000 }], forms: [], shopAddress: '1 Shop Rd', nteCap: false };
    put('org/settings', settings);
    const q = T.calc(Object.assign({}, N.d, { milesOut: '10', miles: '8', milesBack: '15', items: { boxm: 60 }, flights: '' }), Object.assign(clone(S), settings));
    put('jobs/d1', { id: 'd1', status: 'active', createdAt: t0 - 864e5, startedAt: t0, phases: { loadStart: t0 + 0.5 * H, loadEnd: t0 + 1.5 * H, unloadStart: t0 + 2 * H, unloadEnd: t0 + 3.5 * H },
      d: { name: 'Hosted move', phone: '', email: '', source: 'Google', moveDate: '', time: '08:00', from: 'A', to: 'B', miles: '8', milesOut: '10', milesBack: '15', flights: '', pack: false, crew: '', truckId: '', hoursOverride: '', discount: '', notes: '', custom: {}, items: [{ id: 'boxm', q: 60 }], moveKind: '' },
      quote: q, items: [], assign: { truckId: 't20', crew: ['Marcus'] }, tally: {}, payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} });
    const db = { docs, access_requests: [], comm_log: [], comm_lines: [],
      members: [{ org_id: ORG, user_id: 'u-o', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-m', email: 'm@x', staff: 'Marcus', role: 'lead', ts: 1 }] };
    const M = await load(file, { db, org: ORG, me: { uid: 'u-m', email: 'm@x' } });
    if (M.$('[data-act="tab"][data-tab="crew"]')) M.click('[data-act="tab"][data-tab="crew"]'); else { M.click('[data-act="more:open"]'); await sleep(5); M.click('[data-act="more:go"][data-tab="crew"]'); }
    await sleep(20);
    M.click('[data-act="cr:finish"][data-id="d1"]'); await sleep(30);
    ok(/Drive back to the shop/.test(M.$('#flow').textContent), L('hosted: the lead’s phone asks for the drive back'));
    M.click('[data-act="back:set"][data-m="45"]'); await sleep(5);
    M.click('[data-act="back:ok"]'); await sleep(500);
    const row = db.docs.find((r) => r.path === 'jobs/d1').data;
    ok(row.back && row.back.mins === 45 && row.back.by === 'Marcus' && row.status === 'done' && row.extras.clock && /\+ 45m back to the shop/.test(row.extras.clock.label), L('hosted: the drive back, the bill line and the finished job reach the database'));
    const O2 = await load(file, { db, org: ORG, me: { uid: 'u-o', email: 'o@x' } });
    O2.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
    O2.click('[data-act="job:open"][data-id="d1"]'); await sleep(30);
    ok(/plus 45m back to the shop \(from Marcus at bill-out\)/.test(O2.$('#sheet').textContent), L('hosted: the office’s phone shows where the 45 minutes came from'));
    ok(M.errors.length === 0 && O2.errors.length === 0, L('hosted: no errors (' + M.errors.concat(O2.errors).slice(0, 3).join(' | ') + ')'));
  }
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
