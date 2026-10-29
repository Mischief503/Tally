// The customer side in the Edge Function (Oct 28): a customer signed in with the email on their move sees their moves in
// every company, books a quote, signs a form ahead, pays the deposit or the bill with a tip for the crew on the
// company's Stripe page, and the tip stays apart from the bill (refunds and disputes too). An in-memory PostgREST, a
// fake Stripe (API version 2026-09-30.endive) and signed Stripe events, as in pay.ts.
// Run: deno run -A tests/function/cust.ts
// deno-lint-ignore-file no-explicit-any
(globalThis as any).__TALLY_TEST = true;
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
Deno.env.set("TWILIO_AUTH_TOKEN", "tok123");
Deno.env.set("TALLY_TZ", "UTC");
const fn = await import("../../supabase/functions/tally-twilio/index.ts");
const BASE = "https://proj.supabase.co/functions/v1/tally-twilio";

let failures = 0, passes = 0;
function ok(c: unknown, m: string) { if (c) { passes++; console.log("PASS", m); } else { failures++; console.log("FAIL", m); } }

/* ---------- in-memory database ---------- */
const DB: Record<string, any[]> = { docs: [], members: [], orgs: [], comm_lines: [], comm_log: [], comm_job_state: [], pay_orgs: [], pay_customers: [], pay_links: [], pay_log: [], pay_config: [], pay_cards: [], pay_jobs: [], pay_locks: [], pay_accounts: [] };
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
// PostgREST's like: * is any run of characters, and SQL's own _ and % are wildcards too
const likeRe = (pat: string) => new RegExp("^" + pat.split("").map((ch) => ch === "*" || ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("") + "$", "i");
function matches(row: any, filters: [string, string][]) {
  return filters.every(([k, f]) => {
    const i = f.indexOf("."), op = f.slice(0, i), val = f.slice(i + 1), v = getField(row, k);
    if (op === "eq") return String(v) === val;
    if (op === "neq") return String(v) !== val;
    if (op === "is") return val === "true" ? v === true : val === "null" ? v == null : v === false;
    if (op === "gte") return String(v) >= val;
    if (op === "lt") return String(v) < val;
    if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").indexOf(String(v)) >= 0;
    if (op === "ilike") return v != null && likeRe(val).test(String(v));
    throw new Error("op " + op);
  });
}
const ilikes: string[] = [];
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
  row.data = d; row.updated_at = new Date().toISOString() + (nextId++);
  return d;
}
function payReopen(b: any) {
  const row = DB.docs.find((r) => r.org_id === b.o && r.path === "jobs/" + b.job);
  if (!row || row.data.status !== "paid") return false;
  const d = clone(row.data);
  d.status = "done";
  if (b.log_key && b.log_entry) { if (!d.log || typeof d.log !== "object") d.log = {}; d.log[b.log_key] = b.log_entry; }
  row.data = d; row.updated_at = new Date().toISOString() + (nextId++);
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
    if (/^ilike\./.test(v)) ilikes.push(v);
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
    hit.forEach((r) => { Object.assign(r, clone(body)); if (table === "docs") r.updated_at = String(body.updated_at || new Date().toISOString()) + "#" + (nextId++); });
    return { status: 200, body: rep ? clone(hit) : null };
  }
  if (method === "DELETE") {
    DB[table] = rows.filter((r) => !matches(r, filters));
    return { status: 204, body: null };
  }
  return { status: 405, body: null };
}

