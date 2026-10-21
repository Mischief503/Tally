// A crew lead's new quote, signed on site, saved by the Edge Function (action "requote"): the server works the price
// out again, the same way the app does, and saves it only when it's the one the customer signed.
// The written-down cases in rq-fixtures.json are checked against the app by tests/ui/requote.js and against the
// server here, so the two price every case alike.
// Run: deno run -A tests/function/requote.ts
// deno-lint-ignore-file no-explicit-any
(globalThis as any).__TALLY_TEST = true;
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
const fn = await import("../../supabase/functions/tally-twilio/index.ts");
const BASE = "https://proj.supabase.co/functions/v1/tally-twilio";

let failures = 0, passes = 0;
function ok(c: unknown, m: string) { if (c) { passes++; console.log("PASS", m); } else { failures++; console.log("FAIL", m); } }
const clone = (o: any) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));

/* ---------- the same prices as the app ---------- */
const fx = JSON.parse(Deno.readTextFileSync(new URL("./rq-fixtures.json", import.meta.url)));
const keys = Object.keys(fx.defaults);
ok(fn.canon(Object.fromEntries(keys.map((k) => [k, fn.PRICE_DEFAULTS[k]]))) === fn.canon(fx.defaults), "the server's default rate card is the app's");
const differ: string[] = [];
for (const f of fx.cases) {
  const items: Record<string, number> = {};
  f.dr.items.forEach((x: any) => { items[x.id] = x.q; });
  const b = fn.rqBuildS(clone(f.job), fn.priceSettings(clone(f.settings)), { items, flights: f.dr.flights, pack: f.dr.pack });
  const arr = Object.keys(b.d.items).filter((k) => b.d.items[k] > 0).sort().map((k) => ({ id: k, q: b.d.items[k] }));
  const got = { d: { items: arr, flights: b.d.flights, pack: b.d.pack, hoursOverride: b.d.hoursOverride }, q: b.q, items: b.items, key: fn.rqKeyS(arr, b.d.flights, b.d.pack, b.q.total) };
  if (fn.canon(got) !== fn.canon(f.expect)) differ.push(f.name + ": " + b.q.total + " vs " + f.expect.q.total);
}
ok(fx.cases.length >= 40 && !differ.length, fx.cases.length + " cases priced exactly as the app prices them" + (differ.length ? " (differ: " + differ.slice(0, 4).join("; ") + ")" : ""));
ok(fn.usd(1541) === "$1,541" && fn.usd(549.75) === "$549.75" && fn.usd(-12.5) === "-$12.50", "money written the app's way");

/* ---------- an in-memory database, auth and doc_patch ---------- */
const DB: Record<string, any[]> = { docs: [], members: [] };
function merge(t: any, p: any): any {
  const r = t && typeof t === "object" && !Array.isArray(t) ? clone(t) : {};
  Object.keys(p).forEach((k) => {
    const v = p[k];
    if (v && typeof v === "object" && !Array.isArray(v) && r[k] && typeof r[k] === "object" && !Array.isArray(r[k])) r[k] = merge(r[k], v);
    else if (v === null) delete r[k];
    else r[k] = clone(v);
  });
  return r;
}
const patches: any[] = [];
let failPatch = false;
const USERS: Record<string, string> = { "t-owner": "u-owner", "t-dispatch": "u-dispatch", "t-marcus": "u-marcus", "t-tanya": "u-tanya", "t-kim": "u-kim" };
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const u = new URL(String(input)), method = (init.method || "GET").toUpperCase();
  const reply = (status: number, body: any) => new Response(body == null ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (u.pathname === "/auth/v1/user") {
    const t = String((init.headers || {}).Authorization || "").replace("Bearer ", "");
    return USERS[t] ? reply(200, { id: USERS[t] }) : reply(401, { message: "bad jwt" });
  }
  if (u.pathname === "/rest/v1/rpc/doc_patch") {
    const b = JSON.parse(init.body);
    if (failPatch) return reply(500, { message: "down" });
    const row = DB.docs.find((r) => r.org_id === b.o && r.path === b.p);
    if (!row) return reply(200, false);
    row.data = merge(row.data, b.patch);
    patches.push(clone(b));
    return reply(200, true);
  }
  if (u.pathname.startsWith("/rest/v1/") && method === "GET") {
    const table = u.pathname.split("/").pop()!, rows = DB[table] || [];
    const f: [string, string][] = [];
    u.searchParams.forEach((v, k) => { if (k !== "select" && k !== "limit") f.push([k, v.replace(/^eq\./, "")]); });
    return reply(200, clone(rows.filter((r) => f.every(([k, v]) => String(r[k]) === v))));
  }
  throw new Error("unexpected fetch " + method + " " + input);
};

