// Card payments in the Edge Function: an in-memory PostgREST (with pay_record and pay_reopen), a fake
// Stripe API that behaves like API version 2026-09-30.endive, and signed Stripe events.
// Run: deno run -A tests/function/pay.ts
// deno-lint-ignore-file no-explicit-any
(globalThis as any).__TALLY_TEST = true;
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
Deno.env.set("TWILIO_AUTH_TOKEN", "tok123");
const fn = await import("../../supabase/functions/tally-twilio/index.ts");
const BASE = "https://proj.supabase.co/functions/v1/tally-twilio";

let failures = 0, passes = 0;
function ok(c: unknown, m: string) { if (c) { passes++; console.log("PASS", m); } else { failures++; console.log("FAIL", m); } }

/* ---------- in-memory database ---------- */
const DB: Record<string, any[]> = { docs: [], members: [], orgs: [], comm_lines: [], comm_log: [], comm_job_state: [], pay_orgs: [], pay_customers: [], pay_links: [], pay_log: [], pay_config: [], pay_cards: [], pay_jobs: [], pay_locks: [] };
const KEYS: Record<string, string[]> = { docs: ["org_id", "path"], orgs: ["id"], pay_orgs: ["org_id"], pay_customers: ["org_id", "cust_key", "livemode"], pay_links: ["token"], pay_log: ["pi"], pay_config: ["mode"], pay_cards: ["id"], pay_jobs: ["org_id", "job_id", "livemode"], pay_locks: ["org_id", "job_id"] };
let nextId = 1;
const clone = (o: any) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
function getField(row: any, key: string) {
  if (key.indexOf("->") < 0) return row[key];
  const parts = key.split(/->>?/);
  let v = row[parts[0]];
  for (const p of parts.slice(1)) v = v == null ? v : v[p];
  return v == null ? v : String(v);
}
function matches(row: any, filters: [string, string][]) {
  return filters.every(([k, f]) => {
    const i = f.indexOf("."), op = f.slice(0, i), val = f.slice(i + 1), v = getField(row, k);
    if (op === "eq") return String(v) === val;
    if (op === "neq") return String(v) !== val;
    if (op === "is") return val === "true" ? v === true : val === "null" ? v == null : v === false;
    if (op === "gte") return String(v) >= val;
    if (op === "lt") return String(v) < val;
    if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").indexOf(String(v)) >= 0;
    throw new Error("op " + op);
  });
}
// the same rules as supabase-payments.sql
function payRecord(b: any) {
  const row = DB.docs.find((r) => r.org_id === b.o && r.path === "jobs/" + b.job);
  if (!row) return null;
  const d = clone(row.data);
  const old = d.payments && d.payments[b.pay_id];
  if (b.payment != null && old && String(old.amt) === String(b.payment.amt) && !!old.pending === !!b.payment.pending && (old.method || "") === (b.payment.method || "")) return d;
  if (b.payment == null && !old) return d;
  if (!d.payments || typeof d.payments !== "object" || Array.isArray(d.payments)) d.payments = {};
  if (b.payment == null) delete d.payments[b.pay_id]; else d.payments[b.pay_id] = b.payment;
  if (b.log_key && b.log_entry) { if (!d.log || typeof d.log !== "object") d.log = {}; d.log[b.log_key] = b.log_entry; }
  if (b.mark_paid && d.status === "done") d.status = "paid";
  row.data = d; row.updated_at = new Date().toISOString();
  return d;
}
function payReopen(b: any) {
  const row = DB.docs.find((r) => r.org_id === b.o && r.path === "jobs/" + b.job);
  if (!row || row.data.status !== "paid") return false;
  const d = clone(row.data);
  d.status = "done";
  if (b.log_key && b.log_entry) { if (!d.log || typeof d.log !== "object") d.log = {}; d.log[b.log_key] = b.log_entry; }
  row.data = d;
  return true;
}
function restMock(method: string, u: URL, body: any, prefer: string) {
  const parts = u.pathname.split("/");
  if (parts[parts.length - 2] === "rpc") {
    const name = parts[parts.length - 1];
    if (name === "pay_record") return { status: 200, body: payRecord(body) };
    if (name === "pay_reopen") return { status: 200, body: payReopen(body) };
    return { status: 404, body: { message: "no function" } };
  }
  const table = parts.pop()!;
  const rows = DB[table];
  if (!rows) return { status: 404, body: { message: "no table " + table } };
  const filters: [string, string][] = []; let limit = 1e9, onConflict = "";
  u.searchParams.forEach((v, k) => {
    if (k === "select" || k === "order") return; if (k === "limit") { limit = +v; return; } if (k === "on_conflict") { onConflict = v; return; }
    filters.push([k, v]);
  });
  const rep = prefer.indexOf("return=representation") >= 0;
  if (method === "GET") return { status: 200, body: clone(rows.filter((r) => matches(r, filters)).slice(0, limit)) };
  if (method === "POST") {
    const list = Array.isArray(body) ? body : [body], added: any[] = [];
    for (const r0 of list) {
      const r = clone(r0);
      if (!r.created_at && table !== "docs" && table !== "pay_config") r.created_at = new Date().toISOString();
      if (table === "pay_config" && !r.updated_at) r.updated_at = new Date().toISOString();
      if (table === "pay_config" && r.events == null) r.events = "";
      if (table === "comm_log") { r.id = nextId++; }
      const keys = (onConflict ? onConflict.split(",") : KEYS[table]) || [];
      const hit = keys.length ? rows.find((x) => keys.every((k) => String(x[k]) === String(r[k]))) : null;
      if (hit) {
        if (prefer.indexOf("ignore-duplicates") >= 0) continue;
        if (prefer.indexOf("merge-duplicates") >= 0) { delete r.created_at; Object.assign(hit, r); added.push(hit); continue; }
        return { status: 409, body: { message: "duplicate key" } };
      }
      rows.push(r); added.push(r);
    }
    return { status: 201, body: rep ? clone(added) : null };
  }
  if (method === "PATCH") {
    const hit = rows.filter((r) => matches(r, filters));
    hit.forEach((r) => Object.assign(r, clone(body)));
    return { status: 200, body: rep ? clone(hit) : null };
  }
  if (method === "DELETE") {
    DB[table] = rows.filter((r) => !matches(r, filters));
    return { status: 204, body: null };
  }
  return { status: 405, body: null };
}

