// A mileage move's miles back to the shop at bill-out, from the phone's location: Google through the
// Edge Function, OpenStreetMap when Google isn't set up, the quote's miles when neither answers or the
// phone won't share where it is. A number the lead typed stays unless they ask to look it up again.
const { load, ok, sleep, summary } = require('./lib');
const FILE = __dirname + '/../../build/tally-supabase.html', H = 36e5;
const SHOP = '1200 Industrial Blvd, Austin, TX';
const HERE = { lat: 30.2672, lng: -97.7431 };

// the phone's location: shared, blocked, or none at all
const geo = { mode: 'ok', asked: 0 };
const withGeo = (w) => Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: {
  getCurrentPosition(okf, errf) { geo.asked++; setTimeout(() => geo.mode === 'ok' ? okf({ coords: { latitude: HERE.lat, longitude: HERE.lng, accuracy: 8 } }) : errf({ code: geo.mode === 'deny' ? 1 : 2 }), 5); },
  watchPosition() { return 1; }, clearWatch() {},
} });
// OpenStreetMap: the shop's place (Nominatim) and the drive from the phone to it (OSRM)
const net = { osrm: 'ok', calls: [], delay: 0 };
const fakeNet = async (url) => {
  net.calls.push(url);
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (/nominatim\.openstreetmap\.org/.test(url)) return res(200, [{ lat: '30.3101', lon: '-97.6522' }]);
  if (/photon\.komoot\.io/.test(url)) return res(200, { features: [] });
  if (net.delay) await new Promise((r) => setTimeout(r, net.delay));
  if (/router\.project-osrm\.org/.test(url)) return net.osrm === 'ok' ? res(200, { code: 'Ok', routes: [{ distance: 29612, duration: 1500 }] }) : res(503, {});
  throw new Error('unexpected ' + url);
};