/* ---------- a company, a job and its rate card ---------- */
const ORG = "11111111-1111-1111-1111-111111111111", ORG2 = "22222222-2222-2222-2222-222222222222";
DB.members.push(
  { org_id: ORG, user_id: "u-owner", role: "owner", staff: "" }, { org_id: ORG, user_id: "u-dispatch", role: "dispatch", staff: "Dispatch" },
  { org_id: ORG, user_id: "u-marcus", role: "lead", staff: "Marcus" }, { org_id: ORG, user_id: "u-tanya", role: "lead", staff: "Tanya" },
  { org_id: ORG, user_id: "u-kim", role: "crew", staff: "Kim" },
);
// the first written-down case with no item taken out of Setup, as a real job on the shared store
const base = fx.cases.find((f: any) => f.job.d.items.every((x: any) => (f.settings.catalog || fx.defaults.catalog).some((c: any) => c.id === x.id)) && !f.expect.q.flat);
function putDoc(org: string, path: string, data: any) {
  const [collection, doc_id] = path.split("/");
  const i = DB.docs.findIndex((r) => r.org_id === org && r.path === path);
  const row = { org_id: org, path, collection, doc_id, data: clone(data) };
  if (i >= 0) DB.docs[i] = row; else DB.docs.push(row);
}
const doc = (path: string, org = ORG) => (DB.docs.find((r) => r.org_id === org && r.path === path) || {}).data;
function fresh(over: any = {}, settings: any = base.settings) {
  const job = Object.assign(clone(base.job), { id: "j1", status: "booked", assign: { truckId: base.job.assign.truckId, crew: ["Marcus", "Kim"] } }, over);
  putDoc(ORG, "jobs/j1", job);
  putDoc(ORG, "org/settings", settings);
  patches.length = 0;
  return job;
}
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let n = 0;
// the request a lead's phone sends: what the app made (the written-down expectation), signed
function rqOf(job: any, o: any = {}) {
  return Object.assign({
    id: "rq" + (++n), by: "Marcus", ts: Date.now() - 1000, was: job.quote.total,
    d: { items: clone(base.expect.d.items), flights: base.expect.d.flights, pack: base.expect.d.pack, hoursOverride: base.expect.d.hoursOverride },
    quote: clone(base.expect.q), items: clone(base.expect.items), note: "Garage was full", changes: ["+1 Sofa (3-seat)"],
    state: "done", sig: { name: "Priya Nair", img: PNG, ts: Date.now() - 500, by: "Marcus" }, ok: null, no: null, seen: null, applied: null, refused: null, cancel: null,
  }, o);
}
async function app(tok: string, body: any) {
  const r = await fn.handle(new Request(BASE + "/app", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ org: ORG }, body)) }));
  return { status: r.status, body: await r.json() };
}
const send = (tok: string, rq: any, jobId = "j1") => app(tok, { action: "requote", jobId, rq });

