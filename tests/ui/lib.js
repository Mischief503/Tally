// Loads a MoveCrew edition in jsdom. For the hosted edition it injects an in-memory Supabase
// (rows deep-frozen, like the real shared store) and a fake Edge Function endpoint.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');

function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the database's copy of the schedule without the money (sched_of), kept like the trigger sched_sync does
function schedOf(j) {
  const d = j.d || {}, q = j.quote || {}, a = j.assign || {}, pick = (o, ks) => { const r = {}; ks.forEach((k) => { r[k] = o[k] === undefined ? null : o[k]; }); return r; };
  return { id: j.id === undefined ? null : j.id, status: j.status === undefined ? null : j.status, test: j.test === undefined ? false : j.test,
    d: pick(d, ['name', 'phone', 'email', 'moveDate', 'time', 'from', 'to', 'notes', 'flights', 'custom', 'slots']),
    items: (Array.isArray(j.items) ? j.items : []).map((i) => pick(i, ['id', 'name', 'qty'])),
    quote: pick(q, ['crew', 'hours', 'kind', 'driveH', 'nTrucks', 'truckId', 'truckName']),
    assign: { truckId: a.truckId === undefined ? null : a.truckId, more: a.more || [], crewN: Array.isArray(a.crew) ? a.crew.length : 0 },
    startedAt: j.startedAt === undefined ? null : j.startedAt };
}
// the database's rate card copy (ratecard_of): the settings' prices and what makes them, kept like ratecard_sync
// (and, since Oct 25, each truck's day and the movers' counts: how many, and how many off each day, never who)
const CARD_KEYS = ['company', 'rates', 'minHours', 'prod', 'mph', 'shopAddress', 'shopTravel', 'shopGeo', 'includedMiles', 'mileRate', 'truckFee', 'stairFee', 'packPerBox', 'taxPct', 'depositPct', 'ntePct', 'nteCap', 'trucks', 'catalog', 'sources', 'customFields', 'opt', 'truckDay'];
function ratecardOf(s) {
  const o = {}; CARD_KEYS.forEach((k) => { if (s && s[k] !== undefined) o[k] = clone(s[k]); });
  if (s && Array.isArray(s.crew)) {
    const off = {}, D = s.daysOff && typeof s.daysOff === 'object' && !Array.isArray(s.daysOff) ? s.daysOff : {};
    Object.keys(D).forEach((d) => { if (!Array.isArray(D[d])) return; const n = new Set(D[d].filter((x) => typeof x === 'string' && s.crew.indexOf(x) >= 0)).size; if (n) off[d] = n; });
    o.movers = { n: s.crew.length, off };
  }
  return o;
}
function syncSched(db, row, fire) {
  if (db.__sched && row && row.path === 'org/settings') {
    const rows = db.docs, i = rows.findIndex((r) => r.org_id === row.org_id && r.path === 'ratecard/main');
    const c = { org_id: row.org_id, path: 'ratecard/main', collection: 'ratecard', doc_id: 'main', data: ratecardOf(row.data), updated_at: new Date().toISOString() };
    if (i >= 0) rows[i] = c; else rows.push(c);
    setTimeout(() => fire('docs', c), 6);
    return;
  }
  if (!db.__sched || !row || row.collection !== 'jobs') return;
  const rows = db.docs, path = 'sched/' + row.doc_id, i = rows.findIndex((r) => r.org_id === row.org_id && r.path === path);
  if (row.data && ['booked', 'active'].indexOf(row.data.status) >= 0) {
    const s = { org_id: row.org_id, path, collection: 'sched', doc_id: row.doc_id, data: schedOf(row.data), updated_at: new Date().toISOString() };
    if (i >= 0) rows[i] = s; else rows.push(s);
    setTimeout(() => fire('docs', s), 6);
  } else if (i >= 0) { const gone = rows.splice(i, 1)[0]; setTimeout(() => fire('docs', gone), 6); }
}

