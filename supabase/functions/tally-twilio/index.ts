// Tally — the server side of the app (Supabase Edge Function, named tally-twilio for history)
// Text alerts, masked calling, callbacks to the office, the call/text log, quote distances,
// emergency alert texts and card payments through Stripe.
//
// Secrets this function reads (Supabase › Edge Functions › Secrets):
//   TWILIO_ACCOUNT_SID   your Twilio Account SID (starts with AC)
//   TWILIO_AUTH_TOKEN    your Twilio Auth Token
//   GOOGLE_MAPS_KEY      a Google key with the Routes API on (quote distance lookup; optional)
//   STRIPE_SECRET_KEY    Stripe secret or restricted key (sk_test_, sk_live_, rk_test_, rk_live_)
//   STRIPE_PUBLISHABLE_KEY  the matching pk_ key, for typing a card into the app
//   STRIPE_WEBHOOK_SECRET   optional: only if you made the Stripe webhook yourself. Otherwise the
//                        function makes its own the first time a payment starts.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by Supabase automatically
//
// Deploy with "Enforce JWT verification" OFF: Twilio and Stripe cannot send a Supabase token.
// App requests are checked here instead (the signed-in user's token is verified on every call),
// every Twilio request is checked against Twilio's signature, and every Stripe event against
// Stripe's.
//
// Routes:
//   POST /app            the Tally app: {action:'job'|'forms'|'call'|'line'|'pay_…', org, jobId}
//                        and {action:'sos', org, msgId, kind:'start'|'end'} for emergency alerts
//   POST /stripe         Stripe events (payments finishing or failing, pay links used, refunds, disputes)
//   GET  /p/<code>       a short payment link: sends the customer to a Stripe page for what they owe now
//   GET  /pay/done       where the customer lands after paying
//   /twilio/bridge       masked call: your phone answered, ask for "press 1"
//   /twilio/connect      masked call: you pressed 1, dial the customer from the company number
//   /twilio/dialed       masked call: how the customer leg ended
//   /twilio/voice        someone called the company number: ring the office
//   /twilio/whisper      what the office hears before the caller is put through
//   /twilio/after        the office did not pick up: tell the caller, text the office
//   /twilio/sms          someone texted the company number
//   /twilio/status       Twilio delivery and call-status reports
//   /cron/tomorrow       the evening-before texts; called by Supabase Cron with the
//                        header x-tally-cron: <TALLY_CRON_SECRET>
// (the /twilio/... and /cron/... routes are POST too)

const FN = "tally-twilio";
const CALLS_PER_HOUR = 20;
const FORMS_REPEAT_MS = 6 * 3600e3;

// deno-lint-ignore no-explicit-any
type J = any;

function env(k: string): string {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  return (d && d.env.get(k)) || "";
}
function base(): string {
  return env("TALLY_PUBLIC_URL") || (env("SUPABASE_URL").replace(/\/+$/, "") + "/functions/v1/" + FN);
}

