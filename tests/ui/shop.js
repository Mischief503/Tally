// Shop address: drive from the shop to pickup and from delivery back, logged and priced.
const { load, ok, sleep, summary } = require('./lib');
const ORG = 'org-1';
const SHOP = '1200 Industrial Blvd, Austin', A = '418 Oak St, Austin', B = '77 Ridge Rd, Round Rock';
function seed() {
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  put('meta/init', { ts: 1 });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }], contacts: {}, forms: [] });
  return { docs, access_requests: [], comm_log: [], comm_lines: [], members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }] };
}
const MI = { [SHOP + '|' + A]: [12.3, 22], [A + '|' + B]: [22.4, 31], [B + '|' + SHOP]: [18.1, 25] };
const type = (P, sel, v, blur) => { const e = P.$(sel); e.value = v; e.dispatchEvent(new P.w.Event('input', { bubbles: true })); if (blur) e.dispatchEvent(new P.w.Event('change', { bubbles: true })); };
(async () => {
  let calls = [];
  const reply = (b) => { if (b.action !== 'distance') return { ok: true }; calls.push(b.from + '|' + b.to); const m = MI[b.from + '|' + b.to]; return m ? { ok: true, miles: m[0], minutes: m[1] } : { ok: false, message: 'Google Maps could not find one of those addresses.' }; };
  const B1 = await load(__dirname + '/../../build/tally-supabase.html', { db: seed(), org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: reply });
  const P = B1;
  // no shop yet: quote is as before
  P.click('#fab'); await sleep(15);
  ok(!P.$('[data-d="milesOut"]') && /Distance \(miles\)/.test(P.$('#view').textContent), 'no shop address: just the one distance field, as before');
  // set the shop in Setup
  P.click('[data-act="more:open"]'); await sleep(5); P.click('[data-act="more:go"][data-tab="settings"]'); await sleep(20);
  const sa = P.$('input[data-s="shopAddress"]');
  ok(!!sa && /Shop address \(where trucks start and end the day\)/.test(P.$('#view').textContent), 'Setup › Company has a shop address');
  type(P, 'input[data-s="shopAddress"]', SHOP); await sleep(5);
  ok(P.T.state().settings.shopAddress === SHOP, 'shop address saved');
  ok(P.$('input[data-s="shopTravel"]').checked, 'counting the drive from and back is on by default');
  await sleep(400);
  const sw = P.calls.writes.filter((x) => x.row.path === 'org/settings').pop();
  ok(sw && sw.row.data.shopAddress === SHOP, 'shop address reaches the database, so every phone uses it');
  // quote with the three legs
  P.click('#fab'); await sleep(15);
  ok(!!P.$('[data-d="milesOut"]') && !!P.$('[data-d="milesBack"]') && /Pickup to delivery \(miles\)/.test(P.$('#view').textContent), 'with a shop: from-the-shop and back-to-the-shop fields appear');
  calls = [];
  type(P, '[data-d="from"]', A, true); await sleep(60);
  type(P, '[data-d="to"]', B, true); await sleep(80);
  ok(calls.indexOf(SHOP + '|' + A) >= 0 && calls.indexOf(A + '|' + B) >= 0 && calls.indexOf(B + '|' + SHOP) >= 0, 'all three drives looked up: ' + calls.join(' ; '));
  ok(P.$('[data-d="milesOut"]').value === '12.3' && P.$('[data-d="miles"]').value === '22.4' && P.$('[data-d="milesBack"]').value === '18.1', 'filled in: 12.3 out, 22.4 move, 18.1 back');
  const note = P.$('#shopNote').textContent;
  ok(/From the shop to pickup: 12\.3 mi, about 22m by car/.test(note) && /Delivery back to the shop: 18\.1 mi, about 25m by car/.test(note) && /Round trip from the shop: 52\.8 mi/.test(note), 'note: ' + note);
  // price
  const d = P.T.state().draft; d.items = { sofa3: 2, boxm: 20 };
  P.click('[data-act="q:step"][data-s="3"]'); await sleep(20);
  const lines = P.$('#qLines').textContent;
  // pickup 12.3 and delivery 18.1 mi from the shop: both inside the 20-mile radius, so a local move,
  // by the hour with the whole 52.8 mi drive in the hours (170 cu ft / 90 + 52.8 / 30 = 3.65, so 4 h), no mileage
  ok(/2 movers, 4 hr at \$140\/hr\$560/.test(lines) && !/Mileage|Travel/.test(lines), 'local move: the drive from the shop and back is in the hours, no mileage line: ' + lines);
  ok(/^Local move: by the hour with the drive included, no mileage\. The pickup is 12\.3 mi and the delivery is 18\.1 mi from the shop, inside your 20-mile radius\.$/.test(P.$('#kindNote').textContent), 'the price says why it is local: ' + P.$('#kindNote').textContent);
  P.click('[data-act="q:step"][data-s="1"]'); await sleep(20);
  ok(/Round trip from the shop: 52\.8 mi/.test(P.$('#shopNote').textContent), 'note survives moving between steps');
  // a leg typed by hand is kept
  type(P, '[data-d="milesOut"]', '15'); await sleep(5);
  ok(/Google Maps says 12\.3 mi/.test(P.$('#shopNote').textContent) && !!P.$('[data-act="q:useshop"][data-k="out"]'), 'typed 15: note offers Use 12.3 mi');
  type(P, '[data-d="from"]', A, true); await sleep(60);
  ok(P.$('[data-d="milesOut"]').value === '15', 'leaving an address field does not overwrite a typed leg');
  P.click('[data-act="q:useshop"][data-k="out"]'); await sleep(20);
  ok(P.$('[data-d="milesOut"]').value === '12.3', 'Use puts Google\'s number back');
  // the switch
  P.click('[data-act="more:open"]'); await sleep(5); P.click('[data-act="more:go"][data-tab="settings"]'); await sleep(20);
  const st = P.$('input[data-s="shopTravel"]'); st.checked = false; st.dispatchEvent(new P.w.Event('input', { bubbles: true })); await sleep(5);
  P.click('#fab'); await sleep(15); P.click('[data-act="q:step"][data-s="3"]'); await sleep(20);
  ok(/2 movers, 3 hr at \$140\/hr\$420/.test(P.$('#qLines').textContent) && !/Mileage/.test(P.$('#qLines').textContent), 'switched off: only the pickup-to-delivery drive is in the hours (1.89 + 0.75 → 3 h): ' + P.$('#qLines').textContent);
  ok(/inside your 20-mile radius/.test(P.$('#kindNote').textContent), 'still local: the radius is measured from the shop either way');
  P.click('[data-act="q:step"][data-s="1"]'); await sleep(20);
  ok(/not counted in the price/.test(P.$('#shopNote').textContent), 'and the note says the round trip is logged but not counted');
  st.checked = true;
  P.T.state().settings.shopTravel = true;
  // book it: the job keeps the legs and shows the round trip
  P.T.state().draft.name = 'Priya Nair';
  P.click('[data-act="q:step"][data-s="3"]'); await sleep(10);
  P.click('[data-act="q:book"]'); await sleep(40);
  const j = P.T.state().jobs.find((x) => x.d.name === 'Priya Nair');
  ok(j && j.d.milesOut === '12.3' && j.d.milesBack === '18.1', 'booked job keeps the shop legs');
  ok(/Round trip from the shop: 52\.8 mi \(12\.3 to pickup, 22\.4 to delivery, 18\.1 back\)/.test(P.$('#sheet').textContent), 'job sheet shows the round trip');
  await sleep(400);
  const jw = P.calls.writes.filter((x) => x.row.path === 'jobs/' + j.id).pop();
  ok(jw && jw.row.data.d.milesOut === '12.3', 'legs sync with the job');

  // ---- artifact: whole-trip map link
  const A2 = await load(__dirname + '/../../build/tally-artifact.html', {});
  A2.T.state().settings.shopAddress = SHOP;
  A2.click('#fab'); await sleep(15);
  type(A2, '[data-d="from"]', A, true); type(A2, '[data-d="to"]', B, true); await sleep(20);
  const link = A2.$('#shopNote a');
  ok(link && link.getAttribute('href') === 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(SHOP) + '&destination=' + encodeURIComponent(SHOP) + '&waypoints=' + encodeURIComponent(A + '|' + B) + '&travelmode=driving', 'artifact: one Google Maps link for the whole trip, shop to shop');
  ok(P.errors.length === 0 && A2.errors.length === 0, 'no errors (' + P.errors.concat(A2.errors).slice(0, 3).join(' | ') + ')');
  process.exit(summary('shop') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
