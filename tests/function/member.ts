// The membership each company pays Tally, and Tally admin, in the Edge Function. A fake Stripe with
// customers, products, prices, coupons, subscription checkout pages, subscriptions and the billing page,
// that answers like the 2026-09-30.endive API (current_period_end on the subscription item, invoices
// naming their subscription under parent.subscription_details, no top-level coupon parameter).
// Run: deno run -A tests/function/member.ts
// deno-lint-ignore-file no-explicit-any
(globalThis as any).__TALLY_TEST = true;
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
const fn = await import("../../supabase/functions/tally-twilio/index.ts");
const BASE = "https://proj.supabase.co/functions/v1/tally-twilio";

let failures = 0, passes = 0;
function ok(c: unknown, m: string) { if (c) { passes++; console.log("PASS", m); } else { failures++; console.log("FAIL", m); } }

/* ---------- in-memory database ---------- */
const DB: Record<string, any[]> = { docs: [], members: [], orgs: [], pay_orgs: [], pay_config: [], pay_config_connect: [], pay_accounts: [],
  tally_admins: [], tally_plan: [], tally_plan_stripe: [], member_deals: [], member_subs: [], member_invites: [] };
const KEYS: Record<string, string[]> = { docs: ["org_id", "path"], orgs: ["id"], members: ["org_id", "user_id"], pay_orgs: ["org_id"], pay_config: ["mode"], pay_config_connect: ["mode"],
  pay_accounts: ["account_id"], tally_admins: ["user_id"], tally_plan: ["id"], tally_plan_stripe: ["mode", "kind"], member_deals: ["org_id"], member_subs: ["org_id", "livemode"], member_invites: ["org_id", "email"] };
