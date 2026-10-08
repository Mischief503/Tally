// Truck down, the emergency beacon: the crew tells the office the truck is down and where. The
// office sees it at once and answers Got it; the location keeps going while it is on; the server
// texts the office; nobody else is bothered; and nothing goes out from a copy that can't reach them.
const { load, ok, sleep, summary } = require('./lib');
const HOSTED = __dirname + '/../../build/tally-supabase.html', ART = __dirname + '/../../build/tally-artifact.html';
const ORG = 'org-1', KEY = 'tally.v1.' + ORG;
const clone = (o) => JSON.parse(JSON.stringify(o));
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function jobDoc(id, name, crew, extra) {
  return Object.assign({ id, status: 'active', createdAt: 1, startedAt: Date.now() - 36e5,
    d: { name, phone: '512-555-0142', moveDate: day(0), time: '08:00', from: '418 Oak St', to: '77 Ridge Rd', items: [], custom: {} },
    quote: { total: 900, cf: 400, crew: 2, hours: 3, lines: [], deposit: 0, nte: 0 }, items: [], assign: { truckId: 't26', crew }, tally: {},
    payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} }, extra || {});
}
function row(path, data) { const [collection, doc_id] = path.split('/'); return { org_id: ORG, path, collection, doc_id, data, updated_at: new Date().toISOString() }; }
function seed(o = {}) {
  const docs = [row('meta/init', { ts: 1 }),
    row('org/settings', { company: 'Ace Moving', crew: ['Marcus', 'Dee', 'Luis'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }, { name: 'Dispatch', kind: 'dispatch' }],
      contacts: { Owner: '512-555-0100', Dispatch: '512-555-0199', Marcus: '512-555-0101', Dee: '512-555-0102', Luis: '' },
      trucks: [{ id: 't26', name: 'Box 1 (26 ft)', cf: 1700 }, { id: 't16', name: 'Box 2 (16 ft)', cf: 900 }], forms: [] }),
    row('jobs/j1', jobDoc('j1', 'Priya Nair', ['Marcus', 'Dee'], o.testJob ? { test: true } : {}))];
  (o.alerts || []).forEach((a) => docs.push(row('chat/' + a.id, a)));
  return { docs, access_requests: [], comm_log: [], comm_lines: o.noLine ? [] : [{ org_id: ORG, phone_number: '+15125550000', enabled: true }],
    members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-dispatch', email: 'd@x', staff: 'Dispatch', role: 'dispatch', ts: 1 },
      { org_id: ORG, user_id: 'u-marcus', email: 'm@x', staff: 'Marcus', role: 'lead', ts: 1 }, { org_id: ORG, user_id: 'u-dee', email: 'e@x', staff: 'Dee', role: 'crew', ts: 1 }] };
}
function alert(id, over) {
  const now = Date.now();
  return Object.assign({ id, t: 'office', from: 'Marcus', text: 'Flat tire, rear left', ts: now - 6e4, k: 'sos', upd: now - 3e4, truck: 'Box 1 (26 ft)', truckId: 't26', jobId: 'j1', job: 'Priya Nair',
    loc: { lat: 30.26715, lng: -97.74306, acc: 12, ts: now - 3e4 } }, over || {});
}
// a phone's location, buzz, screen lock and sound, all recorded
function phone(o = {}) {
  return (w) => {
    const g = { watches: [], cleared: [], current: [] }, fx = { vib: [], beeps: 0, wake: 0, released: 0 };
    if (!o.noGeo) Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: {
      watchPosition(okf, errf, opts) { g.watches.push({ ok: okf, err: errf, opts }); return g.watches.length; },
      clearWatch(id) { g.cleared.push(id); },
      getCurrentPosition(okf, errf, opts) { g.current.push({ ok: okf, err: errf, opts }); },
    } });
    Object.defineProperty(w.navigator, 'vibrate', { configurable: true, value: (p) => { fx.vib.push(p); return true; } });
    Object.defineProperty(w.navigator, 'wakeLock', { configurable: true, value: { request: () => { fx.wake++; return Promise.resolve({ release() { fx.released++; }, addEventListener() {} }); } } });
    w.AudioContext = function () { this.state = 'running'; this.currentTime = 0; this.destination = {}; };
    w.AudioContext.prototype.createOscillator = function () { return { frequency: {}, connect() {}, start() { fx.beeps++; }, stop() {} }; };
    w.AudioContext.prototype.createGain = function () { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; };
    w.__geo = g; w.__fx = fx;
    if (o.storage) w.localStorage.setItem(KEY, o.storage);
  };
}
const fix = (lat, lng, acc) => ({ coords: { latitude: lat, longitude: lng, accuracy: acc } });
const as = (uid) => ({ uid, email: uid + '@x' });
const sosReply = (start) => (b) => b.action === 'sos' ? (b.kind === 'start' ? start : { ok: true, sent: 1 }) : { ok: true, sent: 0 };

