// The bill follows the people put on the job (Richie, Oct 24: "When a job is booked as a 2 man move and the office decides
// to put 3 people on the job the bill should reflect the people put on the job not the quoted amount of people").
// Run against either edition: node tests/ui/crewbill.js <file> <label>
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'crewbill';
const L = (m) => label + ': ' + m;
const money = (n) => { n = Math.round(n * 100) / 100; const neg = n < 0; n = Math.abs(n); const whole = Math.abs(n - Math.round(n)) < 0.005; return (neg ? '-' : '') + '$' + (whole ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T } = A;
  const st = () => T.state();
  const H = 36e5, M = 6e4;
  const clock = (ts) => new w.Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const byName = (n) => st().jobs.find((j) => j.d.name === n);
  const N = byName('Nadia Farouk'), HR = byName('Hollis & Reed Law'), O = byName('Ortega family'), P = byName('Priya Nair');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const sheet = () => $('#sheet .sheet-body').textContent.replace(/\s+/g, ' ');
  const line = () => ($('#sheet .cc-movers') || {}).textContent || '';
  const chip = (n) => $$('#sheet [data-act="sh:crew"]').find((b) => b.dataset.n === n);
  const open = async (j) => { T.ui.jobId = j.id; T.render(); await sleep(15); };
  const close = async () => { click('#sheet [data-act="sheet:close"].btn'); await sleep(10); };
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  const endPreview = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const clk = (j) => (j.extras || []).find((e) => e.id === 'clock');
  const rowTxt = (R) => (R || []).map((r) => r.label + (r.sub ? ' [' + r.sub + ']' : '') + ' ' + money(r.amt)).join(' | ');

  /* ---------------- the Board's Needs scheduling chips say it too ---------------- */
  click('[data-act="tab"][data-tab="dispatch"]'); await sleep(20);
  const dq = (n) => $$('[data-act="dq:crew"]').find((x) => x.dataset.id === N.id && x.dataset.n === n);
  click(dq('Dee')); await sleep(10);
  ok(N.assign.crew.join() === 'Marcus,Kim,Dee' && toast() === 'Dee added to the job. Movers on the bill: 2 (as quoted) · 3 from the start. Nadia Farouk signs for the bigger crew in the customer app, or before loading.', L('the Board: Dee put on Nadia’s job, and Nadia signs for the bigger crew in the customer app or before loading: ' + toast()));
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  await open(N);
  click(chip('Dee')); await sleep(10);
  ok(N.assign.crew.join() === 'Marcus,Kim' && toast() === 'Dee removed from the job. Movers on the bill: 2 (as quoted).', L('and off again, from her sheet: ' + toast()));
  await close();

  /* ---------------- the office puts a 3rd mover on a 2-man move ---------------- */
  ok(N.quote.crew === 2 && N.quote.rate === 140 && N.quote.nte === 595 && N.assign.crew.join() === 'Marcus,Kim' && N.status === 'booked', L('Nadia Farouk: booked as a 2-man move at $140/hr (not to exceed $595), Marcus and Kim on it'));
  await open(N);
  ok(line() === 'Movers on the bill: 2 (as quoted)A mover joined or left', L('her sheet, under the crew: ' + line()));
  click(chip('Dee')); await sleep(10);
  ok(N.assign.crew.join() === 'Marcus,Kim,Dee' && !(N.crewAdj || []).length && toast() === 'Dee added to the job. Movers on the bill: 2 (as quoted) · 3 from the start. Nadia Farouk signs for the bigger crew in the customer app, or before loading.', L('the office puts Dee on it: ' + toast()));
  ok(line() === 'Movers on the bill: 2 (as quoted) · 3 from the startA mover joined or left', L('the sheet says so: ' + line()));
  ok(sheet().includes('The final bill comes from the crew’s times. The bill is for 3 movers at $195/hr, the people on the job; the quote is for 2 at $140/hr, so Nadia Farouk signs for the bigger crew in the customer app, or before loading.') && sheet().includes('3 movers on the job, quoted for 2: Nadia Farouk signs for the bigger crew in the customer app, or before loading.'), L('and the Local move part: 3 movers at the 3-man rate, and the customer signs for them'));
  ok(T.billCrewAt(N, Date.now()) === 3 && T.mvSummary(N) === '2 (as quoted) · 3 from the start', L('3 movers on the bill'));

  /* ---------------- the job: started by the office, 5 hours, finished ---------------- */
  click('#sheet [data-act="sh:next"]'); await sleep(10);
  click('#start [data-act="go:start"]'); await sleep(15);
  ok(N.status === 'active' && N.startedAt > 0, L('the office starts it'));
  await close();
  await preview('lead', 'Marcus');
  const card = (j) => $('#view [data-job="' + j.id + '"]');
  ok(card(N) && card(N).querySelector('.cc-movers') && card(N).querySelector('.cc-movers').textContent === 'Movers on the bill: 2 (as quoted) · 3 from the startA mover joined or left', L('Marcus, the lead, sees it on his card'));
  await endPreview();
  const now = Date.now(), t0 = now - 5 * H;
  Object.assign(N, { startedAt: t0, phases: { loadStart: t0, loadEnd: t0 + 2 * H, unloadStart: t0 + 3 * H, unloadEnd: now } });
  ok(N.crewAsk === 1 && T.crewForm(N) && T.crewForm(N).id === 'crew:3' && T.formsPending(N)[0].id === 'crew:3', L('started: the job asks for the customer’s signature for 3 movers, first among its forms'));
  N.signed = (N.signed || []).concat(st().settings.forms.filter((f) => f.required).map((f) => ({ id: 'sg_' + f.id, formId: f.id, title: f.title, name: 'Nadia', sig: '', ts: now, by: 'Marcus' })),
    [{ id: 'sg_crew', formId: 'crew:3', title: 'Bigger crew: 3 movers', name: 'Nadia', sig: '', ts: now, by: 'Marcus', n: 3, rate: 195 }]);
  await open(N);
  const sel = $('#sheet select[data-jstatus]'); sel.value = 'done'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(15);
  const c1 = clk(N), r1 = (c1 && c1.rows) || [];
  ok(N.status === 'done' && c1 && c1.amt === 555 && c1.label === 'By the clock: 5h 0m on the job, billed 5 h: 3 movers 5 h (quoted 3 h for 2 movers)', L('finished: one line on the bill, +$555: ' + (c1 && c1.label)));
  ok(r1.length === 3 && r1[0].label === '3 movers, 5 hr at $195/hr' && r1[0].amt === 975 && r1[0].sub === clock(t0) + ' to ' + clock(now) + ' (5h 0m)' && r1[1].label === 'Truck and fuel' && r1[2].label === 'Stairs: 2 flights', L('its rows: 3 movers for the whole job at $195/hr, and the fees: ' + rowTxt(r1)));
  ok(N.quote.total + c1.amt === 1070 && r1.reduce((a, r) => a + r.amt, 0) === 1070, L('the bill: $975 + $95 = $1,070, past the $595 not-to-exceed price (a guide, not a cap)'));
  ok(N.log.filter((l) => /^Billed by the clock/.test(l.ev)).slice(-1)[0].ev === 'Billed by the clock: 5 h (3 movers 5 h), $1,070', L('the activity: ' + N.log.filter((l) => /^Billed by the clock/.test(l.ev)).slice(-1)[0].ev));
  ok(N.crewRates && N.crewRates.r2 === 140 && N.crewRates.r3 === 195 && N.crewRates.r4 === 250, L('the Rate card is kept on the job with the bill'));
  ok(/^c5:.*\|n:2\|c:\["Dee","Kim","Marcus"\]\|m:\[\]\/140,195,250$/.test(N.clockSig) && !T.clockStale(N), L('the bill’s signature has who’s on the crew (c5, so the versions before leave it alone): ' + N.clockSig.slice(-60)));
  const sr = [...$('#sheet details.acc[data-k="sh:Quote"] table.lines').querySelectorAll('tr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  ok(sr.join(' / ') === '2 movers, 3 hr at $140/hr$420 / Truck and fuel$45 / Stairs: 2 flights$50 / Quote$515 / Billed by the clock / 3 movers, 5 hr at $195/hr' + clock(t0) + ' to ' + clock(now) + ' (5h 0m)$975 / Truck and fuel$45 / Stairs: 2 flights$50 / Bill$1,070', L('the sheet: the quote, then the bill by the movers on it: ' + sr.join(' / ')));
  ok(sheet().includes('On the clock 5h 0m: billed 5 h (3 movers 5 h). Bill $1,070, past the $595 estimated top price (+$555 on the quote). Billed for 3 movers at $195/hr; the quote is for 2 at $140/hr.'), L('and explains it, saying it went past the not-to-exceed price'));
  ok(line() === 'Movers on the bill: 2 (as quoted) · 3 from the start', L('finished: the line stays, with nothing to change: ' + line()));

  /* ---------------- after the job: a mover the office forgot ---------------- */
  click(chip('Luis')); await sleep(10);
  const c2 = clk(N);
  ok(N.assign.crew.join() === 'Marcus,Kim,Dee,Luis' && c2.amt === 830 && c2.rows[0].label === '4 movers, 5 hr at $250/hr' && c2.rows[0].amt === 1250 && N.quote.total + c2.amt === 1345, L('Luis put on it after the job: the bill is worked out again, 4 movers for the whole job ($1,345)'));
  ok(toast() === 'Luis added to the job. Movers on the bill: 2 (as quoted) · 4 from the start.' && N.log.slice(-1)[0].ev === 'Billed by the clock: 5 h (4 movers 5 h), $1,345 (crew changed)', L('the toast and the activity: ' + toast() + ' | ' + N.log.slice(-1)[0].ev));
  click(chip('Luis')); await sleep(10);
  ok(N.assign.crew.join() === 'Marcus,Kim,Dee' && clk(N).amt === 555 && toast() === 'Luis removed from the job. Movers on the bill: 2 (as quoted) · 3 from the start.', L('and off again: back to $1,070'));
  const drv = $('#sheet select[data-drv="sh"]');
  drv.value = 'Andre'; drv.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(10);
  ok(N.assign.crew.indexOf('Andre') >= 0 && clk(N).amt === 830 && /^Andre added to the crew, driving .*\. Movers on the bill: 2 \(as quoted\) · 4 from the start\.$/.test(toast()), L('a driver picked after the job is on the crew and the bill ($1,345): ' + toast()));
  click(chip('Andre')); await sleep(10);
  ok(N.assign.crew.indexOf('Andre') < 0 && clk(N).amt === 555, L('and off again: $1,070'));
  await close();

  /* ---------------- the lead's card after the job ---------------- */
  await preview('lead', 'Marcus');
  if (card(N) && card(N).tagName === 'DETAILS') { click(card(N).querySelector('summary b')); await sleep(10); }
  ok(card(N) && card(N).querySelector('.cc-movers').textContent === 'Movers on the bill: 2 (as quoted) · 3 from the start' && /Billed for 3 movers at \$195\/hr; the quote is for 2 at \$140\/hr\./.test(card(N).querySelector('.cc-quote').textContent), L('Marcus’s card: the movers line, and his Quote part explains the bill'));
  await endPreview();

  /* ---------------- a crew that goes out short: billed for who went out ---------------- */
  // "if it was booked and quoted as a three man, but only two guys go out because someone gets sick or calls in, then the bill is only two"
  ok(HR.quote.crew === 3 && HR.quote.rate === 195 && HR.quote.nte === 840 && HR.assign.crew.join() === 'Tanya,Andre' && T.billCrewAt(HR, Date.now()) === 2 && T.mvSummary(HR) === '3 (as quoted) · 2 from the start', L('Hollis & Reed: quoted for 3, Tanya and Andre go out: 2 on the bill'));
  await open(HR);
  ok(line() === 'Movers on the bill: 3 (as quoted) · 2 from the startA mover joined or left' && sheet().includes('The bill is for 2 movers at $140/hr, the people on the job; the quote is for 3 at $195/hr.') && !/more movers than quoted/.test(sheet()), L('its sheet: 2 movers at the 2-man rate'));
  const hj = (hrs) => { const e = Date.now(); return Object.assign({}, HR, { startedAt: e - hrs * H, phases: { loadStart: e - hrs * H, unloadEnd: e } }); };   // one clock reading: a millisecond more is another quarter hour
  let hb = T.clockBill(hj(4));
  ok(hb.segs.length === 1 && hb.rows[0].label === '2 movers, 4 hr at $140/hr' && hb.rows[0].amt === 560 && hb.total === 605 && !hb.capped, L('by the clock, 4 hours: 2 movers at $140/hr and the truck, $605 (the quote was $728 for 3)'));
  hb = T.clockBill(hj(10));
  ok(hb.rows[0].label === '2 movers, 10 hr at $140/hr' && !hb.capped && hb.over && hb.total === 1445 && !hb.rows.some((r) => r.k === 'cap'), L('a long day short-handed: 2 movers for all 10 hours, $1,445, past the $840 not-to-exceed price (a guide)'));
  T.mvAdd(HR, 'Andre', -1, Date.now(), 'Office');
  ok(T.billCrewAt(HR, Date.now()) === 1 && T.mvSummary(HR) === '3 (as quoted) · 1 from the start', L('Andre marked as left too: 1 from the start'));
  T.mvUndo(HR, HR.crewAdj[0].id); T.render(); await sleep(5);
  ok(!HR.crewAdj.length && T.billCrewAt(HR, Date.now()) === 2, L('taken back: 2 again'));
  click(chip('Dee')); await sleep(10);
  ok(T.mvSummary(HR) === '3 (as quoted)' && toast() === 'Dee added to the job. Movers on the bill: 3 (as quoted).', L('Dee makes the 3 quoted: ' + toast()));
  click(chip('Kim')); await sleep(10);
  ok(T.mvSummary(HR) === '3 (as quoted) · 4 from the start' && toast() === 'Kim added to the job. Movers on the bill: 3 (as quoted) · 4 from the start. Hollis & Reed Law signs for the bigger crew in the customer app, or before loading.', L('and Kim a 4th, so the customer signs for 4: ' + toast()));
  click(chip('Kim')); await sleep(5); click(chip('Dee')); await sleep(10);
  ok(HR.assign.crew.join() === 'Tanya,Andre' && T.mvSummary(HR) === '3 (as quoted) · 2 from the start' && toast() === 'Dee removed from the job. Movers on the bill: 3 (as quoted) · 2 from the start.', L('both off again: 2'));
  // someone joining is one more, as the movers panel says
  click('#sheet .cc-movers [data-act="mv:open"]'); await sleep(10);
  ok(/On the bill now: 3 \(as quoted\) · 2 from the start\./.test($('#mover .panel').textContent), L('the movers panel: on the bill now, 2'));
  click($$('#mover [data-act="mv:pick"]').find((x) => x.dataset.n === 'Dee')); await sleep(8);
  ok($('#mvWhat').textContent === 'From the start: 3 movers on the bill at $195/hr, as quoted.', L('Dee joining makes 3: ' + $('#mvWhat').textContent));
  click('#mover [data-act="mv:save"]'); await sleep(10);
  ok(HR.assign.crew.join() === 'Tanya,Andre,Dee' && T.billCrewAt(HR, Date.now()) === 3 && T.mvSummary(HR) === '3 (as quoted)' && toast() === 'Dee is on the job. 3 movers on the bill from the start.', L('saved: 3, as it said: ' + toast()));
  click('#sheet .cc-movers [data-act="mv:open"]'); await sleep(10);
  click('#mover [data-act="mv:undo"]'); await sleep(10); click('#mover [data-act="mv:close"]'); await sleep(8);
  ok(HR.assign.crew.join() === 'Tanya,Andre' && !HR.crewAdj.length && T.billCrewAt(HR, Date.now()) === 2, L('taken back: 2'));
  await close();

  /* ---------------- nobody on the crew yet: the quote's crew ---------------- */
  ok(!O.assign.crew.length && T.billCrewAt(O, Date.now()) === 3 && T.mvSummary(O) === '3 (as quoted)', L('Ortega family, nobody on it yet: the 3 quoted'));

  /* ---------------- a running job: someone joins on site, and the chips ---------------- */
  const h0 = Date.now() - 3 * H;
  Object.assign(HR, { status: 'active', startedAt: h0, phases: { loadStart: h0 }, crewOn: { Tanya: [{ in: h0, out: 0 }], Andre: [{ in: h0, out: 0 }] } });
  T.mvAdd(HR, 'Luis', 1, Date.now() - H, 'Tanya'); const lts = HR.crewAdj[0].ts;
  ok(HR.assign.crew.join() === 'Tanya,Andre,Luis' && T.billCrewAt(HR, h0 + H) === 2 && T.billCrewAt(HR, Date.now()) === 3 && T.mvSummary(HR) === '3 (as quoted) · 2 from the start · 3 from ' + clock(lts), L('the 2 who went out, then Luis joins an hour ago: ' + T.mvSummary(HR)));
  await open(HR);
  // Richie, Oct 25: "If someone is added to a job it only adds them for the amount of time there"
  click(chip('Dee')); await sleep(10);
  const de = HR.crewAdj.slice(-1)[0];
  ok(HR.assign.crew.join() === 'Tanya,Andre,Luis,Dee' && de.who === 'Dee' && de.d === 1 && de.chip && de.added && T.billCrewAt(HR, de.ts - 1) === 3 && T.billCrewAt(HR, de.ts) === 4 && T.billCrewAt(HR, h0) === 2,
    L('the office puts Dee on the running job: on the bill from now, not the whole job'));
  ok(toast().indexOf('Dee added to the job at ' + clock(de.ts) + '. Movers on the bill: 3 (as quoted) · 2 from the start · 3 from ' + clock(lts) + ' · 4 from ' + clock(de.ts) + '.') === 0, L('the toast says from when: ' + toast()));
  click(chip('Dee')); await sleep(10);
  ok(HR.assign.crew.join() === 'Tanya,Andre,Luis' && !HR.crewAdj.some((e) => e.who === 'Dee') && T.billCrewAt(HR, Date.now()) === 3 && toast() === 'Dee removed from the job. Movers on the bill: 3 (as quoted) · 2 from the start · 3 from ' + clock(lts) + '.', L('taken off a moment later: a slip, as if she was never put on: ' + toast()));
  click(chip('Luis')); await sleep(10);
  const le = HR.crewAdj.slice(-1)[0];
  ok(HR.assign.crew.join() === 'Tanya,Andre' && le.who === 'Luis' && le.d === -1 && T.billCrewAt(HR, le.ts - 1) === 3 && T.billCrewAt(HR, le.ts) === 2 && toast() === 'Luis left the job at ' + clock(le.ts) + '. Movers on the bill: 3 (as quoted) · 2 from the start · 3 from ' + clock(lts) + ' · 2 from ' + clock(le.ts) + '.',
    L('the office takes Luis off the crew: he left now, so the hour he was there stays on the bill: ' + toast()));
  click(chip('Kim')); await sleep(10);
  const ke = HR.crewAdj.slice(-1)[0]; ke.ts -= 20 * M; ke.at -= 20 * M;   // Kim was put on 20 minutes ago
  click(chip('Kim')); await sleep(10);
  const kl = HR.crewAdj.slice(-1)[0];
  ok(kl.who === 'Kim' && kl.d === -1 && HR.crewAdj.filter((e) => e.who === 'Kim').length === 2 && T.billCrewAt(HR, kl.ts - 10 * M) === 4 && T.billCrewAt(HR, kl.ts) === 2, L('someone put on 20 minutes ago and taken off: they leave now, the 20 minutes count (10 minutes ago: Tanya, Andre, Luis and Kim)'));
  await close();
  HR.crewAdj = []; HR.assign.crew = ['Tanya', 'Andre'];
  Object.assign(HR, { status: 'booked', crewOn: undefined }); delete HR.startedAt; delete HR.phases;

  /* ---------------- the bill's rows with the office's crew and changes on site ---------------- */
  const s0 = Date.now() - 5 * H;
  const job = (o) => Object.assign({ quote: N.quote, startedAt: s0, finishedAt: s0 + 5 * H, phases: { loadStart: s0, unloadEnd: s0 + 5 * H }, crewRates: { r2: 140, r3: 195, r4: 250 } }, o || {});
  let c = T.clockBill(job({ assign: { crew: ['Marcus', 'Kim', 'Dee', 'Luis'] }, crewAdj: [{ id: 'x1', ts: s0 + 2 * H, d: 1, who: 'Luis', by: 'Marcus', added: true }, { id: 'x2', ts: s0 + 4 * H, d: -1, who: 'Kim', by: 'Marcus' }] }));
  ok(rowTxt(c.rows.filter((r) => r.k === 'hours')) === '3 movers, 2 hr at $195/hr [' + clock(s0) + ' to ' + clock(s0 + 2 * H) + ' (2h 0m)] $390 | 4 movers, 2 hr at $250/hr [' + clock(s0 + 2 * H) + ' to ' + clock(s0 + 4 * H) + ' (2h 0m)] $500 | 3 movers, 1 hr at $195/hr [' + clock(s0 + 4 * H) + ' to ' + clock(s0 + 5 * H) + ' (1h 0m)] $195', L('3 on the crew, Luis joins 2 hours in and Kim leaves 4 hours in: ' + rowTxt(c.rows.filter((r) => r.k === 'hours'))));
  ok(c.total === 390 + 500 + 195 + 95 && !c.capped && c.over, L('every hour at its crew’s rate, past the $595 not-to-exceed price: ' + money(c.total)));
  c = T.clockBill(job({ assign: { crew: ['Marcus'] } }));
  ok(c.segs.length === 1 && c.rows[0].label === '1 mover, 5 hr at $85/hr' && c.rows[0].amt === 425 && c.total === 520 && !c.capped, L('only one put on a 2-man move: 1 mover at the Rate card’s 1-man rate, $520'));
  c = T.clockBill(job({ assign: { crew: ['Marcus', 'Kim'] }, crewAdj: [{ id: 'x1', ts: s0 - H, d: 1, who: 'Kim', by: 'Marcus', added: true }] }));
  ok(c.segs.length === 1 && c.rows[0].label === '2 movers, 5 hr at $140/hr', L('Marcus put on it, and Kim joined from the start: 2'));
  c = T.clockBill(job({ crewAdj: [{ id: 'x1', ts: s0 + 2 * H, d: -1, who: 'Kim' }] }));
  ok(rowTxt(c.rows.filter((r) => r.k === 'hours')).replace(/ \[[^\]]*\]/g, '') === '2 movers, 2 hr at $140/hr $280 | 1 mover, 3 hr at $85/hr $255', L('nobody put on it, and Kim left 2 hours in: 2 as quoted, then 1'));
  c = T.clockBill(job({ assign: { crew: ['Marcus'] }, crewAdj: [{ id: 'x1', ts: s0 + 2 * H, d: 1, who: 'Joe', by: 'Marcus' }] }));
  ok(rowTxt(c.rows.filter((r) => r.k === 'hours')).replace(/ \[[^\]]*\]/g, '') === '1 mover, 2 hr at $85/hr $170 | 2 movers, 3 hr at $140/hr $420', L('Marcus, then someone not on the list joins 2 hours in: 1, then 2'));
  c = T.clockBill(job({ assign: { crew: ['Dee'] }, crewAdj: [{ id: 'x1', ts: s0 + 2 * H, d: 1, who: 'Dee', by: 'Office', added: true }] }));
  ok(rowTxt(c.rows.filter((r) => r.k === 'hours')).replace(/ \[[^\]]*\]/g, '') === '2 movers, 2 hr at $140/hr $280 | 3 movers, 3 hr at $195/hr $585', L('nobody put on it, and Dee joins 2 hours in: the 2 quoted, then one more'));
  c = T.clockBill(job({ assign: { crew: ['Marcus', 'Kim'] }, crewAdj: [{ id: 'x1', ts: s0 + 90 * M, d: -1, who: 'Kim', by: 'Marcus' }] }));
  ok(rowTxt(c.rows.filter((r) => r.k === 'hours')).replace(/ \[[^\]]*\]/g, '') === '2 movers, 1.5 hr at $140/hr $210 | 1 mover, 3.5 hr at $85/hr $298' && !c.capped && c.total === 603, L('Kim leaves 1.5 hours in: the time with 1 mover at its rate, $603'));
  c = T.clockBill(job({ assign: { crew: ['Marcus', 'Kim', 'Dee'] }, clockFix: { hours: 4 } }));
  ok(c.segs.length === 1 && c.rows[0].label === '3 movers, 4 hr at $195/hr' && c.rows[0].sub === clock(s0) + ' to ' + clock(s0 + 5 * H) + ' (5h 0m) · hours set by the office', L('hours set by the office: the 3 on the crew'));
  c = T.clockBill(job({ assign: { crew: ['Marcus', 'Kim', 'Dee'] }, phases: {}, startedAt: s0, finishedAt: 0, clockFix: { hours: 4 } }));
  ok(c.segs.length === 1 && c.segs[0].set && c.rows[0].label === '3 movers, 4 hr at $195/hr', L('no times, hours set by the office: the 3 on the crew'));
  const mq = Object.assign({}, N.quote, { kind: 'mileage', miles: 120, mileRate: 1.5 });
  c = T.clockBill(job({ quote: mq, assign: { crew: ['Marcus', 'Kim', 'Dee'] }, phases: { loadStart: s0, loadEnd: s0 + 2 * H, unloadStart: s0 + 3 * H, unloadEnd: s0 + 4 * H } }));
  ok(c.rows[0].label === '3 movers, 3 hr loading and unloading at $195/hr' && c.rows.find((r) => r.k === 'miles').label === 'Mileage: 120 mi at $1.50/mi', L('a mileage move: 3 on the crew loading and unloading'));

  // the drive-back step's bill (a local move from the shop) has the crew too
  const bt = T.backTry(Object.assign({}, N, { quote: Object.assign({}, N.quote, { shopTravel: true, backH: 0.5 }), startedAt: s0, finishedAt: s0 + 4 * H, phases: { loadStart: s0 + H / 2, unloadEnd: s0 + 4 * H }, assign: { crew: ['Marcus', 'Kim', 'Dee'] }, clockAt: undefined, clockSig: undefined, extras: [], materials: [], crewAdj: [] }), { mins: 30 });
  ok(bt && bt.c.rows[0].label === '3 movers, 4.5 hr at $195/hr', L('the drive-back step’s bill: the 3 on the crew, 4 h on the job and 30 min back: ' + (bt && bt.c.rows[0].label)));

  /* ---------------- a bill made before keeps the quote's crew ---------------- */
  const cp = (f) => { const x = JSON.parse(JSON.stringify(N)); f(x); return x; };
  const old = cp((x) => { x.clockSig = 'c1:' + x.clockSig.slice(3); });
  ok(T.billOld(old) && T.billCrewAt(old, Date.now()) === 2 && T.clockBill(old).rows[0].label === '2 movers, 5 hr at $140/hr', L('a bill signed c1 (before Oct 24) is for the 2 quoted, though 3 are on the crew'));
  T.applyClock(old);
  ok(/^c1:/.test(old.clockSig) && clk(old).amt === 80 && T.billOld(old), L('worked out again, it stays a c1 bill for the 2 quoted ($595, held to the not-to-exceed price)'));
  ok(T.clockStale(cp((x) => { x.assign.crew.push('Luis'); })) && !T.clockStale(cp(() => {})), L('a c3 bill another phone changed the crew of is worked out again when it comes in'));

  /* ---------------- a driver picked is put on the crew ---------------- */
  await open(P);
  const dsel = $('#sheet select[data-drv="sh"]');
  ok(!!dsel && P.quote.crew === 3 && P.assign.crew.join() === 'Marcus,Dee,Luis', L('Priya Nair: 3 quoted, 3 on it'));
  dsel.value = 'Andre'; dsel.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(10);
  ok(P.assign.crew.indexOf('Andre') >= 0 && /^Andre added to the crew, driving .*\. Movers on the bill: 3 \(as quoted\) · 4 from the start\. Priya Nair signs for the bigger crew in the customer app, or before loading\.$/.test(toast()), L('Andre picked to drive: on the crew, and on the bill: ' + toast()));
  await close();

  /* ---------------- saved like the rest of the job ---------------- */
  const doc = T.jobDoc(N), back = T.docToJob(JSON.parse(JSON.stringify(doc)));
  ok(back.assign.crew.join() === 'Marcus,Kim,Dee' && back.clockSig === N.clockSig && !T.clockStale(back), L('in the shared copy and back: the crew and the signature match'));

  /* ---------------- a bill from Build 42 (c3), which billed a short crew as quoted, is worked out again ---------------- */
  const e1 = Date.now(), e0 = e1 - 4 * H;
  Object.assign(HR, { status: 'done', startedAt: e0, finishedAt: e1, actualHours: 4, phases: { loadStart: e0, unloadEnd: e1 }, clockAt: e1, clockSig: 'c3:billed-as-quoted',
    extras: [{ id: 'clock', label: 'By the clock: 4h 0m on the job, billed 4 h (quoted 3.5 h)', amt: 97, ts: e1 }] });
  ok(T.clockStale(HR), L('a c3 bill is out of date here'));
  // and a bill from Build 43 (c4), held to the not-to-exceed price: $870 for 3 movers' 5 hours on Nadia's 2-man move
  Object.assign(N, { clockSig: 'c4:held-to-the-price', extras: (N.extras || []).map((e) => e.id === 'clock' ? Object.assign({}, e, { amt: 355, rows: undefined }) : e) });
  ok(T.clockStale(N), L('so is a c4 bill'));
  T.save(); await sleep(400);
  const saved = w.localStorage.getItem('tally.v1');
  const B = await load(file, { setup: (bw) => bw.localStorage.setItem('tally.v1', saved) });
  const HB = B.T.state().jobs.find((j) => j.id === HR.id), cb = (HB.extras || []).find((e) => e.id === 'clock') || {};
  ok(cb.amt === -123 && (cb.rows || [])[0] && cb.rows[0].label === '2 movers, 4 hr at $140/hr' && /^c5:/.test(HB.clockSig) && B.T.state().jobs.find((j) => j.id === HR.id).quote.total + cb.amt === 605, L('opened again: the 2 who went out, $605 (it was $825 for 3), signed c5'));
  const NB = B.T.state().jobs.find((j) => j.id === N.id), cn = (NB.extras || []).find((e) => e.id === 'clock') || {};
  ok(cn.amt === 555 && NB.quote.total + cn.amt === 1070 && /^c5:/.test(NB.clockSig) && /\$1,070 \(worked out again\)$/.test(NB.log.slice(-1)[0].ev), L('and the bill held to the not-to-exceed price: $1,070 now, for every hour (it was $870)'));
  ok(/^Billed by the clock: 4 h \(2 movers 4 h\), \$605 \(worked out again\)$/.test(HB.log.slice(-1)[0].ev), L('and the activity says so: ' + HB.log.slice(-1)[0].ev));
  ok(B.errors.length === 0, L('no errors opening it (' + B.errors.slice(0, 3).join(' | ') + ')'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
