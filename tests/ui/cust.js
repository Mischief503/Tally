// The customer side (Richie, Oct 28: "I want there to be a customer side as well . Where they have a profile . Then
// they can have the app on there phone if they would like and pay with google pay"; they accept their quote, follow move
// day, sign forms ahead, tip the crew, and "They should also be auto took to the review page for the company they book
// through after the move is complete"), seen the owner's way: More › See it their way › Customer. The signed-in
// customer in the phone app is cust-hosted.js; the server's part, tests/function/cust.ts.
// Run: node tests/ui/cust.js <file> <label>
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'cust';
const L = (m) => label + ': ' + m;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T, go } = A;
  const st = () => T.state(), S = () => st().settings, job = (n) => st().jobs.find((j) => j.d.name === n);
  const tabs = () => $$('#tabs button').map((b) => b.textContent.replace(/\d+$/, '').trim()).filter(Boolean);
  const view = () => $('#view').textContent.replace(/\s+/g, ' ');
  const sheet = () => ($('#cust') && !$('#cust').hidden ? $('#cust').textContent.replace(/\s+/g, ' ') : '');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const err = () => ($('#csErr') ? $('#csErr').textContent : '');
  const preview = async (name) => {
    click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
    const chip = $$('#more [data-act="pv:set"][data-role="customer"]').find((b) => b.textContent.trim().indexOf(name) === 0);
    if (!chip) throw new Error('no customer ' + name);
    click(chip); await sleep(30);
  };
  const end = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const logs = (n) => job(n).log.map((l) => l.ev);

  /* ---------- the owner's side: who they can see it as, Setup › Customer app, forms to sign ahead ---------- */
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5);
  const chips = $$('#more [data-act="pv:set"][data-role="customer"]').map((b) => b.textContent.trim());
  ok(chips.indexOf('Ortega family') >= 0 && chips.indexOf('Marcus Tull') >= 0 && chips.indexOf('Devon Reyes (no email)') >= 0 && chips.findIndex((c) => /no email/.test(c)) > chips.indexOf('Lena Wu'), L('See it their way › Customer: each customer, the ones without an email on their move last (' + chips.length + ')'));
  click('#more .panel button[data-act="more:close"]'); await sleep(5);
  await go('settings', 'customers');
  ok(/Customer app/.test(view()) && /sign in with the email on their move/.test(view()) && !!$('[data-s="reviewUrl"]') && $$('#view input[role="switch"]').length === 2, L('Setup › Customer app: how customers get in, the review page, and two switches'));
  const rv = $('[data-s="reviewUrl"]'); rv.value = 'g.page/r/ace'; rv.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(10);
  T.render(); await sleep(10);
  ok(/needs to start with https:\/\//.test(view()), L('a review link that isn’t a web address says so'));
  S().reviewUrl = 'https://g.page/r/your-moving-co/review'; T.save(); T.render(); await sleep(10);
  await go('settings', 'forms');
  click('[data-act="st:sampleagree"]'); await sleep(15);
  const ag = S().forms.find((f) => f.id === 'f_agree');
  ok(ag && ag.required && ag.ahead && ag.kind === 'text' && !$('[data-act="st:sampleagree"]') && /Moving agreement/.test(view()), L('Setup › Forms: the sample moving agreement, required and signed ahead'));
  const aheadChip = $$('[data-act="st:aheadform"]').find((b) => b.dataset.id === 'f_agree');
  ok(aheadChip && aheadChip.getAttribute('aria-pressed') === 'true' && $$('[data-act="st:aheadform"]').find((b) => b.dataset.id === 'f_deliv').getAttribute('aria-pressed') === 'false', L('each form says whether the customer signs it ahead (the delivery receipt: with the crew)'));

  /* ---------- the Ortega family: a quote ---------- */
  await preview('Ortega family');
  ok(st().ui.role === 'customer' && tabs().join('|') === 'My move|Pay|Profile' && $('#fab').hidden && /Preview · Ortega family/.test($('#whoami').textContent), L('their side: My move, Pay, Profile (no More, no round button)'));
  const q = job('Ortega family').quote;
  ok(/Hello/.test(view()) && /Your move with Your Moving Co\./.test(view()) && /Quote/.test(view()) && view().indexOf('$' + q.total.toLocaleString('en-US')) >= 0 && /Estimate, billed by the hour/.test(view()) && !!$('#view [data-act="cs:book"]'), L('My move: the quote, its price, and Book my move'));
  ok(/Sign a form before move day/.test(view()) && /Deposit to book: \$/.test(view()) && /Move day/.test(view()) && /Tell others about Your Moving Co\./.test(view()), L('what’s next: sign ahead, the deposit, move day, the bill, the review'));
  ok(!/Elevator|Dump|crew notes|Sample job/i.test(view()), L('none of the company’s own notes or activity'));
  click('#view [data-act="cs:book"]'); await sleep(15);
  ok(/Book your move crew/.test(sheet()) && /I accept this quote/.test(sheet()) && /deposit holds your date/.test(sheet()), L('Book: the details, the deposit, and the box to accept'));
  click('[data-act="cs:bookgo"]'); await sleep(10);
  ok(err() === 'Tick the box to accept the quote.' && job('Ortega family').status === 'quoted', L('not until the box is ticked'));
  $('#csAgree').checked = true; click('[data-act="cs:bookgo"]'); await sleep(20);
  const oj = job('Ortega family');
  ok(oj.status === 'booked' && oj.cust && oj.cust.bookedAt > 0 && logs('Ortega family').indexOf('Booked by the customer in the customer app') >= 0 && !oj.assign.truckId, L('booked by the customer, no truck yet (dispatch adds it)'));
  ok(/Pay your deposit/.test(sheet()) && toast() === 'Booked! Now the deposit holds your date.', L('straight to the deposit'));
  click('[data-act="cs:paygo"]'); await sleep(20);
  const dep = oj.payments[oj.payments.length - 1];
  ok(dep && dep.amt === q.deposit && dep.method === 'Google Pay' && dep.by === 'customer' && !dep.tip && toast() === 'Deposit paid. Your date is held.', L('the deposit paid: ' + (dep && dep.amt)));
  ok(/Booked/.test(view()) && /You booked it here/.test(view()) && /Deposit paid/.test(view()) && !!$('#view [data-act="cs:sign"]'), L('My move: booked by them, the deposit paid, and a form to sign'));
  click('#view [data-act="cs:sign"]'); await sleep(15);
  ok(/Moving agreement/.test(sheet()) && !!$('#sigPad') && $('#csSigName').value === 'Ortega family', L('the form, the name, the box to sign in'));
  $('#csSigName').value = ''; click('[data-act="cs:signgo"]'); await sleep(5);
  ok(err() === 'Type your name.', L('a name first'));
  $('#csSigName').value = 'Ana Ortega'; click('[data-act="cs:signgo"]'); await sleep(5);
  ok(/Tick the box/.test(err()), L('then the box'));
  $('#csSigAgree').checked = true; click('[data-act="cs:signgo"]'); await sleep(5);
  ok(err() === 'Sign in the box with your finger.', L('then a signature'));
  $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); click('[data-act="cs:signgo"]'); await sleep(15);
  const sg = oj.signed.find((x) => x.formId === 'f_agree');
  ok(sg && sg.ahead && sg.by === 'customer' && sg.name === 'Ana Ortega' && /All signed/.test(sheet()) && logs('Ortega family').some((x) => /Signed ahead in the customer app: Moving agreement \(Ana Ortega\)/.test(x)), L('signed ahead, kept like the crew’s signatures'));
  click('#cust .sheet-head [data-act="cs:close"]'); await sleep(10);
  ok(/Forms signed/.test(view()) && !$('#view [data-act="cs:sign"]'), L('My move: forms signed'));
  click('[data-act="tab"][data-tab="mypay"]'); await sleep(10);
  ok(/Deposit paid|The bill is due after the move/.test(view()) && /Receipts/.test(view()) && /Google Pay/.test(view()), L('Pay: the receipt, and the rest due after the move'));
  click('[data-act="tab"][data-tab="myprofile"]'); await sleep(10);
  ok($('#cpName').value === 'Ortega family' && /ortega\.family@example\.com/.test(view()) && /Get the app/.test(view()) && /Add to Home screen|Add to Home Screen/.test(view()), L('Profile: name, phone, the email they sign in with, and how to put the app on their phone'));
  $('#cpPhone').value = '512-555-0111'; click('[data-act="cs:prof"]'); await sleep(10);
  ok(oj.d.phone === '512-555-0111' && logs('Ortega family').indexOf('The customer changed their phone in the customer app') >= 0, L('a new phone goes on their move, and the activity says so'));
  await end();
  ok(st().ui.role === 'owner' && !sheet(), L('back to the owner’s view'));

  /* ---------- a quote they can’t book here ---------- */
  const mk = (over) => { const j = JSON.parse(JSON.stringify(job('Ortega family'))); Object.assign(j, { id: 'cq_' + Math.random().toString(36).slice(2, 8), status: 'quoted', payments: [], signed: [], log: [], cust: undefined }, over); st().jobs.push(j); T.save(); return j; };
  const past = (() => { const d = new w.Date(); d.setDate(d.getDate() - 2); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  mk({ d: Object.assign({}, job('Ortega family').d, { name: 'Gina Ruiz', email: 'gina@example.com', moveDate: past }) });
  await preview('Gina Ruiz');
  ok(/That day has passed\. Call or text us to pick a new one\./.test(view()) && !$('#view [data-act="cs:book"]'), L('a day that has passed: call or text, no Book button'));
  await end();
  S().opt.custBook = false; T.save();
  mk({ d: Object.assign({}, job('Ortega family').d, { name: 'Hal Moss', email: 'hal@example.com' }) });
  await preview('Hal Moss');
  ok(/Call or text us to book it\./.test(view()) && !$('#view [data-act="cs:book"]'), L('Options › Customers book their own quote off: they call or text'));
  await end();
  S().opt.custBook = true; T.save();
  // no room on the trucks then: every truck has a move at that time
  const day = job('Ortega family').d.moveDate;
  S().trucks.forEach((t, i) => mk({ status: 'booked', assign: { truckId: t.id, crew: [] }, d: Object.assign({}, job('Ortega family').d, { name: 'Busy ' + i, email: '', time: '09:00', moveDate: day, slots: [t.id] }) }));
  const late = mk({ d: Object.assign({}, job('Ortega family').d, { name: 'Ivy Chen', email: 'ivy@example.com', time: '10:00', moveDate: day }) });
  ok(/filled up/.test(T.custBookWhy(late)), L('no room on the trucks then: “' + T.custBookWhy(late) + '”'));
  st().jobs = st().jobs.filter((j) => !/^Busy /.test(j.d.name)); T.save();
  ok(T.custBookWhy(late) === '', L('with room again, it can be booked'));

  /* ---------- Priya Nair: moving today ---------- */
  const pj = job('Priya Nair'), now = Date.now();
  pj.status = 'active'; pj.startedAt = now - 150 * 60e3; pj.eta = { mins: 25, at: now - 125 * 60e3, ts: pj.startedAt }; pj.phases = { loadStart: now - 120 * 60e3, loadEnd: now - 30 * 60e3 }; T.save();
  await preview('Priya Nair');
  ok(/Hi Priya/.test(view()) && /Moving today/.test(view()) && /Move day/.test(view()) && /Your move crew is on the way ?Arrived/.test(view()) && /Loading at 418 Oak St, Austin ?Done at/.test(view()) && /On the road to 77 Ridge Rd, Round Rock ?Left at/.test(view()) && /Marcus leads your move crew of 3\./.test(view()), L('move day as it happens: arrived, loaded, on the road, with Marcus’s crew'));
  ok($('#view .cm-steps li.now') && /On the road/.test($('#view .cm-steps li.now').textContent), L('the step they’re on now is marked'));
  await end();
  pj.phases = {}; pj.eta = { mins: 25, at: Date.now() + 20 * 60e3, ts: Date.now() }; T.save();
  await preview('Priya Nair');
  ok(/Arriving about/.test(view()), L('before they arrive: about when'));
  await end();

  /* ---------- Marcus Tull: moved, the bill due; a tip, and the review page ---------- */
  const mj = job('Marcus Tull');
  await preview('Marcus Tull');
  ok(/Moved · bill due/.test(view()) && /Pay your bill: \$/.test(view()), L('the bill due, with Pay'));
  click('#view [data-act="cs:pay"]'); await sleep(15);
  const total0 = T.custMoves()[0].bill.total, dueNow = T.custMoves()[0].bill.due;
  ok(/Pay your bill/.test(sheet()) && /Tip your crew/.test(sheet()) && /It goes to the 2 movers on your move \(Marcus’s crew\), split evenly\./.test(sheet()) && $$('[data-act="cs:tip"]').length === 5, L('the bill, and a tip for the crew: no tip, 10, 15, 20%, or another amount'));
  click('[data-act="cs:tip"][data-t="15"]'); await sleep(10);
  const tip15 = Math.round(total0 * 15) / 100;
  ok(Math.abs(Number($('#csTotal').textContent.replace(/[$,]/g, '')) - Math.round((dueNow + tip15) * 100) / 100) < 0.001, L('15% of the bill on top: ' + $('#csTotal').textContent));
  click('[data-act="cs:tip"][data-t="other"]'); await sleep(10);
  $('#csTipOther').value = '40'; $('#csTipOther').dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5);
  ok(Number($('#csTotal').textContent.replace(/[$,]/g, '')) === Math.round((dueNow + 40) * 100) / 100 && /^Pay \$/.test($('#csPayBtn').textContent), L('or $40 of their own: ' + $('#csTotal').textContent));
  click('[data-act="cs:paygo"]'); await sleep(30);
  const pay = mj.payments[mj.payments.length - 1];
  ok(pay.amt === dueNow && pay.tip === 40 && pay.method === 'Google Pay' && mj.status === 'paid' && T.tipsOf(mj) === 40, L('paid: the bill, and the $40 tip apart from it; the job is paid'));
  ok(logs('Marcus Tull').some((x) => /Payment \$.* and a \$40 tip for the crew \(Google Pay, the customer in the customer app\)/.test(x)), L('the activity: the payment and the tip'));
  ok(/Your move is done/.test(sheet()) && /Thank you, Marcus!/.test(sheet()) && $('#csCount') && $('#csCount').textContent === '5' && /Taking you to leave a review/.test(sheet()), L('then the thank you, counting down to the review page'));
  await sleep(5300);
  ok(/In the customer’s app, the review page opens now/.test(sheet()) && mj.cust && mj.cust.reviewAt > 0 && logs('Marcus Tull').indexOf('The customer app took them to the review page') >= 0, L('at zero: the review page (here it says so), written down once'));
  ok($('#cust a[data-act="cs:revlink"]').getAttribute('href') === 'https://g.page/r/your-moving-co/review' && $('#cust a[data-act="cs:revlink"]').getAttribute('target') === '_blank', L('Leave a review opens the company’s review page'));
  click('#cust .sheet-head [data-act="cs:close"]'); await sleep(10);
  ok(/All done/.test(view()) && /Paid/.test(view()) && /thank you for the tip/.test(view()), L('My move: all done, paid, and thanks for the tip'));
  await end();
  // the office sees the tip apart from the bill, and the crew's share
  T.openJob(mj.id); await sleep(20);
  const sheetTxt = $('#sheet').textContent.replace(/\s+/g, ' ');
  ok(/\$40 tip for the crew/.test(sheetTxt), L('the office’s job: the tip on the payment, apart from the bill'));
  click('#sheet .sheet-head [data-act="sheet:close"]'); await sleep(10);
  T.openJob(oj.id); await sleep(20);
  ok(/Signed by Ana Ortega, ahead in the customer app/.test($('#sheet').textContent.replace(/\s+/g, ' ')), L('and a form signed ahead says so'));
  click('#sheet .sheet-head [data-act="sheet:close"]'); await sleep(10);

  /* ---------- Nadia Farouk: a bigger crew, signed in the customer app before the crew leaves (Richie, Oct 29) ---------- */
  const nf = job('Nadia Farouk');
  nf.assign.crew = nf.assign.crew.concat('Dee'); T.save();
  const ncf = T.custCrewForm(nf);
  ok(ncf && ncf.id === 'crew:3' && ncf.n === 3 && ncf.rate === 195 && ncf.qc === 2 && ncf.qrate === 140 && ncf.kind === 'crew' && !ncf.signed, L('3 movers on her 2-man move: hers to sign in the app'));
  await preview('Nadia Farouk');
  ok(/Sign 2 forms before move day/.test(view()) && /Bigger crew: 3 movers, Moving agreement/.test(view()) && !!$('#view [data-act="cs:sign"]'), L('what’s next: the bigger crew first, with the moving agreement'));
  click('#view [data-act="cs:sign"]'); await sleep(15);
  ok(/Form 1 of 2/.test(sheet()) && /Bigger crew: 3 movers/.test(sheet()) && /Your quote is for 2 movers at \$140\/hr\. 3 movers are on your move, billed at \$195\/hr for the time they’re on it\./.test(sheet()) && /I agree to 3 movers at \$195\/hr for the time they’re on the job\./.test(sheet()), L('the bigger crew in the words the crew lead shows them'));
  $('#csSigName').value = 'Nadia Farouk'; click('[data-act="cs:signgo"]'); await sleep(5);
  ok(err() === 'Tick the box to show you agree to the bigger crew.', L('the box first: ' + err()));
  $('#csSigAgree').checked = true; $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); click('[data-act="cs:signgo"]'); await sleep(15);
  const ns = nf.signed.find((x) => x.formId === 'crew:3');
  ok(ns && ns.ahead && ns.by === 'customer' && ns.name === 'Nadia Farouk' && ns.n === 3 && ns.rate === 195 && logs('Nadia Farouk').indexOf('Signed ahead in the customer app: Bigger crew: 3 movers at $195/hr (Nadia Farouk)') >= 0, L('signed for 3 movers at $195/hr, kept like the crew’s signatures'));
  ok(/Form 2 of 2/.test(sheet()) && /Moving agreement/.test(sheet()), L('then the moving agreement'));
  click('#cust .sheet-head [data-act="cs:close"]'); await sleep(10);
  ok(/Sign a form before move day/.test(view()) && !/Bigger crew/.test(view()), L('what’s next: only the agreement left'));
  await end();
  ok(!T.crewForm(nf) && T.custCrewForm(nf) && T.custCrewForm(nf).signed && T.custCrewForm(nf).signed.ahead, L('nothing owed for the crew: the lead isn’t asked at Start loading'));
  T.openJob(nf.id); await sleep(20);
  ok(/Signed by Nadia Farouk, ahead in the customer app/.test($('#sheet').textContent.replace(/\s+/g, ' ')) && !/signs for the bigger crew/.test($('#sheet').textContent), L('the office’s job: signed ahead, nothing waiting'));
  click('#sheet .sheet-head [data-act="sheet:close"]'); await sleep(10);
  // moving today, the crew on the way: still theirs to sign until loading starts (only the bigger crew: the crew does the rest)
  const tday = (() => { const d = new w.Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const om = mk({ status: 'active', crewAsk: 1, startedAt: Date.now() - 20 * 60e3, phases: {}, eta: { mins: 25, at: Date.now() + 5 * 60e3, ts: Date.now() - 20 * 60e3 }, assign: { truckId: S().trucks[0].id, crew: ['Marcus', 'Dee', 'Luis', 'Kim'] }, d: Object.assign({}, job('Ortega family').d, { name: 'Omar Haddad', email: 'omar@example.com', moveDate: tday }) });
  await preview('Omar Haddad');
  ok(/Sign for your bigger crew/.test(view()) && /4 movers at \$250\/hr\. Sign here, or with your crew before they load\./.test(view()) && !!$('#view [data-act="cs:sign"]'), L('move day, before loading: sign for the bigger crew here'));
  click('#view [data-act="cs:sign"]'); await sleep(15);
  ok(/Sign before loading/.test(sheet()) && /Bigger crew: 4 movers/.test(sheet()) && !/Moving agreement|Form 1 of/.test(sheet()), L('only the bigger crew (the crew goes over the forms with them)'));
  click('#cust .sheet-head [data-act="cs:close"]'); await sleep(10);
  await end();
  om.phases = { loadStart: Date.now() }; T.save();
  await preview('Omar Haddad');
  ok(!/Sign for your bigger crew/.test(view()) && !$('#view [data-act="cs:sign"]') && !T.custCrewForm(om) && T.crewForm(om) && T.crewForm(om).id === 'crew:4', L('loading started: the crew lead has them sign on their phone'));
  await end();
  st().jobs = st().jobs.filter((j) => j.id !== om.id); T.save();

  /* ---------- Lena Wu: already paid; opening the app takes her to the review page, once ---------- */
  await preview('Lena Wu');
  await sleep(500);
  ok(/Your move is done/.test(sheet()) && $('#csCount'), L('paid before: opening the app counts down to the review page'));
  click('#cust [data-act="cs:norev"]'); await sleep(15);
  const lw = job('Lena Wu');
  ok(!sheet() && lw.cust && lw.cust.reviewAt > 0 && lw.log.some((l) => l.ev === 'The customer app asked for a review (they said not now)'), L('Not now: asked once, and not again'));
  click('[data-act="tab"][data-tab="mypay"]'); await sleep(10); click('[data-act="tab"][data-tab="mymove"]'); await sleep(500);
  ok(!sheet(), L('(not again)'));
  // tips off: no tip on the bill
  await end();
  S().opt.custTips = false; T.save();
  await preview('Lena Wu');
  ok(!/Tip your crew/.test(view()), L('Options › Tips for the crew off: no tip'));
  await end();
  S().opt.custTips = true; T.save();

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