/* ---------- a fake Stripe ---------- */
const stripeCalls: any[] = [];
const ST: any = { customers: [], sessions: {}, intents: {}, charges: {}, disputes: [], hooks: [], idem: {}, n: 0 };
const PMS: Record<string, any> = {
  pm_gpay: { id: "pm_gpay", type: "card", customer: null, card: { brand: "visa", last4: "4242", exp_month: 3, exp_year: 2030, fingerprint: "fpG", wallet: { type: "google_pay" } } },
  pm_ok: { id: "pm_ok", type: "card", customer: null, card: { brand: "mastercard", last4: "4444", exp_month: 3, exp_year: 2030, fingerprint: "fpM" } },
};
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
// the line items of a Checkout Session, as Stripe reads the form fields
function itemsOf(p: Record<string, string>) {
  const out: any[] = [];
  for (let i = 0; p["line_items[" + i + "][quantity]"] !== undefined; i++) {
    out.push({ qty: +p["line_items[" + i + "][quantity]"], amount: +p["line_items[" + i + "][price_data][unit_amount]"], name: p["line_items[" + i + "][price_data][product_data][name]"] });
  }
  return out;
}
function stripeApi(method: string, path: string, p: Record<string, string>, _h: any) {
  const reply = (status: number, b: any) => ({ status, body: b });
  const id = () => String(++ST.n), exp = expands(p);
  if (Object.keys(p).some((k) => /^payment_method_types\[/.test(k))) return reply(400, { error: { type: "invalid_request_error", message: "payment_method_types is no longer supported on this API version." } });
  let m: RegExpExecArray | null;
  if (method === "POST" && path === "/v1/customers") { const c = { id: "cus_" + id(), name: p.name, phone: p.phone, email: p.email, metadata: unflat(p, "metadata") }; ST.customers.push(c); return reply(200, c); }
  if (method === "GET" && path === "/v1/webhook_endpoints") return reply(200, { data: clone(ST.hooks) });
  if (method === "POST" && path === "/v1/webhook_endpoints") {
    const events = Object.keys(p).filter((k) => /^enabled_events\[\d+\]$/.test(k)).map((k) => p[k]);
    const w = { id: "we_" + id(), url: p.url, enabled_events: events, status: "enabled", secret: "whsec_test_" + ST.n };
    ST.hooks.push(w); return reply(200, w);
  }
  if ((m = /^\/v1\/webhook_endpoints\/(\w+)$/.exec(path))) { const w = ST.hooks.find((x: any) => x.id === m![1]); if (!w) return reply(404, { error: { message: "No such webhook endpoint" } }); const out = clone(w); delete out.secret; return reply(200, out); }
  if (method === "POST" && path === "/v1/checkout/sessions") {
    const sid = "cs_test_" + id(), items = itemsOf(p);
    const s = { id: sid, object: "checkout.session", url: "https://checkout.stripe.com/c/pay/" + sid, status: "open", payment_status: "unpaid", expires_at: +p.expires_at,
      payment_intent: null, metadata: unflat(p, "metadata"), amount_total: items.reduce((a, x) => a + x.qty * x.amount, 0), items, livemode: false, params: p };
    ST.sessions[sid] = s; return reply(200, s);
  }
  if ((m = /^\/v1\/checkout\/sessions\/(\w+)(\/expire)?$/.exec(path))) {
    const s = ST.sessions[m[1]];
    if (!s) return reply(404, { error: { type: "invalid_request_error", message: "No such checkout.session" } });
    if (method === "GET") return reply(200, s);
    if (s.status !== "open") return reply(400, { error: { type: "invalid_request_error", message: "Only Checkout Sessions with a status of open can be expired." } });
    s.status = "expired"; return reply(200, s);
  }
  if ((m = /^\/v1\/payment_intents\/(\w+)(\/cancel)?$/.exec(path))) {
    const pi = ST.intents[m[1]];
    if (!pi) return reply(404, { error: { type: "invalid_request_error", message: "No such payment_intent" } });
    if (method === "GET") return reply(200, piView(pi, exp));
    if (pi.checkout) return reply(400, { error: { type: "invalid_request_error", message: "This PaymentIntent was created by a Checkout Session. Expire the Checkout Session instead." } });
    pi.status = "canceled"; return reply(200, piView(pi, exp));
  }
  if (method === "GET" && path === "/v1/disputes") return reply(200, { data: clone(ST.disputes.filter((d: any) => d.payment_intent === p.payment_intent)) });
  return reply(404, { error: { message: "fake stripe: no route " + method + " " + path } });
}
// the customer paying on Stripe's page: with Google Pay, here
function customerPays(sid: string, pm = "pm_gpay") {
  const s = ST.sessions[sid];
  if (!s || s.status !== "open") throw new Error("session " + sid + " is " + (s && s.status));
  const p = s.params, pid = "pi_" + (++ST.n);
  const pi: any = { id: pid, object: "payment_intent", amount: s.amount_total, currency: "usd", customer: p.customer, metadata: unflat(p, "payment_intent_data[metadata]"), livemode: false,
    created: Math.floor(Date.now() / 1000), status: "succeeded", payment_method: pm, payment_method_options: { card: {} }, amount_received: s.amount_total, latest_charge: null, last_payment_error: null, checkout: true };
  ST.intents[pid] = pi;
  makeCharge(pi);
  s.status = "complete"; s.payment_status = "paid"; s.payment_intent = pid;
  return pi;
}

/* ---------- auth, Twilio, and the network ---------- */
const sent: any[] = [];
const USERS: Record<string, any> = {
  "tok-priya": { id: "u-priya", email: "Priya.Nair@gmail.com", email_confirmed_at: "2026-10-01T00:00:00Z", user_metadata: { full_name: "Priya Nair" } },
  "tok-sam": { id: "u-sam", email: "sam@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" },
  "tok-unconfirmed": { id: "u-x", email: "priyanair@gmail.com" },
  "tok-owner": { id: "u-owner", email: "owner@acemoving.com", email_confirmed_at: "2026-10-01T00:00:00Z" },
};
(globalThis as any).fetch = async (input: string, init: any = {}) => {
  const u = new URL(input), method = (init.method || "GET").toUpperCase();
  const reply = (status: number, b: any) => new Response(status === 204 ? null : b == null ? "" : JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (u.host === "api.stripe.com") {
    const h = init.headers || {};
    const p: Record<string, string> = method === "GET" ? Object.fromEntries(u.searchParams) : Object.fromEntries(new URLSearchParams(init.body || ""));
    stripeCalls.push({ method, path: u.pathname, p, acct: h["Stripe-Account"] || "" });
    const r = stripeApi(method, u.pathname, p, h);
    return reply(r.status, r.body);
  }
  if (u.host === "api.twilio.com") { const p = Object.fromEntries(new URLSearchParams(init.body)); sent.push(p); return reply(201, { sid: "SM" + sent.length, status: "queued" }); }
  if (u.pathname === "/auth/v1/user") {
    const t = String(init.headers.Authorization || "").replace("Bearer ", "");
    return USERS[t] ? reply(200, USERS[t]) : reply(401, { message: "bad jwt" });
  }
  if (u.pathname.startsWith("/rest/v1/")) {
    const h = init.headers || {};
    if (h.Authorization !== "Bearer service") return reply(401, { message: "not service" });
    const r = restMock(method, u, init.body ? JSON.parse(init.body) : undefined, h.Prefer || "");
    return reply(r.status, r.body);
  }
  throw new Error("unexpected fetch " + input);
};
async function app(tok: string, body: any) {
  const r = await fn.handle(new Request(BASE + "/app", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function getUrl(path: string) {
  const r = await fn.handle(new Request(BASE + path, { method: "GET", redirect: "manual" }));
  return { status: r.status, text: r.status === 302 ? "" : await r.text() };
}
function secretNow() { const r = DB.pay_config.find((x) => x.mode === "test"); return r ? r.webhook_secret : ""; }
async function hook(event: any) {
  const raw = JSON.stringify(event), t = String(Math.floor(Date.now() / 1000));
  const sig = await fn.stripeSignature(raw, secretNow(), t);
  const r = await fn.handle(new Request(BASE + "/stripe", { method: "POST", headers: { "Stripe-Signature": "t=" + t + ",v1=" + sig }, body: raw }));
  return { status: r.status, text: await r.text() };
}
const sessionDone = (sid: string, pid: string) => ({ id: "evt_" + sid, type: "checkout.session.completed", livemode: false, data: { object: { id: sid, object: "checkout.session", payment_intent: pid, metadata: ST.sessions[sid].metadata } } });
const chargeEvent = (pi: any) => ({ id: "evt_r" + pi.latest_charge + (++ST.n), type: "charge.refunded", livemode: false, data: { object: { id: pi.latest_charge, object: "charge", payment_intent: pi.id } } });

/* ---------- two companies, and Priya's moves in both ---------- */
const ORG = "11111111-1111-1111-1111-111111111111", ORG2 = "22222222-2222-2222-2222-222222222222";
DB.orgs.push({ id: ORG, name: "Ace Moving" }, { id: ORG2, name: "Blue Van Co" });
const settings: any = {
  company: "Ace Moving", reviewUrl: "https://g.page/r/ace-review",
  contacts: { Owner: "512-555-0100", Dispatch: "512-555-0199", Marcus: "512-555-0101" },
  office: [{ name: "Owner", kind: "owner" }, { name: "Dispatch", kind: "dispatch" }], leads: ["Marcus"],
  trucks: [{ id: "t26", name: "Box 1 (26 ft)", cf: 1700 }], truckDay: { start: "07:00", hours: 12, jobs: 4, gap: 60 },
  forms: [{ id: "f_deliv", title: "Delivery receipt", kind: "text", text: "Delivered.", required: true },
    { id: "f_agree", title: "Moving agreement", kind: "text", text: "I agree to the quote.", required: true, ahead: true },
    { id: "f_scan", title: "Inventory form", kind: "pages", pageIds: ["pg1"], required: true, ahead: true }],
};
function putDoc(org: string, path: string, data: any) {
  const [collection, doc_id] = path.split("/");
  const i = DB.docs.findIndex((r) => r.org_id === org && r.path === path);
  const row = { org_id: org, path, collection, doc_id, data: clone(data), updated_at: new Date().toISOString() + "#" + (nextId++) };
  if (i >= 0) DB.docs[i] = row; else DB.docs.push(row);
}
const doc = (path: string, org = ORG) => (DB.docs.find((r) => r.org_id === org && r.path === path) || {}).data;
const logs = (jobId: string, org = ORG) => Object.values(doc("jobs/" + jobId, org).log || {}).map((l: any) => l.ev);
const later = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10), past = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
function job(id: string, over: any = {}) {
  return { id, status: "quoted", d: { name: "Priya Nair", phone: "512-555-0142", email: "priya.nair+moving@gmail.com", moveDate: later, time: "09:00", from: "418 Oak St", to: "77 Ridge Rd", notes: "Gate code 4411" },
    quote: { total: 1000, deposit: 250, crew: 3, hours: 4, nTrucks: 1, nte: 1150, flat: false, lines: [{ label: "3 movers, 4 hr at $195/hr", amt: 780 }, { label: "Truck and fuel", amt: 220 }] },
    items: [{ id: "sofa3", name: "Sofa (3-seat)", cf: 55, qty: 1 }], assign: { truckId: "", crew: [] }, signed: {}, payments: {}, extras: {}, materials: {},
    costs: { c1: { id: "c1", label: "Dump fee", amt: 65 } }, crewNotes: { n1: { id: "n1", who: "Marcus", text: "Stairs are narrow" } }, log: {}, ...over };
}
putDoc(ORG, "org/settings", settings);
putDoc(ORG, "formpages/pg1", { id: "pg1", data: "data:image/jpeg;base64,AAAA" });
putDoc(ORG, "jobs/q1", job("q1"));                                                                           // an open quote
putDoc(ORG, "jobs/b1", job("b1", { status: "booked", d: { ...job("x").d, email: "PRIYANAIR@gmail.com", moveDate: later, time: "15:00" } }));   // booked (after the quote's 4 hours and the hour between moves), the deposit due
putDoc(ORG, "jobs/d1", job("d1", { status: "done", d: { ...job("x").d, email: "priyanair@googlemail.com", moveDate: past }, assign: { truckId: "t26", crew: ["Marcus", "Kim"] },
  signed: { s1: { id: "s1", formId: "f_deliv" }, s2: { id: "s2", formId: "f_agree" }, s3: { id: "s3", formId: "f_scan" } }, payments: { p0: { id: "p0", amt: 250, method: "Cash", date: past, ts: 1 } } }));   // moved, 750 due
putDoc(ORG, "jobs/l1", job("l1", { status: "lost" }));
putDoc(ORG, "jobs/o1", job("o1", { d: { ...job("x").d, email: "priyanair2@gmail.com" } }));                 // someone else
putDoc(ORG, "jobs/o2", job("o2", { d: { ...job("x").d, email: "xpriyanair@gmail.com" } }));                 // someone else again
putDoc(ORG2, "org/settings", { company: "Blue Van Co", opt: { custBook: false, custTips: false } });
putDoc(ORG2, "jobs/z1", job("z1", { d: { ...job("x").d, email: "priya.nair@gmail.com" } }));
DB.comm_lines.push({ org_id: ORG, phone_number: "+15125550000", enabled: true });

/* ---------- emails ---------- */
ok(fn.emailKey("Priya.Nair+moving@GMAIL.com") === "priyanair@gmail.com" && fn.emailKey("priyanair@googlemail.com") === "priyanair@gmail.com", "a Gmail address is the same mailbox with or without dots or a +tag, on either Google domain");
ok(fn.emailKey("Sam.K+x@Example.com") === "sam.k+x@example.com" && fn.emailKey("not an email") === "" && fn.emailKey("@x.com") === "" && fn.emailKey("a b@x.com") === "", "any other address is just lowercased, and nonsense is nobody");
ok(JSON.stringify(fn.custPatterns("priyanair@gmail.com")) === JSON.stringify(["p*r*i*y*a*n*a*i*r*@gmail.com", "p*r*i*y*a*n*a*i*r*@googlemail.com"]) && fn.custPatterns("sam@example.com")[0] === "sam@example.com", "the database is asked loosely for Gmail, then each match is checked exactly");

/* ---------- who may ask ---------- */
let r = await app("tok-unconfirmed", { action: "cust_list" });
ok(r.status === 401, "an email that was never confirmed is nobody's");
r = await app("nobody", { action: "cust_list" });
ok(r.status === 401, "and no sign-in is turned away");

/* ---------- their moves ---------- */
r = await app("tok-priya", { action: "cust_list" });
const ids = (r.body.moves || []).map((m: any) => m.org.slice(0, 1) + ":" + m.id).sort().join(",");
ok(r.body.ok && ids === "1:b1,1:d1,1:q1,2:z1", "Priya sees her moves in both companies, written any way Gmail allows, and nobody else's, nor the lost one: " + ids);
ok(r.body.email === "Priya.Nair@gmail.com" && r.body.name === "Priya Nair", "with her name from her Google account");
const q1 = r.body.moves.find((m: any) => m.id === "q1"), b1 = r.body.moves.find((m: any) => m.id === "b1"), d1 = r.body.moves.find((m: any) => m.id === "d1"), z1 = r.body.moves.find((m: any) => m.id === "z1");
const flat = JSON.stringify(r.body.moves);
ok(!/Gate code|Dump fee|Stairs are narrow|"log"|"costs"|"crewNotes"|"assign"/.test(flat), "her copy has none of the company's own: the notes, the costs, the crew's notes, the activity, who's on the crew");
ok(q1.company === "Ace Moving" && q1.phone === "+15125550000" && z1.company === "Blue Van Co" && z1.phone === "", "each says its company, and the company line to call or text");
ok(q1.quote.total === 1000 && q1.quote.nte === 1150 && q1.quote.lines.length === 2 && q1.quote.deposit === 250 && q1.items[0].name === "Sofa (3-seat)" && q1.book === true && q1.tips === true && q1.review === "https://g.page/r/ace-review", "the quote, its lines, what's moving, and the company's switches and review page");
ok(z1.book === false && z1.tips === false && z1.review === "", "the other company's switches are its own");
ok(b1.bill.deposit === 250 && b1.bill.due === 1000 && d1.bill.paid === 250 && d1.bill.due === 750 && d1.crew.lead === "Marcus" && d1.crew.n === 2, "what's owed: the deposit on the booked move, the bill on the moved one, and the crew (the lead's first name, how many)");
const agree = b1.forms.find((f: any) => f.id === "f_agree"), scan = b1.forms.find((f: any) => f.id === "f_scan"), deliv = b1.forms.find((f: any) => f.id === "f_deliv");
ok(agree.ahead && !agree.signed && agree.text === "I agree to the quote." && scan.pages[0] === "data:image/jpeg;base64,AAAA" && !deliv.ahead, "the forms: the ones to sign ahead, with their pages for a booked move, and the one signed with the crew");
ok(ilikes.length > 0 && ilikes.every((x) => /^ilike\./.test(x)), "found by asking the database for that email");

/* ---------- booking a quote ---------- */
r = await app("tok-sam", { action: "cust_book", org: ORG, jobId: "q1" });
ok(r.status === 404 && !doc("jobs/q1").cust, "Sam can't book Priya's quote");
r = await app("tok-priya", { action: "cust_book", org: ORG2, jobId: "z1" });
ok(!r.body.ok && /Call or text Blue Van Co to book it/.test(r.body.message) && doc("jobs/z1", ORG2).status === "quoted", "a company that books its own quotes says so: " + r.body.message);
// the truck is busy then: a booked move that overlaps 9:00 for 4 hours
putDoc(ORG, "jobs/x9", { ...job("x9", { status: "booked", d: { ...job("x").d, email: "other@example.com", time: "10:00" } }) });
r = await app("tok-priya", { action: "cust_book", org: ORG, jobId: "q1" });
ok(!r.body.ok && /That time just filled up/.test(r.body.message) && doc("jobs/q1").status === "quoted", "no room on the trucks then: " + r.body.message);
DB.docs = DB.docs.filter((x) => x.path !== "jobs/x9");
const sentBefore = sent.length;
r = await app("tok-priya", { action: "cust_book", org: ORG, jobId: "q1" });
const q1d = doc("jobs/q1");
ok(r.body.ok && q1d.status === "booked" && q1d.cust.bookedAt > 0 && logs("q1").indexOf("Booked by the customer in the customer app") >= 0 && logs("q1").indexOf("Status: Booked") >= 0, "she books it: booked, and the activity says it was the customer");
ok(sent.length - sentBefore === 2 && sent.slice(sentBefore).every((t) => /Priya Nair booked their move for .* in the customer app\. Add the truck and crew in Tally\./.test(t.Body)), "the office is texted: the owner and dispatch (" + (sent.length - sentBefore) + ")");
r = await app("tok-priya", { action: "cust_book", org: ORG, jobId: "q1" });
ok(r.body.ok && logs("q1").filter((x) => /Booked by the customer/.test(x)).length === 1 && sent.length - sentBefore === 2, "a second tap books nothing twice");
putDoc(ORG, "jobs/q2", job("q2", { d: { ...job("x").d, moveDate: past } }));
r = await app("tok-priya", { action: "cust_book", org: ORG, jobId: "q2" });
ok(!r.body.ok && /That day has passed/.test(r.body.message), "a day that has passed can't be booked");

/* ---------- signing ahead ---------- */
const SIG = "data:image/png;base64," + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "b1", formId: "f_deliv", name: "Priya Nair", sig: SIG });
ok(!r.body.ok && /isn't one to sign ahead/.test(r.body.message), "the delivery receipt is signed with the crew, not ahead");
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "b1", formId: "f_agree", name: "Priya Nair", sig: "data:image/png;base64,xx" });
ok(!r.body.ok && /didn't come through/.test(r.body.message), "a signature that isn't one is refused");
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "b1", formId: "f_agree", name: "  Priya   Nair ", sig: SIG });
const sg = Object.values(doc("jobs/b1").signed).find((x: any) => x.formId === "f_agree") as any;
ok(r.body.ok && sg && sg.by === "customer" && sg.ahead === true && sg.name === "Priya Nair" && sg.sig === SIG && logs("b1").some((x) => /Signed ahead in the customer app: Moving agreement \(Priya Nair\)/.test(x)), "she signs the agreement ahead, kept like the crew's signatures");
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "b1", formId: "f_agree", name: "Priya Nair", sig: SIG });
ok(r.body.ok && Object.values(doc("jobs/b1").signed).filter((x: any) => x.formId === "f_agree").length === 1, "signing again changes nothing");

