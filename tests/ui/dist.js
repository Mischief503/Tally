const { load, ok, sleep, summary } = require('./lib');
const ORG = 'org-1';
function seed() {
  const docs = [], put = (path, data) => { const [c, id] = path.split('/'); docs.push({ org_id: ORG, path, collection: c, doc_id: id, data, updated_at: 'x' }); };
  put('meta/init', { ts: 1 });
  put('org/settings', { company: 'Ace Moving', crew: ['Marcus'], leads: ['Marcus'], office: [{ name: 'Owner', kind: 'owner' }], contacts: {}, forms: [] });
  return { docs, access_requests: [], comm_log: [], comm_lines: [], members: [{ org_id: ORG, user_id: 'u-owner', email: 'o@x', staff: 'Owner', role: 'owner', ts: 1 }] };
}
const type = (P, sel, v, blur) => { const e = P.$(sel); e.value = v; e.dispatchEvent(new P.w.Event('input', { bubbles: true })); if (blur) e.dispatchEvent(new P.w.Event('change', { bubbles: true })); };
(async () => {
  // ---- on-device: no lookup service, offer the map
  const A = await load(__dirname + '/../../build/tally-artifact.html', {});
  A.click('#fab'); await sleep(15);
  ok(/Enter both addresses, then check the drive on Google Maps/.test(A.$('#distNote').textContent), 'artifact: note says to check the map');
  type(A, '[data-d="from"]', '418 Oak St, Austin', true); type(A, '[data-d="to"]', '77 Ridge Rd, Round Rock', true); await sleep(10);
  const ml = A.$('#distNote a');
  ok(ml && ml.getAttribute('href') === 'https://www.google.com/maps/dir/?api=1&origin=418%20Oak%20St%2C%20Austin&destination=77%20Ridge%20Rd%2C%20Round%20Rock&travelmode=driving' && ml.target === '_blank', 'artifact: a Google Maps directions link for those two addresses');
  ok(A.$('[data-d="miles"]').value === '', 'artifact: miles left for you to type');

  // ---- hosted with the lookup
  let calls = 0, mode = 'ok';
  const reply = (b) => { if (b.action !== 'distance') return { ok: true }; calls++;
    if (mode === 'setup') return { ok: false, setup: true, message: 'Distance lookup is not set up yet.' };
    if (mode === 'bad') return { ok: false, message: 'Google Maps could not find one of those addresses.' };
    return /Dallas/.test(b.to) ? { ok: true, src: 'google', miles: 195.3, minutes: 181 } : { ok: true, src: 'google', miles: 22.4, minutes: 31 }; };
  const B = await load(__dirname + '/../../build/tally-supabase.html', { db: seed(), org: ORG, me: { uid: 'u-owner', email: 'o@x' }, fnReply: reply });
  B.click('#fab'); await sleep(15);
  ok(/fills itself in/.test(B.$('#distNote').textContent), 'hosted: note says the distance fills itself in');
  type(B, '[data-d="from"]', '418 Oak St, Austin', true); await sleep(30);
  ok(calls === 0, 'one address: no lookup yet');
  type(B, '[data-d="to"]', '77 Ridge Rd, Round Rock', true); await sleep(60);
  const fc = B.calls.fn.find((c) => c.body.action === 'distance');
  ok(calls === 1 && fc.body.from === '418 Oak St, Austin' && fc.body.to === '77 Ridge Rd, Round Rock' && fc.init.headers.Authorization === 'Bearer tok-u-owner', 'hosted: leaving the second address looks up the drive');
  ok(B.$('[data-d="miles"]').value === '22.4' && B.T.state().draft.miles === '22.4', 'miles filled in: 22.4');
  ok(/Driving distance: 22\.4 mi, about 31m by car/.test(B.$('#distNote').textContent), 'note: ' + B.$('#distNote').textContent);
  ok(/Distances from Google Maps/.test(B.$('#distNote').textContent) && !/OpenStreetMap/.test(B.$('#distNote').textContent), 'an answer through Supabase says it came from Google Maps');
  // price uses it
  B.T.state().draft.items = { sofa3: 2, boxm: 20 }; B.T.state().draft.miles = '22.4';
  // change delivery: auto-filled miles follow
  type(B, '[data-d="to"]', '9 Main St, Dallas', true); await sleep(60);
  ok(B.$('[data-d="miles"]').value === '195.3', 'new delivery address: miles follow (195.3)');
  type(B, '[data-d="to"]', '77 Ridge Rd, Round Rock', true); await sleep(60);
  ok(calls === 2 && B.$('[data-d="miles"]').value === '22.4', 'going back to an address already looked up uses the saved answer');
  // typed miles are yours
  type(B, '[data-d="miles"]', '30'); await sleep(5);
  type(B, '[data-d="to"]', '9 Main St, Dallas', true); await sleep(60);
  ok(B.$('[data-d="miles"]').value === '30' && /Google Maps says 195\.3 mi/.test(B.$('#distNote').textContent), 'miles you typed are not overwritten; the note offers the looked-up number');
  B.click('[data-act="q:usedist"]'); await sleep(10);
  ok(B.$('[data-d="miles"]').value === '195.3' && B.T.state().draft.milesAuto === true, 'Use 195.3 mi puts it in');
  type(B, '[data-d="miles"]', '50'); await sleep(5);
  const lb = B.$('#distNote [data-act="q:usedist"]');
  ok(!!lb, 'typed miles: the note offers the looked-up number');
  type(B, '[data-d="to"]', '77 Ridge Rd, Round Rock', true); await sleep(60);
  const ub = B.$('#distNote [data-act="q:usedist"]');
  ok(ub && /Use 22\.4 mi/.test(ub.textContent) && B.$('[data-d="miles"]').value === '50', 'typed 50: the note offers Use 22.4 mi; typed miles untouched until pressed');
  B.click(ub); await sleep(30);
  ok(B.$('[data-d="miles"]').value === '22.4', 'pressing it puts the distance in');
  const again = B.$('#distNote [data-act="q:dist"]');
  ok(again && /Look up again/.test(again.textContent), 'and offers Look up again');
  const c0 = calls; B.click(again); await sleep(60);
  ok(calls === c0 + 1 && B.$('[data-d="miles"]').value === '22.4', 'Look up again asks Google fresh');
  B.T.state().draft.from = ''; B.click('[data-act="q:step"][data-s="2"]'); await sleep(5); B.click('[data-act="q:step"][data-s="1"]'); await sleep(20);
  B.click('#distNote [data-act="q:dist"]'); await sleep(10);
  ok(/Enter the pickup and delivery addresses first/.test(B.$('#toast').textContent), 'button with an address missing says what to do');
  type(B, '[data-d="from"]', '418 Oak St, Austin', true); await sleep(60);
  // re-render of the step keeps the note
  B.click('[data-act="q:step"][data-s="2"]'); await sleep(10); B.click('[data-act="q:step"][data-s="1"]'); await sleep(30);
  ok(/Driving distance: 22\.4 mi/.test(B.$('#distNote').textContent), 'note survives moving between steps');
  // not set up / bad address
  mode = 'bad'; type(B, '[data-d="to"]', 'zzzz', true); await sleep(60);
  ok(/could not find one of those addresses\. Type the miles instead\./.test(B.$('#distNote').textContent) && !!B.$('#distNote a'), 'bad address: says so and links the map');
  mode = 'setup'; type(B, '[data-d="to"]', '12 Lakeview Dr', true); await sleep(3500);
  ok(/map service didn.t answer|Couldn.t find/.test(B.$('#distNote').textContent), 'no Google key yet: it tries OpenStreetMap instead (unreachable in this test)');
  ok(A.errors.length === 0 && B.errors.length === 0, 'no errors (' + A.errors.concat(B.errors).slice(0, 3).join(' | ') + ')');
  process.exit(summary('distance') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
