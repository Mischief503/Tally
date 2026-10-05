// Tally — Twilio Edge Function (Supabase)
// One function covers text alerts, masked calling, callbacks to the office, and the call/text log.
//
// Secrets this function reads (Supabase › Edge Functions › Secrets):
//   TWILIO_ACCOUNT_SID   your Twilio Account SID (starts with AC)
//   TWILIO_AUTH_TOKEN    your Twilio Auth Token
//   GOOGLE_MAPS_KEY      a Google key with the Routes API on (quote distance lookup; optional)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by Supabase automatically
//
// Deploy with "Enforce JWT verification" OFF: Twilio cannot send a Supabase token.
// App requests are checked here instead (the signed-in user's token is verified on every call),
// and every Twilio request is checked against Twilio's signature.
//
// Routes (all POST):
//   /app                 the Tally app: {action:'job'|'forms'|'call'|'line', org, jobId}
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
// The address texts link to, so a tap opens Job messages. Setup › Texts and calls fills it in.
export function appLink(S: J, origin?: string | null): string {
  // The Android app's own pages live at appassets.androidplatform.net, which no one else can open.
  const fromOrigin = origin && !/androidplatform\.net(:\d+)?\/?$/i.test(origin) ? origin : "";
  const raw = String((S && S.comms && S.comms.appUrl) || fromOrigin || "").trim();
  if (!/^https:\/\/[^\s"<>]+$/i.test(raw)) return "";
  return raw.replace(/#.*$/, "") + "#messages";
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
async function twilio(resource: string, params: Record<string, string>): Promise<J> {
  const sid = env("TWILIO_ACCOUNT_SID"), tok = env("TWILIO_AUTH_TOKEN");
  if (!sid || !tok) throw new Error("Twilio is not configured: add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN");
  const r = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/" + resource + ".json", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(sid + ":" + tok), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((out && out.message) || "Twilio error " + r.status);
  return out;
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
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(jobId)) return json({ ok: false, message: "Missing job" }, 400);
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
  if (req.method !== "POST") return json({ ok: false, message: "POST only" }, 405);
  const url = new URL(req.url);
  const at = url.pathname.indexOf("/" + FN);
  const sub = at >= 0 ? url.pathname.slice(at + FN.length + 1) : url.pathname;
  if (sub === "/app" || sub === "/app/") return handleApp(req);
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
