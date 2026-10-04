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
    let filters = [], order = null, lim = null, single = false, op = 'select', payload = null;
    const val = (row, col) => {
      let m = /^data->>?'?([A-Za-z0-9_]+)'?$/.exec(col);
      if (m) return row.data ? row.data[m[1]] : undefined;
      return row[col];
    };
    const api = {
      select() { return api; }, eq(c, v) { filters.push((r) => String(val(r, c)) === String(v)); return api; },
      filter(c, o, v) { filters.push((r) => { const x = val(r, c); return o === 'eq' ? String(x) === String(v) : o === 'gt' ? x > v : o === 'lt' ? x < v : true; }); return api; },
      order(c, opts) { order = [c, opts && opts.ascending === false]; return api; }, limit(n) { lim = n; return api; },
      maybeSingle() { single = true; return api; },
      upsert(o) { op = 'upsert'; payload = o; return api; }, update(o) { op = 'update'; payload = o; return api; }, delete() { op = 'delete'; return api; },
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
          if (op === 'update') { rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, clone(payload))); return Promise.resolve({ data: null, error: null }).then(res, rej); }
          if (op === 'delete') { const keep = rows.filter((r) => !filters.every((f) => f(r))); rows.length = 0; keep.forEach((r) => rows.push(r)); setTimeout(() => fire(table, {}), 5); return Promise.resolve({ data: null, error: null }).then(res, rej); }
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
    rpc(name) {
      if (name === 'my_orgs') return Promise.resolve({ data: db.members.filter((m) => m.user_id === me.uid).map((m) => ({ id: m.org_id, name: 'Ace Moving', role: m.role, join_code: 'ABC123' })) });
      if (name === 'people') return Promise.resolve({ data: db.members.map((m) => ({ user_id: m.user_id, email: m.email })) });
      return Promise.resolve({ data: null });
    },
    from: query,
    channel() { const ch = { on(ev, f, cb) { listeners.push({ table: f.table, cb }); return ch; }, subscribe() { return ch; } }; return ch; },
  };
}

async function load(file, opts = {}) {
  const html = fs.readFileSync(file, 'utf8').replace('PASTE_YOUR_PROJECT_URL', 'https://proj.supabase.co').replace('PASTE_YOUR_ANON_PUBLIC_KEY', 'anon');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented|Could not load/.test(String(e.message))) errors.push('jsdom: ' + e.message); });
  vc.on('error', (e) => errors.push('console.error: ' + e));
  const calls = { fn: [], writes: [] };
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