const clone = (o: any) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
function matches(row: any, filters: [string, string][]) {
  return filters.every(([k, f]) => {
    const i = f.indexOf("."), op = f.slice(0, i), val = f.slice(i + 1), v = row[k];
    if (op === "eq") return String(v) === val;
    if (op === "neq") return String(v) !== val;
    if (op === "is") return val === "true" ? v === true : val === "null" ? v == null : v === false;
    throw new Error("op " + op);
  });
}
let codes = 0;
function restMock(method: string, u: URL, body: any, prefer: string) {
  const parts = u.pathname.split("/");
  if (parts[parts.length - 2] === "rpc") {
    if (parts[parts.length - 1] === "new_join_code") return { status: 200, body: "JC" + String(++codes).padStart(4, "0") };
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
      if (table === "orgs" && !r.id) r.id = crypto.randomUUID();
      if (table === "member_invites" && !r.id) r.id = crypto.randomUUID();
      if (!r.created_at && table !== "docs") r.created_at = new Date().toISOString();
      if (table === "member_subs") r.livemode = !!r.livemode;
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
  if (method === "PATCH") { const hit = rows.filter((r) => matches(r, filters)); hit.forEach((r) => Object.assign(r, clone(body))); return { status: 200, body: rep ? clone(hit) : null }; }
  if (method === "DELETE") { DB[table] = rows.filter((r) => !matches(r, filters)); return { status: 204, body: null }; }
  return { status: 405, body: null };
}

/* ---------- a fake Stripe (the platform's own account) ---------- */
const calls: any[] = [];
const ST: any = { n: 0, customers: {}, products: {}, prices: {}, coupons: {}, sessions: {}, subs: {}, portalConfs: {}, portalSessions: [], hooks: [], idem: {} };
function unflat(p: Record<string, string>, prefix: string) {
  const out: any = {};
  Object.keys(p).forEach((k) => { if (k.indexOf(prefix + "[") === 0) { const m = /^\[([^\]]+)\]$/.exec(k.slice(prefix.length)); if (m) out[m[1]] = p[k]; } });
  return out;
}
const err = (status: number, message: string, code = "") => ({ status, body: { error: { type: "invalid_request_error", message, code } } });
function subView(s: any) { const v = clone(s); delete v.org; return v; }
// what Stripe does when the owner pays on the checkout page
function completeSession(cs: any) {
  const p = cs.params, sid = "sub_" + (++ST.n), now = Math.floor(Date.now() / 1000);
  const trialEnd = p["subscription_data[trial_end]"] ? +p["subscription_data[trial_end]"] : 0;
  ST.subs[sid] = { id: sid, object: "subscription", customer: p.customer, livemode: false, status: trialEnd ? "trialing" : "active", cancel_at_period_end: false,
    trial_end: trialEnd || null, metadata: unflat(p, "subscription_data[metadata]"),
    discounts: p["discounts[0][coupon]"] ? [{ coupon: { id: p["discounts[0][coupon]"] } }] : [],
    items: { data: [{ id: "si_" + ST.n, price: { id: p["line_items[0][price]"] }, current_period_end: (trialEnd || now) + 30 * 86400 }] } };
  cs.status = "complete"; cs.subscription = sid;
  return ST.subs[sid];
}
function stripeV1(method: string, path: string, p: Record<string, string>, idem: string) {
  const reply = (status: number, body: any) => ({ status, body });
  const id = () => String(++ST.n);
  if (idem) {
    const prev = ST.idem[idem];
    if (prev) return JSON.stringify(prev.p) === JSON.stringify(p) ? clone(prev.r) : err(400, "Keys for idempotent requests can only be used with the same parameters they were first used with.", "idempotency_error");
  }
  const r = route();
  if (idem && r.status === 200) ST.idem[idem] = { p: clone(p), r: clone(r) };
  return r;
  function route() {
    let m: RegExpExecArray | null;
    if (method === "GET" && path === "/v1/webhook_endpoints") return reply(200, { data: clone(ST.hooks) });
    if (method === "POST" && path === "/v1/webhook_endpoints") {
      const events = Object.keys(p).filter((k) => /^enabled_events\[\d+\]$/.test(k)).map((k) => p[k]);
      const w = { id: "we_" + id(), url: p.url, enabled_events: events, connect: p.connect === "true", status: "enabled", secret: "whsec_" + ST.n };
      ST.hooks.push(w); return reply(200, w);
    }
    if (method === "POST" && path === "/v1/customers") { const c = { id: "cus_" + id(), name: p.name, email: p.email, metadata: unflat(p, "metadata") }; ST.customers[c.id] = c; return reply(200, c); }
    if (method === "POST" && path === "/v1/products") { const x = { id: "prod_" + id(), name: p.name }; ST.products[x.id] = x; return reply(200, x); }
    if (method === "POST" && path === "/v1/prices") {
      if (!ST.products[p.product]) return err(400, "No such product");
      const x = { id: "price_" + id(), product: p.product, unit_amount: +p.unit_amount, currency: p.currency, recurring: { interval: p["recurring[interval]"] } };
      ST.prices[x.id] = x; return reply(200, x);
    }
    if (method === "POST" && path === "/v1/coupons") {
      if (ST.coupons[p.id]) return err(400, "Coupon already exists.", "resource_already_exists");
      ST.coupons[p.id] = { id: p.id, percent_off: +p.percent_off, duration: p.duration }; return reply(200, ST.coupons[p.id]);
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      if (p.mode !== "subscription") return err(400, "this fake only does memberships");
      if (!ST.customers[p.customer]) return err(400, "No such customer");
      if (!ST.prices[p["line_items[0][price]"]]) return err(400, "No such price");
      if (p["discounts[0][coupon]"] && !ST.coupons[p["discounts[0][coupon]"]]) return err(400, "No such coupon");
      if (p["subscription_data[trial_end]"] && +p["subscription_data[trial_end]"] < Date.now() / 1000 + 48 * 3600) return err(400, "trial_end must be at least 48 hours in the future");
      if (Object.keys(p).some((k) => /^payment_method_types/.test(k))) return err(400, "payment_method_types is no longer supported");
      const sid = "cs_test_" + id();
      const cs = { id: sid, object: "checkout.session", mode: "subscription", status: "open", url: "https://checkout.stripe.com/c/pay/" + sid, customer: p.customer,
        expires_at: Math.floor(Date.now() / 1000) + 86400, metadata: unflat(p, "metadata"), subscription: null, params: p };
      ST.sessions[sid] = cs; return reply(200, cs);
    }
    if ((m = /^\/v1\/checkout\/sessions\/(\w+)$/.exec(path)) && method === "GET") {
      const cs = ST.sessions[m[1]]; if (!cs) return err(404, "No such checkout.session");
      const v = clone(cs); delete v.params; return reply(200, v);
    }
    if ((m = /^\/v1\/subscriptions\/(\w+)$/.exec(path))) {
      const s = ST.subs[m[1]]; if (!s) return err(404, "No such subscription");
      if (method === "GET") return reply(200, subView(s));
      if (method === "DELETE") { s.status = "canceled"; return reply(200, subView(s)); }
      if (Object.keys(p).some((k) => k === "coupon")) return err(400, "Received unknown parameter: coupon");
      if (p.discounts === "") s.discounts = [];
      else if (p["discounts[0][coupon]"]) {
        if (!ST.coupons[p["discounts[0][coupon]"]]) return err(400, "No such coupon");
        s.discounts = [{ coupon: { id: p["discounts[0][coupon]"] } }];
      }
      return reply(200, subView(s));
    }
    if (method === "POST" && path === "/v1/billing_portal/configurations") { const c = { id: "bpc_" + id(), params: p }; ST.portalConfs[c.id] = c; return reply(200, { id: c.id }); }
    if (method === "POST" && path === "/v1/billing_portal/sessions") {
      if (!ST.customers[p.customer]) return err(400, "No such customer");
      if (!ST.portalConfs[p.configuration]) return err(400, "No such configuration");
      const s = { id: "bps_" + id(), url: "https://billing.stripe.com/p/session/" + ST.n, p }; ST.portalSessions.push(s); return reply(200, s);
    }
    return reply(404, { error: { message: "fake stripe: no route " + method + " " + path } });
  }
}
const USERS: Record<string, string> = { "tok-richie": "aaaaaaaa-0000-4000-8000-000000000001", "tok-ana": "aaaaaaaa-0000-4000-8000-000000000002", "tok-dot": "aaaaaaaa-0000-4000-8000-000000000003", "tok-gus": "aaaaaaaa-0000-4000-8000-000000000004" };
const EMAILS: Record<string, string> = { "aaaaaaaa-0000-4000-8000-000000000001": "richie@tally.example", "aaaaaaaa-0000-4000-8000-000000000002": "ana@bluemoving.example", "aaaaaaaa-0000-4000-8000-000000000003": "dot@bluemoving.example", "aaaaaaaa-0000-4000-8000-000000000004": "gus@green.example" };
(globalThis as any).fetch = async (input: string, init: any = {}) => {
  const u = new URL(input), method = (init.method || "GET").toUpperCase();
  const reply = (status: number, b: any) => new Response(status === 204 ? null : b == null ? "" : JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (u.host === "api.stripe.com") {
    const h = init.headers || {};
    const p: Record<string, string> = method === "GET" || method === "DELETE" ? Object.fromEntries(u.searchParams) : Object.fromEntries(new URLSearchParams(init.body || ""));
    calls.push({ method, path: u.pathname, p, ver: h["Stripe-Version"], acct: h["Stripe-Account"] || "", idem: h["Idempotency-Key"] || "" });
    const r = stripeV1(method, u.pathname, p, h["Idempotency-Key"] || "");
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

/* ---------- Richie (a Tally admin, with his test company) and Blue Moving (a customer) ---------- */
const TEST = "11111111-1111-4111-8111-111111111111", BLUE = "33333333-3333-4333-8333-333333333333";
const day = 86400e3;
DB.orgs.push({ id: TEST, name: "Live company trst", created_at: new Date(Date.now() - 4 * day).toISOString(), trial_ends: new Date(Date.now() + 26 * day).toISOString() },
  { id: BLUE, name: "Blue Moving", created_at: new Date(Date.now() - day).toISOString(), trial_ends: new Date(Date.now() + 13 * day).toISOString() });
DB.members.push({ org_id: TEST, user_id: "aaaaaaaa-0000-4000-8000-000000000001", role: "owner", staff: "", email: "richie@tally.example" },
  { org_id: BLUE, user_id: "aaaaaaaa-0000-4000-8000-000000000002", role: "owner", staff: "Ana", email: "ana@bluemoving.example" },
  { org_id: BLUE, user_id: "aaaaaaaa-0000-4000-8000-000000000003", role: "dispatch", staff: "Dot", email: "dot@bluemoving.example" });
DB.tally_admins.push({ user_id: "aaaaaaaa-0000-4000-8000-000000000001" });
DB.tally_plan.push({ id: 1, monthly_cents: 14900, trial_days: 14 });
DB.member_deals.push({ org_id: TEST, is_test: true, waived: true, discount_pct: 0, note: "Richie's test company" });
DB.docs.push({ org_id: BLUE, path: "org/settings", collection: "org", doc_id: "settings", data: { company: "Blue Moving" } });
Deno.env.set("STRIPE_SECRET_KEY", "sk_test_platform");
Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_test_platform");

async function app(tok: string, org: string, body: any) {
  const r = await fn.handle(new Request(BASE + "/app", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ org, ...body }) }));
  return { status: r.status, body: await r.json() };
}
async function getUrl(path: string) { const r = await fn.handle(new Request(BASE + path, { method: "GET" })); return { status: r.status, text: await r.text() }; }
const secretOf = (table: string) => (DB[table].find((x) => x.mode === "test") || {}).webhook_secret || "";
async function hook(event: any, path = "/stripe", secret = secretOf("pay_config")) {
  const raw = JSON.stringify(event), t = String(Math.floor(Date.now() / 1000));
  const sig = await fn.stripeSignature(raw, secret || "whsec_none", t);
  const r = await fn.handle(new Request(BASE + path, { method: "POST", headers: { "Stripe-Signature": "t=" + t + ",v1=" + sig }, body: raw }));
  return { status: r.status, text: await r.text() };
}
const last = (path: string, method = "POST") => [...calls].reverse().find((c) => c.path === path && c.method === method);
const count = (path: string, method = "POST") => calls.filter((c) => c.path === path && c.method === method).length;
const subRow = (org: string) => DB.member_subs.find((s) => s.org_id === org && s.livemode === false) || {};

