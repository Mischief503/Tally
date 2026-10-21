// The tidy-up after the full check of every screen (Richie, Oct 15: "Is everything well organized in the ui
// double and triple check everything"): the job sheet in the order the office works it, with only the
// parts a job's stage uses and money tiles in that stage's words; a finished job's next step at the top;
// a deposit taken without the end-of-move forms; Today's "still owed" meaning finished jobs not paid yet;
// one Double-booked row per clash saying who; Reports grouped; the clock card on the crew's Jobs screen; the
// round New quote button for the office only; risky data buttons in red; the Fleet rows with headings.
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'tidy';
const L = (m) => label + ': ' + m;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T, go } = A;
  const st = () => T.state();
  const J = (n) => st().jobs.find((j) => j.d.name === n);
  const sheetOpen = async (n) => { T.ui.jobId = J(n).id; T.render(); await sleep(10); };
  const sheetClose = async () => { T.ui.jobId = null; T.ui.closeAsk = false; T.render(); await sleep(5); };
  const tiles = () => $$('#sheet .kpis .kpi').map((k) => k.querySelector('span').textContent);
  const parts = () => $$('#sheet details[data-k^="sh:"]').map((d) => d.dataset.k.slice(3));

  /* ---------------- the job sheet, by stage ---------------- */
  await sheetOpen('Sam Kowalski');
  ok(J('Sam Kowalski').status === 'lead' && !$('#sheet .kpis'), L('a lead with no price has no money tiles'));
  ok($$('#sheet .sec.row [data-act="sh:requote"]').length === 1 && /Build quote/.test($('#sheet .sec.row').textContent) && !/Edit quote/.test($('#sheet .sec.row').textContent), L('and one button to price it: Build quote (no second Edit quote)'));
  ok(!parts().some((p) => /Payments|Materials and costs|Forms|Photos|Crew notes/.test(p)) && parts().includes('Job notes'), L('and no payments, materials, forms, photos or crew notes yet: ' + parts().join(', ')));
  await sheetClose();

  await sheetOpen('Ortega family');
  const OF = J('Ortega family');
  ok(tiles()[0] === 'Quote' && !tiles().some((t) => /Balance|Bill/.test(t)), L('a quoted job shows its quote, not a bill or a balance: ' + tiles().join(' / ')));
  ok(OF.quote.deposit > 0 ? tiles().includes('Deposit to book') : true, L('and the deposit it takes to book'));
  await sheetClose();

  await sheetOpen('Priya Nair');
  const PN = J('Priya Nair');
  ok(PN.status === 'booked' && tiles().join() === 'Quote,Paid,Left to pay' && !$('#sheet .kpis .kpi.due'), L('a booked job: Quote, Paid, Left to pay, nothing in red (it isn’t due yet)'));
  const order = parts();
  const at = (p) => order.indexOf(p);
  ok(at('Schedule') === 0 && at('Customer and route') === 1 && at('Job notes') === 2 && at('Crew notes') === 3 && at('Quote') === 4 && at('Materials and costs') > at('Quote') && at('Payments') > at('Materials and costs') && at('Forms') > at('Payments') && at('Photos') > at('Forms'), L('the parts in the order the office works them: ' + order.join(', ')));
  ok(!!$('#sheet details[data-k="sh:Schedule"] select[data-jstatus]') && !$('#sheet details[data-k="sh:Customer and route"] select[data-jstatus]'), L('Status sits with the schedule, not the customer'));
  const dep = $$('#sheet [data-act="flow:open"]').find((b) => /Take a payment/.test(b.textContent));
  ok(!!dep, L('the office takes a deposit with Take a payment'));
  click(dep); await sleep(10);
  const flow = () => $('#flow').textContent.replace(/\s+/g, ' ');
  ok(!$('#flow').hidden && /Take a payment/.test(flow()) && !/Form 1 of|Delivery receipt/.test(flow()) && /Left to pay/.test(flow()) && !/Due now/.test(flow()), L('and it goes straight to the payment: no end-of-move forms before a deposit, and nothing “due now”'));
  click('[data-act="flow:close"]'); await sleep(5);
  await sheetClose();

  await sheetOpen('Marcus Tull');
  const MT = J('Marcus Tull'), top = $('#sheet .sec.row .btn.primary');
  ok(MT.status === 'done' && tiles().join() === 'Bill,Paid,Balance due' && !!$('#sheet .kpis .kpi.due'), L('a finished job: Bill, Paid, and the balance due in red'));
  ok(top && top.dataset.act === 'flow:open' && /Sign forms and collect payment/.test(top.textContent), L('its next step is at the top: Sign forms and collect payment'));
  ok($$('#sheet [data-act="flow:open"]').filter((b) => b.classList.contains('primary')).length === 1, L('and the same button lower down, in Payments, isn’t a second yellow one'));
  await sheetClose();

  await sheetOpen('Grace Pham');
  ok(J('Grace Pham').status === 'lost' && tiles()[0] === 'Quote' && !tiles().some((t) => /Balance|Left/.test(t)) && !$('#sheet .kpis .kpi.due'), L('a lost job shows what it was quoted, with no balance in red'));
  ok(!parts().includes('Payments') || J('Grace Pham').payments.length > 0, L('and no Payments part when nothing was paid'));
  await sheetClose();

  /* ---------------- Today ---------------- */
  click('[data-act="tab"][data-tab="today"]'); await sleep(10);
  const tile = $$('.pulse button').find((b) => /still owed/.test(b.textContent));
  const dueDone = st().jobs.filter((j) => j.status === 'done').map((j) => j.id);
  ok(tile && tile.dataset.f === 'done', L('the still-owed tile opens Jobs on Complete'));
  click(tile); await sleep(10);
  ok(T.ui.tab === 'jobs' && T.ui.filter === 'done' && $$('#view [data-act="job:open"]').every((b) => dueDone.includes(b.dataset.id)), L('and the list there is the finished jobs the number comes from'));
  click('[data-act="tab"][data-tab="today"]'); await sleep(10);
  ok(/\$549\.75/.test($$('.pulse button').find((b) => /still owed/.test(b.textContent)).textContent), L('still owed is what finished jobs owe now (Marcus Tull’s $549.75), not booked jobs’ balances'));
  const clashes = [];
  st().jobs.forEach((j) => T.conflictsFor(j).forEach((c) => { const k = [j.id, c.other.id].sort().join('|'); if (!clashes.includes(k)) clashes.push(k); }));
  const rows = $$('#view .alert').filter((a) => /Double-booked/.test(a.textContent));
  ok(rows.length === clashes.length && rows.length > 0, L('one Double-booked row for each clash (' + rows.length + ' rows, ' + clashes.length + ' clashes)'));
  const c0 = st().jobs.map((j) => T.conflictsFor(j)).find((x) => x.length)[0];
  ok(rows.length && new RegExp('Double-booked: .*' + c0.what.replace(/[()]/g, '.')).test(rows[0].textContent) && / and /.test(rows[0].querySelector('small').textContent), L('saying who or which truck is on both jobs: ' + (rows[0] ? rows[0].textContent.replace(/\s+/g, ' ') : '')));
  ok(!$('#fab').hidden && $('#fab').dataset.act === 'fab:quote', L('the office has the round New quote button'));
  click('#fab'); await sleep(10);
  ok(T.ui.tab === 'quote' && $('#fab').getAttribute('aria-current') === 'page', L('and on the quote it shows as the screen you are on'));

  /* ---------------- Reports, grouped ---------------- */
  await go('reports');
  const hs = $$('#view section.card > h2').map((h) => h.textContent);
  const ix = (t) => hs.indexOf(t);
  ok(ix('Collected by month') < ix('Revenue by crew') && ix('Revenue by crew') < ix('Margin on timed jobs') && ix('Margin on timed jobs') < ix('Where jobs come from') && ix('Materials and job costs') < ix('Where jobs come from') && ix('Where jobs come from') < ix('Bid accuracy') && ix('Bid accuracy') < ix('Time on the job by crew') && ix('Time on the job by crew') < ix('Employee hours') && ix('Collected by month') >= 0, L('Reports run money, then where work comes from, then the crews’ time: ' + hs.join(', ')));
  ok($$('#view .tblwrap').every((t) => t.getAttribute('tabindex') === '0' && t.getAttribute('role') === 'region'), L('tables that scroll sideways can be reached from the keyboard'));

  /* ---------------- Setup ---------------- */
  await go('settings', 'data');
  const risky = $$('#view .btn').filter((b) => /Delete all jobs|Reset everything|Replace all jobs with sample data/.test(b.textContent));
  ok(risky.length === 3 && risky.every((b) => b.classList.contains('danger')), L('Your data: the buttons that wipe jobs are red, and Load sample data says it replaces the jobs'));
  await go('settings', 'fleet');
  ok(/Truck/.test(($('#view .colhead') || {}).textContent || '') && $$('#view input[data-s$=".name"]').every((i) => !i.classList.contains('f')), L('Fleet: the rows have headings, and truck names are ordinary boxes'));

  /* ---------------- the crew lead's screens ---------------- */
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  await preview('lead', 'Marcus');
  ok($('#fab').hidden && !$('#tabs .spacer'), L('crew leads have no round button over the screen: they clock in on the card'));
  const card = $('.tclock');
  ok(T.ui.tab === 'crew' && card && card.classList.contains('home') && !card.querySelector('.tc-time') && !card.querySelector('.tc-name') && /paid today \(breaks not counted\)/.test(card.textContent) && !!($('#view .hero-day').compareDocumentPosition(card) & 4), L('his Jobs screen: the greeting, then the big Clock In card with the paid time on one line'));
  A.clockIn('Marcus'); await sleep(5);
  ok(/On the clock/.test($('.tclock').textContent) && !!$('.tclock [data-act="clk:out"]') && /paid today/.test($('.tclock').textContent) && !!$('.tclock #geoLine'), L('on the clock it has Break and Clock Out, and says when his location is shared'));
  const pc = $('#view .crewcard[data-job="' + PN.id + '"]'), pills = $('#view .crewtabs');
  ok(pc && pc.querySelector('[data-act="cr:start"]') && !!pills && ($('.tclock').compareDocumentPosition(pills) & 4) && (pills.compareDocumentPosition(pc) & 4), L('then the Today and History pills, then Priya Nair’s card with Start job'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