/* ---------- a fake Stripe (API version 2026-09-30.endive) ---------- */
const stripeCalls: any[] = [];
const ST: any = { customers: [], sessions: {}, intents: {}, charges: {}, disputes: [], hooks: [], idem: {}, detached: [], n: 0 };
const PMS: Record<string, any> = {
  pm_ok: { id: "pm_ok", type: "card", customer: null, billing_details: { name: "Priya Nair" }, card: { brand: "visa", last4: "4242", exp_month: 3, exp_year: 2030, fingerprint: "fpA" } },
  pm_ok2: { id: "pm_ok2", type: "card", customer: null, billing_details: { name: "Priya Nair" }, card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2031, fingerprint: "fpA" } },
  pm_mc: { id: "pm_mc", type: "card", customer: null, billing_details: { name: null }, card: { brand: "mastercard", last4: "4444", exp_month: 1, exp_year: 2029, fingerprint: "fpB" } },
  pm_apple: { id: "pm_apple", type: "card", customer: null, card: { brand: "amex", last4: "0005", exp_month: 1, exp_year: 2029, fingerprint: "fpC", wallet: { type: "apple_pay" } } },
  pm_bank: { id: "pm_bank", type: "us_bank_account", customer: null, us_bank_account: { last4: "6789", bank_name: "STRIPE TEST BANK" } },
  pm_auth: { id: "pm_auth", type: "card", customer: null, card: { brand: "visa", last4: "3184", exp_month: 1, exp_year: 2031, fingerprint: "fpD" } },
  pm_decline: { id: "pm_decline", type: "card", customer: null, card: { brand: "visa", last4: "9995", exp_month: 1, exp_year: 2031, fingerprint: "fpE" } },
  pm_other: { id: "pm_other", type: "card", customer: "cus_9", card: { brand: "visa", last4: "1881", exp_month: 1, exp_year: 2031, fingerprint: "fpF" } },
  pm_jsA: { id: "pm_jsA", type: "card", customer: null, billing_details: { name: "John Smith" }, card: { brand: "visa", last4: "1234", exp_month: 5, exp_year: 2030, fingerprint: "fpJ" } },
  pm_v25: { id: "pm_v25", type: "card", customer: null, billing_details: { name: "Priya Nair" }, card: { brand: "visa", last4: "5556", exp_month: 6, exp_year: 2030, fingerprint: "fpV" } },
};
let stripeDown = "";
const OPEN = ["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture"];
function unflat(p: Record<string, string>, prefix: string) {
  const out: any = {};
  Object.keys(p).forEach((k) => { if (k.indexOf(prefix + "[") === 0) { const m = /^\[([^\]]+)\]$/.exec(k.slice(prefix.length)); if (m) out[m[1]] = p[k]; } });
  return out;
}
const expands = (p: Record<string, string>) => Object.keys(p).filter((k) => /^expand\[\d+\]$/.test(k)).map((k) => p[k]);
function piView(pi: any, exp: string[]) {
  const v = clone(pi);
  delete v.params;
  if (exp.indexOf("payment_method") >= 0 && typeof v.payment_method === "string" && PMS[v.payment_method]) v.payment_method = clone(PMS[v.payment_method]);
  if (exp.indexOf("latest_charge") >= 0 && typeof v.latest_charge === "string") v.latest_charge = clone(ST.charges[v.latest_charge]);
  return v;
}
function makeCharge(pi: any) {
  if (pi.latest_charge) return;
  const cid = "ch_" + (++ST.n);
  ST.charges[cid] = { id: cid, object: "charge", payment_intent: pi.id, amount: pi.amount, amount_refunded: 0, disputed: false, livemode: pi.livemode };
  pi.latest_charge = cid;
}
function keepPm(pi: any, pm: string) {
  const sfu = pi.setup_future_usage || (pi.payment_method_options && pi.payment_method_options.card && pi.payment_method_options.card.setup_future_usage);
  if (sfu === "off_session" && PMS[pm]) PMS[pm].customer = pi.customer;
}
function stripeApi(method: string, path: string, p: Record<string, string>, h: any) {
  const reply = (status: number, b: any) => ({ status, body: b });
  if (stripeDown) return reply(stripeDown === "auth" ? 401 : 500, { error: { type: "api_error", message: "Invalid API Key provided: sk_t***" } });
  const live = /^Bearer (sk|rk)_live_/.test(String(h.Authorization || ""));
  const id = () => String(++ST.n), exp = expands(p), now = Math.floor(Date.now() / 1000);
  // endive took payment_method_types away from PaymentIntents and Checkout Sessions
  if (Object.keys(p).some((k) => /^payment_method_types\[/.test(k)) && (path === "/v1/payment_intents" || path === "/v1/checkout/sessions" || /\/confirm$/.test(path))) {
    return reply(400, { error: { type: "invalid_request_error", code: "payment_method_types_no_longer_supported", message: "payment_method_types is no longer supported on this API version." } });
  }
  let m: RegExpExecArray | null;
  if (method === "POST" && path === "/v1/customers") { const c = { id: "cus_" + (live ? "L" : "") + id(), name: p.name, phone: p.phone, email: p.email, metadata: unflat(p, "metadata"), livemode: live }; ST.customers.push(c); return reply(200, c); }
  if (method === "GET" && path === "/v1/webhook_endpoints") return reply(200, { data: clone(ST.hooks) });
  if (method === "POST" && path === "/v1/webhook_endpoints") {
    const events = Object.keys(p).filter((k) => /^enabled_events\[\d+\]$/.test(k)).map((k) => p[k]);
    const w = { id: "we_" + id(), url: p.url, enabled_events: events, api_version: p.api_version, status: "enabled", secret: "whsec_test_" + ST.n, livemode: live };
    ST.hooks.push(w); return reply(200, w);
  }
  if ((m = /^\/v1\/webhook_endpoints\/(\w+)$/.exec(path))) {
    const w = ST.hooks.find((x: any) => x.id === m![1]);
    if (method === "DELETE") { ST.hooks = ST.hooks.filter((x: any) => x.id !== m![1]); return reply(200, { id: m[1], deleted: true }); }
    if (!w) return reply(404, { error: { type: "invalid_request_error", message: "No such webhook endpoint" } });
    if (method === "POST") { const events = Object.keys(p).filter((k) => /^enabled_events\[\d+\]$/.test(k)).map((k) => p[k]); if (events.length) w.enabled_events = events; }
    const out = clone(w); delete out.secret; return reply(200, out);
  }
  if (method === "POST" && path === "/v1/checkout/sessions") {
    const sid = (live ? "cs_live_" : "cs_test_") + id();
    const s = { id: sid, object: "checkout.session", url: "https://checkout.stripe.com/c/pay/" + sid + "#fidkdWxOYHwnPyd1blpxYHZxWjA0", status: "open", payment_status: "unpaid",
      expires_at: +p.expires_at, payment_intent: null, metadata: unflat(p, "metadata"), amount_total: +p["line_items[0][price_data][unit_amount]"], livemode: live, params: p };
    ST.sessions[sid] = s; return reply(200, s);
  }
  if ((m = /^\/v1\/checkout\/sessions\/(\w+)(\/expire)?$/.exec(path))) {
    const s = ST.sessions[m[1]];
    if (!s) return reply(404, { error: { type: "invalid_request_error", message: "No such checkout.session" } });
    if (method === "GET") return reply(200, s);
    if (s.status !== "open") return reply(400, { error: { type: "invalid_request_error", message: "Only Checkout Sessions with a status of open can be expired." } });
    if (s.paying) return reply(400, { error: { type: "invalid_request_error", message: "This Checkout Session has a payment in progress." } });
    s.status = "expired"; return reply(200, s);
  }
  if (method === "POST" && path === "/v1/payment_intents") {
    const key = h["Idempotency-Key"];
    if (key && ST.idem[key]) return clone(ST.idem[key]);
    const pid = "pi_" + id();
    const pi: any = { id: pid, object: "payment_intent", amount: +p.amount, currency: p.currency, customer: p.customer, metadata: unflat(p, "metadata"), livemode: live, created: now,
      status: "requires_payment_method", client_secret: pid + "_secret_abc", payment_method: p.payment_method || null, setup_future_usage: p.setup_future_usage || null,
      payment_method_options: { card: { setup_future_usage: p["payment_method_options[card][setup_future_usage]"] || null } }, params: p, amount_received: 0, latest_charge: null, last_payment_error: null };
    ST.intents[pid] = pi;
    let out: any;
    if (p.confirm === "true") {
      if (p.payment_method === "pm_auth" || p.payment_method === "pm_decline") {
        const auth = p.payment_method === "pm_auth";
        pi.last_payment_error = auth ? { code: "authentication_required", message: "This payment requires authentication." } : { code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." };
        out = reply(402, { error: { type: "card_error", code: auth ? "authentication_required" : "card_declined", decline_code: auth ? "authentication_required" : "insufficient_funds", message: pi.last_payment_error.message, payment_intent: piView(pi, []) } });
      } else {
        pi.status = "succeeded"; pi.amount_received = pi.amount; makeCharge(pi);
        out = reply(200, piView(pi, exp));
      }
    } else out = reply(200, piView(pi, exp));
    if (key) ST.idem[key] = clone(out);
    return out;
  }
  if ((m = /^\/v1\/payment_intents\/(\w+)(\/cancel)?$/.exec(path))) {
    const pi = ST.intents[m[1]];
    if (!pi || !!pi.livemode !== live) return reply(404, { error: { type: "invalid_request_error", message: "No such payment_intent: '" + m[1] + "'" } });
    if (method === "GET") return reply(200, piView(pi, exp));
    if (OPEN.indexOf(pi.status) < 0) return reply(400, { error: { type: "invalid_request_error", code: "payment_intent_unexpected_state", message: "You cannot cancel this PaymentIntent because it has a status of " + pi.status + "." } });
    if (pi.checkout && pi.status !== "requires_capture") { ST.refusedCancels = (ST.refusedCancels || 0) + 1; return reply(400, { error: { type: "invalid_request_error", message: "This PaymentIntent was created by a Checkout Session. Expire the session instead." } }); }
    pi.status = "canceled"; pi.cancellation_reason = p.cancellation_reason;
    return reply(200, piView(pi, exp));
  }
  if (method === "GET" && path === "/v1/disputes") return reply(200, { data: clone(ST.disputes.filter((d: any) => d.payment_intent === p.payment_intent)) });
  if (method === "POST" && (m = /^\/v1\/payment_methods\/(\w+)\/detach$/.exec(path))) {
    const pm = PMS[m[1]];
    if (!pm || !pm.customer) return reply(400, { error: { type: "invalid_request_error", message: "The payment method you provided is not attached to a customer so detachment is impossible." } });
    pm.customer = null; ST.detached.push(m[1]); return reply(200, clone(pm));
  }
  return reply(404, { error: { message: "fake stripe: no route " + method + " " + path } });
}
// the customer paying on a pay link's Stripe page
function customerPays(sid: string, pm: string, status = "succeeded") {
  const s = ST.sessions[sid];
  if (!s || s.status !== "open") throw new Error("session " + sid + " is " + (s && s.status));
  const p = s.params, pid = "pi_" + (++ST.n);
  const pi: any = { id: pid, object: "payment_intent", amount: s.amount_total, currency: "usd", customer: p.customer, metadata: unflat(p, "payment_intent_data[metadata]"), livemode: s.livemode,
    created: Math.floor(Date.now() / 1000), status, payment_method: pm, setup_future_usage: null, payment_method_options: { card: { setup_future_usage: p["payment_method_options[card][setup_future_usage]"] || null } },
    amount_received: status === "succeeded" ? s.amount_total : 0, latest_charge: null, last_payment_error: null, checkout: true };
  ST.intents[pid] = pi;
  if (status === "succeeded" || status === "processing") makeCharge(pi);
  keepPm(pi, pm);
  s.status = "complete"; s.payment_status = status === "succeeded" ? "paid" : "unpaid"; s.payment_intent = pid;
  return pi;
}
// the customer confirming a typed card in Stripe's card box
function confirms(pid: string, pm: string, status = "succeeded") {
  const pi = ST.intents[pid];
  pi.status = status; pi.payment_method = pm; pi.amount_received = status === "succeeded" ? pi.amount : 0;
  if (status === "succeeded" || status === "processing") makeCharge(pi);
  keepPm(pi, pm);
  return pi;
}

/* ---------- fake Twilio and auth ---------- */
const sent: any[] = [];
const USERS: Record<string, string> = { "tok-owner": "u-owner", "tok-boss": "u-boss", "tok-boss2": "u-boss2", "tok-dispatch": "u-dispatch", "tok-marcus": "u-marcus", "tok-dee": "u-dee", "tok-kim": "u-kim", "tok-stranger": "u-stranger" };
(globalThis as any).fetch = async (input: string, init: any = {}) => {
  const u = new URL(input), method = (init.method || "GET").toUpperCase();
  const reply = (status: number, b: any) => new Response(status === 204 ? null : b == null ? "" : JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (u.host === "api.stripe.com") {
    const h = init.headers || {};
    const p: Record<string, string> = method === "GET" ? Object.fromEntries(u.searchParams) : Object.fromEntries(new URLSearchParams(init.body || ""));
    stripeCalls.push({ method, path: u.pathname, p, idem: h["Idempotency-Key"], ver: h["Stripe-Version"], auth: h.Authorization });
    const r = stripeApi(method, u.pathname, p, h);
    return reply(r.status, r.body);
  }
  if (u.host === "api.twilio.com") {
    const p = Object.fromEntries(new URLSearchParams(init.body));
    const sid = "SM" + (sent.length + 1);
    sent.push({ sid, ...p });
    return reply(201, { sid, status: "queued" });
  }
  if (u.pathname === "/auth/v1/user") {
    const t = String(init.headers.Authorization || "").replace("Bearer ", "");
    return USERS[t] ? reply(200, { id: USERS[t] }) : reply(401, { message: "bad jwt" });
  }
  if (u.pathname.startsWith("/rest/v1/")) {
    const h = init.headers || {};
    if (h.Authorization !== "Bearer service") return reply(401, { message: "not service" });
    const r = restMock(method, u, init.body ? JSON.parse(init.body) : undefined, h.Prefer || "");
    return reply(r.status, r.body);
  }
  throw new Error("unexpected fetch " + input);
};

/* ---------- a company ---------- */
const ORG = "11111111-1111-1111-1111-111111111111", ORG2 = "22222222-2222-2222-2222-222222222222";
DB.orgs.push({ id: ORG, name: "Ace Moving" }, { id: ORG2, name: "Stranger Co" });
const settings = {
  company: "Ace Moving",
  contacts: { Owner: "512-555-0100", Dispatch: "512-555-0199", Marcus: "512-555-0101", Dee: "512-555-0102", Kim: "512-555-0106" },
  office: [{ name: "Owner", kind: "owner" }, { name: "Dispatch", kind: "dispatch" }], leads: ["Marcus", "Dee"],
  forms: [{ id: "f1", title: "Bill of lading", required: true }],
};
function job(id: string, over: any = {}) {
  return { id, status: "done", d: { name: "Priya Nair", phone: "512-555-0142", email: "priya@example.com", moveDate: "2026-10-06", time: "08:00" },
    quote: { total: 1200, deposit: 300 }, assign: { truckId: "", crew: ["Marcus", "Kim"] }, signed: { s1: { id: "s1", formId: "f1" } },
    payments: { p0: { id: "p0", amt: 200, method: "Cash", date: "2026-10-01", ts: 1 } }, extras: { e1: { id: "e1", label: "Stairs", amt: 50, ts: 1 } },
    materials: { m1: { id: "m1", name: "Boxes", qty: 3, price: 4.5, ts: 1 } }, log: {}, ...over };
}
function putDoc(org: string, path: string, data: any) {
  const [collection, doc_id] = path.split("/");
  const i = DB.docs.findIndex((r) => r.org_id === org && r.path === path);
  const row = { org_id: org, path, collection, doc_id, data: clone(data), updated_at: new Date().toISOString() };
  if (i >= 0) DB.docs[i] = row; else DB.docs.push(row);
}
const doc = (path: string, org = ORG) => (DB.docs.find((r) => r.org_id === org && r.path === path) || {}).data;
// a phone saving a cash payment onto a job
function cash(jobId: string, amt: number) { const j = doc("jobs/" + jobId); j.payments["c" + (++ST.n)] = { id: "c" + ST.n, amt, method: "Cash", date: "2026-10-06", ts: Date.now() }; putDoc(ORG, "jobs/" + jobId, j); }
const logs = (jobId: string) => Object.values(doc("jobs/" + jobId).log || {}).map((l: any) => l.ev);
putDoc(ORG, "org/settings", settings);
putDoc(ORG, "jobs/j1", job("j1"));   // 1200 + 50 stairs + 13.50 boxes = 1263.50, paid 200 -> 1063.50 owed
putDoc(ORG2, "org/settings", { company: "Stranger Co" });
putDoc(ORG2, "jobs/s1", job("s1"));
DB.members.push(
  { org_id: ORG, user_id: "u-owner", role: "owner", staff: "Owner" },
  { org_id: ORG, user_id: "u-boss", role: "owner", staff: "" },
  { org_id: ORG, user_id: "u-boss2", role: "owner", staff: "" },
  { org_id: ORG, user_id: "u-dispatch", role: "dispatch", staff: "Dispatch" },
  { org_id: ORG, user_id: "u-marcus", role: "lead", staff: "Marcus" },
  { org_id: ORG, user_id: "u-dee", role: "lead", staff: "Dee" },
  { org_id: ORG, user_id: "u-kim", role: "crew", staff: "Kim" },
  { org_id: ORG2, user_id: "u-stranger", role: "owner", staff: "Zed" },
);
async function app(tok: string, body: any) {
  const r = await fn.handle(new Request(BASE + "/app", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function getUrl(path: string) {
  const r = await fn.handle(new Request(BASE + path, { method: "GET", redirect: "manual" }));
  return { status: r.status, loc: r.headers.get("location") || "", text: r.status === 302 ? "" : await r.text(), type: r.headers.get("content-type") || "" };
}
function secretNow(mode = "test") { const r = DB.pay_config.find((x) => x.mode === mode); return r ? r.webhook_secret : ""; }
async function hook(event: any, o: { secret?: string; t?: number; raw?: string } = {}) {
  const raw = o.raw ?? JSON.stringify(event);
  const t = String(o.t ?? Math.floor(Date.now() / 1000));
  const sig = await fn.stripeSignature(o.raw ? JSON.stringify(event) : raw, o.secret ?? secretNow(event.livemode ? "live" : "test"), t);
  const r = await fn.handle(new Request(BASE + "/stripe", { method: "POST", headers: { "Stripe-Signature": "t=" + t + ",v1=" + sig + ",v0=deadbeef" }, body: raw }));
  return { status: r.status, text: await r.text() };
}
const piEvent = (pi: any, type = "payment_intent.succeeded") => ({ id: "evt_" + pi.id + type, type, livemode: !!pi.livemode, data: { object: { id: pi.id, object: "payment_intent", status: pi.status, metadata: pi.metadata, payment_method: pi.payment_method } } });
const chargeEvent = (pi: any, type = "charge.refunded") => ({ id: "evt_" + pi.latest_charge + type, type, livemode: !!pi.livemode, data: { object: { id: pi.latest_charge, object: "charge", payment_intent: pi.id } } });
const disputeEvent = (d: any, type: string) => ({ id: "evt_" + d.id + type, type, livemode: false, data: { object: { id: d.id, object: "dispute", payment_intent: d.payment_intent, status: d.status, amount: d.amount } } });
const lastCall = (path: string, method = "POST") => [...stripeCalls].reverse().find((c) => c.path === path && c.method === method);
const calls = (path: string, method = "POST") => stripeCalls.filter((c) => c.path === path && c.method === method).length;
const tokenOf = (url: string) => url.split("/p/")[1];
const linkRow = (url: string) => DB.pay_links.find((l) => l.token === tokenOf(url));
const sessionOf = (url: string) => ST.sessions[linkRow(url).session_id];
const lastIntent = () => ST.intents["pi_" + Math.max(...Object.keys(ST.intents).map((k) => +k.slice(3)).filter((n) => n > 0))];
const CARD_OK = await fn.cardId("pm_ok"), CARD_OK2 = await fn.cardId("pm_ok2");
// Priya's Stripe customer (test mode), made the first time she pays
const PRIYA = () => (ST.customers.find((c: any) => c.phone === "+15125550142" && !c.livemode) || {}).id;

/* ---------- helpers ---------- */
ok(fn.jobTotalCents(job("x")) === 126350, "total = quote + extras + priced materials, as the app adds it (1263.50)");
ok(fn.custKeyOf(job("x")) === "5125550142" && fn.custKeyOf({ d: { name: " Ann Lee " } }) === "ann lee", "customer key matches the app's");
ok(fn.methodLabel(PMS.pm_ok) === "Visa ••4242" && fn.methodLabel(PMS.pm_apple) === "Apple Pay (Amex ••0005)" && fn.methodLabel(PMS.pm_bank) === "Bank ••6789", "payment methods read the way the app writes them");
ok(fn.money(-12345) === "-$123.45" && fn.money(106350) === "$1,063.50", "money reads right, refunds included");
ok(fn.stripeForm({ a: 1, b: { c: "x", d: [5, { e: true }] }, z: undefined }).toString() === "a=1&b%5Bc%5D=x&b%5Bd%5D%5B0%5D=5&b%5Bd%5D%5B1%5D%5Be%5D=true", "nested fields are sent the way Stripe reads them");
ok(/^st_[0-9a-f]{20}$/.test(CARD_OK) && CARD_OK !== CARD_OK2 && CARD_OK.indexOf("pm_") < 0, "a card on file is known to the app by a name of our own, not Stripe's id");
{ // our webhook signatures agree with Stripe's own library
  const StripeLib = (await import("npm:stripe@17")).default;
  const lib = new StripeLib("sk_test_x");
  const raw = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
  const header = await lib.webhooks.generateTestHeaderStringAsync({ payload: raw, secret: "whsec_lib" });
  ok(await fn.stripeSigOk(raw, header, ["whsec_lib"]), "a header made by Stripe's library passes our check");
  const t = String(Math.floor(Date.now() / 1000));
  const ours = "t=" + t + ",v1=" + await fn.stripeSignature(raw, "whsec_lib", t);
  let accepted = false;
  try { await lib.webhooks.constructEventAsync(raw, ours, "whsec_lib"); accepted = true; } catch { accepted = false; }
  ok(accepted, "and Stripe's library accepts a signature made our way");
  ok(!(await fn.stripeSigOk(raw, header, ["whsec_other"])), "the wrong secret fails");
  ok(!(await fn.stripeSigOk(raw + " ", header, ["whsec_lib"])), "a changed body fails");
  ok(!(await fn.stripeSigOk(raw, "t=" + (Number(t) - 600) + ",v1=" + await fn.stripeSignature(raw, "whsec_lib", String(Number(t) - 600)), ["whsec_lib"])), "a signature older than five minutes fails");
}

/* ---------- not set up ---------- */
let r = await app("tok-marcus", { action: "pay_config", org: ORG });
ok(r.body.ok && r.body.ready === false && r.body.reason === "no-key", "no Stripe key: payments are off");
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 100 });
ok(!r.body.ok && /not set up/.test(r.body.message) && stripeCalls.length === 0, "and nothing reaches Stripe");
Deno.env.set("STRIPE_SECRET_KEY", "sk_test_123");
Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_test_456");
r = await app("tok-marcus", { action: "pay_config", org: ORG });
ok(r.body.ready === false && r.body.reason === "org-off" && !r.body.publishableKey, "key added, company not turned on: still off");
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 100 });
ok(!r.body.ok && /not turned on/.test(r.body.message), "a company Richie hasn't turned on can't take cards");
r = await app("tok-marcus", { action: "pay_check", org: ORG, jobId: "j1" });
ok(!r.body.ok && /not turned on/.test(r.body.message), "or check payments");
DB.pay_orgs.push({ org_id: ORG, enabled: true });
r = await app("tok-kim", { action: "pay_config", org: ORG });
ok(r.body.ready === true && r.body.test === true && r.body.publishableKey === "pk_test_456", "turned on: ready, test mode, publishable key handed out");
Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_live_456");
r = await app("tok-kim", { action: "pay_config", org: ORG });
ok(r.body.ready === true && r.body.publishableKey === "" && r.body.reason === "no-pk", "a live publishable key with a test secret key is not handed out");
Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_test_456");

/* ---------- who may take payments ---------- */
r = await app("tok-kim", { action: "pay_link", org: ORG, jobId: "j1", amount: 100 });
ok(r.status === 403 && /leads and the office/.test(r.body.message), "base crew can't take payments");
r = await app("tok-dee", { action: "pay_link", org: ORG, jobId: "j1", amount: 100 });
ok(r.status === 403 && /your own jobs/.test(r.body.message), "a lead not on the job can't either");
r = await app("tok-stranger", { action: "pay_link", org: ORG, jobId: "j1", amount: 100 });
ok(r.status === 401, "someone from another company is turned away");
r = await app("tok-stranger", { action: "pay_link", org: ORG2, jobId: "s1", amount: 100 });
ok(!r.body.ok && /not turned on/.test(r.body.message), "and their own company can't charge into this Stripe account");
ok(stripeCalls.length === 0, "none of that reached Stripe");

/* ---------- amounts ---------- */
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 1063.51 });
ok(!r.body.ok && /more than the \$1,063\.50 still owed/.test(r.body.message), "a cent over what's owed is refused: " + r.body.message);
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 0.3 });
ok(!r.body.ok && /start at \$0\.50/.test(r.body.message), "under Stripe's 50-cent minimum is refused");
putDoc(ORG, "jobs/j2", job("j2", { signed: {} }));
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j2", amount: 100 });
ok(!r.body.ok && /signs the required forms first/.test(r.body.message), "a finished job with an unsigned required form can't be paid yet");

