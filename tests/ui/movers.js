// Movers joining or leaving on site (Richie, Oct 21: "If a mover has to be added to the job we need a way for the lead
// to add the guy when he shows up. So the bill starts with 2 movers for 2 hours and then the last 3 hours with 4 movers.")
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'movers';
const L = (m) => label + ': ' + m;
const money = (n) => { n = Math.round(n * 100) / 100; const neg = n < 0; n = Math.abs(n); const whole = Math.abs(n - Math.round(n)) < 0.005; return (neg ? '-' : '') + '$' + (whole ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T, clockIn } = A;
  const st = () => T.state();
  const H = 36e5, now = Date.now(), t0 = now - 5 * H;
  const clock = (ts) => new w.Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (() => { const d = new w.Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const N = st().jobs.find((j) => j.d.name === 'Nadia Farouk'), P = st().jobs.find((j) => j.d.name === 'Priya Nair'), HR = st().jobs.find((j) => j.d.name === 'Hollis & Reed Law');
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  const endPreview = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const card = (j) => $('#view [data-job="' + j.id + '"]');
  const tap = async (sel, ms) => { click(sel); await sleep(ms || 8); };
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const panel = () => $('#mover .panel').textContent.replace(/\s+/g, ' ');
  const pick = async (n) => { await tap($$('#mover [data-act="mv:pick"]').find((b) => b.dataset.n === n)); };

  // Nadia Farouk's move, today: 2 movers on the quote at $140/hr (not to exceed $595); it started 5 hours ago
  ok(N.quote.kind === 'local' && N.quote.crew === 2 && N.quote.rate === 140 && N.quote.nte === 595 && !N.quote.shopTravel, L('the job: a local move quoted for 2 movers at $140/hr'));
  Object.assign(N.d, { moveDate: day, time: '08:00' });
  Object.assign(N, { status: 'active', startedAt: t0, phases: { loadStart: t0 }, crewOn: { Marcus: [{ in: t0, out: 0 }], Kim: [{ in: t0, out: 0 }] } });
  clockIn('Marcus', 'Kim');

  /* ---------------- who has it ---------------- */
  await preview('crew', 'Kim');
  ok(!!card(N) && !card(N).querySelector('.cc-movers'), L('a crew member (Kim) has nothing to change on the bill'));
  await endPreview();
  await preview('lead', 'Marcus');
  const line = () => card(N).querySelector('.cc-movers');
  ok(!!line() && line().textContent === 'Movers on the bill: 2 (as quoted)A mover joined or left' && !!line().previousElementSibling && /^Crew:/.test(line().parentNode.querySelector('.cc-sub:not(.cc-date)').textContent), L('Marcus, the lead: under the crew, “Movers on the bill: 2 (as quoted)” and “A mover joined or left”'));

  /* ---------------- someone joined ---------------- */
  await tap(line().querySelector('[data-act="mv:open"]'), 10);
  ok(!$('#mover').hidden && /^Movers on Nadia Farouk/.test(panel()) && /On the bill now: 2 \(as quoted\)\./.test(panel()) && w.document.body.classList.contains('lock'), L('the panel: “Movers on Nadia Farouk”, what’s on the bill now'));
  const chips = $$('#mover [data-act="mv:pick"]').map((b) => b.dataset.n);
  ok(chips.join(',') === 'Dee,Luis,Tanya,Andre', L('who could join: everyone on the list who isn’t on the job (' + chips.join(', ') + ')'));
  ok($$('#mover [data-act="mv:ago"]').map((b) => b.textContent).join('|') === 'Now|15 min ago|30 min ago|45 min ago|60 min ago' && $('#mover [data-act="mv:save"]').disabled && $('#mover [data-act="mv:save"]').textContent === 'Pick who joined', L('when: Now, or up to an hour ago; nothing to save until someone’s picked'));
  await pick('Dee');
  ok($('#mover [data-act="mv:save"]').textContent === 'Add Dee to the job' && !$('#mover [data-act="mv:save"]').disabled, L('picked: “Add Dee to the job”'));
  ok(/^From \d+:\d\d [AP]M: 3 movers on the bill at \$195\/hr \(the quote is \$140\/hr for 2\)\. The time with more movers is billed at their rate, even past the not-to-exceed price, so let Nadia Farouk know\.$/.test($('#mvWhat').textContent), L('what it does to the bill: ' + $('#mvWhat').textContent));
  await tap('#mover [data-act="mv:ago"][data-a="30"]');
  ok($('#mover [data-act="mv:ago"][data-a="30"]').classList.contains('on') && $('#mvWhat').textContent.startsWith('From ' + clock(Date.now() - 30 * 6e4)) && $('#mover [data-act="mv:save"]').textContent === 'Add Dee to the job', L('30 min ago: the time moves back, Dee stays picked'));
  await tap('#mover [data-act="mv:save"]', 10);
  const e1 = (N.crewAdj || [])[0] || {};
  ok(N.crewAdj.length === 1 && e1.who === 'Dee' && e1.d === 1 && e1.by === 'Marcus' && e1.added === true && Math.abs(e1.ts - (Date.now() - 30 * 6e4)) < 5000, L('saved: Dee joined 30 minutes ago, put in by Marcus'));
  ok(N.assign.crew.indexOf('Dee') >= 0 && !(N.crewOn.Dee || []).length && toast() === 'Dee is on the job. 3 movers on the bill from ' + clock(e1.ts) + '. Dee isn’t clocked in yet, so Dee’s own time starts at clock-in.', L('Dee is on the crew; not clocked in, so not on the job’s times yet: ' + toast()));
  ok(N.crewRates && N.crewRates.r2 === 140 && N.crewRates.r3 === 195 && N.crewRates.r4 === 250, L('the Rate card is kept on the job with the first change'));
  ok(N.log.slice(-1)[0].ev === 'Dee joined the crew at ' + clock(e1.ts) + ' (put in by Marcus): 3 movers on the bill', L('in the job’s activity: ' + N.log.slice(-1)[0].ev));
  ok(line().textContent === 'Movers on the bill: 2 (as quoted) · 3 from ' + clock(e1.ts) + 'Change', L('the card: ' + line().textContent));
  // take it back
  await tap(line().querySelector('[data-act="mv:open"]'), 10);
  ok(/Changes on this job/.test(panel()) && /Dee joined at \d+:\d\d [AP]MPut in by Marcus · 3 on the bill after/.test(panel()), L('the panel lists the change, with Take back'));
  await tap('#mover [data-act="mv:undo"]', 10);
  ok(!N.crewAdj.length && N.assign.crew.indexOf('Dee') < 0 && toast() === 'Taken back.' && /^Taken back: Dee joining at /.test(N.log.slice(-1)[0].ev), L('taken back: Dee is off the crew again, and the activity says so'));
  await tap('#mover [data-act="mv:close"]');
  ok($('#mover').hidden && line().textContent === 'Movers on the bill: 2 (as quoted)A mover joined or left', L('closed: back to 2 as quoted'));

  /* ---------------- someone left ---------------- */
  await tap(line().querySelector('[data-act="mv:open"]'), 10);
  await tap('#mover [data-act="mv:mode"][data-m="left"]');
  ok($$('#mover [data-act="mv:pick"]').map((b) => b.dataset.n).join(',') === 'Kim' && $('#mover [data-act="mv:save"]').textContent === 'Pick who left', L('someone left: the crew on the job but Marcus himself (Kim)'));
  await pick('Kim'); await tap('#mover [data-act="mv:ago"][data-a="15"]');
  ok(/^From \d+:\d\d [AP]M: 1 mover on the bill at \$85\/hr \(the quote is \$140\/hr for 2\)\.$/.test($('#mvWhat').textContent), L('one mover’s rate, from the Rate card’s steps: ' + $('#mvWhat').textContent));
  await tap('#mover [data-act="mv:save"]', 10);
  const kimOut = (N.crewOn.Kim || []).slice(-1)[0] || {};
  ok(N.crewAdj.length === 1 && N.crewAdj[0].d === -1 && N.crewAdj[0].who === 'Kim' && kimOut.out > 0 && Math.abs(kimOut.out - (Date.now() - 15 * 6e4)) < 5000 && N.assign.crew.indexOf('Kim') >= 0, L('Kim left 15 minutes ago: off the job’s times then, still on the crew list'));
  await tap(line().querySelector('[data-act="mv:open"]'), 10);
  await tap('#mover [data-act="mv:undo"]', 10);
  ok(!N.crewAdj.length && (N.crewOn.Kim || []).slice(-1)[0].out === 0, L('taken back: Kim is on the job again'));
  await tap('#mover [data-act="mv:close"]');
  await endPreview();

  /* ---------------- the bill: 2 movers for 2 hours, then 4 for 3 hours ---------------- */
  T.mvAdd(N, 'Dee', 1, t0 + 2 * H, 'Marcus'); T.mvAdd(N, 'Luis', 1, t0 + 2 * H, 'Marcus');
  ok(T.billCrewAt(N, t0 + H) === 2 && T.billCrewAt(N, t0 + 2 * H) === 4 && T.billCrewAt(N, now) === 4, L('2 movers for the first 2 hours, then 4'));
  N.phases.unloadEnd = now; N.status = 'done'; N.finishedAt = now; N.actualHours = 5;
  T.applyClock(N);
  const cl = N.extras.find((e) => e.id === 'clock'), rw = (cl && cl.rows) || [];
  const rowTxt = (R) => R.map((r) => r.label + (r.sub ? ' [' + r.sub + ']' : '') + ' ' + money(r.amt)).join(' | ');
  ok(!N.extras.some((e) => /^crew:/.test(e.id)) && !!cl && cl.amt === 410 && cl.label === 'By the clock: 5h 0m on the job, billed 5 h: 2 movers 2 h, then 4 movers 3 h (quoted 3 h for 2 movers), held to the not-to-exceed price', L('one line on the bill, +$410: ' + (cl && cl.label)));
  ok(rw.length === 5 && rw[0].label === '2 movers, 2 hr at $140/hr' && rw[0].amt === 280 && rw[0].sub === clock(t0) + ' to ' + clock(t0 + 2 * H) + ' (2h 0m)' &&
    rw[1].label === '4 movers, 3 hr at $250/hr' && rw[1].amt === 750 && rw[1].sub === clock(t0 + 2 * H) + ' to ' + clock(now) + ' (3h 0m)' &&
    rw[2].label === 'Truck and fuel' && rw[2].amt === 45 && rw[3].label === 'Stairs: 2 flights' && rw[3].amt === 50 &&
    rw[4].label === 'Held to the not-to-exceed price' && rw[4].amt === -200 && rw[4].sub === '$595 for 2 movers, as quoted. The time with more movers is on top of it.', L('its rows: the hours of each crew at its rate, the fees, and the not-to-exceed price for the quote’s crew: ' + rowTxt(rw)));
  const tot = N.quote.total + N.extras.reduce((a, e) => a + e.amt, 0);
  ok(tot === 925 && rw.reduce((a, r) => a + r.amt, 0) === 925, L('the bill: $280 + $750 + $95 − $200 = ' + money(tot) + ' (2 movers held to $595, the 2 more on top)'));
  ok(N.log.filter((l) => /^Billed by the clock/.test(l.ev)).slice(-1)[0].ev === 'Billed by the clock: 5 h (2 movers 2 h, then 4 movers 3 h), $925', L('the activity line has the hours of each crew'));
  // the lead's bill: the quote, then the hours by the movers on the bill
  await preview('lead', 'Marcus');
  if (card(N).tagName === 'DETAILS') { click(card(N).querySelector('summary b')); await sleep(10); }
  const bill = [...card(N).querySelectorAll('.cc-sec')].find((x) => x.querySelector('h4') && x.querySelector('h4').textContent === 'Bill');
  const bt = bill ? [...bill.querySelectorAll('table.lines tr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()) : [];
  ok(bt[0] === 'Quote (3 hr, 2 movers)$515' && bt[1] === 'Billed by the clock' && bt[2] === '2 movers, 2 hr at $140/hr' + clock(t0) + ' to ' + clock(t0 + 2 * H) + ' (2h 0m)$280' &&
    bt[3] === '4 movers, 3 hr at $250/hr' + clock(t0 + 2 * H) + ' to ' + clock(now) + ' (3h 0m)$750' && bt[4] === 'Truck and fuel$45' && bt[5] === 'Stairs: 2 flights$50' &&
    bt[6] === 'Held to the not-to-exceed price$595 for 2 movers, as quoted. The time with more movers is on top of it.−$200' && bt[7] === 'Bill$925' && bt[8] === 'Paid so far$0' && bt[9] === 'Balance$925', L('Marcus’s Bill: the quote, then the hours by the movers on the bill, the fees, and the bill: ' + bt.join(' / ')));
  ok(!!bill.querySelector('tr.ref') && !!bill.querySelector('tr.hd') && /\$410 more than the quote\./.test(bill.textContent), L('the quote row is set apart, and it says how much more than the quote'));
  ok(/billed 5 h \(2 movers 2 h, then 4 movers 3 h\)\. Bill \$925, held to the not-to-exceed price \(\+\$410 on the quote\)\. Each crew at its own rate: 2 movers \$140\/hr, 4 movers \$250\/hr\./.test(card(N).querySelector('.cc-quote').textContent), L('his Quote part explains it too'));
  ok(card(N).querySelector('.cc-movers').textContent === 'Movers on the bill: 2 (as quoted) · 4 from ' + clock(t0 + 2 * H) + 'Change', L('finished: the line still shows, with Change to take one back'));
  await endPreview();
  // the pay line for Dee, who joined 2 hours in: her own 3 hours
  await preview('crew', 'Dee');
  if (card(N) && card(N).tagName === 'DETAILS') { click(card(N).querySelector('summary b')); await sleep(10); }
  ok(!!card(N) && /You’re paid 3 h \(your time on the job\)/.test(card(N).textContent), L('Dee, who joined 2 hours in, is paid her own 3 hours'));
  await endPreview();
  // the office: the sheet, and taking one back after the job
  T.ui.jobId = N.id; T.render(); await sleep(10);
  const sh = $('#sheet .sheet-body').textContent, shq = $('#sheet details.acc[data-k="sh:Quote"]');
  const sr = shq ? [...shq.querySelector('table.lines').querySelectorAll('tr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()) : [];
  ok(sh.includes('Movers on the bill: 2 (as quoted) · 4 from ' + clock(t0 + 2 * H)) && sr.join(' / ') === '2 movers, 3 hr at $140/hr$420 / Truck and fuel$45 / Stairs: 2 flights$50 / Quote$515 / Billed by the clock / 2 movers, 2 hr at $140/hr' + clock(t0) + ' to ' + clock(t0 + 2 * H) + ' (2h 0m)$280 / 4 movers, 3 hr at $250/hr' + clock(t0 + 2 * H) + ' to ' + clock(now) + ' (3h 0m)$750 / Truck and fuel$45 / Stairs: 2 flights$50 / Held to the not-to-exceed price$595 for 2 movers, as quoted. The time with more movers is on top of it.−$200 / Bill$925', L('the office’s sheet: the quote’s lines, then the bill by the movers on it: ' + sr.join(' / ')));
  await tap('#sheet .cc-movers [data-act="mv:open"]', 10);
  ok(!$('#mover [data-act="mv:save"]') && /The job is finished, so nobody more joins or leaves\./.test(panel()) && $$('#mover [data-act="mv:undo"]').length === 2, L('the job is finished: nothing more to put in, but each change can be taken back'));
  await tap($$('#mover [data-act="mv:undo"]')[1], 10);
  const cl2 = N.extras.find((e) => e.id === 'clock'), rw2 = (cl2 && cl2.rows) || [];
  ok(cl2 && cl2.amt === 245 && rw2[1] && rw2[1].label === '3 movers, 3 hr at $195/hr' && rw2[1].amt === 585 && N.assign.crew.indexOf('Luis') < 0 && N.quote.total + cl2.amt === 760, L('the office takes Luis back: the bill is worked out again, 3 movers for the last 3 hours ($760)'));
  await tap('#mover [data-act="mv:close"]');
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);

  // the rows show only when they add up to the bill (a phone on the version before writes the line without them)
  const cp = (f) => { const x = JSON.parse(JSON.stringify(N)); f(x); return x; }, ck = (x) => x.extras.find((e) => e.id === 'clock');
  ok(T.clockRows(N) === cl2.rows, L('the bill’s rows, as on its line'));
  ok(T.clockRows(cp((x) => { delete ck(x).rows; })).length === 5, L('a line without rows: worked out here, since they add up to it'));
  ok(T.clockRows(cp((x) => { ck(x).amt += 50; })) === null, L('a line whose rows don’t add up to it (changed on a phone without rows): the bill shows the line instead'));
  ok(T.clockRows(cp((x) => { x.extras.push({ id: 'crew:0', label: '3 movers from 9:00 AM, 1h 0m at $195/hr instead of $140/hr', amt: 55, ts: 1 }); })) === null, L('a bill from the version before, with a crew line: shown as it is until it’s worked out again'));

  /* ---------------- Richie’s job: 2 movers 1h 31m, then a 3rd for 1h 09m, on a 3-hour minimum ---------------- */
  // "the bill should show the quote, then it should show the 1.5 hours as 2 man and 1.25 hours as a 3 man", and "the 3 men
  // might of got it done in 1.25 hours but the company will charge 1.50 hours for those 3 guys"
  const M = 6e4, s0 = now - 4 * H;
  const job = (o) => Object.assign({ quote: N.quote, startedAt: s0, finishedAt: s0 + 160 * M, phases: { loadStart: s0, unloadEnd: s0 + 160 * M }, crewAdj: [{ id: 'x1', ts: s0 + 91 * M, d: 1, who: 'Dee', by: 'Tanya' }], crewRates: { r2: 140, r3: 195, r4: 250 } }, o || {});
  const hrs = (c) => c.rows.filter((r) => r.k === 'hours').map((r) => r.label + ' ' + money(r.amt) + (r.sub ? ' [' + r.sub + ']' : '')).join(' | ');
  let c = T.clockBill(job());
  ok(c.billed === 3 && hrs(c) === '2 movers, 1.5 hr at $140/hr $210 [' + clock(s0) + ' to ' + clock(s0 + 91 * M) + ' (1h 31m)] | 3 movers, 1.5 hr at $195/hr $293 [' + clock(s0 + 91 * M) + ' to ' + clock(s0 + 160 * M) + ' (1h 9m) · the 3-hour minimum]' && c.total === 598, L('2 movers 1.5 hr, then 3 movers 1.5 hr: the 3rd mover’s crew fills the 3-hour minimum ($210 + $293 + $95 = $598): ' + hrs(c)));
  c = T.clockBill(job({ quote: Object.assign({}, N.quote, { minHours: 0 }) }));
  ok(c.billed === 2.75 && hrs(c) === '2 movers, 1.5 hr at $140/hr $210 [' + clock(s0) + ' to ' + clock(s0 + 91 * M) + ' (1h 31m)] | 3 movers, 1.25 hr at $195/hr $244 [' + clock(s0 + 91 * M) + ' to ' + clock(s0 + 160 * M) + ' (1h 9m)]', L('with no minimum: 1.5 hr and 1.25 hr (the change to the nearest quarter hour, the end up to one): ' + hrs(c)));
  c = T.clockBill(job({ crewAdj: [{ id: 'x1', ts: s0 + 5 * M, d: 1, who: 'Dee' }] }));
  ok(hrs(c) === '3 movers, 3 hr at $195/hr $585 [' + clock(s0 + 5 * M) + ' to ' + clock(s0 + 160 * M) + ' (2h 35m) · the 3-hour minimum]', L('a mover 5 minutes in: the 5 minutes round away, 3 movers for the whole bill: ' + hrs(c)));
  c = T.clockBill(job({ crewAdj: [{ id: 'x1', ts: s0 + 90 * M, d: -1, who: 'Kim' }], phases: { loadStart: s0, unloadEnd: s0 + 300 * M }, finishedAt: s0 + 300 * M }));
  ok(hrs(c) === '2 movers, 1.5 hr at $140/hr $210 [' + clock(s0) + ' to ' + clock(s0 + 90 * M) + ' (1h 30m)] | 1 mover, 3.5 hr at $85/hr $298 [' + clock(s0 + 90 * M) + ' to ' + clock(s0 + 300 * M) + ' (3h 30m)]' && c.capped && c.total === 595 && c.rows.find((r) => r.k === 'cap').sub === 'Not to exceed $595', L('a mover left: 1 mover at $85/hr for that time, and the bill ($603 by the rows) held to the not-to-exceed price: ' + hrs(c) + ' = ' + money(c.total)));
  c = T.clockBill(job({ clockFix: { hours: 2.5 } }));
  ok(c.billed === 2.5 && hrs(c) === '2 movers, 1.5 hr at $140/hr $210 [' + clock(s0) + ' to ' + clock(s0 + 91 * M) + ' (1h 31m)] | 3 movers, 1 hr at $195/hr $195 [' + clock(s0 + 91 * M) + ' to ' + clock(s0 + 160 * M) + ' (1h 9m) · hours set by the office]', L('the office sets 2.5 h: the quarter hour comes off the end: ' + hrs(c)));
  c = T.clockBill(job({ clockFix: { hours: 4 } }));
  ok(hrs(c) === '2 movers, 1.5 hr at $140/hr $210 [' + clock(s0) + ' to ' + clock(s0 + 91 * M) + ' (1h 31m)] | 3 movers, 2.5 hr at $195/hr $488 [' + clock(s0 + 91 * M) + ' to ' + clock(s0 + 160 * M) + ' (1h 9m) · hours set by the office]', L('the office sets 4 h: added at the end: ' + hrs(c)));
  c = T.clockBill(job({ crewAdj: [] }));
  ok(hrs(c) === '2 movers, 3 hr at $140/hr $420 [' + clock(s0) + ' to ' + clock(s0 + 160 * M) + ' (2h 40m) · the 3-hour minimum]' && c.total === 515 && c.adj === 0, L('no crew change: one row for the quote’s crew, the same as the quote'));
  // a local move from the shop: the drive back goes with the crew at the end
  c = T.clockBill(job({ quote: Object.assign({}, N.quote, { shopTravel: true, backH: 0.5 }) }));
  ok(hrs(c) === '2 movers, 1.5 hr at $140/hr $210 [' + clock(s0) + ' to ' + clock(s0 + 91 * M) + ' (1h 31m)] | 3 movers, 1.75 hr at $195/hr $341 [' + clock(s0 + 91 * M) + ' to ' + clock(s0 + 160 * M) + ' (1h 9m) · 30m back to the shop]', L('the drive back to the shop goes on the last crew’s hours: ' + hrs(c)));
  // a mileage move: loading with 2, the 3rd joins on the drive, unloading with 3
  const mq = Object.assign({}, N.quote, { kind: 'mileage', miles: 120, mileRate: 1.5, minHours: 3 });
  c = T.clockBill(job({ quote: mq, phases: { loadStart: s0, loadEnd: s0 + 70 * M, unloadStart: s0 + 200 * M, unloadEnd: s0 + 290 * M }, crewAdj: [{ id: 'x1', ts: s0 + 150 * M, d: 1, who: 'Dee' }] }));
  ok(hrs(c) === '2 movers, 1.25 hr at $140/hr $175 [Loading 1h 10m from ' + clock(s0) + '] | 3 movers, 1.75 hr at $195/hr $341 [Unloading 1h 30m from ' + clock(s0 + 200 * M) + ' · the 3-hour minimum]' && c.rows.find((r) => r.k === 'miles').label === 'Mileage: 120 mi at $1.50/mi', L('a mileage move: loading with 2, unloading with 3, and the miles: ' + hrs(c)));
  // a job with no crew change keeps the bill it always had, now with its rows
  const one = T.clockBill(job({ crewAdj: [], phases: { loadStart: s0, unloadEnd: s0 + 190 * M }, finishedAt: s0 + 190 * M }));
  ok(one.adj === 35 && one.rows.length === 3 && one.rows[0].label === '2 movers, 3.25 hr at $140/hr' && one.rows[0].amt === 455, L('no crew change, 3h 10m: 3.25 hr, +$35, as before'));

  /* ---------------- before the job: from the start ---------------- */
  await preview('lead', 'Marcus');
  await tap(card(P).querySelector('[data-act="mv:open"]'), 10);
  ok($$('#mover [data-act="mv:ago"]').map((b) => b.textContent).join('|') === 'From the start', L('a job not started yet: only “From the start”'));
  await pick('Kim');
  ok(/^From the start: 4 movers on the bill at \$250\/hr \(the quote is \$195\/hr for 3\)\./.test($('#mvWhat').textContent), L('Priya Nair (3 movers quoted): ' + $('#mvWhat').textContent));
  await tap('#mover [data-act="mv:save"]', 10);
  ok(P.crewAdj.length === 1 && P.assign.crew.indexOf('Kim') >= 0 && T.billCrewAt(P, Date.now() + H) === 4 && toast() === 'Kim is on the job. 4 movers on the bill from the start.', L('added: 4 movers on the bill from the start'));
  ok(card(P).querySelector('.cc-movers').textContent === 'Movers on the bill: 3 (as quoted) · 4 from the startChange', L('the card: ' + card(P).querySelector('.cc-movers').textContent));
  await tap(card(P).querySelector('[data-act="mv:open"]'), 10);
  ok(/Kim joined from the startPut in by Marcus · 4 on the bill after/.test(panel()), L('and the panel lists it as from the start'));
  await tap('#mover .panel [data-act="mv:close"]');
  await endPreview();

  /* ---------------- a flat price, and the switch ---------------- */
  HR.quote = Object.assign({}, HR.quote, { flat: true }); T.render(); await sleep(5);
  await preview('lead', 'Tanya');
  if (card(HR).tagName === 'DETAILS') { click(card(HR).querySelector('summary b')); await sleep(10); }
  ok(!/Movers on the bill/.test(card(HR).querySelector('.cc-movers').textContent), L('a flat-price job has no “movers on the bill”'));
  await tap(card(HR).querySelector('[data-act="mv:open"]'), 10);
  await pick('Dee');
  ok($('#mvWhat').textContent === 'Flat price: the bill stays at the quote.', L('and the panel says the bill stays at the quote'));
  await tap('#mover [data-act="mv:close"]');
  await endPreview();
  st().settings.opt.crewAdd = false; T.render(); await sleep(5);
  await preview('lead', 'Marcus');
  ok(!card(P).querySelector('[data-act="mv:open"]') && !!card(P).querySelector('.cc-movers'), L('Options › Crew leads add movers on site off: the lead sees the line, with nothing to change'));
  await endPreview();
  T.ui.jobId = P.id; T.render(); await sleep(10);
  ok(!!$('#sheet .cc-movers [data-act="mv:open"]'), L('the office still can'));
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);
  delete st().settings.opt.crewAdd;

  /* ---------------- saved like the rest of the job ---------------- */
  const doc = T.jobDoc(N);
  ok(doc.crewAdj && !Array.isArray(doc.crewAdj) && Object.keys(doc.crewAdj).length === 1 && doc.crewRates && doc.crewRates.r4 === 250, L('in the shared copy: the changes keyed by id (two phones can add one each), and the rates'));
  const back = T.docToJob(JSON.parse(JSON.stringify(doc)));
  ok(back.crewAdj.length === 1 && back.crewAdj[0].who === 'Dee' && back.crewRates.r3 === 195, L('and back again'));
  ok(/^c4:.*\|n:2\|c:\["Dee","Kim","Marcus"\]\|m:\[\[\d+,1,"Dee"\]\]\/140,195,250$/.test(N.clockSig), L('the bill’s signature has the quote’s crew, who’s on the crew and the changes (c4, so the versions before leave it alone): ' + N.clockSig.slice(-70)));

  /* ---------------- a bill from the version before (the crew changes on lines of their own) ---------------- */
  // on this phone's own copy, it's worked out again by the movers on the bill when Tally opens
  N.extras = [{ id: 'clock', label: 'By the clock: 5h 0m on the job, billed 5 h (quoted 3 h), held to the not-to-exceed price', amt: 80, ts: now },
    { id: 'crew:0', label: '3 movers from ' + clock(t0 + 2 * H) + ', 3h 0m at $195/hr instead of $140/hr', amt: 165, ts: now }];
  N.clockSig = 'c1:' + N.clockSig.slice(3).replace(/\|n:2\|m:/, '|m:');
  T.save(); await sleep(400);
  const saved = w.localStorage.getItem('tally.v1');
  const B = await load(file, { setup: (bw) => bw.localStorage.setItem('tally.v1', saved) });
  const NB = B.T.state().jobs.find((j) => j.id === N.id), clb = NB.extras.find((e) => e.id === 'clock');
  ok(NB.extras.length === 1 && clb && clb.amt === 245 && (clb.rows || []).length === 5 && /^c2:/.test(NB.clockSig) && NB.quote.total + clb.amt === 760, L('opened again: one line with its rows, the same $760, signed c2'));
  ok(/^Billed by the clock: 5 h \(2 movers 2 h, then 3 movers 3 h\), \$760 \(worked out again\)$/.test(NB.log.slice(-1)[0].ev), L('and the activity says it was worked out again: ' + NB.log.slice(-1)[0].ev));
  ok(B.errors.length === 0, L('no errors opening it (' + B.errors.slice(0, 3).join(' | ') + ')'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
