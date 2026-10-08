// Harness for the Tally Twilio Edge Function: an in-memory PostgREST, a fake Twilio and a fake auth server.
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
const DB: Record<string, any[]> = { docs: [], members: [], comm_lines: [], comm_log: [], comm_job_state: [] };
let nextId = 1;
const clone = (o: any) => JSON.parse(JSON.stringify(o));
function deepFreeze(o: any) { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }
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
    if (op === "ilike" || op === "like") { const re = new RegExp("^" + val.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", op === "ilike" ? "i" : ""); return v != null && re.test(String(v)); }
    throw new Error("op " + op);
  });
}
function restMock(method: string, u: URL, body: any, prefer: string) {
  const table = u.pathname.split("/").pop()!;
  const rows = DB[table];
  if (!rows) return { status: 404, body: { message: "no table " + table } };
  const filters: [string, string][] = []; let limit = 1e9, order = "", onConflict = "";
  u.searchParams.forEach((v, k) => {
    if (k === "select") return; if (k === "limit") { limit = +v; return; } if (k === "order") { order = v; return; } if (k === "on_conflict") { onConflict = v; return; }
    filters.push([k, v]);
  });
  const rep = prefer.indexOf("return=representation") >= 0;
  if (method === "GET") {
    let out = rows.filter((r) => matches(r, filters));
    if (order) { const [f, d] = order.split("."); out = out.slice().sort((a, b) => (a[f] < b[f] ? -1 : 1) * (d === "desc" ? -1 : 1)); }
    return { status: 200, body: clone(out.slice(0, limit)) };
  }
  if (method === "POST") {
    const list = Array.isArray(body) ? body : [body], added: any[] = [];
    for (const r0 of list) {
      const r = clone(r0);
      if (onConflict) {
        const keys = onConflict.split(",");
        if (rows.some((x) => keys.every((k) => String(x[k]) === String(r[k])))) { if (prefer.indexOf("ignore-duplicates") >= 0) continue; return { status: 409, body: { message: "dup" } }; }
      }
      if (table === "comm_log") { r.id = nextId++; r.created_at = r.created_at || new Date().toISOString(); }
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
    const goneRows = rows.filter((r) => matches(r, filters)), keep = rows.filter((r) => !matches(r, filters)), gone = goneRows.length;
    rows.length = 0; keep.forEach((r) => rows.push(r));
    return { status: 200, body: rep ? clone(goneRows) : null, gone };
  }
  return { status: 405, body: null };
}

/* ---------- fake Twilio and auth ---------- */
const sent: any[] = [];
const routesCalls: any[] = [];
let twilioFail = "";
let onSend: ((p: any) => Promise<void>) | null = null;   // runs once, as a text is being sent
const USERS: Record<string, string> = { "tok-owner": "u-owner", "tok-dispatch": "u-dispatch", "tok-marcus": "u-marcus", "tok-kim": "u-kim", "tok-stranger": "u-stranger" };
(globalThis as any).fetch = async (input: string, init: any = {}) => {
  const u = new URL(input), method = (init.method || "GET").toUpperCase();
  const reply = (status: number, b: any) => new Response(b == null ? "" : JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (u.host === "api.twilio.com") {
    const p = Object.fromEntries(new URLSearchParams(init.body));
    const kind = u.pathname.endsWith("Messages.json") ? "sms" : "call";
    if (twilioFail) return reply(400, { message: twilioFail });
    if (onSend) {
      const f = onSend; onSend = null;
      // a hold that the function's own timeout can cut short, like a real hung connection
      await Promise.race([f(p), new Promise((_, rej) => init.signal && init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))]);
    }
    const sid = (kind === "sms" ? "SM" : "CA") + (sent.length + 1);
    sent.push({ kind, sid, ...p });
    return reply(201, { sid, status: "queued" });
  }
  if (u.host === "routes.googleapis.com") {
    const h = init.headers, bd = JSON.parse(init.body);
    routesCalls.push({ h, bd });
    if (h["X-Goog-Api-Key"] !== "gkey") return reply(403, { error: { message: "API key not valid" } });
    if (/nowhere/i.test(bd.destination.address)) return reply(200, {});
    if (/zzz/i.test(bd.destination.address)) return reply(400, { error: { message: "Address not found: origin or destination could not be geocoded" } });
    return reply(200, { routes: [{ distanceMeters: 36049, duration: "1862s" }] });
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
const ORG = "org-1", ORG2 = "org-2";
const tomorrow = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
const later = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
const settings = {
  company: "Ace Moving — Austin",
  contacts: { Owner: "512-555-0100", Dispatch: "(512) 555-0199", Marcus: "512-555-0101", Dee: "512.555.0102", Luis: "", Kim: "512-555-0106" },
  office: [{ name: "Owner", kind: "owner" }, { name: "Dispatch", kind: "dispatch" }],
  leads: ["Marcus"], trucks: [{ id: "t26", name: "Box 1 (26 ft)" }],
  forms: [{ id: "f1", title: "Delivery receipt", required: true }, { id: "f2", title: "Optional", required: false }],
  comms: { alerts: { assigned: true, moved: true, forms: true } },
};
function job(id: string, over: any = {}) {
  return { id, status: "booked", d: { name: "Priya “P” Nair", phone: "512-555-0142", moveDate: tomorrow, time: "08:00", from: "418 Oak St, Austin", to: "77 Ridge Rd" }, assign: { truckId: "t26", crew: ["Marcus", "Dee"] }, signed: {}, ...over };
}
function putDoc(org: string, path: string, data: any) {
  const [collection, doc_id] = path.split("/");
  const i = DB.docs.findIndex((r) => r.org_id === org && r.path === path);
  const row = deepFreeze({ org_id: org, path, collection, doc_id, data: clone(data), updated_at: new Date().toISOString() });
  if (i >= 0) DB.docs[i] = row; else DB.docs.push(row);
}
putDoc(ORG, "org/settings", settings);
putDoc(ORG, "jobs/j1", job("j1"));
putDoc(ORG2, "org/settings", { company: "Stranger Co", contacts: {}, office: [] });
putDoc(ORG2, "jobs/s1", job("s1"));
DB.members.push(
  { org_id: ORG, user_id: "u-owner", role: "owner", staff: "Owner" },
  { org_id: ORG, user_id: "u-dispatch", role: "dispatch", staff: "Dispatch" },
  { org_id: ORG, user_id: "u-marcus", role: "lead", staff: "Marcus" },
  { org_id: ORG, user_id: "u-kim", role: "crew", staff: "Kim" },
  { org_id: ORG2, user_id: "u-stranger", role: "owner", staff: "Zed" },
);

async function app(tok: string, body: any, origin?: string) {
  const h: Record<string, string> = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  if (origin) h.Origin = origin;
  const r = await fn.handle(new Request(BASE + "/app", { method: "POST", headers: h, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function hook(sub: string, params: Record<string, string>, opts: { badSig?: boolean } = {}) {
  const url = BASE + "/twilio/" + sub;
  const u = new URL(url);
  const sig = await fn.twilioSignature(u.origin + u.pathname + u.search, params, opts.badSig ? "wrong" : "tok123");
  const r = await fn.handle(new Request(url, { method: "POST", headers: { "X-Twilio-Signature": sig, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() }));
  return { status: r.status, text: await r.text() };
}
const smsTo = (n: string) => sent.filter((s) => s.kind === "sms" && s.To === n);

/* ---------- helpers ---------- */
ok(fn.e164("512-555-0101") === "+15125550101", "10-digit US number becomes +1");
ok(fn.e164("1 (512) 555-0101") === "+15125550101", "leading 1 handled");
ok(fn.e164("+44 20 7946 0958") === "+442079460958", "international kept");
ok(fn.e164("555-0101") === "", "short number rejected");
ok(fn.gsm("Ace — “hi” it’s → there… · café") === 'Ace - "hi" it\'s to there... - caf', "text is kept to plain characters");
ok(fn.fmtDay("2026-10-03") === "Sat Oct 3", "date formats without timezone drift");
ok(fn.fmtTime("13:05") === "1:05 PM" && fn.fmtTime("00:30") === "12:30 AM", "times format");
// Twilio's own published example
{ // cross-check against Twilio's own library
  const twilioLib = (await import("npm:twilio@5")).default;
  const P = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  const url = "https://proj.supabase.co/functions/v1/tally-twilio/twilio/connect?log=42";
  const mine = await fn.twilioSignature(url, P, "12345");
  ok(twilioLib.validateRequest("12345", mine, url, P) === true, "signature agrees with Twilio's own library");
  ok(twilioLib.validateRequest("12345", await fn.twilioSignature(url, P, "nope"), url, P) === false, "and a wrong token does not");
}

/* ---------- before a line is set up ---------- */
let r = await app("tok-dispatch", { action: "job", org: ORG, jobId: "j1" });
ok(r.body.reason === "no-line" && sent.length === 0, "no company line: nothing is sent");
DB.comm_lines.push({ org_id: ORG, phone_number: "+15125550000", enabled: true });

/* ---------- who may ask ---------- */
r = await app("nope", { action: "job", org: ORG, jobId: "j1" });
ok(r.status === 401, "bad sign-in rejected");
r = await app("tok-stranger", { action: "job", org: ORG, jobId: "j1" });
ok(r.status === 401, "someone from another company cannot touch this company");
r = await app("tok-kim", { action: "job", org: ORG, jobId: "j1" });
ok(r.status === 403, "crew cannot trigger schedule texts");
r = await app("tok-stranger", { action: "call", org: ORG2, jobId: "s1" });
ok(r.body.ok === false && /not set up/.test(r.body.message) && sent.length === 0, "a company without a line you assigned cannot use your Twilio account");
r = await app("tok-dispatch", { action: "job", org: ORG, jobId: "../x" });
ok(r.status === 400, "odd job id rejected");

/* ---------- assigned ---------- */
r = await app("tok-dispatch", { action: "job", org: ORG, jobId: "j1" });
ok(r.body.ok && r.body.sent === 2, "first check texts both assigned crew");
const m1 = smsTo("+15125550101")[0], d1 = smsTo("+15125550102")[0];
ok(m1 && m1.From === "+15125550000", "texts come from the company number");
ok(m1 && /^Ace Moving - Austin: You're on Priya "P" Nair, \w{3} \w{3} \d+ at 8:00 AM\. Pickup 418 Oak St, Austin\. Truck Box 1 \(26 ft\)\./.test(m1.Body), "assignment text reads right: " + (m1 && m1.Body));
ok(m1 && !/Lead Marcus/.test(m1.Body) && d1 && /Lead Marcus\./.test(d1.Body), "lead named for the crew, not to the lead himself");
ok(m1 && /Reply STOP to opt out\.$/.test(m1.Body), "first text to a number carries opt-out wording");
ok(m1 && /^[\x20-\x7E]*$/.test(m1.Body), "plain characters only, so a text costs one rate");
ok(m1 && m1.StatusCallback === BASE + "/twilio/status?log=" + DB.comm_log.find((x) => x.sid === m1.sid)?.id, "delivery reports are wired to the log row");
ok(DB.comm_log.filter((x) => x.job_id === "j1" && x.purpose === "assigned").length === 2, "both texts logged against the job");

r = await app("tok-dispatch", { action: "job", org: ORG, jobId: "j1" });
ok(r.body.sent === 0 && sent.length === 2, "checking again with no change sends nothing");

/* ---------- add one, remove one ---------- */
putDoc(ORG, "jobs/j1", job("j1", { assign: { truckId: "t26", crew: ["Marcus", "Kim"] } }));
r = await app("tok-owner", { action: "job", org: ORG, jobId: "j1" });
ok(r.body.sent === 2, "one added and one removed: two texts");
ok(/You're on/.test(smsTo("+15125550106")[0]?.Body || ""), "Kim told she's on");
ok(/You're off .* No need to show up/.test(smsTo("+15125550102")[1]?.Body || ""), "Dee told she's off");
ok(!/Reply STOP/.test(smsTo("+15125550102")[1]?.Body || "x"), "opt-out wording only on the first text");
ok(smsTo("+15125550101").length === 1, "Marcus, still on it, not texted again");

/* ---------- moved ---------- */
putDoc(ORG, "jobs/j1", job("j1", { assign: { truckId: "t26", crew: ["Marcus", "Kim"] }, d: { ...job("j1").d, moveDate: later, time: "09:30" } }));
r = await app("tok-dispatch", { action: "job", org: ORG, jobId: "j1" });
const mv = smsTo("+15125550101")[1];
ok(r.body.sent === 2 && mv && / moved to \w{3} \w{3} \d+ at 9:30 AM \(was \w{3} \w{3} \d+ at 8:00 AM\)\./.test(mv.Body), "move texts the crew with old and new time: " + (mv && mv.Body));

/* ---------- crew with no number ---------- */
putDoc(ORG, "jobs/j1", job("j1", { assign: { truckId: "t26", crew: ["Marcus", "Kim", "Luis"] }, d: { ...job("j1").d, moveDate: later, time: "09:30" } }));
const before = sent.length;
r = await app("tok-dispatch", { action: "job", org: ORG, jobId: "j1" });
ok(r.body.sent === 0 && sent.length === before, "no phone number: nothing sent");
ok(DB.comm_log.some((x) => x.staff === "Luis" && x.status === "no-number" && /No phone number saved for Luis/.test(x.error)), "and the log says why");

/* ---------- toggles, past jobs, other statuses ---------- */
putDoc(ORG, "org/settings", { ...settings, comms: { alerts: { assigned: false, moved: true, forms: true } } });
putDoc(ORG, "jobs/j1", job("j1", { assign: { truckId: "t26", crew: ["Marcus", "Kim", "Luis", "Dee"] }, d: { ...job("j1").d, moveDate: later, time: "09:30" } }));
let n0 = sent.length; r = await app("tok-dispatch", { action: "job", org: ORG, jobId: "j1" });
ok(sent.length === n0, "assignment texts off in Setup: none sent");
putDoc(ORG, "org/settings", settings);
putDoc(ORG, "jobs/j2", job("j2", { d: { ...job("j2").d, moveDate: "2020-01-01" } }));
n0 = sent.length; r = await app("tok-dispatch", { action: "job", org: ORG, jobId: "j2" });
ok(sent.length === n0 && r.body.skipped === "not-upcoming", "past jobs never text");
putDoc(ORG, "jobs/j3", job("j3", { status: "quoted" }));
n0 = sent.length; await app("tok-dispatch", { action: "job", org: ORG, jobId: "j3" });
ok(sent.length === n0, "quotes never text");

/* ---------- two devices at once ---------- */
putDoc(ORG, "jobs/j4", job("j4"));
n0 = sent.length;
await Promise.all([app("tok-dispatch", { action: "job", org: ORG, jobId: "j4" }), app("tok-owner", { action: "job", org: ORG, jobId: "j4" }), app("tok-dispatch", { action: "job", org: ORG, jobId: "j4" })]);
ok(sent.length - n0 === 2, "three checks at the same moment still send each text once (" + (sent.length - n0) + ")");

/* ---------- forms waiting ---------- */
putDoc(ORG, "jobs/j5", job("j5", { status: "done", signed: { s1: { formId: "f2" } } }));
n0 = sent.length; r = await app("tok-marcus", { action: "forms", org: ORG, jobId: "j5" });
const fm = sent.slice(n0);
ok(r.body.sent === 2 && fm.every((s) => s.To === "+15125550100" || s.To === "+15125550199"), "forms waiting: owner and dispatch get a text");
ok(/is finished but 1 form still needs the customer's signature \(Delivery receipt\)\. Marcus ran it\./.test(fm[0]?.Body || ""), "forms text names the form and the lead: " + (fm[0] && fm[0].Body));
n0 = sent.length; await app("tok-marcus", { action: "forms", org: ORG, jobId: "j5" });
ok(sent.length === n0, "not repeated within 6 hours");
putDoc(ORG, "jobs/j6", job("j6", { status: "done", signed: { s1: { formId: "f1" } } }));
n0 = sent.length; r = await app("tok-marcus", { action: "forms", org: ORG, jobId: "j6" });
ok(sent.length === n0 && r.body.skipped === "signed", "signed jobs never text");

/* ---------- masked call ---------- */
n0 = sent.length;
r = await app("tok-kim", { action: "call", org: ORG, jobId: "j3" });
ok(r.body.ok === false && /your own jobs/.test(r.body.message), "crew can only call customers on their jobs");
r = await app("tok-marcus", { action: "call", org: ORG, jobId: "j1" });
const call = sent[sent.length - 1];
ok(r.body.ok && call.kind === "call" && call.To === "+15125550101" && call.From === "+15125550000", "masked call rings the mover from the company number");
const row = DB.comm_log.find((x) => x.sid === call.sid)!;
ok(row && row.to_number === "+15125550142" && row.purpose === "masked" && row.status === "calling-you", "call logged against the job with the customer's number");
ok(call.Url === BASE + "/twilio/bridge?log=" + row.id, "Twilio is told where to ask for press 1");

let h = await hook("bridge?log=" + row.id, { CallSid: call.sid, To: "+15125550101" }, { badSig: true });
ok(h.status === 403, "a forged Twilio request is refused");
h = await hook("bridge?log=" + row.id, { CallSid: call.sid, To: "+15125550101" });
ok(h.status === 200 && /<Gather numDigits="1"[^>]*connect\?log=\d+/.test(h.text) && /Press 1 to call Priya .P. Nair from the company line/.test(h.text), "mover hears press 1 (voicemail can't trigger the call)");
h = await hook("connect?log=" + row.id, { Digits: "2" });
ok(/<Hangup\/>/.test(h.text) && !/<Dial/.test(h.text), "any other key hangs up");
h = await hook("connect?log=" + row.id, { Digits: "1" });
ok(/<Dial callerId="\+15125550000"[^>]*><Number>\+15125550142<\/Number><\/Dial>/.test(h.text), "pressing 1 dials the customer showing the company number");
ok(!/5125550101/.test(h.text), "the mover's own number is nowhere in what the customer's leg sees");
await hook("dialed?log=" + row.id, { DialCallStatus: "completed", DialCallDuration: "184" });
await hook("status?log=" + row.id + "&leg=you", { CallStatus: "completed", CallDuration: "200" });
const done = DB.comm_log.find((x) => x.id === row.id)!;
ok(done.status === "answered" && done.duration_sec === 184, "call log records the talk time");

r = await app("tok-kim", { action: "call", org: ORG, jobId: "j1" });
const kc = sent[sent.length - 1], krow = DB.comm_log.find((x) => x.sid === kc.sid)!;
await hook("status?log=" + krow.id + "&leg=you", { CallStatus: "no-answer" });
ok(DB.comm_log.find((x) => x.id === krow.id)!.status === "you-missed", "mover didn't pick up: logged as such");

putDoc(ORG, "org/settings", { ...settings, contacts: { ...settings.contacts, Kim: "" } });
r = await app("tok-kim", { action: "call", org: ORG, jobId: "j1" });
ok(r.body.ok === false && /Add your phone number in Setup/.test(r.body.message), "no phone on file: clear message");
putDoc(ORG, "org/settings", settings);

for (let i = 0; i < 25; i++) DB.comm_log.push({ id: nextId++, org_id: ORG, channel: "call", purpose: "masked", staff: "Dispatch", created_at: new Date().toISOString() });
r = await app("tok-dispatch", { action: "call", org: ORG, jobId: "j1" });
ok(r.body.ok === false && /a lot of calls/.test(r.body.message), "runaway calling is capped per hour");

twilioFail = "Unverified number";
r = await app("tok-owner", { action: "call", org: ORG, jobId: "j1" });
ok(r.body.ok === false && /Unverified number/.test(r.body.message) && DB.comm_log.some((x) => x.status === "failed" && x.error === "Unverified number"), "Twilio refusal reaches the user and the log");
twilioFail = "";

/* ---------- customer calls back ---------- */
h = await hook("voice", { CallSid: "CAin1", From: "+15125550142", To: "+15125550000" });
const inRow = DB.comm_log.find((x) => x.sid === "CAin1")!;
ok(inRow && inRow.job_id && inRow.party === 'Priya “P” Nair' && inRow.direction === "in", "callback matched to the customer's job");
ok(/<Dial callerId="\+15125550000" timeout="22" action="[^"]*after\?log=\d+">(<Number url="[^"]*whisper[^"]*">\+1512555(0100|0199)<\/Number>){2}<\/Dial>/.test(h.text), "callback rings the office phones, not the mover");
h = await hook("whisper?log=" + inRow.id, { To: "+15125550100" });
ok(/Tally call from Priya/.test(h.text), "office hears who is calling before picking up");
n0 = sent.length;
h = await hook("after?log=" + inRow.id, { DialCallStatus: "no-answer", To: "+15125550000", From: "+15125550142" });
ok(/will call you right back/.test(h.text) && DB.comm_log.find((x) => x.id === inRow.id)!.status === "missed", "nobody answered: caller told, call logged missed");
ok(sent.length - n0 === 2 && /Missed call on the company line from Priya/.test(sent[sent.length - 1].Body), "and the office gets a missed-call text");

putDoc(ORG, "org/settings", { ...settings, comms: { ...settings.comms, ring: ["Marcus"] } });
h = await hook("voice", { CallSid: "CAin2", From: "+19995550000", To: "+15125550000" });
ok(/<Number[^>]*>\+15125550101<\/Number>/.test(h.text) && (h.text.match(/<Number/g) || []).length === 1, "who answers the company line is set in Setup");
ok(DB.comm_log.find((x) => x.sid === "CAin2")!.party === "an unknown caller", "unknown caller logged without a job");
putDoc(ORG, "org/settings", settings);

h = await hook("voice", { CallSid: "CAx", From: "+15125550142", To: "+15550000000" });
ok(/not in service/.test(h.text), "a number that isn't a company line goes nowhere");

/* ---------- texts in ---------- */
n0 = sent.length;
await hook("sms", { MessageSid: "SMin1", From: "+15125550142", To: "+15125550000", Body: "Running 10 min late, sorry!" });
ok(DB.comm_log.some((x) => x.sid === "SMin1" && x.purpose === "customer-text" && x.job_id), "customer text logged against the job");
ok(sent.length - n0 === 2 && /Text to the company line from Priya .*Running 10 min late/.test(sent[sent.length - 1].Body), "and forwarded to the office");
n0 = sent.length;
const chatBefore = DB.docs.filter((d) => d.collection === "chat").length;
await hook("sms", { MessageSid: "SMin2", From: "+15125550101", To: "+15125550000", Body: "Got it, I'll be there" });
const chat = DB.docs.filter((d) => d.collection === "chat");
ok(sent.length === n0 && chat.length === chatBefore + 1 && chat[chat.length - 1].data.t === "dm:Dispatch|Marcus" && chat[chat.length - 1].data.from === "Marcus", "a mover's reply lands in the app chat with dispatch, free");
n0 = sent.length;
await hook("sms", { MessageSid: "SMin3", From: "+15125550142", To: "+15125550000", Body: "STOP" });
ok(sent.length === n0, "STOP is left to Twilio and not forwarded");

/* ---------- delivery reports ---------- */
const anyText = DB.comm_log.find((x) => x.sid === "SM1")!;
await hook("status?log=" + anyText.id, { MessageStatus: "delivered", MessageSid: "SM1" });
ok(DB.comm_log.find((x) => x.id === anyText.id)!.status === "delivered", "delivery report updates the log");
await hook("status?log=" + anyText.id, { MessageStatus: "undelivered", ErrorCode: "30034" });
ok(/30034/.test(DB.comm_log.find((x) => x.id === anyText.id)!.error), "carrier error code kept (30034 = number not registered for texting)");

/* ---------- arrival text to the customer ---------- */
putDoc(ORG, "org/settings", settings);
putDoc(ORG, "jobs/j7", job("j7", { status: "active", assign: { truckId: "t26", crew: ["Marcus"] } }));
n0 = sent.length;
r = await app("tok-marcus", { action: "eta", org: ORG, jobId: "j7", minutes: 25 });
const eta = sent[sent.length - 1];
ok(r.body.ok && sent.length - n0 === 1 && eta.To === "+15125550142" && eta.From === "+15125550000", "arrival text goes to the customer from the company line");
ok(/^Ace Moving - Austin: Hi Priya, your crew is on the way and should arrive in about 25 minutes, around \d{1,2}:\d\d [AP]M\./.test(eta.Body), "arrival text reads right: " + eta.Body);
ok(/^[\x20-\x7E]*$/.test(eta.Body), "arrival text is plain characters");
const etaRow = DB.comm_log.find((x) => x.sid === eta.sid)!;
ok(etaRow.purpose === "eta" && etaRow.job_id === "j7" && etaRow.staff === "Marcus" && /Priya/.test(etaRow.party), "logged on the job, by Marcus, to the customer");
n0 = sent.length;
r = await app("tok-marcus", { action: "eta", org: ORG, jobId: "j7", minutes: 25 });
ok(!r.body.ok && /a moment ago/.test(r.body.message) && sent.length === n0, "a double tap does not text twice");
r = await app("tok-kim", { action: "eta", org: ORG, jobId: "j7", minutes: 25 });
ok(!r.body.ok && /your own jobs/.test(r.body.message), "crew not on the job cannot text the customer");
putDoc(ORG, "jobs/j8", job("j8", { status: "active", d: { ...job("j8").d, name: "Hollis & Reed Law" } }));
r = await app("tok-dispatch", { action: "eta", org: ORG, jobId: "j8", minutes: 999 });
ok(/Hello, your crew is on the way and should arrive in about 240 minutes/.test(sent[sent.length - 1].Body), "business names get Hello, and minutes are capped");
putDoc(ORG, "jobs/j9", job("j9", { status: "active", d: { ...job("j9").d, phone: "" } }));
r = await app("tok-dispatch", { action: "eta", org: ORG, jobId: "j9", minutes: 20 });
ok(!r.body.ok && /no customer phone/.test(r.body.message), "no customer phone: clear message");

/* ---------- forms alert for an unloaded job that cannot close ---------- */
putDoc(ORG, "jobs/j10", job("j10", { status: "active", phases: { loadStart: 1, loadEnd: 2, unloadStart: 3 } }));
n0 = sent.length; r = await app("tok-marcus", { action: "forms", org: ORG, jobId: "j10" });
ok(sent.length === n0 && r.body.skipped === "not-finished", "still unloading: no forms text");
putDoc(ORG, "jobs/j10", job("j10", { status: "active", phases: { loadStart: 1, loadEnd: 2, unloadStart: 3, unloadEnd: 4 } }));
n0 = sent.length; r = await app("tok-marcus", { action: "forms", org: ORG, jobId: "j10" });
ok(r.body.sent === 2 && /is unloaded but can't close: 1 form still needs the customer's signature/.test(sent[sent.length - 1].Body), "unloaded with a form unsigned: office texted");

/* ---------- confirmations: link in texts, reminders, evening before ---------- */
ok(fn.appLink({ comms: { appUrl: "https://ace.netlify.app/" } }) === "https://ace.netlify.app/#messages", "link opens Job messages");
ok(fn.appLink({}, "https://appassets.androidplatform.net") === "", "texts never link to the Android app's internal address");
ok(fn.appLink({}, "https://ace.netlify.app") === "https://ace.netlify.app#messages" && fn.appLink({}, "http://x.com") === "" && fn.appLink({ comms: { appUrl: "javascript:alert(1)" } }) === "", "only https links are used");
putDoc(ORG, "org/settings", settings);
putDoc(ORG, "jobs/c1", job("c1", { assign: { truckId: "t26", crew: ["Marcus"] } }));
n0 = sent.length;
await app("tok-dispatch", { action: "job", org: ORG, jobId: "c1" }, "https://ace.netlify.app");
ok(sent.length - n0 === 1 && /Confirm in Tally: https:\/\/ace\.netlify\.app#messages/.test(sent[sent.length - 1].Body), "assignment text links to Job messages: " + sent[sent.length - 1].Body);
putDoc(ORG, "jobs/c1", job("c1", { assign: { truckId: "t26", crew: ["Marcus"] }, d: { ...job("c1").d, time: "10:00" } }));
await app("tok-dispatch", { action: "job", org: ORG, jobId: "c1" }, "https://ace.netlify.app");
ok(/moved to .* Confirm the new time: https:\/\/ace\.netlify\.app#messages$/.test(sent[sent.length - 1].Body), "a moved job asks to confirm the new time");
const slot = (j: any) => j.d.moveDate + " " + j.d.time;
const c2 = job("c2", { assign: { truckId: "t26", crew: ["Marcus", "Dee", "Kim"] } });
c2.confirm = { Marcus: { ts: 1, for: slot(c2) }, Dee: { ts: 1, for: "2020-01-01 08:00" } };
putDoc(ORG, "jobs/c2", c2);
r = await app("tok-kim", { action: "remind", org: ORG, jobId: "c2" });
ok(r.status === 403, "crew cannot send reminders");
n0 = sent.length;
r = await app("tok-dispatch", { action: "remind", org: ORG, jobId: "c2" }, "https://ace.netlify.app");
const rem = sent.slice(n0);
ok(r.body.ok && rem.length === 2 && rem.every((x) => x.To === "+15125550102" || x.To === "+15125550106"), "reminder goes to Dee (confirmed for an old time) and Kim, not Marcus");
ok(/^Ace Moving - Austin: Please confirm Priya "P" Nair, \w{3} \w{3} \d+ at 8:00 AM: https:\/\/ace\.netlify\.app#messages/.test(rem[0].Body), "reminder reads right: " + rem[0].Body);
n0 = sent.length; r = await app("tok-dispatch", { action: "remind", org: ORG, jobId: "c2" });
ok(sent.length === n0 && !r.body.ok && /last 10 minutes/.test(r.body.message), "no second reminder within 10 minutes");
c2.confirm = { Marcus: { ts: 1, for: slot(c2) }, Dee: { ts: 1, for: slot(c2) }, Kim: { ts: 1, for: slot(c2) } };
putDoc(ORG, "jobs/c2", c2);
r = await app("tok-owner", { action: "remind", org: ORG, jobId: "c2" });
ok(/Everyone on this job has confirmed/.test(r.body.message), "all confirmed: nothing to send");

// evening before
const realToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const tmw = new Date(Date.UTC(+realToday.slice(0, 4), +realToday.slice(5, 7) - 1, +realToday.slice(8, 10) + 1)).toISOString().slice(0, 10);
DB.docs = DB.docs.filter((d) => !(d.org_id === ORG && d.collection === "jobs"));
putDoc(ORG, "org/settings", { ...settings, comms: { ...settings.comms, appUrl: "https://ace.netlify.app" } });
const t1 = job("t1", { assign: { truckId: "t26", crew: ["Marcus", "Dee"] }, d: { ...job("t1").d, moveDate: tmw, time: "08:00" } });
t1.confirm = { Marcus: { ts: 1, for: tmw + " 08:00" } };
const t2 = job("t2", { assign: { truckId: "t26", crew: ["Marcus"] }, d: { ...job("t2").d, name: "Nadia Farouk", moveDate: tmw, time: "13:00", from: "1502 E 6th" } });
const t3 = job("t3", { status: "quoted", assign: { truckId: "", crew: ["Kim"] }, d: { ...job("t3").d, moveDate: tmw } });
const t4 = job("t4", { assign: { truckId: "", crew: [] }, d: { ...job("t4").d, name: "Sam K", moveDate: tmw } });
const t5 = job("t5", { test: true, assign: { truckId: "", crew: ["Kim"] }, d: { ...job("t5").d, moveDate: tmw } });
[t1, t2, t3, t4, t5].forEach((x) => putDoc(ORG, "jobs/" + x.id, x));
const cron = (h?: string) => fn.handle(new Request(BASE + "/cron/tomorrow", { method: "POST", headers: h ? { "x-tally-cron": h } : {} }));
let cr = await cron("guess");
ok(cr.status === 403, "evening run refuses without the secret (none set)");
Deno.env.set("TALLY_CRON_SECRET", "s3cret");
cr = await cron("wrong");
ok(cr.status === 403, "evening run refuses a wrong secret");
n0 = sent.length;
cr = await cron("s3cret");
const cj = await cr.json(), ev = sent.slice(n0);
ok(cr.status === 200 && cj.day === tmw, "evening run covers tomorrow (" + tmw + ")");
const mT = ev.find((x) => x.To === "+15125550101"), dT = ev.find((x) => x.To === "+15125550102");
ok(!!mT && /Tomorrow you're on Priya "P" Nair at 8:00 AM \(418 Oak St, Austin\); Nadia Farouk at 1:00 PM \(1502 E 6th\)\. Please confirm: https/.test(mT.Body), "Marcus gets one text listing both jobs, asked to confirm the one he hasn't: " + (mT && mT.Body));
ok(!!dT && /Tomorrow you're on Priya .* Please confirm/.test(dT.Body), "Dee asked to confirm");
ok(!ev.some((x) => x.To === "+15125550106"), "quotes don't count; Kim not texted");
const off = ev.filter((x) => /Tomorrow: 3 jobs, 2 people\./.test(x.Body));
ok(off.length === 2 && /Not confirmed yet: Dee \(Priya "P" Nair\), Marcus \(Nadia Farouk\)\. No crew yet: Sam K\./.test(off[0].Body), "office summary: " + (off[0] && off[0].Body));
n0 = sent.length; await cron("s3cret");
ok(sent.length === n0, "running it twice the same evening sends nothing more");
t1.confirm = { Marcus: { ts: 1, for: tmw + " 08:00" }, Dee: { ts: 1, for: tmw + " 08:00" } };
putDoc(ORG, "jobs/t1", t1);
DB.comm_log = DB.comm_log.filter((x) => x.purpose !== "tomorrow" && x.purpose !== "tomorrow-office");
n0 = sent.length; await cron("s3cret");
ok(/You're confirmed\. See you there\./.test((sent.slice(n0).find((x) => x.To === "+15125550102") || {}).Body || ""), "someone fully confirmed gets a plain reminder");
putDoc(ORG, "org/settings", { ...settings, comms: { ...settings.comms, alerts: { ...settings.comms.alerts, tomorrow: false } } });
DB.comm_log = DB.comm_log.filter((x) => x.purpose !== "tomorrow" && x.purpose !== "tomorrow-office");
n0 = sent.length; await cron("s3cret");
ok(sent.length === n0, "switched off in Setup: nothing sent");
putDoc(ORG, "org/settings", settings);

/* ---------- quote distance ---------- */
r = await app("tok-owner", { action: "distance", org: ORG, from: "418 Oak St, Austin", to: "77 Ridge Rd, Round Rock" });
ok(r.body.ok === false && r.body.setup === true && routesCalls.length === 0, "no Google key: says it is not set up, calls nothing");
Deno.env.set("GOOGLE_MAPS_KEY", "gkey");
r = await app("tok-owner", { action: "distance", org: ORG, from: "418 Oak St, Austin", to: "77 Ridge Rd, Round Rock" });
const rc = routesCalls[routesCalls.length - 1];
ok(r.body.ok && r.body.miles === 22.4 && r.body.minutes === 31, "36,049 m and 1,862 s come back as 22.4 mi and 31 min");
ok(r.body.src === "google", "the answer says it came from Google, so the quote can say so");
ok(rc.h["X-Goog-FieldMask"] === "routes.distanceMeters,routes.duration" && rc.bd.travelMode === "DRIVE" && rc.bd.origin.address === "418 Oak St, Austin" && !rc.bd.routingPreference, "asks Google for driving distance only (the cheapest tier)");
r = await app("tok-kim", { action: "distance", org: ORG, from: "a", to: "b" });
ok(r.status === 403, "crew cannot use the lookup");
r = await app("tok-stranger", { action: "distance", org: ORG, from: "a", to: "b" });
ok(r.status === 401, "outsiders cannot use your Google key");
r = await app("tok-dispatch", { action: "distance", org: ORG, from: "418 Oak St", to: "nowhere special" });
ok(!r.body.ok && /No driving route/.test(r.body.message), "no route: clear message");
r = await app("tok-dispatch", { action: "distance", org: ORG, from: "418 Oak St", to: "zzz" });
ok(!r.body.ok && /could not find one of those addresses/.test(r.body.message), "unknown address: clear message");
Deno.env.set("GOOGLE_MAPS_KEY", "bad");
r = await app("tok-dispatch", { action: "distance", org: ORG, from: "418 Oak St", to: "77 Ridge" });
ok(!r.body.ok && /did not answer \(403\)/.test(r.body.message) && !/bad|key/i.test(r.body.message), "a bad key fails without exposing it");
Deno.env.set("GOOGLE_MAPS_KEY", "gkey");

/* ---------- test jobs never text or call ---------- */
putDoc(ORG, "org/settings", settings);
putDoc(ORG, "jobs/tj", job("tj", { test: true, assign: { truckId: "t26", crew: ["Marcus", "Dee"] } }));
n0 = sent.length;
r = await app("tok-dispatch", { action: "job", org: ORG, jobId: "tj" });
ok(r.body.skipped === "test" && sent.length === n0, "assigning crew to a test job texts nobody");
r = await app("tok-marcus", { action: "eta", org: ORG, jobId: "tj", minutes: 20 });
ok(!r.body.ok && /Test job/.test(r.body.message) && sent.length === n0, "no arrival text for a test job");
r = await app("tok-marcus", { action: "call", org: ORG, jobId: "tj" });
ok(!r.body.ok && /Test job/.test(r.body.message) && sent.length === n0, "no masked call for a test job");
r = await app("tok-dispatch", { action: "remind", org: ORG, jobId: "tj" });
ok(!r.body.ok && /Test job/.test(r.body.message) && sent.length === n0, "no reminder for a test job");
putDoc(ORG, "jobs/tj2", job("tj2", { test: true, status: "done" }));
r = await app("tok-marcus", { action: "forms", org: ORG, jobId: "tj2" });
ok(r.body.skipped === "test" && sent.length === n0, "no forms text for a test job");

/* ---------- CORS and routing ---------- */
const pre = await fn.handle(new Request(BASE + "/app", { method: "OPTIONS" }));
ok(pre.status === 200 && pre.headers.get("access-control-allow-origin") === "*", "browser preflight answered");
const nf = await fn.handle(new Request(BASE + "/nope", { method: "POST", body: "" }));
ok(nf.status === 404, "unknown path 404");
r = await app("tok-owner", { action: "line", org: ORG });
ok(r.body.number === "+15125550000" && r.body.twilio === true, "line check reports the number");

/* ---------- truck down (the emergency beacon) ---------- */
{
  const appSettings = { ...settings, comms: { ...settings.comms, appUrl: "https://tally.example.com/app/" } };
  putDoc(ORG, "org/settings", appSettings);
  const sos = (id: string, over: any = {}) => ({ id, t: "office", from: "Marcus", text: "Flat tire, rear left", ts: Date.now() - 30e3, k: "sos", upd: Date.now(), truck: "Box 1 (26 ft)",
    truckId: "t26", jobId: "j1", job: "Priya Nair", loc: { lat: 30.2671534, lng: -97.7430571, acc: 12, ts: Date.now() }, ...over });
  const step = (tok: string, msgId: string, kind: string, extra: any = {}, origin?: string) => app(tok, { action: "sos", org: ORG, msgId, kind, now: Date.now(), ...extra }, origin);
  const texts = (from: number) => sent.slice(from).filter((s) => s.kind === "sms");
  const state = (id: string) => DB.comm_job_state.find((x) => x.org_id === ORG && x.job_id === "sos:" + id);
  const slots = () => DB.comm_job_state.filter((x) => /^sosslot:/.test(x.job_id));
  const freeSlots = () => { const keep = DB.comm_job_state.filter((x) => !/^sosslot:/.test(x.job_id)); DB.comm_job_state.length = 0; keep.forEach((x) => DB.comm_job_state.push(x)); };

  ok(fn.sosPlace({ lat: 30.2671534, lng: -97.7430571, acc: 12 }) === "https://maps.google.com/?q=30.26715,-97.74306 (within 12 m)", "map link, to about a metre, with how precise it is");
  ok(fn.sosPlace({ lat: 30.2, lng: -97.7, acc: 2400 }) === "https://maps.google.com/?q=30.20000,-97.70000 (within 2.4 km)", "a rough fix says so in km");
  ok(fn.sosPlace(null) === "" && fn.sosPlace({ lat: null, lng: 1 }) === "" && fn.sosPlace({ lat: 95, lng: 1 }) === "" && fn.sosPlace({ lat: "x", lng: 1 }) === "", "no location, or nonsense, gives no link");
  ok(JSON.stringify(fn.sosPeople(settings, "Marcus")) === '["Owner","Dispatch"]', "the office is texted, not the crew");
  ok(JSON.stringify(fn.sosPeople(settings, "Dispatch")) === '["Owner"]', "never the person who sent it");
  ok(JSON.stringify(fn.sosPeople({ ...settings, contacts: { ...settings.contacts, Dispatch: "+1 512 555 0100" } }, "Marcus")) === '["Owner"]', "one text per phone number");
  ok(JSON.stringify(fn.sosPeople({ ...settings, contacts: { ...settings.contacts, Owner: "" } }, "Marcus")) === '["Dispatch"]', "someone in the office with no number is skipped");

  putDoc(ORG, "chat/sa1", sos("sa1"));
  let n0 = sent.length;
  r = await step("tok-kim", "sa1", "start");
  ok(r.status === 403 && sent.length === n0, "only the person who sent the alert can have it texted");
  r = await step("tok-stranger", "sa1", "start");
  ok(r.status === 401 && sent.length === n0, "nobody from another company can");
  r = await step("tok-marcus", "../x", "start");
  ok(r.status === 400, "odd alert id rejected");
  r = await step("tok-marcus", "sa1", "maybe");
  ok(r.status === 400 && sent.length === n0, "unknown step rejected");
  r = await step("tok-marcus", "j1", "start");
  ok(!r.body.ok && /not available/.test(r.body.message), "a chat message that isn't an alert can't be texted");
  r = await step("tok-marcus", "sa1", "start", {}, "https://evil.example.com");
  ok(r.body.ok && r.body.sent === 2 && JSON.stringify(r.body.names) === '["Owner","Dispatch"]', "Marcus's alert texts the office");
  const t1 = texts(n0);
  ok(t1.map((s) => s.To).sort().join() === "+15125550100,+15125550199" && t1.every((s) => s.From === "+15125550000"), "both office phones, from the company line");
  ok(/^Ace Moving - Austin TRUCK DOWN: Box 1 \(26 ft\) is down\. Sent by Marcus at \d{1,2}:\d{2} [AP]M, on the Priya Nair job\. "Flat tire, rear left" Location: https:\/\/maps\.google\.com\/\?q=30\.26715,-97\.74306 \(within 12 m\)\. Call Marcus: \+15125550101\. Live in Tally: https:\/\/tally\.example\.com\/app\/#sos/.test(t1[0].Body),
    "the text says which truck, who, when, the job, the note, where, and how to reach them: " + t1[0].Body);
  ok(!/evil/.test(t1[0].Body), "the link is the company's own app address, never one the phone sent");
  ok(t1.every((s) => /^[\x20-\x7E]*$/.test(s.Body)), "plain characters only");
  const logged = DB.comm_log.filter((x) => x.purpose === "sos");
  ok(logged.length === 2 && logged.every((x) => x.party === "Marcus" && x.job_id === "sos:sa1") && logged.map((x) => x.staff).sort().join() === "Dispatch,Owner", "logged as truck-down texts to each office person");
  ok(state("sa1").move_time === "sent" && JSON.stringify(state("sa1").crew) === '["Owner","Dispatch"]', "it remembers who was texted");
  ok(state("sa1").version > 1e9 && state("sa1").version < 2147483647, "a new claim is numbered from the clock, so it never repeats an old one's number");
  n0 = sent.length;
  r = await step("tok-marcus", "sa1", "start");
  ok(r.body.ok && r.body.already && JSON.stringify(r.body.names) === '["Owner","Dispatch"]' && sent.length === n0, "asking again texts nobody twice");
  r = await step("tok-marcus", "sa1", "end");
  ok(!r.body.ok && /still on/.test(r.body.message) && sent.length === n0, "no all-clear while the alert is still on");
  putDoc(ORG, "chat/sa1", sos("sa1", { end: { by: "Click https://evil.example.com/login to keep your account", ts: Date.now() } }));
  r = await step("tok-kim", "sa1", "end");
  ok(r.status === 403 && sent.length === n0, "crew who didn't send it can't send the all-clear");
  r = await step("tok-marcus", "sa1", "end");
  ok(r.body.ok && r.body.sent === 2 && texts(n0).length === 2 && texts(n0).every((s) => /^Ace Moving - Austin: All clear\. Box 1 \(26 ft\) is running again, Marcus says\. The truck-down alert from \d{1,2}:\d{2} [AP]M is over\.$/.test(s.Body)),
    "Running again texts the all-clear to the same people: " + (texts(n0)[0] || {}).Body);
  ok(texts(n0).every((s) => !/evil|Click/.test(s.Body)), "the all-clear names whoever is signed in, never what was written on the alert");
  ok(DB.comm_log.filter((x) => x.purpose === "sos-end" && x.job_id === "sos:sa1").length === 2, "logged as all-clear texts");
  n0 = sent.length;
  r = await step("tok-marcus", "sa1", "end");
  ok(r.body.already && sent.length === n0, "the all-clear goes once");
  r = await step("tok-marcus", "sa1", "start");
  ok(r.body.skipped === "ended" && sent.length === n0, "an alert that has ended texts nobody");

  // the office closes it; the one who closed it isn't texted about it
  putDoc(ORG, "chat/sa2", sos("sa2", { text: "", loc: null }));
  n0 = sent.length;
  r = await step("tok-marcus", "sa2", "start");
  ok(r.body.sent === 2 && / is down\. Sent by Marcus at [^.]*\. No location yet\. Call Marcus: \+15125550101\. Live in Tally: \S+#sos( Reply STOP to opt out\.)?$/.test(texts(n0)[0].Body), "no note and no location yet: the text says so: " + texts(n0)[0].Body);
  putDoc(ORG, "chat/sa2", sos("sa2", { text: "", loc: null, end: { by: "Marcus", ts: Date.now() } }));
  n0 = sent.length;
  r = await step("tok-dispatch", "sa2", "end");
  ok(r.body.ok && r.body.sent === 1 && texts(n0).length === 1 && texts(n0)[0].To === "+15125550100" &&
    /^Ace Moving - Austin: Dispatch closed the truck-down alert from Marcus \(sent at \d{1,2}:\d{2} [AP]M\)\.$/.test(texts(n0)[0].Body), "the office closing it tells the rest of the office, by who is signed in: " + texts(n0)[0].Body);

  // an owner who has no staff name of their own goes by the owner's name in Setup
  const ownerRow = DB.members.find((m) => m.user_id === "u-owner");
  ownerRow.staff = "";
  putDoc(ORG, "chat/sa3", sos("sa3", { from: "Owner" }));
  n0 = sent.length;
  r = await step("tok-owner", "sa3", "start");
  ok(r.body.ok && r.body.sent === 1 && texts(n0)[0].To === "+15125550199" && /Call Owner: \+15125550100\./.test(texts(n0)[0].Body), "the owner's own alert texts dispatch");
  r = await step("tok-owner", "sa1", "start");
  ok(r.status === 403, "and the owner can't text about someone else's alert");
  ownerRow.staff = "Richie";   // an owner whose sign-in is linked to a profile under another name
  putDoc(ORG, "chat/sa3b", sos("sa3b", { from: "Owner" }));
  n0 = sent.length;
  r = await step("tok-owner", "sa3b", "start");
  ok(r.body.ok && r.body.sent === 1 && texts(n0)[0].To === "+15125550199", "an owner is still the owner's name in Setup when their sign-in has a profile name");
  putDoc(ORG, "chat/sa3b", sos("sa3b", { from: "Owner", end: { by: "Owner", ts: Date.now() } }));
  n0 = sent.length;
  r = await step("tok-owner", "sa3b", "end");
  ok(r.body.sent === 1 && /All clear\. Box 1 \(26 ft\) is running again, Owner says\./.test(texts(n0)[0].Body), "and their all-clear reads as their own");
  ownerRow.staff = "Owner";

  // the age of an alert is judged by the clock of the phone that sent it
  putDoc(ORG, "chat/sa4", sos("sa4", { ts: Date.now() - 2 * 3600e3 }));
  n0 = sent.length;
  r = await step("tok-marcus", "sa4", "start");
  ok(!r.body.ok && /too old/.test(r.body.message) && sent.length === n0, "an alert from 2 hours ago isn't texted now");
  r = await step("tok-marcus", "sa4", "start", { now: Date.now() - 2 * 3600e3 + 60e3 });
  ok(r.body.ok && r.body.sent === 2, "unless the phone's own clock says it was sent a minute ago (a phone whose clock is off)");
  putDoc(ORG, "chat/sa5", sos("sa5", { jobId: "tj" }));
  n0 = sent.length;
  r = await step("tok-marcus", "sa5", "start");
  ok(r.body.ok && r.body.skipped === "test" && sent.length === n0 && !state("sa5"), "an alert from a test job texts nobody");

  // a text that fails: nothing is kept, so trying again really sends it
  freeSlots();   // a new hour
  putDoc(ORG, "chat/sa6", sos("sa6"));
  twilioFail = "Twilio is down";
  n0 = sent.length;
  r = await step("tok-marcus", "sa6", "start");
  ok(!r.body.ok && r.body.reason === "failed" && !state("sa6") && slots().length === 0, "texts that all fail say so, and let go of the alert and of the hour's slot");
  for (let k = 0; k < 8; k++) r = await step("tok-marcus", "sa6", "start");
  ok(!r.body.ok && r.body.reason === "failed" && slots().length === 0, "so trying again and again during an outage never uses up the hour's alerts");
  twilioFail = "";
  r = await step("tok-marcus", "sa6", "start");
  ok(r.body.ok && r.body.sent === 2 && JSON.stringify(r.body.names) === '["Owner","Dispatch"]' && texts(n0).length === 2 && slots().length === 1, "so trying again texts the office");

  // another request is still sending them; or one died part way
  putDoc(ORG, "chat/sa7", sos("sa7"));
  DB.comm_job_state.push({ org_id: ORG, job_id: "sos:sa7", crew: ["Owner", "Dispatch"], move_date: null, move_time: "sending", forms_at: null, version: 1, updated_at: new Date().toISOString() });
  n0 = sent.length;
  r = await step("tok-marcus", "sa7", "start");
  ok(r.body.ok && r.body.pending && sent.length === n0, "while another request is sending them, the phone is told to look again");
  state("sa7").updated_at = new Date(Date.now() - 3 * 60e3).toISOString();
  DB.comm_log.push({ id: nextId++, org_id: ORG, job_id: "sos:sa7", channel: "sms", direction: "out", purpose: "sos", staff: "Owner", status: "delivered", sid: "SMold1", created_at: new Date().toISOString() });
  r = await step("tok-marcus", "sa7", "start");
  ok(r.body.ok && r.body.sent === 1 && texts(n0).length === 1 && texts(n0)[0].To === "+15125550199" && JSON.stringify(r.body.names) === '["Owner","Dispatch"]',
    "a request that died part way is finished by the next one, without texting anyone twice");
  ok(state("sa7").move_time === "sent", "and it is marked done");
  // a request that died while handing a text to Twilio: that person is texted again rather than missed
  putDoc(ORG, "chat/sa7b", sos("sa7b"));
  DB.comm_job_state.push({ org_id: ORG, job_id: "sos:sa7b", crew: ["Owner", "Dispatch"], move_date: null, move_time: "sending", forms_at: null, version: 1, updated_at: new Date(Date.now() - 3 * 60e3).toISOString() });
  DB.comm_log.push({ id: nextId++, org_id: ORG, job_id: "sos:sa7b", channel: "sms", direction: "out", purpose: "sos", staff: "Owner", status: "queued", created_at: new Date().toISOString() });
  n0 = sent.length;
  r = await step("tok-marcus", "sa7b", "start");
  ok(r.body.ok && r.body.sent === 2 && texts(n0).length === 2, "someone a dead request was still handing to Twilio is texted again, rather than missed");

  // a slow request that another one has taken over stops after the text in hand
  putDoc(ORG, "chat/sa9", sos("sa9"));
  onSend = async () => { const st = state("sa9"); st.version += 5; st.updated_at = new Date().toISOString(); };
  n0 = sent.length;
  r = await step("tok-marcus", "sa9", "start");
  ok(r.body.ok && r.body.pending && r.body.sent === 1 && texts(n0).length === 1, "a request that has been taken over stops, so nobody is texted twice, and the phone is told to look again");

  // so slow it looks dead (over 90 seconds) when the office closes the alert: the all-clear goes to
  // whoever the alert may have reached, and the slow request sends nothing more
  putDoc(ORG, "chat/sa10", sos("sa10"));
  let closeSlow: any = null;
  onSend = async () => {
    state("sa10").updated_at = new Date(Date.now() - 3 * 60e3).toISOString();
    putDoc(ORG, "chat/sa10", sos("sa10", { end: { by: "Dispatch", ts: Date.now() } }));
    closeSlow = await step("tok-dispatch", "sa10", "end");
  };
  n0 = sent.length;
  r = await step("tok-marcus", "sa10", "start");
  const slow = texts(n0);
  ok(closeSlow && closeSlow.body.ok && closeSlow.body.sent === 1 && slow.filter((s) => /closed the truck-down alert from Marcus/.test(s.Body)).map((s) => s.To).join() === "+15125550100",
    "the all-clear goes to the person whose alert text was still going out, not to Dispatch, who closed it");
  ok(r.body.pending && slow.filter((s) => /TRUCK DOWN/.test(s.Body)).length === 1 && !slow.some((s) => /TRUCK DOWN/.test(s.Body) && s.To === "+15125550199"),
    "and the slow request sends no more alert texts once it was closed");
  ok(!!state("sa10").forms_at && slow.filter((s) => /closed the truck-down alert/.test(s.Body)).length === 1, "the all-clear goes once");

  // a text Twilio never answers is given up after a short wait, and the rest still go
  putDoc(ORG, "chat/sa11", sos("sa11"));
  fn.limits.twilioMs = 60;
  onSend = () => new Promise((res) => setTimeout(res, 2000));
  n0 = sent.length;
  const t0 = Date.now();
  r = await step("tok-marcus", "sa11", "start");
  fn.limits.twilioMs = 20e3;
  const hung = DB.comm_log.find((x) => x.job_id === "sos:sa11" && x.staff === "Owner");
  ok(Date.now() - t0 < 1500 && r.body.ok && r.body.sent === 1 && JSON.stringify(r.body.names) === '["Dispatch"]' && texts(n0).length === 1,
    "a hung text to Twilio is given up, and the next one still goes");
  ok(hung && hung.status === "failed" && /did not answer/.test(hung.error || ""), "and the log says Twilio did not answer");

  // the office closes it while the texts are going out: the all-clear follows them
  putDoc(ORG, "chat/sa8", sos("sa8"));
  let endWhileSending: any = null;
  onSend = async () => {
    putDoc(ORG, "chat/sa8", sos("sa8", { end: { by: "Dispatch", ts: Date.now() } }));
    endWhileSending = await step("tok-dispatch", "sa8", "end");
  };
  n0 = sent.length;
  r = await step("tok-marcus", "sa8", "start");
  const raced = texts(n0);
  ok(endWhileSending && endWhileSending.body.skipped === "start-in-progress", "an all-clear asked for mid-send waits for the alert texts");
  ok(r.body.ok && raced.filter((s) => /TRUCK DOWN/.test(s.Body)).length === 2 && raced.filter((s) => /All clear\. The truck-down alert from Marcus \(sent at [^)]*\) is over\./.test(s.Body)).length === 2,
    "and goes out right after them, to each of them once");
  n0 = sent.length;
  r = await step("tok-dispatch", "sa8", "end");
  ok(r.body.already && sent.length === n0, "and not again");

  // six alerts an hour, even sent all at once
  freeSlots();
  const batch = [];
  for (let k = 0; k < 9; k++) { putDoc(ORG, "chat/sp" + k, sos("sp" + k)); batch.push(step("tok-marcus", "sp" + k, "start")); }
  n0 = sent.length;
  const res = await Promise.all(batch);
  ok(res.filter((x) => x.body.ok && x.body.sent === 2).length === 6 && res.filter((x) => x.body.reason === "limit").length === 3 && slots().length === 6,
    "nine alerts at once: six are texted, three are told there have been a lot this hour");
  slots().forEach((x) => { x.updated_at = new Date(Date.now() - 4 * 3600e3).toISOString(); x.job_id = "sosslot:1:" + x.job_id.split(":").pop(); });
  r = await step("tok-marcus", "sp8", "start");
  ok(r.body.ok && r.body.sent === 2 && slots().length === 1, "the next hour they go again, and old slots are cleared away");

  // with no app address in Setup the text has no link: an address the phone sends is never used
  putDoc(ORG, "org/settings", settings);
  freeSlots();
  putDoc(ORG, "chat/sc1", sos("sc1"));
  n0 = sent.length;
  r = await step("tok-marcus", "sc1", "start", {}, "https://evil.example.com");
  ok(r.body.sent === 2 && texts(n0).length === 2 && texts(n0).every((s) => !/Live in Tally|evil/.test(s.Body)), "with no app address in Setup the text has no link, whatever address the phone sends");
  putDoc(ORG, "org/settings", appSettings);

  // no company line
  const line = DB.comm_lines.splice(0, DB.comm_lines.length);
  putDoc(ORG, "chat/sb1", sos("sb1"));
  n0 = sent.length;
  r = await step("tok-marcus", "sb1", "start");
  ok(!r.body.ok && r.body.reason === "no-line" && sent.length === n0, "no company line: no texts, and the app is told why");
  line.forEach((l) => DB.comm_lines.push(l));
  freeSlots();
  r = await step("tok-marcus", "sb1", "start");
  ok(r.body.ok && r.body.sent === 2, "the alert can still be texted once the line is back");

  // nobody in the office has a number
  putDoc(ORG, "org/settings", { ...appSettings, contacts: { ...settings.contacts, Owner: "", Dispatch: "" } });
  putDoc(ORG, "chat/sb2", sos("sb2"));
  n0 = sent.length;
  r = await step("tok-marcus", "sb2", "start");
  ok(r.body.ok && r.body.reason === "no-numbers" && r.body.names.length === 0 && sent.length === n0, "no office numbers: the app is told nobody could be texted");
  putDoc(ORG, "org/settings", settings);
}

console.log("\n" + passes + " passed, " + failures + " failed");
if (failures) Deno.exit(1);