/* ---------- a pay link, with the webhook made on first use ---------- */
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 300, save: true });
ok(r.body.ok && /^https:\/\/proj\.supabase\.co\/functions\/v1\/tally-twilio\/p\/[A-Za-z0-9]{10}$/.test(r.body.url), "a short link comes back: " + r.body.url);
const hookMade = lastCall("/v1/webhook_endpoints");
const hookEvents = Object.keys(hookMade.p).filter((k) => /^enabled_events/.test(k)).map((k) => hookMade.p[k]);
ok(hookMade && hookMade.p.url === BASE + "/stripe" && hookMade.p.api_version === fn.STRIPE_VERSION && hookEvents.length === fn.PAY_EVENTS.length, "the server made its own Stripe webhook, pinned to our API version");
ok(["payment_intent.succeeded", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"].every((e) => hookEvents.indexOf(e) >= 0), "it listens for refunds and disputes too");
ok(DB.pay_config.length === 1 && DB.pay_config[0].status === "ready" && DB.pay_config[0].webhook_secret === ST.hooks[0].secret && DB.pay_config[0].events === fn.PAY_EVENTS.join(","), "and keeps its signing secret where only the server can read it");
const cs = lastCall("/v1/checkout/sessions");
ok(cs && cs.p.mode === "payment" && cs.p["line_items[0][price_data][unit_amount]"] === "30000" && cs.p["line_items[0][price_data][currency]"] === "usd", "Stripe page for $300.00");
ok(cs.p["payment_intent_data[metadata][tally_org]"] === ORG && cs.p["payment_intent_data[metadata][tally_job]"] === "j1" && cs.p["payment_intent_data[metadata][tally_by]"] === "Marcus" && cs.p["payment_intent_data[metadata][tally_src]"] === "link" && cs.p["metadata[tally_link]"] === tokenOf(r.body.url), "the payment carries the company, job, link and who started it");
ok(cs.p["payment_method_options[card][setup_future_usage]"] === "off_session", "keeping the card on file was asked for");
ok(cs.p.success_url === BASE + "/pay/done" && cs.p["payment_intent_data[receipt_email]"] === "priya@example.com", "the customer lands on a thank-you page and gets an email receipt");
ok(cs.p.customer === ST.customers[0].id && ST.customers[0].phone === "+15125550142" && ST.customers[0].name === "Priya Nair", "a Stripe customer was made for Priya");
ok(!DB.pay_jobs.some((x) => x.job_id === "j1"), "the job isn't tied to a Stripe customer until a payment on it goes through");
const firstLink = linkRow(r.body.url);
ok(firstLink.cap_cents === 30000 && firstLink.amount_cents === 30000 && Date.parse(firstLink.expires_at) - Date.now() > 6.9 * 86400e3 && Date.parse(firstLink.session_expires) - Date.now() < 24 * 3600e3, "the link lasts a week; the Stripe page behind it less than a day");
ok(stripeCalls.every((c) => c.ver === fn.STRIPE_VERSION && c.auth === "Bearer sk_test_123"), "every Stripe call names our API version");
const firstUrl = r.body.url;
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 300, save: true });
ok(r.body.url === firstUrl && calls("/v1/checkout/sessions") === 1, "asking again gives the same link (a second tap or a redrawn screen)");
ok(calls("/v1/webhook_endpoints") === 1, "the webhook is made only once");
ok(calls("/v1/customers") === 1, "and the customer only once");

