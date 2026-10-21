// The time clock card (Richie, Oct 12/14: "This is what i would like the clock in for employees to look
// like. And they will clock in then when everyone is clocked in the lead can start the job. When the lead
// starts the job the assigned employees are logged on the job."): the card on Today and the crew's Jobs screen with
// Clock In, Break / End break, Clock Out and the day's paid time without breaks; Start job waiting for
// everyone on the job to clock in; the crew logged on the job when it starts, on and off as they clock
// in and out or are added or taken off; and what the office sees.
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'clockjob';
const L = (m) => label + ': ' + m;
const H = 36e5, M = 6e4;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T } = A;
  const st = () => T.state(), S = st().settings;
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const card = () => $('.tclock');
  const cardTxt = () => (card() ? card().textContent.replace(/\s+/g, ' ') : '');
  const toastTxt = () => $('#toast').textContent;
  const open = (n) => st().shifts.find((x) => x.who === n && !x.outAt);
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  const endPreview = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const P = st().jobs.find((j) => j.d.name === 'Priya Nair');
  const crewCard = (j) => $('#view .crewcard[data-job="' + j.id + '"]');
  ok(P.status === 'booked' && P.assign.crew.join() === 'Marcus,Dee,Luis', L('sample: Priya Nair today, Marcus (lead), Dee and Luis'));

  /* ---------------- Dee's clock card ---------------- */
  await preview('crew', 'Dee');
  ok(T.ui.tab === 'crew' && /^Good (morning|afternoon|evening), Dee$/.test($('#view .hero-day h1').textContent) && !!card() && $('.tclock [data-act="clk:in"]').textContent === 'Clock In' && !!(($('#view .hero-day').compareDocumentPosition(card())) & 4), L('her Jobs screen starts with good morning, Dee and the clock card with Clock In'));
  ok(/0h 0m ?paid today \(breaks not counted\)/.test(cardTxt()) && /Your location is shared only while you’re clocked in\./.test(cardTxt()), L('the day’s paid time (0h 0m) and the location line'));
  ok(!!$('#clkAct') && $$('#clkAct option').length === S.activities.length, L('she can pick what she’s clocking in for'));
  $('#clkAct').value = 'Warehouse';
  click('.tclock [data-act="clk:in"]'); await sleep(10);
  const d1 = open('Dee');
  ok(d1 && d1.activity === 'Warehouse' && /On the clock/.test(cardTxt()) && /Warehouse since \d{1,2}:\d\d [AP]M/.test(cardTxt()), L('Clock In: on the clock, for Warehouse: ' + cardTxt()));
  ok($('.tclock [data-act="clk:break"]').textContent === 'Break' && $('.tclock [data-act="clk:out"]').textContent === 'Clock Out' && !$('.tclock [data-act="clk:in"]'), L('two big buttons now: Break and Clock Out'));
  click('.tclock [data-act="clk:break"]'); await sleep(10);
  ok(d1.breaks.length === 1 && !d1.breaks[0].e && /On break/.test(cardTxt()) && $('.tclock [data-act="clk:break"]').textContent === 'End break' && /Breaks aren’t paid/.test(toastTxt()), L('Break: on break, the button says End break'));
  click('.tclock [data-act="clk:break"]'); await sleep(10);
  ok(d1.breaks[0].e > 0 && /On the clock/.test(cardTxt()) && /Back on the clock/.test(toastTxt()), L('End break: back on the clock'));
  // three hours on the clock with a half-hour break: 2h 30m paid. The clock is pinned to 3 PM today, since
  // "paid today" counts from midnight (run just after midnight, three hours ago would be yesterday).
  const realNow = w.Date.now, now = (() => { const d = new w.Date(); d.setHours(15, 0, 0, 0); return d.getTime(); })();
  w.Date.now = () => now;
  d1.inAt = now - 3 * H; d1.breaks = [{ s: now - 2 * H, e: now - 1.5 * H }]; T.render(); await sleep(10);
  ok(Math.round(T.paidToday('Dee') / M) === 150 && /2h 30m ?paid today/.test(cardTxt()), L('3 hours with a 30-minute break: 2h 30m paid today'));
  click('[data-act="tab"][data-tab="crew"]'); await sleep(10);
  ok(!!card() && /2h 30m/.test(cardTxt()), L('tapping Jobs again: the same card, 2h 30m'));
  ok(/You’re clocked in\. Your crew lead starts the job\./.test(crewCard(P).textContent), L('her job card says her lead starts the job'));
  click('.tclock [data-act="clk:out"]'); await sleep(10);
  ok(d1.outAt > 0 && /Clocked out after 2h 30m \(breaks not counted\)/.test(toastTxt()) && !!$('.tclock [data-act="clk:in"]') && !/On the clock/.test(cardTxt()) && /2h 30m ?paid today/.test(cardTxt()), L('Clock Out: 2h 30m, Clock In again, and the day’s total stays'));
  ok(/Clock in so your crew lead can start the job\./.test(crewCard(P).textContent), L('clocked out, her card tells her to clock in so the job can start'));
  w.Date.now = realNow;
  // a break left on when clocking out ends there
  click('.tclock [data-act="clk:in"]'); await sleep(10);
  click('.tclock [data-act="clk:break"]'); await sleep(5);
  click('.tclock [data-act="clk:out"]'); await sleep(10);
  const d2 = st().shifts.filter((x) => x.who === 'Dee').pop();
  ok(d2.outAt > 0 && d2.breaks[0].e === d2.outAt, L('clocking out on a break ends the break too'));
  await endPreview();

  /* ---------------- Start job waits for everyone ---------------- */
  await preview('lead', 'Marcus');
  ok(!!card() && /, Marcus$/.test($('#view .hero-day h1').textContent), L('Marcus has the card on his Jobs screen too'));
  click('.tclock [data-act="clk:in"]'); await sleep(10);
  await A.go('crew');
  let cc = crewCard(P), ct = cc.textContent.replace(/\s+/g, ' ');
  const sb = () => $('[data-act="cr:start"][data-id="' + P.id + '"]');
  ok(/Crew: Marcus \(lead\) ✓, Dee, Luis/.test(ct) && /✓ clocked in/.test(ct), L('the crew line ticks who is clocked in: ' + ct.match(/Crew:[^✓]*✓[^C]*/)));
  ok(!sb().classList.contains('primary') && /Waiting on Dee and Luis to clock in\. Start job opens when everyone on the job is clocked in\./.test(ct), L('Start job isn’t lit, and says who it’s waiting on'));
  click(sb()); await sleep(10);
  ok(P.status === 'booked' && $('#start').hidden && /Waiting on Dee and Luis to clock in/.test(toastTxt()), L('tapping it anyway only says who it’s waiting on'));
  A.clockIn('Dee'); await sleep(5);
  ok(/Waiting on Luis to clock in/.test(crewCard(P).textContent), L('Dee clocks in: now it waits on Luis'));
  A.clockIn('Luis'); await sleep(5);
  cc = crewCard(P); ct = cc.textContent.replace(/\s+/g, ' ');
  ok(sb().classList.contains('primary') && /Everyone on the job is clocked in\./.test(ct) && /Marcus \(lead\) ✓, Dee ✓, Luis ✓/.test(ct), L('everyone in: Start job lights up'));
  click(sb()); await sleep(10);
  ok(!$('#start').hidden, L('Start job opens the start screen'));
  const t0 = Date.now();
  click('#start [data-act="go:start"]'); await sleep(15);
  ok(P.status === 'active' && ['Marcus', 'Dee', 'Luis'].every((n) => (P.crewOn[n] || []).length === 1 && P.crewOn[n][0].in >= t0 - 1000 && !P.crewOn[n][0].out), L('started: Marcus, Dee and Luis are logged on the job from now'));
  ok(P.log.some((l) => l.ev === 'Crew on the job: Marcus, Dee, Luis') && /On the job: Marcus, Dee and Luis\./.test(toastTxt()), L('the job’s Activity and the toast name them: ' + toastTxt() + ' | ' + P.log.slice(-3).map((l) => l.ev).join(' / ')));
  click('[data-act="tab"][data-tab="crew"]'); await sleep(10);
  ok(/On the job: Priya Nair since \d{1,2}:\d\d [AP]M/.test(cardTxt()), L('Marcus’s clock card says he’s on the job'));
  await endPreview();

  /* ---------------- on and off the job while it runs ---------------- */
  await preview('crew', 'Luis');
  ok(/On the job: Priya Nair/.test(cardTxt()), L('Luis’s card says he’s on the job too'));
  click('.tclock [data-act="clk:out"]'); await sleep(10);
  ok(P.crewOn.Luis[0].out > 0 && P.log.some((l) => /^Luis off the job at .* \(clocked out\)$/.test(l.ev)), L('Luis clocks out: off the job, in its Activity'));
  click('.tclock [data-act="clk:in"]'); await sleep(10);
  ok(P.crewOn.Luis.length === 2 && !P.crewOn.Luis[1].out && /Clocked in\. You’re on the job at Priya Nair\./.test(toastTxt()), L('and back in: on the job again'));
  await endPreview();
  // the office changes the crew while it runs
  A.clockIn('Kim');
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + P.id + '"]'); await sleep(20);
  click($$('#sheet [data-act="sh:crew"]').find((b) => b.dataset.n === 'Dee')); await sleep(10);
  ok(P.crewOn.Dee[0].out > 0 && P.log.some((l) => /^Dee off the job at .* \(taken off the crew\)$/.test(l.ev)), L('taking Dee off the crew takes her off the job'));
  click($$('#sheet [data-act="sh:crew"]').find((b) => b.dataset.n === 'Kim')); await sleep(10);
  ok(P.crewOn.Kim && P.crewOn.Kim.length === 1 && !P.crewOn.Kim[0].out, L('adding Kim, who is clocked in, puts her on the job'));
  click($$('#sheet [data-act="sh:crew"]').find((b) => b.dataset.n === 'Andre')); await sleep(10);
  ok(!P.crewOn.Andre, L('adding Andre, who isn’t clocked in, waits for him to clock in'));
  const sheet = () => $('#sheet').textContent.replace(/\s+/g, ' ');
  ok(/Crew on the job/.test(sheet()) && /Andre ?Not clocked in yet/.test(sheet()) && /Kim ?\d{1,2}:\d\d [AP]M to now/.test(sheet()), L('the job sheet lists each person’s time on the job'));
  // finish: everyone comes off at the finish
  Object.assign(P, { startedAt: Date.now() - 3 * H, phases: { loadStart: Date.now() - 2.9 * H, loadEnd: Date.now() - 2 * H, unloadStart: Date.now() - 1.5 * H, unloadEnd: Date.now() - 10 * M } });
  ['Marcus', 'Luis', 'Kim'].forEach((n) => { const sg = P.crewOn[n]; sg[sg.length - 1].in = Date.now() - 2 * H; });
  P.signed = (P.signed || []).concat(T.state().settings.forms.filter((f) => f.required).map((f) => ({ id: 'sg_' + f.id, formId: f.id, title: f.title, name: 'Priya', sig: '', ts: Date.now(), by: 'Marcus' })));
  T.render(); await sleep(10);
  const stSel = $('#sheet select[data-jstatus]'); stSel.value = 'done'; stSel.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(15);
  ok(P.status === 'done' && Object.keys(P.crewOn).every((n) => P.crewOn[n].every((x) => x.out > 0)), L('the job finishes: everyone is off it'));
  ok(Math.round(T.crewMs(P, 'Kim') / M) === 120 && /Kim.*2h 0m/.test(sheet()), L('Kim’s 2 hours on the job show on the sheet'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);

  /* ---------------- the office: who's clocked in before the start ---------------- */
  const N = st().jobs.find((j) => j.d.name === 'Nadia Farouk');
  st().shifts.forEach((x) => { if (!x.outAt) x.outAt = Date.now(); });
  A.clockIn('Marcus'); await sleep(5);
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + N.id + '"]'); await sleep(20);
  ok(/Clocked in: Marcus/.test(sheet()) && /Not clocked in: Kim/.test(sheet()) && /The crew lead can start the job once everyone is clocked in\./.test(sheet()), L('Nadia’s sheet shows who’s clocked in and who isn’t'));
  click('#sheet [data-act="sh:next"]'); await sleep(10);
  ok(!$('#start').hidden, L('the office’s Start job doesn’t wait'));
  click('#start [data-act="go:start"]'); await sleep(15);
  ok(N.status === 'active' && N.crewOn.Marcus && !N.crewOn.Kim && N.log.some((l) => l.ev === 'Crew on the job: Marcus. Not clocked in yet: Kim'), L('started by the office: Marcus is on, Kim goes on when she clocks in'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  A.clockIn('Kim'); await sleep(5);
  // A.clockIn writes the shift directly; the app's clock-in puts her on the job
  st().shifts = st().shifts.filter((x) => !(x.who === 'Kim' && !x.outAt));
  await preview('crew', 'Kim');
  click('.tclock [data-act="clk:in"]'); await sleep(10);
  ok(N.crewOn.Kim && N.crewOn.Kim.length === 1 && /Clocked in\. You’re on the job at Nadia Farouk\./.test(toastTxt()), L('Kim clocks in and is on the job'));
  await endPreview();

  /* ---------------- the owner on a job today gets the card on Today ---------------- */
  click('[data-act="tab"][data-tab="today"]'); await sleep(10);
  ok(!card(), L('the owner’s Today has no clock card when they aren’t on a job'));
  const HR = st().jobs.find((j) => j.d.name === 'Hollis & Reed Law');
  HR.d.moveDate = P.d.moveDate; HR.assign.crew.push('Owner'); T.render(); await sleep(10);
  ok(!!card() && /^Owner/.test(cardTxt()) && /Clocked out/.test(cardTxt()), L('on a job today: the owner’s clock card is at the top of Today'));

  /* ---------------- Options ---------------- */
  // Everyone clocks in before Start job: off
  S.opt.clockFirst = false;
  HR.assign.crew = ['Tanya', 'Andre']; st().shifts.forEach((x) => { if (!x.outAt) x.outAt = Date.now(); });
  await preview('lead', 'Tanya'); await A.go('crew'); await A.openCard(HR.id);
  const hb = $('[data-act="cr:start"][data-id="' + HR.id + '"]');
  ok(hb && hb.classList.contains('primary') && !/Waiting on/.test(crewCard(HR).textContent), L('switch off: Start job doesn’t wait'));
  click(hb); await sleep(10);
  ok(!$('#start').hidden, L('and opens straight away'));
  click('#start [data-act="go:close"]'); await sleep(5);
  await endPreview();
  S.opt.clockFirst = true;
  // the time clock off: no card, nothing to wait for, everyone on the job at the start
  S.opt.clock = false; T.render();
  await preview('lead', 'Tanya'); await A.go('crew'); await A.openCard(HR.id);
  ok(!card() && $('[data-act="cr:start"][data-id="' + HR.id + '"]').classList.contains('primary'), L('Time clock off: no card, and Start job doesn’t wait'));
  click('[data-act="cr:start"][data-id="' + HR.id + '"]'); await sleep(10);
  click('#start [data-act="go:start"]'); await sleep(15);
  ok(HR.status === 'active' && HR.crewOn.Tanya && HR.crewOn.Andre, L('and everyone on the job is logged on at the start'));
  await endPreview();
  S.opt.clock = true; T.render();
  // Options lists the switch with the clock ones
  await A.go('settings', 'options');
  const sw = $('input[role="switch"][data-s="opt.clockFirst"]');
  ok(sw && sw.checked && sw.closest('.optgrp').querySelector('h3').textContent === 'Time clock' && /Everyone clocks in before Start job/.test(sw.closest('.opt').textContent), L('Setup › Options › Time clock has “Everyone clocks in before Start job”, on'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