(async () => {
  const all = [];

  /* ---------- Marcus's truck breaks down ---------- */
  const db = seed();
  const A = await load(HOSTED, { db, org: ORG, me: as('u-marcus'), setup: phone(), fnReply: sosReply({ ok: true, sent: 2, names: ['Owner', 'Dispatch'] }) });
  all.push(A);
  const { w, $, $$, click, calls, T } = A;
  const patches = (id) => calls.writes.filter((x) => x.op === 'patch' && x.row.path === 'chat/' + id);
  const tdBtn = $$('#view [data-act="sos:open"]').find((b) => /Truck down\? Tell the office/.test(b.textContent));
  ok(!!tdBtn, 'the crew’s Today screen has a Truck down button');
  click(tdBtn); await sleep(20);
  ok(!$('#sos').hidden && /Tell the office your truck is down\?/.test($('#sos').textContent), 'it opens the truck-down screen');
  ok($('#sosTruck').value === 't26' && /Job: Priya Nair\./.test($('#sos').textContent), 'it picks the truck and the job from today’s schedule');
  ok(/where you are, and a text\./.test($('#sos').textContent), 'it says the office gets a text too');
  ok(w.__geo.watches.length === 0, 'nothing is shared before the alert is sent');
  ok(w.document.body.classList.contains('lock'), 'the page behind it holds still');
  $('#sosTruck').value = 't16';
  $('#sosNote').value = 'Flat tire, rear left';
  click('[data-act="sos:send"]'); await sleep(80);
  const sent = db.docs.find((d) => d.collection === 'chat' && d.data.k === 'sos');
  ok(sent && sent.data.from === 'Marcus' && sent.data.t === 'office' && sent.data.text === 'Flat tire, rear left' && sent.data.truck === 'Box 2 (16 ft)' &&
    sent.data.truckId === 't16' && sent.data.jobId === 'j1' && sent.data.job === 'Priya Nair' && !sent.data.test, 'the alert is saved with who sent it, the truck they chose, the job and the note');
  const id = sent.data.id;
  ok(w.__geo.watches.length === 1 && w.__geo.watches[0].opts.enableHighAccuracy === true, 'sending asks the phone for a precise location');
  ok(T.state().ui.sosOwn && T.state().ui.sosOwn.id === id, 'this phone remembers it is sharing for this alert');
  const sosTxt = () => $('#sos').textContent.replace(/\s+/g, ' ');
  ok(/The office has been told/.test(sosTxt()) && /Finding your location/.test(sosTxt()) && /Texting the office/.test(sosTxt()), 'the crew sees it went, and what is still on its way');
  ok(!calls.fn.some((c) => c.body.action === 'sos'), 'the texts wait a moment for a location');
  ok(w.__fx.wake === 1, 'the screen stays on while the location is shared');
  ok(w.__fx.beeps === 0 && w.__fx.vib.length === 0, 'the sender’s own phone does not chime');

  w.__geo.watches[0].ok(fix(30.2671534, -97.7430571, 12)); await sleep(80);
  ok(patches(id).length === 1 && patches(id)[0].patch.loc.lat === 30.26715 && patches(id)[0].patch.loc.lng === -97.74306 && patches(id)[0].patch.loc.acc === 12,
    'the first fix goes to the office at once, to about a metre');
  const st = calls.fn.filter((c) => c.body.action === 'sos');
  ok(st.length === 1 && st[0].body.kind === 'start' && st[0].body.msgId === id && st[0].body.org === ORG, 'then the server is asked to text the office');
  ok(/Texted Owner and Dispatch\./.test(sosTxt()), 'the crew sees who was texted');
  ok(/Sharing where you are · updated just now · within 12 m/.test(sosTxt()), 'and that the location is going out');

  w.__geo.watches[0].ok(fix(30.2681534, -97.7430571, 12)); await sleep(30);
  ok(patches(id).length === 1, 'a second fix straight away is held back');
  T.sos.sentAt = Date.now() - 9000;
  w.__geo.watches[0].ok(fix(30.2671934, -97.7430571, 12)); await sleep(30);
  ok(patches(id).length === 1, 'a few metres of drift is not sent');
  w.__geo.watches[0].ok(fix(30.2681534, -97.7430571, 12)); await sleep(30);
  ok(patches(id).length === 2, 'the truck being moved is');
  T.sos.sentAt = Date.now() - 121000;
  w.__geo.watches[0].ok(fix(30.2681534, -97.7430571, 12)); await sleep(30);
  ok(patches(id).length === 3, 'standing still, it is sent again every 2 minutes so the office knows it is current');
  ok(calls.fn.filter((c) => c.body.action === 'sos').length === 1, 'the texts go out once');
  await sleep(300);
  const savedState = w.localStorage.getItem(KEY), savedAlert = clone(db.docs.find((d) => d.path === 'chat/' + id).data);

  click('[data-act="sos:hide"]'); await sleep(20);
  ok($('#sos').hidden && !$('#sosBar').hidden && /Your truck-down alert is on/.test($('#sosBar').textContent), 'closing the screen leaves a red bar while the alert is on');
  ok(w.document.body.classList.contains('sos-on') && !w.document.body.classList.contains('lock'), 'the page makes room for the bar and scrolls again');
  ok(/Truck down alert is on/.test($('#view').textContent) && !/Truck down\? Tell the office/.test($('#view').textContent), 'Today shows the alert is on instead of the button');
  click('[data-act="tab"][data-tab="chat"]'); await sleep(20);
  ok(!/Flat tire/.test($('#view').textContent), 'the alert is not in the team chat');

  await w.__sb.from('docs').upsert(row('chat/ack1', { id: 'ack1', t: 'office', from: 'Dispatch', text: 'Got it', ts: Date.now(), k: 'sosack', ref: id })); await sleep(400);
  ok(!/Got it/.test($('#view').textContent), 'nor is the office’s answer');
  click('#sosBar'); await sleep(20);
  ok(!$('#sos').hidden && /Dispatch got it/.test(sosTxt()), 'the crew sees the office got it');
  const ta = $('#sosNote_' + id);
  ta.focus(); ta.value = 'Flat tire, need'; ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  await w.__sb.from('docs').upsert(row('chat/ack2', { id: 'ack2', t: 'office', from: 'Owner', text: 'Got it', ts: Date.now(), k: 'sosack', ref: id })); await sleep(400);
  ok($('#sosNote_' + id) === ta && w.document.activeElement === ta && !/Owner got it/.test(sosTxt()), 'typing in the note is not interrupted by news coming in');
  ta.blur(); T.sosSync(); await sleep(20);
  ok(/Dispatch and Owner got it/.test(sosTxt()) && $('#sosNote_' + id).value === 'Flat tire, need', 'the news shows once they stop, and what they typed is kept');

  $('#sosNote_' + id).value = 'Flat tire, need a tow';
  click('[data-act="sos:note"]'); await sleep(80);
  ok(patches(id).some((x) => x.patch.text === 'Flat tire, need a tow'), 'the note can be updated while the alert is on');

  const endBtn = () => $('#sos [data-act="sos:end"]');
  click(endBtn()); await sleep(20);
  ok(/Tap again to end the alert/.test(endBtn().textContent) && !patches(id).some((x) => x.patch.end), 'ending takes a second tap');
  click(endBtn()); await sleep(100);
  const endW = patches(id).find((x) => x.patch.end);
  ok(endW && endW.patch.end.by === 'Marcus', 'Running again ends the alert, as Marcus');
  ok(w.__geo.cleared.length === 1 && T.state().ui.sosOwn === null && T.sos.id === '', 'and the location stops');
  ok(calls.fn.some((c) => c.body.action === 'sos' && c.body.kind === 'end' && c.body.msgId === id), 'the server is asked to tell the office');
  ok(/All clear/.test(sosTxt()) && /Box 2 \(16 ft\) is running again/.test(sosTxt()), 'the screen shows the all clear');
  ok(w.__fx.released === 1, 'the screen may sleep again');
  click('[data-act="sos:hide"]'); await sleep(20);
  ok($('#sosBar').hidden && !w.document.body.classList.contains('sos-on'), 'and the red bar is gone');

  /* ---------- Tally reopened while the alert is on, then the office closes it ---------- */
  const dbR = seed({ alerts: [savedAlert] });
  const R = await load(HOSTED, { db: dbR, org: ORG, me: as('u-marcus'), setup: phone({ storage: savedState }), fnReply: sosReply({ ok: true, sent: 2, names: ['Owner', 'Dispatch'] }) });
  all.push(R);
  ok(R.w.__geo.watches.length === 1, 'reopened, the phone picks the location back up');
  ok(!R.$('#sosBar').hidden && /Truck down alert is on/.test(R.$('#view').textContent), 'and shows the alert is still on');
  R.click('#sosBar'); await sleep(20);
  ok(/Texted Owner and Dispatch\./.test(R.$('#sos').textContent), 'it remembers who was texted');
  ok(!R.calls.fn.some((c) => c.body.action === 'sos'), 'and does not text them again');
  await R.w.__sb.from('docs').upsert(row('chat/' + id, Object.assign(clone(savedAlert), { end: { by: 'Owner', ts: Date.now() }, upd: Date.now() }))); await sleep(400);
  ok(R.w.__geo.cleared.length === 1 && R.T.state().ui.sosOwn === null, 'when the office closes it, the location stops');
  ok(/Owner closed your truck-down alert\. Your location is no longer shared\./.test(R.$('#toast').textContent), 'and the crew is told why');

  /* ---------- the office ---------- */
  const db2 = seed({ alerts: [alert('sx1')] });
  const B = await load(HOSTED, { db: db2, org: ORG, me: as('u-owner'), setup: phone(), fnReply: () => ({ ok: true, sent: 1 }) });
  all.push(B);
  const bTxt = () => B.$('#sos').textContent.replace(/\s+/g, ' ');
  ok(!B.$('#sos').hidden && /Box 1 \(26 ft\) is down/.test(bTxt()), 'the office gets the alert on screen right away');
  ok(/Flat tire, rear left/.test(bTxt()) && /From Marcus · job: Priya Nair · sent/.test(bTxt()), 'with the note, who sent it and the job');
  const dir = B.$('#sos a[href*="maps/dir"]');
  ok(dir && /destination=30\.26715,-97\.74306$/.test(dir.getAttribute('href')) && /within 12 m/.test(bTxt()), 'with directions to the truck, and how precise the location is');
  const callM = B.$$('#sos a[href^="tel:"]').find((a) => /Call Marcus/.test(a.textContent));
  ok(callM && callM.getAttribute('href') === 'tel:5125550101' && /\(512\) 555-0101/.test(callM.textContent), 'and a button to call Marcus, with his number showing');
  ok(B.w.__fx.beeps > 0 && B.w.__fx.vib.length > 0, 'it chimes and buzzes');
  ok(/^TRUCK DOWN: Box 1/.test(B.w.document.title), 'the browser tab says so too');
  B.click('[data-act="sos:ack"]'); await sleep(80);
  const ackRow = db2.docs.find((d) => d.collection === 'chat' && d.data.k === 'sosack');
  ok(ackRow && ackRow.data.ref === 'sx1' && ackRow.data.from === 'Owner' && ackRow.data.t === 'office' && ackRow.data.text === 'Got it', 'Got it is saved for Marcus to see');
  ok(/Marcus can see you got it/.test(bTxt()) && B.T.sos.ringT === null, 'and the chime stops');
  B.click('[data-act="sos:hide"]'); await sleep(20);
  ok(B.$('#sos').hidden && /Box 1 \(26 ft\) is down · Marcus · 1 min ago/.test(B.$('#sosBar').textContent), 'closed, a red bar stays while the truck is down');
  ok(!/TRUCK DOWN/.test(B.w.document.title), 'and the tab title goes back');
  const needs = B.$$('#view .alert').map((x) => x.textContent.replace(/\s+/g, ' '));
  ok(/Truck down: Box 1 \(26 ft\)\s*Marcus · Priya Nair · sent/.test(needs[0] || '') && !/All clear/.test(B.$('#view').textContent), 'Today lists it first under Needs you, never All clear');
  B.click('[data-act="tab"][data-tab="dispatch"]'); await sleep(30);
  const downPill = B.$$('#view .lane [data-act="sos:open"]');
  ok(downPill.length === 1 && /Down since/.test(downPill[0].textContent) && /Box 1 \(26 ft\)/.test(downPill[0].closest('.lane').querySelector('.lh').textContent), 'the Board marks the truck that is down');
  B.click(downPill[0]); await sleep(20);
  ok(!B.$('#sos').hidden && /Box 1 \(26 ft\) is down/.test(bTxt()), 'and tapping it opens the alert');
  B.click('[data-act="sos:hide"]'); await sleep(20);
  B.click('[data-act="tab"][data-tab="today"]'); await sleep(20);
  await B.w.__sb.from('docs').upsert(row('chat/sx1', alert('sx1', { loc: { lat: 30.2672, lng: -97.7431, acc: 8, ts: Date.now() }, upd: Date.now() }))); await sleep(400);
  ok(B.$('#sos').hidden, 'a newer location does not pop it up again');
  await B.w.__sb.from('docs').upsert(row('chat/sx2', alert('sx2', { from: 'Dee', truck: 'Box 2 (16 ft)', truckId: 't16', text: '', loc: null, ts: Date.now(), upd: Date.now() }))); await sleep(400);
  ok(!B.$('#sos').hidden && /Box 2 \(16 ft\) is down/.test(bTxt()) && /Box 1 \(26 ft\) is down/.test(bTxt()), 'another truck going down pops it up again, with both');
  ok(/Not in yet\. Their phone is still finding it\./.test(bTxt()), 'a location not in yet says so');
  const close2 = () => B.$('#sos [data-act="sos:end"][data-id="sx2"]');
  B.click(close2()); await sleep(20);
  ok(/Tap again to close this alert/.test(close2().textContent), 'closing someone else’s alert takes a second tap');
  B.click(close2()); await sleep(100);
  const c2 = B.calls.writes.find((x) => x.op === 'patch' && x.row.path === 'chat/sx2' && x.patch.end);
  ok(c2 && c2.patch.end.by === 'Owner', 'the office can close an alert');
  ok(B.calls.fn.some((c) => c.body.action === 'sos' && c.body.kind === 'end' && c.body.msgId === 'sx2'), 'and the server is asked to send the all-clear');
  ok(/Closed by Owner/.test(bTxt()), 'the screen shows it closed');
  B.$('#sos').dispatchEvent(new B.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(20);
  ok(B.$('#sos').hidden, 'Escape closes the screen');
  await B.w.__sb.from('docs').upsert(row('chat/sx1', alert('sx1', { end: { by: 'Marcus', ts: Date.now() }, upd: Date.now() }))); await sleep(400);
  ok(B.$('#sosBar').hidden && !B.w.document.body.classList.contains('sos-on'), 'when the last truck is running again, the bar goes');
  ok(!/Truck down:/.test(B.$('#view').textContent), 'and Today no longer lists it');

  /* ---------- crew who didn't send it see nothing ---------- */
  const C = await load(HOSTED, { db: seed({ alerts: [alert('sx1')] }), org: ORG, me: as('u-dee'), setup: phone() });
  all.push(C);
  ok(C.$('#sos').hidden && C.$('#sosBar').hidden && C.w.__fx.beeps === 0 && !/TRUCK DOWN/.test(C.w.document.title), 'the rest of the crew is not shown the alert');
  ok(C.$$('#view [data-act="sos:open"]').some((b) => /Truck down\? Tell the office/.test(b.textContent)), 'and still has their own Truck down button');

  /* ---------- old, ended and answered alerts; the link in the text ---------- */
  const old = alert('so1', { ts: Date.now() - 13 * 3600e3 }), done = alert('so2', { end: { by: 'Marcus', ts: Date.now() } });
  const D = await load(HOSTED, { db: seed({ alerts: [old, done] }), org: ORG, me: as('u-owner'), setup: phone() });
  all.push(D);
  ok(D.$('#sos').hidden && D.$('#sosBar').hidden, 'alerts that ended, or are older than 12 hours, are not shown');
  const answered = seed({ alerts: [alert('sx1')] });
  answered.docs.push(row('chat/a1', { id: 'a1', t: 'office', from: 'Owner', text: 'Got it', ts: Date.now(), k: 'sosack', ref: 'sx1' }));
  const E = await load(HOSTED, { db: answered, org: ORG, me: as('u-owner'), setup: phone() });
  all.push(E);
  ok(E.$('#sos').hidden && !E.$('#sosBar').hidden && E.w.__fx.beeps === 0, 'an alert this person already answered shows as the bar, without a chime');
  const F = await load(HOSTED, { db: clone(answered), org: ORG, me: as('u-owner'), hash: '#sos', setup: phone() });
  all.push(F);
  ok(!F.$('#sos').hidden && /Box 1 \(26 ft\) is down/.test(F.$('#sos').textContent), 'the link in the text opens the alert');
  ok(F.$$('#sos [data-act="sos:new"]').length === 1, 'and the office can report a truck of its own from there');

  /* ---------- texts not set up, and a phone with no location ---------- */
  const dbG = seed({ noLine: true });
  const G = await load(HOSTED, { db: dbG, org: ORG, me: as('u-marcus'), setup: phone({ noGeo: true }) });
  all.push(G);
  G.click(G.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  ok(!/and a text/.test(G.$('#sos').textContent), 'without a company line it doesn’t promise a text');
  G.click('[data-act="sos:send"]'); await sleep(80);
  ok(dbG.docs.some((d) => d.collection === 'chat' && d.data.k === 'sos' && d.data.truck === 'Box 1 (26 ft)' && d.data.text === ''), 'the alert still goes to the office’s Tally');
  ok(/Texts aren’t set up for this company/.test(G.$('#sos').textContent) && !G.calls.fn.some((c) => c.body.action === 'sos'), 'and it says no texts went out');
  ok(/This phone can’t find its location\./.test(G.$('#sos').textContent), 'a phone with no location says so');
  ok(dbG.docs.find((d) => d.collection === 'chat' && d.data.k === 'sos').data.geo === 'none', 'and the office is told it has none');

  /* ---------- location blocked ---------- */
  const dbH = seed();
  const H = await load(HOSTED, { db: dbH, org: ORG, me: as('u-marcus'), setup: phone(), fnReply: sosReply({ ok: true, sent: 2, names: ['Owner', 'Dispatch'] }) });
  all.push(H);
  H.click(H.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  H.click('[data-act="sos:send"]'); await sleep(80);
  const hid = dbH.docs.find((d) => d.collection === 'chat' && d.data.k === 'sos').data.id;
  H.w.__geo.watches[0].err({ code: 1 }); await sleep(100);
  ok(H.calls.writes.some((x) => x.op === 'patch' && x.row.path === 'chat/' + hid && x.patch.geo === 'off'), 'blocked location: the office is told the phone isn’t sharing one');
  ok(H.calls.fn.some((c) => c.body.action === 'sos' && c.body.kind === 'start'), 'and the texts go without waiting');
  ok(/Location is blocked on this phone/.test(H.$('#sos').textContent) && H.w.__geo.cleared.length === 1, 'the crew is told to say where they are');
  const J = await load(HOSTED, { db: dbH, org: ORG, me: as('u-dispatch'), setup: phone() });
  all.push(J);
  ok(/Their phone isn’t sharing a location\. Call them/.test(J.$('#sos').textContent), 'and the office sees why there is no map');
  ok(J.T.sos.ringT !== null, 'the office phone chimes');
  J.click('[data-act="sos:hide"]'); await sleep(20);
  ok(J.$('#sos').hidden && J.T.sos.ringT === null && !J.$('#sosBar').hidden, 'closing it without answering stops the chime and leaves the bar');
  ok(!J.calls.writes.some((x) => x.row && x.row.data && x.row.data.k === 'sosack'), 'and does not tell the crew it was seen');
  const hRow = clone(dbH.docs.find((d) => d.path === 'chat/' + hid).data);
  await J.w.__sb.from('docs').upsert(row('chat/' + hid, Object.assign(hRow, { text: 'On I-5 north at exit 290', upd: Date.now() }))); await sleep(400);
  ok(J.$('#sos').hidden && J.T.sos.ringT === null, 'a later change to that alert does not pop it up again');
  await sleep(300);
  ok(JSON.parse(J.w.localStorage.getItem(KEY)).ui.sosHide[hid] > 0, 'and this phone remembers it was closed');

  /* ---------- the alert can't be saved ---------- */
  const dbK = seed();
  dbK.__failUpsert = (table, p) => table === 'docs' && p.collection === 'chat';
  const K = await load(HOSTED, { db: dbK, org: ORG, me: as('u-marcus'), setup: phone() });
  all.push(K);
  K.click(K.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  K.click('[data-act="sos:send"]'); await sleep(80);
  ok(/The alert did not go out\. Check your signal and try again, or call the office\./.test(K.$('#sos').textContent), 'an alert that didn’t save says so');
  ok(K.w.__geo.cleared.length === 1 && !K.T.state().ui.sosOwn && !K.$('[data-act="sos:send"]').disabled, 'nothing is shared, and Send works again');
  delete dbK.__failUpsert;
  K.click('[data-act="sos:send"]'); await sleep(80);
  ok(dbK.docs.some((d) => d.collection === 'chat' && d.data.k === 'sos') && /The office has been told/.test(K.$('#sos').textContent), 'trying again sends it');

  /* ---------- a test job: the office sees it, nobody is texted ---------- */
  const dbL = seed({ testJob: true });
  const L = await load(HOSTED, { db: dbL, org: ORG, me: as('u-marcus'), setup: phone(), fnReply: sosReply({ ok: true, sent: 0, skipped: 'test', names: [] }) });
  all.push(L);
  L.click(L.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  ok(/You’re on a test job/.test(L.$('#sos').textContent) && !/and a text/.test(L.$('#sos').textContent), 'on a test job it says no texts will go out');
  L.click('[data-act="sos:send"]'); await sleep(60);
  L.w.__geo.watches[0].ok(fix(30.26715, -97.74306, 20)); await sleep(80);
  ok(dbL.docs.find((d) => d.collection === 'chat' && d.data.k === 'sos').data.test === true, 'the alert is marked as from a test job');
  ok(/You’re on a test job, so no texts went out/.test(L.$('#sos').textContent), 'and says no texts went out');
  const M = await load(HOSTED, { db: dbL, org: ORG, me: as('u-owner'), setup: phone() });
  all.push(M);
  ok(/Sent from a test job, so it may be practice\./.test(M.$('#sos').textContent), 'the office sees it may be practice');

  /* ---------- an owner looking at Marcus's screen can't send as him ---------- */
  const N = await load(HOSTED, { db: seed(), org: ORG, me: as('u-owner'), setup: phone() });
  all.push(N);
  N.click('[data-act="more:open"]'); await sleep(10);
  N.click('[data-act="more:preview"]'); await sleep(10);
  N.click('[data-act="pv:set"][data-role="lead"][data-staff="Marcus"]'); await sleep(30);
  N.click(N.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  ok(/can’t be sent from a preview/.test(N.$('#sos').textContent) && !N.$('[data-act="sos:send"]'), 'an owner previewing Marcus can’t send an alert as him');

  /* ---------- a copy that isn't connected to the office ---------- */
  const P = await load(ART, { setup: phone() });
  all.push(P);
  P.click('[data-act="more:open"]'); await sleep(10);
  P.click('#more [data-act="sos:open"]'); await sleep(20);
  ok(!P.$('#sos').hidden && /isn’t connected to the office/.test(P.$('#sos').textContent), 'a copy that isn’t connected says it can’t tell the office');
  ok(!P.$('[data-act="sos:send"]') && P.$$('#sos a[href^="tel:"]').some((a) => /5125550199/.test(a.getAttribute('href'))), 'and offers the office’s numbers to call instead');
  ok(/If the link does not open your phone, dial 911 yourself/.test(P.$('#sos').textContent), 'it says to dial 911 yourself if the link does nothing');
  P.click('[data-act="sos:cancel"]'); await sleep(10);
  ok(P.$('#sos').hidden, 'Cancel closes it');

  /* ---------- a chat message dressed up as an alert can't put markup on the office's screen ---------- */
  const evil = '"><img id="pwn" src=x onerror="window.__pwned=1">';
  const dbX = seed({ alerts: [alert('sx9', { upd: evil, loc: { lat: 30.2, lng: -97.7, acc: 5, ts: evil } }), alert('sx8', { ts: evil, truck: 'Box 2 (16 ft)' })] });
  dbX.docs.push(row('chat/ax1', { id: 'ax1', t: 'office', from: 'Dee', text: 'Got it', ts: evil, k: 'sosack', ref: 'sx9' }));
  dbX.docs.push(row('chat/ax2', { id: 'ax2', t: 'office', from: '<b>Kim</b>', text: 'Got it', ts: Date.now(), k: 'sosack', ref: 'sx9' }));
  const X = await load(HOSTED, { db: dbX, org: ORG, me: as('u-owner'), setup: phone() });
  all.push(X);
  await sleep(50);
  ok(!X.$('#pwn') && !X.w.__pwned && !X.$('#sos img'), 'text where a number belongs never becomes part of the page');
  ok(!X.$('#sos').hidden && X.$$('#sos .sos-card').length === 1 && /Box 1 \(26 ft\) is down/.test(X.$('#sos').textContent), 'the alert shows; one with a made-up time does not');
  ok(/<b>Kim<\/b> got it/.test(X.$('#sos').textContent) && !/Dee got it/.test(X.$('#sos').textContent), 'names show as plain text, and an answer with a made-up time is ignored');
  X.click('[data-act="sos:hide"]'); await sleep(20);
  ok(!X.$('#sosBar img') && /Box 1 \(26 ft\) is down/.test(X.$('#sosBar').textContent), 'the red bar is safe too');

  /* ---------- an alert older than the newest 400 chat messages still reaches the office ---------- */
  const dbZ = seed({ alerts: [alert('sx1', { ts: Date.now() - 2 * 3600e3, upd: Date.now() - 3600e3 })] });
  for (let i = 0; i < 410; i++) dbZ.docs.push(row('chat/m' + i, { id: 'm' + i, t: 'all', from: 'Dee', text: 'msg ' + i, ts: Date.now() - i * 1000, k: 'text' }));
  const Z = await load(HOSTED, { db: dbZ, org: ORG, me: as('u-owner'), setup: phone() });
  all.push(Z);
  ok(Z.T.chat.msgs.length === 400 && !Z.T.chat.msgs.some((m) => m.id === 'sx1'), 'a busy day pushes the alert out of the chat list');
  ok(!Z.$('#sos').hidden && /Box 1 \(26 ft\) is down/.test(Z.$('#sos').textContent), 'but the office still sees it');

  /* ---------- a dropped connection doesn't strand the crew ---------- */
  const dbY = seed();
  const Y = await load(HOSTED, { db: dbY, org: ORG, me: as('u-marcus'), setup: phone(), fnReply: sosReply({ ok: true, sent: 2, names: ['Owner', 'Dispatch'] }) });
  all.push(Y);
  Y.click(Y.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  Y.click('[data-act="sos:send"]'); await sleep(80);
  const yid = dbY.docs.find((d) => d.collection === 'chat' && d.data.k === 'sos').data.id;
  dbY.__failSelect = () => true;
  await Y.w.__sb.from('docs').upsert(row('chat/zz', { id: 'zz', t: 'all', from: 'Dee', text: 'hi', ts: Date.now(), k: 'text' })); await sleep(400);
  delete dbY.__failSelect;
  ok(Y.T.chat.mode === 'shared' && !!Y.T.chat.db, 'one failed chat fetch keeps Tally connected');
  Y.click('#sos [data-act="sos:end"]'); await sleep(10); Y.click('#sos [data-act="sos:end"]'); await sleep(100);
  ok(dbY.docs.find((d) => d.path === 'chat/' + yid).data.end && Y.w.__geo.cleared.length === 1, 'and Running again still ends the alert and stops the location');
  // a location that can't be saved isn't reported as shared
  const dbY2 = seed();
  const Y2 = await load(HOSTED, { db: dbY2, org: ORG, me: as('u-marcus'), setup: phone(), fnReply: sosReply({ ok: true, sent: 2, names: ['Owner', 'Dispatch'] }) });
  all.push(Y2);
  Y2.click(Y2.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  Y2.click('[data-act="sos:send"]'); await sleep(80);
  dbY2.__docPatchFail = true;
  Y2.w.__geo.watches[0].ok(fix(30.26715, -97.74306, 10)); await sleep(80);
  ok(/Your location didn’t go out just now/.test(Y2.$('#sos').textContent) && !/Sharing where you are/.test(Y2.$('#sos').textContent), 'a location that did not save is not shown as shared');
  delete dbY2.__docPatchFail;
  Y2.T.sos.sentAt = Date.now() - 121000;
  Y2.w.__geo.watches[0].ok(fix(30.26715, -97.74306, 10)); await sleep(80);
  ok(/Sharing where you are · updated just now/.test(Y2.$('#sos').textContent), 'and once it saves, it is');

  /* ---------- someone else signs in on the phone Marcus used ---------- */
  const S2 = await load(HOSTED, { db: seed({ alerts: [clone(savedAlert)] }), org: ORG, me: as('u-dee'), setup: phone({ storage: savedState }) });
  all.push(S2);
  ok(S2.w.__geo.watches.length === 0 && S2.T.state().ui.sosOwn === null && S2.T.sos.id === '', 'their location is not put on his alert');

  /* ---------- texts that fail can be tried again, and say what really happened ---------- */
  let tries = 0;
  const dbT = seed();
  const TT = await load(HOSTED, { db: dbT, org: ORG, me: as('u-marcus'), setup: phone({ noGeo: true }),
    fnReply: (b) => b.action !== 'sos' ? { ok: true, sent: 0 } : (++tries === 1 ? { ok: false, reason: 'failed', message: 'The texts did not go out.' } : tries === 2 ? { ok: true, pending: true } : { ok: true, sent: 2, names: ['Owner', 'Dispatch'] }) });
  all.push(TT);
  TT.click(TT.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  TT.click('[data-act="sos:send"]'); await sleep(100);
  ok(/The texts did not go out\. Call the office\./.test(TT.$('#sos').textContent) && !/Texted/.test(TT.$('#sos').textContent), 'texts that failed say so');
  TT.click('[data-act="sos:texts"]'); await sleep(60);
  ok(/Texting the office…/.test(TT.$('#sos').textContent), 'trying again while another request is sending them waits for it');
  const sid = dbT.docs.find((d) => d.collection === 'chat' && d.data.k === 'sos').data.id;
  TT.T.sos.texts[sid].st = 'wait'; await new Promise((r) => { const t0 = Date.now(); (function poll() { if (/Texted Owner/.test(TT.$('#sos').textContent) || Date.now() - t0 > 6000) r(); else setTimeout(poll, 100); })(); });
  ok(/Texted Owner and Dispatch\./.test(TT.$('#sos').textContent) && tries === 3, 'and then shows who was texted');

  /* ---------- closing the form while it sends, then it fails ---------- */
  const dbQ = seed();
  dbQ.__failUpsert = (table, p) => table === 'docs' && p.collection === 'chat' ? 120 : false;
  const Q = await load(HOSTED, { db: dbQ, org: ORG, me: as('u-marcus'), setup: phone() });
  all.push(Q);
  Q.click(Q.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  Q.click('[data-act="sos:send"]'); await sleep(10);
  Q.click('[data-act="sos:cancel"]'); await sleep(250);
  ok(/The truck-down alert did not go out/.test(Q.$('#toast').textContent) && Q.$('#sos').hidden, 'closing the form while it sends still tells them if it failed');

  /* ---------- Got it that didn't save is not shown as sent ---------- */
  const dbAk = seed({ alerts: [alert('sx1')] });
  dbAk.__failUpsert = (table, p) => table === 'docs' && p.collection === 'chat' ? 60 : false;
  const AK = await load(HOSTED, { db: dbAk, org: ORG, me: as('u-dispatch'), setup: phone() });
  all.push(AK);
  const akBtn = () => AK.$('#sos [data-act="sos:ack"]');
  AK.click(akBtn()); await sleep(10);
  ok(akBtn() && akBtn().disabled && /Sending…/.test(akBtn().textContent), 'Got it shows it is on its way');
  await sleep(150);
  ok(!/can see you got it/.test(AK.$('#sos').textContent) && akBtn() && !akBtn().disabled && /“Got it” did not go out/.test(AK.$('#toast').textContent),
    'a Got it that did not save is not shown as sent, and can be tapped again');
  ok(AK.T.sos.ringT !== null, 'and the chime keeps going, since nobody has answered');
  delete dbAk.__failUpsert;
  AK.click(akBtn()); await sleep(100);
  ok(/Marcus can see you got it/.test(AK.$('#sos').textContent) && dbAk.docs.some((d) => d.collection === 'chat' && d.data.k === 'sosack' && d.data.from === 'Dispatch'), 'trying again sends it');
  AK.T.chat.mode = 'local'; AK.T.chat.db = null;
  AK.click('#sos [data-act="sos:end"]'); await sleep(10);
  ok(/Tally isn’t connected right now/.test(AK.$('#toast').textContent), 'with no connection, the buttons say so instead of doing nothing');

  /* ---------- chat that didn't load at first comes back ---------- */
  const dbCF = seed();
  dbCF.__failSelect = (table, asked) => table === 'docs' && asked.some((x) => x[0] === 'collection' && x[1] === 'chat');
  const CF = await load(HOSTED, { db: dbCF, org: ORG, me: as('u-marcus'), setup: phone(), fnReply: sosReply({ ok: true, sent: 2, names: ['Owner', 'Dispatch'] }) });
  all.push(CF);
  ok(CF.T.chat.mode === 'local' && !CF.T.chat.db, 'a first chat fetch that fails leaves chat on this phone');
  delete dbCF.__failSelect;
  CF.T.sosRefresh(); await sleep(80);
  ok(CF.T.chat.mode === 'shared' && !!CF.T.chat.db, 'the next check that works connects it again');
  CF.click(CF.$$('#view [data-act="sos:open"]').find((b) => /Truck down/.test(b.textContent))); await sleep(20);
  CF.click('[data-act="sos:send"]'); await sleep(80);
  ok(dbCF.docs.some((d) => d.collection === 'chat' && d.data.k === 'sos' && d.data.from === 'Marcus'), 'and a truck-down alert goes out');
  // the same through a change coming in
  const dbCG = seed();
  dbCG.__failSelect = (table, asked) => table === 'docs' && asked.some((x) => x[0] === 'collection' && x[1] === 'chat');
  const CG = await load(HOSTED, { db: dbCG, org: ORG, me: as('u-owner'), setup: phone() });
  all.push(CG);
  delete dbCG.__failSelect;
  await CG.w.__sb.from('docs').upsert(row('chat/sx5', alert('sx5', { ts: Date.now(), upd: Date.now() }))); await sleep(400);
  ok(CG.T.chat.mode === 'shared' && !CG.$('#sos').hidden && /Box 1 \(26 ft\) is down/.test(CG.$('#sos').textContent), 'or when the next change comes in, and the office sees the alert');

  /* ---------- the all-clear asked for while the alert's texts are still going out ---------- */
  let ends = 0;
  const dbAC = seed({ alerts: [alert('sx3', { from: 'Marcus' })] });
  const AC = await load(HOSTED, { db: dbAC, org: ORG, me: as('u-owner'), setup: phone(),
    fnReply: (b) => b.action === 'sos' && b.kind === 'end' ? (++ends === 1 ? { ok: true, sent: 0, skipped: 'start-in-progress' } : { ok: true, sent: 1 }) : { ok: true, sent: 0 } });
  all.push(AC);
  AC.T.sos.clearMs = 60;
  AC.click('#sos [data-act="sos:end"][data-id="sx3"]'); await sleep(10); AC.click('#sos [data-act="sos:end"][data-id="sx3"]'); await sleep(250);
  ok(ends === 2 && /The office was texted that it’s sorted/.test(AC.$('#toast').textContent), 'an all-clear asked for while the alert’s texts are still going out is asked for again');

  /* ---------- an all-clear that couldn't reach the server is tried again, even after Tally reopens ---------- */
  let ends2 = 0, ends3 = 0;
  const dbAD = seed({ alerts: [alert('sx4')] });
  const AD = await load(HOSTED, { db: dbAD, org: ORG, me: as('u-owner'), setup: phone(),
    fnReply: (b) => b.action === 'sos' && b.kind === 'end' ? (++ends2, { ok: false, message: 'Could not reach the server. Check your connection.' }) : { ok: true, sent: 0 } });
  all.push(AD);
  AD.click('#sos [data-act="sos:end"][data-id="sx4"]'); await sleep(10); AD.click('#sos [data-act="sos:end"][data-id="sx4"]'); await sleep(400);
  const q4 = (AD.T.state().ui.sosClearQ || {}).sx4;
  ok(ends2 === 1 && q4 && q4.tries === 1, 'an all-clear that could not reach the server is kept to try again');
  const st4 = JSON.parse(AD.w.localStorage.getItem(KEY));
  ok(st4.ui.sosClearQ && st4.ui.sosClearQ.sx4, 'and the phone keeps it if Tally closes');
  st4.ui.sosClearQ.sx4.at = Date.now() - 1000;   // reopened later
  const AE = await load(HOSTED, { db: dbAD, org: ORG, me: as('u-owner'), setup: phone({ storage: JSON.stringify(st4) }),
    fnReply: (b) => b.action === 'sos' && b.kind === 'end' ? (++ends3, { ok: true, sent: 2 }) : { ok: true, sent: 0 } });
  all.push(AE);
  await sleep(100);
  ok(ends3 === 1 && !(AE.T.state().ui.sosClearQ || {}).sx4 && /The office was texted that it’s sorted/.test(AE.$('#toast').textContent), 'reopened, Tally asks again and the all-clear goes');

  /* ---------- an own-alert record without a name, then someone else signs in ---------- */
  const oldState = JSON.parse(savedState); delete oldState.ui.sosOwn.from;
  const S3 = await load(HOSTED, { db: seed({ alerts: [clone(savedAlert)] }), org: ORG, me: as('u-dee'), setup: phone({ storage: JSON.stringify(oldState) }) });
  all.push(S3);
  ok(S3.w.__geo.watches.length === 0 && S3.T.state().ui.sosOwn === null, 'a record that doesn’t say whose it is goes by who sent the alert');

  const errs = all.reduce((a, x) => a.concat(x.errors), []);
  ok(errs.length === 0, 'no errors (' + errs.slice(0, 3).join(' | ') + ')');
  process.exit(summary('truck down') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