let g = await getUrl("/p/" + tokenOf(firstUrl));
ok(g.status === 302 && g.loc === sessionOf(firstUrl).url, "the short link opens the Stripe page");
g = await getUrl("/p/ZZZZZZZZZZ");
ok(g.status === 404 && /isn't valid/.test(g.text), "a made-up code says so");
g = await getUrl("/pay/done");
ok(g.status === 200 && /Payment received/.test(g.text) && /text\/plain/.test(g.type), "the thank-you page");

const firstSession = sessionOf(firstUrl);
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 1063.5, save: true });
ok(r.body.ok && r.body.url !== firstUrl && firstSession.status === "expired" && linkRow(firstUrl).status === "expired", "a link for a different amount replaces the old one, which stops working");
g = await getUrl("/p/" + tokenOf(firstUrl));
ok(g.status === 410 && /expired\. Ask Ace Moving/.test(g.text), "the old short link says it expired");
const balanceLink = r.body.url;

/* ---------- texting a link ---------- */
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 1063.5, save: true, text: true });
ok(r.body.ok && r.body.url === balanceLink && r.body.texted === false && /Text it from your phone/.test(r.body.message) && sent.length === 0, "no company line: the app is told to text it from the phone");
DB.comm_lines.push({ org_id: ORG, phone_number: "+15125550000", enabled: true });
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 1063.5, save: true, text: true });
const tx = sent[sent.length - 1];
ok(r.body.texted === true && tx && tx.To === "+15125550142" && tx.From === "+15125550000", "with a company line, the customer is texted from it");
ok(tx && tx.Body.indexOf("Ace Moving: Here is your secure payment link for $1,063.50: " + balanceLink) === 0, "the text reads right: " + (tx && tx.Body));
ok(DB.comm_log.some((x) => x.purpose === "paylink" && x.job_id === "j1" && x.staff === "Marcus"), "and it is logged on the job");
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 1063.5, save: true, text: true });
ok(r.body.ok && r.body.texted === false && /texted a moment ago/.test(r.body.message) && sent.length === 1, "tapping Text again right away doesn't text the customer twice");

