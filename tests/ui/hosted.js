// Hosted (Supabase) edition: texts, masked calls, call log, setup card, and that nothing fires when it shouldn't.
const { load, ok, sleep, summary } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html';
const ORG = 'org-1';
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
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee', 'Luis'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
    contacts: { Owner: '512-555-0100', Dispatch: '512-555-0199', Marcus: '512-555-0101', Dee: '512-555-0102', Luis: '' },
    forms: [{ id: 'f1', title: 'Delivery receipt', kind: 'text', required: true, text: 'I accept.', pageIds: [] }],
    trucks: [{ id: 't26', name: 'Box 1 (26 ft)', cf: 1700 }] });
  put('jobs/j1', jobDoc('j1'));
  put('jobs/j2', jobDoc('j2', { status: 'done', d: Object.assign(jobDoc('x').d, { name: 'Lena Wu', phone: '512-555-0177' }), finishedAt: Date.now() - 6e5, startedAt: Date.now() - 4e6 }));
  return {
    docs,
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x.com', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-marcus', email: 'm@x.com', staff: 'Marcus', role: 'lead', ts: 1 }],
    access_requests: [],
    comm_lines: opts.noLine ? [] : [{ org_id: ORG, phone_number: '+15125550000', enabled: true }],
    comm_log: [
      { id: 1, org_id: ORG, job_id: 'j1', channel: 'sms', direction: 'out', purpose: 'assigned', staff: 'Marcus', party: 'Marcus', to_number: '+15125550101', body: "Ace Moving: You're on Priya Nair, Mon Oct 5 at 8:00 AM.", status: 'delivered', created_at: new Date(Date.now() - 3e5).toISOString() },
      { id: 2, org_id: ORG, job_id: 'j1', channel: 'sms', direction: 'out', purpose: 'assigned', staff: 'Luis', party: 'Luis', status: 'no-number', error: 'No phone number saved for Luis in Setup', body: 'x', created_at: new Date(Date.now() - 2e5).toISOString() },
      { id: 3, org_id: ORG, job_id: 'j1', channel: 'call', direction: 'out', purpose: 'masked', staff: 'Marcus', party: 'Priya Nair', status: 'answered', duration_sec: 184, created_at: new Date(Date.now() - 1e5).toISOString() },
      { id: 4, org_id: ORG, job_id: 'j1', channel: 'call', direction: 'in', purpose: 'callback', party: 'Priya Nair', from_number: '+15125550142', status: 'missed', created_at: new Date().toISOString() },
    ],
  };
}

