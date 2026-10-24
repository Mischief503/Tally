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
  ok(N.assign.crew.join() === 'Marcus,Kim,Dee' && toast() === 'Dee added to the job. Movers on the bill: 2 (as quoted) · 3 from the start.', L('the Board: Dee put on Nadia’s job: ' + toast()));
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
  ok(N.assign.crew.join() === 'Marcus,Kim,Dee' && !(N.crewAdj || []).length && toast() === 'Dee added to the job. Movers on the bill: 2 (as quoted) · 3 from the start.', L('the office puts Dee on it: ' + toast()));
  ok(line() === 'Movers on the bill: 2 (as quoted) · 3 from the startA mover joined or left', L('the sheet says so: ' + line()));
  ok(sheet().includes('The final bill comes from the crew’s times. The bill is for 3 movers at $195/hr, the people on the job; the quote is for 2 at $140/hr. The time with more movers than quoted is on top of the not-to-exceed price, so let Nadia Farouk know.'), L('and the Local move part: 3 movers at the 3-man rate, and to tell the customer'));
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
  N.signed = (N.signed || []).concat(st().settings.forms.filter((f) => f.required).map((f) => ({ id: 'sg_' + f.id, formId: f.id, title: f.title, name: 'Nadia', sig: '', ts: now, by: 'Marcus' })));
  await open(N);
  const sel = $('#sheet select[data-jstatus]'); sel.value = 'done'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(15);
  const c1 = clk(N), r1 = (c1 && c1.rows) || [];
  ok(N.status === 'done' && c1 && c1.amt === 355 && c1.label === 'By the clock: 5h 0m on the job, billed 5 h: 3 movers 5 h (quoted 3 h for 2 movers), held to the not-to-exceed price', L('finished: one line on the bill, +$355: ' + (c1 && c1.label)));
  ok(r1.length === 4 && r1[0].label === '3 movers, 5 hr at $195/hr' && r1[0].amt === 975 && r1[0].sub === clock(t0) + ' to ' + clock(now) + ' (5h 0m)' && r1[1].label === 'Truck and fuel' && r1[2].label === 'Stairs: 2 flights' &&
    r1[3].label === 'Held to the not-to-exceed price' && r1[3].amt === -200 && r1[3].sub === '$595 for 2 movers, as quoted. The time with more movers is on top of it.', L('its rows: 3 movers for the whole job at $195/hr, the fees, and $595 for the 2 quoted: ' + rowTxt(r1)));
  ok(N.quote.total + c1.amt === 870 && r1.reduce((a, r) => a + r.amt, 0) === 870, L('the bill: $975 + $95 − $200 = $870 (the 2 quoted held to $595, the 3rd mover on top)'));
  ok(N.log.filter((l) => /^Billed by the clock/.test(l.ev)).slice(-1)[0].ev === 'Billed by the clock: 5 h (3 movers 5 h), $870', L('the activity: ' + N.log.filter((l) => /^Billed by the clock/.test(l.ev)).slice(-1)[0].ev));
  ok(N.crewRates && N.crewRates.r2 === 140 && N.crewRates.r3 === 195 && N.crewRates.r4 === 250, L('the Rate card is kept on the job with the bill'));
  ok(/^c3:.*\|n:2\|c:\["Dee","Kim","Marcus"\]\|m:\[\]\/140,195,250$/.test(N.clockSig) && !T.clockStale(N), L('the bill’s signature has who’s on the crew (c3, so the version before leaves it alone): ' + N.clockSig.slice(-60)));
  const sr = [...$('#sheet details.acc[data-k="sh:Quote"] table.lines').querySelectorAll('tr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  ok(sr.join(' / ') === '2 movers, 3 hr at $140/hr$420 / Truck and fuel$45 / Stairs: 2 flights$50 / Quote$515 / Billed by the clock / 3 movers, 5 hr at $195/hr' + clock(t0) + ' to ' + clock(now) + ' (5h 0m)$975 / Truck and fuel$45 / Stairs: 2 flights$50 / Held to the not-to-exceed price$595 for 2 movers, as quoted. The time with more movers is on top of it.−$200 / Bill$870', L('the sheet: the quote, then the bill by the movers on it: ' + sr.join(' / ')));
  ok(sheet().includes('On the clock 5h 0m: billed 5 h (3 movers 5 h). Bill $870, held to the not-to-exceed price (+$355 on the quote). Billed for 3 movers at $195/hr; the quote is for 2 at $140/hr.'), L('and explains it'));
  ok(line() === 'Movers on the bill: 2 (as quoted) · 3 from the start', L('finished: the line stays, with nothing to change: ' + line()));

  /* ---------------- after the job: a mover the office forgot ---------------- */
  click(chip('Luis')); await sleep(10);
  const c2 = clk(N);
  ok(N.assign.crew.join() === 'Marcus,Kim,Dee,Luis' && c2.amt === 630 && c2.rows[0].label === '4 movers, 5 hr at $250/hr' && c2.rows[0].amt === 1250 && N.quote.total + c2.amt === 1145, L('Luis put on it after the job: the bill is worked out again, 4 movers for the whole job ($1,145)'));
  ok(toast() === 'Luis added to the job. Movers on the bill: 2 (as quoted) · 4 from the start.' && N.log.slice(-1)[0].ev === 'Billed by the clock: 5 h (4 movers 5 h), $1,145 (crew changed)', L('the toast and the activity: ' + toast() + ' | ' + N.log.slice(-1)[0].ev));
  click(chip('Luis')); await sleep(10);
  ok(N.assign.crew.join() === 'Marcus,Kim,Dee' && clk(N).amt === 355 && toast() === 'Luis removed from the job. Movers on the bill: 2 (as quoted) · 3 from the start.', L('and off again: back to $870'));
  const drv = $('#sheet select[data-drv="sh"]');
  drv.value = 'Andre'; drv.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(10);
  ok(N.assign.crew.indexOf('Andre') >= 0 && clk(N).amt === 630 && /^Andre added to the crew, driving .*\. Movers on the bill: 2 \(as quoted\) · 4 from the start\.$/.test(toast()), L('a driver picked after the job is on the crew and the bill ($1,145): ' + toast()));
  click(chip('Andre')); await sleep(10);
  ok(N.assign.crew.indexOf('Andre') < 0 && clk(N).amt === 355, L('and off again: $870'));
  await close();

  /* ---------------- the lead's card after the job ---------------- */
  await preview('lead', 'Marcus');
  if (card(N) && card(N).tagName === 'DETAILS') { click(card(N).querySelector('summary b')); await sleep(10); }
  ok(card(N) && card(N).querySelector('.cc-movers').textContent === 'Movers on the bill: 2 (as quoted) · 3 from the start' && /Billed for 3 movers at \$195\/hr; the quote is for 2 at \$140\/hr\./.test(card(N).querySelector('.cc-quote').textContent), L('Marcus’s card: the movers line, and his Quote part explains the bill'));
  await endPreview();

  /* ---------------- fewer than quoted: billed as quoted ---------------- */
  ok(HR.quote.crew === 3 && HR.assign.crew.join() === 'Tanya,Andre' && T.billCrewAt(HR, Date.now()) === 3 && T.mvSummary(HR) === '3 (as quoted)', L('Hollis & Reed: 3 quoted, Tanya and Andre on it so far: billed for the 3 quoted'));
  await open(HR);
  ok(line() === 'Movers on the bill: 3 (as quoted)A mover joined or left' && !/The bill is for/.test(sheet()), L('its sheet: 3 as quoted'));
  const hb = T.clockBill(Object.assign({}, HR, { startedAt: Date.now() - 4 * H, phases: { loadStart: Date.now() - 4 * H, unloadEnd: Date.now() } }));
  ok(hb.segs.length === 1 && hb.rows[0].label === '3 movers, 4 hr at $195/hr', L('by the clock: 3 movers at the quote’s rate'));
  T.mvAdd(HR, 'Andre', -1, Date.now(), 'Office');
  ok(T.billCrewAt(HR, Date.now()) === 2 && T.mvSummary(HR) === '3 (as quoted) · 2 from the start', L('someone marked as left takes a mover off: 2 from the start'));
  T.mvUndo(HR, HR.crewAdj[0].id); T.render(); await sleep(5);
  ok(!HR.crewAdj.length && T.billCrewAt(HR, Date.now()) === 3, L('taken back: 3 again'));
  click(chip('Dee')); await sleep(10);
  ok(T.mvSummary(HR) === '3 (as quoted)' && toast() === 'Dee added to the job. Movers on the bill: 3 (as quoted).', L('Dee makes the 3 quoted: ' + toast()));
  click(chip('Kim')); await sleep(10);
  ok(T.mvSummary(HR) === '3 (as quoted) · 4 from the start' && toast() === 'Kim added to the job. Movers on the bill: 3 (as quoted) · 4 from the start.', L('and Kim a 4th: ' + toast()));
  click(chip('Kim')); await sleep(5); click(chip('Dee')); await sleep(5);
  ok(HR.assign.crew.join() === 'Tanya,Andre' && T.mvSummary(HR) === '3 (as quoted)', L('both off again'));
  // someone joining a crew short of the quote is one more, as the movers panel says
  click('#sheet .cc-movers [data-act="mv:open"]'); await sleep(10);
  click($$('#mover [data-act="mv:pick"]').find((x) => x.dataset.n === 'Dee')); await sleep(8);
  ok(/^From the start: 4 movers on the bill at \$250\/hr \(the quote is \$195\/hr for 3\)\./.test($('#mvWhat').textContent), L('the panel: Dee joining makes 4: ' + $('#mvWhat').textContent));
  click('#mover [data-act="mv:save"]'); await sleep(10);
  ok(HR.assign.crew.join() === 'Tanya,Andre,Dee' && T.billCrewAt(HR, Date.now()) === 4 && T.mvSummary(HR) === '3 (as quoted) · 4 from the start' && /4 movers on the bill from the start\./.test(toast()), L('saved: 4, as it said (the 2 put on it, the 3rd quoted, and Dee)'));
  click('#sheet .cc-movers [data-act="mv:open"]'); await sleep(10);
  click('#mover [data-act="mv:undo"]'); await sleep(10); click('#mover [data-act="mv:close"]'); await sleep(8);
  ok(HR.assign.crew.join() === 'Tanya,Andre' && !HR.crewAdj.length && T.billCrewAt(HR, Date.now()) === 3, L('taken back: 3 as quoted'));
  await close();

  /* ---------------- nobody on the crew yet: the quote's crew ---------------- */
  ok(!O.assign.crew.length && T.billCrewAt(O, Date.now()) === 3 && T.mvSummary(O) === '3 (as quoted)', L('Ortega family, nobody on it yet: the 3 quoted'));

  /* ---------------- a running job: someone joins on site, and the chips ---------------- */
  const h0 = Date.now() - 3 * H;
  Object.assign(HR, { status: 'active', startedAt: h0, phases: { loadStart: h0 }, crewOn: { Tanya: [{ in: h0, out: 0 }], Andre: [{ in: h0, out: 0 }] } });
  T.mvAdd(HR, 'Luis', 1, Date.now() - H, 'Tanya'); const lts = HR.crewAdj[0].ts;
  ok(HR.assign.crew.join() === 'Tanya,Andre,Luis' && T.billCrewAt(HR, h0 + H) === 3 && T.billCrewAt(HR, Date.now()) === 4 && T.mvSummary(HR) === '3 (as quoted) · 4 from ' + clock(lts), L('Luis joins an hour ago: 3 as quoted (the 2 on it and the 3rd quoted), then 4: ' + T.mvSummary(HR)));
  await open(HR);
  click(chip('Luis')); await sleep(10);
  ok(HR.assign.crew.join() === 'Tanya,Andre' && !HR.crewAdj.length && T.mvSummary(HR) === '3 (as quoted)' && toast() === 'Luis removed from the job. Movers on the bill: 3 (as quoted).', L('the office takes Luis off the crew: he isn’t on the job, so his joining goes too'));
  click(chip('Dee')); await sleep(5); click(chip('Kim')); await sleep(10);
  ok(T.billCrewAt(HR, h0) === 4 && T.mvSummary(HR) === '3 (as quoted) · 4 from the start' && !HR.crewAdj.length, L('people put on the crew while it runs are on the bill for the whole job (joined part way: A mover joined or left)'));
  click(chip('Kim')); await sleep(5); click(chip('Dee')); await sleep(5);
  await close();
  Object.assign(HR, { status: 'booked', crewOn: undefined }); delete HR.startedAt; delete HR.phases;

  /* ---------------- the bill's rows with the office's crew and changes on site ---------------- */
  const s0 = Date.now() - 5 * H;
  const job = (o) => Object.assign({ quote: N.quote, startedAt: s0, finishedAt: s0 + 5 * H, phases: { loadStart: s0, unloadEnd: s0 + 5 * H }, crewRates: { r2: 140, r3: 195, r4: 250 } }, o || {});
  let c = T.clockBill(job({ assign: { crew: ['Marcus', 'Kim', 'Dee', 'Luis'] }, crewAdj: [{ id: 'x1', ts: s0 + 2 * H, d: 1, who: 'Luis', by: 'Marcus', added: true }, { id: 'x2', ts: s0 + 4 * H, d: -1, who: 'Kim', by: 'Marcus' }] }));
  ok(rowTxt(c.rows.filter((r) => r.k === 'hours')) === '3 movers, 2 hr at $195/hr [' + clock(s0) + ' to ' + clock(s0 + 2 * H) + ' (2h 0m)] $390 | 4 movers, 2 hr at $250/hr [' + clock(s0 + 2 * H) + ' to ' + clock(s0 + 4 * H) + ' (2h 0m)] $500 | 3 movers, 1 hr at $195/hr [' + clock(s0 + 4 * H) + ' to ' + clock(s0 + 5 * H) + ' (1h 0m)] $195', L('3 on the crew, Luis joins 2 hours in and Kim leaves 4 hours in: ' + rowTxt(c.rows.filter((r) => r.k === 'hours'))));
  ok(c.total === 390 + 500 + 195 + 95 - 200, L('held to $595 for the 2 quoted, the rest on top: ' + money(c.total)));
  c = T.clockBill(job({ assign: { crew: ['Marcus'] } }));
  ok(c.segs.length === 1 && c.rows[0].label === '2 movers, 5 hr at $140/hr' && c.total === 595, L('only the lead in Tally: billed for the 2 quoted ($595, held to the not-to-exceed price)'));
  c = T.clockBill(job({ assign: { crew: ['Marcus', 'Kim'] }, crewAdj: [{ id: 'x1', ts: s0 - H, d: 1, who: 'Kim', by: 'Marcus', added: true }] }));
  ok(c.segs.length === 1 && c.rows[0].label === '3 movers, 5 hr at $195/hr', L('only the lead put on it, and Kim joined from the start: one more than the 2 quoted'));
  c = T.clockBill(job({ crewAdj: [{ id: 'x1', ts: s0 + 2 * H, d: -1, who: 'Kim' }] }));
  ok(rowTxt(c.rows.filter((r) => r.k === 'hours')).replace(/ \[[^\]]*\]/g, '') === '2 movers, 2 hr at $140/hr $280 | 1 mover, 3 hr at $85/hr $255', L('nobody put on it, and Kim left 2 hours in: 2 as quoted, then 1'));
  c = T.clockBill(job({ assign: { crew: ['Marcus'] }, crewAdj: [{ id: 'x1', ts: s0 + 2 * H, d: 1, who: 'Joe', by: 'Marcus' }] }));
  ok(rowTxt(c.rows.filter((r) => r.k === 'hours')).replace(/ \[[^\]]*\]/g, '') === '2 movers, 2 hr at $140/hr $280 | 3 movers, 3 hr at $195/hr $585', L('and someone not on the list joins 2 hours in: 2, then 3'));
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
  ok(P.assign.crew.indexOf('Andre') >= 0 && /^Andre added to the crew, driving .*\. Movers on the bill: 3 \(as quoted\) · 4 from the start\.$/.test(toast()), L('Andre picked to drive: on the crew, and on the bill: ' + toast()));
  await close();

  /* ---------------- saved like the rest of the job ---------------- */
  const doc = T.jobDoc(N), back = T.docToJob(JSON.parse(JSON.stringify(doc)));
  ok(back.assign.crew.join() === 'Marcus,Kim,Dee' && back.clockSig === N.clockSig && !T.clockStale(back), L('in the shared copy and back: the crew and the signature match'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
