// Loads a Tally edition in jsdom. For the hosted edition it injects an in-memory Supabase
// (rows deep-frozen, like the real shared store) and a fake Edge Function endpoint.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');

function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeSupabase(db, me, calls) {
  const listeners = [];
  function fire(table, row) { listeners.forEach((l) => { if (l.table === table) l.cb({ new: row, old: null }); }); }
  function query(table) {
    let filters = [], order = null, lim = null, single = false, op = 'select', payload = null, returning = false;
    const val = (row, col) => {
      let m = /^data->>?'?([A-Za-z0-9_]+)'?$/.exec(col);
      if (m) return row.data ? row.data[m[1]] : undefined;
      return row[col];
    };
    const api = {
      select() { if (op !== 'select') returning = true; return api; }, eq(c, v) { filters.push((r) => String(val(r, c)) === String(v)); return api; },
      filter(c, o, v) { filters.push((r) => { const x = val(r, c); return o === 'eq' ? String(x) === String(v) : o === 'gt' ? x > v : o === 'lt' ? x < v : true; }); return api; },
      order(c, opts) { order = [c, opts && opts.ascending === false]; return api; }, limit(n) { lim = n; return api; },
      maybeSingle() { single = true; return api; },
      upsert(o) { op = 'upsert'; payload = o; return api; }, insert(o) { op = 'insert'; payload = o; return api; }, update(o) { op = 'update'; payload = o; return api; }, delete() { op = 'delete'; return api; },
      then(res, rej) {
        try {
          const rows = db[table] || (db[table] = []);
          if (table === 'comm_lines' && db.__noLineTable) return Promise.resolve({ data: null, error: { message: 'relation does not exist' } }).then(res, rej);
          if (op === 'select') {
            let out = rows.filter((r) => filters.every((f) => f(r)));
            if (order) { const [c, desc] = order; out = out.slice().sort((a, b) => (val(a, c) < val(b, c) ? -1 : 1) * (desc ? -1 : 1)); }
            if (lim != null) out = out.slice(0, lim);
            out = deepFreeze(clone(out));
            return Promise.resolve({ data: single ? (out[0] || null) : out, error: null }).then(res, rej);
          }
          if (op === 'upsert') {
            const key = table === 'docs' ? (r) => r.org_id + '|' + r.path : table === 'members' || table === 'access_requests' ? (r) => r.org_id + '|' + r.user_id : (r) => JSON.stringify(r);
            const i = rows.findIndex((r) => key(r) === key(payload));
            const row = clone(payload); if (i >= 0) rows[i] = row; else rows.push(row);
            calls.writes.push({ table, row });
            setTimeout(() => fire(table, row), 5);
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
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'my_orgs') return Promise.resolve({ data: db.members.filter((m) => m.user_id === me.uid).map((m) => ({ id: m.org_id, name: 'Ace Moving', role: m.role, join_code: 'ABC123' })) });
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
  return { dom, w, $, $$, click, text, errors, calls, T: w.__tally };
}

let passes = 0, failures = 0;
function ok(c, m) { if (c) { passes++; console.log('PASS', m); } else { failures++; console.log('FAIL', m); } }
function summary(name) { console.log(`\n${name}: ${passes} passed, ${failures} failed`); return failures; }

module.exports = { load, ok, sleep, summary, deepFreeze, clone };