(async () => {
  /* ---------------- owner, line connected ---------------- */
  let reply = () => ({ ok: true, sent: 2 });
  let A = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-owner', email: 'o@x.com' }, fnReply: (b) => reply(b) });
  const { w, $, $$, click, text, calls, T } = A;
  ok(!$('#login') && $('#view').textContent.length > 20, 'signs in and boots past the login');
  ok(w.tallyComms && w.tallyComms.number() === '+15125550000', 'adapter reads the company line');
  ok(T.state().jobs.length === 2, 'jobs arrive from the database');
  T.comms.SETTLE = 60;

  // ---- setup card
  click('[data-act="more:open"]'); await sleep(10);
  click('[data-act="more:go"][data-tab="settings"]'); await sleep(30);
  ok(/Texts and calls/.test(text()) && /Company line \(512\) 555-0000/.test(text()), 'Setup shows the company line');
  const tg = $('details[data-k="st:Texts and calls"]');
  ok(!!tg, 'the card sits in Setup like the others');
  ok($$('input[data-s^="comms.alerts."]').length === 4 && $$('input[data-s^="comms.alerts."]').every((i) => i.checked), 'four alert switches, all on');
  ok(/No phone number for Luis/.test(text()), 'Setup warns who has no number');
  const ringChips = $$('[data-act="st:ring"]');
  ok(ringChips.length === 4 && ringChips.filter((c) => c.classList.contains('on')).map((c) => c.dataset.n).join() === 'Owner,Dispatch', 'office rings by default');
  click(ringChips.find((c) => c.dataset.n === 'Dispatch')); await sleep(10);
  ok(JSON.stringify(T.state().settings.comms.ring) === '["Owner"]', 'tapping Dispatch off leaves Owner ringing');
  const cbMoved = $('input[data-s="comms.alerts.moved"]'); cbMoved.checked = false; cbMoved.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok(T.state().settings.comms.alerts.moved === false, 'switching off move texts saves');
  await sleep(400);
  const setW = calls.writes.filter((x) => x.table === 'docs' && x.row.path === 'org/settings').pop();
  ok(setW && setW.row.data.comms && setW.row.data.comms.alerts.moved === false && setW.row.data.comms.ring[0] === 'Owner', 'settings reach the database, where the function reads them');
  cbMoved.checked = true; cbMoved.dispatchEvent(new w.Event('input', { bubbles: true }));

  // ---- schedule edits ping the function once, after things settle
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  click('[data-act="job:open"][data-id="j1"]'); await sleep(80);
  ok(/Calls and texts/.test($('#sheet').textContent), 'job sheet has a Calls and texts section');
  const sheetTxt = $('#sheet').textContent.replace(/\s+/g, ' ');
  ok(/Text to Marcus.*Delivered/.test(sheetTxt) && /You're on Priya Nair/.test(sheetTxt), 'delivered text listed with its wording');
  ok(/Text to Luis.*No phone number.*No phone number saved for Luis/.test(sheetTxt), 'unsent text shows why');
  ok(/Call to Marcus.*Talked 3m 4s/.test(sheetTxt) && /Call from Priya Nair.*Missed/.test(sheetTxt), 'calls listed with talk time and missed callbacks');
  calls.fn.length = 0;
  const chip = () => $$('#sheet [data-act="sh:crew"]').find((c) => c.dataset.n === 'Luis');
  click(chip()); await sleep(5); click(chip()); await sleep(5); click(chip()); await sleep(20);
  ok(calls.fn.length === 0, 'nothing sent while still tapping');
  await sleep(500);
  const pings = calls.fn.filter((c) => c.body.action === 'job');
  ok(pings.length === 1 && pings[0].body.jobId === 'j1' && pings[0].body.org === ORG, 'one check sent for the job once taps settle');
  ok(pings[0] && /\/functions\/v1\/tally-twilio\/app$/.test(pings[0].url) && pings[0].init.headers.Authorization === 'Bearer tok-u-owner' && pings[0].init.keepalive === true, 'goes to the Edge Function with the user\'s sign-in, and survives closing the app');
  await sleep(50);
  ok(/Texted 2 people about Priya Nair/.test($('#toast').textContent), 'office told who was texted');

  calls.fn.length = 0;
  const notes = $('#sheet textarea[data-j="notes"]'); notes.value = 'Gate code 1234'; notes.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(400);
  ok(calls.fn.length === 0, 'editing notes texts nobody');
  const dt = $('#sheet input[data-j="moveDate"]'); dt.value = day(4); dt.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(400);
  ok(calls.fn.filter((c) => c.body.action === 'job').length === 1, 'moving the date sends a check');

  // ---- a change that comes from another device does not trigger texts from this one
  calls.fn.length = 0;
  const db = w.__sb;
  await db.from('docs').upsert({ org_id: ORG, path: 'jobs/j1', collection: 'jobs', doc_id: 'j1', data: Object.assign(T.jobDoc(T.state().jobs.find((j) => j.id === 'j1')), { assign: { truckId: 't26', crew: ['Dee'] } }), updated_at: 'x' });
  await sleep(500);
  ok(T.state().jobs.find((j) => j.id === 'j1').assign.crew.join() === 'Dee', 'remote change arrives');
  ok(calls.fn.length === 0, 'and this device does not send texts for it');

  // ---- calling the customer: three ways, company line offered first
  click('#sheet [data-act="call:cust"]'); await sleep(20);
  let callTxt = $('#call').textContent;
  const btns = $$('#call .bigbtn');
  ok(btns.length === 3 && btns[0].dataset.act === 'call:company' && btns[0].classList.contains('primary'), 'company line offered first when nothing was chosen before');
  ok(btns.some((b) => b.getAttribute('href') === 'tel:5125550142') && btns.some((b) => b.getAttribute('href') === 'tel:*675125550142'), 'show-my-number and private still there, unchanged');
  ok(/they see \(512\) 555-0000, not your cell/.test(callTxt) && /press 1/.test(callTxt), 'explains what the customer sees');
  calls.fn.length = 0;
  reply = (b) => b.action === 'call' ? { ok: true, message: 'Your phone will ring from the company line. Answer and press 1 to reach Priya Nair.' } : { ok: true, sent: 0 };
  click(btns[0]); await sleep(60);
  const cl = calls.fn.find((c) => c.body.action === 'call');
  ok(cl && cl.body.jobId === 'j1', 'company-line call goes to the function with the job');
  ok(/Answer and press 1/.test($('#toast').textContent) && $('#call').hidden, 'caller told what happens next');
  ok(T.state().ui.callPrefs['5125550142'] === 'company', 'choice remembered for this customer');
  click('#sheet [data-act="call:cust"]'); await sleep(20);
  ok(/Last time you called Priya Nair you used the company line/.test($('#call').textContent) && $$('#call .bigbtn')[0].dataset.act === 'call:company', 'next time it reminds, and still asks');
  click('#call [data-act="call:close"]');
  // previous choices still lead when they were show/private
  T.state().ui.callPrefs['5125550142'] = 'hide';
  click('#sheet [data-act="call:cust"]'); await sleep(20);
  ok($$('#call .bigbtn')[0].getAttribute('href') === 'tel:*675125550142', 'a customer you called privately still gets private first');
  click('#call [data-act="call:close"]');
  reply = (b) => b.action === 'call' ? { ok: false, message: 'Add your phone number in Setup first.' } : { ok: true, sent: 0 };
  click('#sheet [data-act="call:cust"]'); await sleep(20);
  click($$('#call [data-act="call:company"]')[0]); await sleep(60);
  ok(/Add your phone number in Setup first/.test($('#toast').textContent), 'server refusal shown to the caller');
  click('[data-act="sheet:close"]'); await sleep(20);

  // ---- forms left unsigned: the office is texted when the lead exits
  calls.fn.length = 0;
  reply = () => ({ ok: true, sent: 2 });
  T.ui.tab = 'jobs';
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  click('[data-act="job:open"][data-id="j2"]'); await sleep(40);
  click('#sheet [data-act="flow:open"]'); await sleep(30);
  ok(!$('#flow').hidden && /Delivery receipt/.test($('#flow').textContent), 'signing flow opens on the waiting form');
  ok(calls.fn.length === 0, 'nothing sent while the form is on screen');
  click('#flow [data-act="flow:close"]'); await sleep(500);
  const fp = calls.fn.filter((c) => c.body.action === 'forms');
  ok(fp.length === 1 && fp[0].body.jobId === 'j2', 'exiting with the form unsigned tells the function');
  ok(/office has been texted/.test($('#toast').textContent), 'and the lead is told the office knows');
  // signed, then exit: nothing
  calls.fn.length = 0;
  click('#sheet [data-act="flow:open"]'); await sleep(30);
  $('#sigName').value = 'Lena Wu'; $('#sigAgree').checked = true;
  $('#sigPad').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  click('#flow [data-act="flow:sign"]'); await sleep(30);
  ok(/Collect payment/.test($('#flow').textContent), 'signing moves on to payment');
  click('#flow [data-act="flow:close"]'); await sleep(500);
  ok(calls.fn.filter((c) => c.body.action === 'forms').length === 0, 'signed forms send nothing');
  click('[data-act="sheet:close"]');

  // ---- leaving the app with a change pending sends it right away
  calls.fn.length = 0;
  T.comms.SETTLE = 60000;
  click('[data-act="job:open"][data-id="j1"]'); await sleep(40);
  click($$('#sheet [data-act="sh:crew"]').find((c) => c.dataset.n === 'Marcus')); await sleep(30);
  Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => true });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(300);
  ok(calls.fn.filter((c) => c.body.action === 'job').length === 1, 'switching away from the app sends a pending check at once');
  Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => false });
  ok(A.errors.length === 0, 'no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- crew lead, field view ---------------- */
  const B = await load(FILE, { db: seed(), org: ORG, me: { uid: 'u-marcus', email: 'm@x.com' }, fnReply: (b) => (b.action === 'call' ? { ok: true, message: 'Your phone will ring.' } : b.action === 'eta' ? { ok: true, message: 'Texted Priya Nair: about ' + b.minutes + ' minutes.' } : { ok: true, sent: 0 }) });
  B.T.comms.SETTLE = 30;
  ok(B.T.state().ui.role === 'lead' && /Marcus/.test(B.$('#whoami').textContent), 'lead signs in as himself');
  B.click('[data-act="more:open"]'); await sleep(10); B.click('[data-act="more:go"][data-tab="crew"]'); await sleep(30);
  B.click(B.$$('[data-act="call:cust"]')[0]); await sleep(20);
  ok(B.$$('#call .bigbtn')[0].dataset.act === 'call:company', 'crew get the company line too');
  B.click(B.$$('#call [data-act="call:company"]')[0]); await sleep(50);
  ok(B.calls.fn.some((c) => c.body.action === 'call' && c.init.headers.Authorization === 'Bearer tok-u-marcus'), 'call carries the lead\'s own sign-in');
  B.calls.fn.length = 0;
  B.$('#cn_j1').value = 'Gate 4411'; B.click(B.$$('[data-act="cr:note"]')[0]); await sleep(200);
  ok(B.T.state().jobs.find((j) => j.id === 'j1').crewNotes.length === 1, 'lead adds a crew note');
  ok(B.calls.fn.length === 0, 'crew edits never trigger schedule texts');
  ok(!B.$('#sheet') || B.$('#sheet').hidden, 'crew still have no office job sheet');
  // start with the arrival text through the company line
  B.calls.fn.length = 0;
  B.click('[data-act="cr:start"][data-id="j1"]'); await sleep(10);
  const gb = B.$('#start [data-act="go:start"]');
  ok(gb && gb.tagName === 'BUTTON' && /Sent from the company line \(512\) 555-0000 to 512-555-0142/.test(B.$('#start').textContent), 'with a company line, the arrival text goes through it');
  B.click('[data-act="go:set"][data-m="20"]'); await sleep(5);
  B.click('#start [data-act="go:start"]'); await sleep(80);
  const ec = B.calls.fn.find((c) => c.body.action === 'eta');
  ok(ec && ec.body.jobId === 'j1' && ec.body.minutes === 20 && ec.init.headers.Authorization === 'Bearer tok-u-marcus', 'arrival text sent by the lead: 20 minutes');
  ok(/Texted Priya Nair: about 20 minutes/.test(B.$('#toast').textContent), 'the lead sees it went out');
  ok(B.T.state().jobs.find((j) => j.id === 'j1').status === 'active', 'job started');
  B.click('.crewcard [data-act="cr:phase"][data-id="j1"]'); await sleep(500);
  const pw = B.calls.writes.filter((x) => x.table === 'docs' && x.row.path === 'jobs/j1').pop();
  ok(pw && pw.row.data.status === 'active' && pw.row.data.phases && pw.row.data.phases.loadStart > 0, 'Start loading reaches the database with the job');
  ok(B.calls.fn.filter((c) => c.body.action === 'job').length === 0, 'crew steps never trigger schedule texts');
  ok(B.errors.length === 0, 'no errors for crew (' + B.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- owner, no line yet (migration not run) ---------------- */
  const sd = seed(); sd.__noLineTable = true;
  const C = await load(FILE, { db: sd, org: ORG, me: { uid: 'u-owner', email: 'o@x.com' } });
  C.T.comms.SETTLE = 30;
  ok(C.w.tallyComms.number() === '' && !C.$('#login'), 'missing table does not stop the app booting');
  C.click('[data-act="tab"][data-tab="jobs"]'); await sleep(20);
  C.click('[data-act="job:open"][data-id="j1"]'); await sleep(40);
  C.click('#sheet [data-act="call:cust"]'); await sleep(20);
  ok(C.$$('#call .bigbtn').length === 2 && !C.$('#call [data-act="call:company"]'), 'no company line: just the original two choices');
  C.click('#call [data-act="call:close"]');
  ok(/company line is not connected/.test(C.$('#sheet').textContent), 'sheet says the line is not connected');
  C.calls.fn.length = 0;
  C.click(C.$$('#sheet [data-act="sh:crew"]').find((c) => c.dataset.n === 'Luis')); await sleep(200);
  ok(C.calls.fn.filter((c) => c.body.action === 'job').length === 0, 'no line, no texting calls');
  C.click('[data-act="sheet:close"]'); C.click('[data-act="more:open"]'); await sleep(10); C.click('[data-act="more:go"][data-tab="settings"]'); await sleep(30);
  ok(/Not connected yet/.test(C.text()), 'Setup explains how it switches on');
  ok(C.errors.length === 0, 'no errors without a line (' + C.errors.slice(0, 3).join(' | ') + ')');

  process.exit(summary('hosted') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
