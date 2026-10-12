// Stripe Connect in the app (hosted edition): a company that isn't on Tally's own Stripe account connects
// its own from Setup › Payments. The owner presses Connect with Stripe, Stripe's sign-up page opens outside
// Tally, and coming back asks the server how the account stands. Once Stripe says yes, the card box works on
// the company's own account. The Edge Function and Stripe.js are fakes that record what they were asked.
const { load, ok, sleep, summary, clone } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html';
const ORG = 'org-1', ACCT = 'acct_1Blue000ABCD';
const SIGNUP = 'https://accounts.stripe.com/r/acct_1Blue000ABCD#alu_test_61SGhyomRuz7xsw5216';   // the shape Stripe's sign-up links have
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function jobDoc(id, over = {}) {
  return Object.assign({ id, status: 'booked', createdAt: Date.now() - 864e5,
    d: { name: 'Priya Nair', phone: '512-555-0142', email: '', source: 'Google', moveDate: day(2), time: '08:00', from: '418 Oak St', to: '77 Ridge Rd', miles: '', flights: '', pack: false, crew: '', truckId: '', hoursOverride: '', discount: '', notes: '', custom: {}, items: [] },
    quote: { total: 1000, cf: 500, crew: 3, hours: 4, lines: [{ label: 'Movers', amt: 1000 }], deposit: 250, nte: 1150, lbs: 3500, truckId: 't26', truckName: 'Box 1', nTrucks: 1, pct: 0.3, count: 10 },
    items: [], assign: { truckId: 't26', crew: ['Marcus', 'Dee'] }, tally: {}, payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {} }, over);
}
function seed() {
  const docs = [];
  const put = (path, data) => { const [collection, doc_id] = path.split('/'); docs.push({ org_id: ORG, path, collection, doc_id, data, updated_at: new Date().toISOString() }); };
  put('meta/init', { ts: 1, mode: 'fresh' });
  put('org/settings', { company: 'Blue Moving', crew: ['Marcus', 'Dee'], leads: ['Marcus'], office: [{ name: 'Ana', kind: 'owner' }], contacts: { Ana: '512-555-0100' },
    forms: [{ id: 'f1', title: 'Delivery receipt', kind: 'text', required: true, text: 'I accept.', pageIds: [] }], trucks: [{ id: 't26', name: 'Box 1', cf: 1700 }] });
  put('jobs/j2', jobDoc('j2', { status: 'done', d: Object.assign(jobDoc('x').d, { name: 'Lena Wu', phone: '512-555-0177' }), finishedAt: Date.now() - 6e5, startedAt: Date.now() - 4e6,
    signed: { s1: { id: 's1', formId: 'f1', title: 'Delivery receipt', name: 'Lena Wu', ts: 1 } } }));
  return {
    docs, access_requests: [], comm_log: [],
    members: [{ org_id: ORG, user_id: 'u-ana', email: 'ana@x.com', staff: 'Ana', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-dot', email: 'dot@x.com', staff: 'Dot', role: 'dispatch', ts: 1 },
      { org_id: ORG, user_id: 'u-marcus', email: 'm@x.com', staff: 'Marcus', role: 'lead', ts: 1 }],
    comm_lines: [{ org_id: ORG, phone_number: '+15125550000', enabled: true }],
  };
}
// what the server says about the company's own Stripe account, step by step
const CFG = {
  none: { ok: true, ready: false, test: true, publishableKey: '', reason: 'connect', connect: { state: 'none', due: [] } },
  started: { ok: true, ready: false, test: true, publishableKey: '', reason: 'connect-pending', connect: { state: 'started', due: ['external_account', 'representative.first_name', 'representative.dob.day', 'business_profile.url', 'tos_acceptance.date'], disabled: 'requirements.past_due', payouts: false } },
  review: { ok: true, ready: false, test: true, publishableKey: '', reason: 'connect-pending', connect: { state: 'review', due: [], disabled: 'requirements.pending_verification', payouts: false } },
  ready: { ok: true, ready: true, test: true, publishableKey: 'pk_test_platform', account: ACCT, via: 'connect', reason: '', connect: { state: 'ready', due: [], disabled: '', payouts: true } },
  off: { ok: true, ready: false, test: true, publishableKey: '', reason: 'connect-off', connect: { state: 'disconnected', due: [], disabled: 'disconnected', payouts: false } },
  rejected: { ok: true, ready: false, test: true, publishableKey: '', reason: 'connect-pending', connect: { state: 'started', due: [], disabled: 'rejected.other', payouts: false } },
  platform: { ok: true, ready: true, test: true, publishableKey: 'pk_test_platform', account: '', via: 'platform', reason: '' },
};
function fnReplies(ctl) {
  return (b) => {
    if (b.action === 'pay_config') return clone(ctl.cfg);
    if (b.action === 'pay_connect') return ctl.connect ? clone(ctl.connect) : { ok: true, url: SIGNUP };
    if (!ctl.cfg.ready && /^pay_/.test(b.action)) return { ok: false, message: 'not on' };
    if (b.action === 'pay_intent') return { ok: true, clientSecret: 'pi_9_secret_abc', returnUrl: 'https://proj.supabase.co/functions/v1/tally-twilio/pay/done', amount: b.amount, account: ACCT };
    if (b.action === 'pay_check') return { ok: true, owed: 1000, fixed: 0 };
    if (b.action === 'pay_link') return { ok: true, url: 'https://proj.supabase.co/functions/v1/tally-twilio/p/AbCdEfGh23', amount: b.amount };
    return { ok: true, sent: 0 };
  };
}
// window.open: a tab that records where it was sent (or null: the browser blocked it)
function browser(rec, opts = {}) {
  return (w) => {
    w.open = (url, target) => {
      rec.opened.push([url, target]);
      if (opts.blocked) return null;
      const tab = { closed: false, opener: w, location: { href: url || 'about:blank' }, document: { title: '', body: { innerHTML: '' } }, close() { this.closed = true; rec.closedTabs++; } };
      rec.tabs.push(tab);
      return tab;
    };
    if (opts.ua) Object.defineProperty(w.navigator, 'userAgent', { value: opts.ua, configurable: true });
    w.Stripe = function (pk, o) {
      rec.stripe.push([pk, o ? clone(o) : null]);
      return {
        elements(eo) { return { update() { return Promise.resolve(); }, submit() { return Promise.resolve({}); }, create() { return { mount(el) { el.innerHTML = '<div class="fake-card">Stripe card box</div>'; }, unmount() {}, destroy() {} }; } }; },
        confirmPayment(co) { rec.confirm.push(co.clientSecret); return Promise.resolve({ paymentIntent: { id: 'pi_9', status: 'succeeded' } }); },
      };
    };
  };
}
const rec0 = () => ({ opened: [], tabs: [], closedTabs: 0, stripe: [], confirm: [] });
const fnCalls = (A, act) => A.calls.fn.filter((c) => c.body.action === act);
const say = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
async function setup(A) { await A.go('settings', 'pay'); await sleep(20); }
const payCard = (A) => A.$$('#view details.acc.card').find((d) => /^Payments/.test(say(d.querySelector('summary')).trim())) || A.$$('#view section.card').find((s) => /Payments/.test(say(s.querySelector('h2'))));
async function back(A) {   // the owner comes back to Tally from Stripe's page
  Object.defineProperty(A.w.document, 'hidden', { value: true, configurable: true });
  A.w.document.dispatchEvent(new A.w.Event('visibilitychange'));
  await sleep(10);
  Object.defineProperty(A.w.document, 'hidden', { value: false, configurable: true });
  A.w.document.dispatchEvent(new A.w.Event('visibilitychange'));
  await sleep(60);
}
async function payScreen(A) {
  A.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  A.click('[data-act="job:open"][data-id="j2"]'); await sleep(40);
  A.click('#sheet [data-act="flow:open"]'); await sleep(60);
  return say(A.$('#flow'));
}

(async () => {
  /* ---------------- the owner of a company that isn't connected yet ---------------- */
  const ctl = { cfg: CFG.none }, rec = rec0();
  const A = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-ana', email: 'ana@x.com' }, fnReply: fnReplies(ctl), setup: browser(rec) });
  let flow = await payScreen(A);
  ok(/Card payments aren’t set up for this company yet\. The owner connects Stripe in Setup › Payments\. Cash and checks can still be recorded/.test(flow) && !A.$('#flow [data-act="flow:method"]') && !A.$('#stripeCard'), 'the payment screen says why cards are off and who turns them on; cash and checks only');
  A.click('#flow [data-act="flow:close"]'); await sleep(10); A.click('[data-act="sheet:close"]'); await sleep(10);
  await setup(A);
  let card = say(payCard(A));
  ok(/Take card payments with your company’s own Stripe account \(test mode\)/.test(card) && /Tally takes no cut/.test(card) && /Tally never sees those details/.test(card), 'Setup › Payments offers to connect the company’s own Stripe account, and says what that means: ' + card.slice(0, 160));
  ok(A.$('#view [data-act="pay:connect"]') && /Connect with Stripe/.test(A.$('#view [data-act="pay:connect"]').textContent), 'with a Connect with Stripe button');
  ok(/Test mode: Stripe’s page offers test details/.test(card), 'in test mode it says the sign-up can be filled in with test details');

  // the owner presses it
  const asked = fnCalls(A, 'pay_config').length;
  A.click('#view [data-act="pay:connect"]');
  ok(rec.opened.length === 1 && rec.opened[0][0] === '' && rec.opened[0][1] === '_blank' && rec.tabs[0].opener === null, 'a new tab opens on the tap itself (so the browser does not block it), cut off from Tally');
  ok(/Opening Stripe/.test(A.$('#view [data-act="pay:connect"]').textContent) && A.$('#view [data-act="pay:connect"]').disabled, 'the button says it is opening Stripe and can’t be pressed twice');
  await sleep(60);
  ok(fnCalls(A, 'pay_connect').length === 1, 'the server is asked for the company’s Stripe sign-up');
  ok(rec.tabs[0].location.href === SIGNUP && !rec.tabs[0].closed && rec.opened.length === 1, 'Stripe’s sign-up page loads in that tab');
  card = say(payCard(A));
  ok(/Finished with Stripe\? Come back here; this updates by itself/.test(card), 'Setup says to come back when done');
  // back from Stripe, details still due
  ctl.cfg = CFG.started;
  await back(A);
  const ref = fnCalls(A, 'pay_config').slice(asked).pop();
  ok(ref && ref.body.refresh === true, 'coming back to Tally asks the server to check with Stripe');
  card = say(payCard(A));
  ok(/Stripe needs a few more details before cards can be taken/.test(card) && /The bank account Stripe pays out to/.test(card) && /Your own details \(name, date of birth, home address, SSN\)/.test(card) && /What the business does/.test(card) && /Accepting Stripe’s terms/.test(card), 'what Stripe still needs, in plain words: ' + card.slice(0, 260));
  ok(A.$$('#view .duelist li').length === 4, 'one line per thing, not per Stripe field (' + A.$$('#view .duelist li').length + ')');
  ok(/Continue with Stripe/.test(A.$('#view [data-act="pay:connect"]').textContent), 'and a button to carry on with Stripe');
  flow = await payScreen(A);
  ok(/Stripe is still checking this company’s details, so cards can’t be taken yet/.test(flow) && !A.$('#stripeCard'), 'a payment meanwhile: cash and checks only, with the reason');
  A.click('#flow [data-act="flow:close"]'); await sleep(10); A.click('[data-act="sheet:close"]'); await sleep(10);
  await setup(A);

  // details sent, Stripe checking
  ctl.cfg = CFG.review;
  const n0 = fnCalls(A, 'pay_config').length;
  await sleep(4100);   // a little later (the app doesn't ask more than every few seconds)
  await back(A);
  ok(fnCalls(A, 'pay_config').length === n0 + 1, 'asked once on coming back');
  card = say(payCard(A));
  ok(/Stripe is checking your details/.test(card) && /turn on by themselves when Stripe is done/.test(card) && !A.$('#view .duelist') && !A.$('#view [data-act="pay:connect"]') && A.$('#view [data-act="pay:reload"]'), 'details sent: Stripe is checking, nothing to do but check again');
  // a second visit right after doesn't ask again
  await back(A);
  ok(fnCalls(A, 'pay_config').length === n0 + 1, 'coming back again within a few seconds doesn’t ask again');
  // Check again
  ctl.cfg = CFG.ready;
  A.click('#view [data-act="pay:reload"]'); await sleep(60);
  ok(fnCalls(A, 'pay_config').pop().body.refresh === true, 'Check again asks Stripe too');
  card = say(payCard(A));
  ok(/Card payments go to your own Stripe account \(test mode\)/.test(card) && /dashboard\.stripe\.com/.test(card) && /Test mode: no real money moves/.test(card) && !A.$('#view [data-act="pay:connect"]'), 'connected: payments go to the company’s own account; refunds and payouts are in its Stripe Dashboard');

  // a typed card works on the company's own account
  flow = await payScreen(A);
  ok(A.$('#flow [data-act="flow:method"][data-m="card"]') && /Stripe test mode/.test(flow), 'the card ways to pay are on');
  A.click('#flow [data-act="flow:method"][data-m="card"]'); await sleep(80);
  const init = rec.stripe[rec.stripe.length - 1];
  ok(init && init[0] === 'pk_test_platform' && init[1] && init[1].stripeAccount === ACCT, 'Stripe’s card box is made for the company’s own account: ' + JSON.stringify(init));
  A.click('#flow [data-act="flow:pay"]'); await sleep(120);
  ok(rec.confirm.pop() === 'pi_9_secret_abc', 'and the card is charged there');
  A.click('#flow [data-act="flow:close"]'); await sleep(10); A.click('[data-act="sheet:close"]'); await sleep(10);
  ok(A.errors.length === 0, 'no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- the browser blocks the new tab ---------------- */
  const recB = rec0(), ctlB = { cfg: CFG.none };
  const B = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-ana', email: 'ana@x.com' }, fnReply: fnReplies(ctlB), setup: browser(recB, { blocked: true }) });
  await setup(B);
  B.click('#view [data-act="pay:connect"]'); await sleep(60);
  const fb = B.$('#view a[href="' + SIGNUP + '"]');
  ok(recB.opened.length === 2 && fb && fb.getAttribute('target') === '_blank' && /noopener/.test(fb.getAttribute('rel')) && /kept Stripe’s page from opening/.test(say(payCard(B))), 'blocked: the sign-up page is offered as a link instead');
  // the server says no
  ctlB.connect = { ok: false, message: 'Stripe said: You must complete your platform profile to use Connect.' };
  B.click('#view [data-act="pay:connect"]'); await sleep(60);
  ok(/Stripe said: You must complete your platform profile/.test(say(payCard(B))) && !B.$('#view a[href="' + SIGNUP + '"]'), 'Stripe saying no shows its reason, and the old link goes');
  // a link that isn't Stripe's is never opened
  ctlB.connect = { ok: true, url: 'https://stripe.com.evil.example/setup' };
  B.click('#view [data-act="pay:connect"]'); await sleep(60);
  ok(/Stripe did not give a page to open/.test(say(payCard(B))) && !B.$('#view a[href*="evil"]'), 'a sign-up address that isn’t Stripe’s is never opened');
  // already done on Stripe's side
  ctlB.connect = { ok: true, done: true, message: 'Your Stripe account is connected. Manage it at dashboard.stripe.com.' }; ctlB.cfg = CFG.ready;
  B.click('#view [data-act="pay:connect"]'); await sleep(80);
  ok(/Your Stripe account is connected/.test(B.$('#toast').textContent) && /Card payments go to your own Stripe account/.test(say(payCard(B))), 'nothing left to do on Stripe: Tally says so and shows it connected');
  ok(B.errors.length === 0, 'no errors (' + B.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- a pre-opened tab is closed when there is nothing to open ---------------- */
  const recC = rec0(), ctlC = { cfg: CFG.none, connect: { ok: false, message: 'Only the owner connects the company’s Stripe account.' } };
  const C = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-ana', email: 'ana@x.com' }, fnReply: fnReplies(ctlC), setup: browser(recC) });
  await setup(C);
  C.click('#view [data-act="pay:connect"]'); await sleep(60);
  ok(recC.tabs.length === 1 && recC.tabs[0].closed, 'the blank tab opened on the tap is closed again when the server says no');

  /* ---------------- in the Android app ---------------- */
  const recD = rec0(), ctlD = { cfg: CFG.none };
  const D = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-ana', email: 'ana@x.com' }, fnReply: fnReplies(ctlD), setup: browser(recD, { ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile TallyAndroid/1.4' }) });
  await setup(D);
  D.click('#view [data-act="pay:connect"]'); await sleep(60);
  ok(fnCalls(D, 'pay_connect').length === 1 && recD.opened.length === 0 && /Finished with Stripe\?/.test(say(payCard(D))), 'the app hands Stripe’s page to the phone’s browser (no tab inside the app)');
  ok(D.errors.length === 0, 'no errors in the app (' + D.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- disconnected, turned down ---------------- */
  const E = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-ana', email: 'ana@x.com' }, fnReply: fnReplies({ cfg: CFG.off }), setup: browser(rec0()) });
  await setup(E);
  ok(/Your Stripe account was disconnected from Tally, so cards can’t be taken/.test(say(payCard(E))) && /Connect again/.test(E.$('#view [data-act="pay:connect"]').textContent), 'disconnected in Stripe: Setup says so, with Connect again');
  flow = await payScreen(E);
  ok(/disconnected from Tally, so cards can’t be taken\. The owner connects it again in Setup › Payments/.test(flow), 'and the payment screen says why');
  const F = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-ana', email: 'ana@x.com' }, fnReply: fnReplies({ cfg: CFG.rejected }), setup: browser(rec0()) });
  await setup(F);
  ok(/Stripe turned this account down/.test(say(payCard(F))) && !F.$('#view [data-act="pay:connect"]'), 'turned down by Stripe: says so, and to ask Stripe');

  /* ---------------- dispatch and the crew lead ---------------- */
  const G = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-dot', email: 'dot@x.com' }, fnReply: fnReplies({ cfg: CFG.none }), setup: browser(rec0()) });
  G.click('[data-act="more:open"]'); await sleep(10);
  ok(!G.$('[data-act="more:go"][data-tab="settings"]') && !G.$('[data-act="pay:connect"]'), 'dispatch has no Setup, so no Connect button (the owner connects)');
  const H = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-marcus', email: 'm@x.com' }, fnReply: fnReplies({ cfg: CFG.none }), setup: browser(rec0()) });
  H.click('[data-act="more:open"]'); await sleep(10);
  await H.go('crew'); await sleep(15);
  H.click('.crewcard [data-act="flow:open"][data-id="j2"]'); await sleep(60);
  ok(/The owner connects Stripe in Setup › Payments/.test(say(H.$('#flow'))), 'the lead on the job is told the owner turns cards on');
  ok(G.errors.length === 0 && H.errors.length === 0 && E.errors.length === 0 && F.errors.length === 0, 'no errors (' + G.errors.concat(H.errors, E.errors, F.errors).slice(0, 3).join(' | ') + ')');

  /* ---------------- Tally's own company: on the platform's account, as before ---------------- */
  const recP = rec0();
  const P = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-ana', email: 'ana@x.com' }, fnReply: fnReplies({ cfg: CFG.platform }), setup: browser(recP) });
  await setup(P);
  ok(/Stripe is connected \(test mode\)/.test(say(payCard(P))) && !P.$('#view [data-act="pay:connect"]'), 'Setup › Payments is as before');
  await payScreen(P);
  P.click('#flow [data-act="flow:method"][data-m="card"]'); await sleep(80);
  ok(recP.stripe.length === 1 && recP.stripe[0][0] === 'pk_test_platform' && recP.stripe[0][1] === null, 'the card box works on Tally’s own account (no connected account)');
  ok(P.errors.length === 0, 'no errors (' + P.errors.slice(0, 3).join(' | ') + ')');

  process.exit(summary('connect') ? 1 : 0);
})();