/* ---------- a crew lead's signed quote is saved ---------- */
{
  const job = fresh({ quote: Object.assign(clone(base.job.quote), { rqOk: { id: "old", total: 1, key: "x" } }), quoteHist: [{ id: "h0", ts: 1, now: 5 }], rq: { id: "older", state: "declined", no: { by: "Owner", ts: 1, why: "no" } } });
  const rq = rqOf(job);
  const r = await send("t-marcus", rq);
  const j = doc("jobs/j1");
  ok(r.status === 200 && r.body.ok === true && r.body.total === base.expect.q.total, "Marcus, the lead on the job: saved (" + JSON.stringify(r.body) + ")");
  ok(fn.canon(j.quote) === fn.canon(base.expect.q) && !("rqOk" in j.quote), "the job's quote is the new one, worked out here, and an old yes from the office is gone");
  ok(fn.canon(j.items) === fn.canon(base.expect.items) && fn.canon(j.d.items) === fn.canon(base.expect.d.items) && j.d.flights === base.expect.d.flights && j.d.pack === base.expect.d.pack && j.d.hoursOverride === base.expect.d.hoursOverride, "its items, stairs, packing and hours");
  const h = j.quoteHist[j.quoteHist.length - 1];
  ok(j.quoteHist.length === 2 && h.id === rq.id && fn.canon(h.was) === fn.canon(base.job.quote) && h.now === base.expect.q.total && h.by === "Marcus" && h.why === "Garage was full" && h.sign.name === "Priya Nair" && h.sign.img === PNG && fn.canon(h.wasItems) === fn.canon(base.job.items), "the quote it replaced goes in the history, with the customer's signature");
  ok(j.rq.id === rq.id && j.rq.state === "done" && j.rq.by === "Marcus" && j.rq.sig.name === "Priya Nair" && !j.rq.sig.img && !("no" in j.rq) && j.rq.applied > 0 && fn.canon(j.rq.quote) === fn.canon(base.expect.q), "the new quote's record: done, and nothing left over from the one before");
  const lg: any = Object.values(j.log || {})[0];
  ok(lg && /^New quote on site by Marcus: \$[\d,.]+ → \$[\d,.]+, signed by Priya Nair$/.test(lg.ev), "a line in the job's activity: " + (lg && lg.ev));
  ok(patches.length === 1 && patches[0].p === "jobs/j1" && Object.keys(patches[0].patch).sort().join(",") === "d,items,log,quote,quoteHist,rq", "one change, merged on the database in one step");
  const again = await send("t-marcus", rq);
  ok(again.status === 200 && again.body.ok === true && again.body.already === true && patches.length === 1 && doc("jobs/j1").quoteHist.length === 2, "sent again (a dropped connection): nothing saved twice");
}
/* ---------- who may ---------- */
{
  let job = fresh();
  let r = await send("t-kim", rqOf(job));
  ok(r.status === 403 && r.body.final === true && !patches.length, "a crew member: no (" + r.body.message + ")");
  r = await send("t-tanya", rqOf(job));
  ok(r.status === 403 && !patches.length, "a lead who isn't on the job: no");
  r = await send("t-nobody", rqOf(job));
  ok(r.status === 401, "signed out: no");
  r = await app("t-marcus", { action: "requote", jobId: "j1", rq: rqOf(job), org: ORG2 });
  ok(r.status === 401 && !patches.length, "another company's job: no");
  r = await send("t-dispatch", rqOf(job));
  ok(r.status === 200 && r.body.ok && doc("jobs/j1").rq.by === "Dispatch", "dispatch may (the office can change quotes anyway)");
  job = fresh({}, Object.assign(clone(base.settings), { opt: Object.assign({}, base.settings.opt, { rqCrew: false }) }));
  r = await send("t-marcus", rqOf(job));
  ok(r.status === 403 && /switched off/.test(r.body.message) && !patches.length, "Options › Crew leads make new quotes on site, off: no");
}
/* ---------- only the quote the customer signed, on a job that can take it ---------- */
{
  let job = fresh();
  let r = await send("t-marcus", rqOf(job, { quote: Object.assign(clone(base.expect.q), { total: base.expect.q.total - 100 }) }));
  ok(r.status === 409 && r.body.final && /didn't come out the same/.test(r.body.message) && !patches.length, "a lower price than the items come to: refused");
  r = await send("t-marcus", rqOf(job, { was: job.quote.total + 50 }));
  ok(r.status === 409 && /changed while/.test(r.body.message) && !patches.length, "the office changed the quote meanwhile: make it again");
  r = await send("t-marcus", rqOf(job, { d: Object.assign(clone(base.expect.d), { items: base.expect.d.items.map((x: any) => ({ id: x.id, q: String(x.q) })) }) }));
  ok(r.status === 400 && !patches.length, "a count that isn't a whole number: refused");
  r = await send("t-marcus", rqOf(job, { d: Object.assign(clone(base.expect.d), { items: base.expect.d.items.map((x: any) => ({ id: x.id, q: x.q * 1000 })) }) }));
  ok(r.status === 400 && !patches.length, "a count of thousands: refused");
  r = await send("t-marcus", rqOf(job, { d: Object.assign(clone(base.expect.d), { flights: "2.5" }) }));
  ok(r.status === 400 && !patches.length, "half a flight of stairs: refused");
  r = await send("t-marcus", rqOf(job, { d: Object.assign(clone(base.expect.d), { items: base.expect.d.items.concat([{ id: "spaceship", q: 3 }]) }) }));
  ok(r.status === 200 && r.body.ok && !doc("jobs/j1").d.items.some((x: any) => x.id === "spaceship"), "an item that isn't in Setup is left out, as the app leaves it out");
  job = fresh();
  r = await send("t-marcus", rqOf(job, { sig: { name: "Priya Nair", img: "data:," } }));
  ok(r.status === 400 && /signature/.test(r.body.message) && !patches.length, "no signature: refused");
  r = await send("t-marcus", rqOf(job, { sig: { name: "  ", img: PNG } }));
  ok(r.status === 400 && !patches.length, "no printed name: refused");
  r = await send("t-marcus", rqOf(job, { id: "../../x" }));
  ok(r.status === 400 && !patches.length, "a made-up id: refused");
  job = fresh({ status: "done" });
  r = await send("t-marcus", rqOf(job));
  ok(r.status === 409 && !patches.length, "a finished job: no");
  job = fresh({ status: "active", clockAt: Date.now() });
  r = await send("t-marcus", rqOf(job));
  ok(r.status === 409 && /billed out/.test(r.body.message) && !patches.length, "a job that's billed out: no");
  job = fresh({ status: "active", startedAt: Date.now() - 36e5 });
  r = await send("t-marcus", rqOf(job));
  ok(r.status === 200 && r.body.ok, "a job that's started: yes");
  job = fresh({ quote: Object.assign(clone(base.job.quote), { kind: undefined }) });
  r = await send("t-marcus", rqOf(job));
  ok(r.status === 409 && /office can change it/.test(r.body.message) && !patches.length, "a quote from before move types: the office changes it");
  failPatch = true;
  job = fresh();
  r = await send("t-marcus", rqOf(job));
  ok(r.status === 500 && r.body.ok === false && !r.body.final, "the database doesn't answer: not final, so the phone tries again");
  failPatch = false;
}
/* ---------- the rate card changed after booking ---------- */
{
  const raised = clone(base.settings);
  Object.keys(raised.rates).forEach((k) => { raised.rates[k] += 40; });
  raised.truckFee = (raised.truckFee || 0) + 30;
  const job = fresh({}, raised);
  const r = await send("t-marcus", rqOf(job));
  ok(r.status === 200 && r.body.ok && doc("jobs/j1").quote.rate === base.job.quote.rate && doc("jobs/j1").quote.total === base.expect.q.total, "rates raised since booking: the new quote still uses the job's ($" + base.job.quote.rate + "/hr)");
}
/* ---------- Options › Office approves new quotes ---------- */
{
  const S = Object.assign(clone(base.settings), { opt: Object.assign({}, base.settings.opt, { rqOffice: true }) });
  let job = fresh({}, S);
  let r = await send("t-marcus", rqOf(job));
  ok(r.status === 403 && /approval/.test(r.body.message) && !patches.length, "without the office's yes: no");
  const rq = rqOf(job, { ok: { by: "Owner", ts: 5 } });   // a yes the lead's phone wrote itself doesn't count
  r = await send("t-marcus", rq);
  ok(r.status === 403 && !patches.length, "a yes in the lead's own copy doesn't count");
  const key = fn.rqKeyS(base.expect.d.items, base.expect.d.flights, base.expect.d.pack, base.expect.q.total);
  job = fresh({ quote: Object.assign(clone(base.job.quote), { rqOk: { id: "someone-else", total: base.expect.q.total, key, by: "Owner", ts: 5 } }) }, S);
  r = await send("t-marcus", rqOf(job));
  ok(r.status === 403 && !patches.length, "a yes for another new quote: no");
  const rq2 = rqOf(job);
  job = fresh({ quote: Object.assign(clone(base.job.quote), { rqOk: { id: rq2.id, total: base.expect.q.total, key: "different", by: "Owner", ts: 5 } }) }, S);
  r = await send("t-marcus", rq2);
  ok(r.status === 409 && /isn't the new quote the office approved/.test(r.body.message) && !patches.length, "items changed after the yes: no");
  job = fresh({ quote: Object.assign(clone(base.job.quote), { rqOk: { id: rq2.id, total: base.expect.q.total, key, by: "Owner", ts: 5 } }), rq: Object.assign(clone(rq2), { state: "approved", ok: { by: "Owner", ts: 5, note: "Go ahead" }, sig: null }) }, S);
  r = await send("t-marcus", rq2);
  const j = doc("jobs/j1");
  ok(r.status === 200 && r.body.ok && !("rqOk" in j.quote) && j.rq.state === "done" && j.rq.ok.by === "Owner" && j.rq.ok.note === "Go ahead" && j.quoteHist[j.quoteHist.length - 1].ok.by === "Owner", "with the office's yes for these items: saved, and the yes is used up");
  job = fresh({}, S);
  r = await send("t-dispatch", rqOf(job));
  ok(r.status === 200 && r.body.ok, "the office itself doesn't need a yes");
}

console.log(`\nrequote server: ${passes} passed, ${failures} failed`);
Deno.exit(failures ? 1 : 0);
