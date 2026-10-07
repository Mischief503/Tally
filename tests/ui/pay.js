// Card payments in the app (hosted edition): pay links with QR codes, Stripe's card box, the card on
// file, the office's link for a deposit, the Setup card, and that the artifact stays a demo.
// Stripe.js is a fake here that records what it was asked; the Edge Function is a fake that answers.
const { load, ok, sleep, summary, clone } = require('./lib');
const jsQR = require('jsqr');
const FILE = __dirname + '/../../build/tally-supabase.html';
const ART = __dirname + '/../../build/tally-artifact.html';
const ORG = 'org-1';
const CARD = 'st_9f86d081884c7d659a2f';   // the server's own name for a card on file (no Stripe ids reach the app)
const LINK = 'https://proj.supabase.co/functions/v1/tally-twilio/p/AbCdEfGh23';
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function jobDoc(id, over = {}) {
  return Object.assign({ id, status: 'booked', createdAt: Date.now() - 864e5,
    d: { name: 'Priya Nair', phone: '512-555-0142', email: '', source: 'Google', moveDate: day(2), time: '08:00', from: '418 Oak St', to: '77 Ridge Rd', miles: '', flights: '', pack: false, crew: '', truckId: '', hoursOverride: '', discount: '', notes: '', custom: {}, items: [] },
    quote: { total: 1000, cf: 500, crew: 3, hours: 4, lines: [{ label: 'Movers', amt: 1000 }], deposit: 250, nte: 1150, lbs: 3500, truckId: 't26', truckName: 'Box 1', nTrucks: 1, pct: 0.3, count: 10 },
    items: [], assign: { truckId: 't26', crew: ['Marcus', 'Dee'] }, tally: {}, payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {} }, over);
}
function seed(opts = {}) {
  const docs = [];
  const put = (path, data) => { const [collection, doc_id] = path.split('/'); docs.push({ org_id: ORG, path, collection, doc_id, data, updated_at: new Date().toISOString() }); };
  put('meta/init', { ts: 1, mode: 'fresh' });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }],
    contacts: { Owner: '512-555-0100', Marcus: '512-555-0101' },
    forms: [{ id: 'f1', title: 'Delivery receipt', kind: 'text', required: true, text: 'I accept.', pageIds: [] }], trucks: [{ id: 't26', name: 'Box 1', cf: 1700 }] });
  put('jobs/j1', jobDoc('j1'));
  put('jobs/j2', jobDoc('j2', { status: 'done', d: Object.assign(jobDoc('x').d, { name: 'Lena Wu', phone: '512-555-0177' }), finishedAt: Date.now() - 6e5, startedAt: Date.now() - 4e6,
    signed: { s1: { id: 's1', formId: 'f1', title: 'Delivery receipt', name: 'Lena Wu', ts: 1 } } }));
  if (!opts.noCard) put('vault/' + CARD, { id: CARD, cust: '5125550177', type: 'card', brand: 'Visa', last4: '4242', exp: '03/30', ts: 1, via: 'stripe', live: false,
    name: opts.cardElsewhere ? 'Pat Wu' : 'Lena Wu', jobs: opts.cardElsewhere ? ['j9'] : ['j2'] });
  // a card kept by another Lena Wu, who had no phone number: it belongs to her job (j1 here) alone
  if (opts.namesake) put('vault/st_namesake0000000000', { id: 'st_namesake0000000000', cust: 'job:j1', type: 'card', brand: 'Amex', last4: '0005', exp: '02/31', ts: 2, via: 'stripe', live: false, name: 'Lena Wu', jobs: ['j1'] });
  if (opts.j2) Object.assign(docs.find((d) => d.path === 'jobs/j2').data, opts.j2);
  put('vault/old1', { id: 'old1', cust: '5125550177', type: 'card', brand: 'Mastercard', last4: '1111', exp: '01/29', ts: 1 });
  return {
    docs, access_requests: [], comm_log: [],
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x.com', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-marcus', email: 'm@x.com', staff: 'Marcus', role: 'lead', ts: 1 }],
    comm_lines: opts.noLine ? [] : [{ org_id: ORG, phone_number: '+15125550000', enabled: true }],
    __noDocPatch: !!opts.noDocPatch,
  };
}
// a fake Stripe.js that records what Tally asks of it
function fakeStripe(log, ctl) {
  return (w) => {
    w.Stripe = function (pk) {
      log.push(['init', pk]);
      return {
        elements(o) {
          log.push(['elements', clone(o)]);
          return {
            update(o2) { log.push(['update', clone(o2)]); return Promise.resolve(); },
            submit() { log.push(['submit']); return Promise.resolve(ctl.submit || {}); },
            create(t, o3) { log.push(['create', t, clone(o3)]); return { mount(el) { log.push(['mount']); el.innerHTML = '<div class="fake-card">Stripe card box</div>'; }, unmount() { log.push(['unmount']); }, destroy() { log.push(['destroy']); } }; },
          };
        },
        confirmPayment(o) { log.push(['confirm', { clientSecret: o.clientSecret, return_url: o.confirmParams && o.confirmParams.return_url, redirect: o.redirect, hasElements: !!o.elements }]); return Promise.resolve(ctl.confirm || { paymentIntent: { id: 'pi_9', status: 'succeeded' } }); },
      };
    };
  };
}
function fnReplies(ctl) {
  return (b) => {
    if (b.action === 'pay_config') return ctl.cfg || { ok: true, ready: true, test: true, publishableKey: 'pk_test_1', reason: '' };
    if (ctl.cfg && !ctl.cfg.ready && /^pay_/.test(b.action)) return { ok: false, message: 'Card payments are not turned on for this company yet.' };
    if (b.action === 'pay_link') return ctl.link ? ctl.link(b) : { ok: true, url: LINK + (b.amount === 1000 ? '' : 'X'), amount: b.amount, texted: !!b.text, message: b.text ? 'Texted the payment link to Lena Wu.' : 'Payment link ready.' };
    if (b.action === 'pay_intent') return ctl.intent || { ok: true, clientSecret: 'pi_9_secret_abc', returnUrl: 'https://proj.supabase.co/functions/v1/tally-twilio/pay/done', amount: b.amount };
    if (b.action === 'pay_saved') return ctl.saved || { ok: true, message: 'Charged $1,000.00 to Visa ••4242.' };
    if (b.action === 'pay_check') return ctl.check || { ok: true, owed: 1000, fixed: 0 };
    if (b.action === 'pay_forget') return { ok: true, message: "Card removed. It can't be charged again." };
    return { ok: true, sent: 0 };
  };
}
// read the QR code back the way a phone camera would
function readQr(svg) {
  const vb = /viewBox="0 0 (\d+) \1"/.exec(svg);
  if (!vb) return null;
  const n = +vb[1], s = 6, W = n * s, px = new Uint8ClampedArray(W * W * 4).fill(255);
  const re = /M(\d+) (\d+)h1v1h-1z/g;
  let m;
  while ((m = re.exec(svg))) {
    const x0 = +m[1] * s, y0 = +m[2] * s;
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  }
  const out = jsQR(px, W, W);
  return out && out.data;
}
const fnCalls = (A, act) => A.calls.fn.filter((c) => c.body.action === act);