/* ---------- paying: not set up yet ---------- */
r = await app("tok-priya", { action: "cust_pay", org: ORG, jobId: "b1", kind: "deposit", amount: 25000, tip: 0 });
ok(!r.body.ok && /aren't set up yet/.test(r.body.message) && stripeCalls.length === 0, "no Stripe key: nothing reaches Stripe");
Deno.env.set("STRIPE_SECRET_KEY", "sk_test_123");
DB.pay_orgs.push({ org_id: ORG, enabled: true });

/* ---------- the deposit ---------- */
r = await app("tok-priya", { action: "cust_pay", org: ORG, jobId: "b1", kind: "deposit", amount: 20000, tip: 0 });
ok(!r.body.ok && r.body.changed && /What's owed now is \$250\.00/.test(r.body.message), "an out-of-date screen is told the amount to pay, not charged it: " + r.body.message);
r = await app("tok-priya", { action: "cust_pay", org: ORG, jobId: "b1", kind: "deposit", amount: 25000, tip: 500 });
ok(!r.body.ok && /A tip goes on the bill after the move/.test(r.body.message), "no tip on a deposit");
r = await app("tok-priya", { action: "cust_pay", org: ORG, jobId: "b1", kind: "deposit", amount: 25000, tip: 0, back: "https://mischief503.github.io/Tally/" });
let cs = ST.sessions[r.body.url.split("/").pop()];
ok(r.body.ok && /^https:\/\/checkout\.stripe\.com\//.test(r.body.url) && cs.amount_total === 25000 && cs.items.length === 1 && /Ace Moving: deposit/.test(cs.items[0].name), "a Stripe page for the $250 deposit: " + r.body.url);
ok(cs.params.success_url === "https://mischief503.github.io/Tally/?paid=b1" && cs.params.cancel_url === "https://mischief503.github.io/Tally/" && cs.metadata.tally_src === "cust" && cs.metadata.tally_tip === "0" && cs.metadata.tally_uid === "u-priya", "it comes back to her app, and says it's hers, from the customer app");
ok(!Object.keys(cs.params).some((k) => /payment_method_types/.test(k)), "the page offers what Stripe allows for the company: Google Pay, Apple Pay, cards (no fixed list)");
const link1 = DB.pay_links.find((l) => l.session_id === cs.id);
ok(link1 && link1.created_by === fn.CUST_BY && link1.amount_cents === 25000 && link1.status === "open", "the page is kept like a pay link, so a payment elsewhere closes it");
let g = await getUrl("/p/" + link1.token);
ok(g.status === 410 && /Open the Tally app to pay/.test(g.text), "its code isn't a pay link anyone can open");
// she pays with Google Pay
let pi = customerPays(cs.id);
let h = await hook(sessionDone(cs.id, pi.id));
let b1d = doc("jobs/b1"), e = b1d.payments["st_" + pi.id];
ok(h.status === 200 && e && e.amt === 250 && !e.tip && /Google Pay \(Visa ••4242\) \(customer app\)/.test(e.method) && b1d.status === "booked", "paid: $250 on the job, by Google Pay, from the customer app");
ok(DB.pay_links.find((l) => l.session_id === cs.id).status === "paid", "and the page is done");
r = await app("tok-priya", { action: "cust_list" });
ok(r.body.moves.find((m: any) => m.id === "b1").bill.deposit === 0, "her app shows the deposit paid");

/* ---------- the bill, with a tip ---------- */
r = await app("tok-priya", { action: "cust_pay", org: ORG, jobId: "d1", kind: "bill", amount: 75000, tip: 15000 });
cs = ST.sessions[r.body.url.split("/").pop()];
ok(r.body.ok && cs.amount_total === 90000 && cs.items.length === 2 && cs.items[1].name === "Tip for your crew" && cs.items[1].amount === 15000 && cs.metadata.tally_tip === "15000", "the bill and a $150 tip, each its own line: $900 in all");
ok(DB.pay_links.find((l) => l.session_id === cs.id).amount_cents === 75000, "the page counts as $750 toward the bill");
// she changes the tip: a new page, the old one closed
r = await app("tok-priya", { action: "cust_pay", org: ORG, jobId: "d1", kind: "bill", amount: 75000, tip: 11250 });
const cs2 = ST.sessions[r.body.url.split("/").pop()];
ok(r.body.ok && ST.sessions[cs.id].status === "expired" && cs2.amount_total === 86250, "a new tip gets a new page, and the old page closes");
pi = customerPays(cs2.id);
h = await hook(sessionDone(cs2.id, pi.id));
let d1d = doc("jobs/d1");
e = d1d.payments["st_" + pi.id];
ok(e && e.amt === 750 && e.tip === 112.5 && d1d.status === "paid", "paid: $750 toward the bill and a $112.50 tip, and the job is paid");
ok(logs("d1").some((x) => /Payment \$750\.00 and a \$112\.50 tip for the crew/.test(x)), "the activity: the payment and the tip");
const led = DB.pay_log.find((x) => x.pi === pi.id);
ok(led && led.amount_cents === 86250 && led.source === "cust;tip=11250" && fn.tipOfRow(led) === 11250, "the ledger keeps the whole payment, and the tip in it");
ok((await fn.owedCents(ORG, "d1")) === 0, "nothing owed: the tip didn't count toward the bill (and isn't $112.50 over it)");
r = await app("tok-priya", { action: "cust_list" });
const d1b = r.body.moves.find((m: any) => m.id === "d1");
ok(d1b.status === "paid" && d1b.bill.due === 0 && d1b.pays.some((p: any) => p.tip === 112.5 && p.amt === 750), "her app: paid, with the tip on the receipt");

/* ---------- a tip after the bill is paid ---------- */
r = await app("tok-priya", { action: "cust_pay", org: ORG, jobId: "d1", kind: "", amount: 0, tip: 4000 });
const cs3 = ST.sessions[r.body.url.split("/").pop()];
ok(r.body.ok && cs3.amount_total === 4000 && cs3.items.length === 1 && cs3.items[0].name === "Tip for your crew", "a tip on its own, after the bill is paid");
pi = customerPays(cs3.id);
await hook(sessionDone(cs3.id, pi.id));
d1d = doc("jobs/d1");
ok(d1d.payments["st_" + pi.id].amt === 0 && d1d.payments["st_" + pi.id].tip === 40 && d1d.status === "paid" && (await fn.owedCents(ORG, "d1")) === 0, "kept as a tip: $0 toward the bill, $40 to the crew");

/* ---------- a refund comes off the bill first, then the tip ---------- */
const tipped = Object.values(ST.intents).find((x: any) => x.amount === 86250) as any;
ST.charges[tipped.latest_charge].amount_refunded = 86250;
await hook(chargeEvent(tipped));
d1d = doc("jobs/d1");
const rf = d1d.payments["rf_" + tipped.id], rt = d1d.payments["rt_" + tipped.id];
ok(rf && rf.amt === -750 && rt && rt.amt === 0 && rt.tip === -112.5 && d1d.status === "done" && (await fn.owedCents(ORG, "d1")) === 75000, "refunded in full: $750 back off the bill (owed again) and the $112.50 tip back off the crew's");
ST.charges[tipped.latest_charge].amount_refunded = 20000;
await hook(chargeEvent(tipped));
d1d = doc("jobs/d1");
ok(d1d.payments["rf_" + tipped.id].amt === -200 && !d1d.payments["rt_" + tipped.id] && (await fn.owedCents(ORG, "d1")) === 20000, "a $200 refund comes off the bill's part, and the crew keeps the tip");

/* ---------- the office's pay link never hands out her page ---------- */
DB.members.push({ org_id: ORG, user_id: "u-owner", role: "owner", staff: "Owner" });
r = await app("tok-priya", { action: "cust_pay", org: ORG, jobId: "d1", kind: "bill", amount: 20000, tip: 1000 });
const mine = DB.pay_links.find((l) => l.session_id === r.body.url.split("/").pop());
r = await app("tok-owner", { action: "pay_link", org: ORG, jobId: "d1", amount: 200 });
const office = DB.pay_links.find((l) => r.body.url && l.token === r.body.url.split("/p/")[1]);
ok(r.body.ok && office && office.token !== mine.token && office.created_by !== fn.CUST_BY, "the office's own link for the same $200 is a new one, not her page with her tip");
ok(DB.pay_links.find((l) => l.token === mine.token).status === "expired", "and replaces hers, so the bill can't be paid twice");

/* ---------- back from Stripe, the review page, and her profile ---------- */
r = await app("tok-priya", { action: "cust_check", org: ORG, jobId: "d1" });
ok(r.body.ok, "back from Stripe's page, the move is brought up to date");
r = await app("tok-priya", { action: "cust_reviewed", org: ORG, jobId: "d1", how: "went" });
ok(r.body.ok && doc("jobs/d1").cust.reviewAt > 0 && logs("d1").indexOf("The customer app took them to the review page") >= 0, "the app took her to the review page: written down once");
r = await app("tok-priya", { action: "cust_reviewed", org: ORG, jobId: "d1", how: "not now" });
ok(logs("d1").filter((x) => /review/.test(x)).length === 1, "and only once");
r = await app("tok-priya", { action: "cust_profile", name: "Priya N. Nair", phone: "512-555-0199" });
ok(r.body.ok && r.body.changed === 4 && doc("jobs/q1").d.phone === "512-555-0199" && doc("jobs/q2").d.phone === "512-555-0199" && doc("jobs/b1").d.name === "Priya N. Nair" && doc("jobs/d1").d.phone === "512-555-0142" && doc("jobs/z1", ORG2).d.phone === "512-555-0199", "her new phone goes on her open moves (not the finished one), in both companies");
ok(doc("jobs/o1").d.phone === "512-555-0142", "and on nobody else's");
r = await app("tok-priya", { action: "cust_profile", name: "", phone: "" });
ok(!r.body.ok && /Put in your name/.test(r.body.message), "a profile needs a name");

/* ---------- the office texts a customer the app ---------- */
USERS["tok-kim"] = { id: "u-kim", email: "kim@acemoving.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
DB.members.push({ org_id: ORG, user_id: "u-kim", role: "crew", staff: "Kim" });
r = await app("tok-kim", { action: "invite_app", org: ORG, jobId: "b1", url: "https://mischief503.github.io/Tally/" });
ok(r.status === 403, "the crew don't text customers the app");
const before2 = sent.length;
r = await app("tok-owner", { action: "invite_app", org: ORG, jobId: "b1", url: "https://appassets.androidplatform.net/assets/index.html" });
ok(!r.body.ok && sent.length === before2, "never the Android app's own page");
r = await app("tok-owner", { action: "invite_app", org: ORG, jobId: "b1", url: "https://mischief503.github.io/Tally/#x" });
const inv = sent[sent.length - 1];
ok(r.body.ok && sent.length === before2 + 1 && inv.To === "+15125550199" && /^Ace Moving: Hi Priya, your move is in the Tally app: https:\/\/mischief503\.github\.io\/Tally\/ Sign in with PRIYANAIR@gmail\.com to see it, book, sign and pay\./.test(inv.Body), "the owner texts Priya the app, from the company line: " + inv.Body);
r = await app("tok-owner", { action: "invite_app", org: ORG, jobId: "b1", url: "https://mischief503.github.io/Tally/" });
ok(!r.body.ok && /a moment ago/.test(r.body.message) && sent.length === before2 + 1, "not twice in a row");
putDoc(ORG, "jobs/n1", job("n1", { d: { ...job("x").d, email: "" } }));
r = await app("tok-owner", { action: "invite_app", org: ORG, jobId: "n1", url: "https://mischief503.github.io/Tally/" });
ok(!r.body.ok && /Put the customer's email on the job first/.test(r.body.message), "a job with no email: put it on first");

/* ---------- where Stripe sends her back ---------- */
ok(fn.custBack("https://mischief503.github.io/Tally/#x", "d1") === "https://mischief503.github.io/Tally/?paid=d1" && /\/pay\/done$/.test(fn.custBack("https://appassets.androidplatform.net/assets/index.html", "d1")) && /\/pay\/done$/.test(fn.custBack("javascript:alert(1)", "d1")), "back to the web page she paid from; never the Android app's own page, nor anything that isn't https");

/* ---------- a bigger crew: signed in the customer app until loading starts (Richie, Oct 29) ---------- */
settings.rates = { r2: 140, r3: 195, r4: 250 };
putDoc(ORG, "org/settings", settings);
const bq = { ...job("x").quote, kind: "local", rate: 195, crew: 3 };
putDoc(ORG, "jobs/bc1", job("bc1", { status: "booked", d: { ...job("x").d, email: "priyanair@gmail.com", time: "07:00" }, quote: bq, assign: { truckId: "t26", crew: ["Marcus", "Kim", "Dee", "Luis"] } }));
ok(fn.crewMostOf(doc("jobs/bc1")) === 4 && fn.crewRateOf(settings, doc("jobs/bc1"), 4) === 250 && fn.crewRateOf(settings, doc("jobs/bc1"), 3) === 195, "4 movers on a 3-man move: $250/hr for 4 (the quote's rate plus the rate card's difference)");
r = await app("tok-priya", { action: "cust_list" });
let bc = (r.body.moves || []).find((m: any) => m.id === "bc1"), cf = bc && bc.forms[0];
ok(cf && cf.id === "crew:4" && cf.kind === "crew" && cf.n === 4 && cf.rate === 250 && cf.qc === 3 && cf.qrate === 195 && cf.ahead === true && cf.signed === null && !/Kim|Dee|Luis/.test(JSON.stringify(bc)), "her copy: the bigger crew first among the forms to sign, with the movers and the rate, and none of their names");
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "bc1", formId: "crew:3", name: "Priya Nair", sig: SIG });
ok(!r.body.ok && r.body.message === "Your crew changed. Check it and sign again.", "a signature for a crew it isn't now is refused: " + r.body.message);
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "bc1", formId: "crew:4", name: "Priya Nair", sig: "data:image/png;base64,xx" });
ok(!r.body.ok && /didn't come through/.test(r.body.message), "no signature, nothing kept");
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "bc1", formId: "crew:4", name: "  Priya   Nair ", sig: SIG });
const csg: any = Object.values(doc("jobs/bc1").signed || {}).find((x: any) => x.formId === "crew:4") || {};
ok(r.body.ok && csg.n === 4 && csg.rate === 250 && csg.ahead === true && csg.by === "customer" && csg.name === "Priya Nair" && csg.title === "Bigger crew: 4 movers" && csg.sig === SIG && logs("bc1").indexOf("Signed ahead in the customer app: Bigger crew: 4 movers at $250/hr (Priya Nair)") >= 0, "signed: kept with the job's forms, as the crew lead's phone keeps it, and the activity says so");
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "bc1", formId: "crew:4", name: "Priya Nair", sig: SIG });
ok(r.body.ok && Object.values(doc("jobs/bc1").signed || {}).filter((x: any) => x.formId === "crew:4").length === 1, "signing again changes nothing");
r = await app("tok-priya", { action: "cust_list" });
bc = r.body.moves.find((m: any) => m.id === "bc1"); cf = bc.forms[0];
ok(cf.id === "crew:4" && cf.signed && cf.signed.name === "Priya Nair" && cf.signed.ahead === true, "her copy: signed");
// moving today, the crew on the way: still hers until loading starts; then the crew lead's
putDoc(ORG, "jobs/bc2", job("bc2", { status: "active", crewAsk: 1, startedAt: Date.now() - 20 * 60e3, phases: {}, d: { ...job("x").d, email: "priyanair@gmail.com", moveDate: new Date().toISOString().slice(0, 10) }, quote: bq, assign: { truckId: "t26", crew: ["Marcus", "Kim", "Dee", "Luis"] } }));
r = await app("tok-priya", { action: "cust_list" });
ok((r.body.moves.find((m: any) => m.id === "bc2").forms[0] || {}).id === "crew:4", "on the way: hers to sign");
const bc2 = doc("jobs/bc2"); bc2.phases = { loadStart: Date.now() }; putDoc(ORG, "jobs/bc2", bc2);
r = await app("tok-priya", { action: "cust_list" });
ok(!(r.body.moves.find((m: any) => m.id === "bc2").forms || []).some((f: any) => f.kind === "crew"), "loading started: not in her copy");
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "bc2", formId: "crew:4", name: "Priya Nair", sig: SIG });
ok(!r.body.ok && r.body.message === "Your crew lead has you sign for it on their phone.", "and not signed here: " + r.body.message);
bc2.phases = {}; putDoc(ORG, "jobs/bc2", bc2);
settings.opt = { ...(settings.opt || {}), forms: false }; putDoc(ORG, "org/settings", settings);
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "bc2", formId: "crew:4", name: "Priya Nair", sig: SIG });
ok(r.body.ok && Object.values(doc("jobs/bc2").signed || {}).some((x: any) => x.formId === "crew:4"), "before loading it's hers, and the forms switch doesn't change that (it's the bigger crew's own switch)");
settings.opt = { ...settings.opt, forms: true, crewSign: false }; putDoc(ORG, "org/settings", settings);
putDoc(ORG, "jobs/bc3", job("bc3", { status: "booked", d: { ...job("x").d, email: "priyanair@gmail.com", time: "07:00" }, quote: bq, assign: { truckId: "t26", crew: ["Marcus", "Kim", "Dee", "Luis"] } }));
r = await app("tok-priya", { action: "cust_list" });
ok(!(r.body.moves.find((m: any) => m.id === "bc3").forms || []).some((f: any) => f.kind === "crew"), "Options › Customer signs for a bigger crew off: nothing to sign");
r = await app("tok-priya", { action: "cust_sign", org: ORG, jobId: "bc3", formId: "crew:4", name: "Priya Nair", sig: SIG });
ok(!r.body.ok && r.body.message === "There's no bigger crew to sign for now.", "and nothing taken: " + r.body.message);
delete settings.opt.crewSign; putDoc(ORG, "org/settings", settings);
putDoc(ORG, "jobs/bc4", job("bc4", { status: "booked", d: { ...job("x").d, email: "priyanair@gmail.com", time: "07:00" }, quote: { ...bq, flat: true }, assign: { truckId: "t26", crew: ["Marcus", "Kim", "Dee", "Luis"] } }));
putDoc(ORG, "jobs/bc5", job("bc5", { status: "booked", d: { ...job("x").d, email: "priyanair@gmail.com", time: "07:00" }, quote: bq, assign: { truckId: "t26", crew: ["Marcus", "Kim", "Dee"] } }));
r = await app("tok-priya", { action: "cust_list" });
ok(!(r.body.moves.find((m: any) => m.id === "bc4").forms || []).some((f: any) => f.kind === "crew") && !(r.body.moves.find((m: any) => m.id === "bc5").forms || []).some((f: any) => f.kind === "crew"), "a flat price, or the crew as quoted: nothing to sign");

console.log(`\ncust: ${passes} passed, ${failures} failed`);
if (failures) Deno.exit(1);
