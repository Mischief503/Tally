// A bigger crew is signed for by the customer, and a short crew alerts the office (Richie, Oct 25: "If someone is added to
// a job it only adds them for the amount of time there . A bigger crew should be signed by the customer . And a short
// crew should alert the office"). Not at Start job (Oct 29: "either the customer can sign from their side before we
// leave or they can sign before the crew starts loading"): before loading, on the lead's phone, here; in the customer
// app, cust.js. Someone put on a running job by the crew chips is in crewbill.js.
// Run against either edition: node tests/ui/crewsign.js <file> <label>
const { load, ok, sleep, summary } = require('./lib');
const file = process.argv[2] || __dirname + '/../../build/tally-artifact.html', label = process.argv[3] || 'crewsign';
const L = (m) => label + ': ' + m;

(async () => {
  const A = await load(file, {});
  const { w, $, $$, click, T, clockIn, openCard } = A;
  const st = () => T.state();
  const H = 36e5, M = 6e4;
  const clock = (ts) => new w.Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = iso(new w.Date()), inDays = (n) => { const d = new w.Date(); d.setDate(d.getDate() + n); return iso(d); };
  const byName = (n) => st().jobs.find((j) => j.d.name === n);
  const N = byName('Nadia Farouk'), HR = byName('Hollis & Reed Law'), P = byName('Priya Nair'), O = byName('Ortega family');
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const flowOn = () => !!$('#flow') && !$('#flow').hidden;
  const flow = () => (flowOn() ? $('#flow').textContent.replace(/\s+/g, ' ') : '');
  const startOn = () => !!$('#start') && !$('#start').hidden;
  const err = () => ($('#flowErr') || {}).textContent || '';
  const open = async (j) => { T.ui.jobId = j.id; T.render(); await sleep(15); };
  const close = async () => { click('#sheet [data-act="sheet:close"].btn'); await sleep(10); };
  const sheet = () => $('#sheet .sheet-body').textContent.replace(/\s+/g, ' ');
  const chip = (n) => $$('#sheet [data-act="sh:crew"]').find((b) => b.dataset.n === n);
  const preview = async (role, staff) => { click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:preview"]'); await sleep(5); click($$('#more [data-act="pv:set"]').find((b) => b.dataset.role === role && b.dataset.staff === staff)); await sleep(15); };
  const endPreview = async () => { click('[data-act="pv:end"]'); await sleep(15); };
  const card = (j) => $('#view [data-job="' + j.id + '"]');
  const cardTxt = (j) => (card(j) ? card(j).textContent.replace(/\s+/g, ' ') : '');
  const inCard = (j, sel) => card(j) && card(j).querySelector(sel);
  const sign = async (name, o = {}) => {
    if (name != null) $('#sigName').value = name;
    $('#sigAgree').checked = o.agree !== false;
    if (o.draw !== false) $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
    click('#flow [data-act="flow:sign"]'); await sleep(15);
  };
  const needs = () => { T.ui.tab = 'today'; T.render(); return $$('#view .alert').map((a) => a.textContent.replace(/\s+/g, ' ')); };
  const crewSigs = (j) => (j.signed || []).filter((x) => /^crew:/.test(x.formId));
  const preSign = (j) => { j.signed = (j.signed || []).concat(st().settings.forms.filter((f) => f.required).map((f) => ({ id: 'sg_' + f.id + '_' + j.id, formId: f.id, title: f.title, name: 'Customer', sig: '', ts: Date.now(), by: 'Office' }))); };

  /* ---------------- the office puts a 3rd mover on Nadia Farouk's 2-man move ---------------- */
  N.d.moveDate = today;
  ok(N.status === 'booked' && N.quote.crew === 2 && N.quote.rate === 140 && N.assign.crew.join() === 'Marcus,Kim' && !T.crewForm(N), L('Nadia Farouk: a 2-man move at $140/hr, Marcus and Kim on it, nothing to sign'));
  await open(N);
  click(chip('Dee')); await sleep(10);
  const f3 = T.crewForm(N);
  ok(f3 && f3.id === 'crew:3' && f3.n === 3 && f3.rate === 195 && f3.title === 'Bigger crew: 3 movers', L('Dee put on it: the customer signs for 3 movers at $195/hr'));
  ok(/Nadia Farouk signs for the bigger crew in the customer app, or before loading\.$/.test(toast()) && sheet().includes('3 movers on the job, quoted for 2: Nadia Farouk signs for the bigger crew in the customer app, or before loading.'), L('the toast and the sheet say so: ' + toast()));
  N.d.email = ''; T.render(); await sleep(10);
  ok(sheet().includes('3 movers on the job, quoted for 2: Nadia Farouk signs for the bigger crew before loading.'), L('no email on the move (no customer app for her): before loading'));
  N.d.email = 'nadia.farouk@example.com';
  await close();

  /* ---------------- Marcus starts it: nothing to sign yet (he isn't with her), she signs before loading ---------------- */
  clockIn('Marcus', 'Kim', 'Dee');
  await preview('lead', 'Marcus'); await openCard(N.id);
  ok(cardTxt(N).includes('3 movers on the job, quoted for 2: Nadia Farouk signs for the bigger crew in the customer app, or before loading.'), L('Marcus’s card tells him before he starts'));
  click(inCard(N, '[data-act="cr:start"]')); await sleep(20);
  const startTxt = () => $('#start').textContent.replace(/\s+/g, ' ');
  ok(!flowOn() && startOn() && startTxt().includes('Nadia Farouk hasn’t signed for the bigger crew (3 movers) yet: they can in the customer app, or you get it before loading.'), L('Start job asks nothing (the crew isn’t with her yet); the start screen says when she signs: ' + startTxt().slice(0, 160)));
  click('#start [data-act="go:start"]'); await sleep(20);
  await openCard(N.id);
  ok(N.status === 'active' && N.crewAsk === 1 && T.crewForm(N) && T.crewForm(N).id === 'crew:3' && cardTxt(N).includes('3 movers on the bill, quoted for 2: Nadia Farouk signs for the bigger crew in the customer app, or before loading.'), L('started: the signature for 3 is still owed, before loading'));
  await endPreview();
  ok(!needs().some((a) => /Bigger crew/.test(a)), L('the office’s Needs you: nothing yet (she signs before loading)'));
  await preview('lead', 'Marcus'); await openCard(N.id);
  click(inCard(N, '[data-act="cr:phase"][data-k="loadStart"]')); await sleep(20);
  ok(flowOn() && flow().includes('Before loading · Bigger crew') && flow().includes('Bigger crew: 3 movers') && flow().includes('The quote is for 2 movers at $140/hr. 3 movers are on this move, billed at $195/hr for the time they’re on it.') && !(N.phases && N.phases.loadStart), L('Start loading: the customer signs for the bigger crew first: ' + flow().slice(0, 240)));
  ok(flow().includes('I agree to 3 movers at $195/hr for the time they’re on the job.') && !!$('#flow [data-act="cs:later"]') && flow().includes('Start loading, the customer signs later') && flow().includes('If the customer won’t sign, call the office: they can take someone off the job.'), L('what Nadia agrees to, a way to load and sign later, and what to do if she won’t'));
  await sign('Nadia Farouk', { agree: false, draw: false });
  ok(flowOn() && err() === 'Tick the box to show the customer agrees to the bigger crew.', L('not ticked: ' + err()));
  await sign(null, { draw: false });
  ok(flowOn() && err() === 'The customer needs to sign in the box.', L('not signed: ' + err()));
  await sign('Nadia Farouk');
  const s3 = crewSigs(N)[0] || {};
  ok(!flowOn() && N.phases && N.phases.loadStart > 0 && /^Signed: Nadia Farouk agrees to 3 movers at \$195\/hr\. Loading started at \d{1,2}:\d{2} [AP]M\.$/.test(toast()), L('signed: loading starts: ' + toast()));
  ok(s3.formId === 'crew:3' && s3.n === 3 && s3.rate === 195 && s3.name === 'Nadia Farouk' && s3.by === 'Marcus' && /^data:/.test(s3.sig) && N.log.some((l) => l.ev === 'Signed: Bigger crew: 3 movers at $195/hr, by Nadia Farouk') && N.log.slice(-1)[0].ev === 'Loading started · Marcus', L('kept on the job with the forms, then loading: ' + N.log.slice(-2).map((l) => l.ev).join(' / ')));
  ok(!T.crewForm(N) && !T.formsPending(N).some((f) => /^crew:/.test(f.id)) && T.formsPending(N).length === st().settings.forms.filter((f) => f.required).length, L('loading: nothing more to sign for the crew, only the forms at the end'));

  /* ---------------- Luis joins on site: 4 movers, Nadia signs again ---------------- */
  await openCard(N.id);
  click(inCard(N, '.cc-movers [data-act="mv:open"]')); await sleep(10);
  click($$('#mover [data-act="mv:pick"]').find((b) => b.dataset.n === 'Luis')); await sleep(8);
  ok(/and Nadia Farouk signs for 4 movers\.$/.test($('#mvWhat').textContent), L('the movers panel says she signs for 4: ' + $('#mvWhat').textContent));
  click('#mover [data-act="mv:save"]'); await sleep(15);
  const lj = (N.crewAdj || []).slice(-1)[0] || {};
  ok(/^Luis is on the job\. 4 movers on the bill from .*\. Nadia Farouk signs for the bigger crew\./.test(toast()) && T.crewForm(N) && T.crewForm(N).id === 'crew:4' && T.crewForm(N).rate === 250, L('Luis joins: 4 movers, so a signature for 4 at $250/hr: ' + toast()));
  ok(T.formsPending(N)[0].id === 'crew:4' && !!inCard(N, '.cc-crewok [data-act="cs:open"]') && cardTxt(N).includes('4 movers on the bill, quoted for 2: Nadia Farouk signs for the bigger crew.'), L('first among the forms, and on Marcus’s card with Customer signs'));
  await endPreview();
  ok(needs().some((a) => a === '!Bigger crew, not signed yetNadia Farouk · 4 movers, quoted for 2›'), L('the office’s Needs you: ' + needs().filter((a) => /Bigger/.test(a)).join(' | ')));
  await open(N);
  ok(sheet().includes('4 movers on the bill, quoted for 2: Nadia Farouk signs for the bigger crew.') && !$('#sheet [data-act="cs:open"]') && /Bigger crew: 4 movers\s*Waiting for signature/.test($('#sheet .sheet-body').textContent), L('the sheet: waiting for her signature (no Customer signs button in the office)'));
  await close();
  await preview('lead', 'Marcus'); await openCard(N.id);
  click(inCard(N, '[data-act="cs:open"]')); await sleep(20);
  ok(flowOn() && flow().includes('On the job · Bigger crew') && flow().includes('4 movers are on this move from ' + clock(lj.ts) + ', billed at $250/hr for the time they’re on it.') && !$('#flow [data-act="cs:later"]'), L('Customer signs: for 4 from when Luis joined: ' + flow().slice(0, 200)));
  await sign('Nadia Farouk');
  ok(!flowOn() && !startOn() && toast() === 'Signed: Nadia Farouk agrees to 4 movers at $250/hr.' && !T.crewForm(N) && crewSigs(N).length === 2 && !inCard(N, '.cc-crewok'), L('signed: back to the card, nothing waiting: ' + toast()));
  await endPreview();
  ok(!needs().some((a) => /Bigger crew/.test(a)), L('and gone from Needs you'));

  /* ---------------- Priya Nair: started first, she signs before the job is finished ---------------- */
  P.d.moveDate = today;
  await open(P);
  click(chip('Andre')); await sleep(10);
  ok(P.quote.crew === 3 && T.crewForm(P) && T.crewForm(P).id === 'crew:4', L('Priya Nair, 3 quoted: Andre makes 4'));
  await close();
  clockIn('Marcus', 'Dee', 'Luis', 'Andre');
  await preview('lead', 'Marcus'); await openCard(P.id);
  click(inCard(P, '[data-act="cr:start"]')); await sleep(20);
  ok(!flowOn() && startOn(), L('Start job: straight to the start screen'));
  click('#start [data-act="go:start"]'); await sleep(20);
  await openCard(P.id);
  click(inCard(P, '[data-act="cr:phase"][data-k="loadStart"]')); await sleep(20);
  ok(flowOn() && flow().includes('Bigger crew: 4 movers'), L('Start loading: Priya signs for 4 first'));
  click('#flow [data-act="cs:later"]'); await sleep(20);
  ok(!flowOn() && P.phases && P.phases.loadStart > 0 && /^Loading started at .*\. Priya Nair signs for the bigger crew before you finish\.$/.test(toast()), L('Start loading, the customer signs later: loading starts: ' + toast()));
  await openCard(P.id);
  ok(P.status === 'active' && P.crewAsk === 1 && T.crewForm(P) && T.formsPending(P)[0].id === 'crew:4' && !!inCard(P, '[data-act="cs:open"]') && cardTxt(P).includes('4 movers on the bill, quoted for 3: Priya Nair signs for the bigger crew.'), L('loading: the signature for 4 is still owed, on the card'));
  await endPreview();
  ok(needs().some((a) => a === '!Bigger crew, not signed yetPriya Nair · 4 movers, quoted for 3›'), L('loading without it: in the office’s Needs you'));
  preSign(P);
  await open(P);
  const sel = $('#sheet select[data-jstatus]'); sel.value = 'done'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(15);
  ok(P.status === 'active' && /Bigger crew: 4 movers/.test(toast()), L('it can’t be finished until she signs: ' + toast()));
  T.state().ui.role = 'owner'; T.render(); await sleep(10);
  const wv = $$('#sheet [data-act="sh:waive"]').find((b) => b.dataset.fid === 'crew:4');
  ok(!!wv, L('the owner can waive it on the sheet'));
  click(wv); await sleep(10);
  ok(!T.crewForm(P) && !T.formsPending(P).length && crewSigs(P)[0].waived === true && P.log.slice(-1)[0].ev === 'Waived: the customer’s signature for the bigger crew', L('waived: nothing owed: ' + P.log.slice(-1)[0].ev));
  const sel2 = $('#sheet select[data-jstatus]'); sel2.value = 'done'; sel2.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(15);
  ok(P.status === 'done' && !T.crewForm(P), L('then it finishes, and a finished job asks nothing more'));
  await close();

  /* ---------------- a job started on a phone from before asks nothing ---------------- */
  const pre = JSON.parse(JSON.stringify(N)); pre.signed = []; delete pre.crewAsk;
  ok(!T.crewForm(pre) && !T.crewReq(pre) && !T.formsPending(pre).some((f) => /^crew:/.test(f.id)), L('started without crewAsk (an older version started it): no signature asked for'));

  /* ---------------- Options › Customer signs for a bigger crew, off ---------------- */
  HR.d.moveDate = today;
  await open(HR);
  click(chip('Dee')); await sleep(5); click(chip('Kim')); await sleep(10);
  ok(HR.assign.crew.join() === 'Tanya,Andre,Dee,Kim' && T.crewForm(HR) && T.crewForm(HR).n === 4, L('Hollis & Reed, 3 quoted: 4 on it'));
  await close();
  st().settings.opt.crewSign = false;
  ok(!T.crewForm(HR), L('switched off: nothing to sign'));
  clockIn('Tanya', 'Andre', 'Dee', 'Kim');
  await preview('lead', 'Tanya'); await openCard(HR.id);
  click(inCard(HR, '[data-act="cr:start"]')); await sleep(20);
  ok(!flowOn() && startOn() && !/bigger crew/i.test($('#start').textContent), L('and the start screen says nothing about it'));
  click('#start [data-act="go:cancel"],#start [data-act="go:close"]'); await sleep(10);
  await endPreview();
  delete st().settings.opt.crewSign;
  await open(HR);
  click(chip('Kim')); await sleep(5); click(chip('Dee')); await sleep(10);
  await close();

  /* ---------------- a short crew: the office sees it ---------------- */
  ok(HR.assign.crew.join() === 'Tanya,Andre' && HR.quote.crew === 3, L('Hollis & Reed: 3 quoted, Tanya and Andre on it, moving today'));
  let nd = needs();
  ok(nd.includes('!Short crewHollis & Reed Law · 2 on the job, quoted for 3 · today›'), L('the office’s Needs you: ' + nd.filter((a) => /Short/.test(a)).join(' | ')));
  ok($$('#view .job').some((b) => b.dataset.id === HR.id && /Short crew/.test(b.textContent)), L('and Today’s list marks it Short crew'));
  await open(HR);
  ok(sheet().includes('Short crew: 2 on the job, quoted for 3. The bill is for 2.'), L('its sheet says so'));
  await close();
  HR.d.moveDate = inDays(4); T.render();
  ok(!needs().some((a) => /Short crew/.test(a)), L('moving in 4 days: not in Needs you yet (the crew may still be put on)'));
  HR.d.moveDate = inDays(1); T.render();
  ok(needs().includes('!Short crewHollis & Reed Law · 2 on the job, quoted for 3 · tomorrow›'), L('tomorrow: in Needs you'));
  HR.d.moveDate = today;
  ok(!O.assign.crew.length && !T.crewShort(O), L('a job nobody is on yet isn’t short (it needs scheduling)'));
  // the lead starting it short sees it too
  await preview('lead', 'Tanya'); await openCard(HR.id);
  ok(cardTxt(HR).includes('Short crew: 2 on the job, quoted for 3. The bill is for 2.'), L('Tanya’s card says so'));
  click(inCard(HR, '[data-act="cr:start"]')); await sleep(20);
  ok(startOn() && $('#start').textContent.includes('Short crew: 2 on the job, quoted for 3. The bill is for 2. The office sees it on Today.'), L('and the start screen: ' + (($('#start .cc-short') || {}).textContent || '')));
  click('#start [data-act="go:start"]'); await sleep(20);
  await endPreview();
  ok(HR.status === 'active' && needs().includes('!Short crewHollis & Reed Law · 2 on the job, quoted for 3 · running now›'), L('running short: in Needs you, running now'));
  T.mvAdd(HR, 'Kim', 1, Date.now(), 'Tanya'); T.render();
  ok(!needs().some((a) => /Short crew/.test(a)), L('Kim joins: 3, not short any more'));

  /* ---------------- saved like the rest of the job ---------------- */
  const doc = T.jobDoc(N), back = T.docToJob(JSON.parse(JSON.stringify(doc)));
  ok(doc.crewAsk === 1 && back.crewAsk === 1 && crewSigs(back).length === 2 && crewSigs(back).map((x) => x.formId).sort().join() === 'crew:3,crew:4' && !T.crewForm(back), L('in the shared copy and back: the job asks, and both signatures are on it'));

  ok(A.errors.length === 0, L('no errors (' + A.errors.slice(0, 3).join(' | ') + ')'));
  process.exit(summary(label) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
