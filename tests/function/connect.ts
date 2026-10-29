// Stripe Connect in the Edge Function: a company's own Stripe account. The owner connects it from Setup,
// Stripe's sign-up takes the details, and the company's card payments are then made on that account
// (the Stripe-Account header), while the platform owner's own company keeps using the platform account.
// A fake Stripe that keeps every object on the account it was made on, like the real one.
// Run: deno run -A tests/function/connect.ts
// deno-lint-ignore-file no-explicit-any
(globalThis as any).__TALLY_TEST = true;
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
const fn = await import("../../supabase/functions/tally-twilio/index.ts");
const BASE = "https://proj.supabase.co/functions/v1/tally-twilio";

let failures = 0, passes = 0;
function ok(c: unknown, m: string) { if (c) { passes++; console.log("PASS", m); } else { failures++; console.log("FAIL", m); } }

/* ---------- in-memory database (the same rules as pay.ts) ---------- */
const DB: Record<string, any[]> = { docs: [], members: [], orgs: [], comm_lines: [], comm_log: [], pay_orgs: [], pay_customers: [], pay_links: [], pay_log: [], pay_config: [], pay_cards: [], pay_jobs: [], pay_locks: [], pay_accounts: [], pay_config_connect: [] };
const KEYS: Record<string, string[]> = { docs: ["org_id", "path"], orgs: ["id"], pay_orgs: ["org_id"], pay_customers: ["org_id", "cust_key", "livemode"], pay_links: ["token"], pay_log: ["pi"], pay_config: ["mode"], pay_cards: ["id"], pay_jobs: ["org_id", "job_id", "livemode"], pay_locks: ["org_id", "job_id"], pay_accounts: ["account_id"], pay_config_connect: ["mode"] };
const clone = (o: any) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
function matches(row: any, filters: [string, string][]) {
  return filters.every(([k, f]) => {
    const i = f.indexOf("."), op = f.slice(0, i), val = f.slice(i + 1), v = row[k];
    if (op === "eq") return String(v) === val;
    if (op === "neq") return String(v) !== val;
    if (op === "is") return val === "true" ? v === true : val === "null" ? v == null : v === false;
    if (op === "gte") return String(v) >= val;
    if (op === "lt") return String(v) < val;
    if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").indexOf(String(v)) >= 0;
    throw new Error("op " + op);
  });
}
function payRecord(b: any) {
  const row = DB.docs.find((r) => r.org_id === b.o && r.path === "jobs/" + b.job);
  if (!row) return null;
  const d = clone(row.data), old = d.payments && d.payments[b.pay_id];
  if (b.payment != null && old && String(old.amt) === String(b.payment.amt) && !!old.pending === !!b.payment.pending && (old.method || "") === (b.payment.method || "")) return d;
  if (b.payment == null && !old) return d;
  if (!d.payments || typeof d.payments !== "object") d.payments = {};
  if (b.payment == null) delete d.payments[b.pay_id]; else d.payments[b.pay_id] = b.payment;
  if (b.log_key && b.log_entry) { if (!d.log || typeof d.log !== "object") d.log = {}; d.log[b.log_key] = b.log_entry; }
  if (b.mark_paid && d.status === "done") d.status = "paid";
  row.data = d;
  return d;
}
function restMock(method: string, u: URL, body: any, prefer: string) {
  const parts = u.pathname.split("/");
  if (parts[parts.length - 2] === "rpc") {
    const name = parts[parts.length - 1];
    if (name === "pay_record") return { status: 200, body: payRecord(body) };
    if (name === "pay_reopen") return { status: 200, body: false };
    return { status: 404, body: { message: "no function" } };
  }
  const table = parts.pop()!;
  const rows = DB[table];
  if (!rows) return { status: 404, body: { message: "no table " + table } };
  const filters: [string, string][] = []; let limit = 1e9, onConflict = "";
  u.searchParams.forEach((v, k) => { if (k === "select" || k === "order") return; if (k === "limit") { limit = +v; return; } if (k === "on_conflict") { onConflict = v; return; } filters.push([k, v]); });
  const rep = prefer.indexOf("return=representation") >= 0;
  if (method === "GET") return { status: 200, body: clone(rows.filter((r) => matches(r, filters)).slice(0, limit)) };
  if (method === "POST") {
    const list = Array.isArray(body) ? body : [body], added: any[] = [];
    for (const r0 of list) {
      const r = clone(r0);
      if (!r.created_at && table !== "docs") r.created_at = new Date().toISOString();
      if ((table === "pay_config" || table === "pay_config_connect") && !r.updated_at) r.updated_at = new Date().toISOString();
      if ((table === "pay_config" || table === "pay_config_connect") && r.events == null) r.events = "";
      if (table === "pay_accounts") r.due = r.due || [];
      const keys = (onConflict ? onConflict.split(",") : KEYS[table]) || [];
      const hit = keys.length ? rows.find((x) => keys.every((k) => String(x[k]) === String(r[k]))) : null;
      // like the real index: one current account per company and mode
      if (!hit && table === "pay_accounts" && r.is_current !== false && rows.some((x) => x.org_id === r.org_id && !!x.livemode === !!r.livemode && x.is_current !== false)) return { status: 409, body: { message: "duplicate key value violates unique constraint \"pay_accounts_current_idx\"" } };
      if (hit) {
        if (prefer.indexOf("ignore-duplicates") >= 0) continue;
        if (prefer.indexOf("merge-duplicates") >= 0) { delete r.created_at; Object.assign(hit, r); added.push(hit); continue; }
        return { status: 409, body: { message: "duplicate key" } };
      }
      rows.push(r); added.push(r);
    }
    return { status: 201, body: rep ? clone(added) : null };
  }
  if (method === "PATCH") { const hit = rows.filter((r) => matches(r, filters)); hit.forEach((r) => Object.assign(r, clone(body))); return { status: 200, body: rep ? clone(hit) : null }; }
  if (method === "DELETE") { DB[table] = rows.filter((r) => !matches(r, filters)); return { status: 204, body: null }; }
  return { status: 405, body: null };
}

