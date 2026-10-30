// MoveCrew for Windows (windows/), the page's side: the hosted edition as the Windows app packs it
// (build/tally-windows.html), with the app's bridge (window.tallyDesktop, windows/preload.js) recorded.
// Stripe's pages and documents go to the computer's browser, Stripe is asked again when the window
// comes back to the front, a new version offers a restart, a truck-down alert flashes the taskbar,
// and someone who works only in the office is texted the Windows app.
const { load, ok, sleep, summary, clone } = require('./lib');
const WINFILE = __dirname + '/../../build/tally-windows.html', WEB = __dirname + '/../../build/tally-supabase.html';
const ORG = 'org-1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) MoveCrew/1.0.7 Chrome/152.0.0.0 Safari/537.36 MoveCrewWindows/1.0.7';
const SIGNUP = 'https://accounts.stripe.com/r/acct_1Blue000ABCD#alu_test_61SGhyomRuz7xsw5216';
const WINLINK = 'https://github.com/Mischief503/Tally/releases/download/windows/MoveCrew-Setup.exe';
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function row(path, data) { const [collection, doc_id] = path.split('/'); return { org_id: ORG, path, collection, doc_id, data, updated_at: new Date().toISOString() }; }
function jobDoc(id, name, crew) {
  return { id, status: 'active', createdAt: 1, startedAt: Date.now() - 36e5,
    d: { name, phone: '512-555-0142', moveDate: day(0), time: '08:00', from: '418 Oak St', to: '77 Ridge Rd', items: [], custom: {} },
    quote: { total: 900, cf: 400, crew: 2, hours: 3, lines: [], deposit: 0, nte: 0 }, items: [], assign: { truckId: 't26', crew }, tally: {},
    payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} };
}
function seed(o = {}) {
  const docs = [row('meta/init', { ts: 1, mode: 'fresh' }),
    row('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
      contacts: { Owner: '512-555-0100', Dispatch: '512-555-0199', Marcus: '512-555-0101', Dee: '512-555-0102' },
      trucks: [{ id: 't26', name: 'Box 1 (26 ft)', cf: 1700 }], forms: [] }),
    row('jobs/j1', jobDoc('j1', 'Priya Nair', ['Marcus', 'Dee']))];
  (o.alerts || []).forEach((a) => docs.push(row('chat/' + a.id, a)));
  return { docs, access_requests: [], comm_log: [], comm_lines: [{ org_id: ORG, phone_number: '+15125550000', enabled: true }],
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x.com', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-dispatch', email: 'd@x.com', staff: 'Dispatch', role: 'dispatch', ts: 1 },
      { org_id: ORG, user_id: 'u-marcus', email: 'marcus@x.com', staff: 'Marcus', role: 'lead', ts: 1 }],
    employees: [{ id: 'e-marcus', org_id: ORG, name: 'Marcus', role: 'lead', email: 'marcus@x.com', user_id: 'u-marcus', active: true, info: { phone: '512-555-0101' } }] };
}
function alert(id) {
  const now = Date.now();
  return { id, t: 'office', from: 'Marcus', text: 'Flat tire, rear left', ts: now - 6e4, k: 'sos', upd: now - 3e4, truck: 'Box 1 (26 ft)', truckId: 't26', jobId: 'j1', job: 'Priya Nair',
    loc: { lat: 30.26715, lng: -97.74306, acc: 12, ts: now - 3e4 } };
}
const CFG = { none: { ok: true, ready: false, test: true, publishableKey: '', reason: 'connect', connect: { state: 'none', due: [] } } };
function fnReplies() {
  return (b) => {
    if (b.action === 'pay_config') return clone(CFG.none);
    if (b.action === 'pay_connect') return { ok: true, url: SIGNUP };
    return { ok: true, sent: 0 };
  };
}
const rec0 = () => ({ open: [], winOpen: [], attn: [], cb: null, restarts: 0 });
// the Windows app around the page: its user agent and bridge (windows/preload.js), recorded
function desk(rec, o = {}) {
  return (w) => {
    Object.defineProperty(w.navigator, 'userAgent', { value: UA, configurable: true });
    w.open = (u) => { rec.winOpen.push(u); return null; };
    w.tallyDesktop = {
      platform: 'windows',
      open: (u) => { rec.open.push(u); },
      attention: (info) => { rec.attn.push(info); },
      onUpdate: (cb) => { rec.cb = cb; },
      restart: () => { rec.restarts++; return Promise.resolve(!!o.restartOk); },
    };
    w.AudioContext = function () { this.state = 'running'; this.currentTime = 0; this.destination = {}; };
    w.AudioContext.prototype.createOscillator = function () { return { frequency: {}, connect() {}, start() {}, stop() {} }; };
    w.AudioContext.prototype.createGain = function () { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; };
  };
}
const fnCalls = (A, act) => A.calls.fn.filter((c) => c.body.action === act);
const say = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
const set = (A, sel, v) => { const el = A.$(sel); el.value = v; el.dispatchEvent(new A.w.Event('input', { bubbles: true })); el.dispatchEvent(new A.w.Event('change', { bubbles: true })); };

