// The membership in the app (hosted edition): Setup › Membership for the owner (trial, start it on
// Stripe's checkout page, manage it on Stripe's billing page), the reminder on Today, the TEST label for
// a test company, and MoveCrew admin for MoveCrew's own admins (every company, waive, discount, test, the
// price and trial, adding a company). The Edge Function and the browser's tabs are fakes.
const { load, ok, sleep, summary, clone } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html';
const ART = __dirname + '/../../build/tally-artifact.html';
const ORG = 'org-1';
const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3';
const PORTAL = 'https://billing.stripe.com/p/session/test_YWNjdF8x';
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString();

function seed() {
  const docs = [];
  const put = (path, data) => { const [collection, doc_id] = path.split('/'); docs.push({ org_id: ORG, path, collection, doc_id, data, updated_at: new Date().toISOString() }); };
  put('meta/init', { ts: 1, mode: 'fresh' });
  put('org/settings', { company: 'Blue Moving', crew: ['Marcus'], leads: ['Marcus'], office: [{ name: 'Ana', kind: 'owner' }], contacts: {}, forms: [], trucks: [] });
  return {
    docs, access_requests: [], comm_log: [], comm_lines: [],
    members: [{ org_id: ORG, user_id: 'u-ana', email: 'ana@x.com', staff: 'Ana', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-dot', email: 'dot@x.com', staff: 'Dot', role: 'dispatch', ts: 1 }],
  };
}
const ST = {
  trial: (days = 13) => ({ ok: true, admin: false, test: false, state: 'trial', trial_ends: inDays(days), list_cents: 14900, price_cents: 14900, discount_pct: 0, billing: false, payments: true }),
  trialing: () => ({ ok: true, admin: false, test: false, state: 'trialing', trial_ends: inDays(13), billing_trial_end: inDays(13), period_end: inDays(13), list_cents: 14900, price_cents: 14900, discount_pct: 0, billing: true, payments: true }),
  active: (over = {}) => Object.assign({ ok: true, admin: false, test: false, state: 'active', trial_ends: inDays(-20), period_end: inDays(10), cancel_at_period_end: false, list_cents: 14900, price_cents: 11175, discount_pct: 25, billing: true, payments: true }, over),
  ended: () => ({ ok: true, admin: false, test: false, state: 'ended', trial_ends: inDays(-1), list_cents: 14900, price_cents: 14900, discount_pct: 0, billing: false, payments: true }),
  past_due: () => ({ ok: true, admin: false, test: false, state: 'past_due', trial_ends: inDays(-30), period_end: inDays(2), list_cents: 14900, price_cents: 14900, discount_pct: 0, billing: true, payments: true }),
  waived: () => ({ ok: true, admin: false, test: false, state: 'waived', trial_ends: inDays(5), list_cents: 14900, price_cents: 14900, discount_pct: 0, billing: false, payments: true }),
  test: (admin = false) => ({ ok: true, admin, test: true, state: 'test', trial_ends: inDays(20), list_cents: 14900, price_cents: 14900, discount_pct: 0, billing: false, payments: true }),
  nokeys: () => ({ ok: true, admin: false, test: false, state: 'trial', trial_ends: inDays(9), list_cents: 14900, price_cents: 14900, discount_pct: 0, billing: false, payments: false }),
};
const COMPANIES = () => [
  { id: 'org-blue', name: 'Blue Moving', created: inDays(-3), trial_ends: inDays(11), owners: ['ana@bluemoving.example'], invited: [], members: 4, test: false, waived: false, discount_pct: 0, note: '',
    member: { state: 'active', price_cents: 14900, list_cents: 14900, discount_pct: 0, period_end: inDays(20) }, cards: 'connected' },
  { id: 'org-green', name: 'Green Movers', created: inDays(-1), trial_ends: inDays(13), owners: [], invited: ['gus@green.example'], members: 0, test: false, waived: false, discount_pct: 0, note: '',
    member: { state: 'trial', trial_ends: inDays(13), price_cents: 14900, list_cents: 14900, discount_pct: 0 }, cards: 'none' },
  { id: ORG, name: 'Live company trst', created: inDays(-5), trial_ends: inDays(20), owners: ['richie@tally.example'], invited: [], members: 1, test: true, waived: true, discount_pct: 0, note: 'My test company',
    member: { state: 'test', price_cents: 14900, list_cents: 14900, discount_pct: 0 }, cards: 'connecting' },
];
function fnReplies(ctl) {
  return (b) => {
    if (b.action === 'member_status') return clone(typeof ctl.status === 'function' ? ctl.status(b) : ctl.status);
    if (b.action === 'member_start') return ctl.start ? clone(ctl.start) : { ok: true, url: CHECKOUT };
    if (b.action === 'member_portal') return ctl.portal ? clone(ctl.portal) : { ok: true, url: PORTAL };
    if (b.action === 'admin_list') return { ok: true, plan: ctl.plan || { monthly_cents: 14900, trial_days: 14 }, payments: 'test', companies: ctl.companies || COMPANIES(), team: ctl.team === undefined ? null : clone(ctl.team) };
    if (b.action === 'admin_cc_add') { ctl.team = (ctl.team || []).filter((t) => t.email !== b.email.toLowerCase()).concat([{ email: b.email.toLowerCase(), name: b.name, phone: b.phone, signedIn: false }]); return { ok: true, message: b.name + ' is on the call center team. They sign in to MoveCrew with ' + b.email.toLowerCase() + '.', team: clone(ctl.team) }; }
    if (b.action === 'admin_cc_remove') { ctl.team = (ctl.team || []).filter((t) => t.email !== b.email); return { ok: true, message: 'Taken off the call center team. They see no company’s work from now on.', team: clone(ctl.team) }; }
    if (b.action === 'admin_set') {
      const c = (ctl.companies || COMPANIES()).find((x) => x.id === b.target);
      const nc = Object.assign(clone(c), { test: b.test, waived: b.waived, discount_pct: b.discount, note: b.note });
      if (b.cc !== undefined) nc.cc = b.cc;
      nc.member = Object.assign(nc.member, { state: b.test ? 'test' : b.waived ? 'waived' : nc.member.state, discount_pct: b.discount, price_cents: Math.round(14900 * (100 - b.discount) / 100) });
      return { ok: true, message: 'Saved.', company: nc };
    }
    if (b.action === 'admin_plan') return { ok: true, message: 'Saved. New memberships use it; running ones keep their price.', plan: { monthly_cents: Math.round(b.monthly * 100), trial_days: b.trialDays } };
    if (b.action === 'admin_add') return { ok: true, org: 'org-new', mine: false, message: b.name + ' is ready. When ' + b.email.toLowerCase() + ' signs in to MoveCrew with that email, they go straight in as its owner.' };
    if (b.action === 'pay_config') return { ok: true, ready: false, test: true, publishableKey: '', reason: 'connect', connect: { state: 'none', due: [] } };
    return { ok: true, sent: 0 };
  };
}
function browser(rec, opts = {}) {
  return (w) => {
    w.open = (url, target) => {
      rec.opened.push([url, target]);
      if (opts.blocked) return null;
      const tab = { closed: false, opener: w, location: { href: url || 'about:blank' }, document: { title: '', body: { innerHTML: '' } }, close() { this.closed = true; } };
      rec.tabs.push(tab); return tab;
    };
  };
}
const rec0 = () => ({ opened: [], tabs: [] });
const fnCalls = (A, act) => A.calls.fn.filter((c) => c.body.action === act);
const say = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
async function setup(A) { await A.go('settings', 'member'); await sleep(20); }
const card = (A) => A.$$('#view details.acc.card').find((d) => /^\s*Membership/.test(say(d.querySelector('summary')))) || A.$$('#view section.card').find((s) => /Membership/.test(say(s.querySelector('h2'))));
async function back(A) {
  Object.defineProperty(A.w.document, 'hidden', { value: true, configurable: true }); A.w.document.dispatchEvent(new A.w.Event('visibilitychange')); await sleep(10);
  Object.defineProperty(A.w.document, 'hidden', { value: false, configurable: true }); A.w.document.dispatchEvent(new A.w.Event('visibilitychange')); await sleep(60);
}
const asOwner = { uid: 'u-ana', email: 'ana@x.com' }, asDispatch = { uid: 'u-dot', email: 'dot@x.com' };

(async () => {
  /* ---------------- the owner, on the free trial ---------------- */
  const ctl = { status: ST.trial(13) }, rec = rec0();
  const A = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies(ctl), setup: browser(rec) });
  ok(fnCalls(A, 'member_status').length === 1, 'the app asks once where the membership stands');
  ok(!/TEST/.test(say(A.$('#brandCo'))) && !A.$('#brandCo .testtag') && say(A.$('#brandCo')).length > 3, 'a real company: no TEST label');
  ok(!A.$('#view .member-nudge'), 'Today: no reminder with 13 days of trial left');
  await setup(A);
  let c = say(card(A));
  ok(/Free trial until .* \(13 days left\)/.test(c) && /After that, \$149\/month/.test(c) && /card isn’t charged until the trial ends/.test(c), 'Setup › Membership: the trial, the price after it, nothing charged yet: ' + c.slice(0, 200));
  ok(A.$('#view [data-act="mem:start"]') && /Start membership/.test(A.$('#view [data-act="mem:start"]').textContent), 'with Start membership');
  A.click('#view [data-act="mem:start"]');
  ok(rec.opened.length === 1 && rec.opened[0][0] === '' && rec.tabs[0].opener === null, 'a tab opens on the tap, cut off from MoveCrew');
  await sleep(60);
  ok(fnCalls(A, 'member_start').length === 1 && rec.tabs[0].location.href === CHECKOUT, 'Stripe’s checkout page loads in it');
  ok(/Done on Stripe’s page\? Come back here/.test(say(card(A))), 'Setup says to come back when done');
  ctl.status = ST.trialing();
  await back(A);
  ok(fnCalls(A, 'member_status').pop().body.refresh === true, 'coming back asks the server to check with Stripe');
  c = say(card(A));
  ok(/Membership set up/.test(c) && /Free until .* then \$149\/month, charged to the card on file/.test(c) && A.$('#view [data-act="mem:portal"]'), 'the membership is set up: free until the trial ends, then $149, with Manage billing');
  A.click('#view [data-act="mem:portal"]'); await sleep(60);
  ok(fnCalls(A, 'member_portal').length === 1 && rec.tabs[1].location.href === PORTAL, 'Manage billing opens Stripe’s billing page');
  // a page that isn't Stripe's is never opened
  ctl.portal = { ok: true, url: 'https://billing.stripe.com.evil.example/x' };
  A.click('#view [data-act="mem:portal"]'); await sleep(60);
  ok(rec.tabs[2].closed && /Stripe did not give a page to open/.test(say(card(A))), 'an address that isn’t Stripe’s is never opened');
  ctl.portal = null;
  ok(!A.$$('[data-act="more:go"]').some((b) => b.dataset.tab === 'admin') && !A.$$('#tabs [data-tab="admin"]').length, 'a company owner has no MoveCrew admin');
  ok(A.errors.length === 0, 'no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- the reminder on Today ---------------- */
  const B = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies({ status: ST.trial(2) }), setup: browser(rec0()) });
  await sleep(30);
  ok(/Your free trial ends in 2 days\. Start the membership to keep going: \$149\/month/.test(say(B.$('#view .member-nudge'))), 'two days left: Today reminds the owner');
  B.click('#view [data-act="mem:go"]'); await sleep(40);
  ok(B.T.ui.setSec === 'member' && /Membership/.test(say(B.$('#view section.card h2'))) && !!B.$('#view [data-act="set:back"]'), 'Open Membership goes to Setup › Membership');
  const C = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies({ status: ST.ended() }), setup: browser(rec0()) });
  await sleep(30);
  ok(/Your free trial has ended\. Start the membership to keep using MoveCrew/.test(say(C.$('#view .member-nudge'))) && C.$('#view .pulse'), 'trial over: reminded, and Today still works (nobody is locked out)');
  await setup(C);
  ok(/Your free trial ended on/.test(say(card(C))) && C.$('#view [data-act="mem:start"]'), 'Setup offers to start the membership');
  const D = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies({ status: ST.past_due() }), setup: browser(rec0()) });
  await sleep(30);
  ok(/payment didn’t go through/.test(say(D.$('#view .member-nudge'))), 'a failed payment: reminded to update the card');
  await setup(D);
  ok(/didn’t go through/.test(say(card(D))) && D.$('#view [data-act="mem:portal"]'), 'Setup sends them to the billing page');

  /* ---------------- paying, waived, test, no keys ---------------- */
  const E = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies({ status: ST.active() }), setup: browser(rec0()) });
  await setup(E);
  ok(/Membership active: \$111\.75\/month \(25% off \$149, from MoveCrew\)/.test(say(card(E))) && /Renews/.test(say(card(E))), 'paying with a discount: the price and when it renews');
  const E2 = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies({ status: ST.active({ cancel_at_period_end: true }) }), setup: browser(rec0()) });
  await setup(E2);
  ok(/It ends on/.test(say(card(E2))), 'cancelled at the end of the month: says when it ends');
  const F = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies({ status: ST.waived() }), setup: browser(rec0()) });
  await setup(F);
  ok(/MoveCrew waived your membership/.test(say(card(F))) && !F.$('#view [data-act="mem:start"]') && !F.$('#view [data-act="mem:portal"]'), 'fee waived: nothing to pay, no buttons');
  const G = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies({ status: ST.test() }), setup: browser(rec0()) });
  await sleep(20);
  ok(/ TEST$/.test(say(G.$('#brandCo'))) && G.$('#brandCo .testtag'), 'a test company is labelled TEST at the top');
  ok(!G.$('#view .member-nudge'), 'and never reminded');
  await setup(G);
  ok(/This is a test company/.test(say(card(G))) && !G.$('#view [data-act="mem:start"]'), 'Setup says it’s a test company, never charged');
  const H = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies({ status: ST.nokeys() }), setup: browser(rec0()) });
  await setup(H);
  ok(/Membership payments aren’t switched on yet/.test(say(card(H))) && !H.$('#view [data-act="mem:start"]'), 'no Stripe keys yet: nothing to start');
  ok(!H.$('#view .member-nudge'), 'and no reminder');
  // dispatch in a test company
  const I = await load(FILE, { db: seed(), org: ORG, me: asDispatch, fnReply: fnReplies({ status: { ok: true, admin: false, test: true } }), setup: browser(rec0()) });
  await sleep(20);
  ok(I.$('#brandCo .testtag') && !I.$('#view .member-nudge'), 'dispatch sees the TEST label, and no membership');
  ok([A, B, C, D, E, F, G, H, I].every((X) => X.errors.length === 0), 'no errors');

  /* ---------------- MoveCrew admin ---------------- */
  const actl = { status: ST.test(true) }, J = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies(actl), setup: browser(rec0()) });
  J.click('[data-act="more:open"]'); await sleep(10);
  const adminBtn = J.$('[data-act="more:go"][data-tab="admin"]');
  ok(adminBtn && /MoveCrew admin/.test(adminBtn.textContent), 'Richie, a MoveCrew admin: More has MoveCrew admin');
  J.click(adminBtn); await sleep(60);
  ok(fnCalls(J, 'admin_list').length === 1, 'it asks the server for every company');
  let v = say(J.$('#view'));
  ok(/3 ?companies/.test(v) && /1 ?paying · \$149\/mo/.test(v) && /1 ?on a free trial/.test(v), 'how many companies, how many pay and what that adds up to a month');
  ok(/Blue Moving.*ana@bluemoving\.example.*Paying \$149\/month.*4 people.*Cards: its own Stripe account/.test(v), 'each company: owner, membership, people, cards');
  ok(/Green Movers.*Waiting for gus@green\.example to sign in.*Free trial until/.test(v), 'a company added for someone shows who it’s waiting for');
  ok(/Live company trst TEST/.test(v) && /Note: My test company/.test(v), 'his test company is labelled TEST, with his note');
  J.click('#view [data-act="adm:open"][data-id="org-green"]'); await sleep(20);
  ok(J.$('#admW_org-green') && J.$('#admD_org-green') && J.$('#admT_org-green') && J.$('#admN_org-green'), 'Change opens the switches: test company, waive the fee, discount, note');
  J.$('#admD_org-green').value = '120';
  J.click('#view [data-act="adm:save"][data-id="org-green"]'); await sleep(30);
  ok(!fnCalls(J, 'admin_set').length && /whole percent from 0 to 100/.test(J.$('#toast').textContent), 'a discount over 100% isn’t sent');
  J.$('#admD_org-green').value = '20'; J.$('#admN_org-green').value = 'Met at the expo';
  J.click('#view [data-act="adm:save"][data-id="org-green"]'); await sleep(60);
  let sc = fnCalls(J, 'admin_set').pop();
  ok(sc && sc.body.target === 'org-green' && sc.body.discount === 20 && sc.body.waived === false && sc.body.test === false && sc.body.note === 'Met at the expo', 'Save sends the company’s discount and note');
  v = say(J.$('#view'));
  ok(/Note: Met at the expo/.test(v) && !J.$('#admD_org-green'), 'the list shows the change and the switches close');
  J.click('#view [data-act="adm:open"][data-id="org-blue"]'); await sleep(20);
  J.$('#admW_org-blue').checked = true;
  J.click('#view [data-act="adm:save"][data-id="org-blue"]'); await sleep(60);
  sc = fnCalls(J, 'admin_set').pop();
  ok(sc.body.target === 'org-blue' && sc.body.waived === true && /Blue Moving.*Fee waived/.test(say(J.$('#view'))), 'waiving Blue Moving’s fee');
  // the plan
  J.$('#admPrice').value = '199'; J.$('#admTrial').value = '30';
  J.click('#view [data-act="adm:plan"]'); await sleep(60);
  const pc = fnCalls(J, 'admin_plan').pop();
  ok(pc && pc.body.monthly === 199 && pc.body.trialDays === 30 && /running ones keep their price/.test(say(J.$('#view'))), 'the price and the trial for new memberships: $199, 30 days');
  J.$('#admTrial').value = '400';
  J.click('#view [data-act="adm:plan"]'); await sleep(30);
  ok(fnCalls(J, 'admin_plan').length === 1 && /0 to 365 days/.test(J.$('#toast').textContent), 'a trial over a year isn’t sent');
  // adding a company
  J.$('#admName').value = 'Red Van Movers'; J.$('#admEmail').value = 'Rita@RedVan.example'; J.$('#admTest').checked = false;
  J.click('#view [data-act="adm:add"]'); await sleep(80);
  const ac = fnCalls(J, 'admin_add').pop();
  ok(ac && ac.body.name === 'Red Van Movers' && ac.body.email === 'Rita@RedVan.example' && ac.body.test === false, 'Add company sends the name and the owner’s email');
  ok(/rita@redvan\.example signs in to MoveCrew with that email/.test(say(J.$('#view'))) && fnCalls(J, 'admin_list').length >= 2, 'and says what happens next; the list is fetched again');
  J.$('#admName').value = 'No Email Co'; J.$('#admEmail').value = 'nope';
  J.click('#view [data-act="adm:add"]'); await sleep(30);
  ok(fnCalls(J, 'admin_add').length === 1 && /owner’s email/.test(J.$('#toast').textContent), 'a company without a proper email isn’t sent');
  ok(J.errors.length === 0, 'no errors in MoveCrew admin (' + J.errors.slice(0, 3).join(' | ') + ')');
  ok(/Call center team.*The database isn’t set up for it yet\. Run supabase-callcenter\.sql/.test(say(J.$('#view'))) && !J.$('[id^="admC_"]'), 'before supabase-callcenter.sql: the call center team says to run it first, and Change has no call center switch');

  /* ---------------- MoveCrew admin: the call center team and the switch ---------------- */
  const cos = COMPANIES(); cos[0].cc = true;
  const cctl = { status: ST.test(true), team: [{ email: 'jess@calls.example', name: 'Jess', phone: '512-555-0107', signedIn: true }], companies: cos };
  const M = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies(cctl), setup: browser(rec0()) });
  M.click('[data-act="more:open"]'); await sleep(10); M.click('[data-act="more:go"][data-tab="admin"]'); await sleep(60);
  v = say(M.$('#view'));
  ok(/Blue Moving.*Call center: on/.test(v) && !/Green Movers[^]*Call center: on[^]*Live company/.test(v), 'a company with the service says so');
  ok(/Call center team.*They quote and book for the 1 company with the call center switched on/.test(v) && /Jess.*jess@calls\.example · 512-555-0107.*Signed in/.test(v), 'the team: Jess, her email and phone, signed in, working for the one company switched on');
  M.click('#view [data-act="adm:open"][data-id="org-green"]'); await sleep(20);
  ok(M.$('#admC_org-green') && !M.$('#admC_org-green').checked, 'Change has the call center switch (off for Green Movers)');
  M.$('#admD_org-green').value = '0';
  M.click('#view [data-act="adm:save"][data-id="org-green"]'); await sleep(60);
  let cs = fnCalls(M, 'admin_set').pop();
  ok(cs && !('cc' in cs.body), 'saving without touching the switch doesn’t send it');
  M.click('#view [data-act="adm:open"][data-id="org-green"]'); await sleep(20);
  M.$('#admC_org-green').checked = true;
  M.click('#view [data-act="adm:save"][data-id="org-green"]'); await sleep(60);
  cs = fnCalls(M, 'admin_set').pop();
  ok(cs && cs.body.cc === true && cs.body.target === 'org-green' && /Green Movers.*Call center: on/.test(say(M.$('#view'))), 'switched on for Green Movers: it says so');
  M.$('#admCcName').value = 'Bo Diaz'; M.$('#admCcEmail').value = 'Bo@Calls.example'; M.$('#admCcPhone').value = '512-555-0111';
  M.click('#view [data-act="adm:ccadd"]'); await sleep(60);
  const ca = fnCalls(M, 'admin_cc_add').pop();
  ok(ca && ca.body.name === 'Bo Diaz' && ca.body.email === 'Bo@Calls.example' && ca.body.phone === '512-555-0111', 'Add to the team sends the name, email and phone');
  v = say(M.$('#view'));
  ok(/Bo Diaz is on the call center team\. They sign in to MoveCrew with bo@calls\.example\./.test(v) && /Bo Diaz.*bo@calls\.example · 512-555-0111.*Hasn’t signed in yet/.test(v), 'and Bo is on the list, not signed in yet');
  M.$('#admCcName').value = 'No Email'; M.$('#admCcEmail').value = 'nope';
  M.click('#view [data-act="adm:ccadd"]'); await sleep(30);
  ok(fnCalls(M, 'admin_cc_add').length === 1 && /email they sign in with/.test(M.$('#toast').textContent), 'someone without a proper email isn’t sent');
  M.click('#view [data-act="adm:ccrm"][data-email="jess@calls.example"]'); await sleep(20);
  ok(!fnCalls(M, 'admin_cc_remove').length && /Tap again to remove/.test(M.$('#view [data-act="adm:ccrm"][data-email="jess@calls.example"]').textContent), 'Remove asks for a second tap');
  M.click('#view [data-act="adm:ccrm"][data-email="jess@calls.example"]'); await sleep(60);
  ok(fnCalls(M, 'admin_cc_remove').length === 1 && !/jess@calls\.example/.test(say(M.$('#view'))) && /Taken off the call center team/.test(say(M.$('#view'))), 'the second tap takes Jess off the team');
  ok(M.errors.length === 0, 'no errors (' + M.errors.slice(0, 3).join(' | ') + ')');

  // not an admin: the screen says so even if reached
  const K = await load(FILE, { db: seed(), org: ORG, me: asOwner, fnReply: fnReplies({ status: ST.trial(13) }), setup: browser(rec0()) });
  K.click('[data-act="more:open"]'); await sleep(10);
  ok(!K.$('[data-act="more:go"][data-tab="admin"]'), 'an owner who isn’t a MoveCrew admin has no MoveCrew admin in More');

  /* ---------------- the artifact edition ---------------- */
  const L = await load(ART, {});
  L.click('[data-act="more:open"]'); await sleep(10);
  ok(!L.w.tallyMember && !L.$('[data-act="more:go"][data-tab="admin"]'), 'the artifact edition has no membership and no MoveCrew admin');
  L.click('[data-act="more:close"]'); await sleep(5); await L.go('settings');
  ok(!!L.$('[data-act="set:open"][data-sec="company"]') && !L.$('[data-act="set:open"][data-sec="member"]'), 'and no Membership in Setup');
  ok(L.errors.length === 0, 'no errors in the artifact (' + L.errors.slice(0, 3).join(' | ') + ')');

  process.exit(summary('membership') ? 1 : 0);
})();