function makeSupabase(db, me, calls) {
  const listeners = [];
  function fire(table, row) { listeners.forEach((l) => { if (l.table === table) l.cb({ new: row, old: null }); }); }
  function query(table) {
    let filters = [], order = null, lim = null, single = false, op = 'select', payload = null, returning = false;
    const asked = [];   // [column, value] pairs, so a test can fail one kind of query
    const val = (row, col) => {
      // PostgREST reads quotes around a JSON key as part of the key, so a quoted key matches nothing there
      if (/'/.test(col)) throw new Error('PostgREST would read the quotes as part of the key: ' + col);
      let m = /^data->>?([A-Za-z0-9_]+)$/.exec(col);
      if (m) return row.data ? row.data[m[1]] : undefined;
      return row[col];
    };
    const api = {
      select() { if (op !== 'select') returning = true; return api; }, eq(c, v) { asked.push([c, v]); filters.push((r) => String(val(r, c)) === String(v)); return api; },
      in(c, vs) { asked.push([c, vs.join(',')]); filters.push((r) => vs.map(String).indexOf(String(val(r, c))) >= 0); return api; },
      filter(c, o, v) { asked.push([c, v]); filters.push((r) => { const x = val(r, c); return o === 'eq' ? String(x) === String(v) : o === 'gt' ? x > v : o === 'lt' ? x < v : true; }); return api; },
      order(c, opts) { order = [c, opts && opts.ascending === false]; return api; }, limit(n) { lim = n; return api; },
      maybeSingle() { single = true; return api; },
      upsert(o) { op = 'upsert'; payload = o; return api; }, insert(o) { op = 'insert'; payload = o; return api; }, update(o) { op = 'update'; payload = o; return api; }, delete() { op = 'delete'; return api; },
      then(res, rej) {
        try {
          const rows = db[table] || (db[table] = []);
          if (table === 'comm_lines' && db.__noLineTable) return Promise.resolve({ data: null, error: { message: 'relation does not exist' } }).then(res, rej);
          if (op === 'select') {
            if (db.__failSelect && db.__failSelect(table, asked)) return Promise.resolve({ data: null, error: { message: 'network' } }).then(res, rej);
            let out = rows.filter((r) => filters.every((f) => f(r)));
            if (table === 'docs' && db.__visible) out = out.filter(db.__visible);
            if (order) { const [c, desc] = order; out = out.slice().sort((a, b) => (val(a, c) < val(b, c) ? -1 : 1) * (desc ? -1 : 1)); }
            if (lim != null) out = out.slice(0, lim);
            out = deepFreeze(clone(out));
            return Promise.resolve({ data: single ? (out[0] || null) : out, error: null }).then(res, rej);
          }
          if (op === 'upsert') {
            const fu = db.__failUpsert && db.__failUpsert(table, payload);   // true, or how many ms until it fails
            if (fu) return new Promise((r) => setTimeout(r, typeof fu === 'number' ? fu : 0)).then(() => ({ data: null, error: { message: 'offline' } })).then(res, rej);
            const key = table === 'docs' ? (r) => r.org_id + '|' + r.path : table === 'members' || table === 'access_requests' ? (r) => r.org_id + '|' + r.user_id : (r) => JSON.stringify(r);
            const i = rows.findIndex((r) => key(r) === key(payload));
            const row = clone(payload); if (i >= 0) rows[i] = row; else rows.push(row);
            calls.writes.push({ table, row });
            setTimeout(() => fire(table, row), 5);
            if (table === 'docs') syncSched(db, row, fire);
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          }
          if (op === 'insert') {
            if (db.__failInsert && db.__failInsert[table]) return Promise.resolve({ data: null, error: { message: db.__failInsert[table] } }).then(res, rej);
            const row = Object.assign({ id: 'id-' + (++db.__seq || (db.__seq = 1)), user_id: null }, clone(payload));
            rows.push(row); calls.writes.push({ table, op: 'insert', row: clone(row) });
            setTimeout(() => fire(table, row), 5);
            return Promise.resolve({ data: returning ? (single ? clone(row) : [clone(row)]) : null, error: null }).then(res, rej);
          }
          if (op === 'update') {
            const hit = rows.filter((r) => filters.every((f) => f(r)));
            hit.forEach((r) => Object.assign(r, clone(payload)));
            calls.writes.push({ table, op: 'update', row: clone(payload), n: hit.length });
            const out = hit.map(clone);
            return Promise.resolve({ data: returning ? (single ? (out[0] || null) : out) : null, error: null }).then(res, rej);
          }
          if (op === 'delete') { calls.writes.push({ table, op: 'delete', n: rows.filter((r) => filters.every((f) => f(r))).length }); const keep = rows.filter((r) => !filters.every((f) => f(r))); rows.length = 0; keep.forEach((r) => rows.push(r)); setTimeout(() => fire(table, {}), 5); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        } catch (e) { return Promise.reject(e).then(res, rej); }
      },
    };
    return api;
  }
  return {
    __fire: fire,
    auth: {
      getSession: () => Promise.resolve({ data: { session: me ? { user: { id: me.uid, email: me.email }, access_token: 'tok-' + me.uid } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}), signInWithOtp: () => Promise.resolve({}), verifyOtp: () => Promise.resolve({}),
      signInWithOAuth: (o) => { calls.oauth = o; return Promise.resolve({ data: {}, error: null }); },
      updateUser: (o) => { calls.updateUser = o; return Promise.resolve({ data: {}, error: null }); },
    },
    rpc(name, args) {
      calls.rpc.push({ name, args: clone(args || {}) });
      const emps = db.employees || [];
      if (name === 'claim_invites') return Promise.resolve({ data: db.__claim ? db.__claim() : 0 });
      if (name === 'my_profile') {
        const e = emps.find((x) => x.user_id === me.uid && x.active !== false);
        return Promise.resolve({ data: e ? { id: e.id, name: e.name, role: e.role, email: e.email, active: true, info: clone(e.info || {}) } : null });
      }
      if (name === 'update_my_profile') {
        const e = emps.find((x) => x.user_id === me.uid && x.active !== false);
        if (!e) return Promise.resolve({ data: null, error: { message: 'No profile to update' } });
        const ok = ['phone','address','city','state','zip','emergencyName','emergencyRelation','emergencyPhone','shirtSize'];
        Object.keys(args.patch || {}).forEach((k) => { if (ok.includes(k)) e.info[k] = args.patch[k]; });
        return Promise.resolve({ data: { id: e.id, name: e.name, role: e.role, email: e.email, active: true, info: clone(e.info) } });
      }
      if (name === 'doc_patch') {
        // the server merges a change in one step (null removes a key, objects merge, the rest replaces)
        if (db.__noDocPatch) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.doc_patch(o, p, patch) in the schema cache' } });
        if (db.__docPatchFail) return Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure' } });
        const rows = db.docs || (db.docs = []);
        const row = rows.find((r) => r.org_id === args.o && r.path === args.p);
        if (!row) return Promise.resolve({ data: false, error: null });
        const merge = (t, s) => { Object.keys(s).forEach((k) => { const v = s[k]; if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v); else if (v === null) delete t[k]; else t[k] = v; }); return t; };
        row.data = merge(clone(row.data), clone(args.patch)); row.updated_at = new Date().toISOString();
        calls.writes.push({ table: 'docs', op: 'patch', row: clone(row), patch: clone(args.patch) });
        setTimeout(() => fire('docs', row), 5);
        syncSched(db, row, fire);
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'cc_save') {
        // the call center's saves, checked like supabase-callcenter.sql's cc_save (and the job guard)
        const rows = db.docs || (db.docs = []), open = (d) => d && (d.status === 'lead' || d.status === 'quoted');
        const disc = (d) => { const v = String(((d || {}).d || {}).discount == null ? '' : d.d.discount).trim(); return v === '' ? '0' : v; };
        const pays = (d) => JSON.stringify((d || {}).payments || {});
        const err = (m) => Promise.resolve({ data: null, error: { message: m } });
        if (db.__ccFail) return Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure' } });
        if (!/^jobs\/[A-Za-z0-9_-]{1,64}$/.test(args.p || '')) return err('The call center saves jobs only');
        const row = rows.find((r) => r.org_id === args.o && r.path === args.p);
        calls.writes.push({ table: 'docs', op: 'cc_save', path: args.p, doc: clone(args.doc), patch: clone(args.patch) });
        if (row) {
          if (!open(row.data)) return Promise.resolve({ data: 'closed', error: null });
          const merge = (t, s) => { Object.keys(s).forEach((k) => { const v = s[k]; if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v); else if (v === null) delete t[k]; else t[k] = v; }); return t; };
          const nd = args.patch ? merge(clone(row.data), clone(args.patch)) : clone(args.doc);
          if (['lead', 'quoted', 'booked', 'lost'].indexOf(nd.status) < 0) return err('The call center saves quotes, bookings and lost quotes');
          if (disc(nd) !== disc(row.data)) return err('Only the office gives a discount');
          if (pays(nd) !== pays(row.data)) return err("The call center doesn't take payments");
          row.data = nd; row.updated_at = new Date().toISOString();
          setTimeout(() => fire('docs', row), 5); syncSched(db, row, fire);
          return Promise.resolve({ data: 'ok', error: null });
        }
        if (args.patch) return Promise.resolve({ data: 'missing', error: null });
        const d = args.doc || {};
        if (['lead', 'quoted', 'booked', 'lost'].indexOf(d.status) < 0 || pays(d) !== '{}' || !/^0*(\.0*)?$/.test(disc(d))) return err('A new job from the call center is a quote or a booking, with no payment and no discount');
        const nr = { org_id: args.o, path: args.p, collection: 'jobs', doc_id: args.p.slice(5), data: clone(d), updated_at: new Date().toISOString() };
        rows.push(nr); setTimeout(() => fire('docs', nr), 5); syncSched(db, nr, fire);
        return Promise.resolve({ data: 'ok', error: null });
      }
      // MoveCrew's call center team (db.__ccTeam: {uid: name}) and the companies with the service (db.__ccOrgs: [{id, name}])
      const agent = db.__ccTeam && me && db.__ccTeam[me.uid];
      if (name === 'claim_cc_team') return Promise.resolve({ data: !!agent });
      if (name === 'cc_me') return Promise.resolve({ data: agent || null });
      if (name === 'my_orgs') return Promise.resolve({ data: db.members.filter((m) => m.user_id === me.uid).map((m) => ({ id: m.org_id, name: (db.__orgNames || {})[m.org_id] || 'Ace Moving', role: m.role, join_code: 'ABC123' }))
        .concat(agent ? (db.__ccOrgs || []).filter((o) => !db.members.some((m) => m.user_id === me.uid && m.org_id === o.id)).map((o) => ({ id: o.id, name: o.name, role: 'callcenter', join_code: null, pending: false })) : []) });
      if (name === 'people') return Promise.resolve({ data: db.members.map((m) => ({ user_id: m.user_id, email: m.email })).concat((db.access_requests || []).map((r) => ({ user_id: r.user_id, email: r.email }))) });
      return Promise.resolve({ data: null });
    },
    from: query,
    storage: {
      from(bucket) {
        const files = db.__files || (db.__files = []);
        return {
          list(prefix) { calls.storage.push({ op: 'list', bucket, prefix }); return Promise.resolve({ data: files.filter((f) => f.path.startsWith(prefix + '/')).map((f) => ({ id: f.path, name: f.path.slice(prefix.length + 1), metadata: { size: f.size } })), error: null }); },
          upload(path, file, opts) { calls.storage.push({ op: 'upload', bucket, path, type: opts && opts.contentType }); files.push({ path, size: file.size || 0 }); return Promise.resolve({ data: { path }, error: null }); },
          createSignedUrl(path, secs) { calls.storage.push({ op: 'sign', bucket, path, secs }); return Promise.resolve({ data: { signedUrl: 'https://signed.example/' + path }, error: null }); },
          remove(paths) { calls.storage.push({ op: 'remove', bucket, paths }); paths.forEach((p) => { const i = files.findIndex((f) => f.path === p); if (i >= 0) files.splice(i, 1); }); return Promise.resolve({ data: [], error: null }); },
        };
      },
    },
    channel() { const ch = { on(ev, f, cb) { listeners.push({ table: f.table, cb }); return ch; }, subscribe() { return ch; } }; return ch; },
  };
}

async function load(file, opts = {}) {
  const html = fs.readFileSync(file, 'utf8').replace('PASTE_YOUR_PROJECT_URL', 'https://proj.supabase.co').replace('PASTE_YOUR_ANON_PUBLIC_KEY', 'anon');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented|Could not load/.test(String(e.message))) errors.push('jsdom: ' + e.message); });
  vc.on('error', (e) => errors.push('console.error: ' + e));
  const calls = { fn: [], writes: [], rpc: [], storage: [] };
  const dom = new JSDOM(html, {
    url: 'https://tally.example.com/' + (opts.hash || ''), runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.__TALLY_TEST = true;
      w.innerWidth = opts.width || 390;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
      if (opts.org) w.localStorage.setItem('tally.org', opts.org);
      if (opts.db) {
        w.supabase = { createClient: () => (w.__sb = makeSupabase(opts.db, opts.me, calls)) };
        w.fetch = async (url, init) => {
          if (opts.net && !/\/functions\/v1\//.test(String(url))) return opts.net(String(url), init);
          const body = JSON.parse(init.body);
          calls.fn.push({ url, init, body });
          const reply = (opts.fnReply || (() => ({ ok: true, sent: 0 })))(body);
          return { json: async () => reply };
        };
      }
      if (!opts.db && opts.net) w.fetch = async (url, init) => opts.net(String(url), init);
      w.addEventListener('error', (e) => errors.push('window: ' + (e.message || e.error)));
      if (opts.setup) opts.setup(w);
    },
  });
  const w = dom.window;
  await sleep(opts.db ? 400 : 150);
  const $ = (s) => w.document.querySelector(s);
  const $$ = (s) => Array.from(w.document.querySelectorAll(s));
  const click = (el) => { if (typeof el === 'string') el = $(el); if (!el) throw new Error('no element to click'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  const text = () => w.document.body.textContent.replace(/\s+/g, ' ');
  // a screen the way a person reaches it: its bottom-bar tab when it has one, else through More;
  // `sec` opens that Setup section (Setup is a list of sections, each on its own page)
  const go = async (tab, sec) => {
    const bar = $('#tabs [data-act="tab"][data-tab="' + tab + '"]');
    if (bar && !sec) { click(bar); await sleep(15); return; }
    click('[data-act="more:open"]'); await sleep(5);
    click('[data-act="more:go"][data-tab="' + tab + '"]' + (tab === 'settings' ? ':not([data-sec])' : '')); await sleep(25);
    if (sec) { click('[data-act="set:open"][data-sec="' + sec + '"]'); await sleep(20); }
  };
  // a job folded on the crew's Jobs screen (Coming up, History) opens with a tap on its name, as a person would
  const openCard = async (id) => { const d = $('#view details.hcard[data-job="' + id + '"]'); if (d && !d.open) { click(d.querySelector('summary b')); await sleep(10); } };
  // put people on the clock (Start job waits for everyone on the job to clock in)
  const clockIn = (...names) => {
    const st = w.__tally.state();
    names.flat().forEach((n) => { if (!st.shifts.some((x) => x.who === n && !x.outAt)) st.shifts.push({ id: 'ck_' + String(n).replace(/\W/g, '') + '_' + st.shifts.length, who: n, inAt: Date.now() - 60000, outAt: 0, activity: 'Job day', note: '', late: 0, breaks: [] }); });
    w.__tally.render();
  };
  return { dom, w, $, $$, click, text, go, openCard, clockIn, errors, calls, T: w.__tally };
}

let passes = 0, failures = 0;
function ok(c, m) { if (c) { passes++; console.log('PASS', m); } else { failures++; console.log('FAIL', m); } }
function summary(name) { console.log(`\n${name}: ${passes} passed, ${failures} failed`); return failures; }

module.exports = { load, ok, sleep, summary, deepFreeze, clone, schedOf, ratecardOf };