(async () => {
  const all = [];

  /* ================= the owner on an office computer ================= */
  const rec = rec0();
  const A = await load(WINFILE, { db: seed(), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies(), setup: desk(rec) });
  all.push(A);
  ok(A.w.TALLY_STANDALONE === true && A.w.TALLY_WINDOWS === true && !A.$('link[rel="manifest"]'), 'the packed page knows it is the installed Windows app, with no website parts');
  ok(typeof rec.cb === 'function', 'it asks the app to say when a new version is ready');

  // a new version
  ok(A.$('#updBar').hidden, 'no update bar until a new version has downloaded');
  rec.cb({ version: '1.0.9' }); await sleep(10);
  ok(!A.$('#updBar').hidden && /A new version of MoveCrew is ready\. Restart to use it, or it goes in the next time MoveCrew is closed\./.test(say(A.$('#updBar'))), 'a downloaded version shows the bar, with Restart now and Later');
  A.click('#updBar [data-act="app:later"]'); await sleep(10);
  ok(A.$('#updBar').hidden, 'Later hides it');
  rec.cb({ version: '1.0.9' }); await sleep(10);
  ok(A.$('#updBar').hidden, 'and the same version doesn’t ask again');
  rec.cb({ version: '1.0.10' }); await sleep(10);
  ok(!A.$('#updBar').hidden, 'a newer one does');
  A.click('#updBar [data-act="app:restart"]'); await sleep(20);
  ok(rec.restarts === 1 && /goes in the next time MoveCrew is closed/.test(say(A.$('#toast'))) && A.$('#updBar [data-act="app:restart"]').textContent === 'Restart now', 'Restart now asks the app; when it can’t yet, it says when it goes in');

  // Stripe's sign-up page goes to the computer's browser
  await A.go('settings', 'pay'); await sleep(30);
  A.click('#view [data-act="pay:connect"]'); await sleep(60);
  ok(fnCalls(A, 'pay_connect').length === 1 && rec.open.length === 1 && rec.open[0] === SIGNUP, 'Connect with Stripe opens Stripe’s page in the computer’s browser');
  ok(rec.winOpen.length === 0, 'with no tab inside the app');
  ok(/Finished with Stripe\?/.test(say(A.$('#view'))), 'and MoveCrew waits for the owner to come back');
  const asked = fnCalls(A, 'pay_config').length;
  A.w.dispatchEvent(new A.w.Event('focus')); await sleep(40);
  ok(fnCalls(A, 'pay_config').length === asked + 1, 'back in the window (it comes to the front, the page was never hidden), it asks Stripe how the account stands');

  // documents
  await A.go('settings', 'employees'); await sleep(40);
  const hint = A.$$('#view a').find((a) => /MoveCrew for Windows/.test(a.textContent));
  ok(hint && hint.getAttribute('href') === WINLINK && hint.getAttribute('target') === '_blank', 'Setup › Employees links MoveCrew for Windows, for office computers');
  ok(!!A.$('#view [data-s="winLink"]') && A.$('#view [data-s="winLink"]').getAttribute('placeholder') === WINLINK, 'with a box for a different Windows link, like the phone app’s');
  A.click(A.$$('.emprow').find((r) => /Marcus/.test(r.textContent))); await sleep(40);
  const fileIn = A.$('#empDocFile');
  Object.defineProperty(fileIn, 'files', { value: [new A.w.File(['%PDF-1.4'], 'license.pdf', { type: 'application/pdf' })] });
  A.$('#empDocType').value = 'license';
  A.click('[data-act="emp:docup"]'); await sleep(60);
  A.click('[data-act="emp:docview"]'); await sleep(40);
  ok(rec.open.length === 2 && /^https:\/\/signed\.example\//.test(rec.open[1]) && rec.winOpen.length === 0, 'View opens the private document link in the computer’s browser');
  A.click('[data-act="emp:close"]'); await sleep(10);

  // texting the app to someone new: the office gets the Windows app, the field the phone app
  A.click('[data-act="emp:new"]'); await sleep(20);
  set(A, '[data-ek="name"]', 'Dana');
  set(A, '[data-ek="email"]', 'dana@x.com');
  set(A, '[data-ek="phone"]', '503-555-0177');
  A.click(A.$('[data-ak="field"][value="off"]')); await sleep(10);
  A.click(A.$('[data-ak="dispatch"]')); await sleep(10);
  A.click('[data-act="emp:save"]'); await sleep(40);
  let sms = A.$('#emp a[href^="sms:"]');
  let body = sms ? decodeURIComponent(sms.getAttribute('href').replace(/^[^?]*\?&body=/, '')) : '';
  ok(body === 'Hi Dana, it\'s Ace Moving. Get MoveCrew for your Windows computer here: ' + WINLINK + ' and sign in with dana@x.com.', 'someone who works only in the office is texted the Windows app: ' + body);
  A.click('[data-act="emp:close"]'); await sleep(10);
  A.click('[data-act="emp:new"]'); await sleep(20);
  set(A, '[data-ek="name"]', 'Rico');
  set(A, '[data-ek="email"]', 'rico@x.com');
  set(A, '[data-ek="phone"]', '503-555-0188');
  A.click('[data-act="emp:save"]'); await sleep(40);
  sms = A.$('#emp a[href^="sms:"]');
  body = sms ? decodeURIComponent(sms.getAttribute('href').replace(/^[^?]*\?&body=/, '')) : '';
  ok(/Get the MoveCrew app here: https:\/\/github\.com\/Mischief503\/Tally\/releases\/latest\/download\/MoveCrew\.apk and sign in with rico@x\.com\. You'll go straight to your jobs\./.test(body), 'someone on the crew still gets the phone app');
  A.click('[data-act="emp:close"]'); await sleep(10);
  ok(A.errors.length === 0, 'no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ================= dispatch: a truck goes down ================= */
  const recB = rec0();
  const db = seed({ alerts: [alert('sx1')] });
  const B = await load(WINFILE, { db, org: ORG, me: { uid: 'u-dispatch', email: 'd@x.com' }, fnReply: () => ({ ok: true, sent: 1 }), setup: desk(recB) });
  all.push(B);
  ok(!B.$('#sos').hidden && /Box 1 \(26 ft\) is down/.test(say(B.$('#sos'))), 'dispatch gets the alert on screen');
  ok(recB.attn.length === 1 && recB.attn[0].title === 'Truck down: Box 1 (26 ft)' && recB.attn[0].body === 'Marcus: Flat tire, rear left', 'and the app is asked to flash on the taskbar with a Windows notice: ' + JSON.stringify(recB.attn[0]));
  B.click('[data-act="sos:ack"]'); await sleep(80);
  ok(recB.attn.length === 2 && recB.attn[1] === null, 'Got it stops the flashing');
  B.click('[data-act="sos:hide"]'); await sleep(20);
  ok(recB.attn.length === 2, 'and nothing more is asked of the app');
  ok(B.errors.length === 0, 'no errors (' + B.errors.slice(0, 3).join(' | ') + ')');

  /* ================= the website: none of it ================= */
  const C = await load(WEB, { db: seed(), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: fnReplies() });
  all.push(C);
  ok(C.$('#updBar').hidden && !C.w.tallyDesktop, 'in a browser there is no update bar and no Windows bridge');

  process.exit(summary('windows') ? 1 : 0);
})();
