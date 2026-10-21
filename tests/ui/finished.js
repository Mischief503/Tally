// Finished jobs fold, and the lead always has the quote (Richie, Oct 21: "when i finish a job it should show the
// customer name , date and time on job . Then a option to expand to full details . Aswell as the lead should always be
// able to see the quote and what made up the quote .that way he can explain any differences on the bill to the quote").
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'finished';
const L = (m) => label + ': ' + m;
// the app's own money format: $1,541, or $549.75 when there are cents
const money = (n) => { n = Math.round(n * 100) / 100; const whole = Math.abs(n - Math.round(n)) < 0.005; return '$' + (whole ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60); return h ? h + 'h ' + (m % 60) + 'm' : m + 'm'; };

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T } = A;
  const st = () => T.state();
  const byName = (n) => st().jobs.find((j) => j.d.name === n);
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  const endPreview = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const full = (j) => $('#view section.crewcard[data-job="' + j.id + '"]');
  const row = (j) => $('#view details.hcard[data-job="' + j.id + '"]');
  const small = (j) => Array.from(row(j).querySelectorAll('summary .hsum small')).map((s) => s.textContent);
  const P = byName('Priya Nair'), MT = byName('Marcus Tull'), DR = byName('Devon Reyes');

  /* ---------------- the lead's quote, before the job ---------------- */
  await preview('lead', 'Marcus');
  const q = full(P) && full(P).querySelector('.cc-quote');
  ok(P.status === 'booked' && !!q && q.querySelector('h4').textContent === 'Quote', L('a booked job: Marcus’s card has the Quote'));
  ok(P.quote.lines.every((l) => q.textContent.includes(l.label) && q.textContent.includes(money(Math.abs(l.amt)))), L('every quote line with its amount: ' + P.quote.lines.map((l) => l.label).join(' / ')));
  const qsub = q.querySelector('tr.sub');
  ok(qsub && /^Quote/.test(qsub.textContent) && qsub.textContent.includes(money(P.quote.total)), L('the quote’s total: ' + (qsub && qsub.textContent)));
  ok(q.textContent.includes('Not to exceed' + money(P.quote.nte)) && q.textContent.includes('Deposit at booking' + money(P.quote.deposit)), L('the not-to-exceed price and the deposit'));
  ok(new RegExp(String(P.quote.crew) + ' movers · ' + P.quote.hours + ' h estimated').test(q.textContent) && P.items.every((i) => q.textContent.includes(i.name + ' × ' + i.qty)), L('what it was built from: the movers, the hours, the items'));
  ok(/Mileage move/.test(q.textContent) && /The final bill comes from the crew’s times and the miles driven\./.test(q.textContent) && !q.querySelector('input,[data-act="clk:set"]'), L('how this kind of move is billed, with none of the office’s controls'));
  ok(!full(P).querySelector('.cc-run .cc-sec h4') || ![...full(P).querySelectorAll('.cc-run .cc-sec h4')].some((h) => h.textContent === 'Bill'), L('no Bill yet on a booked job'));
  // the quote sits in the part for running the job, after the photos
  ok(!!(full(P).querySelector('.cc-photos').compareDocumentPosition(q) & 4) && !!q.closest('.cc-run'), L('it sits with running the job, under the photos'));
  await endPreview();

  /* ---------------- crew members never see prices ---------------- */
  await preview('crew', 'Dee');
  ok(!!full(P) && !full(P).querySelector('.cc-quote') && !/\$/.test(full(P).textContent.replace(/Materials[\s\S]*?Photos/, '')), L('Dee’s card for the same job has no quote and no prices'));
  await endPreview();

  /* ---------------- a finished job folds: name, day, time on the job ---------------- */
  const now = Date.now();
  Object.assign(P, { status: 'paid', startedAt: now - (6 * 60 + 12) * 6e4, finishedAt: now, actualHours: 6.2 });
  P.payments.push({ id: 'fp1', amt: 99999, method: 'Cash', date: P.d.moveDate, ts: now });
  P.signed = (P.signed || []).concat(st().settings.forms.filter((f) => f.required).map((f) => ({ id: 'sg_' + f.id, formId: f.id, title: f.title, name: 'Priya Nair', sig: '', ts: now, by: 'Marcus' })));   // signed at the end, as a real finish is
  T.render(); await sleep(5);
  await preview('lead', 'Marcus');
  ok(!full(P) && !!row(P) && !row(P).open, L('finished today, Priya Nair folds on Today'));
  const ps = small(P);
  ok(row(P).querySelector('summary .hsum b').textContent === 'Priya Nair' && ps.length === 1 && ps[0] === 'Today · 6h 12m on the job', L('the customer’s name, the day and the time on the job: ' + ps.join(' / ')));
  ok(!!(Array.from($$('#view .secline h2')).find((h) => h.textContent === 'Today').compareDocumentPosition(row(P)) & 4), L('still under Today until the day is over'));
  click(row(P).querySelector('summary b')); await sleep(10);
  const pb = row(P);
  ok(pb.open && !!pb.querySelector('.cc-quote') && !!pb.querySelector('.cc-photos') && /Paid and closed\. You can still add photos and notes\./.test(pb.textContent), L('tapped, it opens to the full card, with the quote'));
  const bill = [...pb.querySelectorAll('.cc-sec')].find((x) => x.querySelector('h4') && x.querySelector('h4').textContent === 'Bill');
  ok(!!bill && !bill.querySelector('#ce_l_' + P.id) && !bill.querySelector('[data-act="flow:open"],[data-act="back:open"]') && /Paid in full/.test(bill.textContent) && (bill.textContent.match(/Paid in full/g) || []).length === 1, L('a paid job keeps its bill, to read: no charge box, no buttons, “Paid in full” once'));
  await endPreview();

  /* ---------------- a finished job still to bill: what's due under it ---------------- */
  await preview('lead', 'Marcus');
  const due = MT.status === 'done' ? Math.max(0, Math.round(((MT.quote.total + (MT.extras || []).reduce((a, e) => a + e.amt, 0) + (MT.materials || []).reduce((a, m) => a + (m.price == null ? 0 : m.qty * m.price), 0)) - MT.payments.reduce((a, p) => a + p.amt, 0)) * 100) / 100) : 0;
  const ms = small(MT);
  const dd = MT.d.moveDate.split('-').map(Number), dayTxt = new w.Date(dd[0], dd[1] - 1, dd[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  ok(!!row(MT) && !row(MT).open && ms[0] === dayTxt + ' · ' + dur(MT.finishedAt - MT.startedAt) + ' on the job' && ms[1] === money(due) + ' due', L('Finished, needs billing: folded, with what’s still due on its own line: ' + ms.join(' / ')));
  click(row(MT).querySelector('summary b')); await sleep(10);
  const mb = [...row(MT).querySelectorAll('.cc-sec')].find((x) => x.querySelector('h4') && x.querySelector('h4').textContent === 'Bill');
  const sub = mb && mb.querySelector('tr.sub');
  const total = MT.quote.total + (MT.extras || []).reduce((a, e) => a + e.amt, 0) + (MT.materials || []).reduce((a, m) => a + (m.price == null ? 0 : m.qty * m.price), 0), diff = Math.round((total - MT.quote.total) * 100) / 100;
  ok(!!sub && sub.textContent.replace(/\s+/g, ' ').trim() === 'Bill (' + (diff ? (diff > 0 ? '+' : '−') + money(Math.abs(diff)) + ' on the quote' : 'the same as the quote') + ')' + money(total), L('the bill: the quote, what changed it, and the bill against the quote: ' + (sub && sub.textContent)));
  ok(!!row(MT).querySelector('[data-act="flow:open"][data-id="' + MT.id + '"]') && !!row(MT).querySelector('#ce_l_' + MT.id), L('opened, it has Collect payment and the charge box'));
  ok(/By the clock it would be/.test(row(MT).querySelector('.cc-quote').textContent), L('the quote part says what the clock came to, to explain the difference'));
  await endPreview();

  /* ---------------- History: every finished job folds with its time on the job ---------------- */
  await preview('crew', 'Dee');
  click('[data-act="cr:view"][data-v="history"]'); await sleep(15);
  const ds = small(DR), dd2 = DR.d.moveDate.split('-').map(Number), dayDR = new w.Date(dd2[0], dd2[1] - 1, dd2[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  ok(ds.length === 1 && ds[0] === dayDR + ' · ' + dur(DR.finishedAt - DR.startedAt) + ' on the job', L('Dee’s History: ' + DR.d.name + ', ' + ds.join(' / ')));
  click(row(DR).querySelector('summary b')); await sleep(10);
  ok(row(DR).open && !row(DR).querySelector('.cc-quote') && ![...row(DR).querySelectorAll('.cc-sec h4')].some((h) => h.textContent === 'Bill'), L('opened for Dee: no quote and no bill'));
  await endPreview();

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