/* ---------- Stripe events ---------- */
let h = await hook({ id: "evt_x", type: "payment_intent.succeeded", data: { object: {} } }, { secret: "whsec_wrong" });
ok(h.status === 400, "an event with a bad signature is refused");
h = await hook({ id: "evt_x", type: "payment_intent.succeeded", data: { object: {} } }, { t: Math.floor(Date.now() / 1000) - 900 });
ok(h.status === 400, "an old event is refused (no replays)");
// Priya pays the balance link with her card and agrees to keep it on file
const piPaid = customerPays(sessionOf(balanceLink).id, "pm_ok");
h = await hook(piEvent(piPaid));
let j = doc("jobs/j1");
const pay = j.payments["st_" + piPaid.id];
ok(h.status === 200 && pay && pay.amt === 1063.5 && pay.method === "Visa ••4242 (pay link) · test" && pay.stripe === piPaid.id && pay.by === "Marcus" && pay.live === false, "the payment lands on the job, marked as test money: " + JSON.stringify(pay));
ok(j.status === "paid", "and the finished job is now Paid");
ok(logs("j1").some((e) => e === "Payment $1,063.50 (Visa ••4242 (pay link) · test)"), "with a line in the job's history");
ok(DB.pay_log.find((x) => x.pi === piPaid.id)?.status === "succeeded", "the ledger has it");
ok(DB.pay_jobs.some((x) => x.job_id === "j1" && x.customer_id === PRIYA() && x.livemode === false), "and the payment that went through ties the job to her Stripe customer");
let card = doc("vault/" + CARD_OK);
ok(card && card.cust === "5125550142" && card.brand === "Visa" && card.last4 === "4242" && card.exp === "03/30" && card.name === "Priya Nair" && card.via === "stripe" && card.live === false && card.jobs.join() === "j1", "the card is on file for Priya: brand, last four, expiry, the name on it, the job: " + JSON.stringify(card));
ok(!/cus_|pm_|\d{12,}/.test(JSON.stringify({ ...card, ts: 0 })), "and nothing in the app's copy can be charged: no Stripe ids, no card number");
const reg = DB.pay_cards.find((x) => x.id === CARD_OK);
ok(reg && reg.customer_id === PRIYA() && reg.pm_id === "pm_ok" && reg.fingerprint === "fpA" && reg.job_id === "j1", "the server keeps which Stripe card it is");
h = await hook(piEvent(piPaid));
j = doc("jobs/j1");
ok(Object.keys(j.payments).length === 2 && Object.keys(j.log).length === 1, "the same event again changes nothing");
await hook({ id: "evt_cs", type: "checkout.session.completed", livemode: false, data: { object: { id: sessionOf(balanceLink).id, payment_intent: piPaid.id, payment_status: "paid", metadata: {} } } });
ok(linkRow(balanceLink).status === "paid", "the link is marked paid");
g = await getUrl("/p/" + tokenOf(balanceLink));
ok(g.status === 200 && /payment is done/.test(g.text), "and the short link says the bill is paid");
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 10 });
ok(!r.body.ok && /Nothing is owed/.test(r.body.message), "nothing owed: no more links");
ok(!stripeCalls.some((c) => Object.keys(c.p).some((k) => /^payment_method_types/.test(k))), "nothing ever sends payment_method_types, which this Stripe version refuses");

/* ---------- a lost save can't lead to charging twice ---------- */
const j1 = doc("jobs/j1");
delete j1.payments["st_" + piPaid.id]; j1.status = "done";
putDoc(ORG, "jobs/j1", j1);   // a phone saved an old copy of the job over the payment
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 100 });
ok(!r.body.ok && /Nothing is owed/.test(r.body.message), "the ledger still counts the payment, so nobody can charge it again");
r = await app("tok-marcus", { action: "pay_check", org: ORG, jobId: "j1" });
j = doc("jobs/j1");
ok(r.body.ok && r.body.fixed === 1 && j.payments["st_" + piPaid.id] && j.payments["st_" + piPaid.id].amt === 1063.5 && r.body.owed === 0, "a check puts the payment back on the job");

/* ---------- a card typed into the app ---------- */
putDoc(ORG, "jobs/j3", job("j3", { payments: {} }));
r = await app("tok-dispatch", { action: "pay_intent", org: ORG, jobId: "j3", amount: 500, save: false });
let piC = lastCall("/v1/payment_intents");
ok(r.body.ok && /^pi_\d+_secret_abc$/.test(r.body.clientSecret) && r.body.returnUrl === BASE + "/pay/done", "the app gets a client secret to confirm with Stripe");
ok(piC.p.amount === "50000" && piC.p["allowed_payment_method_types[0]"] === "card" && !("payment_method_types[0]" in piC.p) && piC.p["payment_method_options[card][setup_future_usage]"] === "none" && piC.p["metadata[tally_src]"] === "card", "cards only (the way this Stripe version takes it), $500.00, not kept on file");
ok(ST.customers.length === 1 && piC.p.customer === ST.customers[0].id, "the same Stripe customer, since it's the same Priya");
const typedA = lastIntent();
confirms(typedA.id, "pm_mc");
r = await app("tok-dispatch", { action: "pay_check", org: ORG, jobId: "j3", pi: typedA.id });
j = doc("jobs/j3");
ok(r.body.ok && j.payments["st_" + typedA.id]?.amt === 500 && j.payments["st_" + typedA.id]?.method === "Mastercard ••4444 · test" && r.body.owed === 763.5, "after Stripe confirms, a check records it right away: $763.50 left");
ok(!DB.pay_cards.some((x) => x.pm_id === "pm_mc") && !DB.docs.some((d) => d.collection === "vault" && d.data.last4 === "4444"), "a card the customer didn't agree to keep is not kept");
r = await app("tok-dispatch", { action: "pay_check", org: ORG, jobId: "j1", pi: typedA.id });
ok(!r.body.ok && /another job/.test(r.body.message), "a payment can't be claimed for a different job");
r = await app("tok-dispatch", { action: "pay_intent", org: ORG, jobId: "j3", amount: 800 });
ok(!r.body.ok && /more than the \$763\.50/.test(r.body.message), "the next payment can't go over what's left");
r = await app("tok-dispatch", { action: "pay_intent", org: ORG, jobId: "j3", amount: 100, save: true });
ok(r.body.ok && lastCall("/v1/payment_intents").p["payment_method_options[card][setup_future_usage]"] === "off_session", "ticking Keep asks Stripe to keep the card");
const typedB = lastIntent();
r = await app("tok-dispatch", { action: "pay_intent", org: ORG, jobId: "j3", amount: 50 });
const typedC = lastIntent();
ok(r.body.ok && typedB.status === "canceled" && DB.pay_log.find((x) => x.pi === typedB.id)?.status === "canceled", "starting again cancels your own unfinished card payment, so it can't be finished later on top");
r = await app("tok-marcus", { action: "pay_intent", org: ORG, jobId: "j3", amount: 763.5 });
ok(!r.body.ok && /Another payment of \$50\.00 on this job was started a moment ago/.test(r.body.message) && typedC.status === "requires_payment_method", "someone else's card payment in progress is held back from what can be charged: " + r.body.message);
typedC.created -= 20 * 60;   // left on the screen for 20 minutes
r = await app("tok-marcus", { action: "pay_intent", org: ORG, jobId: "j3", amount: 763.5 });
const typedD = lastIntent();
ok(r.body.ok && typedC.status === "canceled" && typedD.amount === 76350, "one left unfinished for 15 minutes is cancelled, and the payment goes ahead");