(async () => {
  /* ---------------- on its own (no company database): OpenStreetMap ---------------- */
  const A = await load(FILE, { net: fakeNet, setup: withGeo });
  const { w, $, $$, click, T } = A;
  const st = () => T.state(), S = st().settings;
  const flow = () => $('#flow').hidden ? '' : $('#flow').textContent.replace(/\s+/g, ' ');
  const src = () => ($('#backSrc') || { textContent: '' }).textContent.replace(/\s+/g, ' ');
  const bb = () => $('#backBill').textContent.replace(/\s+/g, ' ');
  const type = (P, sel, v, blur) => { const e = P.$(sel); e.value = v; e.dispatchEvent(new P.w.Event('input', { bubbles: true })); if (blur) e.dispatchEvent(new P.w.Event('change', { bubbles: true })); };
  S.shopAddress = SHOP; S.nteCap = false; st().ui.me = 'Marcus';
  const mileage = (name) => {
    const j = st().jobs.find((x) => x.d.name === name);
    Object.assign(j.d, { milesOut: '10', miles: '90', milesBack: '25', items: { boxm: 60 }, flights: '', moveKind: '' });
    j.quote = T.calc(j.d, S); j.extras = []; j.payments = []; j.materials = []; j.costs = []; delete j.back; delete j.clockAt; delete j.milesDriven;
    const t0 = Date.now() - 12 * H;
    Object.assign(j, { status: 'active', startedAt: t0, phases: { loadStart: t0 + 0.5 * H, loadEnd: t0 + 1.5 * H, unloadStart: t0 + 5 * H, unloadEnd: t0 + 6.5 * H }, odo: { start: 45210, by: 'Marcus', ts: t0 } });
    j.signed = [{ id: 's-' + j.id, formId: 'f_deliv', title: 'Delivery receipt and release', name: name, sig: '', ts: Date.now(), by: 'Marcus' }];
    j.assign = { truckId: 't26', crew: ['Marcus'] };
    return j;
  };
  const J1 = mileage('Ortega family');
  ok(J1.quote.kind === 'mileage' && J1.quote.shopTravel && !w.tallyMaps, 'on its own: a mileage move counting the shop drive, and no company database');
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:go"][data-tab="crew"]'); await sleep(15);
  click('[data-act="cr:finish"][data-id="' + J1.id + '"]'); await sleep(20);
  ok(/Miles for the bill/.test(flow()) && geo.asked === 1 && /Finding where the truck is|Looking up the drive from here|From here to the shop/.test(src()), 'bill-out asks the phone where it is and looks up the drive at once (' + src() + ')');
  await sleep(1600);
  ok(net.calls.some((u) => /nominatim.*q=1200%20Industrial/.test(u)) && net.calls.some((u) => /route\/v1\/driving\/-97\.7431,30\.2672;-97\.6522,30\.3101/.test(u)), 'OpenStreetMap: the shop’s place, then the drive from the phone to it');
  ok($('#backMi').value === '18.4' && /From here to the shop: 18\.4 mi \(OpenStreetMap\)\./.test(src()), 'the miles back fill in: 18.4 mi from here (OpenStreetMap): ' + src());
  type(A, '#odoB', '45311'); await sleep(5);
  ok(/Back to the shop \(from the phone’s location\) ?18\.4 mi/.test(bb()) && /Miles on the bill ?119\.4 mi/.test(bb()), '101 on the odometer + 18.4 back = 119.4 mi: ' + bb());
  click('[data-act="back:ok"]'); await sleep(20);
  ok(J1.back && J1.back.src === 'gps' && J1.back.mi === 18.4 && J1.milesDriven === 119.4 && J1.log.some((l) => l.ev === 'Odometer 45,210 to 45,311: 101 mi, plus 18.4 mi back to the shop (from the phone’s location): 119.4 mi in all (Marcus)'), 'saved as from the phone’s location');
  click('#flow [data-act="flow:close"]'); await sleep(10);
  click('[data-act="tab"][data-tab="jobs"]'); await sleep(10);
  click('[data-act="job:open"][data-id="' + J1.id + '"]'); await sleep(15);
  ok(/plus 18\.4 mi back to the shop by GPS; Marcus at bill-out/.test($('#sheet').textContent), 'the job sheet says it came by GPS');
  click('[data-act="sheet:close"]'); await sleep(5);

  // typed before the lookup came back: kept, with the map's number offered
  const J2 = mileage('Hollis & Reed Law'); geo.asked = 0;
  click('[data-act="more:open"]'); await sleep(5); click('[data-act="more:go"][data-tab="crew"]'); await sleep(15);
  net.delay = 250;   // the map takes a moment: the lead types first
  click('[data-act="cr:finish"][data-id="' + J2.id + '"]'); await sleep(10);
  ok(/Looking up the drive from here|Finding where the truck is/.test(src()), 'while it looks, it says so');
  type(A, '#backMi', '22'); await sleep(600);
  net.delay = 0;
  ok($('#backMi').value === '22' && /You typed this\. From here the map says 18\.4 mi/.test(src()), 'typed 22 mi while it looked: the 22 stays, and the map’s 18.4 is shown: ' + src());
  click('[data-act="back:gps"]'); await sleep(400);
  ok($('#backMi').value === '18.4' && /From here to the shop: 18\.4 mi/.test(src()), 'Look up again uses the map’s number');
  click('#flow [data-act="flow:close"]'); await sleep(5);

  // the phone won't share where it is: the quote's miles, and it says why
  geo.mode = 'deny';
  click('[data-act="cr:finish"][data-id="' + J2.id + '"]'); await sleep(60);
  ok($('#backMi').value === '25' && /Location is blocked on this phone\. This is the quote’s 25 mi from the delivery to the shop; change it if the drive is different\./.test(src()) && !!$('[data-act="back:gps"]'), 'location blocked: the quote’s 25 mi, with why and a way to try again');
  click('#flow [data-act="flow:close"]'); await sleep(5);
  geo.mode = 'off';
  click('[data-act="cr:finish"][data-id="' + J2.id + '"]'); await sleep(60);
  ok(/The phone couldn’t tell where it is\. This is the quote’s 25 mi/.test(src()), 'no location fix: the same, worded for it');
  click('#flow [data-act="flow:close"]'); await sleep(5);
  // the map service is down
  geo.mode = 'ok'; net.osrm = 'down';
  click('[data-act="cr:finish"][data-id="' + J2.id + '"]'); await sleep(400);
  ok($('#backMi').value === '25' && /The map service didn’t answer\. This is the quote’s 25 mi/.test(src()), 'map service down: the quote’s 25 mi: ' + src());
  click('#flow [data-act="flow:close"]'); await sleep(5);
  net.osrm = 'ok';
  ok(A.errors.length === 0, 'on its own: no errors (' + A.errors.slice(0, 3).join(' | ') + ')');

  /* ---------------- the company's app: Google through the Edge Function ---------------- */
  const ORG = 'org-o', t0 = Date.now() - 12 * H;
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  put('meta/init', { ts: 1 });
  const settings = { company: 'Ace Moving', crew: ['Marcus', 'Dee'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }], contacts: {}, trucks: [{ id: 't26', name: 'Box 1', cf: 1700 }], forms: [], shopAddress: SHOP, nteCap: false };
  put('org/settings', settings);
  const d = { name: 'Long haul', phone: '', email: '', source: 'Google', moveDate: '', time: '08:00', from: 'A', to: 'B', miles: '90', milesOut: '10', milesBack: '25', flights: '', pack: false, crew: '', truckId: '', hoursOverride: '', discount: '', notes: '', custom: {}, items: [{ id: 'boxm', q: 60 }], moveKind: '' };
  const q = T.calc(Object.assign({}, d, { items: { boxm: 60 } }), Object.assign(JSON.parse(JSON.stringify(S)), settings));
  put('jobs/m1', { id: 'm1', status: 'active', createdAt: t0 - 864e5, startedAt: t0, phases: { loadStart: t0 + 0.5 * H, loadEnd: t0 + 1.5 * H, unloadStart: t0 + 5 * H, unloadEnd: t0 + 6.5 * H },
    odo: { start: 45210, by: 'Marcus', ts: t0 }, d, quote: q, items: [], assign: { truckId: 't26', crew: ['Marcus'] }, tally: {}, payments: {}, signed: {}, extras: {}, crewNotes: {}, photos: {}, materials: {}, costs: {}, log: {}, confirm: {} });
  const db = { docs, access_requests: [], comm_log: [], comm_lines: [],
    members: [{ org_id: ORG, user_id: 'u-o', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }, { org_id: ORG, user_id: 'u-m', email: 'm@x', staff: 'Marcus', role: 'lead', ts: 1 }] };
  let google = { ok: true, src: 'google', miles: 17.2, minutes: 22 };
  net.calls = [];
  const M = await load(FILE, { db, org: ORG, me: { uid: 'u-m', email: 'm@x' }, net: fakeNet, setup: withGeo, fnReply: (b) => b.action === 'shop_distance' ? google : { ok: true } });
  ok(M.T.state().jobs.some((x) => x.id === 'm1' && x.odo && x.odo.start === 45210), 'the odometer from Start job comes with the job');
  if (M.$('[data-act="tab"][data-tab="crew"]')) M.click('[data-act="tab"][data-tab="crew"]'); else { M.click('[data-act="more:open"]'); await sleep(5); M.click('[data-act="more:go"][data-tab="crew"]'); }
  await sleep(20);
  M.click('[data-act="cr:finish"][data-id="m1"]'); await sleep(200);
  const fc = M.calls.fn.filter((c) => c.body.action === 'shop_distance').pop();
  ok(fc && fc.body.lat === HERE.lat && fc.body.lng === HERE.lng && !('to' in fc.body) && !('shop' in fc.body), 'the lead’s phone asks the Edge Function with just where it is');
  const msrc = () => M.$('#backSrc').textContent.replace(/\s+/g, ' ');
  ok(M.$('#backMi').value === '17.2' && /From here to the shop: 17\.2 mi \(Google Maps\)\./.test(msrc()) && !net.calls.length, 'Google’s 17.2 mi fills in, and OpenStreetMap isn’t asked');
  type(M, '#odoB', '45311'); await sleep(5);
  M.click('[data-act="back:ok"]'); await sleep(500);
  const row = db.docs.find((r) => r.path === 'jobs/m1').data;
  ok(row.back && row.back.src === 'gps' && row.back.mi === 17.2 && row.back.odoStart === 45210 && row.back.odoEnd === 45311 && row.milesDriven === 118.2 && row.status === 'done', 'the readings, the 17.2 mi back and the finished job reach the database');
  M.click('#flow [data-act="flow:close"]'); await sleep(10);
  // Google not set up on the server: OpenStreetMap instead
  google = { ok: false, setup: true, message: 'Distance lookup is not set up yet.' };
  M.click('[data-act="back:open"][data-id="m1"]'); await sleep(20);
  M.click('[data-act="back:gps"]'); await sleep(1600);
  ok(M.$('#backMi').value === '18.4' && /\(OpenStreetMap\)/.test(msrc()) && net.calls.some((u) => /router\.project-osrm\.org/.test(u)), 'Google not set up on the server: OpenStreetMap answers instead');
  M.click('#flow [data-act="flow:close"]'); await sleep(5);
  ok(M.errors.length === 0, 'company app: no errors (' + M.errors.slice(0, 3).join(' | ') + ')');

  process.exit(summary('odometer') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