/* ---------- responses ---------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: J, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function xml(body: string): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + body + "</Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}
function x(s: unknown): string {
  return String(s == null ? "" : s).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" } as J)[c]);
}

/* ---------- phone numbers and text ---------- */
export function e164(p: unknown): string {
  const raw = String(p || "").trim();
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (raw.startsWith("+")) return d.length >= 8 && d.length <= 15 ? "+" + d : "";
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return "";
}
function last10(p: unknown): string {
  return String(p || "").replace(/\D/g, "").slice(-10);
}
// Plain characters only. One curly quote or dash turns a text into the 70-character
// unicode format and roughly doubles what it costs.
export function gsm(s: string): string {
  return String(s)
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u00B7\u2022]/g, "-")
    .replace(/\u2192/g, "to")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/[\[\]{}\\^~|`]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDay(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return "no date set";
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return DAYS[dt.getUTCDay()] + " " + MONS[dt.getUTCMonth()] + " " + dt.getUTCDate();
}
export function fmtTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return "";
  const h = +m[1];
  return ((h + 11) % 12 + 1) + ":" + m[2] + (h >= 12 ? " PM" : " AM");
}
function when(d: J): string {
  const t = fmtTime(d.time);
  return fmtDay(d.moveDate) + (t ? " at " + t : "");
}
function today(): string {
  const tz = env("TALLY_TZ") || "America/Los_Angeles";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/* ---------- database (PostgREST with the service role) ---------- */
async function rest(method: string, path: string, body?: J, prefer?: string): Promise<J> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const headers: Record<string, string> = { apikey: key, Authorization: "Bearer " + key };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers["Prefer"] = prefer;
  const r = await fetch(env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error("db " + r.status + ": " + txt.slice(0, 200));
  return txt ? JSON.parse(txt) : null;
}
const q = encodeURIComponent;
async function getDoc(org: string, path: string): Promise<J> {
  const rows = await rest("GET", "docs?select=data&org_id=eq." + q(org) + "&path=eq." + q(path) + "&limit=1");
  return rows && rows[0] ? rows[0].data : null;
}
async function lineFor(org: string): Promise<J> {
  const rows = await rest("GET", "comm_lines?select=*&org_id=eq." + q(org) + "&limit=1");
  return rows && rows[0] && rows[0].enabled ? rows[0] : null;
}
async function lineByNumber(num: string): Promise<J> {
  const rows = await rest("GET", "comm_lines?select=*&phone_number=eq." + q(num) + "&enabled=is.true&limit=1");
  return rows && rows[0] ? rows[0] : null;
}
async function logRow(row: J): Promise<J> {
  const rows = await rest("POST", "comm_log", row, "return=representation");
  return rows[0];
}
async function patchLog(id: unknown, patch: J): Promise<void> {
  patch.updated_at = new Date().toISOString();
  await rest("PATCH", "comm_log?id=eq." + q(String(id)), patch);
}
async function getLog(id: unknown): Promise<J> {
  const rows = await rest("GET", "comm_log?select=*&id=eq." + q(String(id)) + "&limit=1");
  return rows && rows[0] ? rows[0] : null;
}

/* ---------- people ---------- */
function contacts(S: J): Record<string, string> {
  return (S && S.contacts) || {};
}
function officeNames(S: J): string[] {
  return ((S && S.office) || []).map((o: J) => o.name).filter(Boolean);
}
function ringNames(S: J): string[] {
  const c = (S && S.comms) || {};
  const list = Array.isArray(c.ring) && c.ring.length ? c.ring : officeNames(S);
  return list.filter((n: string) => e164(contacts(S)[n]));
}
function alertOn(S: J, k: string): boolean {
  const a = (S && S.comms && S.comms.alerts) || {};
  return a[k] !== false;
}
function company(S: J): string {
  return gsm((S && S.company) || "Tally");
}
function staffByPhone(S: J, from: string): string {
  const c = contacts(S), want = last10(from);
  if (!want) return "";
  return Object.keys(c).find((n) => last10(c[n]) === want) || "";
}
// The address texts link to, so a tap opens Job messages (or, for an emergency, the alert).
// Setup › Texts and calls fills it in.
export function appLink(S: J, origin?: string | null, hash = "messages"): string {
  // The Android app's own pages live at appassets.androidplatform.net, which no one else can open.
  const fromOrigin = origin && !/androidplatform\.net(:\d+)?\/?$/i.test(origin) ? origin : "";
  const raw = String((S && S.comms && S.comms.appUrl) || fromOrigin || "").trim();
  if (!/^https:\/\/[^\s"<>]+$/i.test(raw)) return "";
  return raw.replace(/#.*$/, "") + "#" + hash;
}
function slotOf(job: J): string {
  const d = job.d || {};
  return (d.moveDate || "") + " " + (d.time || "");
}
export function isConfirmed(job: J, name: string): boolean {
  const c = job && job.confirm && job.confirm[name];
  return !!(c && c.for === slotOf(job));
}
function addDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1)).toISOString().slice(0, 10);
}
function leadOf(S: J, job: J): string {
  const crew: string[] = (job.assign && job.assign.crew) || [];
  const leads: string[] = (S && S.leads) || [];
  return crew.find((n) => leads.indexOf(n) >= 0) || crew.find((n) => officeNames(S).indexOf(n) >= 0) || "";
}

/* ---------- Twilio ---------- */
// A call to Twilio that hangs is given up after 20 seconds, so one stuck text never holds up the
// rest (and a truck-down request always renews its claim well inside its 90 seconds).
export const limits = { twilioMs: 20e3 };
async function twilio(resource: string, params: Record<string, string>): Promise<J> {
  const sid = env("TWILIO_ACCOUNT_SID"), tok = env("TWILIO_AUTH_TOKEN");
  if (!sid || !tok) throw new Error("Twilio is not configured: add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN");
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), limits.twilioMs);
  try {
    const r = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/" + resource + ".json", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(sid + ":" + tok), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: ctl.signal,
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((out && out.message) || "Twilio error " + r.status);
    return out;
  } catch (e) {
    if (ctl.signal.aborted) throw new Error("Twilio did not answer within " + Math.round(limits.twilioMs / 1000) + " seconds");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function twilioSignature(url: string, params: Record<string, string>, token: string): Promise<string> {
  let data = url;
  Object.keys(params).sort().forEach((k) => { data += k + params[k]; });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let bin = "";
  sig.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- sending a text, logged against the job ---------- */
async function sendText(o: { org: string; line: J; jobId?: string; purpose: string; staff?: string; party?: string; to: string; body: string }): Promise<J> {
  const to = e164(o.to);
  const row: J = {
    org_id: o.org, job_id: o.jobId || null, channel: "sms", direction: "out", purpose: o.purpose,
    staff: o.staff || null, party: o.party || o.staff || null, to_number: to || String(o.to || ""),
    from_number: o.line.phone_number, body: "", status: "queued",
  };
  if (!to) {
    row.status = "no-number";
    row.body = gsm(o.body);
    row.error = "No phone number saved for " + (o.staff || "this person") + " in Setup";
    return logRow(row);
  }
  let body = gsm(o.body);
  const prior = await rest("GET", "comm_log?select=id&org_id=eq." + q(o.org) + "&channel=eq.sms&direction=eq.out&to_number=eq." + q(to) + "&status=neq.failed&status=neq.no-number&limit=1");
  if (!prior || !prior.length) body += " Reply STOP to opt out.";
  row.body = body;
  const saved = await logRow(row);
  try {
    const m = await twilio("Messages", {
      To: to, From: o.line.phone_number, Body: body,
      StatusCallback: base() + "/twilio/status?log=" + saved.id,
    });
    await patchLog(saved.id, { sid: m.sid || null, status: m.status || "queued" });
    saved.sid = m.sid;
    saved.status = m.status || "queued";
  } catch (e) {
    await patchLog(saved.id, { status: "failed", error: String((e as Error).message || e).slice(0, 300) });
    saved.status = "failed";
  }
  return saved;
}

/* ---------- who is asking (app requests) ---------- */
async function whoIs(req: Request, org: string): Promise<J> {
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  const r = await fetch(env("SUPABASE_URL").replace(/\/+$/, "") + "/auth/v1/user", {
    headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: auth },
  });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u || !u.id) return null;
  const rows = await rest("GET", "members?select=role,staff&org_id=eq." + q(org) + "&user_id=eq." + q(u.id) + "&limit=1");
  if (!rows || !rows[0]) return null;
  return { uid: u.id, role: rows[0].role, staff: rows[0].staff || "" };
}

/* ---------- the app's actions ---------- */
async function stateOf(org: string, jobId: string): Promise<J> {
  const rows = await rest("GET", "comm_job_state?select=*&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&limit=1");
  return rows && rows[0] ? rows[0] : null;
}
// Claims the next state for a job. Returns false if another request got there first,
// so two devices saving at the same moment never send the same text twice.
async function claim(org: string, jobId: string, prev: J, next: J): Promise<boolean> {
  const now = new Date().toISOString();
  if (!prev) {
    const rows = await rest("POST", "comm_job_state?on_conflict=org_id,job_id",
      { org_id: org, job_id: jobId, version: 1, updated_at: now, ...next }, "resolution=ignore-duplicates,return=representation");
    return !!(rows && rows.length);
  }
  const rows = await rest("PATCH",
    "comm_job_state?org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&version=eq." + prev.version,
    { ...next, version: prev.version + 1, updated_at: now }, "return=representation");
  return !!(rows && rows.length);
}

export async function checkJob(org: string, jobId: string, origin?: string | null): Promise<J> {
  const line = await lineFor(org);
  if (!line) return { ok: false, reason: "no-line" };
  const [S, job] = await Promise.all([getDoc(org, "org/settings"), getDoc(org, "jobs/" + jobId)]);
  if (!job) return { ok: false, reason: "no-job" };
  if (job.test) return { ok: true, sent: 0, skipped: "test" };
  const d = job.d || {};
  const crew: string[] = ((job.assign && job.assign.crew) || []).slice().sort();
  const prev = await stateOf(org, jobId);
  const next = { crew, move_date: d.moveDate || null, move_time: d.time || null };
  const live = (job.status === "booked" || job.status === "active") && !!d.moveDate && d.moveDate >= today();
  const was = prev || { crew: [], move_date: null, move_time: null };
  const changed = JSON.stringify(was.crew || []) !== JSON.stringify(crew) || was.move_date !== next.move_date || was.move_time !== next.move_time;
  if (!changed) return { ok: true, sent: 0 };
  if (!(await claim(org, jobId, prev, next))) return { ok: true, sent: 0, raced: true };
  if (!live) return { ok: true, sent: 0, skipped: "not-upcoming" };

  const before: string[] = was.crew || [];
  const added = crew.filter((n) => before.indexOf(n) < 0);
  const removed = before.filter((n) => crew.indexOf(n) < 0);
  const moved = !!was.move_date && (was.move_date !== next.move_date || was.move_time !== next.move_time);
  const stayed = crew.filter((n) => added.indexOf(n) < 0);
  const co = company(S), name = gsm(d.name || "a job"), lead = leadOf(S, job);
  const truck = ((S && S.trucks) || []).find((t: J) => t.id === (job.assign && job.assign.truckId));
  const C = contacts(S), out: J[] = [];
  const link = appLink(S, origin);

  if (alertOn(S, "assigned")) {
    for (const n of added) {
      const bits = [co + ": You're on " + name + ", " + when(d) + "."];
      if (d.from) bits.push("Pickup " + gsm(d.from) + ".");
      if (truck) bits.push("Truck " + gsm(truck.name) + ".");
      if (lead && lead !== n) bits.push("Lead " + gsm(lead) + ".");
      bits.push(link ? "Confirm in Tally: " + link : "Confirm in Tally under Job messages.");
      out.push(await sendText({ org, line, jobId, purpose: "assigned", staff: n, to: C[n], body: bits.join(" ") }));
    }
    for (const n of removed) {
      out.push(await sendText({ org, line, jobId, purpose: "removed", staff: n, to: C[n],
        body: co + ": You're off " + name + " on " + fmtDay(was.move_date || d.moveDate) + ". No need to show up for it." }));
    }
  }
  if (moved && alertOn(S, "moved")) {
    const old = { moveDate: was.move_date, time: was.move_time };
    for (const n of stayed) {
      out.push(await sendText({ org, line, jobId, purpose: "moved", staff: n, to: C[n],
        body: co + ": " + name + " moved to " + when(d) + " (was " + when(old) + ")." + (d.from ? " Pickup " + gsm(d.from) + "." : "") +
          (link ? " Confirm the new time: " + link : " Confirm the new time in Tally.") }));
    }
  }
  return { ok: true, sent: out.filter((r) => r.status !== "failed" && r.status !== "no-number").length, log: out.map((r) => r.id) };
}

function pendingForms(S: J, job: J): J[] {
  const signed: J = job.signed || {};
  const done = Object.keys(signed).map((k) => signed[k] && signed[k].formId);
  return ((S && S.forms) || []).filter((f: J) => f.required && done.indexOf(f.id) < 0);
}

export async function checkForms(org: string, jobId: string): Promise<J> {
  const line = await lineFor(org);
  if (!line) return { ok: false, reason: "no-line" };
  const [S, job] = await Promise.all([getDoc(org, "org/settings"), getDoc(org, "jobs/" + jobId)]);
  if (!job) return { ok: false, reason: "no-job" };
  if (job.test) return { ok: true, sent: 0, skipped: "test" };
  if (!alertOn(S, "forms")) return { ok: true, sent: 0, skipped: "off" };
  const unloaded = job.status === "active" && !!(job.phases && job.phases.unloadEnd);
  if (job.status !== "done" && !unloaded) return { ok: true, sent: 0, skipped: "not-finished" };
  const pend = pendingForms(S, job);
  if (!pend.length) return { ok: true, sent: 0, skipped: "signed" };
  const prev = await stateOf(org, jobId);
  if (prev && prev.forms_at && Date.now() - Date.parse(prev.forms_at) < FORMS_REPEAT_MS) return { ok: true, sent: 0, skipped: "recent" };
  const base0 = prev || { crew: [], move_date: null, move_time: null };
  if (!(await claim(org, jobId, prev, { crew: base0.crew || [], move_date: base0.move_date, move_time: base0.move_time, forms_at: new Date().toISOString() }))) {
    return { ok: true, sent: 0, raced: true };
  }
  const d = job.d || {}, lead = leadOf(S, job), C = contacts(S), out: J[] = [];
  const body = company(S) + ": " + gsm(d.name || "A job") + (unloaded ? " is unloaded but can't close: " : " is finished but ") + pend.length + " form" + (pend.length === 1 ? "" : "s") +
    " still need" + (pend.length === 1 ? "s" : "") + " the customer's signature (" + gsm(pend.map((f: J) => f.title).join(", ")) + ")." +
    (lead ? " " + gsm(lead) + " ran it." : "");
  const to = officeNames(S).filter((n) => n !== lead);
  for (const n of to) out.push(await sendText({ org, line, jobId, purpose: "forms", staff: n, to: C[n], body }));
  return { ok: true, sent: out.filter((r) => r.status !== "failed" && r.status !== "no-number").length };
}

export function etaGreeting(name: string): string {
  const n = String(name || "").trim();
  if (!n || /&|\b(and|family|inc|llc|law|co|company|corp|group)\b/i.test(n)) return "Hello";
  return "Hi " + n.split(/\s+/)[0];
}
function clockIn(ms: number): string {
  const tz = env("TALLY_TZ") || "America/Los_Angeles";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ms)).replace(/\u202f/g, " ");
  } catch {
    return "";
  }
}

// "We're on the way": texted to the customer when the crew starts the job.
async function sendEta(org: string, me: J, jobId: string, minutes: unknown): Promise<J> {
  const line = await lineFor(org);
  if (!line) return { ok: false, message: "The company line is not set up yet, so the arrival text did not go out." };
  const [S, job] = await Promise.all([getDoc(org, "org/settings"), getDoc(org, "jobs/" + jobId)]);
  if (!job) return { ok: false, message: "That job is not available." };
  if (job.test) return { ok: false, message: "Test job: its phone numbers are made up, so nothing is sent." };
  const office = me.role === "owner" || me.role === "dispatch";
  const onJob = ((job.assign && job.assign.crew) || []).indexOf(me.staff) >= 0;
  if (!office && !onJob) return { ok: false, message: "You can only text customers on your own jobs." };
  const d = job.d || {};
  const cust = e164(d.phone);
  if (!cust) return { ok: false, message: "This job has no customer phone number." };
  const mins = Math.max(5, Math.min(240, Math.round(Number(minutes) || 30)));
  const since = new Date(Date.now() - 3 * 60e3).toISOString();
  const recent = await rest("GET", "comm_log?select=id&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&purpose=eq.eta&created_at=gte." + q(since) + "&limit=1");
  if (recent && recent.length) return { ok: false, message: (d.name || "The customer") + " was texted an arrival time a moment ago." };
  const at = clockIn(Date.now() + mins * 60e3);
  const body = company(S) + ": " + gsm(etaGreeting(d.name)) + ", your crew is on the way and should arrive in about " + mins + " minutes" + (at ? ", around " + at : "") + ".";
  const r = await sendText({ org, line, jobId, purpose: "eta", staff: me.staff, party: d.name || "Customer", to: cust, body });
  if (r.status === "failed") return { ok: false, message: "The arrival text did not go out. Check Calls and texts on the job." };
  return { ok: true, message: "Texted " + (d.name || "the customer") + ": about " + mins + " minutes." };
}

// Office taps "Text a reminder" on a job: everyone on it who has not confirmed gets one.
async function remindJob(org: string, jobId: string, origin?: string | null): Promise<J> {
  const line = await lineFor(org);
  if (!line) return { ok: false, message: "The company line is not set up yet." };
  const [S, job] = await Promise.all([getDoc(org, "org/settings"), getDoc(org, "jobs/" + jobId)]);
  if (!job) return { ok: false, message: "That job is not available." };
  if (job.test) return { ok: false, message: "Test job: its phone numbers are made up, so nothing is sent." };
  const d = job.d || {};
  if (job.status !== "booked" || !d.moveDate || d.moveDate < today()) return { ok: false, message: "Only upcoming booked jobs need confirming." };
  const crew: string[] = (job.assign && job.assign.crew) || [];
  const no = crew.filter((n) => !isConfirmed(job, n));
  if (!no.length) return { ok: true, message: "Everyone on this job has confirmed." };
  const since = new Date(Date.now() - 10 * 60e3).toISOString();
  const recent = await rest("GET", "comm_log?select=staff&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&purpose=eq.remind&created_at=gte." + q(since));
  const skip = (recent || []).map((r: J) => r.staff);
  const link = appLink(S, origin), C = contacts(S);
  let sent = 0;
  const later: string[] = [];
  for (const n of no) {
    if (skip.indexOf(n) >= 0) { later.push(n); continue; }
    const r = await sendText({ org, line, jobId, purpose: "remind", staff: n, to: C[n],
      body: company(S) + ": Please confirm " + gsm(d.name || "your job") + ", " + when(d) + (link ? ": " + link : ", in Tally under Job messages.") });
    if (r.status !== "failed" && r.status !== "no-number") sent++;
  }
  if (!sent && later.length) return { ok: false, message: gsm(later.join(", ")) + " got a reminder in the last 10 minutes." };
  return { ok: sent > 0, message: sent ? "Reminder texted to " + sent + " " + (sent === 1 ? "person" : "people") + "." : "Nobody could be texted. Check phone numbers in Setup." };
}

// Evening before: each person on tomorrow's jobs gets one text; the office gets who has not confirmed.
export async function runTomorrow(): Promise<J> {
  const lines = await rest("GET", "comm_lines?select=*&enabled=is.true");
  const day = addDay(today());
  const since = new Date(Date.now() - 20 * 3600e3).toISOString();
  const report: J[] = [];
  for (const line of lines || []) {
    const org = line.org_id;
    const S = await getDoc(org, "org/settings");
    if (!alertOn(S, "tomorrow")) { report.push({ org, skipped: "off" }); continue; }
    const rows = await rest("GET", "docs?select=doc_id,data&org_id=eq." + q(org) + "&collection=eq.jobs&" + q("data->d->>moveDate") + "=eq." + q(day));
    const jobs = (rows || []).map((r: J) => ({ id: r.doc_id, job: r.data })).filter((x: J) => x.job && x.job.status === "booked" && !x.job.test)
      .sort((a: J, b: J) => String((a.job.d || {}).time || "") < String((b.job.d || {}).time || "") ? -1 : 1);
    if (!jobs.length) { report.push({ org, jobs: 0 }); continue; }
    const C = contacts(S), co = company(S), link = appLink(S);
    const people: Record<string, J[]> = {};
    jobs.forEach((x: J) => ((x.job.assign && x.job.assign.crew) || []).forEach((n: string) => { (people[n] = people[n] || []).push(x); }));
    const done = await rest("GET", "comm_log?select=staff,purpose&org_id=eq." + q(org) + "&purpose=in.(tomorrow,tomorrow-office)&created_at=gte." + q(since));
    const already = (done || []).map((r: J) => r.purpose + "|" + r.staff);
    let sent = 0;
    for (const n of Object.keys(people)) {
      if (already.indexOf("tomorrow|" + n) >= 0) continue;
      const list = people[n];
      const need = list.some((x: J) => !isConfirmed(x.job, n));
      const items = list.map((x: J) => { const d = x.job.d || {}; return gsm(d.name || "a job") + " at " + fmtTime(d.time) + (d.from ? " (" + gsm(d.from) + ")" : ""); }).join("; ");
      const body = co + ": Tomorrow you're on " + items + "." + (need ? (link ? " Please confirm: " + link : " Please confirm in Tally under Job messages.") : " You're confirmed. See you there.");
      const r = await sendText({ org, line, jobId: list.length === 1 ? list[0].id : undefined, purpose: "tomorrow", staff: n, to: C[n], body: body.slice(0, 600) });
      if (r.status !== "failed" && r.status !== "no-number") sent++;
    }
    const unconf: string[] = [];
    jobs.forEach((x: J) => ((x.job.assign && x.job.assign.crew) || []).forEach((n: string) => { if (!isConfirmed(x.job, n)) unconf.push(n + " (" + ((x.job.d || {}).name || "a job") + ")"); }));
    const noCrew = jobs.filter((x: J) => !((x.job.assign && x.job.assign.crew) || []).length).map((x: J) => (x.job.d || {}).name || "a job");
    const summary = co + ": Tomorrow: " + jobs.length + " job" + (jobs.length === 1 ? "" : "s") + ", " + Object.keys(people).length + " people." +
      (unconf.length ? " Not confirmed yet: " + gsm(unconf.join(", ")) + "." : " Everyone has confirmed.") +
      (noCrew.length ? " No crew yet: " + gsm(noCrew.join(", ")) + "." : "");
    for (const n of officeNames(S)) {
      if (already.indexOf("tomorrow-office|" + n) >= 0 || people[n]) continue;
      await sendText({ org, line, purpose: "tomorrow-office", staff: n, to: C[n], body: summary.slice(0, 600) });
    }
    report.push({ org, jobs: jobs.length, people: Object.keys(people).length, sent });
  }
  return { ok: true, day, report };
}

// Quote screen: driving miles and minutes between two addresses (Google Routes API, Essentials tier).
export async function driveDistance(from: string, to: string): Promise<J> {
  const key = env("GOOGLE_MAPS_KEY");
  if (!key) return { ok: false, setup: true, message: "Distance lookup is not set up yet." };
  const a = String(from || "").trim().slice(0, 200), b = String(to || "").trim().slice(0, 200);
  if (!a || !b) return { ok: false, message: "Enter both addresses." };
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" },
    body: JSON.stringify({ origin: { address: a }, destination: { address: b }, travelMode: "DRIVE" }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = String((out && out.error && out.error.message) || "");
    if (r.status === 400 && /address|location|geocod/i.test(why)) return { ok: false, message: "Google Maps could not find one of those addresses." };
    console.error("routes", r.status, why);
    return { ok: false, message: "Google Maps did not answer (" + r.status + ")." };
  }
  const rt = out && out.routes && out.routes[0];
  if (!rt || rt.distanceMeters == null) return { ok: false, message: "No driving route between those addresses. Check them." };
  const secs = parseInt(String(rt.duration || "0"), 10) || 0;
  return { ok: true, src: "google", miles: Math.round(rt.distanceMeters / 1609.344 * 10) / 10, minutes: Math.round(secs / 60) };
}

async function startCall(org: string, me: J, jobId: string): Promise<J> {
  const line = await lineFor(org);
  if (!line) return { ok: false, message: "The company line is not set up yet." };
  const [S, job] = await Promise.all([getDoc(org, "org/settings"), getDoc(org, "jobs/" + jobId)]);
  if (!job) return { ok: false, message: "That job is not available." };
  if (job.test) return { ok: false, message: "Test job: its phone numbers are made up, so nothing is sent." };
  const office = me.role === "owner" || me.role === "dispatch";
  const onJob = ((job.assign && job.assign.crew) || []).indexOf(me.staff) >= 0;
  if (!office && !onJob) return { ok: false, message: "You can only call customers on your own jobs." };
  const mine = e164(contacts(S)[me.staff]);
  if (!mine) return { ok: false, message: "Add your phone number in Setup first. The company line calls you, then connects you." };
  const cust = e164(job.d && job.d.phone);
  if (!cust) return { ok: false, message: "This job has no customer phone number." };
  const since = new Date(Date.now() - 3600e3).toISOString();
  const recent = await rest("GET", "comm_log?select=id&org_id=eq." + q(org) + "&channel=eq.call&purpose=eq.masked&staff=eq." + q(me.staff) + "&created_at=gte." + q(since) + "&limit=" + (CALLS_PER_HOUR + 1));
  if (recent && recent.length >= CALLS_PER_HOUR) return { ok: false, message: "That's a lot of calls this hour. Try again in a little while." };
  const row = await logRow({
    org_id: org, job_id: jobId, channel: "call", direction: "out", purpose: "masked", staff: me.staff,
    party: (job.d && job.d.name) || "Customer", to_number: cust, from_number: line.phone_number, status: "calling-you",
  });
  try {
    const c = await twilio("Calls", {
      To: mine, From: line.phone_number,
      Url: base() + "/twilio/bridge?log=" + row.id,
      StatusCallback: base() + "/twilio/status?log=" + row.id + "&leg=you",
      StatusCallbackEvent: "completed",
      Timeout: "25",
    });
    await patchLog(row.id, { sid: c.sid || null });
  } catch (e) {
    await patchLog(row.id, { status: "failed", error: String((e as Error).message || e).slice(0, 300) });
    return { ok: false, message: "Could not start the call: " + (e as Error).message };
  }
  return { ok: true, message: "Your phone will ring from the company line. Answer and press 1 to reach " + ((job.d && job.d.name) || "the customer") + "." };
}

/* ---------- truck down (the emergency beacon) ----------
   A crew tapped Truck down in the app. The alert itself is a chat message (k "sos") that the
   office's copies of Tally show at once; these texts reach the office even with the app closed,
   with the truck, who sent it, and a map link to where they are.
   What was texted for an alert is kept in comm_job_state under the key "sos:<alert id>":
     crew       who was texted
     move_date  the hour's slot this alert took (see sosSlot)
     move_time  "sending" while a request is sending them, then "sent"
     forms_at   when the all-clear went out
   and every text is logged with job_id "sos:<alert id>", so asking again never texts anyone twice,
   and a request that died part way is finished by the next one. A request sending them renews its
   claim before each text, so one that is only slow is never taken over, and it stops as soon as
   another request has taken over or the all-clear has gone out. */
const SOS_FRESH_MS = 60 * 60e3;   // texts go out only for an alert sent in the last hour
const SOS_PER_HOUR = 6;           // alerts a company can text about in an hour
const SOS_STUCK_MS = 90e3;        // a "sending" left this long belongs to a request that died
function ownerName(S: J): string {
  const o = ((S && S.office) || []).find((x: J) => x && x.kind === "owner");
  return (o && o.name) || "Owner";
}
// The names a person goes by in Tally. The app calls an owner by the owner's name in Setup, which
// can differ from the staff name on their sign-in (empty to start with, or a profile's name).
function namesOf(me: J, S: J): string[] {
  const out: string[] = me.staff ? [me.staff] : [];
  if (me.role === "owner" && out.indexOf(ownerName(S)) < 0) out.push(ownerName(S));
  return out;
}
export function sosPlace(loc: J): string {
  if (!loc || loc.lat == null || loc.lng == null) return "";
  const lat = Number(loc.lat), lng = Number(loc.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return "";
  const acc = Math.round(Number(loc.acc) || 0);
  return "https://maps.google.com/?q=" + lat.toFixed(5) + "," + lng.toFixed(5) +
    (acc > 0 && acc < 1e6 ? " (within " + (acc >= 1000 ? Math.round(acc / 100) / 10 + " km" : acc + " m") + ")" : "");
}
// The office (owner and dispatch), one text per phone number, never the sender's own.
export function sosPeople(S: J, from: string): string[] {
  const C = contacts(S), mine = e164(C[from]), seen = new Set<string>(), out: string[] = [];
  for (const n of officeNames(S)) {
    const num = e164(C[n]);
    if (n === from || !num || num === mine || seen.has(num)) continue;
    seen.add(num);
    out.push(n);
  }
  return out;
}
// One of the company's emergency-text slots for this hour. Each slot is a row of its own, so two
// alerts at the same moment can't both take the last one. Returns the slot's key, or "" when the
// hour's slots are used up. An alert whose texts all fail gives its slot back (sosFree).
async function sosSlot(org: string): Promise<string> {
  const hour = Math.floor(Date.now() / 3600e3), now = new Date().toISOString();
  await rest("DELETE", "comm_job_state?org_id=eq." + q(org) + "&job_id=like." + q("sosslot:*") + "&updated_at=lt." + q(new Date(Date.now() - 3 * 3600e3).toISOString()));
  for (let n = 0; n < SOS_PER_HOUR; n++) {
    const slot = "sosslot:" + hour + ":" + n;
    const rows = await rest("POST", "comm_job_state?on_conflict=org_id,job_id",
      { org_id: org, job_id: slot, version: 1, updated_at: now }, "resolution=ignore-duplicates,return=representation");
    if (rows && rows.length) return slot;
  }
  return "";
}
async function sosFree(org: string, slot: unknown): Promise<void> {
  if (typeof slot === "string" && slot.indexOf("sosslot:") === 0) await rest("DELETE", "comm_job_state?org_id=eq." + q(org) + "&job_id=eq." + q(slot));
}
// Who this alert's text (or its all-clear) has reached. Only texts Twilio took count: a request
// that died while handing one over leaves a log row without a message id, and that person is
// texted again rather than missed.
// maybe: count a text that was still being handed to Twilio too
async function sosTexted(org: string, key: string, purpose: string, maybe = false): Promise<string[]> {
  const rows = await rest("GET", "comm_log?select=staff,status,sid&org_id=eq." + q(org) + "&job_id=eq." + q(key) + "&purpose=eq." + q(purpose));
  return (rows || []).filter((r: J) => (maybe || r.sid) && r.status !== "failed" && r.status !== "no-number").map((r: J) => String(r.staff || ""));
}
const sosOk = (r: J) => r.status !== "failed" && r.status !== "no-number";

// The all-clear, to whoever got the alert. by: the names of the signed-in person who ended it, when known.
async function sosAllClear(org: string, S: J, a: J, key: string, by: string[]): Promise<J> {
  const prev = await stateOf(org, key);
  if (!prev) return { ok: true, sent: 0, skipped: "none-texted" };
  if (prev.forms_at) return { ok: true, sent: 0, already: true };
  // the request still sending the alert sends the all-clear when it finishes
  const sending = prev.move_time === "sending";
  if (sending && Date.now() - Date.parse(prev.updated_at) < SOS_STUCK_MS) return { ok: true, sent: 0, skipped: "start-in-progress" };
  const line = await lineFor(org);
  if (!line) return { ok: false, reason: "no-line", message: "The company line is not set up, so the all-clear did not go out." };
  // A start that died part way: the all-clear goes to whoever its texts may have reached, a text
  // Twilio was still being handed included (an all-clear too many beats one missing). Claiming
  // the all-clear also stops that start from sending any more.
  const crew: string[] = sending ? await sosTexted(org, key, "sos", true) : (prev.crew || []);
  if (!(await claim(org, key, prev, { crew: prev.crew, move_date: prev.move_date, move_time: prev.move_time, forms_at: new Date().toISOString() }))) {
    return { ok: true, sent: 0, raced: true };
  }
  if (!crew.length) return { ok: true, sent: 0, skipped: "none-texted" };
  return { ok: true, sent: await sosClearSend(org, S, a, key, line, crew.filter((n) => by.indexOf(n) < 0), by) };   // whoever closed it knows already
}
function sosClearBody(S: J, a: J, by: string[]): string {
  const from = String(a.from), co = company(S), at = clockIn(Number(a.ts) || Date.now());
  const truck = gsm(String(a.truck || "")).slice(0, 60) || "The truck";
  const byName = by.indexOf(from) >= 0 ? from : (by.find((n) => officeNames(S).indexOf(n) >= 0) || by[0] || "");
  return byName && byName !== from
    ? co + ": " + gsm(byName).slice(0, 60) + " closed the truck-down alert from " + gsm(from) + (at ? " (sent at " + at + ")" : "") + "."
    : byName
    ? co + ": All clear. " + truck + " is running again, " + gsm(from) + " says. The truck-down alert" + (at ? " from " + at : "") + " is over."
    : co + ": All clear. The truck-down alert from " + gsm(from) + (at ? " (sent at " + at + ")" : "") + " is over.";
}
// The all-clear to each of these people who hasn't had it yet.
async function sosClearSend(org: string, S: J, a: J, key: string, line: J, names: string[], by: string[]): Promise<number> {
  const had = await sosTexted(org, key, "sos-end", true), body = sosClearBody(S, a, by);
  let sent = 0;
  for (const n of names) {
    if (had.indexOf(n) >= 0) continue;
    if (sosOk(await sendText({ org, line, jobId: key, purpose: "sos-end", staff: n, party: String(a.from), to: contacts(S)[n], body }))) sent++;
  }
  return sent;
}
// A start that lost its claim part way. If that was the all-clear going out, the people this
// start texted after the all-clear had worked out who to tell get it too.
async function sosClearAfter(org: string, S: J, msgId: string, key: string, names: string[]): Promise<void> {
  if (!names.length) return;
  const cur = await stateOf(org, key);
  if (!cur || !cur.forms_at) return;
  const [a, line] = await Promise.all([getDoc(org, "chat/" + msgId), lineFor(org)]);
  if (a && a.end && line) await sosClearSend(org, S, a, key, line, names, []);
}

export async function sosText(org: string, me: J, msgId: string, kind: string, clientNow?: unknown): Promise<J> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(msgId)) return { ok: false, message: "Missing alert", status: 400 };
  if (kind !== "start" && kind !== "end") return { ok: false, message: "Unknown step", status: 400 };
  const [S, a] = await Promise.all([getDoc(org, "org/settings"), getDoc(org, "chat/" + msgId)]);
  if (!a || a.k !== "sos" || typeof a.from !== "string" || !a.from) return { ok: false, message: "That alert is not available." };
  const names = namesOf(me, S), mine = names.indexOf(a.from) >= 0, office = me.role === "owner" || me.role === "dispatch";
  const key = "sos:" + msgId, from = a.from, C = contacts(S);

  if (kind === "end") {
    if (!a.end) return { ok: false, message: "That alert is still on." };
    if (!(mine || office)) return { ok: false, message: "Only the person who sent the alert, or the office, can end it.", status: 403 };
    return await sosAllClear(org, S, a, key, names);
  }

  if (!mine) return { ok: false, message: "Only the person who sent an alert can text about it.", status: 403 };
  if (a.end) return { ok: true, sent: 0, skipped: "ended" };
  // how old the alert is, by the clock of the phone that sent it (it may not agree with ours)
  const cn = Number(clientNow), age = (isFinite(cn) && cn > 0 ? cn : Date.now()) - Number(a.ts);
  if (!(age > -120e3 && age < SOS_FRESH_MS)) return { ok: false, message: "That alert is too old to text about." };
  const line = await lineFor(org);
  if (!line) return { ok: false, reason: "no-line", message: "The company line is not set up, so no texts went out." };
  // a crew trying it out on a test job: the office sees the alert in Tally, but nobody is texted
  if (a.jobId && /^[A-Za-z0-9_-]{1,40}$/.test(String(a.jobId))) {
    const j = await getDoc(org, "jobs/" + a.jobId);
    if (j && j.test) return { ok: true, sent: 0, skipped: "test", names: [] };
  }
  const to = sosPeople(S, from);
  let prev = await stateOf(org, key);
  if (prev && prev.move_time !== "sending") return { ok: true, sent: 0, already: true, names: prev.crew || [] };
  if (prev && Date.now() - Date.parse(prev.updated_at) < SOS_STUCK_MS) return { ok: true, sent: 0, pending: true };
  if (!prev) {
    const slot = await sosSlot(org);
    if (!slot) return { ok: false, reason: "limit", message: "There have been a lot of truck-down alerts this hour." };
    // numbered from the clock rather than 1, so a claim made after an earlier one was let go never
    // shares a number a request still holding the old one could renew
    if (!(await claim(org, key, null, { crew: to, move_date: slot, move_time: "sending", version: Math.floor(Date.now() / 1000) }))) {
      await sosFree(org, slot);   // another request got this alert first, with a slot of its own
      return { ok: true, sent: 0, pending: true };
    }
  } else if (!(await claim(org, key, prev, { crew: to, move_date: prev.move_date, move_time: "sending" }))) {
    return { ok: true, sent: 0, pending: true };   // another request is finishing the stuck one
  }
  prev = await stateOf(org, key);
  if (!prev) return { ok: true, sent: 0, pending: true };
  const slot = prev.move_date;
  let ver = Number(prev.version);

  const truck = gsm(String(a.truck || "")).slice(0, 60), job = gsm(String(a.job || "")).slice(0, 60);
  const note = gsm(String(a.text || "")).slice(0, 160), place = sosPlace(a.loc), link = appLink(S, null, "sos"), num = e164(C[from]);
  const at = clockIn(Number(a.ts) || Date.now());
  const body = company(S) + " TRUCK DOWN: " + (truck || "A truck") + " is down. Sent by " + gsm(from) + (at ? " at " + at : "") +
    (job ? ", on the " + job + " job" : "") + "." +
    (note ? ' "' + note + '"' : "") +
    (place ? " Location: " + place + "." : " No location yet.") +
    (num ? " Call " + gsm(from) + ": " + num + "." : "") +
    (link ? " Live in Tally: " + link : "");
  const got: string[] = [];
  let sent = 0;
  for (const n of to) {
    // the log, read again for each person: whoever a stuck request already texted is not texted twice
    if ((await sosTexted(org, key, "sos")).indexOf(n) >= 0) { got.push(n); continue; }
    // renew the claim, and stop if a newer request took over or the all-clear went out
    if (!(await claim(org, key, { version: ver }, { crew: to, move_date: slot, move_time: "sending" }))) {
      await sosClearAfter(org, S, msgId, key, got);
      return { ok: true, sent, pending: true };
    }
    ver++;
    if (sosOk(await sendText({ org, line, jobId: key, purpose: "sos", staff: n, party: from, to: C[n], body }))) { got.push(n); sent++; }
  }
  if (to.length && !got.length) {
    // nothing went out: let go of the claim and the hour's slot, so trying again really sends them
    const gone = await rest("DELETE", "comm_job_state?org_id=eq." + q(org) + "&job_id=eq." + q(key) + "&version=eq." + ver, undefined, "return=representation");
    if (gone && gone.length) await sosFree(org, slot);
    return { ok: false, reason: "failed", message: "The texts did not go out." };
  }
  if (!(await claim(org, key, { version: ver }, { crew: got, move_date: slot, move_time: "sent" }))) {
    await sosClearAfter(org, S, msgId, key, got);
    return { ok: true, sent, pending: true };
  }
  // ended while the texts were going out: the all-clear follows them
  const a2 = await getDoc(org, "chat/" + msgId);
  if (a2 && a2.end) await sosAllClear(org, S, a2, key, []);
  return to.length ? { ok: true, sent, names: got } : { ok: true, sent: 0, names: [], reason: "no-numbers" };
}

/* ---------- card payments (Stripe) ----------
   Three ways to pay, all started from the app and all ending in the same place:
   - a pay link: a Stripe page the customer opens from a text or a QR code (/p/<code>)
   - a card typed into the app (Stripe's own card box; card numbers never touch Tally)
   - a card kept on file earlier, charged again for the rest of the bill
   Stripe tells this function when money moves (POST /stripe), and the function writes the payment
   onto the job, keeps a ledger (pay_log) and keeps the cards customers agreed to keep on file
   (pay_cards; the app only ever sees a card's brand, last four, expiry and name).
   What is still owed is always worked out here, from the job and the ledger, never from the app.
   One payment starts on a job at a time (pay_locks), and before it starts the job is brought up to
   date with Stripe, so two phones, or a phone and a pay link, can't take the same money twice.
   A pay link is not one Stripe page: when it is opened it asks for what is owed right then, so a bill
   settled in cash, or lowered, can't be paid again from an old text. */
export const STRIPE_VERSION = "2026-09-30.endive";
export const PAY_EVENTS = ["payment_intent.succeeded", "payment_intent.processing", "payment_intent.payment_failed",
  "payment_intent.canceled", "checkout.session.completed", "checkout.session.expired", "charge.refunded",
  "charge.refund.updated", "charge.dispute.created", "charge.dispute.closed", "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated"];
const PAY_PER_HOUR = 40;
const MIN_CENTS = 50;
const LINK_DAYS = 7;            // how long a pay link works
const PAGE_HOURS = 23;          // how long one Stripe page behind it works (Stripe allows a day at most)
const LOCK_MS = 30e3;           // one payment starting per job; the lock lets go by itself after this
const STALE_MS = 15 * 60e3;     // a card payment started and not finished in this long is abandoned
const BUSY = "Another payment is starting on this job. Try again in a moment.";
const PAYING = "A pay link for this job is being paid right now. Check the bill in a minute.";
const nowIso = () => new Date().toISOString();

export function stripeMode(): "" | "test" | "live" {
  const k = env("STRIPE_SECRET_KEY");
  if (/^(sk|rk)_live_/.test(k)) return "live";
  if (/^(sk|rk)_test_/.test(k)) return "test";
  return "";
}
const liveNow = () => stripeMode() === "live";
function publishableKey(): string {
  const pk = env("STRIPE_PUBLISHABLE_KEY"), m = stripeMode();
  return m && pk.indexOf("pk_" + m + "_") === 0 ? pk : "";
}
// Stripe takes form fields: a[b][c]=v, and lists as a[0]=x.
export function stripeForm(obj: J, pre = "", out: URLSearchParams = new URLSearchParams()): URLSearchParams {
  for (const k of Object.keys(obj || {})) {
    const v = obj[k], key = pre ? pre + "[" + k + "]" : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((x, i) => { if (x && typeof x === "object") stripeForm(x, key + "[" + i + "]", out); else out.append(key + "[" + i + "]", String(x)); });
    } else if (typeof v === "object") stripeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
class StripeError extends Error {
  status: number; err: J;
  constructor(status: number, err: J) { super((err && err.message) || "Stripe error " + status); this.status = status; this.err = err || {}; }
}
async function stripe(method: string, path: string, params?: J, idem?: string): Promise<J> {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new StripeError(0, { message: "Stripe is not set up yet." });
  const headers: Record<string, string> = { Authorization: "Bearer " + key, "Stripe-Version": STRIPE_VERSION };
  let url = "https://api.stripe.com/v1/" + path, body: string | undefined;
  if (params) {
    const f = stripeForm(params).toString();
    if (method === "GET") url += (url.indexOf("?") >= 0 ? "&" : "?") + f;
    else { body = f; headers["Content-Type"] = "application/x-www-form-urlencoded"; }
  }
  if (idem) headers["Idempotency-Key"] = idem;
  const r = await fetch(url, { method, headers, body });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new StripeError(r.status, out && out.error);
  return out;
}
// Stripe answered no to this request (as opposed to Stripe or the network being in trouble)
function stripeNo(e: unknown): boolean { return e instanceof StripeError && e.status >= 400 && e.status < 500; }
// What a person sees when Stripe says no. Never includes a key.
function stripeTrouble(e: unknown): string {
  if (!(e instanceof StripeError)) return "Something went wrong on the server.";
  if (e.status === 401) return "Stripe did not accept the key. Check STRIPE_SECRET_KEY in Supabase.";
  if (e.status === 403) return "The Stripe key is missing a permission. See the payments setup guide.";
  return "Stripe said: " + String(e.message || "no reason given").slice(0, 200);
}
const DECLINES: J = {
  insufficient_funds: "not enough money on the card", expired_card: "the card has expired",
  incorrect_cvc: "the security code is wrong", incorrect_number: "the card number is wrong",
  lost_card: "the card was reported lost", stolen_card: "the card was reported stolen",
  card_velocity_exceeded: "the card is over its limit", processing_error: "a processing error; try again",
};

/* money, worked out the same way the app does it */
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);
function vals(m: J): J[] { return m && typeof m === "object" ? (Array.isArray(m) ? m : Object.values(m)) : []; }
export function jobTotalCents(job: J): number {
  const mats = r2(vals(job.materials).reduce((a: number, m: J) => a + (m && m.price != null ? (Number(m.qty) || 0) * (Number(m.price) || 0) : 0), 0));
  const ex = vals(job.extras).reduce((a: number, e: J) => a + (Number(e && e.amt) || 0), 0);
  return Math.round(r2((Number(job.quote && job.quote.total) || 0) + ex + mats) * 100);
}
function paidCents(payments: J): number {
  return Math.round(r2(vals(payments).reduce((a: number, p: J) => a + (Number(p && p.amt) || 0), 0)) * 100);
}
// In live mode, money from Stripe's test mode doesn't count: test payments made while trying Tally out.
function counts(live: unknown): boolean { return !liveNow() || live !== false; }
const netCents = (r: J) => (Number(r.amount_cents) || 0) - (Number(r.refunded_cents) || 0) - (Number(r.disputed_cents) || 0);
// Paid so far: the job's own payments, except that a Stripe payment counts from the ledger (less any
// refund or dispute), so one that a phone's save happened to overwrite is still counted and can't be
// charged again.
function paidWithLedger(job: J, ledger: J[]): number {
  const L: J = {};
  (ledger || []).forEach((r: J) => { L[r.pi] = r; });
  let paid = 0;
  vals(job.payments).forEach((p: J) => {
    if (!p || (p.stripe && (L[p.stripe] || !counts(p.live)))) return;
    // only the server takes money off a bill (a refund, a dispute), and it counts those from the ledger:
    // a "payment" of zero or less written by a phone is ignored, so nobody can raise what is owed that way
    const c = cents(p.amt);
    if (c > 0) paid += c;
  });
  Object.keys(L).forEach((k) => {
    const r = L[k];
    if ((r.status === "succeeded" || r.status === "processing") && counts(r.livemode)) paid += netCents(r);
  });
  return paid;
}
async function ledgerFor(org: string, jobId: string): Promise<J[]> {
  return (await rest("GET", "pay_log?select=pi,amount_cents,refunded_cents,disputed_cents,status,livemode,source&org_id=eq." + q(org) + "&job_id=eq." + q(jobId))) || [];
}
// What is left to pay: below zero when more was paid than the bill.
async function balanceCents(org: string, jobId: string, job?: J): Promise<number> {
  const j = job || await getDoc(org, "jobs/" + jobId);
  if (!j) return 0;
  return jobTotalCents(j) - paidWithLedger(j, await ledgerFor(org, jobId));
}
export async function owedCents(org: string, jobId: string, job?: J): Promise<number> {
  return Math.max(0, await balanceCents(org, jobId, job));
}
export function money(c: number): string {
  return (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// the same history keys and customer keys the app makes
function strHash(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function logKey(ts: number, ev: string): string { return "l" + ts.toString(36) + "_" + strHash(ev); }
export function custKeyOf(job: J): string {
  const d = (job && job.d) || {};
  const digits = String(d.phone || "").replace(/\D/g, "");
  return digits || String(d.name || "").trim().toLowerCase();
}
// Who the customer is to Stripe: their phone number or, without one, this job alone. A name is not
// enough, because two customers with the same name must never share a Stripe customer or its cards.
export function payKeyOf(job: J, jobId: string): string {
  const digits = String(((job && job.d) || {}).phone || "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : "job:" + jobId;
}
function validEmail(s: unknown): string {
  const v = String(s || "").trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 200 ? v : "";
}
function randToken(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => abc[x % abc.length]).join("");
}
async function sha(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
const BRANDS: J = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };
export function methodLabel(pm: J): string {
  if (!pm || typeof pm !== "object") return "Card";
  if (pm.type === "card" && pm.card) {
    const c = pm.card, base = (BRANDS[c.brand] || "Card") + " ••" + (c.last4 || "");
    const w = c.wallet && c.wallet.type;
    return w === "apple_pay" ? "Apple Pay (" + base + ")" : w === "google_pay" ? "Google Pay (" + base + ")" : base;
  }
  if (pm.type === "us_bank_account" && pm.us_bank_account) return "Bank ••" + (pm.us_bank_account.last4 || "");
  const names: J = { link: "Link", cashapp: "Cash App Pay", affirm: "Affirm", klarna: "Klarna", afterpay_clearpay: "Afterpay", paypal: "PayPal", amazon_pay: "Amazon Pay" };
  return names[pm.type] || String(pm.type || "Card");
}

/* who may take payments, and on which company */
// the name a payment is filed under: the person's staff name, or their role when they have none
function who(me: J): string { return String((me && me.staff) || "#" + ((me && me.role) || "staff")).slice(0, 200); }
function canTakePay(me: J, job: J): boolean {
  if (me.role === "owner" || me.role === "dispatch") return true;
  return me.role === "lead" && ((job.assign && job.assign.crew) || []).indexOf(me.staff) >= 0;
}
async function payOrgOn(org: string): Promise<boolean> {
  const rows = await rest("GET", "pay_orgs?select=enabled&org_id=eq." + q(org) + "&limit=1");
  return !!(rows && rows[0] && rows[0].enabled);
}
const orgsSeen = new Set<string>();
async function orgExists(org: string): Promise<boolean> {
  if (orgsSeen.has(org)) return true;
  const rows = await rest("GET", "orgs?select=id&id=eq." + q(org) + "&limit=1");
  if (rows && rows[0]) orgsSeen.add(org);
  return orgsSeen.has(org);
}
async function tooManyPays(org: string, by: string): Promise<boolean> {
  const since = new Date(Date.now() - 3600e3).toISOString(), lim = "&limit=" + (PAY_PER_HOUR + 1);
  const a = await rest("GET", "pay_log?select=pi&org_id=eq." + q(org) + "&by_staff=eq." + q(by) + "&created_at=gte." + q(since) + lim);
  const b = await rest("GET", "pay_links?select=token&org_id=eq." + q(org) + "&created_by=eq." + q(by) + "&created_at=gte." + q(since) + lim);
  return (a || []).length + (b || []).length >= PAY_PER_HOUR;
}
const TOO_MANY = "That's a lot of payments this hour. Try again in a little while.";
// Everything a payment needs checked before it starts. Returns {err, status?} or {S, job}.
async function payContext(org: string, me: J, jobId: string): Promise<J> {
  if (!stripeMode()) return { err: "Card payments are not set up yet." };
  if (!(await payOrgOn(org))) return { err: "Card payments are not turned on for this company yet." };
  const [S, job] = await Promise.all([getDoc(org, "org/settings"), getDoc(org, "jobs/" + jobId)]);
  if (!job) return { err: "That job is not available." };
  if (!canTakePay(me, job)) {
    return { status: 403, err: me.role === "lead" ? "You can only take payments on your own jobs." : "Crew leads and the office take payments." };
  }
  if (job.test && liveNow()) return { err: "Test job: no real charges." };
  if (job.status === "lost") return { err: "This job is marked lost." };
  if ((job.status === "active" || job.status === "done") && pendingForms(S, job).length) return { err: "The customer signs the required forms first." };
  return { S, job };
}
// `reserved` is a card payment someone else on this job is in the middle of.
function amountTrouble(c: number, owed: number, reserved = 0): string {
  if (!(c > 0)) return "Enter an amount.";
  if (owed <= 0) return "Nothing is owed on this job.";
  if (c > owed) return "That is more than the " + money(owed) + " still owed.";
  if (c > owed - reserved) return "Another payment of " + money(reserved) + " on this job was started a moment ago. Wait a minute, then check the bill.";
  if (c < MIN_CENTS) return "Card payments start at " + money(MIN_CENTS) + ".";
  return "";
}
function payMeta(org: string, jobId: string, job: J, by: string, src: string, uid?: string): J {
  const md: J = { tally_org: org, tally_job: jobId, tally_cust: payKeyOf(job, jobId).slice(0, 400), tally_by: String(by || "").slice(0, 200), tally_src: src };
  if (uid) md.tally_uid = String(uid).slice(0, 64);
  return md;
}
function payWhat(S: J, job: J): string {
  const d = job.d || {};
  return (company(S) + " - " + gsm(d.name || "Moving job") + (d.moveDate ? " - " + d.moveDate : "")).slice(0, 300);
}

/* one payment starting per job at a time */
async function lockJob(org: string, jobId: string): Promise<string> {
  const until = new Date(Date.now() + LOCK_MS).toISOString();
  const got = await rest("POST", "pay_locks?on_conflict=org_id,job_id", { org_id: org, job_id: jobId, until }, "resolution=ignore-duplicates,return=representation");
  if (got && got.length) return until;
  // a lock whose time ran out (a request that died holding it) is taken over
  const late = await rest("PATCH", "pay_locks?org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&until=lt." + q(nowIso()), { until }, "return=representation");
  return late && late.length ? until : "";
}
// Runs fn holding the job's lock, waiting up to waitMs for it. Null when the job stayed busy.
async function withJobLock<T>(org: string, jobId: string, fn: () => Promise<T>, waitMs = 5000): Promise<T | null> {
  const end = Date.now() + waitMs;
  let until = await lockJob(org, jobId);
  while (!until && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));
    until = await lockJob(org, jobId);
  }
  if (!until) return null;
  try {
    return await fn();
  } finally {
    await rest("DELETE", "pay_locks?org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&until=eq." + q(until)).catch(() => {});
  }
}

/* the server's own webhook: made once per mode (test, live), the first time it is needed */
async function webhookSecrets(): Promise<string[]> {
  const out: string[] = [];
  if (env("STRIPE_WEBHOOK_SECRET")) out.push(env("STRIPE_WEBHOOK_SECRET"));
  const rows = await rest("GET", "pay_config?select=webhook_secret,status");
  (rows || []).forEach((r: J) => { if (r.status === "ready" && r.webhook_secret) out.push(r.webhook_secret); });
  return out;
}
export async function ensureWebhook(): Promise<J> {
  if (env("STRIPE_WEBHOOK_SECRET")) return { ok: true };
  const mode = stripeMode();
  if (!mode) return { ok: false, message: "Card payments are not set up yet." };
  const events = PAY_EVENTS.join(",");
  const rows = await rest("GET", "pay_config?select=*&mode=eq." + mode + "&limit=1");
  const row = rows && rows[0];
  if (row && row.status === "ready" && row.webhook_secret) {
    // every few hours, and after an update that listens for more events, check the webhook is still there
    // and current (someone may have deleted or switched it off in Stripe)
    if (row.events === events && Date.now() - Date.parse(row.updated_at) < 6 * 3600e3) return { ok: true };
    let gone = false;
    try {
      const w = await stripe("GET", "webhook_endpoints/" + row.webhook_id);
      gone = !w || w.status === "disabled" || w.url !== base() + "/stripe";
      if (!gone && (w.enabled_events || []).slice().sort().join(",") !== PAY_EVENTS.slice().sort().join(",")) {
        await stripe("POST", "webhook_endpoints/" + row.webhook_id, { enabled_events: PAY_EVENTS });
      }
    } catch (e) {
      if (!(e instanceof StripeError && e.status === 404)) { console.error("stripe webhook check", e); return { ok: true }; }
      gone = true;
    }
    if (!gone) {
      await rest("PATCH", "pay_config?mode=eq." + mode, { events, updated_at: nowIso() });
      return { ok: true };
    }
  }
  const busy = { ok: false, message: "Card payments are being switched on. Try again in a minute." };
  if (row && Date.now() - Date.parse(row.updated_at) < 60e3) return busy;
  // claim the job of making it, so two phones starting payments at once don't make two webhooks
  const now = nowIso();
  const claimed = row
    ? await rest("PATCH", "pay_config?mode=eq." + mode + "&updated_at=eq." + q(row.updated_at), { status: "creating", updated_at: now }, "return=representation")
    : await rest("POST", "pay_config?on_conflict=mode", { mode, status: "creating", updated_at: now }, "resolution=ignore-duplicates,return=representation");
  if (!claimed || !claimed.length) return busy;
  try {
    const url = base() + "/stripe";
    const list = await stripe("GET", "webhook_endpoints", { limit: 100 });
    for (const w of (list && list.data) || []) if (w && w.url === url) await stripe("DELETE", "webhook_endpoints/" + w.id);
    const w = await stripe("POST", "webhook_endpoints", { url, enabled_events: PAY_EVENTS, api_version: STRIPE_VERSION, description: "Tally payments" });
    if (!w || !w.secret) throw new StripeError(0, { message: "Stripe did not return a webhook secret" });
    await rest("PATCH", "pay_config?mode=eq." + mode, { webhook_id: w.id, webhook_secret: w.secret, status: "ready", events, updated_at: nowIso() });
    return { ok: true, created: true };
  } catch (e) {
    console.error("stripe webhook setup", e);
    await rest("PATCH", "pay_config?mode=eq." + mode, { status: "creating", updated_at: new Date(0).toISOString() });
    return { ok: false, message: "Could not finish switching on card payments. " + stripeTrouble(e) };
  }
}
export async function stripeSignature(raw: string, secret: string, t: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + raw)));
  return Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function stripeSigOk(raw: string, header: string, secrets: string[], now = Date.now()): Promise<boolean> {
  let t = "";
  const v1: string[] = [];
  String(header || "").split(",").forEach((p) => {
    const i = p.indexOf("=");
    if (i < 0) return;
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    if (k === "t") t = v; else if (k === "v1") v1.push(v);
  });
  if (!/^\d{9,11}$/.test(t) || !v1.length || Math.abs(now / 1000 - Number(t)) > 300) return false;
  for (const s of secrets) {
    const want = await stripeSignature(raw, s, t);
    if (v1.some((x) => same(x, want))) return true;
  }
  return false;
}

/* the Stripe customer behind a Tally customer (one per company, per test/live) */
async function customerFor(org: string, job: J, jobId: string): Promise<string> {
  const key = payKeyOf(job, jobId), live = liveNow();
  const find = () => rest("GET", "pay_customers?select=customer_id&org_id=eq." + q(org) + "&cust_key=eq." + q(key) + "&livemode=eq." + live + "&limit=1");
  const rows = await find();
  if (rows && rows[0]) return rows[0].customer_id;
  const d = job.d || {};
  const c = await stripe("POST", "customers", {
    name: String(d.name || "").trim().slice(0, 200) || undefined, phone: e164(d.phone) || undefined,
    email: validEmail(d.email) || undefined, metadata: { tally_org: org, tally_cust: key.slice(0, 400) },
  });
  await rest("POST", "pay_customers?on_conflict=org_id,cust_key,livemode", { org_id: org, cust_key: key, customer_id: c.id, livemode: live }, "resolution=ignore-duplicates");
  const again = await find();
  return (again && again[0] && again[0].customer_id) || c.id;
}
// The Stripe customer a job's payments go to. The job's first payment that goes through fixes it (see
// recordIntent), so a name or phone changed afterwards can't point the job at someone else's cards.
async function jobCustomer(org: string, jobId: string, job: J): Promise<J> {
  const live = liveNow();
  const row = ((await rest("GET", "pay_jobs?select=cust_key,customer_id&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&livemode=eq." + live + "&limit=1")) || [])[0];
  if (row) return { customer: row.customer_id, key: row.cust_key, bound: true };
  return { customer: await customerFor(org, job, jobId), key: payKeyOf(job, jobId), bound: false };
}

/* cards kept on file: the server keeps which Stripe card each is (pay_cards); the app's list shows the
   brand, last four, expiry and the name on the card, and the jobs it was kept on */
// the app knows a card by a name of our own, never by Stripe's ids
export async function cardId(pmId: string): Promise<string> { return "st_" + (await sha("card|" + pmId)).slice(0, 20); }
async function saveCard(org: string, md: J, pi: J, pm: J, jobId: string): Promise<void> {
  if (!pm || pm.type !== "card" || !pm.card || !pm.customer) return;
  const opt = pi.payment_method_options && pi.payment_method_options.card;
  if ((pi.setup_future_usage || (opt && opt.setup_future_usage)) !== "off_session") return;
  const cust = String(md.tally_cust || "");
  if (!cust) return;
  const card = pm.card, id = await cardId(pm.id), live = !!pi.livemode, fp = String(card.fingerprint || "");
  // kept already: this payment was written down before (a refund, a second message), or the card was
  // taken off the list since, which this must not undo
  if (((await rest("GET", "pay_cards?select=id&id=eq." + q(id) + "&limit=1")) || []).length) return;
  const customer = typeof pm.customer === "string" ? pm.customer : pm.customer.id;
  const name = String((pm.billing_details && pm.billing_details.name) || "").trim().slice(0, 120);
  const ts = (Number(pm.created) || Number(pi.created) || 0) * 1000 || Date.now();
  // the same card kept before (an earlier deposit, say) shows once on the list, as its newest entry
  const dupes = fp ? (await rest("GET", "pay_cards?select=id,job_id&org_id=eq." + q(org) + "&customer_id=eq." + q(customer) + "&fingerprint=eq." + q(fp) + "&livemode=eq." + live)) || [] : [];
  const docs = await Promise.all(dupes.map((r: J) => getDoc(org, "vault/" + r.id)));
  const jobs = Array.from(new Set([jobId].concat(dupes.map((r: J) => String(r.job_id || "")).filter(Boolean)))).slice(0, 20);
  const newer = docs.find((d: J) => d && Number(d.ts) > ts);
  if (newer) {
    await rest("POST", "docs?on_conflict=org_id,path", { org_id: org, path: "vault/" + newer.id, collection: "vault", doc_id: newer.id, data: { ...newer, jobs }, updated_at: nowIso() }, "resolution=merge-duplicates");
  } else {
    const exp = card.exp_month && card.exp_year ? String(card.exp_month).padStart(2, "0") + "/" + String(card.exp_year).slice(-2) : "";
    const data = { id, cust, type: "card", brand: BRANDS[card.brand] || "Card", last4: String(card.last4 || ""), exp, name, jobs, via: "stripe", live, ts };
    await rest("POST", "docs?on_conflict=org_id,path", { org_id: org, path: "vault/" + id, collection: "vault", doc_id: id, data, updated_at: nowIso() }, "resolution=merge-duplicates");
  }
  await rest("POST", "pay_cards?on_conflict=id", { id, org_id: org, cust_key: cust, customer_id: customer, pm_id: pm.id, fingerprint: fp, name, job_id: jobId, livemode: live }, "resolution=merge-duplicates");
  if (!newer) for (const r of dupes) if (r.id !== id) await rest("DELETE", "docs?org_id=eq." + q(org) + "&path=eq." + q("vault/" + r.id));
}

/* writing a payment down */
const WITHHELD = ["needs_response", "under_review", "lost"];   // disputes where Stripe has taken the money back
async function disputeOf(pid: string): Promise<J> {
  const list = await stripe("GET", "disputes", { payment_intent: pid, limit: 10 });
  let c = 0, lost = false;
  for (const d of (list && list.data) || []) {
    if (WITHHELD.indexOf(d.status) < 0) continue;
    c += Number(d.amount) || 0;
    if (d.status === "lost") lost = true;
  }
  return { cents: c, lost };
}
function sameEntry(a: J, b: J): boolean {
  return !!a && Number(a.amt) === Number(b.amt) && !!a.pending === !!b.pending && a.method === b.method;
}
// The one place a Stripe payment is written down: the ledger; the job (the payment, and any refund or
// dispute as its own line taking money off); the card, when the customer agreed to keep it on file.
// Safe to call any number of times for the same payment, in any order.
export async function recordIntent(pi0: J): Promise<J> {
  let pi = pi0 || {};
  if (!pi.id || !/^pi_[A-Za-z0-9_]+$/.test(String(pi.id))) return { ok: false, skipped: "no-intent" };
  const whole = pi.metadata && pi.payment_method !== undefined && typeof pi.payment_method !== "string" &&
    pi.latest_charge !== undefined && typeof pi.latest_charge !== "string";
  if (!whole) pi = await stripe("GET", "payment_intents/" + pi.id, { expand: ["payment_method", "latest_charge"] });
  const md = pi.metadata || {};
  const org = String(md.tally_org || ""), jobId = String(md.tally_job || "");
  if (!/^[0-9A-Fa-f-]{36}$/.test(org) || !/^[A-Za-z0-9_-]{1,40}$/.test(jobId)) return { ok: false, skipped: "not-tally" };
  if (!(await orgExists(org))) return { ok: false, skipped: "no-company" };
  const pm = pi.payment_method && typeof pi.payment_method === "object" ? pi.payment_method : null;
  const ch = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const status = String(pi.status || ""), live = !!pi.livemode, paidNow = status === "succeeded" || status === "processing";
  const label = methodLabel(pm) + (md.tally_src === "link" ? " (pay link)" : "") + (live ? "" : " · test");
  const amtC = status === "succeeded" ? (Number(pi.amount_received) || Number(pi.amount) || 0) : (Number(pi.amount) || 0);
  const refunded = paidNow && ch ? Math.min(amtC, Number(ch.amount_refunded) || 0) : 0;
  const dispute = paidNow && ch && ch.disputed ? await disputeOf(pi.id) : { cents: 0, lost: false };
  const disputed = Math.min(amtC - refunded, dispute.cents);
  const err = pi.last_payment_error ? String(pi.last_payment_error.message || pi.last_payment_error.code || "").slice(0, 300) : null;
  await rest("POST", "pay_log?on_conflict=pi", {
    pi: pi.id, org_id: org, job_id: jobId, amount_cents: amtC, refunded_cents: refunded, disputed_cents: disputed, status,
    source: String(md.tally_src || ""), method: label, cust_key: String(md.tally_cust || ""), by_staff: String(md.tally_by || ""),
    livemode: live, error: err, updated_at: nowIso(),
  }, "resolution=merge-duplicates");
  const cus = typeof pi.customer === "string" ? pi.customer : pi.customer && pi.customer.id;
  if (paidNow && cus) {
    await rest("POST", "pay_jobs?on_conflict=org_id,job_id,livemode", { org_id: org, job_id: jobId, livemode: live, cust_key: String(md.tally_cust || ""), customer_id: cus }, "resolution=ignore-duplicates");
  }
  const job = await getDoc(org, "jobs/" + jobId);
  if (!job) return { ok: false, reason: "no-job" };
  const pays = job.payments || {}, day = today(), now = Date.now();
  const changes: [string, J, string][] = [];
  const pid = "st_" + pi.id, have = pays[pid];
  if (paidNow) {
    const entry: J = { id: pid, amt: amtC / 100, method: label, date: (have && have.date) || day, ts: (have && have.ts) || now, stripe: pi.id, by: String(md.tally_by || ""), live };
    if (status === "processing") entry.pending = true;
    if (!sameEntry(have, entry)) {
      changes.push([pid, entry, (have && have.pending && !entry.pending ? "Bank payment cleared " : have ? "Payment updated " : "Payment ") + money(amtC) + " (" + label + ")"]);
    }
  } else if (have && (status === "requires_payment_method" || status === "canceled")) {
    changes.push([pid, null, "Payment of " + money(cents(have.amt)) + " did not go through (" + label + ")"]);
  }
  // a refund or a dispute is its own line on the bill, taking money off
  const side = (key: string, c: number, method: string, added: string, gone: string) => {
    const id = key + pi.id, h = pays[id];
    if (c > 0) {
      const e: J = { id, amt: -c / 100, method, date: (h && h.date) || day, ts: (h && h.ts) || now, stripe: pi.id, live };
      if (!sameEntry(h, e)) changes.push([id, e, added]);
    } else if (h) changes.push([id, null, gone]);
  };
  const rf = pays["rf_" + pi.id], dp = pays["dp_" + pi.id];
  side("rf_", refunded, "Refund · " + label,
    "Refunded " + money(refunded) + " of the " + money(amtC) + " payment (" + label + ")",
    "The refund of " + money(Math.abs(cents(rf && rf.amt))) + " did not go through (" + label + ")");
  side("dp_", disputed, (dispute.lost ? "Dispute lost · " : "Disputed · ") + label,
    dispute.lost ? "Dispute lost: the bank gave " + money(disputed) + " back to the customer (" + label + ")"
      : "The customer disputed the " + money(amtC) + " payment (" + label + "). Stripe holds " + money(disputed) + " until the bank decides",
    "Dispute closed: the " + money(Math.abs(cents(dp && dp.amt))) + " Stripe held came back (" + label + ")");
  if (!changes.length) {
    if (status === "succeeded") await saveCard(org, md, pi, pm, jobId);
    return { ok: true, org, job: jobId, recorded: false, status, label, amount: amtC / 100, owed: await owedCents(org, jobId, job) };
  }
  // the bill once these are on it
  const after = { ...pays };
  changes.forEach(([id, e]) => { if (e) after[id] = e; else delete after[id]; });
  const bal = jobTotalCents(job) - paidWithLedger({ ...job, payments: after }, await ledgerFor(org, jobId));
  const less = paidCents(after) < paidCents(pays);
  for (let i = 0; i < changes.length; i++) {
    const [id, e, ev0] = changes[i], last = i === changes.length - 1;
    const ev = ev0 + (last && bal < 0 && !less ? ". That's " + money(-bal) + " more than the bill: refund the difference in Stripe if it was a mistake" : "");
    const ts = now + i;
    await rest("POST", "rpc/pay_record", { o: org, job: jobId, pay_id: id, payment: e, log_key: logKey(ts, ev), log_entry: { ts, ev }, mark_paid: last && bal <= 0 });
  }
  // money came off a Paid job (a bank payment bounced, a refund, a dispute): it is owed again
  if (less && bal > 0 && job.status === "paid") {
    const ts = now + changes.length, ev = "Back to Complete: " + money(bal) + " is owed again";
    await rest("POST", "rpc/pay_reopen", { o: org, job: jobId, log_key: logKey(ts, ev), log_entry: { ts, ev } });
  }
  if (status === "succeeded") await saveCard(org, md, pi, pm, jobId);
  return { ok: true, org, job: jobId, recorded: true, status, label, amount: amtC / 100, owed: Math.max(0, bal) };
}
// A card payment that was started and never finished: cancelled, so it can't be finished later on top of
// another payment.
async function cancelIntent(pi: J): Promise<void> {
  try {
    await recordIntent(await stripe("POST", "payment_intents/" + pi.id + "/cancel", { cancellation_reason: "abandoned", expand: ["payment_method", "latest_charge"] }));
  } catch (e) {
    if (!stripeNo(e)) throw e;
    await recordIntent({ id: pi.id });   // it moved on (paid, or already cancelled): write down where it is now
  }
}
// Ledger payments that are missing from the job (a phone's save got there first) go back on.
async function repairJob(org: string, jobId: string): Promise<number> {
  const job = await getDoc(org, "jobs/" + jobId);
  if (!job) return 0;
  const pays = job.payments || {}, live = liveNow();
  let n = 0;
  for (const r of await ledgerFor(org, jobId)) {
    if (!!r.livemode !== live || (r.status !== "succeeded" && r.status !== "processing")) continue;
    const missing = !pays["st_" + r.pi] || (Number(r.refunded_cents) > 0 && !pays["rf_" + r.pi]) || (Number(r.disputed_cents) > 0 && !pays["dp_" + r.pi]);
    if (missing) { await recordIntent({ id: r.pi }); n++; }
  }
  return n;
}

/* the Stripe pages behind pay links */
const sessionLive = (id: unknown) => /^cs_live_/.test(String(id || ""));
const pageEnds = (l: J) => l.session_expires || l.expires_at;
const capOf = (l: J) => Number(l.cap_cents == null ? l.amount_cents : l.cap_cents) || 0;
const pageUsable = (l: J) => Date.parse(pageEnds(l)) > Date.now() && sessionLive(l.session_id) === liveNow();
async function mintSession(o: J): Promise<J> {
  const d = o.job.d || {};
  const md = { ...payMeta(o.org, o.jobId, o.job, o.by, "link"), tally_link: o.token };
  const nowS = Math.floor(Date.now() / 1000);
  const exp = Math.max(nowS + 31 * 60, Math.min(nowS + PAGE_HOURS * 3600, Math.floor((o.until || Infinity) / 1000)));
  const s = await stripe("POST", "checkout/sessions", {
    mode: "payment", customer: o.cus, client_reference_id: o.jobId,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: o.amt, product_data: { name: (company(o.S) + ": moving services").slice(0, 120), description: gsm(d.name || "Moving job").slice(0, 200) } } }],
    payment_intent_data: { metadata: md, description: payWhat(o.S, o.job), receipt_email: validEmail(d.email) || undefined },
    payment_method_options: o.save ? { card: { setup_future_usage: "off_session" } } : undefined,
    metadata: md, success_url: base() + "/pay/done", expires_at: exp,
  });
  if (!s.expires_at) s.expires_at = exp;
  return s;
}
// A pay link's Stripe page was paid: the link is done, and the payment is written down now.
async function sessionPaid(l: J, s: J): Promise<void> {
  await rest("PATCH", "pay_links?token=eq." + q(l.token) + "&status=eq.open", { status: "paid" });
  const pid = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent && s.payment_intent.id;
  if (pid) await recordIntent({ id: pid });
}
// Stops a Stripe page. "closed"; "paid" when the customer had just paid on it (written down now); or "open"
// when Stripe wouldn't stop it, most likely because a payment on it is going through.
async function closeSession(l: J): Promise<string> {
  try {
    await stripe("POST", "checkout/sessions/" + l.session_id + "/expire");
    return "closed";
  } catch (e) {
    if (!stripeNo(e)) throw e;
    let s: J = null;
    try { s = await stripe("GET", "checkout/sessions/" + l.session_id); } catch (e2) { if (!stripeNo(e2)) throw e2; }
    if (s && s.status === "complete") { await sessionPaid(l, s); return "paid"; }
    return s && s.status === "open" ? "open" : "closed";
  }
}
// Pay link pages that would take more than `limit` are closed. The links stay good: opened again, they ask
// for what is owed then. Says whether a page turned out to be paid just now, or is being paid.
async function trimSessions(org: string, jobId: string, limit: number): Promise<J> {
  const out = { paid: false, busy: false };
  const links = (await rest("GET", "pay_links?select=*&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&status=eq.open")) || [];
  for (const l of links) {
    if (l.amount_cents <= limit || !pageUsable(l)) continue;
    const r = await closeSession(l);
    if (r === "paid") out.paid = true;
    else if (r === "open") out.busy = true;
    else await rest("PATCH", "pay_links?token=eq." + q(l.token), { session_expires: nowIso() });
  }
  return out;
}
// A link replaced by a newer one stops working.
async function retireLink(l: J): Promise<string> {
  const r = pageUsable(l) ? await closeSession(l) : "closed";
  if (r === "closed") await rest("PATCH", "pay_links?token=eq." + q(l.token) + "&status=eq.open", { status: "expired" });
  return r;
}
// A new Stripe page behind a pay link, for amt.
async function renewPage(l: J, job: J, S: J, amt: number): Promise<J> {
  if (pageUsable(l)) {
    const r = await closeSession(l);
    if (r !== "closed") return { state: r };
  }
  const cus = (await jobCustomer(l.org_id, l.job_id, job)).customer;
  const s = await mintSession({ org: l.org_id, jobId: l.job_id, job, S, by: l.created_by || "", token: l.token, amt, save: !!l.save_card, cus, until: Date.parse(l.expires_at) });
  const patch = { session_id: s.id, url: s.url, amount_cents: amt, session_expires: new Date(s.expires_at * 1000).toISOString() };
  const kept = await rest("PATCH", "pay_links?token=eq." + q(l.token) + "&status=eq.open", patch, "return=representation");
  if (!kept || !kept.length) {   // the link was replaced or paid meanwhile: its new page must not stay open
    await stripe("POST", "checkout/sessions/" + s.id + "/expire").catch(() => {});
    return { state: "gone" };
  }
  return { state: "ready", link: { ...l, ...patch } };
}

/* bringing a job up to date with Stripe */
const OPEN_PI = ["requires_payment_method", "requires_confirmation", "requires_action"];
// Card payments that finished or failed are written down, and pay link pages the customer has just paid on.
// Card payments left unfinished for 15 minutes, failed ones, and saved-card tries that stopped are cancelled.
// Before a payment starts (me given), this person's own unfinished ones are cancelled too (they are trying
// again); one someone else is in the middle of is counted in `reserved`, as is any when `reserve` is set.
async function settleJob(org: string, jobId: string, o: { me?: J; reserve?: boolean } = {}): Promise<J> {
  const live = liveNow();
  let reserved = 0;
  const inflight: J[] = [];
  const rows = (await rest("GET", "pay_log?select=pi,status,livemode&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) +
    "&status=in.(requires_payment_method,requires_confirmation,requires_action,processing)")) || [];
  for (const r of rows) {
    if (!!r.livemode !== live) continue;   // the other mode's payments can't be looked up with this key
    let pi: J;
    try {
      pi = await stripe("GET", "payment_intents/" + r.pi, { expand: ["payment_method", "latest_charge"] });
    } catch (e) {
      if (!(e instanceof StripeError && e.status === 404)) throw e;
      await rest("PATCH", "pay_log?pi=eq." + q(r.pi), { status: "canceled", updated_at: nowIso() });
      continue;
    }
    await recordIntent(pi);
    const md = pi.metadata || {};
    // a pay link's payment belongs to its Stripe page, which is stopped by closing the page (Stripe
    // doesn't let Checkout's payments be cancelled on their own)
    if (OPEN_PI.indexOf(pi.status) < 0 || md.tally_src === "link") continue;
    const stale = Date.now() - (Number(pi.created) || 0) * 1000 > STALE_MS;
    const mine = !!o.me && (md.tally_uid ? md.tally_uid === o.me.uid : md.tally_by === who(o.me));
    if (stale || md.tally_src === "saved" || pi.last_payment_error || mine) await cancelIntent(pi);
    else if (o.me || o.reserve) { reserved += Number(pi.amount) || 0; inflight.push(pi); }
  }
  const links = (await rest("GET", "pay_links?select=*&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&status=eq.open")) || [];
  for (const l of links) {
    if (!pageUsable(l)) continue;
    let s: J = null;
    try { s = await stripe("GET", "checkout/sessions/" + l.session_id); } catch (e) { if (!stripeNo(e)) throw e; }
    if (s && s.status === "complete") await sessionPaid(l, s);
    else if (!s || s.status === "expired") await rest("PATCH", "pay_links?token=eq." + q(l.token), { session_expires: nowIso() });
  }
  return { reserved, inflight };
}
// Inside the job's lock, just before a card is charged: the job brought up to date, the amount checked
// against what is owed (less a payment someone else is in the middle of), and pay link pages that would
// ask for more than will be left closed.
async function readyToCharge(org: string, jobId: string, me: J, amt: number, job0: J): Promise<J> {
  const { reserved } = await settleJob(org, jobId, { me });
  const job = (await getDoc(org, "jobs/" + jobId)) || job0;
  let owed = await owedCents(org, jobId, job);
  let bad = amountTrouble(amt, owed, reserved);
  if (bad) return { ok: false, message: bad };
  const t = await trimSessions(org, jobId, owed - reserved - amt);
  if (t.busy) return { ok: false, message: PAYING };
  if (t.paid) {
    owed = await owedCents(org, jobId);
    bad = amountTrouble(amt, owed, reserved);
    if (bad) return { ok: false, message: bad };
  }
  return { ok: true, job, owed, reserved };
}

/* the app's payment actions */
export async function payConfig(org: string): Promise<J> {
  const mode = stripeMode();
  const on = mode ? await payOrgOn(org) : false;
  const pk = on ? publishableKey() : "";
  return { ok: true, ready: !!mode && on, test: mode === "test", publishableKey: pk, reason: !mode ? "no-key" : !on ? "org-off" : !pk ? "no-pk" : "" };
}
async function textedLately(org: string, jobId: string): Promise<boolean> {
  const since = new Date(Date.now() - 120e3).toISOString();
  const rows = await rest("GET", "comm_log?select=id&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&purpose=eq.paylink&created_at=gte." + q(since) + "&status=neq.failed&limit=1");
  return !!(rows && rows.length);
}

// A pay link: a short /p/<code> address for texts and QR codes, with a Stripe page behind it.
export async function payLink(org: string, me: J, jobId: string, b: J): Promise<J> {
  const c = await payContext(org, me, jobId);
  if (c.err) return { ok: false, message: c.err, status: c.status };
  const amt = cents(b.amount), save = !!b.save, by = who(me);
  if (!(amt > 0)) return { ok: false, message: "Enter an amount." };
  const wh = await ensureWebhook();
  if (!wh.ok) return wh;
  const res = await withJobLock(org, jobId, async (): Promise<J> => {
    const { reserved } = await settleJob(org, jobId, { me });
    const job = (await getDoc(org, "jobs/" + jobId)) || c.job;
    let owed = await owedCents(org, jobId, job);
    let bad = amountTrouble(amt, owed, reserved);
    if (bad) return { ok: false, message: bad };
    const open = (await rest("GET", "pay_links?select=*&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&status=eq.open")) || [];
    // the same request again (a second tap, the screen redrawn) gets the same link back
    const again = open.find((l: J) => capOf(l) === amt && !!l.save_card === save && Date.parse(l.expires_at) > Date.now() + 3600e3);
    if (again) {
      if (again.amount_cents === amt && Date.parse(pageEnds(again)) > Date.now() + 15 * 60e3 && sessionLive(again.session_id) === liveNow()) return { ok: true, link: again };
      const r = await renewPage(again, job, c.S, amt);
      if (r.state === "paid") return { ok: false, message: "That link was just paid. Check the bill." };
      if (r.state === "open") return { ok: false, message: PAYING };
      if (r.state === "gone") return { ok: false, message: BUSY };
      return { ok: true, link: r.link };
    }
    if (await tooManyPays(org, by)) return { ok: false, message: TOO_MANY };
    // one link per job: a new one replaces the others
    let paidNow = false;
    for (const l of open) {
      const r = await retireLink(l);
      if (r === "open") return { ok: false, message: PAYING };
      if (r === "paid") paidNow = true;
    }
    if (paidNow) {
      owed = await owedCents(org, jobId);
      bad = amountTrouble(amt, owed, reserved);
      if (bad) return { ok: false, message: bad };
    }
    const cus = (await jobCustomer(org, jobId, job)).customer;
    const token = randToken(), until = Date.now() + LINK_DAYS * 86400e3;
    const s = await mintSession({ org, jobId, job, S: c.S, by, token, amt, save, cus, until });
    const link = {
      token, org_id: org, job_id: jobId, session_id: s.id, url: s.url, amount_cents: amt, cap_cents: amt, save_card: save, created_by: by,
      status: "open", expires_at: new Date(until).toISOString(), session_expires: new Date(s.expires_at * 1000).toISOString(),
    };
    await rest("POST", "pay_links", link);
    return { ok: true, link };
  });
  if (!res) return { ok: false, message: BUSY };
  if (!res.ok) return res;
  const url = base() + "/p/" + res.link.token, d = c.job.d || {};
  const out: J = { ok: true, url, amount: amt / 100, expiresAt: res.link.expires_at, texted: false, message: "Payment link ready for " + money(amt) + "." };
  if (b.text) {
    const line = await lineFor(org);
    if (!line) out.message = "Text it from your phone, or show the QR code.";
    else if (c.job.test) out.message = "Test job: nothing is texted.";
    else if (!e164(d.phone)) out.message = "This job has no customer phone number.";
    else if (await textedLately(org, jobId)) out.message = "The link was texted a moment ago. Give it a minute before sending it again.";
    else {
      const r = await sendText({ org, line, jobId, purpose: "paylink", staff: me.staff, party: d.name || "Customer", to: d.phone,
        body: company(c.S) + ": Here is your secure payment link for " + money(amt) + ": " + url });
      out.texted = r.status !== "failed" && r.status !== "no-number";
      out.message = out.texted ? "Texted the payment link to " + (d.name || "the customer") + "." : "The text did not go out. Show the QR code instead.";
    }
  }
  return out;
}

// A card typed into the app: the app collects it with Stripe's card box, then this makes the payment for
// the amount the server agrees is owed. The app confirms it with Stripe directly.
export async function payIntent(org: string, me: J, jobId: string, b: J): Promise<J> {
  const c = await payContext(org, me, jobId);
  if (c.err) return { ok: false, message: c.err, status: c.status };
  const amt = cents(b.amount), save = !!b.save, by = who(me);
  if (!(amt > 0)) return { ok: false, message: "Enter an amount." };
  if (!publishableKey()) return { ok: false, message: "Typing a card in needs STRIPE_PUBLISHABLE_KEY in Supabase. Use a pay link for now." };
  if (await tooManyPays(org, by)) return { ok: false, message: TOO_MANY };
  const wh = await ensureWebhook();
  if (!wh.ok) return wh;
  const res = await withJobLock(org, jobId, async (): Promise<J> => {
    const ready = await readyToCharge(org, jobId, me, amt, c.job);
    if (!ready.ok) return ready;
    const job = ready.job, cus = (await jobCustomer(org, jobId, job)).customer;
    const md = payMeta(org, jobId, job, by, "card", me.uid);
    const pi = await stripe("POST", "payment_intents", {
      amount: amt, currency: "usd", customer: cus, allowed_payment_method_types: ["card"],
      payment_method_options: { card: { setup_future_usage: save ? "off_session" : "none" } },
      metadata: md, description: payWhat(c.S, job), receipt_email: validEmail((job.d || {}).email) || undefined,
    });
    await rest("POST", "pay_log?on_conflict=pi", { pi: pi.id, org_id: org, job_id: jobId, amount_cents: amt, status: pi.status || "requires_payment_method",
      source: "card", cust_key: md.tally_cust, by_staff: by, livemode: !!pi.livemode, updated_at: nowIso() }, "resolution=merge-duplicates");
    return { ok: true, clientSecret: pi.client_secret, returnUrl: base() + "/pay/done", amount: amt / 100 };
  });
  return res || { ok: false, message: BUSY };
}

// Charge a card kept on file for this job's customer.
export async function paySaved(org: string, me: J, jobId: string, b: J): Promise<J> {
  const c = await payContext(org, me, jobId);
  if (c.err) return { ok: false, message: c.err, status: c.status };
  const amt = cents(b.amount), by = who(me), live = liveNow();
  if (!(amt > 0)) return { ok: false, message: "Enter an amount." };
  const vid = String(b.vaultId || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(vid)) return { ok: false, message: "Pick a saved card." };
  const card = ((await rest("GET", "pay_cards?select=*&org_id=eq." + q(org) + "&id=eq." + q(vid) + "&limit=1")) || [])[0];
  if (!card || !card.pm_id) return { ok: false, message: "That saved card can't be charged here. Use a pay link or the card itself." };
  if (!(await getDoc(org, "vault/" + vid))) return { ok: false, message: "That card is no longer on file." };
  if (!!card.livemode !== live) return { ok: false, message: "That card was saved in Stripe " + (card.livemode ? "live" : "test") + " mode and can't be used now." };
  if (await tooManyPays(org, by)) return { ok: false, message: TOO_MANY };
  const wh = await ensureWebhook();
  if (!wh.ok) return wh;
  const res = await withJobLock(org, jobId, async (): Promise<J> => {
    // the same amount charged to a card on this job a moment ago: most likely a double tap
    const since = new Date(Date.now() - 120e3).toISOString();
    const recent = await rest("GET", "pay_log?select=pi&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&source=eq.saved&amount_cents=eq." + amt + "&status=in.(succeeded,processing)&created_at=gte." + q(since) + "&limit=1");
    if (recent && recent.length) return { ok: false, message: "This card was just charged " + money(amt) + ". Check the bill before charging it again." };
    const ready = await readyToCharge(org, jobId, me, amt, c.job);
    if (!ready.ok) return ready;
    const job = ready.job;
    if ((await jobCustomer(org, jobId, job)).customer !== card.customer_id) return { ok: false, message: "That card belongs to a different customer." };
    if (me.role === "lead" && card.job_id !== jobId) {
      const here = card.fingerprint ? await rest("GET", "pay_cards?select=id&org_id=eq." + q(org) + "&customer_id=eq." + q(card.customer_id) + "&fingerprint=eq." + q(card.fingerprint) + "&job_id=eq." + q(jobId) + "&limit=1") : [];
      if (!(here && here.length)) return { ok: false, message: "This card was kept on file on another job. The office can charge it, or send a pay link." };
    }
    if (me.role === "lead") {
      // charging a card with the customer not there: a crew lead stays within the quote's not-to-exceed
      // amount, which only the office sets (things can be added to the bill on the job)
      const qt = job.quote || {}, nte = cents(Number(qt.nte) > 0 ? qt.nte : qt.total);
      const room = nte - (jobTotalCents(job) - ready.owed);
      if (amt > room) {
        return { ok: false, message: room >= MIN_CENTS
          ? "A crew lead can put up to " + money(room) + " more on a card on file for this job (the quote's not-to-exceed amount). Send a pay link for the rest, or ask the office."
          : "This bill is over the quote's not-to-exceed amount, so the office charges the card on file. Or send a pay link." };
      }
    }
    // one charge however many times this is sent: the key names the job, the card, the amount, the bill so far
    const tries = (await rest("GET", "pay_log?select=pi&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&source=eq.saved")) || [];
    const idem = "tally-saved-" + await sha([org, jobId, card.pm_id, amt, jobTotalCents(job) - ready.owed, tries.length, live].join("|"));
    const md = payMeta(org, jobId, job, by, "saved", me.uid);
    try {
      const pi = await stripe("POST", "payment_intents", {
        amount: amt, currency: "usd", customer: card.customer_id, payment_method: card.pm_id, off_session: true, confirm: true,
        metadata: md, description: payWhat(c.S, job), receipt_email: validEmail((job.d || {}).email) || undefined,
        expand: ["payment_method", "latest_charge"],
      }, idem);
      await recordIntent(pi);
      const what = methodLabel(pi.payment_method && typeof pi.payment_method === "object" ? pi.payment_method : null);
      if (pi.status === "succeeded") return { ok: true, message: "Charged " + money(amt) + " to " + what + "." };
      if (pi.status === "processing") return { ok: true, message: "Payment of " + money(amt) + " is processing." };
      return { ok: false, message: "The card was not charged." };
    } catch (e) {
      if (e instanceof StripeError && e.err && e.err.type === "card_error") {
        if (e.err.payment_intent && e.err.payment_intent.id) await recordIntent({ id: e.err.payment_intent.id }).catch(() => {});
        if (e.err.code === "authentication_required") {
          return { ok: false, needLink: true, message: "The customer's bank wants them to approve this one. Send them a pay link instead." };
        }
        const why = DECLINES[e.err.decline_code] || DECLINES[e.err.code] || "the bank said no";
        return { ok: false, message: "The card was declined: " + why + "." };
      }
      throw e;
    }
  });
  return res || { ok: false, message: BUSY };
}

// After the app finishes a card payment, records cash, or wonders whether a pay link was used: bring the
// job up to date with Stripe and the ledger, close pay link pages that ask for more than is owed now, and
// say what is still owed.
export async function payCheck(org: string, me: J, jobId: string, b: J): Promise<J> {
  if (!stripeMode()) return { ok: false, message: "Card payments are not set up yet." };
  if (!(await payOrgOn(org))) return { ok: false, message: "Card payments are not turned on for this company yet." };
  const job = await getDoc(org, "jobs/" + jobId);
  if (!job) return { ok: false, message: "That job is not available." };
  if (!canTakePay(me, job)) return { ok: false, status: 403, message: "Crew leads and the office take payments." };
  const pid = String(b.pi || "");
  if (pid) {
    if (!/^pi_[A-Za-z0-9_]+$/.test(pid)) return { ok: false, message: "Unknown payment." };
    const md = (await stripe("GET", "payment_intents/" + pid)).metadata || {};
    if (md.tally_org !== org || md.tally_job !== jobId) return { ok: false, message: "That payment belongs to another job." };
  }
  const out = await withJobLock(org, jobId, async () => {
    // looked up again inside the lock, so an older state of the same payment can't be written over a newer one
    const rec = pid ? await recordIntent({ id: pid }) : null;
    const { inflight } = await settleJob(org, jobId, { reserve: true });
    const fixed = await repairJob(org, jobId);
    // a card payment going through on another phone that no longer fits the bill (cash came in, or the
    // bill was lowered) is called off; the ones that still fit hold their amount back from pay link pages
    const owed = await owedCents(org, jobId);
    let reserved = 0;
    for (const pi of inflight) {
      const a = Number(pi.amount) || 0;
      if (a > owed - reserved) await cancelIntent(pi);
      else reserved += a;
    }
    await trimSessions(org, jobId, owed - reserved);
    return { rec, fixed };
  }, 6000);
  const owed = (await owedCents(org, jobId)) / 100;
  // still busy: the app asks again in a moment
  if (!out) return { ok: true, busy: true, owed, fixed: 0, piStatus: "" };
  return { ok: true, owed, fixed: out.fixed, piStatus: (out.rec && out.rec.status) || "" };
}

// The office takes a card off file: it can't be charged again, here or in Stripe.
export async function payForget(org: string, me: J, b: J): Promise<J> {
  if (!(me.role === "owner" || me.role === "dispatch")) return { ok: false, status: 403, message: "Only the office removes cards on file." };
  const vid = String(b.vaultId || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(vid)) return { ok: false, message: "Unknown card." };
  const card = ((await rest("GET", "pay_cards?select=*&org_id=eq." + q(org) + "&id=eq." + q(vid) + "&limit=1")) || [])[0];
  const all = !card || !card.pm_id ? [] : card.fingerprint
    ? (await rest("GET", "pay_cards?select=id,pm_id,livemode&org_id=eq." + q(org) + "&customer_id=eq." + q(card.customer_id) + "&fingerprint=eq." + q(card.fingerprint))) || []
    : [card];
  for (const r of all) {
    if (!r.pm_id) continue;
    if (stripeMode() && !!r.livemode === liveNow()) {
      try { await stripe("POST", "payment_methods/" + r.pm_id + "/detach"); } catch (e) { if (!stripeNo(e)) throw e; }
    }
    // the entry stays behind, emptied, so writing an old payment down again can't put the card back
    await rest("PATCH", "pay_cards?id=eq." + q(r.id) + "&org_id=eq." + q(org), { pm_id: "", job_id: "", name: "" });
    await rest("DELETE", "docs?org_id=eq." + q(org) + "&path=eq." + q("vault/" + r.id));
  }
  await rest("DELETE", "docs?org_id=eq." + q(org) + "&path=eq." + q("vault/" + vid));
  return { ok: true, message: "Card removed. It can't be charged again." };
}

function text(s: string, status = 200): Response {
  return new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
// The short link a customer opens: sends them to a Stripe page for what they owe right now.
async function payRedirect(token: string): Promise<Response> {
  const rows = await rest("GET", "pay_links?select=*&token=eq." + q(token) + "&limit=1");
  const l = rows && rows[0];
  if (!l) return text("This payment link isn't valid. Ask the moving company for a new one.", 404);
  const S = await getDoc(l.org_id, "org/settings");
  const co = String((S && S.company) || "the moving company");
  if (l.status === "paid") return text("This payment is done. Thank you!");
  const job = await getDoc(l.org_id, "jobs/" + l.job_id);
  if (!job || job.status === "lost") return text("This payment link isn't valid anymore. Ask " + co + " for a new one.", 410);
  if (l.status !== "open" || Date.parse(l.expires_at) < Date.now()) {
    if ((await owedCents(l.org_id, l.job_id, job)) <= 0) return text("This bill is paid. Thank you!");
    return text("This payment link has expired. Ask " + co + " for a new one.", 410);
  }
  if (!stripeMode() || !(await payOrgOn(l.org_id)) || (job.test && liveNow())) return text("Card payments are paused right now. Ask " + co + " how to pay.", 503);
  const out = await withJobLock(l.org_id, l.job_id, async (): Promise<J> => {
    const { reserved } = await settleJob(l.org_id, l.job_id, { reserve: true });
    const cur = ((await rest("GET", "pay_links?select=*&token=eq." + q(token) + "&limit=1")) || [])[0] || l;
    if (cur.status === "paid") return { msg: "This payment is done. Thank you!" };
    // replaced by a newer link while this one waited its turn
    if (cur.status !== "open" || Date.parse(cur.expires_at) < Date.now()) return { msg: "This payment link has expired. Ask " + co + " for a new one.", status: 410 };
    const owed = await owedCents(l.org_id, l.job_id);
    if (owed <= 0) return { msg: "This bill is paid. Thank you!" };
    const want = Math.min(capOf(cur), owed - reserved);
    if (want < MIN_CENTS) {
      return reserved > 0
        ? { msg: "A payment on this bill is going through right now. Try the link again in a few minutes.", status: 409 }
        : { msg: "What's left on this bill (" + money(owed) + ") is too small to pay by card. Pay " + co + " directly.", status: 409 };
    }
    if (cur.amount_cents === want && Date.parse(pageEnds(cur)) > Date.now() + 10 * 60e3 && sessionLive(cur.session_id) === liveNow()) return { url: cur.url };
    const r = await renewPage(cur, (await getDoc(l.org_id, "jobs/" + l.job_id)) || job, S, want);
    if (r.state === "paid") return { msg: "This payment is done. Thank you!" };
    if (r.state === "open") return { msg: "This payment is going through. Check back in a minute.", status: 409 };
    if (r.state === "gone") return { msg: "This payment link has expired. Ask " + co + " for a new one.", status: 410 };
    return { url: r.link.url };
  });
  if (!out) return text("Busy for a moment. Try the link again.", 503);
  if (out.msg) return text(out.msg, out.status || 200);
  return new Response(null, { status: 302, headers: { Location: out.url, "Cache-Control": "no-store" } });
}
async function handleStripe(req: Request): Promise<Response> {
  const raw = await req.text();
  const secrets = await webhookSecrets();
  if (!secrets.length || !(await stripeSigOk(raw, req.headers.get("stripe-signature") || "", secrets))) return text("Bad signature", 400);
  let ev: J;
  try { ev = JSON.parse(raw); } catch { return text("Bad request", 400); }
  // test events once the live keys are in (or the other way round) can't be looked up with this key
  if (!stripeMode() || !!(ev && ev.livemode) !== liveNow()) return json({ received: true, skipped: "other-mode" });
  const o = (ev && ev.data && ev.data.object) || {}, type = String((ev && ev.type) || "");
  const idOf = (x: J) => typeof x === "string" ? x : x && x.id;
  try {
    let pid = "";
    if (/^payment_intent\./.test(type)) pid = o.id;
    else if (type === "checkout.session.completed") {
      if (o.id) await rest("PATCH", "pay_links?session_id=eq." + q(o.id) + "&status=eq.open", { status: "paid" });
      pid = idOf(o.payment_intent);
    } else if (type === "checkout.session.expired") {
      if (o.id) await rest("PATCH", "pay_links?session_id=eq." + q(o.id), { session_expires: nowIso() });
    } else if (/^charge\./.test(type)) pid = idOf(o.payment_intent);
    if (pid) {
      // which job: from the event when it says, otherwise from the payment itself
      const md = (o.object === "payment_intent" || o.object === "checkout.session") && o.metadata ? o.metadata
        : ((await stripe("GET", "payment_intents/" + pid)) || {}).metadata || {};
      const org = String(md.tally_org || ""), job = String(md.tally_job || "");
      if (/^[0-9A-Fa-f-]{36}$/.test(org) && /^[A-Za-z0-9_-]{1,40}$/.test(job) && await orgExists(org)) {
        // written down inside the job's lock, so a check running at the same moment can't write an older
        // state of this payment over it; pay link pages that now ask for more than is left are closed
        const work = async () => {
          const rec = await recordIntent({ id: pid });
          if (rec.ok && rec.org) await trimSessions(rec.org, rec.job, rec.owed);
          return rec;
        };
        if ((await withJobLock(org, job, work, 5000)) === null) await recordIntent({ id: pid });   // still busy: write it down anyway
      }
    }
  } catch (e) {
    console.error("stripe event", type, e);
    return text("Try again", 500);   // Stripe sends it again later
  }
  return json({ received: true });
}

async function handleApp(req: Request): Promise<Response> {
  let b: J;
  try { b = await req.json(); } catch { return json({ ok: false, message: "Bad request" }, 400); }
  const org = String(b.org || ""), jobId = String(b.jobId || "");
  if (!org) return json({ ok: false, message: "Missing company" }, 400);
  const me = await whoIs(req, org);
  if (!me) return json({ ok: false, message: "Sign in again." }, 401);
  const office = me.role === "owner" || me.role === "dispatch";
  try {
    if (b.action === "line") {
      const l = await lineFor(org);
      return json({ ok: true, number: l ? l.phone_number : "", twilio: !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN")) });
    }
    if (b.action === "distance") {
      if (!office) return json({ ok: false, message: "Only the owner and dispatch build quotes." }, 403);
      return json(await driveDistance(b.from, b.to));
    }
    if (b.action === "pay_config") return json(await payConfig(org));
    if (b.action === "sos") {
      const out = await sosText(org, me, String(b.msgId || ""), String(b.kind || ""), b.now);
      const st = out.status;
      delete out.status;
      return json(out, typeof st === "number" ? st : 200);
    }
    const pay: Record<string, (o: string, m: J, j: string, x: J) => Promise<J>> = {
      pay_link: payLink, pay_intent: payIntent, pay_saved: paySaved, pay_check: payCheck,
      pay_forget: (o: string, m: J, _j: string, x: J) => payForget(o, m, x),
    };
    if (b.action !== "pay_forget" && !/^[A-Za-z0-9_-]{1,40}$/.test(jobId)) return json({ ok: false, message: "Missing job" }, 400);
    if (pay[b.action]) {
      try {
        const out = await pay[b.action](org, me, jobId, b);
        const st = out.status;
        delete out.status;
        return json(out, typeof st === "number" ? st : 200);
      } catch (e) {
        console.error(b.action, e);
        return json({ ok: false, message: stripeTrouble(e) });
      }
    }
    if (b.action === "job") {
      if (!office) return json({ ok: false, message: "Only the owner and dispatch schedule crews." }, 403);
      return json(await checkJob(org, jobId, req.headers.get("origin")));
    }
    if (b.action === "forms") return json(await checkForms(org, jobId));
    if (b.action === "call") return json(await startCall(org, me, jobId));
    if (b.action === "eta") return json(await sendEta(org, me, jobId, b.minutes));
    if (b.action === "remind") {
      if (!office) return json({ ok: false, message: "Only the owner and dispatch send reminders." }, 403);
      return json(await remindJob(org, jobId, req.headers.get("origin")));
    }
    return json({ ok: false, message: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok: false, message: "Something went wrong on the server." }, 500);
  }
}

/* ---------- Twilio webhooks ---------- */
async function findJobByPhone(org: string, phone: string): Promise<J> {
  const d = last10(phone);
  if (d.length < 7) return null;
  const pat = "*" + d.slice(-7).split("").join("*");
  const rows = await rest("GET", "docs?select=doc_id,data&org_id=eq." + q(org) + "&collection=eq.jobs&" +
    q("data->d->>phone") + "=ilike." + q(pat) + "&order=updated_at.desc&limit=25");
  const hits = (rows || []).filter((r: J) => r.data && r.data.d && last10(r.data.d.phone) === d);
  if (!hits.length) return null;
  const rank: J = { active: 0, booked: 1, done: 2, quoted: 3, lead: 4, paid: 5, lost: 6 };
  hits.sort((a: J, b: J) => (rank[a.data.status] ?? 9) - (rank[b.data.status] ?? 9));
  return { id: hits[0].doc_id, job: hits[0].data };
}

async function handleTwilio(sub: string, url: URL, p: Record<string, string>): Promise<Response> {
  const B = base();
  const logId = url.searchParams.get("log") || "";

  if (sub === "status") {
    if (!logId) return xml("");
    const row = await getLog(logId);
    if (!row) return xml("");
    if (p.MessageStatus) {
      await patchLog(logId, { status: p.MessageStatus, error: p.ErrorCode ? "Twilio error " + p.ErrorCode : row.error });
    } else if (p.CallStatus) {
      // Your phone never picked up (or was busy): record it, unless the customer leg already reported.
      if (["no-answer", "busy", "failed", "canceled"].indexOf(p.CallStatus) >= 0 && row.status === "calling-you") {
        await patchLog(logId, { status: "you-missed" });
      } else if (row.status === "calling-you") {
        await patchLog(logId, { status: "not-connected" });
      }
    }
    return xml("");
  }

  if (sub === "bridge") {
    const row = await getLog(logId);
    if (!row) return xml("<Hangup/>");
    return xml('<Gather numDigits="1" timeout="8" action="' + x(B + "/twilio/connect?log=" + logId) + '">' +
      "<Say>Tally. Press 1 to call " + x(row.party || "the customer") + " from the company line.</Say></Gather>" +
      "<Say>No key pressed. Goodbye.</Say>");
  }

  if (sub === "connect") {
    const row = await getLog(logId);
    if (!row || p.Digits !== "1") {
      if (row) await patchLog(logId, { status: "not-connected" });
      return xml("<Hangup/>");
    }
    await patchLog(logId, { status: "dialing" });
    return xml("<Say>Connecting.</Say>" +
      '<Dial callerId="' + x(row.from_number) + '" timeout="30" answerOnBridge="true" action="' + x(B + "/twilio/dialed?log=" + logId) + '">' +
      "<Number>" + x(row.to_number) + "</Number></Dial>");
  }

  if (sub === "dialed") {
    const st = p.DialCallStatus || "";
    await patchLog(logId, {
      status: st === "completed" ? "answered" : (st || "ended"),
      duration_sec: parseInt(p.DialCallDuration || "0", 10) || 0,
    });
    return xml("<Hangup/>");
  }

  // Everything below is the company number receiving a call or a text.
  const line = await lineByNumber(e164(p.To || p.Called || ""));
  if (sub === "whisper") {
    const row = logId ? await getLog(logId) : null;
    return xml("<Say>Tally call from " + x((row && row.party) || "a customer") + ".</Say>");
  }
  if (!line) return xml(sub === "sms" ? "" : "<Say>This number is not in service.</Say><Hangup/>");
  const org = line.org_id;
  const S = await getDoc(org, "org/settings");
  const C = contacts(S);
  const from = e164(p.From || "");

  if (sub === "voice") {
    const hit = await findJobByPhone(org, from);
    const staff = hit ? "" : staffByPhone(S, from);
    const party = hit ? ((hit.job.d && hit.job.d.name) || "a customer") : (staff || "an unknown caller");
    const row = await logRow({
      org_id: org, job_id: hit ? hit.id : null, channel: "call", direction: "in", purpose: "callback",
      staff: staff || null, party, to_number: line.phone_number, from_number: from, status: "ringing", sid: p.CallSid || null,
    });
    const ring = ringNames(S);
    if (!ring.length) {
      await patchLog(row.id, { status: "missed", error: "No one is set to answer the company line" });
      return xml("<Say>Thanks for calling " + x(company(S)) + ". No one can take your call right now. We will call you back.</Say><Hangup/>");
    }
    return xml('<Dial callerId="' + x(line.phone_number) + '" timeout="22" action="' + x(B + "/twilio/after?log=" + row.id) + '">' +
      ring.map((n) => '<Number url="' + x(B + "/twilio/whisper?log=" + row.id) + '">' + x(e164(C[n])) + "</Number>").join("") +
      "</Dial>");
  }

  if (sub === "after") {
    const row = await getLog(logId);
    const st = p.DialCallStatus || "";
    if (st === "completed") {
      if (row) await patchLog(logId, { status: "answered", duration_sec: parseInt(p.DialCallDuration || "0", 10) || 0 });
      return xml("<Hangup/>");
    }
    if (row) {
      await patchLog(logId, { status: "missed" });
      const who = row.party || "someone";
      const body = company(S) + ": Missed call on the company line from " + gsm(who) + " " + (row.from_number || "") + ". Call them back from Tally.";
      for (const n of ringNames(S)) await sendText({ org, line, jobId: row.job_id || undefined, purpose: "missed-call", staff: n, to: C[n], body });
    }
    return xml("<Say>Sorry, no one could get to the phone. We got your number and will call you right back.</Say><Hangup/>");
  }

  if (sub === "sms") {
    const text = String(p.Body || "").slice(0, 1000);
    const staff = staffByPhone(S, from);
    const hit = staff ? null : await findJobByPhone(org, from);
    const party = staff || (hit ? (hit.job.d && hit.job.d.name) || "a customer" : from);
    await logRow({
      org_id: org, job_id: hit ? hit.id : null, channel: "sms", direction: "in", purpose: staff ? "reply" : "customer-text",
      staff: staff || null, party, to_number: line.phone_number, from_number: from, body: text, status: "received", sid: p.MessageSid || null,
    });
    if (/^\s*(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|help|info)\s*$/i.test(text)) return xml("");
    if (staff) {
      // A mover answering an alert: drop it into the app chat, as a message to dispatch.
      const disp = ((S && S.office) || []).find((o: J) => o.kind === "dispatch") || ((S && S.office) || [])[0];
      if (disp && disp.name !== staff) {
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
        const t = "dm:" + [disp.name, staff].sort().join("|");
        await rest("POST", "docs", {
          org_id: org, path: "chat/" + id, collection: "chat", doc_id: id, updated_at: new Date().toISOString(),
          data: { id, t, from: staff, text: text + "\n(sent by text message)", ts: Date.now(), k: "text" },
        });
      }
      return xml("");
    }
    const body = company(S) + ": Text to the company line from " + gsm(party) + ": " + gsm(text);
    for (const n of ringNames(S)) await sendText({ org, line, jobId: hit ? hit.id : undefined, purpose: "forward", staff: n, to: C[n], body: body.slice(0, 600) });
    return xml("");
  }

  return xml("");
}

/* ---------- entry ---------- */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const at = url.pathname.indexOf("/" + FN);
  const sub = at >= 0 ? url.pathname.slice(at + FN.length + 1) : url.pathname;
  if (req.method === "GET") {
    const pl = /^\/p\/([A-Za-z0-9]{8,16})\/?$/.exec(sub);
    try {
      if (pl) return await payRedirect(pl[1]);
    } catch (e) { console.error(e); return text("Something went wrong. Try the link again in a minute.", 500); }
    if (/^\/pay\/done\/?$/.test(sub)) return text("Payment received. Thank you!\n\nYou can close this page.");
  }
  if (req.method !== "POST") return json({ ok: false, message: "POST only" }, 405);
  if (sub === "/app" || sub === "/app/") return handleApp(req);
  if (sub === "/stripe" || sub === "/stripe/") return handleStripe(req);
  if (/^\/cron\/tomorrow\/?$/.test(sub)) {
    const secret = env("TALLY_CRON_SECRET");
    if (!secret || !same(secret, req.headers.get("x-tally-cron") || "")) return json({ ok: false, message: "Forbidden" }, 403);
    try { return json(await runTomorrow()); } catch (e) { console.error(e); return json({ ok: false, message: "Something went wrong on the server." }, 500); }
  }
  const m = /^\/twilio\/([a-z]+)\/?$/.exec(sub);
  if (!m) return json({ ok: false, message: "Not found" }, 404);
  const form = new URLSearchParams(await req.text());
  const p: Record<string, string> = {};
  form.forEach((v, k) => { p[k] = v; });
  const expected = await twilioSignature(base() + "/twilio/" + m[1] + url.search, p, env("TWILIO_AUTH_TOKEN"));
  if (!env("TWILIO_AUTH_TOKEN") || !same(expected, req.headers.get("x-twilio-signature") || "")) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    return await handleTwilio(m[1], url, p);
  } catch (e) {
    console.error(e);
    return xml(m[1] === "voice" ? "<Say>Sorry, something went wrong. Please call again.</Say><Hangup/>" : "");
  }
}

// deno-lint-ignore no-explicit-any
if (typeof (globalThis as any).Deno !== "undefined" && !(globalThis as any).__TALLY_TEST) (globalThis as any).Deno.serve(handle);