/* ---------- what each person sees ---------- */
let r = await app("tok-ana", BLUE, { action: "member_status" });
ok(r.body.ok && r.body.state === "trial" && r.body.price_cents === 14900 && r.body.list_cents === 14900 && r.body.admin === false && r.body.test === false, "Blue Moving's owner: on the free trial, $149 a month after");
ok(Math.round((Date.parse(r.body.trial_ends) - Date.now()) / day) === 13, "with the trial's end date");
r = await app("tok-dot", BLUE, { action: "member_status" });
ok(r.body.ok && r.body.test === false && r.body.admin === false && r.body.state === undefined && r.body.price_cents === undefined, "dispatch is told only whether it's a test company: no prices");
r = await app("tok-richie", TEST, { action: "member_status" });
ok(r.body.ok && r.body.admin === true && r.body.test === true && r.body.state === "test", "Richie: a Tally admin, in his test company");
r = await app("tok-gus", BLUE, { action: "member_status" });
ok(r.status === 401, "someone who isn't in the company gets nothing");

/* ---------- the owner starts the membership ---------- */
r = await app("tok-dot", BLUE, { action: "member_start" });
ok(r.status === 403 && /Only the owner/.test(r.body.message), "dispatch can't start it");
r = await app("tok-ana", BLUE, { action: "member_start" });
ok(r.body.ok && /^https:\/\/checkout\.stripe\.com\//.test(r.body.url), "the owner gets Stripe's checkout page: " + r.body.url);
const cs1 = last("/v1/checkout/sessions");
ok(cs1.p.mode === "subscription" && cs1.p["line_items[0][quantity]"] === "1" && cs1.acct === "" && cs1.ver === fn.STRIPE_VERSION, "a subscription, on Tally's own Stripe account");
const price1 = ST.prices[cs1.p["line_items[0][price]"]];
ok(price1 && price1.unit_amount === 14900 && price1.currency === "usd" && price1.recurring.interval === "month", "at $149 a month");
ok(Math.abs(+cs1.p["subscription_data[trial_end]"] - Date.parse(DB.orgs[1].trial_ends) / 1000) < 2, "what's left of the free trial carries over: nothing is charged until it ends");
ok(cs1.p["metadata[tally_member]"] === BLUE && cs1.p["subscription_data[metadata][tally_member]"] === BLUE && cs1.p.client_reference_id === BLUE, "labelled with the company");
ok(cs1.p.success_url === BASE + "/member/done" && cs1.p.cancel_url === BASE + "/member/back", "and comes back to Tally's own pages");
const cus = ST.customers[cs1.p.customer];
ok(cus && cus.email === "ana@bluemoving.example" && cus.name === "Blue Moving" && cus.metadata.tally_member === BLUE, "the company is a Stripe customer with the owner's email");
ok(subRow(BLUE).customer_id === cus.id && /^cs_test_/.test(subRow(BLUE).checkout_id) && subRow(BLUE).checkout_url === r.body.url && Date.parse(subRow(BLUE).checkout_expires) > Date.now() + 23 * 3600e3, "the open checkout page is kept, with when it expires");
const plat = ST.hooks.find((w: any) => !w.connect && w.url === BASE + "/stripe");
ok(plat && fn.MEMBER_EVENTS.every((e: string) => plat.enabled_events.indexOf(e) >= 0) && plat.enabled_events.indexOf("checkout.session.completed") >= 0, "Tally's webhook listens for memberships too");
r = await app("tok-ana", BLUE, { action: "member_start" });
ok(r.body.ok && r.body.url === subRow(BLUE).checkout_url && count("/v1/checkout/sessions") === 1, "pressing it again opens the same checkout page");
ok(count("/v1/customers") === 1 && count("/v1/prices") === 1 && count("/v1/products") === 1, "one customer, one product, one price");
let g = await getUrl("/member/done");
ok(g.status === 200 && /membership is set up/.test(g.text), "Stripe's return page says it's done");
g = await getUrl("/member/back");
ok(g.status === 200 && /Setup › Membership/.test(g.text), "and the way back says where to look");

/* ---------- paid on Stripe's page: Stripe tells the webhook ---------- */
const sub1 = completeSession(ST.sessions[subRow(BLUE).checkout_id]);
let h = await hook({ id: "evt_1", type: "checkout.session.completed", livemode: false, data: { object: { id: subRow(BLUE).checkout_id, object: "checkout.session", mode: "subscription", subscription: sub1.id, customer: cus.id, metadata: { tally_member: BLUE } } } });
ok(h.status === 200 && subRow(BLUE).subscription_id === sub1.id && subRow(BLUE).status === "trialing" && subRow(BLUE).checkout_id === "", "the membership is written down: trialing, the checkout page done");
ok(Math.abs(Date.parse(subRow(BLUE).current_period_end) / 1000 - sub1.items.data[0].current_period_end) < 2, "with when it renews (from the subscription item, as in this API version)");
r = await app("tok-ana", BLUE, { action: "member_status" });
ok(r.body.state === "trialing" && r.body.billing === true, "the owner sees it's set up");
r = await app("tok-ana", BLUE, { action: "member_start" });
ok(!r.body.ok && r.body.portal === true && count("/v1/checkout/sessions") === 1, "starting again sends the owner to Manage billing instead");

/* ---------- Stripe's billing page ---------- */
r = await app("tok-dot", BLUE, { action: "member_portal" });
ok(r.status === 403, "dispatch can't open the billing page");
r = await app("tok-ana", BLUE, { action: "member_portal" });
const bp = last("/v1/billing_portal/configurations");
ok(r.body.ok && /^https:\/\/billing\.stripe\.com\//.test(r.body.url) && last("/v1/billing_portal/sessions").p.customer === cus.id, "the owner gets Stripe's billing page for the company");
ok(bp.p["features[subscription_cancel][enabled]"] === "true" && bp.p["features[subscription_cancel][mode]"] === "at_period_end" && bp.p["features[payment_method_update][enabled]"] === "true" && bp.p["features[invoice_history][enabled]"] === "true", "where they can change the card, see invoices and cancel at the end of the month");
await app("tok-ana", BLUE, { action: "member_portal" });
ok(count("/v1/billing_portal/configurations") === 1 && count("/v1/billing_portal/sessions") === 2, "the billing page's settings are made once");
r = await app("tok-richie", TEST, { action: "member_portal" });
ok(!r.body.ok && /Start the membership first/.test(r.body.message), "a company with no membership has no billing page");

/* ---------- Tally admin ---------- */
r = await app("tok-ana", BLUE, { action: "admin_list" });
ok(r.status === 403 && /Tally's admins/.test(r.body.message), "a company owner can't open Tally admin");
r = await app("tok-dot", BLUE, { action: "admin_set", target: BLUE, waived: true });
ok(r.status === 403 && !DB.member_deals.some((d) => d.org_id === BLUE), "or waive their own fee");
r = await app("tok-richie", TEST, { action: "admin_list" });
const blue = (r.body.companies || []).find((c: any) => c.id === BLUE), tst = (r.body.companies || []).find((c: any) => c.id === TEST);
ok(r.body.ok && r.body.companies.length === 2 && r.body.plan.monthly_cents === 14900 && r.body.plan.trial_days === 14, "Richie sees every company and the plan");
ok(blue && blue.owners.join() === "ana@bluemoving.example" && blue.members === 2 && blue.member.state === "trialing" && blue.cards === "none", "Blue Moving: its owner, two people, on its trial, cards not connected");
ok(tst && tst.test === true && tst.member.state === "test", "his test company is marked test");

// a discount: the running membership follows at once
r = await app("tok-richie", TEST, { action: "admin_set", target: BLUE, discount: 25, note: "Friend of the shop" });
ok(r.body.ok && r.body.company.discount_pct === 25 && r.body.company.note === "Friend of the shop" && r.body.company.member.price_cents === 11175, "a 25% discount: $111.75 a month");
ok(ST.coupons["tally-pct-25"] && ST.coupons["tally-pct-25"].duration === "forever" && ST.subs[sub1.id].discounts[0].coupon.id === "tally-pct-25", "the running membership gets a 25% coupon, for good");
const upd = last("/v1/subscriptions/" + sub1.id);
ok(upd.p["proration_behavior"] === "none" && !("coupon" in upd.p), "with no proration, and without the old coupon parameter");
r = await app("tok-ana", BLUE, { action: "member_status" });
ok(r.body.price_cents === 11175 && r.body.discount_pct === 25, "the owner sees the discounted price");
// waived
r = await app("tok-richie", TEST, { action: "admin_set", target: BLUE, waived: true });
ok(r.body.ok && r.body.company.waived && r.body.company.member.state === "waived" && ST.subs[sub1.id].discounts[0].coupon.id === "tally-pct-100", "fee waived: the running membership stops charging (100% off)");
r = await app("tok-ana", BLUE, { action: "member_status" });
ok(r.body.state === "waived", "the owner sees it's waived");
r = await app("tok-ana", BLUE, { action: "member_start" });
ok(!r.body.ok && /waived/.test(r.body.message), "and has nothing to start");
r = await app("tok-richie", TEST, { action: "admin_set", target: BLUE, waived: false });
ok(r.body.ok && ST.subs[sub1.id].discounts[0].coupon.id === "tally-pct-25" && count("/v1/coupons") === 2, "the switch off again: back to the 25% discount, no new coupon made");
r = await app("tok-richie", TEST, { action: "admin_set", target: BLUE, discount: 0 });
ok(r.body.ok && ST.subs[sub1.id].discounts.length === 0 && last("/v1/subscriptions/" + sub1.id).p.discounts === "", "no discount: the coupon comes off");
r = await app("tok-richie", TEST, { action: "admin_set", target: BLUE, discount: 120 });
ok(!r.body.ok && /whole percent from 0 to 100/.test(r.body.message), "a discount over 100% is refused");
r = await app("tok-richie", TEST, { action: "admin_set", target: BLUE, discount: 12.5 });
ok(!r.body.ok, "so is a part of a percent");
r = await app("tok-richie", TEST, { action: "admin_set", target: "99999999-9999-4999-8999-999999999999", waived: true });
ok(!r.body.ok && /not found/.test(r.body.message), "a company that doesn't exist");
// the plan
r = await app("tok-ana", BLUE, { action: "admin_plan", monthly: 1 });
ok(r.status === 403 && DB.tally_plan[0].monthly_cents === 14900, "an owner can't change the price");
r = await app("tok-richie", TEST, { action: "admin_plan", monthly: 199, trialDays: 30 });
ok(r.body.ok && DB.tally_plan[0].monthly_cents === 19900 && DB.tally_plan[0].trial_days === 30 && /running ones keep their price/.test(r.body.message), "Richie sets $199 and a 30-day trial for new memberships");
r = await app("tok-richie", TEST, { action: "admin_plan", monthly: 0.5 });
ok(!r.body.ok, "a price under $1 is refused");
r = await app("tok-richie", TEST, { action: "admin_plan", trialDays: 400 });
ok(!r.body.ok && DB.tally_plan[0].trial_days === 30, "so is a trial over a year");

/* ---------- adding a company ---------- */
r = await app("tok-ana", BLUE, { action: "admin_add", name: "Sneaky Co", email: "ana@bluemoving.example" });
ok(r.status === 403 && DB.orgs.length === 2, "an owner can't add companies through Tally admin");
r = await app("tok-richie", TEST, { action: "admin_add", name: "Green Movers", email: "Gus@Green.example" });
const green = DB.orgs.find((o) => o.name === "Green Movers");
ok(r.body.ok && green && /gus@green\.example signs in/.test(r.body.message), "Richie adds Green Movers for Gus: " + r.body.message);
ok(DB.member_invites.some((i) => i.org_id === green.id && i.email === "gus@green.example") && !DB.members.some((m) => m.org_id === green.id), "Gus becomes its owner when he signs in (his email kept in lower case)");
ok(Math.round((Date.parse(green.trial_ends) - Date.now()) / day) === 30 && green.join_code === "JC0001", "with the new 30-day trial and a company code");
r = await app("tok-richie", TEST, { action: "admin_list" });
const g2 = r.body.companies.find((c: any) => c.id === green.id);
ok(g2 && g2.invited.join() === "gus@green.example" && g2.owners.length === 0 && g2.member.state === "trial", "Tally admin shows who it's waiting for");
r = await app("tok-richie", TEST, { action: "admin_add", name: "Test Two", email: "richie@tally.example", test: true });
const t2 = DB.orgs.find((o) => o.name === "Test Two");
ok(r.body.ok && r.body.mine && DB.members.some((m) => m.org_id === t2.id && m.user_id === "aaaaaaaa-0000-4000-8000-000000000001" && m.role === "owner"), "a company with his own email: he's its owner right away");
ok(DB.member_deals.some((d) => d.org_id === t2.id && d.is_test && d.waived), "marked as a test company");
r = await app("tok-richie", TEST, { action: "admin_add", name: "", email: "x@y.example" });
ok(!r.body.ok && /name/.test(r.body.message), "a company needs a name");
r = await app("tok-richie", TEST, { action: "admin_add", name: "Nope", email: "not an email" });
ok(!r.body.ok && /email/.test(r.body.message), "and its owner's email");

/* ---------- Stripe's later news about the membership ---------- */
ST.subs[sub1.id].status = "past_due";
h = await hook({ id: "evt_2", type: "customer.subscription.updated", livemode: false, data: { object: { id: sub1.id, object: "subscription", customer: cus.id, metadata: { tally_member: BLUE } } } });
ok(h.status === 200 && subRow(BLUE).status === "past_due", "a card that failed: past due");
r = await app("tok-ana", BLUE, { action: "member_status" });
ok(r.body.state === "past_due", "the owner sees the membership needs a new card");
ST.subs[sub1.id].status = "active";
h = await hook({ id: "evt_3", type: "invoice.paid", livemode: false, data: { object: { id: "in_1", object: "invoice", customer: cus.id, parent: { subscription_details: { subscription: sub1.id } } } } });
ok(h.status === 200 && subRow(BLUE).status === "active", "an invoice paid: active again (the subscription found from the invoice's parent)");
// an event with no label on it, for a customer we filed
ST.subs[sub1.id].cancel_at_period_end = true;
h = await hook({ id: "evt_4", type: "customer.subscription.updated", livemode: false, data: { object: { id: sub1.id, object: "subscription", customer: cus.id, metadata: {} } } });
ok(subRow(BLUE).cancel_at_period_end === true, "found by its customer when the label is missing: cancelling at the end of the month");
r = await app("tok-ana", BLUE, { action: "member_status" });
ok(r.body.state === "active" && r.body.cancel_at_period_end === true, "the owner sees it ends with this month");
// a stray subscription for a company that doesn't exist
const before = JSON.stringify(DB.member_subs);
ST.subs.sub_stray = { id: "sub_stray", object: "subscription", customer: "cus_other", livemode: false, status: "active", metadata: { tally_member: "99999999-9999-4999-8999-999999999999" }, items: { data: [{ price: { id: "p" }, current_period_end: 1 }] } };
h = await hook({ id: "evt_5", type: "customer.subscription.created", livemode: false, data: { object: { id: "sub_stray", object: "subscription", customer: "cus_other", metadata: { tally_member: "99999999-9999-4999-8999-999999999999" } } } });
ok(h.status === 200 && JSON.stringify(DB.member_subs) === before, "a subscription for a company that doesn't exist changes nothing");
// two checkout pages paid for the same company: the second membership is stopped
ST.subs.sub_dup = { id: "sub_dup", object: "subscription", customer: cus.id, livemode: false, status: "active", metadata: { tally_member: BLUE }, items: { data: [{ price: { id: price1.id }, current_period_end: 2 }] } };
h = await hook({ id: "evt_6", type: "customer.subscription.created", livemode: false, data: { object: { id: "sub_dup", object: "subscription", customer: cus.id, metadata: { tally_member: BLUE } } } });
ok(subRow(BLUE).subscription_id === sub1.id && ST.subs.sub_dup.status === "canceled", "a second membership for the same company is cancelled; the first stays");
// the same events on the companies' webhook (their own Stripe accounts) are not memberships
await app("tok-ana", BLUE, { action: "pay_config" });
DB.pay_config_connect.push({ mode: "test", webhook_id: "we_c", webhook_secret: "whsec_connect", status: "ready", events: "", updated_at: new Date().toISOString() });
const b4 = JSON.stringify(DB.member_subs);
h = await hook({ id: "evt_7", type: "customer.subscription.deleted", livemode: false, account: "acct_1Blue000ABCD", data: { object: { id: sub1.id, object: "subscription", customer: cus.id, metadata: { tally_member: BLUE } } } }, "/stripe/connect", "whsec_connect");
ok(h.status === 200 && JSON.stringify(DB.member_subs) === b4, "a company's own Stripe account can't touch its membership");
// cancelled for good
ST.subs[sub1.id].status = "canceled";
h = await hook({ id: "evt_8", type: "customer.subscription.deleted", livemode: false, data: { object: { id: sub1.id, object: "subscription", customer: cus.id, metadata: { tally_member: BLUE } } } });
r = await app("tok-ana", BLUE, { action: "member_status" });
ok(subRow(BLUE).status === "canceled" && r.body.state === "trial" && r.body.canceled === true, "cancelled: back to the free trial while it lasts");
// a checkout page left to expire
r = await app("tok-ana", BLUE, { action: "member_start" });
const cs2 = last("/v1/checkout/sessions");
ok(r.body.ok && ST.prices[cs2.p["line_items[0][price]"]].unit_amount === 19900 && count("/v1/prices") === 2 && count("/v1/customers") === 1, "starting again after cancelling: the new $199 price, the same Stripe customer");
const csId = subRow(BLUE).checkout_id;
ST.sessions[csId].status = "expired";
h = await hook({ id: "evt_9", type: "checkout.session.expired", livemode: false, data: { object: { id: csId, object: "checkout.session", mode: "subscription", customer: cus.id, metadata: { tally_member: BLUE } } } });
ok(subRow(BLUE).checkout_id === "" && subRow(BLUE).checkout_url === "", "an expired checkout page is let go");

/* ---------- the trial's end ---------- */
DB.orgs[1].trial_ends = new Date(Date.now() + 20 * 3600e3).toISOString();
r = await app("tok-ana", BLUE, { action: "member_start" });
const cs3 = last("/v1/checkout/sessions");
ok(r.body.ok && cs3 !== cs2 && !("subscription_data[trial_end]" in cs3.p), "less than two days of trial left: the membership starts now (Stripe needs two days for a trial)");
DB.orgs[1].trial_ends = new Date(Date.now() - day).toISOString();
DB.member_subs = DB.member_subs.filter((s) => s.org_id !== BLUE);
r = await app("tok-ana", BLUE, { action: "member_status" });
ok(r.body.state === "ended", "the trial is over with no membership: the owner is reminded (nobody is locked out)");

/* ---------- coming back from Stripe asks Stripe ---------- */
r = await app("tok-ana", BLUE, { action: "member_start" });
const cs4 = ST.sessions[subRow(BLUE).checkout_id];
const sub4 = completeSession(cs4);
r = await app("tok-ana", BLUE, { action: "member_status", refresh: true });
ok(r.body.state === "active" && subRow(BLUE).subscription_id === sub4.id, "back from Stripe's page before the webhook: Tally asks Stripe and shows it set up");

/* ---------- live keys: a test membership doesn't count ---------- */
Deno.env.set("STRIPE_SECRET_KEY", "sk_live_platform");
Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_live_platform");
r = await app("tok-ana", BLUE, { action: "member_status" });
ok(r.body.state === "ended" && r.body.billing === false, "with live keys, the test-mode membership isn't counted");
Deno.env.set("STRIPE_SECRET_KEY", "");
r = await app("tok-ana", BLUE, { action: "member_start" });
ok(!r.body.ok && /aren't set up yet/.test(r.body.message), "no Stripe keys: nothing to start, and it says so");

console.log("\n" + passes + " passed, " + failures + " failed");
Deno.exit(failures ? 1 : 0);