(async () => {
  /* ---------------- the owner collects from Lena (job finished, forms signed) ---------------- */
  const log = [], ctl = {};
  const dbA = seed();
  let A = await load(FILE, { db: dbA, org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies(ctl), setup: fakeStripe(log, ctl) });
  let { $, $$, click, w, T } = A;
  ok(fnCalls(A, 'pay_config').length === 1, 'the app asks once whether card payments are on');
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  click('[data-act="job:open"][data-id="j2"]'); await sleep(40);
  click('#sheet [data-act="flow:open"]'); await sleep(60);
  const flowText = () => $('#flow').textContent.replace(/\s+/g, ' ');
  ok(/Stripe test mode: no real money moves\. Test card 4242 4242 4242 4242/.test(flowText()) && !/Demo mode/.test(flowText()), 'the payment screen says Stripe test mode, not demo');
  const chipNames = $$('#flow [data-act="flow:method"]').map((c) => c.textContent).join('|');
  ok(chipNames === 'Card on file|Pay link|Card|Cash or check', 'four ways to pay: ' + chipNames);
  ok($('#flow [data-act="flow:method"][data-m="vault"]').classList.contains('on') && $$('#flow input[name=vaultPick]').length === 1 && $('#flow input[name=vaultPick]').checked && /Visa ending 4242 · Lena Wu exp 03\/30 · kept on this job/.test(flowText()) && !/1111/.test(flowText()), 'the card Lena kept on this job is picked first, with the name on it; the old demo card (last four only) is not offered');
  ok(!/Bank \(ACH\)|Card number/.test(flowText()), 'no fields for card or bank numbers anywhere in Tally');

  // ---- card on file
  click('#flow [data-act="flow:pay"]'); await sleep(60);
  let sc = fnCalls(A, 'pay_saved').pop();
  ok(sc && sc.body.jobId === 'j2' && sc.body.vaultId === CARD && sc.body.amount === 1000 && /^t[a-z0-9]{8,}$/.test(sc.body.nonce), 'Charge sends the saved card, the amount and a one-time tap id to the server');
  ok(/Charged \$1,000\.00 to Visa ••4242/.test($('#toast').textContent), 'and says it was charged');
  ok(T.state().jobs.find((j) => j.id === 'j2').payments.length === 0, 'nothing is added to the bill on the phone: it arrives from the server');
  ctl.saved = { ok: false, needLink: true, message: "The customer's bank wants them to approve this one. Send them a pay link instead." };
  click('#flow [data-act="flow:pay"]'); await sleep(60);
  ok($('#flow [data-act="flow:method"][data-m="link"]').classList.contains('on') && /approve this one/.test($('#flowErr').textContent), 'the bank wants approval: the screen switches to a pay link and says why');
  ctl.saved = null;

  // ---- pay link with a QR code
  ok(!$('#saveLink').checked && $('#flow [data-act="pay:qr"]') && /Text it to Lena Wu/.test(flowText()), 'paying the whole bill: card not kept by default; QR code or a text from the company line');
  click('#flow [data-act="pay:qr"]'); await sleep(60);
  let lc = fnCalls(A, 'pay_link').pop();
  ok(lc && lc.body.amount === 1000 && lc.body.save === false && lc.body.text === false, 'the link is made for $1,000.00');
  const svg = $('#flow svg.qr');
  ok(svg && $('#payUrl').textContent === LINK, 'a QR code and the short link show');
  ok(readQr(svg.outerHTML) === LINK, 'the QR code reads back as the link (decoded like a phone camera would)');
  ok(/Waiting for Lena Wu to pay/.test(flowText()) && T.pay.poll, 'the screen waits for Lena, checking by itself');
  ok(T.state().jobs.find((j) => j.id === 'j2').log.some((l) => /Payment link made: \$1,000/.test(l.ev)), 'the job history notes the link');
  const before = fnCalls(A, 'pay_link').length;
  click('#flow [data-act="flow:method"][data-m="link"]'); await sleep(20);
  ok(fnCalls(A, 'pay_link').length === before && $('#flow svg.qr'), 'coming back to the pay link shows the same code without asking again');
  click('#flow [data-act="pay:text"]'); await sleep(60);
  lc = fnCalls(A, 'pay_link').pop();
  ok(lc.body.text === true && /Texted the payment link to Lena Wu/.test($('#toast').textContent), 'Text it sends the same link from the company line');
  // a smaller amount (part now, the rest later)
  const amt = $('#flowAmt'); amt.value = '30000'; amt.dispatchEvent(new w.Event('input', { bubbles: true })); amt.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(20);
  ok($('#flowAmt').value === '300.00' && $('#saveLink').checked && $('#flow [data-act="pay:qr"]') && !$('#flow svg.qr'), 'a part payment: keep-the-card is ticked, and a new link is needed for $300');
  click('#flow [data-act="pay:qr"]'); await sleep(60);
  lc = fnCalls(A, 'pay_link').pop();
  ok(lc.body.amount === 300 && lc.body.save === true, 'the $300 link keeps the card on file for the rest');
  click('#flow [data-act="pay:check"]'); await sleep(60);
  ok(fnCalls(A, 'pay_check').some((c) => c.body.jobId === 'j2') && /Nothing paid yet/.test($('#toast').textContent), 'Check now asks the server; nothing paid yet');

  // ---- Stripe's card box
  click('#flow [data-act="flow:method"][data-m="card"]'); await sleep(60);
  const el = log.filter((x) => x[0] === 'elements').pop();
  ok(log.some((x) => x[0] === 'init' && x[1] === 'pk_test_1') && $('#stripeCard .fake-card'), "Stripe's own card box is shown, with the publishable key from the server");
  ok(el && el[1].mode === 'payment' && el[1].currency === 'usd' && el[1].amount === 30000 && JSON.stringify(el[1].allowedPaymentMethodTypes) === '["card"]' && el[1].paymentMethodOptions.card.setup_future_usage === 'none', 'card only, $300, not kept unless ticked');
  $('#saveCard').checked = true;
  click('#flow [data-act="flow:pay"]'); await sleep(80);
  const steps = log.slice(log.findIndex((x) => x === el)).map((x) => x[0]);
  const up = log.filter((x) => x[0] === 'update').pop(), ic = fnCalls(A, 'pay_intent').pop(), cf = log.filter((x) => x[0] === 'confirm').pop();
  ok(up && up[1].paymentMethodOptions.card.setup_future_usage === 'off_session' && up[1].amount === 30000, 'ticking keep-the-card tells Stripe before submitting');
  ok(ic && ic.body.amount === 300 && ic.body.save === true, 'the server makes the payment for $300, keeping the card');
  ok(cf && cf[1].clientSecret === 'pi_9_secret_abc' && cf[1].redirect === 'if_required' && cf[1].hasElements && /pay\/done$/.test(cf[1].return_url), 'Stripe confirms it with the card box, staying on this screen');
  ok(steps.indexOf('submit') < steps.indexOf('confirm'), 'in Stripe’s order: check the card, make the payment, confirm');
  ok(fnCalls(A, 'pay_check').some((c) => c.body.pi === 'pi_9'), 'then the server records it at once');
  ok(/Card charged \$300/.test($('#toast').textContent), 'and the crew sees it went through');
  ctl.submit = { error: { message: 'Your card number is incomplete.' } };
  click('#flow [data-act="flow:method"][data-m="card"]'); await sleep(60);
  const nIntents = fnCalls(A, 'pay_intent').length;
  click('#flow [data-act="flow:pay"]'); await sleep(60);
  ok(/card number is incomplete/.test($('#flowErr').textContent) && fnCalls(A, 'pay_intent').length === nIntents, 'an unfinished card is caught before any payment is made');
  ctl.submit = null; ctl.confirm = { error: { message: 'Your card was declined.' } };
  click('#flow [data-act="flow:pay"]'); await sleep(80);
  ok(/Your card was declined/.test($('#flowErr').textContent) && !/charged/i.test($('#toast').textContent.replace(/Card charged \$300/, '')), 'a decline is shown on the screen');
  ctl.confirm = null;

  // ---- the server records a payment while the screen is open: it shows at once
  const j2row = dbA.docs.find((r) => r.path === 'jobs/j2');
  j2row.data = Object.assign(clone(j2row.data), { status: 'paid',
    payments: { st_pi_9: { id: 'st_pi_9', amt: 1000, method: 'Visa ••4242 (pay link)', date: day(0), ts: Date.now(), stripe: 'pi_9', by: 'Owner' } } });
  A.w.__sb.__fire('docs', { collection: 'jobs' }); await sleep(400);
  ok(/Paid in full/.test(flowText()) && /Visa ••4242 \(pay link\)/.test(flowText()), 'Lena pays the link on her phone: the screen turns to Paid in full by itself');
  ok(!T.pay.poll, 'and stops checking');
  click('#flow [data-act="flow:close"]'); await sleep(20);

  /* ---------------- the office sends a deposit link for an upcoming job ---------------- */
  click('[data-act="job:open"][data-id="j1"]'); await sleep(40);
  ok(/Send a payment link/.test($('#sheet').textContent) && $('#sheet [data-act="pl:make"][data-v="250"]') && $('#sheet [data-act="pl:make"][data-v="1000"]'), 'the job sheet offers a link for the $250 deposit or the $1,000 balance');
  click('#sheet [data-act="pl:make"][data-v="250"]'); await sleep(60);
  lc = fnCalls(A, 'pay_link').pop();
  ok(lc.body.jobId === 'j1' && lc.body.amount === 250 && lc.body.save === true && lc.body.text === false, 'a deposit link keeps the card on file for the balance');
  ok(/keeps the card on file/.test($('#sheet').textContent) && $('#sheet .linkbox code').textContent.indexOf(LINK) === 0, 'the link shows on the sheet');
  click('#sheet [data-act="pl:text"]'); await sleep(60);
  lc = fnCalls(A, 'pay_link').pop();
  ok(lc.body.amount === 250 && lc.body.text === true, 'and can be texted from the company line');
  click('#sheet [data-act="pl:qr"]'); await sleep(20);
  ok($('#sheet svg.qr'), 'or shown as a QR code');

  // ---- Setup
  click('[data-act="sheet:close"]'); await sleep(10);
  click('[data-act="more:open"]'); await sleep(10); click('[data-act="more:go"][data-tab="settings"]'); await sleep(40);
  ok(/Stripe is connected \(test mode\)/.test($('#view').textContent) && $('details[data-k="st:Payments"]'), 'Setup › Payments says Stripe is connected, in test mode');
  ok(/Visa ending 4242 · Lena Wu · Stripe test/.test($('#view').textContent.replace(/\s+/g, ' ')), 'saved cards say which came from Stripe, with the name on the card');
  click('[data-act="st:rmvault"][data-id="' + CARD + '"]'); await sleep(80);
  ok(fnCalls(A, 'pay_forget').some((c) => c.body.vaultId === CARD) && !/Visa ending 4242/.test($('#view').textContent) && /can't be charged again/.test($('#toast').textContent), 'removing a Stripe card takes it off in Stripe too, through the server');
  ok(A.errors.length === 0, 'no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- no company line: the link goes out from the crew's own phone ---------------- */
  const log2 = [], ctl2 = {};
  const B = await load(FILE, { db: seed({ noLine: true, cardElsewhere: true }), org: ORG, me: { uid: 'u-marcus', email: 'm@x.com' }, fnReply: fnReplies(ctl2), setup: fakeStripe(log2, ctl2) });
  B.click('[data-act="more:open"]'); await sleep(10);
  const fieldBtn = B.$('[data-act="more:go"][data-tab="crew"]'); if (fieldBtn) { B.click(fieldBtn); await sleep(30); }
  B.click('.crewcard [data-act="flow:open"][data-id="j2"]'); await sleep(60);
  ok(B.$('#flow [data-act="flow:method"][data-m="link"]').classList.contains('on') && !B.$('#flow [data-act="flow:method"][data-m="vault"]'), 'the lead on the job sees the pay link first; a card kept on another job is not offered to him');
  ok(/Text it from my phone/.test(B.$('#flow').textContent), 'without a company line the text comes from his own phone');
  B.click('#flow [data-act="pay:text"]'); await sleep(60);
  const sms = B.$('#flow a[href^="sms:"]');
  ok(sms && decodeURIComponent(sms.getAttribute('href')).indexOf('sms:5125550177?&body=Ace Moving: Here is your secure payment link for $1,000: ' + LINK) === 0, 'the text opens ready to send to Lena: ' + (sms && decodeURIComponent(sms.getAttribute('href'))));
  ok(fnCalls(B, 'pay_link').pop().body.text === false, 'and the server is not asked to text it');
  ok(B.errors.length === 0, 'no errors for the lead (' + B.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- a company that isn't turned on: cash and checks, never a pretend card form ---------------- */
  const C = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies({ cfg: { ok: true, ready: false, test: true, publishableKey: '', reason: 'org-off' } }) });
  C.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  C.click('[data-act="job:open"][data-id="j2"]'); await sleep(40);
  ok(!/Send a payment link/.test(C.$('#sheet').textContent), 'no payment links on the sheet');
  C.click('#sheet [data-act="flow:open"]'); await sleep(60);
  const cText = C.$('#flow').textContent.replace(/\s+/g, ' ');
  ok(/Card payments are not turned on for this company yet\. Cash and checks can still be recorded/.test(cText) && !/Demo mode/.test(cText), 'the payment screen says why cards are off, and is not the demo');
  ok(!C.$('#cardNum') && !C.$('#achRoute') && !C.$('#flow [data-act="flow:method"]') && !C.$('input[name=vaultPick]'), 'no card or bank form, no saved cards: nothing that looks like charging a card');
  const ca = C.$('#flowAmt'); ca.value = '20000'; ca.dispatchEvent(new C.w.Event('input', { bubbles: true }));
  C.click('#flow [data-act="flow:pay"]'); await sleep(40);
  const cPay = C.T.state().jobs.find((j) => j.id === 'j2').payments.pop();
  ok(cPay && cPay.amt === 200 && cPay.method === 'Cash', 'cash is recorded as cash: ' + JSON.stringify(cPay));
  C.click('#flow [data-act="flow:close"]'); await sleep(10); C.click('[data-act="sheet:close"]'); await sleep(10);
  C.click('[data-act="more:open"]'); await sleep(10); C.click('[data-act="more:go"][data-tab="settings"]'); await sleep(40);
  ok(/not turned on for card payments yet/.test(C.$('#view').textContent), 'Setup › Payments says the company is not turned on');
  // the payment service doesn't answer
  const ctlD = { cfg: { ok: false } };
  const C2 = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies(ctlD) });
  C2.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  C2.click('[data-act="job:open"][data-id="j2"]'); await sleep(40);
  const asked = fnCalls(C2, 'pay_config').length;
  C2.click('#sheet [data-act="flow:open"]'); await sleep(60);
  ok(/payment service did not answer/.test(C2.$('#flow').textContent) && !C2.$('#cardNum') && fnCalls(C2, 'pay_config').length > asked, 'the server not answering: cash and checks only, and opening the screen asks again');
  ctlD.cfg = null;
  C2.click('#flow [data-act="pay:retry"]'); await sleep(80);
  ok(C2.$('#flow [data-act="flow:method"][data-m="link"]') && /Stripe test mode/.test(C2.$('#flow').textContent), 'Check again: once it answers, the card ways to pay come back');

  /* ---------------- a card kept on another job, and cash with Stripe on ---------------- */
  const G = await load(FILE, { db: seed({ cardElsewhere: true }), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies({}), setup: fakeStripe([], {}) });
  G.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  G.click('[data-act="job:open"][data-id="j2"]'); await sleep(40);
  G.click('#sheet [data-act="flow:open"]'); await sleep(60);
  ok(G.$('#flow [data-act="flow:method"][data-m="link"]').classList.contains('on') && G.$('#flow [data-act="flow:method"][data-m="vault"]'), 'the office sees a card kept on another job, but it is not picked for them');
  G.click('#flow [data-act="flow:method"][data-m="vault"]'); await sleep(30);
  ok(!G.$('#flow input[name=vaultPick]').checked && /Pat Wu .*kept on another job/.test(G.$('#flow').textContent.replace(/\s+/g, ' ')) && /Check with Lena Wu that this is their card/.test(G.$('#flow').textContent), 'nothing is ticked, the name on the card shows, and the screen says to check with Lena first');
  G.click('#flow [data-act="flow:pay"]'); await sleep(40);
  ok(/Pick a saved card/.test(G.$('#flowErr').textContent) && !fnCalls(G, 'pay_saved').length, 'charging without picking the card does nothing');
  G.click('#flow [data-act="flow:method"][data-m="other"]'); await sleep(20);
  const ga = G.$('#flowAmt'); ga.value = '10000'; ga.dispatchEvent(new G.w.Event('input', { bubbles: true }));
  G.click('#flow [data-act="flow:pay"]'); await sleep(40);
  ok(/Payment recorded: \$100/.test(G.$('#toast').textContent), 'cash recorded with Stripe on');
  await sleep(1500);
  ok(fnCalls(G, 'pay_check').some((c) => c.body.jobId === 'j2' && !c.body.pi), 'once the cash reaches the server, the server is asked to check, so pay link pages stop asking for what was paid in cash');
  ok(G.errors.length === 0, 'no errors (' + G.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- live mode: test money doesn't count, refunds read as money off ---------------- */
  const live = { cfg: { ok: true, ready: true, test: false, publishableKey: 'pk_live_1', reason: '' } };
  const H = await load(FILE, { db: seed({ noCard: true, j2: { payments: {
    t1: { id: 't1', amt: 400, method: 'Visa ••4242 (pay link) · test', date: day(-1), ts: 1, stripe: 'pi_t', live: false },
    p1: { id: 'p1', amt: 500, method: 'Visa ••4242 (pay link)', date: day(0), ts: 2, stripe: 'pi_l', live: true },
    r1: { id: 'r1', amt: -100, method: 'Refund · Visa ••4242 (pay link)', date: day(0), ts: 3, stripe: 'pi_l', live: true } } } }), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies(live), setup: fakeStripe([], {}) });
  H.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  H.click('[data-act="job:open"][data-id="j2"]'); await sleep(40);
  const hText = H.$('#sheet').textContent.replace(/\s+/g, ' ');
  ok(/Refund · Visa ••4242 \(pay link\).*-\$100/.test(hText), 'a refund shows on the bill as -$100');
  H.click('#sheet [data-act="flow:open"]'); await sleep(60);
  const due = H.$$('#flow .kpi').map((k) => k.textContent.replace(/\s+/g, ' ')).join(' | ');
  ok(/\$400 ?Paid/.test(due) && /\$600 ?Due now/.test(due) && !/Stripe test mode/.test(H.$('#flow').textContent), 'live mode: the $400 test payment is not counted; $500 paid less the $100 refund leaves $600 due: ' + due);

  // before this phone has heard from the payment service, test money counts only if Stripe was in test mode last time
  const testPay = { payments: { t1: { id: 't1', amt: 400, method: 'Visa ••4242 (pay link) · test', date: day(-1), ts: 1, stripe: 'pi_t', live: false },
    n1: { id: 'n1', amt: -300, method: 'Cash', date: day(0), ts: 2 } } };
  const dueOf = (X) => { X.click('[data-act="tab"][data-tab="jobs"]'); return sleep(20).then(() => { X.click('[data-act="job:open"][data-id="j2"]'); return sleep(40); })
    .then(() => { X.click('#sheet [data-act="flow:open"]'); return sleep(60); }).then(() => X.$$('#flow .kpi').map((k) => k.textContent.replace(/\s+/g, ' ')).join(' | ')); };
  const I = await load(FILE, { db: seed({ noCard: true, j2: testPay }), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies({ cfg: { ok: false } }) });
  let dueI = await dueOf(I);
  ok(/\$0 ?Paid/.test(dueI) && /\$1,000 ?Due now/.test(dueI), 'the payment service down and its mode unknown: test money is not counted, and a negative cash entry is ignored: ' + dueI);
  const I2 = await load(FILE, { db: seed({ noCard: true, j2: testPay }), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies({ cfg: { ok: false } }), setup: (w) => w.localStorage.setItem('tally.payTest', '1') });
  dueI = await dueOf(I2);
  ok(/\$400 ?Paid/.test(dueI) && /\$600 ?Due now/.test(dueI), 'and it is counted when Stripe was in test mode last time: ' + dueI);
  const I3 = await load(FILE, { db: seed({ noCard: true, j2: testPay }), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies({}) });
  await dueOf(I3);
  ok(I3.w.localStorage.getItem('tally.payTest') === '1', 'the phone remembers which mode Stripe was in');

  /* ---------------- a customer with the same name, without a phone ---------------- */
  const K = await load(FILE, { db: seed({ noCard: true, namesake: true }), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies({}), setup: fakeStripe([], {}) });
  K.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  K.click('[data-act="job:open"][data-id="j2"]'); await sleep(40);
  K.click('#sheet [data-act="flow:open"]'); await sleep(60);
  ok(!K.$('#flow [data-act="flow:method"][data-m="vault"]') && K.$('#flow [data-act="flow:method"][data-m="link"]').classList.contains('on'), "another customer's card with the same name on it is not offered: without a phone, a card belongs to its own job");
  K.click('#flow [data-act="flow:close"]'); await sleep(10); K.click('[data-act="sheet:close"]'); await sleep(10);
  K.click('[data-act="more:open"]'); await sleep(10); K.click('[data-act="more:go"][data-tab="settings"]'); await sleep(40);
  ok(/Amex ending 0005 · Lena Wu.*Kept on Priya Nair’s job/.test(K.$('#view').textContent.replace(/\s+/g, ' ')), 'Setup says which job such a card was kept on');
  ok(K.errors.length === 0 && I.errors.length === 0, 'no errors (' + K.errors.concat(I.errors).slice(0, 3).join(' | ') + ')');

  /* ---------------- saving changes: merged on the server, with a fallback ---------------- */
  const D = await load(FILE, { db: seed({ noDocPatch: true }), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies({}) });
  D.T.state().jobs.find((j) => j.id === 'j1').d.notes = 'Gate 4411';
  D.T.save(); D.T.syncOut(); await sleep(400);
  const fb = D.calls.writes.filter((x) => x.table === 'docs' && x.row.path === 'jobs/j1').pop();
  ok(fb && !fb.op && fb.row.data.d.notes === 'Gate 4411' && D.calls.rpc.some((x) => x.name === 'doc_patch'), 'a database without doc_patch yet: the change is still saved the old way');
  const E = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies({}) });
  E.T.state().jobs.find((j) => j.id === 'j1').d.notes = 'Gate 4412';
  E.T.save(); E.T.syncOut(); await sleep(400);
  const pw = E.calls.writes.filter((x) => x.table === 'docs' && x.row.path === 'jobs/j1').pop();
  ok(pw && pw.op === 'patch' && pw.patch.d && pw.patch.d.notes === 'Gate 4412' && !pw.patch.payments && pw.row.data.d.notes === 'Gate 4412', 'with doc_patch: only the change is sent, merged on the server');
  const dbE2 = seed({ j2: {} }); dbE2.__docPatchFail = true;
  const E2 = await load(FILE, { db: dbE2, org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies({}) });
  dbE2.docs.find((r) => r.path === 'jobs/j1').data.payments = { st_pi_5: { id: 'st_pi_5', amt: 250, method: 'Visa ••4242 (pay link)', stripe: 'pi_5', ts: 5 } };   // the server recorded a payment
  E2.T.state().jobs.find((j) => j.id === 'j1').d.notes = 'Gate 4413';
  E2.T.save(); E2.T.syncOut(); await sleep(600);
  const whole = E2.calls.writes.filter((x) => x.table === 'docs' && x.row && x.row.path === 'jobs/j1' && !x.op);
  ok(!whole.length && dbE2.docs.find((r) => r.path === 'jobs/j1').data.payments.st_pi_5, "a change that fails to save is tried again, never fixed by writing this phone's copy over the server's (the payment stays)");

  /* ---------------- the artifact edition ---------------- */
  const F = await load(ART, {});
  ok(!F.w.tallyPay, 'the artifact edition has no payment connection');
  F.click('[data-act="more:open"]'); await sleep(10); F.click('[data-act="more:go"][data-tab="settings"]'); await sleep(40);
  ok(/Card payments run on the hosted edition/.test(F.$('#view').textContent), 'Setup › Payments explains where real payments run');
  ok(F.T.qrSvg('https://example.com/p/abc') && readQr(F.T.qrSvg('https://example.com/p/abc')) === 'https://example.com/p/abc', 'the QR maker works in both editions');
  ok(F.errors.length === 0, 'no errors in the artifact (' + F.errors.slice(0, 3).join(' | ') + ')');

  process.exit(summary('payments') ? 1 : 0);
})();