/* ---------- the card on file ---------- */
r = await app("tok-marcus", { action: "pay_saved", org: ORG, jobId: "j3", vaultId: CARD_OK, amount: 263.5 });
ok(!r.body.ok && /kept on file on another job\. The office can charge it/.test(r.body.message) && typedD.status === "canceled", "a crew lead can't charge a card kept on another job (and his card box payment was cancelled as he moved on)");
r = await app("tok-dispatch", { action: "pay_saved", org: ORG, jobId: "j3", vaultId: CARD_OK, amount: 263.5, nonce: "tap-0000001" });
let pc = lastCall("/v1/payment_intents");
j = doc("jobs/j3");
ok(r.body.ok && r.body.message === "Charged $263.50 to Visa ••4242.", "the office charges it: " + r.body.message);
ok(pc.p.off_session === "true" && pc.p.confirm === "true" && pc.p.payment_method === "pm_ok" && pc.p.customer === PRIYA() && /^tally-saved-[0-9a-f]{40}$/.test(pc.idem) && pc.idem.indexOf("tap-") < 0, "charged without the customer present, under a key the server works out (not one the phone sends)");
ok(Object.values(j.payments).some((p: any) => p.amt === 263.5 && /Visa ••4242/.test(p.method)), "and recorded on the job at once");
r = await app("tok-dispatch", { action: "pay_saved", org: ORG, jobId: "j3", vaultId: CARD_OK, amount: 263.5, nonce: "tap-0000002" });
ok(!r.body.ok && /just charged \$263\.50/.test(r.body.message), "the same amount again within two minutes is stopped as a double tap");
putDoc(ORG, "jobs/j9", job("j9", { payments: {} }));
const confirmsBefore = stripeCalls.filter((c) => c.path === "/v1/payment_intents" && c.p.confirm === "true").length;
const two = await Promise.all([1, 2].map(() => app("tok-owner", { action: "pay_saved", org: ORG, jobId: "j9", vaultId: CARD_OK, amount: 100 })));
const confirmsMade = stripeCalls.filter((c) => c.path === "/v1/payment_intents" && c.p.confirm === "true").length - confirmsBefore;
ok(confirmsMade === 1 && two.filter((x) => x.body.ok).length === 1 && two.some((x) => /just charged|Another payment is starting/.test(x.body.message)), "two phones charging the card at the same moment: one charge (" + confirmsMade + ")");
// Priya keeps the same card again on a new job (a typed card, kept): one entry, both jobs
putDoc(ORG, "jobs/j10", job("j10", { payments: {} }));
r = await app("tok-marcus", { action: "pay_intent", org: ORG, jobId: "j10", amount: 100, save: true });
const typedK = lastIntent();
confirms(typedK.id, "pm_ok2");
await hook(piEvent(typedK));
const vaultCards = DB.docs.filter((d) => d.collection === "vault" && d.data.via === "stripe" && d.data.last4 === "4242");
ok(vaultCards.length === 1 && vaultCards[0].doc_id === CARD_OK2 && vaultCards[0].data.exp === "04/31" && vaultCards[0].data.jobs.sort().join() === "j1,j10", "the same card kept again shows once, with its new expiry and both jobs");
r = await app("tok-marcus", { action: "pay_saved", org: ORG, jobId: "j10", vaultId: CARD_OK2, amount: 50 });
ok(r.body.ok && /Charged \$50\.00/.test(r.body.message), "the crew lead charges a card kept on file on his own job");
r = await app("tok-marcus", { action: "pay_saved", org: ORG, jobId: "j3", vaultId: CARD_OK2, amount: 50 });
ok(!r.body.ok && /another job/.test(r.body.message), "but not on another job");
putDoc(ORG, "jobs/j4", job("j4", { payments: {} }));
putDoc(ORG, "vault/v_fake", { id: "v_fake", cust: "5125550142", type: "card", brand: "Visa", last4: "1881", stripe: { cus: "cus_9", pm: "pm_other", live: false } });
r = await app("tok-owner", { action: "pay_saved", org: ORG, jobId: "j4", vaultId: "v_fake", amount: 100 });
ok(!r.body.ok && /can't be charged here/.test(r.body.message) && PMS.pm_other.customer === "cus_9" && !stripeCalls.some((c) => c.p.payment_method === "pm_other"), "a card entry written by a phone, with someone else's Stripe ids in it, charges nothing");
DB.pay_cards.push({ id: "st_other", org_id: ORG, cust_key: "5125550142", customer_id: "cus_9", pm_id: "pm_other", fingerprint: "fpF", name: "", job_id: "jx", livemode: false });
putDoc(ORG, "vault/st_other", { id: "st_other", cust: "5125550142", type: "card", brand: "Visa", last4: "1881", via: "stripe", live: false });
r = await app("tok-owner", { action: "pay_saved", org: ORG, jobId: "j4", vaultId: "st_other", amount: 100 });
ok(!r.body.ok && /belongs to a different customer/.test(r.body.message), "a card of a different Stripe customer can't be charged on this job");
for (const pmId of ["pm_auth", "pm_decline"]) {
  PMS[pmId].customer = PRIYA();
  DB.pay_cards.push({ id: "st_" + pmId, org_id: ORG, cust_key: "5125550142", customer_id: PRIYA(), pm_id: pmId, fingerprint: PMS[pmId].card.fingerprint, name: "", job_id: "j4", livemode: false });
  putDoc(ORG, "vault/st_" + pmId, { id: "st_" + pmId, cust: "5125550142", type: "card", brand: "Visa", last4: PMS[pmId].card.last4, via: "stripe", live: false });
}
r = await app("tok-marcus", { action: "pay_saved", org: ORG, jobId: "j4", vaultId: "st_pm_auth", amount: 100 });
ok(!r.body.ok && r.body.needLink === true && /pay link instead/.test(r.body.message), "the bank wants the customer to approve: the app is told to send a pay link");
r = await app("tok-marcus", { action: "pay_saved", org: ORG, jobId: "j4", vaultId: "st_pm_decline", amount: 100 });
ok(!r.body.ok && /declined: not enough money on the card/.test(r.body.message), "a decline says why in plain words");
ok(!Object.keys(doc("jobs/j4").payments).length, "and nothing is recorded");
ok(Object.values(ST.intents).filter((x: any) => x.metadata.tally_job === "j4" && x.metadata.tally_src === "saved").every((x: any) => x.status === "canceled" || x.status === "requires_payment_method"), "failed tries stay unpaid");
putDoc(ORG, "vault/v_old", { id: "v_old", cust: "5125550142", type: "card", brand: "Visa", last4: "1111" });
r = await app("tok-marcus", { action: "pay_saved", org: ORG, jobId: "j4", vaultId: "v_old", amount: 100 });
ok(!r.body.ok && /can't be charged here/.test(r.body.message), "an old demo card (last four only) can't be charged");
DB.docs = DB.docs.filter((d) => d.path !== "vault/st_pm_decline");
r = await app("tok-marcus", { action: "pay_saved", org: ORG, jobId: "j4", vaultId: "st_pm_decline", amount: 100 });
ok(!r.body.ok && /no longer on file/.test(r.body.message), "a card taken off the list in the app can't be charged");

/* ---------- a pay link asks for what is owed when it is opened ---------- */
putDoc(ORG, "jobs/j12", job("j12", { payments: {} }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j12", amount: 1263.5 });
const link12 = r.body.url, s12 = sessionOf(link12);
cash("j12", 200);   // the customer paid $200 cash instead, and the crew recorded it
g = await getUrl("/p/" + tokenOf(link12));
const s12b = sessionOf(link12);
ok(g.status === 302 && s12.status === "expired" && s12b.id !== s12.id && s12b.amount_total === 106350 && g.loc === s12b.url, "after $200 in cash, opening the texted link asks for $1,063.50, and the old page is closed");
ok(linkRow(link12).cap_cents === 126350 && linkRow(link12).amount_cents === 106350, "the link still remembers it was for up to $1,263.50");
g = await getUrl("/p/" + tokenOf(link12));
ok(g.status === 302 && g.loc === s12b.url, "opened again with nothing changed: the same page");
cash("j12", 300);
r = await app("tok-owner", { action: "pay_check", org: ORG, jobId: "j12" });
ok(r.body.ok && r.body.owed === 763.5 && s12b.status === "expired" && linkRow(link12).status === "open", "a check after more cash closes the page that asked too much; the link itself stays good");
g = await getUrl("/p/" + tokenOf(link12));
ok(g.status === 302 && sessionOf(link12).amount_total === 76350, "and opens to a page for $763.50");
cash("j12", 763.5);
g = await getUrl("/p/" + tokenOf(link12));
ok(g.status === 200 && /This bill is paid/.test(g.text), "paid in full another way: the link says so instead of taking money");
putDoc(ORG, "jobs/j14", job("j14", { payments: {} }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j14", amount: 500 });
const link14 = r.body.url;
const pi14 = customerPays(sessionOf(link14).id, "pm_apple");   // paid, and Stripe's message hasn't come yet
g = await getUrl("/p/" + tokenOf(link14));
ok(g.status === 200 && /payment is done/.test(g.text) && doc("jobs/j14").payments["st_" + pi14.id]?.amt === 500 && linkRow(link14).status === "paid", "opening a link already paid says so, and writes the payment down without waiting for Stripe's message");
putDoc(ORG, "jobs/j15", job("j15", { payments: {} }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j15", amount: 300, save: true });
const link15 = r.body.url, s15 = sessionOf(link15);
r = await app("tok-dispatch", { action: "pay_intent", org: ORG, jobId: "j15", amount: 900 });
ok(r.body.ok && s15.status === "open", "a $300 deposit link stays open while $900 goes on a card: both fit the $1,263.50 bill");
const typed15 = lastIntent();
r = await app("tok-dispatch", { action: "pay_intent", org: ORG, jobId: "j15", amount: 1000 });
ok(r.body.ok && typed15.status === "canceled" && s15.status === "expired", "a $1,000 card payment closes the deposit page, which would take more than the $263.50 left");
g = await getUrl("/p/" + tokenOf(link15));
ok(g.status === 302 && sessionOf(link15).amount_total === 26350, "opened while that card payment is going through, the link asks only for the $263.50 left");

/* ---------- payments that were abandoned or are still going ---------- */
putDoc(ORG, "jobs/j11", job("j11", { payments: {} }));
r = await app("tok-dispatch", { action: "pay_intent", org: ORG, jobId: "j11", amount: 300 });
const typed11 = lastIntent();
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j11", amount: 1263.5 });
ok(!r.body.ok && /Another payment of \$300\.00/.test(r.body.message), "a pay link for the whole bill waits for a card payment someone else is in the middle of");
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j11", amount: 963.5 });
ok(r.body.ok, "a link for the rest is fine");
confirms(typed11.id, "pm_mc", "requires_payment_method"); typed11.last_payment_error = { code: "card_declined" };
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j11", amount: 1263.5 });
ok(r.body.ok && typed11.status === "canceled", "once that card is declined it no longer holds anything back");
DB.pay_locks.push({ org_id: ORG, job_id: "j11", until: new Date(Date.now() + 60e3).toISOString() });
const t0 = Date.now();
r = await app("tok-owner", { action: "pay_intent", org: ORG, jobId: "j11", amount: 10 });
ok(!r.body.ok && /Another payment is starting on this job/.test(r.body.message) && Date.now() - t0 >= 4500, "while another payment is starting on the job, a second one waits, then says to try again");
DB.pay_locks[DB.pay_locks.length - 1].until = new Date(Date.now() - 1000).toISOString();
r = await app("tok-owner", { action: "pay_intent", org: ORG, jobId: "j11", amount: 10 });
ok(r.body.ok && !DB.pay_locks.some((x) => x.job_id === "j11"), "a lock left behind by a request that died lets go by itself");

/* ---------- refunds and disputes ---------- */
ST.charges[piPaid.latest_charge].amount_refunded = 10000;   // Richie refunds $100 in Stripe
h = await hook(chargeEvent(piPaid));
j = doc("jobs/j1");
ok(h.status === 200 && j.payments["rf_" + piPaid.id]?.amt === -100 && j.payments["rf_" + piPaid.id].method === "Refund · Visa ••4242 (pay link) · test", "a refund in Stripe shows on the bill as its own line, taking $100 off");
ok(DB.pay_log.find((x) => x.pi === piPaid.id)?.refunded_cents === 10000, "the ledger has the refund");
ok(j.status === "done" && logs("j1").some((e) => /^Refunded \$100\.00 of the \$1,063\.50 payment/.test(e)) && logs("j1").some((e) => e === "Back to Complete: $100.00 is owed again"), "the Paid job is Complete again, with $100 owed, and the history says why");
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j1", amount: 100 });
ok(r.body.ok, "and the $100 can be collected again");
ok(doc("vault/" + CARD_OK2) && !doc("vault/" + CARD_OK), "writing the refund down leaves the card list alone (the card's newer entry stays)");
const linesNow = logs("j1").length;
await hook(chargeEvent(piPaid));
ok(logs("j1").length === linesNow, "the same refund message again changes nothing");
ST.disputes.push({ id: "dp_1", amount: 50000, status: "needs_response", payment_intent: typedA.id });
ST.charges[typedA.latest_charge].disputed = true;
await hook(disputeEvent(ST.disputes[0], "charge.dispute.created"));
j = doc("jobs/j3");
ok(j.payments["dp_" + typedA.id]?.amt === -500 && j.payments["dp_" + typedA.id].method === "Disputed · Mastercard ••4444 · test" && logs("j3").some((e) => /^The customer disputed the \$500\.00 payment.*Stripe holds \$500\.00/.test(e)), "a dispute takes the money off the bill while the bank decides");
r = await app("tok-dispatch", { action: "pay_check", org: ORG, jobId: "j3" });
ok(r.body.owed === 1000, "so those $500 are owed again, on top of the $500 left: $1,000");
ST.disputes[0].status = "won";
await hook(disputeEvent(ST.disputes[0], "charge.dispute.closed"));
j = doc("jobs/j3");
ok(!j.payments["dp_" + typedA.id] && logs("j3").some((e) => /^Dispute closed: the \$500\.00 Stripe held came back/.test(e)), "won: the money is back and the line comes off");
ST.disputes[0].status = "lost";
await hook(disputeEvent(ST.disputes[0], "charge.dispute.closed"));
ok(doc("jobs/j3").payments["dp_" + typedA.id]?.method === "Dispute lost · Mastercard ••4444 · test", "lost: the line stays, marked lost");

/* ---------- bank payments: pending, then cleared or bounced ---------- */
putDoc(ORG, "jobs/j5", job("j5", { payments: {} }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j5", amount: 1263.5 });
const piB = customerPays(sessionOf(r.body.url).id, "pm_bank", "processing");
await hook(piEvent(piB, "payment_intent.processing"));
j = doc("jobs/j5");
ok(j.payments["st_" + piB.id]?.pending === true && j.payments["st_" + piB.id].method === "Bank ••6789 (pay link) · test" && j.status === "paid", "a bank payment shows as pending (and counts, as the app counts pending payments)");
piB.status = "succeeded"; piB.amount_received = 126350;
await hook(piEvent(piB));
j = doc("jobs/j5");
ok(j.payments["st_" + piB.id] && !j.payments["st_" + piB.id].pending && logs("j5").some((e) => /^Bank payment cleared/.test(e)), "when it clears, pending comes off");
putDoc(ORG, "jobs/j6", job("j6", { payments: {} }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j6", amount: 1263.5 });
const piF = customerPays(sessionOf(r.body.url).id, "pm_bank", "processing");
await hook(piEvent(piF, "payment_intent.processing"));
ok(doc("jobs/j6").payments["st_" + piF.id]?.pending === true && doc("jobs/j6").status === "paid", "another bank payment pending, the job Paid");
piF.status = "requires_payment_method"; piF.last_payment_error = { code: "insufficient_funds", message: "The account has insufficient funds." };
await hook(piEvent(piF, "payment_intent.payment_failed"));
j = doc("jobs/j6");
ok(!j.payments["st_" + piF.id] && logs("j6").some((e) => /did not go through/.test(e)) && DB.pay_log.find((x) => x.pi === piF.id)?.status === "requires_payment_method", "it bounced: taken off the job, and the history says so");
ok(j.status === "done" && logs("j6").some((e) => e === "Back to Complete: $1,263.50 is owed again"), "and the job is no longer Paid");

/* ---------- paid twice ---------- */
putDoc(ORG, "jobs/j16", job("j16", { payments: {} }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j16", amount: 1263.5 });
const s16 = sessionOf(r.body.url);
cash("j16", 1263.5);   // paid in cash while the customer was paying on the page
const pi16 = customerPays(s16.id, "pm_apple");
await hook(piEvent(pi16));
ok(logs("j16").some((e) => /That's \$1,263\.50 more than the bill: refund the difference in Stripe/.test(e)), "a payment over the bill says how much too much, so it can be refunded");

/* ---------- test jobs, live mode, keys ---------- */
putDoc(ORG, "jobs/t1", job("t1", { test: true, payments: {} }));
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "t1", amount: 100 });
ok(r.body.ok, "test mode: a test job can be paid with a test card");
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "t1", amount: 100, text: true });
ok(r.body.texted === false && /Test job: nothing is texted/.test(r.body.message), "but its made-up phone number is never texted");
Deno.env.set("STRIPE_SECRET_KEY", "sk_live_999");
Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_live_456");
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "t1", amount: 100 });
ok(!r.body.ok && /Test job: no real charges/.test(r.body.message), "live mode: test jobs can't be charged");
r = await app("tok-dispatch", { action: "pay_saved", org: ORG, jobId: "j4", vaultId: CARD_OK2, amount: 100 });
ok(!r.body.ok && /saved in Stripe test mode/.test(r.body.message), "a card saved in test mode isn't charged with the live key: " + r.body.message);
putDoc(ORG, "jobs/j17", job("j17", { payments: {} }));
r = await app("tok-dispatch", { action: "pay_check", org: ORG, jobId: "j10" });
ok(r.body.ok && r.body.owed === 1263.5, "in live mode, test payments don't count toward a bill (j10 had $150 of test money)");
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j17", amount: 1263.5 });
const liveLink = r.body.url;
ok(r.body.ok && /^cs_live_/.test(linkRow(liveLink).session_id) && DB.pay_config.some((x) => x.mode === "live" && x.status === "ready") && ST.customers.some((c: any) => c.livemode && c.phone === "+15125550142"), "live mode makes its own webhook, customer and pages");
h = await hook(piEvent({ ...piB, livemode: false }));
ok(h.status === 200 && /other-mode/.test(h.text), "a test-mode event arriving after the switch to live is left alone");
g = await getUrl("/p/" + tokenOf(link15));
ok(g.status === 302 && /^cs_live_/.test(sessionOf(link15).id), "an open link made in test mode opens to a live page after the switch");
Deno.env.set("STRIPE_SECRET_KEY", "sk_test_123");
Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_test_456");
stripeDown = "auth";
r = await app("tok-marcus", { action: "pay_link", org: ORG, jobId: "j4", amount: 50 });
ok(!r.body.ok && /did not accept the key/.test(r.body.message) && !/sk_t/.test(r.body.message), "a key Stripe refuses: clear message, key not shown");
stripeDown = "";

/* ---------- the person behind a payment ---------- */
putDoc(ORG, "jobs/j18", job("j18", { payments: {} }));
r = await app("tok-boss", { action: "pay_link", org: ORG, jobId: "j18", amount: 100 });
ok(r.body.ok && lastCall("/v1/checkout/sessions").p["payment_intent_data[metadata][tally_by]"] === "#owner" && linkRow(r.body.url).created_by === "#owner", "an owner without a staff name is filed as #owner, not as nobody");

/* ---------- taking a card off file ---------- */
r = await app("tok-marcus", { action: "pay_forget", org: ORG, vaultId: CARD_OK2 });
ok(r.status === 403, "a crew lead can't remove cards on file");
r = await app("tok-owner", { action: "pay_forget", org: ORG, vaultId: CARD_OK2 });
ok(r.body.ok && ST.detached.indexOf("pm_ok2") >= 0 && ST.detached.indexOf("pm_ok") >= 0 && DB.pay_cards.filter((x) => x.fingerprint === "fpA").every((x) => !x.pm_id) && !doc("vault/" + CARD_OK2), "the office removes it: taken off the customer in Stripe and off Tally's list");
r = await app("tok-owner", { action: "pay_saved", org: ORG, jobId: "j10", vaultId: CARD_OK2, amount: 10 });
ok(!r.body.ok && /can't be charged here/.test(r.body.message), "and it can't be charged again");
PMS.pm_ok2.customer = PRIYA();   // even if Stripe still had it attached
await hook(piEvent(typedK));
ok(!doc("vault/" + CARD_OK2) && !DB.pay_cards.some((x) => x.id === CARD_OK2 && x.pm_id), "writing its payment down again doesn't put it back on file");
putDoc(ORG, "vault/" + CARD_OK2, { id: CARD_OK2, cust: "5125550142", type: "card", brand: "Visa", last4: "4242", via: "stripe", live: false });
r = await app("tok-owner", { action: "pay_saved", org: ORG, jobId: "j10", vaultId: CARD_OK2, amount: 10 });
ok(!r.body.ok && /can't be charged here/.test(r.body.message), "and a phone putting its entry back can't either");

/* ---------- two phones switching payments on at once make one webhook ---------- */
DB.pay_config = DB.pay_config.filter((x) => x.mode !== "test"); ST.hooks.push({ id: "we_stale", url: BASE + "/stripe", secret: "whsec_lost", enabled_events: [] });
const before = calls("/v1/webhook_endpoints");
const results = await Promise.all([1, 2, 3].map((i) => app("tok-owner", { action: "pay_link", org: ORG, jobId: "j4", amount: 10 + i })));
const made = calls("/v1/webhook_endpoints") - before;
ok(made === 1, "three at once: one webhook made (" + made + ")");
ok(results.filter((x) => x.body.ok).length >= 1 && results.filter((x) => !x.body.ok).every((x) => /being switched on|Another payment is starting/.test(x.body.message)), "the others are asked to try again in a minute");
ok(!ST.hooks.some((w: any) => w.id === "we_stale") && ST.hooks.filter((w: any) => w.url === BASE + "/stripe" && !w.livemode).length === 1, "an old webhook to the same address, whose secret was lost, is replaced");

/* ---------- the webhook is kept current ---------- */
const testCfg = () => DB.pay_config.find((x) => x.mode === "test");
const testHook = () => ST.hooks.find((w: any) => w.id === testCfg().webhook_id);
let nb = calls("/v1/webhook_endpoints");
testCfg().updated_at = new Date(Date.now() - 7 * 3600e3).toISOString();
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j4", amount: 20 });
ok(r.body.ok && calls("/v1/webhook_endpoints") === nb && stripeCalls.some((c) => c.method === "GET" && c.path === "/v1/webhook_endpoints/" + testCfg().webhook_id) && Date.now() - Date.parse(testCfg().updated_at) < 60e3, "every few hours the webhook is checked; a healthy one is left alone");
testCfg().events = "payment_intent.succeeded"; testHook().enabled_events = ["payment_intent.succeeded"];
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j4", amount: 21 });
ok(r.body.ok && testHook().enabled_events.length === fn.PAY_EVENTS.length && testCfg().events === fn.PAY_EVENTS.join(","), "a webhook made by an older version is told about the new events (refunds, disputes) right away");
testCfg().updated_at = new Date(Date.now() - 7 * 3600e3).toISOString();
ST.hooks = ST.hooks.filter((w: any) => w.livemode);
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j4", amount: 22 });
ok(r.body.ok && calls("/v1/webhook_endpoints") === nb + 1 && testCfg().webhook_secret === testHook().secret, "one deleted in Stripe is made again, with its new secret");

/* ---------- too many in an hour ---------- */
for (let i = 0; i < 45; i++) DB.pay_log.push({ pi: "pi_flood" + i, org_id: ORG, job_id: "jx", amount_cents: 100, status: "canceled", by_staff: "Dee", created_at: new Date().toISOString() });
putDoc(ORG, "jobs/j8", job("j8", { payments: {}, assign: { truckId: "", crew: ["Dee"] } }));
r = await app("tok-dee", { action: "pay_link", org: ORG, jobId: "j8", amount: 100 });
ok(!r.body.ok && /a lot of payments this hour/.test(r.body.message), "runaway payment attempts are capped per person");

/* ---------- cash, a card going through and a link page, all at once ---------- */
putDoc(ORG, "jobs/j20", job("j20", { payments: {} }));   // $1,263.50 owed
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j20", amount: 863.5 });
const s20 = sessionOf(r.body.url);
r = await app("tok-dispatch", { action: "pay_intent", org: ORG, jobId: "j20", amount: 400 });
const typed20 = lastIntent();
ok(r.body.ok && s20.status === "open", "an $863.50 link page and a $400 card payment fit the $1,263.50 bill together");
cash("j20", 300);
r = await app("tok-owner", { action: "pay_check", org: ORG, jobId: "j20" });
ok(r.body.ok && typed20.status === "requires_payment_method" && s20.status === "expired", "after $300 cash, the link page is closed: with the card going through it would go over the bill");
cash("j20", 700);
r = await app("tok-owner", { action: "pay_check", org: ORG, jobId: "j20" });
ok(r.body.ok && typed20.status === "canceled" && r.body.owed === 263.5, "after $700 more, the $400 card payment no longer fits the $263.50 left and is called off");
DB.pay_locks.push({ org_id: ORG, job_id: "j20", until: new Date(Date.now() + 60e3).toISOString() });
r = await app("tok-owner", { action: "pay_check", org: ORG, jobId: "j20" });
ok(r.body.ok && r.body.busy === true, "a check that can't get to the job (a payment is starting) says it was busy, so the app asks again");
DB.pay_locks = DB.pay_locks.filter((x) => x.job_id !== "j20");

/* ---------- a link replaced while it was being opened ---------- */
putDoc(ORG, "jobs/j21", job("j21", { payments: {} }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j21", amount: 1263.5 });
const old21 = r.body.url;
linkRow(old21).session_expires = new Date(Date.now() - 10e3).toISOString();   // its page ran out, so opening it makes a new one
const pagesBefore21 = Object.keys(ST.sessions).length;
DB.pay_locks.push({ org_id: ORG, job_id: "j21", until: new Date(Date.now() + 60e3).toISOString() });   // the office is making a new link
const opening = getUrl("/p/" + tokenOf(old21));
await new Promise((res) => setTimeout(res, 300));
linkRow(old21).status = "expired";   // which replaces this one
DB.pay_locks = DB.pay_locks.filter((x) => x.job_id !== "j21");
g = await opening;
ok(g.status === 410 && /expired/.test(g.text) && Object.keys(ST.sessions).length === pagesBefore21, "it says it expired, and no new Stripe page is made for it");

/* ---------- customers without a phone number ---------- */
const noPhone = (id: string) => job(id, { payments: {}, d: { name: "John Smith", phone: "", email: "", moveDate: "2026-10-06", time: "08:00" } });
putDoc(ORG, "jobs/j22", noPhone("j22")); putDoc(ORG, "jobs/j23", noPhone("j23"));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j22", amount: 300, save: true });
const s22 = sessionOf(r.body.url);
ok(r.body.ok && s22.params["payment_intent_data[metadata][tally_cust]"] === "job:j22", "a customer without a phone is known to Stripe by the job alone, never by name");
const pi22 = customerPays(s22.id, "pm_jsA");
await hook(piEvent(pi22));
const cardJ = await fn.cardId("pm_jsA");
ok(doc("vault/" + cardJ)?.cust === "job:j22", "the card kept on file names the job it belongs to");
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j23", amount: 300 });
const s23 = sessionOf(r.body.url);
ok(r.body.ok && s23.params.customer !== s22.params.customer, "another John Smith gets a Stripe customer of his own");
r = await app("tok-owner", { action: "pay_saved", org: ORG, jobId: "j23", vaultId: cardJ, amount: 100 });
ok(!r.body.ok && /different customer/.test(r.body.message), "and the first John Smith's card can't be charged on his job");

/* ---------- what a phone can't do to a bill ---------- */
putDoc(ORG, "jobs/j24", job("j24", { payments: { n1: { id: "n1", amt: -500, method: "Cash", ts: 1 } } }));
r = await app("tok-owner", { action: "pay_check", org: ORG, jobId: "j24" });
ok(r.body.ok && r.body.owed === 1263.5, "a negative payment written by a phone doesn't raise what is owed: " + r.body.owed);
putDoc(ORG, "jobs/j25", job("j25", { payments: {}, quote: { total: 1200, nte: 1380, deposit: 300 } }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j25", amount: 300, save: true });
await hook(piEvent(customerPays(sessionOf(r.body.url).id, "pm_v25")));   // a $300 deposit, card kept on file
const card25 = await fn.cardId("pm_v25");
const j25 = doc("jobs/j25"); j25.extras.e9 = { id: "e9", label: "Extra", amt: 3000, ts: 2 }; putDoc(ORG, "jobs/j25", j25);   // the bill grows to $4,263.50
r = await app("tok-marcus", { action: "pay_saved", org: ORG, jobId: "j25", vaultId: card25, amount: 3963.5 });
ok(!r.body.ok && /up to \$1,080\.00 more on a card on file/.test(r.body.message), "a crew lead charging a card on file stays within the quote's not-to-exceed amount: " + r.body.message);
r = await app("tok-marcus", { action: "pay_saved", org: ORG, jobId: "j25", vaultId: card25, amount: 1080 });
ok(r.body.ok, "up to that amount is fine");
r = await app("tok-dispatch", { action: "pay_saved", org: ORG, jobId: "j25", vaultId: card25, amount: 2883.5 });
ok(r.body.ok, "and the office can charge the rest");

/* ---------- two owners without a staff name ---------- */
putDoc(ORG, "jobs/j26", job("j26", { payments: {} }));
r = await app("tok-boss", { action: "pay_intent", org: ORG, jobId: "j26", amount: 400 });
const typed26 = lastIntent();
ok(r.body.ok && typed26.metadata.tally_uid === "u-boss", "a card payment carries the person's user id");
r = await app("tok-boss2", { action: "pay_link", org: ORG, jobId: "j26", amount: 300 });
ok(r.body.ok && typed26.status === "requires_payment_method", "so a second owner without a staff name doesn't call off the first one's card payment");

/* ---------- a pay link's own payment is left to its page ---------- */
putDoc(ORG, "jobs/j27", job("j27", { payments: {} }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j27", amount: 500 });
const s27 = sessionOf(r.body.url);
const pi27: any = { id: "pi_page27", object: "payment_intent", amount: 50000, currency: "usd", customer: s27.params.customer, metadata: unflat(s27.params, "payment_intent_data[metadata]"),
  livemode: false, created: Math.floor(Date.now() / 1000) - 3600, status: "requires_payment_method", payment_method: null, latest_charge: null,
  last_payment_error: { code: "card_declined", message: "Your card was declined." }, payment_method_options: {}, checkout: true };
ST.intents.pi_page27 = pi27;   // the customer's card was declined on the page an hour ago
await hook(piEvent(pi27, "payment_intent.payment_failed"));
const refusedBefore = ST.refusedCancels || 0;
r = await app("tok-owner", { action: "pay_check", org: ORG, jobId: "j27" });
ok(r.body.ok && (ST.refusedCancels || 0) === refusedBefore && pi27.status === "requires_payment_method", "a check doesn't try to cancel it (Stripe wouldn't): closing the page is what stops it");

/* ---------- Stripe's message waits its turn ---------- */
putDoc(ORG, "jobs/j28", job("j28", { payments: {} }));
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "j28", amount: 500 });
const pi28 = customerPays(sessionOf(r.body.url).id, "pm_apple");
DB.pay_locks.push({ org_id: ORG, job_id: "j28", until: new Date(Date.now() + 60e3).toISOString() });
const t28 = Date.now();
setTimeout(() => { DB.pay_locks = DB.pay_locks.filter((x) => x.job_id !== "j28"); }, 1000);
h = await hook(piEvent(pi28));
ok(h.status === 200 && Date.now() - t28 >= 900 && doc("jobs/j28").payments["st_" + pi28.id]?.amt === 500, "a payment message arriving while the job is busy waits for it, then is written down");

/* ---------- events that aren't ours ---------- */
const stray = { id: "pi_stray", object: "payment_intent", amount: 500, currency: "usd", metadata: { tally_org: "33333333-3333-3333-3333-333333333333", tally_job: "j1" }, livemode: false, created: 1, status: "succeeded", payment_method: null, latest_charge: null };
ST.intents.pi_stray = stray;
h = await hook(piEvent(stray));
ok(h.status === 200 && !DB.pay_log.some((x) => x.pi === "pi_stray"), "a payment naming a company that doesn't exist is ignored, not retried forever");

/* ---------- routing ---------- */
const post = await fn.handle(new Request(BASE + "/stripe", { method: "GET" }));
ok(post.status === 405, "the Stripe route only takes POST");
ok(!DB.pay_locks.length, "no payment lock is left behind");

console.log("\n" + passes + " passed, " + failures + " failed");
if (failures) Deno.exit(1);
