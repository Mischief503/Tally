// The second pass (Richie, Oct 15: "Now criticize your own work and see if you can find 15 improvements"):
// the on-the-clock tile opens Employee hours; booked jobs without their deposit show in Needs you and on
// the Jobs list; Needs you shows five rows with the rest a tap away; the payment screen fills in the
// deposit or the whole balance with one tap and keeps a typed amount when the screen redraws; a clash on
// the job sheet opens the other job; things removed in Setup come back with Undo; the catalog's cubic feet
// and fees change right in the list; My jobs headings match the other screens; Reports' three-tile rows.
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'polish';
const L = (m) => label + ': ' + m;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T, go } = A;
  const st = () => T.state(), S = () => st().settings;
  const J = (n) => st().jobs.find((j) => j.d.name === n);
  const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const typeIn = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const toastText = () => ($('#toast').hidden ? '' : $('#toast').textContent);
  const alerts = () => $$('#view .alert');
  const toToday = async () => { click('[data-act="tab"][data-tab="today"]'); await sleep(10); };

  /* ---------------- Today ---------------- */
  await toToday();
  A.clockIn('Dee'); await sleep(5);
  const clk = $$('.pulse button').find((b) => /on the clock/.test(b.textContent));
  ok(clk && clk.dataset.tab === 'reports' && clk.dataset.to === 'hoursCard', L('the on-the-clock tile goes to Reports, at Employee hours'));
  click(clk); await sleep(10);
  ok(T.ui.tab === 'reports' && !!$('#hoursCard') && /Employee hours/.test($('#hoursCard h2').textContent), L('and Employee hours is there to land on'));
  ok($$('#view .kpis.k3').length >= 1 && !$$('#view .kpis[style*="repeat(3,1fr)"]').length, L('Reports’ three-tile rows can shrink on a small phone (no fixed 1fr columns)'));

  // a deposit not paid: one booked job, then two
  const booked = st().jobs.filter((j) => j.status === 'booked' && (!j.d.moveDate || j.d.moveDate >= today));
  ok(booked.length >= 2, L('the sample data has at least two booked jobs still to come (' + booked.length + ')'));
  booked.forEach((j) => { j.quote.deposit = 0; });
  const PN = J('Priya Nair'); PN.quote.deposit = 200; PN.payments = PN.payments.filter(() => false);
  await toToday();
  let dep = alerts().filter((a) => /Deposit not paid yet/.test(a.textContent));
  ok(dep.length === 1 && /Priya Nair · \$200(\.00)? · moves today/.test(dep[0].textContent) && dep[0].dataset.act === 'job:open' && dep[0].dataset.id === PN.id, L('one booked job without its deposit: a row naming it, the amount and the day, opening the job: ' + (dep[0] ? dep[0].textContent.replace(/\s+/g, ' ') : 'none')));
  const other = booked.find((j) => j !== PN); other.quote.deposit = 150; other.payments = [];
  await toToday();
  dep = alerts().filter((a) => /booked jobs have no deposit yet/.test(a.textContent));
  ok(dep.length === 1 && /^2 booked jobs have no deposit yet/.test(dep[0].querySelector('b').textContent) && /\$350(\.00)? in deposits/.test(dep[0].textContent), L('two: one row saying how many and how much in deposits: ' + (dep[0] ? dep[0].textContent.replace(/\s+/g, ' ') : 'none')));
  click(dep[0]); await sleep(10);
  const rowsNoDep = $$('#view [data-act="job:open"]').filter((b) => /No deposit yet/.test(b.textContent)).map((b) => b.dataset.id).sort();
  ok(T.ui.tab === 'jobs' && T.ui.filter === 'booked' && rowsNoDep.join() === [PN.id, other.id].sort().join(), L('it opens Jobs on Booked, where those two say No deposit yet'));
  other.payments.push({ id: 'pd1', amt: 150, method: 'Cash', date: today, ts: Date.now() }); T.render(); await sleep(5);
  ok(!$$('#view [data-act="job:open"]').some((b) => b.dataset.id === other.id && /No deposit yet/.test(b.textContent)), L('a job whose deposit came in loses the badge'));

  // Needs you: five rows, the rest a tap away
  const MT = J('Marcus Tull');
  for (let i = 0; i < 5; i++) { const c = JSON.parse(JSON.stringify(MT)); c.id = 'clone' + i; c.d.name = 'Owes money ' + i; st().jobs.push(c); }
  await toToday();
  const total = +$$('#view .secline').find((x) => /Needs you/.test(x.textContent)).querySelector('small').textContent;
  const more = $('[data-act="today:alerts"]');
  ok(total > 6 && alerts().length === 5 && more && more.textContent === 'Show ' + (total - 5) + ' more' && more.getAttribute('aria-expanded') === 'false', L('Needs you shows the first five of ' + total + ' and a Show ' + (total - 5) + ' more button'));
  ok(/Truck down|Double-booked|need scheduling|past/.test(alerts()[0].textContent), L('the most urgent kinds stay at the top: ' + alerts()[0].textContent.replace(/\s+/g, ' ').slice(0, 60)));
  click(more); await sleep(5);
  ok(alerts().length === total && $('[data-act="today:alerts"]').textContent === 'Show fewer' && $('[data-act="today:alerts"]').getAttribute('aria-expanded') === 'true', L('tapping it shows all ' + total + ', with Show fewer'));
  click('[data-act="today:alerts"]'); await sleep(5);
  ok(alerts().length === 5, L('and Show fewer goes back to five'));
  // exactly six: all six show (a button to see one more row would be silly)
  const done = st().jobs.filter((j) => j.status === 'done' && !/^clone/.test(j.id));
  st().jobs = st().jobs.filter((j) => j.status !== 'done'); T.ui.allAlerts = false; T.render(); await sleep(5);
  const base = alerts().length;
  for (let i = 0; i < 6 - base; i++) { const c = JSON.parse(JSON.stringify(MT)); c.id = 'clone' + i; c.d.name = 'Owes money ' + i; st().jobs.push(c); }
  T.render(); await sleep(5);
  ok(base <= 6 && alerts().length === 6 && !$('[data-act="today:alerts"]'), L('six rows all show, with no button for one more (' + base + ' without the finished jobs)'));
  st().jobs = st().jobs.filter((j) => !/^clone/.test(j.id)).concat(done); T.render(); await sleep(5);

  /* ---------------- taking a deposit ---------------- */
  T.ui.jobId = PN.id; T.render(); await sleep(10);
  click($$('#sheet [data-act="flow:open"]').find((b) => /Take a payment/.test(b.textContent))); await sleep(10);
  const q = $$('#flow .payq [data-act="flow:amt"]');
  ok(q.length === 2 && /^Deposit \$200(\.00)?$/.test(q[0].textContent) && /^Whole balance \$/.test(q[1].textContent), L('the payment screen offers the deposit and the whole balance: ' + q.map((b) => b.textContent).join(' / ')));
  const bal = +q[1].textContent.replace(/[^\d.]/g, '');
  click(q[0]); await sleep(5);
  ok($('#flowAmt').value === '200.00', L('Deposit fills in 200.00'));
  const cash = $('#flow [data-act="flow:method"][data-m="other"]');
  if (cash) { click(cash); await sleep(5); ok($('#flowAmt').value === '200.00', L('and picking Cash or check keeps it (it used to go back to the whole balance)')); }
  typeIn($('#flowAmt'), '12500'); await sleep(5);
  if (cash) { click($('#flow [data-act="flow:method"]')); await sleep(5); click('#flow [data-act="flow:method"][data-m="other"]'); await sleep(5); ok($('#flowAmt').value === '125.00', L('a typed amount stays too when the way to pay changes')); }
  click('#flow .payq [data-act="flow:amt"]'); await sleep(5);
  click('[data-act="flow:pay"]'); await sleep(10);
  ok(PN.payments.some((p) => p.amt === 200), L('the deposit is recorded'));
  ok(!$('#flow .payq') && (!$('#flowAmt') || Math.abs(+$('#flowAmt').value.replace(/,/g, '') - (bal - 200)) < 0.01 || $('#flow').hidden), L('after it, no deposit chip, and the amount starts again from what is left' + ($('#flowAmt') ? ' (' + $('#flowAmt').value + ')' : '')));
  if (!$('#flow').hidden) click('[data-act="flow:close"]'); await sleep(5);
  T.ui.jobId = null; T.render(); await sleep(5);

  /* ---------------- a clash opens the other job ---------------- */
  const cj = st().jobs.find((j) => T.conflictsFor(j).length), oth = T.conflictsFor(cj)[0].other;
  T.ui.jobId = cj.id; T.render(); await sleep(10);
  const note = $('#sheet .clashnote');
  ok(note && note.tagName === 'BUTTON' && note.dataset.act === 'job:open' && note.dataset.id === oth.id && /Open it/.test(note.textContent), L('the clash on the sheet is a button to the other job: ' + (note ? note.textContent.replace(/\s+/g, ' ') : 'none')));
  click(note); await sleep(10);
  ok(T.ui.jobId === oth.id && $('#sheet h2').textContent === oth.d.name && $('#sheet').dataset.job === oth.id, L('tapping it opens ' + oth.d.name));
  T.ui.jobId = null; T.render(); await sleep(5);

  /* ---------------- Setup: Undo, and the catalog edited in place ---------------- */
  await go('settings', 'fleet');
  const n0 = S().trucks.length, t1 = S().trucks[1];
  click('[data-act="st:rmtruck"][data-i="1"]'); await sleep(5);
  ok(S().trucks.length === n0 - 1 && /Removed .*\.\s*Undo/.test(toastText()) && !!$('#toast [data-act="toast:undo"]'), L('removing a truck says so, with Undo: ' + toastText()));
  click('#toast [data-act="toast:undo"]'); await sleep(5);
  ok(S().trucks.length === n0 && S().trucks[1].id === t1.id && /is back/.test(toastText()) && $$('#view [data-act="st:rmtruck"]').length === n0, L('Undo puts it back in its place: ' + toastText()));
  const tcf = $('#view input[data-s="trucks.0.cf"]'), cf0 = S().trucks[0].cf;
  typeIn(tcf, ''); typeIn(tcf, '0');
  ok(S().trucks[0].cf === cf0, L('clearing a truck’s cubic feet to retype it doesn’t save a zero'));

  await go('settings', 'catalog');
  $$('#view details').forEach((d) => { d.open = true; });
  const c0 = S().catalog[0], cin = $('#view input.cin[data-s="catalog.0.cf"]'), fin = $('#view input.cin[data-s="catalog.0.fee"]');
  ok(cin && fin && +cin.value === c0.cf && /cubic feet/.test(cin.getAttribute('aria-label')), L('each catalog row has its cubic feet and fee in boxes'));
  typeIn(cin, '61.5'); typeIn(fin, '25');
  ok(S().catalog[0].cf === 61.5 && S().catalog[0].fee === 25, L('typing saves them: ' + S().catalog[0].cf + ' cu ft, $' + S().catalog[0].fee));
  typeIn(cin, '');
  ok(S().catalog[0].cf === 61.5, L('an emptied box keeps the old number'));
  typeIn(fin, '');
  ok(!S().catalog[0].fee, L('an emptied fee means no fee'));
  const nCat = S().catalog.length;
  click('[data-act="st:rmitem"][data-i="0"]'); await sleep(5);
  ok(S().catalog.length === nCat - 1 && /Removed /.test(toastText()), L('removing a catalog item has Undo too'));
  click('#toast [data-act="toast:undo"]'); await sleep(5);
  ok(S().catalog.length === nCat && S().catalog[0].id === c0.id, L('and it comes back first in the list'));
  await go('settings', 'mats');
  const nm = S().materials.length;
  click('[data-act="st:rmmat"][data-i="0"]'); await sleep(5); click('#toast [data-act="toast:undo"]'); await sleep(5);
  ok(S().materials.length === nm, L('a material comes back with Undo'));
  // a toast without Undo after it can't bring back what was removed before
  click('[data-act="st:rmmat"][data-i="0"]'); await sleep(5);
  const m0 = S().materials.length;
  click('[data-act="st:addmat"]'); await sleep(5);   // nothing typed: a message saying what to fill in replaces the Undo one
  const stale = w.document.createElement('button'); stale.dataset.act = 'toast:undo'; w.document.body.appendChild(stale); click(stale); stale.remove(); await sleep(5);
  ok(S().materials.length === m0 && !$('#toast [data-act="toast:undo"]'), L('once another message replaces it, an old Undo does nothing'));

  /* ---------------- My jobs headings ---------------- */
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === 'lead' && b.dataset.staff === 'Marcus')); await sleep(15);
  click('[data-act="tab"][data-tab="crew"]'); await sleep(10);
  const hs = $$('#view h2').filter((h) => /Finished, needs billing|Finished jobs/.test(h.textContent));
  ok(hs.length >= 1 && hs.every((h) => h.parentElement.classList.contains('secline')), L('My jobs: the Finished headings look like every other section heading (' + hs.map((h) => h.textContent).join(', ') + ')'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
