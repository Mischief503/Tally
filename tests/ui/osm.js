// The free lookup, as it runs in the APK with nothing set up: OpenStreetMap finds the
// addresses (Nominatim, then Photon) and OSRM measures the drive.
const { load, ok, sleep, summary } = require('./lib');
const SHOP = '1200 Industrial Blvd, Austin, TX', A = '418 Oak St, Austin, TX', B = '77 Ridge Rd, Round Rock, TX';
const PTS = { [SHOP]: [-97.70, 30.33], [A]: [-97.75, 30.27], [B]: [-97.68, 30.51] };
const ROUTE = { 'S>A': [19795, 1320], 'A>S': [19800, 1310], 'A>B': [36049, 1862], 'B>S': [29129, 1500] };
const nameOf = (lon, lat) => Object.keys(PTS).find((k) => Math.abs(PTS[k][0] - lon) < 1e-6 && Math.abs(PTS[k][1] - lat) < 1e-6);
const tag = (n) => (n === SHOP ? 'S' : n === A ? 'A' : 'B');
(async () => {
  const log = [], times = [];
  let nominatimDown = false;
  const net = async (url) => {
    log.push(url); times.push(Date.now());
    const res = (o, st) => ({ ok: (st || 200) < 400, status: st || 200, json: async () => o });
    if (url.startsWith('https://photon.komoot.io/api/')) {
      const q = decodeURIComponent(url.split('q=')[1]);
      return res({ features: PTS[q] ? [{ geometry: { coordinates: PTS[q] }, properties: {} }] : [] });
    }
    if (url.startsWith('https://nominatim.openstreetmap.org/search')) {
      if (nominatimDown) return res({}, 503);
      const q = decodeURIComponent(url.split('q=')[1]);
      return res(PTS[q] ? [{ lat: String(PTS[q][1]), lon: String(PTS[q][0]) }] : []);
    }
    if (url.startsWith('https://router.project-osrm.org/route/v1/driving/')) {
      const [p1, p2] = url.split('/driving/')[1].split('?')[0].split(';').map((s) => s.split(',').map(Number));
      const r = ROUTE[tag(nameOf(p1[0], p1[1])) + '>' + tag(nameOf(p2[0], p2[1]))];
      return res(r ? { code: 'Ok', routes: [{ distance: r[0], duration: r[1] }] } : { code: 'NoRoute', routes: [] });
    }
    throw new Error('unexpected ' + url);
  };
  // the APK: hosted file, nothing configured, network available
  const P = await load(__dirname + '/../../build/tally-supabase.html', { net });
  const type = (sel, v, blur) => { const e = P.$(sel); e.value = v; e.dispatchEvent(new P.w.Event('input', { bubbles: true })); if (blur) e.dispatchEvent(new P.w.Event('change', { bubbles: true })); };
  ok(!P.w.tallyMaps, 'no Supabase or Google set up (like the first APK)');
  P.T.state().settings.shopAddress = SHOP;
  P.click('#fab'); await sleep(15);
  ok(/fills itself in/.test(P.$('#distNote').textContent) && !!P.$('[data-act="q:dist"]'), 'the quote offers the lookup instead of only a map link');
  type('[data-d="from"]', A, true); type('[data-d="to"]', B, true);
  await sleep(6000);
  ok(P.$('[data-d="miles"]').value === '22.4' && P.$('[data-d="milesOut"]').value === '12.3' && P.$('[data-d="milesBack"]').value === '18.1', 'all three drives filled in: ' + ['milesOut', 'miles', 'milesBack'].map((f) => P.$('[data-d="' + f + '"]').value).join(' / '));
  ok(/Round trip from the shop: 52\.8 mi/.test(P.$('#shopNote').textContent), 'round trip added up: 52.8 mi');
  ok(/Distances from OpenStreetMap/.test(P.$('#distNote').textContent), 'says where the numbers came from');
  const geo = log.filter((u) => /photon|nominatim/.test(u));
  ok(geo.length === 3, 'each address looked up once (shop reused): ' + geo.length);
  const gt = times.filter((t, i) => /photon|nominatim/.test(log[i]));
  ok(gt.every((t, i) => i === 0 || t - gt[i - 1] >= 1050), 'address lookups spaced a second apart, as the free service asks');
  // Nominatim down: Photon picks up
  nominatimDown = true; log.length = 0; times.length = 0;
  type('[data-d="to"]', 'nowhere at all', true); await sleep(3500);
  ok(/Couldn.t find .nowhere at all. on the map\. Add the city and state\./.test(P.$('#distNote').textContent), 'unknown address: clear message: ' + P.$('#distNote').textContent.slice(0, 90));
  ok(log.some((u) => u.includes('photon')) && log.some((u) => u.includes('nominatim')), 'when the first address service fails, the second is tried');
  type('[data-d="to"]', B, true); await sleep(2500);
  ok(P.$('[data-d="miles"]').value === '22.4', 'back to a known address: cached, filled straight away');
  // ---- the Android app with a Google key: Google first
  const G = await load(__dirname + '/../../build/tally-supabase.html', { net });
  let gcalls = [], mode = 'ok';
  G.w.TallyNative = { hasGoogle: () => true, routeDistance: (id, a, b) => { gcalls.push(a + '|' + b); setTimeout(() => G.w.__tallyNativeDone(id, mode === 'ok' ? { ok: true, src: 'google', miles: 22.9, minutes: 30 } : { ok: false, keyProblem: true, message: 'Google Maps turned the key down (403).' }), 20); } };
  G.T.state().settings.shopAddress = '';
  G.click('#fab'); await sleep(15);
  const gType = (sel, v) => { const e = G.$(sel); e.value = v; e.dispatchEvent(new G.w.Event('input', { bubbles: true })); e.dispatchEvent(new G.w.Event('change', { bubbles: true })); };
  log.length = 0;
  gType('[data-d="from"]', A); gType('[data-d="to"]', B); await sleep(200);
  ok(gcalls.length === 1 && G.$('[data-d="miles"]').value === '22.9' && log.length === 0, 'with a Google key the app asks Google, not OpenStreetMap');
  ok(/Distances from Google Maps/.test(G.$('#distNote').textContent), 'note says Google Maps');
  mode = 'refused';
  gType('[data-d="to"]', SHOP); await sleep(4000);
  ok(log.some((u) => u.includes('router.project-osrm.org')) && /turned the key down/.test(G.$('#distNote').textContent), 'if Google refuses the key, OpenStreetMap fills in and the note says why');
  // the artifact never tries
  const Ar = await load(__dirname + '/../../build/tally-artifact.html', { net: async (u) => { throw new Error('artifact fetched ' + u); } });
  Ar.click('#fab'); await sleep(15);
  const t2 = (sel, v) => { const e = Ar.$(sel); e.value = v; e.dispatchEvent(new Ar.w.Event('input', { bubbles: true })); e.dispatchEvent(new Ar.w.Event('change', { bubbles: true })); };
  t2('[data-d="from"]', A); t2('[data-d="to"]', B); await sleep(50);
  ok(/Type the miles from the map/.test(Ar.$('#distNote').textContent) && !!Ar.$('#distNote a'), 'artifact: still the map link, no outside calls');
  ok(P.errors.length === 0 && G.errors.length === 0 && Ar.errors.length === 0, 'no errors (' + P.errors.concat(G.errors, Ar.errors).slice(0, 3).join(' | ') + ')');
  process.exit(summary('free lookup') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
