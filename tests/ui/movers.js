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
  ok(/^From \d+:\d\d [AP]M: 3 movers on the bill at \$195\/hr \(the quote is \$140\/hr for 2\)\. The time with more movers goes on the bill on top of the quote and its not-to-exceed price, so let Nadia Farouk know\.$/.test($('#mvWhat').textContent), L('what it does to the bill: ' + $('#mvWhat').textContent));
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
  const cl = N.extras.find((e) => e.id === 'clock'), cr = N.extras.filter((e) => /^crew:/.test(e.id));
  ok(!!cl && cl.amt === 80 && /held to the not-to-exceed price/.test(cl.label), L('the quote’s 2 movers, 5 hours: $795, held to the not-to-exceed $595 (+$80 on the quote)'));
  ok(cr.length === 1 && cr[0].label === '4 movers from ' + clock(t0 + 2 * H) + ', 3h 0m at $250/hr instead of $140/hr' && cr[0].amt === 330, L('and its own line, not held to it: “' + (cr[0] && cr[0].label) + '” +' + money(cr[0] && cr[0].amt)));
  const tot = N.quote.total + N.extras.reduce((a, e) => a + e.amt, 0);
  ok(tot === 925, L('the bill: $515 + $80 + $330 = ' + money(tot)));
  ok(/, crew changes \+\$330$/.test(N.log.filter((l) => /^Billed by the clock/.test(l.ev)).slice(-1)[0].ev), L('the activity line has the crew changes'));
  // the lead's bill, and the quote part's explanation
  await preview('lead', 'Marcus');
  if (card(N).tagName === 'DETAILS') { click(card(N).querySelector('summary b')); await sleep(10); }
  const bill = [...card(N).querySelectorAll('.cc-sec')].find((x) => x.querySelector('h4') && x.querySelector('h4').textContent === 'Bill');
  ok(!!bill && bill.textContent.includes('4 movers from ' + clock(t0 + 2 * H) + ', 3h 0m at $250/hr instead of $140/hr') && bill.textContent.includes('3h 0m at $250/hr instead of $140/hr$330') && /Bill \(\+\$410 on the quote\)\$925/.test(bill.textContent), L('Marcus’s Bill: the line, and “Bill (+$410 on the quote) $925”'));
  ok(/Crew changes on the bill: 4 movers from .*\(\+\$330\)\./.test(card(N).querySelector('.cc-quote').textContent), L('his Quote part explains it too'));
  ok(card(N).querySelector('.cc-movers').textContent === 'Movers on the bill: 2 (as quoted) · 4 from ' + clock(t0 + 2 * H) + 'Change', L('finished: the line still shows, with Change to take one back'));
  await endPreview();
  // the pay line for Dee, who joined 2 hours in: her own 3 hours
  await preview('crew', 'Dee');
  if (card(N) && card(N).tagName === 'DETAILS') { click(card(N).querySelector('summary b')); await sleep(10); }
  ok(!!card(N) && /You’re paid 3 h \(your time on the job\)/.test(card(N).textContent), L('Dee, who joined 2 hours in, is paid her own 3 hours'));
  await endPreview();
  // the office: the sheet, and taking one back after the job
  T.ui.jobId = N.id; T.render(); await sleep(10);
  const sh = $('#sheet .sheet-body').textContent;
  ok(sh.includes('Movers on the bill: 2 (as quoted) · 4 from ' + clock(t0 + 2 * H)) && sh.includes('4 movers from ' + clock(t0 + 2 * H) + ', 3h 0m at $250/hr instead of $140/hr') && /Crew changes on the bill:/.test(sh), L('the office’s sheet: the movers line, the bill line and the explanation'));
  await tap('#sheet .cc-movers [data-act="mv:open"]', 10);
  ok(!$('#mover [data-act="mv:save"]') && /The job is finished, so nobody more joins or leaves\./.test(panel()) && $$('#mover [data-act="mv:undo"]').length === 2, L('the job is finished: nothing more to put in, but each change can be taken back'));
  await tap($$('#mover [data-act="mv:undo"]')[1], 10);
  const cr2 = N.extras.filter((e) => /^crew:/.test(e.id));
  ok(cr2.length === 1 && cr2[0].label === '3 movers from ' + clock(t0 + 2 * H) + ', 3h 0m at $195/hr instead of $140/hr' && cr2[0].amt === 165 && N.assign.crew.indexOf('Luis') < 0, L('the office takes Luis back: the bill is worked out again (+$165 for 3 movers)'));
  await tap('#mover [data-act="mv:close"]');
  click('#sheet [data-act="sheet:close"].btn'); await sleep(10);

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
  ok(/\|m:\d+\+\/140,195,250$/.test(N.clockSig), L('the bill’s signature has the changes, so another phone works it out again'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
