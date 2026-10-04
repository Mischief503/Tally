// Live check of the free map services Tally falls back to. Runs on GitHub; reports as notes.
const A = '1600 SW Naito Pkwy, Portland, OR', B = '4800 SE Woodstock Blvd, Portland, OR';
const UA = { 'User-Agent': 'Tally-CI (github.com/Mischief503/Tally)', Accept: 'application/json' };
const note = (m) => console.log('::notice title=Map services::' + m);
const warn = (m) => console.log('::warning title=Map services::' + m);
async function j(url) { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(url.split('/')[2] + ' HTTP ' + r.status); return r.json(); }
async function photon(q) { const x = await j('https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(q)); const f = x.features && x.features[0]; if (!f) throw new Error('photon: no match for ' + q); return f.geometry.coordinates; }
async function nominatim(q) { const x = await j('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us,ca&q=' + encodeURIComponent(q)); if (!x[0]) throw new Error('nominatim: no match for ' + q); return [+x[0].lon, +x[0].lat]; }
const pause = () => new Promise((r) => setTimeout(r, 1100));
(async () => {
  const pts = {};
  for (const [name, fn] of [['nominatim', nominatim], ['photon', photon]]) {
    try { pts[name] = [await fn(A)]; await pause(); pts[name].push(await fn(B)); await pause(); note(name + ' found both addresses: ' + JSON.stringify(pts[name])); }
    catch (e) { warn(name + ' failed: ' + e.message); delete pts[name]; }
  }
  const use = pts.nominatim || pts.photon;
  if (!use) { warn('No address service answered.'); return; }
  try {
    const r = await j('https://router.project-osrm.org/route/v1/driving/' + use[0].join(',') + ';' + use[1].join(',') + '?overview=false');
    note('OSRM: ' + (r.routes[0].distance / 1609.344).toFixed(1) + ' mi, ' + Math.round(r.routes[0].duration / 60) + ' min');
  } catch (e) { warn('OSRM failed: ' + e.message); }
})();