/* ---------- a fake Stripe that keeps objects on the account they were made on ---------- */
const calls: any[] = [];
const ST: any = { n: 0, accounts: {}, customers: [], sessions: {}, intents: {}, charges: {}, hooks: [], idem: {}, idemV2: {}, links: [], pms: {} };
const PM = (id: string, last4: string, fp: string) => ({ id, type: "card", customer: null, billing_details: { name: "Priya Nair" }, card: { brand: "visa", last4, exp_month: 3, exp_year: 2030, fingerprint: fp } });
const no = (what: string, id: string) => ({ status: 404, body: { error: { type: "invalid_request_error", message: "No such " + what + ": '" + id + "'" } } });
function unflat(p: Record<string, string>, prefix: string) {
  const out: any = {};
  Object.keys(p).forEach((k) => { if (k.indexOf(prefix + "[") === 0) { const m = /^\[([^\]]+)\]$/.exec(k.slice(prefix.length)); if (m) out[m[1]] = p[k]; } });
  return out;
}
const expands = (p: Record<string, string>) => Object.keys(p).filter((k) => /^expand\[\d+\]$/.test(k)).map((k) => p[k]);
function piView(pi: any, exp: string[]) {
  const v = clone(pi); delete v.params; delete v.acct;
  if (exp.indexOf("payment_method") >= 0 && typeof v.payment_method === "string" && ST.pms[v.payment_method]) { const pm = clone(ST.pms[v.payment_method]); delete pm.acct; v.payment_method = pm; }
  if (exp.indexOf("latest_charge") >= 0 && typeof v.latest_charge === "string") v.latest_charge = clone(ST.charges[v.latest_charge]);
  return v;
}
function charge(pi: any) { const cid = "ch_" + (++ST.n); ST.charges[cid] = { id: cid, object: "charge", payment_intent: pi.id, amount: pi.amount, amount_refunded: 0, disputed: false }; pi.latest_charge = cid; }
function stripeV1(method: string, path: string, p: Record<string, string>, acct: string) {
  const reply = (status: number, body: any) => ({ status, body });
  const id = () => String(++ST.n), exp = expands(p), now = Math.floor(Date.now() / 1000);
  let m: RegExpExecArray | null;
  if (acct && !ST.accounts[acct]) return reply(403, { error: { type: "invalid_request_error", message: "The provided key does not have access to account '" + acct + "' (or that account does not exist)." } });
  if ((m = /^\/v1\/accounts\/(acct_\w+)$/.exec(path)) && method === "GET") {
    const a = ST.accounts[m[1]];
    if (!a || a.gone) return reply(403, { error: { type: "invalid_request_error", message: "The provided key does not have access to account '" + m[1] + "'." } });
    return reply(200, { id: a.id, object: "account", charges_enabled: a.charges, payouts_enabled: a.payouts, details_submitted: a.submitted, requirements: { currently_due: a.due, past_due: [], disabled_reason: a.charges ? null : "requirements.past_due" } });
  }
  if (method === "GET" && path === "/v1/webhook_endpoints") return reply(200, { data: clone(ST.hooks) });
  if (method === "POST" && path === "/v1/webhook_endpoints") {
    const events = Object.keys(p).filter((k) => /^enabled_events\[\d+\]$/.test(k)).map((k) => p[k]);
    const w = { id: "we_" + id(), url: p.url, enabled_events: events, connect: p.connect === "true", status: "enabled", secret: "whsec_" + ST.n, description: p.description };
    ST.hooks.push(w); return reply(200, w);
  }
  if ((m = /^\/v1\/webhook_endpoints\/(\w+)$/.exec(path))) {
    const w = ST.hooks.find((x: any) => x.id === m![1]);
    if (method === "DELETE") { ST.hooks = ST.hooks.filter((x: any) => x.id !== m![1]); return reply(200, { deleted: true }); }
    if (!w) return no("webhook endpoint", m[1]);
    const out = clone(w); delete out.secret; return reply(200, out);
  }
  if (method === "POST" && path === "/v1/customers") { const c = { id: "cus_" + id(), name: p.name, phone: p.phone, acct }; ST.customers.push(c); return reply(200, c); }
  if (method === "POST" && path === "/v1/checkout/sessions") {
    const sid = "cs_test_" + id();
    if (p.customer && !ST.customers.some((c: any) => c.id === p.customer && c.acct === acct)) return no("customer", p.customer);
    const s = { id: sid, object: "checkout.session", url: "https://checkout.stripe.com/c/pay/" + sid, status: "open", expires_at: +p.expires_at, payment_intent: null, metadata: unflat(p, "metadata"), amount_total: +p["line_items[0][price_data][unit_amount]"], params: p, acct };
    ST.sessions[sid] = s; return reply(200, s);
  }
  if ((m = /^\/v1\/checkout\/sessions\/(\w+)(\/expire)?$/.exec(path))) {
    const s = ST.sessions[m[1]];
    if (!s || s.acct !== acct) return no("checkout.session", m[1]);
    if (method === "GET") return reply(200, s);
    if (s.status !== "open") return reply(400, { error: { type: "invalid_request_error", message: "Only open sessions can be expired." } });
    s.status = "expired"; return reply(200, s);
  }
  if (method === "POST" && path === "/v1/payment_intents") {
    if (p.customer && !ST.customers.some((c: any) => c.id === p.customer && c.acct === acct)) return no("customer", p.customer);
    const pid = "pi_" + id();
    const pi: any = { id: pid, object: "payment_intent", amount: +p.amount, currency: p.currency, customer: p.customer, metadata: unflat(p, "metadata"), livemode: false, created: now, status: "requires_payment_method",
      client_secret: pid + "_secret_x", payment_method: p.payment_method || null, payment_method_options: { card: { setup_future_usage: p["payment_method_options[card][setup_future_usage]"] || null } }, amount_received: 0, latest_charge: null, last_payment_error: null, params: p, acct };
    if (p.confirm === "true") {
      const pm = ST.pms[p.payment_method];
      if (!pm || pm.acct !== acct || pm.customer !== p.customer) return reply(400, { error: { type: "invalid_request_error", message: "No such PaymentMethod: '" + p.payment_method + "'" } });
      pi.status = "succeeded"; pi.amount_received = pi.amount; charge(pi);
    }
    ST.intents[pid] = pi; return reply(200, piView(pi, exp));
  }
  if ((m = /^\/v1\/payment_intents\/(\w+)(\/cancel)?$/.exec(path))) {
    const pi = ST.intents[m[1]];
    if (!pi || pi.acct !== acct) return no("payment_intent", m[1]);
    if (method === "GET") return reply(200, piView(pi, exp));
    pi.status = "canceled"; return reply(200, piView(pi, exp));
  }
  if (method === "GET" && path === "/v1/disputes") return reply(200, { data: [] });
  if (method === "POST" && (m = /^\/v1\/payment_methods\/(\w+)\/detach$/.exec(path))) {
    const pm = ST.pms[m[1]];
    if (!pm || pm.acct !== acct) return no("payment_method", m[1]);
    pm.customer = null; return reply(200, clone(pm));
  }
  return reply(404, { error: { message: "fake stripe: no route " + method + " " + path } });
}
function stripeV2(method: string, path: string, body: any, h: any) {
  const reply = (status: number, b: any) => ({ status, body: b });
  if (method === "POST" && path === "/v2/core/accounts") {
    const key = h["Idempotency-Key"];
    if (key && ST.idemV2[key]) return clone(ST.idemV2[key]);
    const aid = "acct_1Test" + (++ST.n) + "ABCD";
    ST.accounts[aid] = { id: aid, body: clone(body), charges: false, payouts: false, submitted: false, due: ["external_account", "representative.first_name", "business_profile.url", "tos_acceptance.date"] };
    const out = reply(200, { id: aid, object: "v2.core.account", dashboard: body.dashboard });
    if (key) ST.idemV2[key] = clone(out);
    return out;
  }
  if (method === "POST" && path === "/v2/core/account_links") {
    if (!ST.accounts[body.account]) return reply(404, { error: { type: "invalid_request_error", message: "No such account" } });
    const url = "https://accounts.stripe.com/r/" + body.account + "#alu_test_" + (++ST.n);   // the shape Stripe's links have
    ST.links.push({ ...clone(body), url });
    return reply(200, { object: "v2.core.account_link", account: body.account, url, expires_at: new Date(Date.now() + 300e3).toISOString() });
  }
  return reply(404, { error: { message: "fake stripe v2: no route " + method + " " + path } });
}
const USERS: Record<string, string> = { "tok-richie": "u-richie", "tok-ana": "u-ana", "tok-ana-dispatch": "u-anad", "tok-ana-lead": "u-anal" };
const EMAILS: Record<string, string> = { "u-ana": "ana@bluemoving.example" };
(globalThis as any).fetch = async (input: string, init: any = {}) => {
  const u = new URL(input), method = (init.method || "GET").toUpperCase();
  const reply = (status: number, b: any) => new Response(status === 204 ? null : b == null ? "" : JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (u.host === "api.stripe.com") {
    const h = init.headers || {};
    if (u.pathname.indexOf("/v2/") === 0) {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: u.pathname, body, ver: h["Stripe-Version"], idem: h["Idempotency-Key"], type: h["Content-Type"], acct: h["Stripe-Account"] || "" });
      const r = stripeV2(method, u.pathname, body, h);
      return reply(r.status, r.body);
    }
    const p: Record<string, string> = method === "GET" ? Object.fromEntries(u.searchParams) : Object.fromEntries(new URLSearchParams(init.body || ""));
    calls.push({ method, path: u.pathname, p, ver: h["Stripe-Version"], acct: h["Stripe-Account"] || "" });
    const r = stripeV1(method, u.pathname, p, h["Stripe-Account"] || "");
    return reply(r.status, r.body);
  }
  if (u.pathname === "/auth/v1/user") {
    const t = String(init.headers.Authorization || "").replace("Bearer ", "");
    return USERS[t] ? reply(200, { id: USERS[t], email: EMAILS[USERS[t]] || "" }) : reply(401, { message: "bad jwt" });
  }
  if (u.pathname.startsWith("/rest/v1/")) {
    const h = init.headers || {};
    if (h.Authorization !== "Bearer service") return reply(401, {});
    const r = restMock(method, u, init.body ? JSON.parse(init.body) : undefined, h.Prefer || "");
    return reply(r.status, r.body);
  }
  throw new Error("unexpected fetch " + input);
};

/* ---------- two companies: Richie's own (on the platform's account) and Blue Moving (its own) ---------- */
const RICH = "11111111-1111-1111-1111-111111111111", BLUE = "33333333-3333-3333-3333-333333333333";
DB.orgs.push({ id: RICH }, { id: BLUE });
DB.pay_orgs.push({ org_id: RICH, enabled: true });
const putDoc = (org: string, path: string, data: any) => { const [collection, doc_id] = path.split("/"); const i = DB.docs.findIndex((r) => r.org_id === org && r.path === path); const row = { org_id: org, path, collection, doc_id, data: clone(data) }; if (i >= 0) DB.docs[i] = row; else DB.docs.push(row); };
const doc = (org: string, path: string) => (DB.docs.find((r) => r.org_id === org && r.path === path) || {}).data;
const job = (id: string) => ({ id, status: "done", d: { name: "Priya Nair", phone: "512-555-0142", email: "priya@example.com", moveDate: "2026-10-12" }, quote: { total: 1000, nte: 1150 },
  assign: { crew: ["Lee"] }, signed: { s1: { id: "s1", formId: "f1" } }, payments: {}, extras: {}, materials: {}, log: {} });
putDoc(RICH, "org/settings", { company: "Live company trst", forms: [{ id: "f1", title: "Receipt", required: true }] });
putDoc(BLUE, "org/settings", { company: "Blue Moving", forms: [{ id: "f1", title: "Receipt", required: true }] });
putDoc(RICH, "jobs/r1", job("r1"));
putDoc(BLUE, "jobs/b1", job("b1"));
putDoc(BLUE, "jobs/b2", job("b2"));
DB.members.push(
  { org_id: RICH, user_id: "u-richie", role: "owner", staff: "Richie" },
  { org_id: BLUE, user_id: "u-ana", role: "owner", staff: "Ana" },
  { org_id: BLUE, user_id: "u-anad", role: "dispatch", staff: "Dot" },
  { org_id: BLUE, user_id: "u-anal", role: "lead", staff: "Lee" },
);
async function app(tok: string, body: any) {
  const r = await fn.handle(new Request(BASE + "/app", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function getUrl(path: string) {
  const r = await fn.handle(new Request(BASE + path, { method: "GET", redirect: "manual" }));
  return { status: r.status, loc: r.headers.get("location") || "", text: r.status === 302 ? "" : await r.text() };
}
const secretOf = (table: string) => (DB[table].find((x) => x.mode === "test") || {}).webhook_secret || "";
async function hook(path: string, event: any, secret: string) {
  const raw = JSON.stringify(event), t = String(Math.floor(Date.now() / 1000));
  const sig = await fn.stripeSignature(raw, secret, t);
  const r = await fn.handle(new Request(BASE + path, { method: "POST", headers: { "Stripe-Signature": "t=" + t + ",v1=" + sig }, body: raw }));
  return { status: r.status, text: await r.text() };
}
const last = (path: string, method = "POST") => [...calls].reverse().find((c) => c.path === path && c.method === method);
const count = (path: string, method = "POST") => calls.filter((c) => c.path === path && c.method === method).length;
const acctOfBlue = () => (DB.pay_accounts.find((a) => a.org_id === BLUE && a.is_current !== false) || {}).account_id;
Deno.env.set("STRIPE_SECRET_KEY", "sk_test_platform");
Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_test_platform");

/* ---------- not connected yet ---------- */
let r = await app("tok-ana-lead", { action: "pay_config", org: BLUE });
ok(r.body.ok && r.body.ready === false && r.body.reason === "connect" && r.body.connect.state === "none", "a company not on the platform's account starts with Connect");
r = await app("tok-ana-lead", { action: "pay_link", org: BLUE, jobId: "b1", amount: 100 });
ok(!r.body.ok && /The owner connects Stripe in Setup › Payments/.test(r.body.message) && calls.length === 0, "it can't take cards yet, and nothing reaches Stripe");
r = await app("tok-richie", { action: "pay_config", org: RICH });
ok(r.body.ready && r.body.account === "" && r.body.via === "platform" && r.body.publishableKey === "pk_test_platform", "Richie's own company is on the platform's account, as before");
r = await app("tok-richie", { action: "pay_connect", org: RICH });
ok(!r.body.ok && /already takes card payments on MoveCrew's own Stripe account/.test(r.body.message), "and has nothing to connect");

/* ---------- the owner connects ---------- */
r = await app("tok-ana-dispatch", { action: "pay_connect", org: BLUE });
ok(r.status === 403 && /Only the owner/.test(r.body.message), "dispatch can't connect the company's Stripe account");
r = await app("tok-ana-lead", { action: "pay_connect", org: BLUE });
ok(r.status === 403, "nor can a crew lead");
r = await app("tok-ana", { action: "pay_connect", org: BLUE });
ok(r.body.ok && /^https:\/\/accounts\.stripe\.com\/r\/acct_/.test(r.body.url), "the owner gets Stripe's own sign-up page: " + r.body.url);
const mk = last("/v2/core/accounts");
ok(mk && mk.ver === fn.STRIPE_V2_VERSION && mk.type === "application/json" && !mk.acct, "the account is made with Stripe's v2 API, as JSON, from the platform");
ok(mk.body.dashboard === "full" && mk.body.defaults.responsibilities.fees_collector === "stripe" && mk.body.defaults.responsibilities.losses_collector === "stripe", "the company gets the full Stripe Dashboard, pays Stripe's fees itself, and Stripe carries the risk");
ok(mk.body.configuration.merchant.capabilities.card_payments.requested === true && mk.body.identity.country === "us" && mk.body.defaults.currency === "usd", "it can take cards, in the US, in dollars");
ok(mk.body.display_name === "Blue Moving" && mk.body.contact_email === "ana@bluemoving.example", "named for the company, with the owner's email filled in");
ok(/^tally-acct-33333333-3333-3333-3333-333333333333-test-0$/.test(mk.idem), "made with a key that makes a double tap harmless");
const lk = last("/v2/core/account_links");
ok(lk.body.use_case.type === "account_onboarding" && lk.body.use_case.account_onboarding.configurations.join() === "merchant" && lk.body.use_case.account_onboarding.return_url === BASE + "/connect/done" && lk.body.use_case.account_onboarding.refresh_url === BASE + "/connect/again", "the sign-up link comes back to MoveCrew's own pages");
const A1 = acctOfBlue();
ok(/^acct_/.test(A1) && DB.pay_accounts.length === 1 && DB.pay_accounts[0].is_current === true && DB.pay_accounts[0].livemode === false && DB.pay_accounts[0].created_by === "Ana", "the account is kept for the company, in test mode");
const ch = ST.hooks.find((w: any) => w.connect);
ok(ch && ch.url === BASE + "/stripe/connect" && ch.enabled_events.indexOf("account.updated") >= 0 && ch.enabled_events.indexOf("payment_intent.succeeded") >= 0 && secretOf("pay_config_connect") === ch.secret, "a second webhook, for the companies' own accounts, is made and its secret kept");
r = await app("tok-ana", { action: "pay_connect", org: BLUE });
ok(r.body.ok && acctOfBlue() === A1 && DB.pay_accounts.length === 1 && Object.keys(ST.accounts).length === 1, "pressing it again picks up the same account with a fresh link");
let g = await getUrl("/connect/done");
ok(g.status === 200 && /Go back to MoveCrew: Setup › Payments shows when Stripe has finished/.test(g.text), "Stripe's return page says what's next");
g = await getUrl("/connect/again");
ok(g.status === 200 && /expired or was already used/.test(g.text) && /Continue with Stripe/.test(g.text), "an old sign-up link says to start again from MoveCrew (it can't make one: that would need the owner signed in)");

/* ---------- waiting on Stripe ---------- */
r = await app("tok-ana", { action: "pay_config", org: BLUE });
ok(r.body.ready === false && r.body.reason === "connect-pending" && r.body.connect.state === "started" && r.body.connect.due.indexOf("external_account") >= 0, "until Stripe has the details, cards are off and the owner sees what's still due");
r = await app("tok-ana-lead", { action: "pay_link", org: BLUE, jobId: "b1", amount: 100 });
ok(!r.body.ok && /Stripe is still checking this company's details/.test(r.body.message) && count("/v1/checkout/sessions") === 0, "a payment waits for Stripe");
ST.accounts[A1].submitted = true; ST.accounts[A1].due = [];
r = await app("tok-ana", { action: "pay_config", org: BLUE, refresh: true });
ok(r.body.connect.state === "started", "asking again within 3 seconds doesn't ask Stripe again");
const asks = count("/v1/accounts/" + A1, "GET");
for (let i = 0; i < 5; i++) await app("tok-ana-lead", { action: "pay_config", org: BLUE, refresh: true });
ok(count("/v1/accounts/" + A1, "GET") === asks, "nor does a crew phone asking over and over");
DB.pay_accounts[0].updated_at = new Date(Date.now() - 60e3).toISOString();   // a minute later
r = await app("tok-ana", { action: "pay_config", org: BLUE, refresh: true });
ok(r.body.connect.state === "review" && r.body.ready === false, "details sent, Stripe checking: the owner is told so");
// Stripe says yes: the account.updated event on the companies' webhook
ST.accounts[A1].charges = true; ST.accounts[A1].payouts = true;
await fn.ensureWebhook("platform");
ok(secretOf("pay_config") && secretOf("pay_config") !== secretOf("pay_config_connect"), "the platform's own webhook has a secret of its own");
let h = await hook("/stripe/connect", { id: "evt_a1", type: "account.updated", livemode: false, account: A1, data: { object: { id: A1, object: "account", charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [] } } } }, secretOf("pay_config"));
ok(h.status === 400, "the companies' webhook refuses an event signed for the platform's own webhook");
h = await hook("/stripe/connect", { id: "evt_a1", type: "account.updated", livemode: false, account: A1, data: { object: { id: A1, object: "account", charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [] } } } }, secretOf("pay_config_connect"));
ok(h.status === 200 && DB.pay_accounts[0].charges_enabled === true && DB.pay_accounts[0].payouts_enabled === true, "Stripe's account.updated turns card payments on");
r = await app("tok-ana-lead", { action: "pay_config", org: BLUE });
ok(r.body.ready && r.body.via === "connect" && r.body.account === A1 && r.body.publishableKey === "pk_test_platform" && r.body.connect.state === "ready", "ready: the app is told which account its card box works on");

/* ---------- payments on the company's own account ---------- */
const before = calls.length;
r = await app("tok-ana-lead", { action: "pay_link", org: BLUE, jobId: "b1", amount: 400 });
ok(r.body.ok && /\/p\/[A-Za-z0-9]{10}$/.test(r.body.url), "the lead makes a pay link");
const pay = calls.slice(before).filter((c) => /customers|checkout\/sessions|payment_intents/.test(c.path));
ok(pay.length >= 2 && pay.every((c) => c.acct === A1), "the customer and the Stripe page are made on Blue Moving's own account (" + pay.map((c) => c.path + "@" + c.acct).join(", ") + ")");
const cs = last("/v1/checkout/sessions");
ok(cs.acct === A1 && !Object.keys(cs.p).some((k) => /application_fee/.test(k)), "MoveCrew takes no cut of the payment");
const link = DB.pay_links.find((l) => l.job_id === "b1");
ok(link && link.account === A1, "the pay link remembers its account");
g = await getUrl("/p/" + link.token);
ok(g.status === 302 && g.loc === ST.sessions[link.session_id].url, "the short link opens Blue Moving's Stripe page");
// the customer pays; Stripe tells the companies' webhook, naming the account
const s0 = ST.sessions[link.session_id], pid = "pi_" + (++ST.n);
ST.intents[pid] = { id: pid, object: "payment_intent", amount: 40000, customer: s0.params.customer, metadata: unflat(s0.params, "payment_intent_data[metadata]"), livemode: false, created: 1, status: "succeeded", payment_method: "pm_v1", amount_received: 40000, latest_charge: null, last_payment_error: null, acct: A1, payment_method_options: { card: {} } };
ST.pms.pm_v1 = { ...PM("pm_v1", "4242", "fpA"), acct: A1 };
charge(ST.intents[pid]); s0.status = "complete"; s0.payment_intent = pid;
h = await hook("/stripe/connect", { id: "evt_p1", type: "checkout.session.completed", livemode: false, account: A1, data: { object: { id: s0.id, object: "checkout.session", payment_intent: pid, metadata: s0.metadata } } }, secretOf("pay_config_connect"));
let b1 = doc(BLUE, "jobs/b1");
ok(h.status === 200 && b1.payments["st_" + pid] && b1.payments["st_" + pid].amt === 400, "the payment lands on Blue Moving's job");
const lg = DB.pay_log.find((x) => x.pi === pid);
ok(lg && lg.account === A1 && lg.org_id === BLUE, "and in the ledger, on Blue Moving's account");
ok(DB.pay_links.find((l) => l.token === link.token).status === "paid", "the link is done");
ok(DB.pay_jobs.some((x) => x.job_id === "b1" && x.account === A1), "the job is tied to its customer on that account");
// a card typed in on the crew's phone
r = await app("tok-ana-lead", { action: "pay_intent", org: BLUE, jobId: "b1", amount: 100, save: true });
const tp = last("/v1/payment_intents");
ok(r.body.ok && r.body.account === A1 && tp.acct === A1 && /^pi_\d+_secret_x$/.test(r.body.clientSecret), "a typed card's payment is made on the same account, and the phone is told which one");
const tpi = ST.intents[r.body.clientSecret.split("_secret")[0]];
tpi.status = "succeeded"; tpi.amount_received = 10000; tpi.payment_method = "pm_v2"; ST.pms.pm_v2 = { ...PM("pm_v2", "1881", "fpB"), acct: A1, customer: tpi.customer }; charge(tpi);
r = await app("tok-ana-lead", { action: "pay_check", org: BLUE, jobId: "b1", pi: tpi.id });
b1 = doc(BLUE, "jobs/b1");
ok(r.body.ok && b1.payments["st_" + tpi.id] && b1.payments["st_" + tpi.id].amt === 100, "checked and written down");
const card = DB.pay_cards.find((c) => c.pm_id === "pm_v2");
ok(card && card.account === A1 && card.org_id === BLUE, "the card kept on file remembers its account");
// charging that card on file
r = await app("tok-ana-lead", { action: "pay_saved", org: BLUE, jobId: "b1", vaultId: card.id, amount: 50 });
const sv = last("/v1/payment_intents");
ok(r.body.ok && sv.acct === A1 && sv.p.payment_method === "pm_v2" && sv.p.off_session === "true", "the card on file is charged on Blue Moving's account: " + r.body.message);
card.account = "acct_1Other000";
r = await app("tok-ana-lead", { action: "pay_saved", org: BLUE, jobId: "b1", vaultId: card.id, amount: 50 });
ok(!r.body.ok && /kept on file on a different Stripe account/.test(r.body.message), "a card kept on another Stripe account can't be charged here");
card.account = A1;

/* ---------- only Blue Moving's account writes to Blue Moving ---------- */
// another company's Stripe account (connected to MoveCrew too) sends a payment that claims to be Blue's or Richie's
ST.accounts.acct_1Rogue0000 = { id: "acct_1Rogue0000", charges: true, due: [] };
DB.pay_accounts.push({ account_id: "acct_1Rogue0000", org_id: "44444444-4444-4444-4444-444444444444", livemode: false, is_current: true, charges_enabled: true, due: [] });
DB.orgs.push({ id: "44444444-4444-4444-4444-444444444444" });
for (const [org, jobId] of [[BLUE, "b2"], [RICH, "r1"]]) {
  const rid = "pi_" + (++ST.n);
  ST.intents[rid] = { id: rid, object: "payment_intent", amount: 99900, customer: null, metadata: { tally_org: org, tally_job: jobId, tally_src: "link" }, livemode: false, created: 1, status: "succeeded", payment_method: null, amount_received: 99900, latest_charge: null, acct: "acct_1Rogue0000", payment_method_options: { card: {} } };
  h = await hook("/stripe/connect", { id: "evt_r" + rid, type: "payment_intent.succeeded", livemode: false, account: "acct_1Rogue0000", data: { object: { id: rid, object: "payment_intent", status: "succeeded", metadata: ST.intents[rid].metadata } } }, secretOf("pay_config_connect"));
  ok(h.status === 200 && Object.keys(doc(org, "jobs/" + jobId).payments).length === 0 && !DB.pay_log.some((x) => x.pi === rid), "a payment on someone else's Stripe account can't mark " + (org === BLUE ? "Blue Moving's" : "Richie's") + " job paid");
}
h = await hook("/stripe/connect", { id: "evt_noacct", type: "payment_intent.succeeded", livemode: false, data: { object: { id: pid, object: "payment_intent" } } }, secretOf("pay_config_connect"));
ok(h.status === 200 && /no-account/.test(h.text), "an event on the companies' webhook without an account is ignored");

/* ---------- Richie's own company is unchanged ---------- */
const rb = calls.length;
r = await app("tok-richie", { action: "pay_link", org: RICH, jobId: "r1", amount: 200 });
ok(r.body.ok && calls.slice(rb).filter((c) => /checkout\/sessions|customers/.test(c.path)).every((c) => c.acct === ""), "Richie's company still takes payments on the platform's own account");
ok(ST.hooks.some((w: any) => !w.connect && w.url === BASE + "/stripe"), "with the platform's own webhook");

/* ---------- disconnected in Stripe, then connected again ---------- */
h = await hook("/stripe/connect", { id: "evt_d1", type: "account.application.deauthorized", livemode: false, account: A1, data: { object: { id: "ca_x", object: "application" } } }, secretOf("pay_config_connect"));
ok(h.status === 200 && DB.pay_accounts.find((a) => a.account_id === A1).charges_enabled === false, "the company disconnected MoveCrew in its Stripe dashboard: cards stop");
r = await app("tok-ana", { action: "pay_config", org: BLUE });
ok(r.body.ready === false && r.body.reason === "connect-off" && r.body.connect.state === "disconnected", "the owner sees it was disconnected");
r = await app("tok-ana-lead", { action: "pay_link", org: BLUE, jobId: "b2", amount: 100 });
ok(!r.body.ok && /disconnected from MoveCrew/.test(r.body.message), "a payment says why");
ST.accounts[A1].gone = true;
r = await app("tok-ana", { action: "pay_connect", org: BLUE });
const A2 = acctOfBlue();
ok(r.body.ok && /^https:\/\/accounts\.stripe\.com/.test(r.body.url) && A2 && A2 !== A1 && /-test-1$/.test(last("/v2/core/accounts").idem), "connecting again makes a new account");
ok(DB.pay_accounts.find((a) => a.account_id === A1).is_current === false, "the old one is kept, no longer current, for its old payments");
// a refund on an old payment still reaches the job
ST.charges[ST.intents[pid].latest_charge].amount_refunded = 5000;
ST.accounts[A1].gone = false;
h = await hook("/stripe/connect", { id: "evt_rf", type: "charge.refunded", livemode: false, account: A1, data: { object: { id: ST.intents[pid].latest_charge, object: "charge", payment_intent: pid } } }, secretOf("pay_config_connect"));
b1 = doc(BLUE, "jobs/b1");
ok(h.status === 200 && b1.payments["rf_" + pid] && b1.payments["rf_" + pid].amt === -50, "a refund made later on the old account still shows on the job");
ok(DB.pay_jobs.find((x) => x.job_id === "b1").account === A1, "an old payment's refund doesn't move the job to the old account");
// the new account takes over once Stripe says yes
ST.accounts[A2].charges = true; ST.accounts[A2].submitted = true; ST.accounts[A2].due = [];
DB.pay_accounts.find((a) => a.account_id === A2).updated_at = new Date(Date.now() - 60e3).toISOString();
r = await app("tok-ana", { action: "pay_config", org: BLUE, refresh: true });
ok(r.body.ready && r.body.account === A2, "the new account is ready");
r = await app("tok-ana-lead", { action: "pay_link", org: BLUE, jobId: "b1", amount: 100 });
const cs2 = last("/v1/checkout/sessions"), cus2 = cs2.p.customer;
ok(r.body.ok && cs2.acct === A2 && ST.customers.find((c: any) => c.id === cus2).acct === A2, "payments now go to the new account, with the customer made again there");
ok(DB.pay_customers.some((c) => c.org_id === BLUE && c.cust_key === A2 + "|5125550142" && c.account === A2), "the customer on the new account is filed under that account");
r = await app("tok-ana-lead", { action: "pay_saved", org: BLUE, jobId: "b1", vaultId: card.id, amount: 50 });
ok(!r.body.ok && /different Stripe account/.test(r.body.message), "a card kept on the old account can't be charged on the new one");
g = await getUrl("/p/" + link.token);
ok(g.status === 200 && /payment is done/.test(g.text), "the old, paid link still says it's done");

/* ---------- live mode is its own ---------- */
Deno.env.set("STRIPE_SECRET_KEY", "sk_live_platform");
Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_live_platform");
r = await app("tok-ana", { action: "pay_config", org: BLUE });
ok(r.body.ready === false && r.body.reason === "connect" && r.body.test === false, "with live keys, a company connects its real Stripe account (a test connection doesn't carry over)");

console.log("\n" + passes + " passed, " + failures + " failed");
Deno.exit(failures ? 1 : 0);
