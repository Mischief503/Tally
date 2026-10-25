// Tally — the server side of the app (Supabase Edge Function, named tally-twilio for history)
// Text alerts, masked calling, callbacks to the office, the call/text log, quote distances,
// emergency alert texts, card payments through Stripe (on the platform's account or each company's
// own), and the membership each company pays Tally, with Tally admin.
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
//   POST /stripe         Stripe events (payments finishing or failing, pay links used, refunds, disputes,
//                        memberships)
//   POST /stripe/connect Stripe events on the companies' own (connected) accounts
//   GET  /p/<code>       a short payment link: sends the customer to a Stripe page for what they owe now
//   GET  /pay/done       where the customer lands after paying
//   GET  /connect/done, /connect/again   back from Stripe's sign-up for a company's own account
//   GET  /member/done, /member/back      back from Stripe's membership checkout and billing pages
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
// The owner's on/off switches (Setup › Options, settings.opt): a missing key is on.
export function optOff(S: J, k: string): boolean {
  return !!(S && S.opt && S.opt[k] === false);
}
// Crew confirm their jobs: off, nobody is asked to confirm and the office isn't told who hasn't.
function confirmOn(S: J): boolean { return !optOff(S, "confirm"); }
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
  if (rows && rows[0]) return { uid: u.id, role: rows[0].role, staff: rows[0].staff || "", email: String(u.email || "") };
  // Tally's call center team, in a company with the service (supabase-callcenter.sql)
  const cc = await ccAgentFor(u.id, org);
  return cc ? { uid: u.id, role: "callcenter", staff: cc.name, phone: cc.phone, email: String(u.email || ""), cc: true } : null;
}
// Someone on Tally's call center team working for this company ({name, phone}), or null: not on the team,
// the company hasn't the service, or the database hasn't supabase-callcenter.sql yet.
async function ccAgentFor(uid: string, org: string): Promise<J> {
  if (!uid || !org) return null;
  try {
    const [t, on] = await Promise.all([
      rest("GET", "tally_cc_team?select=name,email,phone&user_id=eq." + q(uid) + "&limit=1"),
      rest("GET", "cc_orgs?select=org_id&org_id=eq." + q(org) + "&limit=1"),
    ]);
    if (!(t && t[0] && on && on[0])) return null;
    return { name: String(t[0].name || "").trim() || String(t[0].email || "").split("@")[0] || "Call center", phone: String(t[0].phone || "") };
  } catch {
    return null;
  }
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
  // the job's trucks (the first is assign.truckId, any others assign.more) and who drives each
  const a = job.assign || {}, tids: string[] = [];
  if (a.truckId) tids.push(a.truckId);
  (Array.isArray(a.more) ? a.more : []).forEach((x: string) => { if (x && tids.indexOf(x) < 0) tids.push(x); });
  const trucks: J[] = tids.map((id) => ((S && S.trucks) || []).find((t: J) => t.id === id)).filter(Boolean);
  const drives = (n: string): J | undefined => optOff(S, "drivers") ? undefined : trucks.find((t: J) => (a.drivers || {})[t.id] === n);
  const C = contacts(S), out: J[] = [];
  const link = appLink(S, origin);

  if (alertOn(S, "assigned")) {
    for (const n of added) {
      const bits = [co + ": You're on " + name + ", " + when(d) + "."];
      if (d.from) bits.push("Pickup " + gsm(d.from) + ".");
      const mine = drives(n);
      if (mine) bits.push("You drive " + gsm(mine.name) + ".");
      else if (trucks.length) bits.push((trucks.length > 1 ? "Trucks " : "Truck ") + trucks.map((t: J) => gsm(t.name)).join(", ") + ".");
      if (lead && lead !== n) bits.push("Lead " + gsm(lead) + ".");
      if (confirmOn(S)) bits.push(link ? "Confirm in Tally: " + link : "Confirm in Tally under Job messages.");
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
          (!confirmOn(S) ? "" : link ? " Confirm the new time: " + link : " Confirm the new time in Tally.") }));
    }
  }
  return { ok: true, sent: out.filter((r) => r.status !== "failed" && r.status !== "no-number").length, log: out.map((r) => r.id) };
}

function pendingForms(S: J, job: J): J[] {
  if (optOff(S, "forms")) return [];   // Options › Signatures before payment is off
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
  if (!confirmOn(S)) return { ok: false, message: "Crew confirmations are off for this company (Setup › Options)." };
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
      const cfm = confirmOn(S), need = cfm && list.some((x: J) => !isConfirmed(x.job, n));
      const items = list.map((x: J) => { const d = x.job.d || {}; return gsm(d.name || "a job") + " at " + fmtTime(d.time) + (d.from ? " (" + gsm(d.from) + ")" : ""); }).join("; ");
      const body = co + ": Tomorrow you're on " + items + "." + (need ? (link ? " Please confirm: " + link : " Please confirm in Tally under Job messages.") : cfm ? " You're confirmed. See you there." : " See you there.");
      const r = await sendText({ org, line, jobId: list.length === 1 ? list[0].id : undefined, purpose: "tomorrow", staff: n, to: C[n], body: body.slice(0, 600) });
      if (r.status !== "failed" && r.status !== "no-number") sent++;
    }
    const unconf: string[] = [];
    jobs.forEach((x: J) => ((x.job.assign && x.job.assign.crew) || []).forEach((n: string) => { if (!isConfirmed(x.job, n)) unconf.push(n + " (" + ((x.job.d || {}).name || "a job") + ")"); }));
    const noCrew = jobs.filter((x: J) => !((x.job.assign && x.job.assign.crew) || []).length).map((x: J) => (x.job.d || {}).name || "a job");
    const summary = co + ": Tomorrow: " + jobs.length + " job" + (jobs.length === 1 ? "" : "s") + ", " + Object.keys(people).length + " people." +
      (!confirmOn(S) ? "" : unconf.length ? " Not confirmed yet: " + gsm(unconf.join(", ")) + "." : " Everyone has confirmed.") +
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
// At bill-out the start is where the truck is (the lead's phone), as a latitude and longitude.
export async function driveDistance(from: string | { lat: number; lng: number }, to: string): Promise<J> {
  const key = env("GOOGLE_MAPS_KEY");
  if (!key) return { ok: false, setup: true, message: "Distance lookup is not set up yet." };
  const here = typeof from === "object" && from !== null;
  const a = here ? "" : String(from || "").trim().slice(0, 200), b = String(to || "").trim().slice(0, 200);
  if ((!here && !a) || !b) return { ok: false, message: "Enter both addresses." };
  const origin = here ? { location: { latLng: { latitude: (from as J).lat, longitude: (from as J).lng } } } : { address: a };
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" },
    body: JSON.stringify({ origin, destination: { address: b }, travelMode: "DRIVE" }),
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
  // the call center calls customers on open quotes and on the schedule (what it can see)
  const cc = me.role === "callcenter" && ["lead", "quoted", "booked", "active"].indexOf(job.status) >= 0;
  if (!office && !onJob && !cc) return { ok: false, message: "You can only call customers on your own jobs." };
  // the call center's own phone is on Tally's team list, not in the company's contacts
  const mine = e164(me.cc ? me.phone : contacts(S)[me.staff]);
  if (!mine) return { ok: false, message: me.cc ? "Tally admin adds your phone number to the call center team first. The company line calls you, then connects you." : "Add your phone number in Setup first. The company line calls you, then connects you." };
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
   settled in cash, or lowered, can't be paid again from an old text.
   Whose Stripe account: the keys in Supabase are the platform's (Tally's owner). A company listed in
   pay_orgs takes payments on that account directly. Every other company connects its own Stripe
   account (Stripe Connect: Setup > Payments > Connect with Stripe), and its payments are made on that
   account ("direct charges", the Stripe-Account header): the money is the company's, it pays Stripe's
   fees, and Stripe carries the risk on it. Tally takes no cut: companies pay Tally a membership instead. pay_accounts says which account is whose, and every payment,
   pay link and card on file remembers the account it is on (`account`, '' for the platform). */
export const STRIPE_VERSION = "2026-09-30.endive";
export const STRIPE_V2_VERSION = STRIPE_VERSION;   // Stripe's v2 API (connected accounts, their sign-up links): generally available in this version
const ACCT_RE = /^acct_[A-Za-z0-9]{6,40}$/;
export const CONNECT_EVENTS = ["account.updated", "account.application.deauthorized"];
export const PAY_EVENTS = ["payment_intent.succeeded", "payment_intent.processing", "payment_intent.payment_failed",
  "payment_intent.canceled", "checkout.session.completed", "checkout.session.expired", "charge.refunded",
  "charge.refund.updated", "charge.dispute.created", "charge.dispute.closed", "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated"];
// the membership companies pay Tally: subscriptions on the platform's own account
export const MEMBER_EVENTS = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "invoice.paid", "invoice.payment_failed"];
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
// acct: a company's own (connected) Stripe account; '' for the platform's own
async function stripe(method: string, path: string, params?: J, idem?: string, acct = ""): Promise<J> {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new StripeError(0, { message: "Stripe is not set up yet." });
  const headers: Record<string, string> = { Authorization: "Bearer " + key, "Stripe-Version": STRIPE_VERSION };
  if (acct) {
    if (!ACCT_RE.test(acct)) throw new StripeError(0, { message: "Unknown Stripe account" });
    headers["Stripe-Account"] = acct;
  }
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
// Stripe's v2 API: JSON both ways. Used to make a company's own Stripe account and its sign-up link.
async function stripeV2(method: string, path: string, body?: J, idem?: string): Promise<J> {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new StripeError(0, { message: "Stripe is not set up yet." });
  const headers: Record<string, string> = { Authorization: "Bearer " + key, "Stripe-Version": STRIPE_V2_VERSION };
  if (body) headers["Content-Type"] = "application/json";
  if (idem) headers["Idempotency-Key"] = idem;
  const r = await fetch("https://api.stripe.com/v2/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
  return (await rest("GET", "pay_log?select=pi,amount_cents,refunded_cents,disputed_cents,status,livemode,source,account&org_id=eq." + q(org) + "&job_id=eq." + q(jobId))) || [];
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
// S given: the owner's switches too (Dispatch can take payments, Crew leads collect payment)
function canTakePay(me: J, job: J, S?: J): boolean {
  if (me.role === "owner") return true;
  if (me.role === "dispatch") return !(S && optOff(S, "dispatchPay"));
  return me.role === "lead" && ((job.assign && job.assign.crew) || []).indexOf(me.staff) >= 0 && !(S && optOff(S, "leadPay"));
}
async function payOrgOn(org: string): Promise<boolean> {
  const rows = await rest("GET", "pay_orgs?select=enabled&org_id=eq." + q(org) + "&limit=1");
  return !!(rows && rows[0] && rows[0].enabled);
}
// The company's own Stripe account in this mode (test or live), if it has connected one.
async function acctRow(org: string): Promise<J> {
  const rows = await rest("GET", "pay_accounts?select=*&org_id=eq." + q(org) + "&livemode=eq." + liveNow() + "&is_current=is.true&limit=1");
  return (rows && rows[0]) || null;
}
// Where a company's card payments go: {on, acct} ('' = the platform's own account), or why not.
async function payAccount(org: string): Promise<J> {
  if (await payOrgOn(org)) return { on: true, acct: "" };
  const row = await acctRow(org);
  if (!row) return { on: false, reason: "connect" };
  if (row.disabled_reason === "disconnected") return { on: false, reason: "connect-off", row };
  if (!row.charges_enabled) return { on: false, reason: "connect-pending", row };
  return { on: true, acct: row.account_id, row };
}
// why a company can't take cards, in words for the person trying
function payOffWhy(reason: string): string {
  if (reason === "connect-pending") return "Stripe is still checking this company's details, so cards can't be taken yet. The owner sees what's left in Setup › Payments.";
  if (reason === "connect-off") return "This company's Stripe account was disconnected from Tally. The owner connects it again in Setup › Payments.";
  return "Card payments aren't set up for this company yet. The owner connects Stripe in Setup › Payments.";
}
// The account a company takes payments on now: '' (the platform's) or its connected account; null when neither.
async function currentAcct(org: string): Promise<string | null> {
  if (await payOrgOn(org)) return "";
  const row = await acctRow(org);
  return row ? row.account_id : null;
}
// A payment made on a company's own Stripe account is only written onto that company's jobs.
async function acctIsOrgs(org: string, acct: string): Promise<boolean> {
  const rows = await rest("GET", "pay_accounts?select=account_id&account_id=eq." + q(acct) + "&org_id=eq." + q(org) + "&limit=1");
  return !!(rows && rows[0]);
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
  const pa = await payAccount(org);
  if (!pa.on) return { err: payOffWhy(pa.reason) };
  const [S, job] = await Promise.all([getDoc(org, "org/settings"), getDoc(org, "jobs/" + jobId)]);
  if (!job) return { err: "That job is not available." };
  if (!canTakePay(me, job, S)) {
    const off = (me.role === "lead" && optOff(S, "leadPay")) || (me.role === "dispatch" && optOff(S, "dispatchPay"));
    return { status: 403, err: off ? (me.role === "lead" ? "The office collects payments in this company." : "Only the owner takes payments in this company.")
      : me.role === "lead" ? "You can only take payments on your own jobs." : "Crew leads and the office take payments." };
  }
  if (job.test && liveNow()) return { err: "Test job: no real charges." };
  if (job.status === "lost") return { err: "This job is marked lost." };
  if ((job.status === "active" || job.status === "done") && pendingForms(S, job).length) return { err: "The customer signs the required forms first." };
  return { S, job, acct: pa.acct };
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

/* the server's own webhooks, made once per mode (test, live) the first time each is needed:
   - "platform": events on the platform's own Stripe account, at /stripe (table pay_config);
   - "connect": events on the companies' own (connected) accounts, at /stripe/connect (pay_config_connect),
     with the company's account in each event. */
type HookKind = "platform" | "connect";
const HOOKS: Record<HookKind, J> = {
  platform: { table: "pay_config", path: "/stripe", events: PAY_EVENTS.concat(MEMBER_EVENTS), description: "Tally payments" },
  connect: { table: "pay_config_connect", path: "/stripe/connect", events: PAY_EVENTS.concat(CONNECT_EVENTS), description: "Tally payments (companies' own Stripe accounts)" },
};
async function webhookSecrets(kind: HookKind = "platform"): Promise<string[]> {
  const out: string[] = [];
  if (kind === "platform" && env("STRIPE_WEBHOOK_SECRET")) out.push(env("STRIPE_WEBHOOK_SECRET"));
  const rows = await rest("GET", HOOKS[kind].table + "?select=webhook_secret,status");
  (rows || []).forEach((r: J) => { if (r.status === "ready" && r.webhook_secret) out.push(r.webhook_secret); });
  return out;
}
export async function ensureWebhook(kind: HookKind = "platform"): Promise<J> {
  if (kind === "platform" && env("STRIPE_WEBHOOK_SECRET")) return { ok: true };
  const mode = stripeMode();
  if (!mode) return { ok: false, message: "Card payments are not set up yet." };
  const H = HOOKS[kind], T = H.table, list0: string[] = H.events, events = list0.join(","), url = base() + H.path;
  const rows = await rest("GET", T + "?select=*&mode=eq." + mode + "&limit=1");
  const row = rows && rows[0];
  if (row && row.status === "ready" && row.webhook_secret) {
    // every few hours, and after an update that listens for more events, check the webhook is still there
    // and current (someone may have deleted or switched it off in Stripe)
    if (row.events === events && Date.now() - Date.parse(row.updated_at) < 6 * 3600e3) return { ok: true };
    let gone = false;
    try {
      const w = await stripe("GET", "webhook_endpoints/" + row.webhook_id);
      gone = !w || w.status === "disabled" || w.url !== url;
      if (!gone && (w.enabled_events || []).slice().sort().join(",") !== list0.slice().sort().join(",")) {
        await stripe("POST", "webhook_endpoints/" + row.webhook_id, { enabled_events: list0 });
      }
    } catch (e) {
      if (!(e instanceof StripeError && e.status === 404)) { console.error("stripe webhook check", e); return { ok: true }; }
      gone = true;
    }
    if (!gone) {
      await rest("PATCH", T + "?mode=eq." + mode, { events, updated_at: nowIso() });
      return { ok: true };
    }
  }
  const busy = { ok: false, message: "Card payments are being switched on. Try again in a minute." };
  if (row && Date.now() - Date.parse(row.updated_at) < 60e3) return busy;
  // claim the job of making it, so two phones starting payments at once don't make two webhooks
  const now = nowIso();
  const claimed = row
    ? await rest("PATCH", T + "?mode=eq." + mode + "&updated_at=eq." + q(row.updated_at), { status: "creating", updated_at: now }, "return=representation")
    : await rest("POST", T + "?on_conflict=mode", { mode, status: "creating", updated_at: now }, "resolution=ignore-duplicates,return=representation");
  if (!claimed || !claimed.length) return busy;
  try {
    const list = await stripe("GET", "webhook_endpoints", { limit: 100 });
    for (const w of (list && list.data) || []) if (w && w.url === url) await stripe("DELETE", "webhook_endpoints/" + w.id);
    const w = await stripe("POST", "webhook_endpoints", { url, enabled_events: list0, api_version: STRIPE_VERSION, description: H.description, connect: kind === "connect" ? true : undefined });
    if (!w || !w.secret) throw new StripeError(0, { message: "Stripe did not return a webhook secret" });
    await rest("PATCH", T + "?mode=eq." + mode, { webhook_id: w.id, webhook_secret: w.secret, status: "ready", events, updated_at: nowIso() });
    return { ok: true, created: true };
  } catch (e) {
    console.error("stripe webhook setup", kind, e);
    await rest("PATCH", T + "?mode=eq." + mode, { status: "creating", updated_at: new Date(0).toISOString() });
    return { ok: false, message: "Could not finish switching on card payments. " + stripeTrouble(e) };
  }
}
// the webhook a company's payments need: the platform's, or the one for companies' own accounts
const hookFor = (acct: string) => ensureWebhook(acct ? "connect" : "platform");
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

/* the Stripe customer behind a Tally customer (one per company, per test/live, per Stripe account: a
   customer lives on the account its payments are made on, so on a company's own account it is filed
   under "<account>|<key>") */
async function customerFor(org: string, job: J, jobId: string, acct = ""): Promise<string> {
  const key = payKeyOf(job, jobId), live = liveNow(), ck = acct ? acct + "|" + key : key;
  const find = () => rest("GET", "pay_customers?select=customer_id&org_id=eq." + q(org) + "&cust_key=eq." + q(ck) + "&livemode=eq." + live + "&limit=1");
  const rows = await find();
  if (rows && rows[0]) return rows[0].customer_id;
  const d = job.d || {};
  const c = await stripe("POST", "customers", {
    name: String(d.name || "").trim().slice(0, 200) || undefined, phone: e164(d.phone) || undefined,
    email: validEmail(d.email) || undefined, metadata: { tally_org: org, tally_cust: key.slice(0, 400) },
  }, undefined, acct);
  await rest("POST", "pay_customers?on_conflict=org_id,cust_key,livemode", { org_id: org, cust_key: ck, customer_id: c.id, livemode: live, account: acct }, "resolution=ignore-duplicates");
  const again = await find();
  return (again && again[0] && again[0].customer_id) || c.id;
}
// The Stripe customer a job's payments go to. The job's first payment that goes through fixes it (see
// recordIntent), so a name or phone changed afterwards can't point the job at someone else's cards. If the
// company has moved to another Stripe account since, the customer there is found again the same way.
async function jobCustomer(org: string, jobId: string, job: J, acct = ""): Promise<J> {
  const live = liveNow();
  const row = ((await rest("GET", "pay_jobs?select=cust_key,customer_id,account&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&livemode=eq." + live + "&limit=1")) || [])[0];
  if (row && (row.account || "") === acct) return { customer: row.customer_id, key: row.cust_key, bound: true };
  return { customer: await customerFor(org, job, jobId, acct), key: payKeyOf(job, jobId), bound: false };
}

/* cards kept on file: the server keeps which Stripe card each is (pay_cards); the app's list shows the
   brand, last four, expiry and the name on the card, and the jobs it was kept on */
// the app knows a card by a name of our own, never by Stripe's ids
export async function cardId(pmId: string): Promise<string> { return "st_" + (await sha("card|" + pmId)).slice(0, 20); }
async function saveCard(org: string, md: J, pi: J, pm: J, jobId: string, acct = ""): Promise<void> {
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
  await rest("POST", "pay_cards?on_conflict=id", { id, org_id: org, cust_key: cust, customer_id: customer, pm_id: pm.id, fingerprint: fp, name, job_id: jobId, livemode: live, account: acct }, "resolution=merge-duplicates");
  if (!newer) for (const r of dupes) if (r.id !== id) await rest("DELETE", "docs?org_id=eq." + q(org) + "&path=eq." + q("vault/" + r.id));
}

/* writing a payment down */
const WITHHELD = ["needs_response", "under_review", "lost"];   // disputes where Stripe has taken the money back
async function disputeOf(pid: string, acct = ""): Promise<J> {
  const list = await stripe("GET", "disputes", { payment_intent: pid, limit: 10 }, undefined, acct);
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
// Safe to call any number of times for the same payment, in any order. acct: the Stripe account the payment is
// on ('' for the platform's own).
export async function recordIntent(pi0: J, acct = ""): Promise<J> {
  let pi = pi0 || {};
  if (!pi.id || !/^pi_[A-Za-z0-9_]+$/.test(String(pi.id))) return { ok: false, skipped: "no-intent" };
  const whole = pi.metadata && pi.payment_method !== undefined && typeof pi.payment_method !== "string" &&
    pi.latest_charge !== undefined && typeof pi.latest_charge !== "string";
  if (!whole) pi = await stripe("GET", "payment_intents/" + pi.id, { expand: ["payment_method", "latest_charge"] }, undefined, acct);
  const md = pi.metadata || {};
  const org = String(md.tally_org || ""), jobId = String(md.tally_job || "");
  if (!/^[0-9A-Fa-f-]{36}$/.test(org) || !/^[A-Za-z0-9_-]{1,40}$/.test(jobId)) return { ok: false, skipped: "not-tally" };
  if (!(await orgExists(org))) return { ok: false, skipped: "no-company" };
  // a company's own Stripe account can write a payment's details itself (its owner has the Stripe
  // dashboard): its payments only ever land on that company's jobs
  if (acct && !(await acctIsOrgs(org, acct))) return { ok: false, skipped: "other-account" };
  const pm = pi.payment_method && typeof pi.payment_method === "object" ? pi.payment_method : null;
  const ch = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const status = String(pi.status || ""), live = !!pi.livemode, paidNow = status === "succeeded" || status === "processing";
  const label = methodLabel(pm) + (md.tally_src === "link" ? " (pay link)" : "") + (live ? "" : " · test");
  const amtC = status === "succeeded" ? (Number(pi.amount_received) || Number(pi.amount) || 0) : (Number(pi.amount) || 0);
  const refunded = paidNow && ch ? Math.min(amtC, Number(ch.amount_refunded) || 0) : 0;
  const dispute = paidNow && ch && ch.disputed ? await disputeOf(pi.id, acct) : { cents: 0, lost: false };
  const disputed = Math.min(amtC - refunded, dispute.cents);
  const err = pi.last_payment_error ? String(pi.last_payment_error.message || pi.last_payment_error.code || "").slice(0, 300) : null;
  await rest("POST", "pay_log?on_conflict=pi", {
    pi: pi.id, org_id: org, job_id: jobId, amount_cents: amtC, refunded_cents: refunded, disputed_cents: disputed, status,
    source: String(md.tally_src || ""), method: label, cust_key: String(md.tally_cust || ""), by_staff: String(md.tally_by || ""),
    livemode: live, error: err, updated_at: nowIso(), account: acct,
  }, "resolution=merge-duplicates");
  const cus = typeof pi.customer === "string" ? pi.customer : pi.customer && pi.customer.id;
  if (paidNow && cus) {
    const bind = { cust_key: String(md.tally_cust || ""), customer_id: cus, account: acct };
    await rest("POST", "pay_jobs?on_conflict=org_id,job_id,livemode", { org_id: org, job_id: jobId, livemode: live, ...bind }, "resolution=ignore-duplicates");
    // the company moved to another Stripe account since the job's first payment: its first payment there binds it
    // again (a refund on an old payment, written down later, doesn't move it back)
    if (acct === await currentAcct(org)) {
      await rest("PATCH", "pay_jobs?org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&livemode=eq." + live + "&account=neq." + q(acct), bind);
    }
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
    if (status === "succeeded") await saveCard(org, md, pi, pm, jobId, acct);
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
  if (status === "succeeded") await saveCard(org, md, pi, pm, jobId, acct);
  return { ok: true, org, job: jobId, recorded: true, status, label, amount: amtC / 100, owed: Math.max(0, bal) };
}
// A card payment that was started and never finished: cancelled, so it can't be finished later on top of
// another payment.
async function cancelIntent(pi: J, acct = ""): Promise<void> {
  try {
    await recordIntent(await stripe("POST", "payment_intents/" + pi.id + "/cancel", { cancellation_reason: "abandoned", expand: ["payment_method", "latest_charge"] }, undefined, acct), acct);
  } catch (e) {
    if (!stripeNo(e)) throw e;
    await recordIntent({ id: pi.id }, acct);   // it moved on (paid, or already cancelled): write down where it is now
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
    if (missing) { await recordIntent({ id: r.pi }, r.account || ""); n++; }
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
  const acct = o.acct || "";
  const s = await stripe("POST", "checkout/sessions", {
    mode: "payment", customer: o.cus, client_reference_id: o.jobId,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: o.amt, product_data: { name: (company(o.S) + ": moving services").slice(0, 120), description: gsm(d.name || "Moving job").slice(0, 200) } } }],
    payment_intent_data: { metadata: md, description: payWhat(o.S, o.job), receipt_email: validEmail(d.email) || undefined },
    payment_method_options: o.save ? { card: { setup_future_usage: "off_session" } } : undefined,
    metadata: md, success_url: base() + "/pay/done", expires_at: exp,
  }, undefined, acct);
  if (!s.expires_at) s.expires_at = exp;
  return s;
}
// A pay link's Stripe page was paid: the link is done, and the payment is written down now.
async function sessionPaid(l: J, s: J): Promise<void> {
  await rest("PATCH", "pay_links?token=eq." + q(l.token) + "&status=eq.open", { status: "paid" });
  const pid = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent && s.payment_intent.id;
  if (pid) await recordIntent({ id: pid }, l.account || "");
}
// Stops a Stripe page. "closed"; "paid" when the customer had just paid on it (written down now); or "open"
// when Stripe wouldn't stop it, most likely because a payment on it is going through.
async function closeSession(l: J): Promise<string> {
  const acct = l.account || "";
  try {
    await stripe("POST", "checkout/sessions/" + l.session_id + "/expire", undefined, undefined, acct);
    return "closed";
  } catch (e) {
    if (!stripeNo(e)) throw e;
    let s: J = null;
    try { s = await stripe("GET", "checkout/sessions/" + l.session_id, undefined, undefined, acct); } catch (e2) { if (!stripeNo(e2)) throw e2; }
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
// A new Stripe page behind a pay link, for amt, on the Stripe account the company takes payments on now (acct).
async function renewPage(l: J, job: J, S: J, amt: number, acct = ""): Promise<J> {
  if (pageUsable(l)) {
    const r = await closeSession(l);
    if (r !== "closed") return { state: r };
  }
  const cus = (await jobCustomer(l.org_id, l.job_id, job, acct)).customer;
  const s = await mintSession({ org: l.org_id, jobId: l.job_id, job, S, by: l.created_by || "", token: l.token, amt, save: !!l.save_card, cus, until: Date.parse(l.expires_at), acct });
  const patch = { session_id: s.id, url: s.url, amount_cents: amt, session_expires: new Date(s.expires_at * 1000).toISOString(), account: acct };
  const kept = await rest("PATCH", "pay_links?token=eq." + q(l.token) + "&status=eq.open", patch, "return=representation");
  if (!kept || !kept.length) {   // the link was replaced or paid meanwhile: its new page must not stay open
    await stripe("POST", "checkout/sessions/" + s.id + "/expire", undefined, undefined, acct).catch(() => {});
    return { state: "gone" };
  }
  return { state: "ready", link: { ...l, ...patch } };
}
// a pay link's current page is on the account the company takes payments on now
const pageOn = (l: J, acct: string) => (l.account || "") === acct;

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
  const rows = (await rest("GET", "pay_log?select=pi,status,livemode,account&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) +
    "&status=in.(requires_payment_method,requires_confirmation,requires_action,processing)")) || [];
  for (const r of rows) {
    if (!!r.livemode !== live) continue;   // the other mode's payments can't be looked up with this key
    const acct = r.account || "";
    let pi: J;
    try {
      pi = await stripe("GET", "payment_intents/" + r.pi, { expand: ["payment_method", "latest_charge"] }, undefined, acct);
    } catch (e) {
      if (!(e instanceof StripeError && e.status === 404)) throw e;
      await rest("PATCH", "pay_log?pi=eq." + q(r.pi), { status: "canceled", updated_at: nowIso() });
      continue;
    }
    await recordIntent(pi, acct);
    const md = pi.metadata || {};
    // a pay link's payment belongs to its Stripe page, which is stopped by closing the page (Stripe
    // doesn't let Checkout's payments be cancelled on their own)
    if (OPEN_PI.indexOf(pi.status) < 0 || md.tally_src === "link") continue;
    const stale = Date.now() - (Number(pi.created) || 0) * 1000 > STALE_MS;
    const mine = !!o.me && (md.tally_uid ? md.tally_uid === o.me.uid : md.tally_by === who(o.me));
    if (stale || md.tally_src === "saved" || pi.last_payment_error || mine) await cancelIntent(pi, acct);
    else if (o.me || o.reserve) { reserved += Number(pi.amount) || 0; inflight.push({ pi, acct }); }
  }
  const links = (await rest("GET", "pay_links?select=*&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&status=eq.open")) || [];
  for (const l of links) {
    if (!pageUsable(l)) continue;
    let s: J = null;
    try { s = await stripe("GET", "checkout/sessions/" + l.session_id, undefined, undefined, l.account || ""); } catch (e) { if (!stripeNo(e)) throw e; }
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

/* a company's own Stripe account (Stripe Connect) */
// what the app shows about it, from Stripe's account (the v1 view of it, which Stripe keeps for v2 accounts too)
export function acctState(a: J): J {
  const req = (a && a.requirements) || {};
  const due = ([] as string[]).concat(req.past_due || [], req.currently_due || []).map(String).filter((x, i, l) => l.indexOf(x) === i).slice(0, 30);
  return { charges_enabled: !!(a && a.charges_enabled), payouts_enabled: !!(a && a.payouts_enabled), details_submitted: !!(a && a.details_submitted),
    due, disabled_reason: String(req.disabled_reason || "").slice(0, 200) };
}
// brings the row up to date with Stripe when it is older than minAge ms; the old row if Stripe can't say
async function acctRefresh(row: J, minAge = 20e3): Promise<J> {
  if (Date.now() - (Number(Date.parse(row.updated_at)) || 0) < minAge) return row;
  try {
    const st = { ...acctState(await stripe("GET", "accounts/" + row.account_id)), updated_at: nowIso() };
    await rest("PATCH", "pay_accounts?account_id=eq." + q(row.account_id), st);
    return { ...row, ...st };
  } catch (e) {
    console.error("stripe account", e);
    return row;
  }
}
function connectView(row: J): J {
  const state = row.disabled_reason === "disconnected" ? "disconnected" : row.charges_enabled ? "ready" : row.details_submitted ? "review" : "started";
  return { state, due: row.due || [], disabled: row.disabled_reason || "", payouts: !!row.payouts_enabled };
}

/* the app's payment actions */
// Whether this company can take cards now, on which account, and (for a company's own account) where its
// Stripe sign-up stands. refresh: ask Stripe now (the owner just came back from Stripe's sign-up).
export async function payConfig(org: string, b: J = {}): Promise<J> {
  const mode = stripeMode(), test = mode === "test";
  if (!mode) return { ok: true, ready: false, test: false, publishableKey: "", reason: "no-key" };
  const pk = publishableKey();
  if (await payOrgOn(org)) return { ok: true, ready: true, test, publishableKey: pk, account: "", via: "platform", reason: pk ? "" : "no-pk" };
  let row = await acctRow(org);
  if (!row) return { ok: true, ready: false, test, publishableKey: "", reason: "connect", connect: { state: "none", due: [] } };
  // asked to (the owner is back from Stripe's sign-up, or pressed Check again): at most every 3 seconds
  if ((!row.charges_enabled || b.refresh) && row.disabled_reason !== "disconnected") row = await acctRefresh(row, b.refresh ? 3e3 : 20e3);
  const connect = connectView(row);
  if (connect.state === "disconnected") return { ok: true, ready: false, test, publishableKey: "", reason: "connect-off", connect };
  if (!row.charges_enabled) return { ok: true, ready: false, test, publishableKey: "", reason: "connect-pending", connect };
  return { ok: true, ready: true, test, publishableKey: pk, account: row.account_id, via: "connect", reason: pk ? "" : "no-pk", connect };
}
// The owner connects the company's own Stripe account: Tally asks Stripe to make one (or picks up the one
// started before) and hands back Stripe's own sign-up page, where the owner gives Stripe the business
// details, the bank account for payouts and an ID check. Tally never sees those.
export async function payConnect(org: string, me: J): Promise<J> {
  if (me.role !== "owner") return { ok: false, status: 403, message: "Only the owner connects the company's Stripe account." };
  const mode = stripeMode();
  if (!mode) return { ok: false, message: "Card payments are not set up yet." };
  if (await payOrgOn(org)) return { ok: false, message: "This company already takes card payments on Tally's own Stripe account." };
  const wh = await ensureWebhook("connect");
  if (!wh.ok) return wh;
  let row = await acctRow(org);
  if (row && row.disabled_reason === "disconnected") {   // disconnected from Tally in Stripe: start again with a new account
    await rest("PATCH", "pay_accounts?account_id=eq." + q(row.account_id), { is_current: false });
    row = null;
  }
  if (!row) {
    const live = liveNow(), S = await getDoc(org, "org/settings");
    const tries = ((await rest("GET", "pay_accounts?select=account_id&org_id=eq." + q(org) + "&livemode=eq." + live)) || []).length;
    const a = await stripeV2("POST", "core/accounts", {
      display_name: company(S).slice(0, 100), contact_email: validEmail(me.email) || undefined, dashboard: "full",
      identity: { country: "us" },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { currency: "usd", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" }, locales: ["en-US"] },
    }, "tally-acct-" + org + "-" + mode + "-" + tries);   // two taps make one account
    if (!a || !ACCT_RE.test(String(a.id || ""))) return { ok: false, message: "Stripe did not make the account. Try again in a minute." };
    await rest("POST", "pay_accounts?on_conflict=account_id", { account_id: a.id, org_id: org, livemode: live, is_current: true, created_by: who(me), updated_at: new Date(0).toISOString() }, "resolution=ignore-duplicates");
    row = (await acctRow(org)) || { account_id: a.id, updated_at: new Date(0).toISOString() };
  }
  row = await acctRefresh(row, 0);
  if (row.charges_enabled && row.details_submitted) return { ok: true, done: true, message: "Your Stripe account is connected. Manage it at dashboard.stripe.com." };
  const link = await stripeV2("POST", "core/account_links", {
    account: row.account_id,
    use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], refresh_url: base() + "/connect/again", return_url: base() + "/connect/done" } },
  });
  if (!link || !/^https:\/\//.test(String(link.url || ""))) return { ok: false, message: "Stripe did not give a sign-up link. Try again in a minute." };
  return { ok: true, url: link.url };
}
/* ---------- the membership: what each company pays Tally every month ----------
   A company starts with a free trial (tally_plan.trial_days, set when it is made). The owner starts the
   membership on Stripe's own checkout page (a Stripe subscription on the platform's account, with the
   rest of the trial still free) and manages the card and invoices on Stripe's billing page. Tally's
   admins (tally_admins) see every company and set, per company, a test company (never pays), the fee
   waived, or a discount; they also set the price and the trial for new companies. A discount is a
   Stripe coupon on the subscription; waived and test companies get the 100% coupon, so a membership
   already running stops charging and starts again by itself if the switch goes off. Nobody is locked
   out when a trial ends: the owner is reminded. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_SUB = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];
const toIso = (s: unknown) => (Number(s) > 0 ? new Date(Number(s) * 1000).toISOString() : null);
async function isAdmin(uid: string): Promise<boolean> {
  if (!UUID_RE.test(String(uid || ""))) return false;
  const rows = await rest("GET", "tally_admins?select=user_id&user_id=eq." + q(uid) + "&limit=1");
  return !!(rows && rows[0]);
}
async function planRow(): Promise<J> {
  const rows = await rest("GET", "tally_plan?select=monthly_cents,trial_days&id=eq.1&limit=1");
  const p = (rows && rows[0]) || {};
  return { monthly_cents: Number(p.monthly_cents) || 14900, trial_days: p.trial_days == null ? 14 : Number(p.trial_days) };
}
async function dealOf(org: string): Promise<J> {
  const rows = await rest("GET", "member_deals?select=*&org_id=eq." + q(org) + "&limit=1");
  return (rows && rows[0]) || { org_id: org, is_test: false, waived: false, discount_pct: 0, note: "" };
}
async function subOf(org: string, live = liveNow()): Promise<J> {
  const rows = await rest("GET", "member_subs?select=*&org_id=eq." + q(org) + "&livemode=eq." + live + "&limit=1");
  return (rows && rows[0]) || null;
}
async function orgRow(org: string): Promise<J> {
  const rows = await rest("GET", "orgs?select=id,name,created_at,trial_ends&id=eq." + q(org) + "&limit=1");
  return (rows && rows[0]) || null;
}
// Where a company stands. Pure, so the app's wording and the tests agree with the server.
export function memberState(org: J, deal: J, sub: J, plan: J, now = Date.now()): J {
  const d = deal || {}, s = sub || {};
  const pct = Math.max(0, Math.min(100, Math.round(Number(d.discount_pct) || 0)));
  const list = Number(plan && plan.monthly_cents) || 14900;
  const out: J = { list_cents: list, discount_pct: pct, price_cents: Math.round(list * (100 - pct) / 100), trial_ends: (org && org.trial_ends) || null };
  if (d.is_test) return { ...out, state: "test" };
  if (d.waived) return { ...out, state: "waived" };
  const st = String(s.status || "");
  if (s.subscription_id && LIVE_SUB.indexOf(st) >= 0) {
    return { ...out, state: st === "trialing" ? "trialing" : st === "active" ? "active" : st === "paused" ? "paused" : "past_due",
      period_end: s.current_period_end || null, cancel_at_period_end: !!s.cancel_at_period_end, billing_trial_end: s.trial_end || null };
  }
  const ends = Date.parse(String((org && org.trial_ends) || "")) || 0;
  return { ...out, state: ends > now ? "trial" : "ended", canceled: st === "canceled" };
}
// the subscription as Stripe has it, written down for the company it belongs to
async function memberFromSub(org: string, s: J): Promise<void> {
  if (!UUID_RE.test(org) || !s || !/^sub_/.test(String(s.id || ""))) return;
  const live = !!s.livemode, cur = await subOf(org, live);
  const curLive = cur && cur.subscription_id && cur.subscription_id !== s.id && LIVE_SUB.indexOf(String(cur.status)) >= 0;
  if (curLive && LIVE_SUB.indexOf(String(s.status)) >= 0) {
    // a second membership for the same company (two checkout pages paid): stop it, keep the first
    console.error("second membership subscription for", org, s.id, "kept", cur.subscription_id);
    await stripe("DELETE", "subscriptions/" + s.id).catch((e) => console.error("cancel second membership", e));
    return;
  }
  if (curLive) return;   // an old subscription's late event: the current one stays
  const it = (s.items && s.items.data && s.items.data[0]) || {};
  const row: J = { org_id: org, livemode: live, customer_id: String(typeof s.customer === "string" ? s.customer : (s.customer && s.customer.id) || ""),
    subscription_id: s.id, status: String(s.status || ""), price_id: String((it.price && it.price.id) || ""),
    current_period_end: toIso(it.current_period_end || s.current_period_end), cancel_at_period_end: !!s.cancel_at_period_end,
    trial_end: toIso(s.trial_end), updated_at: nowIso() };
  if (LIVE_SUB.indexOf(row.status) >= 0) Object.assign(row, { checkout_id: "", checkout_url: "", checkout_expires: null });
  await rest("POST", "member_subs?on_conflict=org_id,livemode", row, "resolution=merge-duplicates");
}
async function memberFromSession(org: string, cs: J): Promise<void> {
  const sid = typeof cs.subscription === "string" ? cs.subscription : cs.subscription && cs.subscription.id;
  if (!sid) return;
  await memberFromSub(org, await stripe("GET", "subscriptions/" + sid));
}
// Which company a Stripe subscription or customer is: our own label on it, else the customer we filed.
async function memberOrgOf(o: J): Promise<string> {
  const md = (o && o.metadata) || {};
  if (UUID_RE.test(String(md.tally_member || ""))) return String(md.tally_member);
  const cus = typeof o.customer === "string" ? o.customer : o.customer && o.customer.id;
  if (!/^cus_/.test(String(cus || ""))) return "";
  const rows = await rest("GET", "member_subs?select=org_id&customer_id=eq." + q(cus) + "&limit=1");
  return (rows && rows[0] && rows[0].org_id) || "";
}
// Stripe events about memberships (on the platform's own webhook). True when it was one.
async function memberEvent(type: string, o: J): Promise<boolean> {
  if (type === "checkout.session.completed" || type === "checkout.session.expired") {
    if (o.mode !== "subscription" && !(o.metadata && o.metadata.tally_member)) return false;
    const org = await memberOrgOf(o);
    if (!org || !(await orgExists(org))) return true;
    if (type === "checkout.session.completed") await memberFromSession(org, o);
    else await rest("PATCH", "member_subs?org_id=eq." + q(org) + "&checkout_id=eq." + q(String(o.id || "")), { checkout_id: "", checkout_url: "", checkout_expires: null, updated_at: nowIso() });
    return true;
  }
  if (/^customer\.subscription\./.test(type)) {
    const org = await memberOrgOf(o);
    if (org && await orgExists(org)) await memberFromSub(org, await stripe("GET", "subscriptions/" + o.id));
    return true;
  }
  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const det = (o.parent && o.parent.subscription_details) || {};
    const sid = typeof det.subscription === "string" ? det.subscription : (det.subscription && det.subscription.id) || (typeof o.subscription === "string" ? o.subscription : "");
    if (!/^sub_/.test(String(sid || ""))) return true;
    const s = await stripe("GET", "subscriptions/" + sid);
    const org = await memberOrgOf(s);
    if (org && await orgExists(org)) await memberFromSub(org, s);
    return true;
  }
  return false;
}
// what the server made in Stripe for the membership, per mode
async function planId(mode: string, kind: string): Promise<string> {
  const rows = await rest("GET", "tally_plan_stripe?select=stripe_id&mode=eq." + mode + "&kind=eq." + q(kind) + "&limit=1");
  return (rows && rows[0] && rows[0].stripe_id) || "";
}
async function planKeep(mode: string, kind: string, id: string): Promise<void> {
  await rest("POST", "tally_plan_stripe?on_conflict=mode,kind", { mode, kind, stripe_id: id, updated_at: nowIso() }, "resolution=merge-duplicates");
}
async function planPrice(mode: string, cents: number): Promise<string> {
  const kind = "price:" + cents, have = await planId(mode, kind);
  if (have) return have;
  let product = await planId(mode, "product");
  if (!product) {
    const p = await stripe("POST", "products", { name: "Tally membership", description: "Tally moving-company software, per company, monthly", metadata: { tally: "membership" } }, "tally-product-" + mode);
    product = p.id;
    await planKeep(mode, "product", product);
  }
  const pr = await stripe("POST", "prices", { product, unit_amount: cents, currency: "usd", recurring: { interval: "month" }, nickname: "Tally membership " + money(cents) + "/month", metadata: { tally: "membership" } }, "tally-price-" + mode + "-" + cents);
  await planKeep(mode, kind, pr.id);
  return pr.id;
}
async function planCoupon(mode: string, pct: number): Promise<string> {
  const kind = "coupon:" + pct, have = await planId(mode, kind);
  if (have) return have;
  const id = "tally-pct-" + pct;
  try {
    await stripe("POST", "coupons", { id, percent_off: pct, duration: "forever", name: pct === 100 ? "Tally: no charge" : "Tally discount " + pct + "%" });
  } catch (e) {
    if (!(e instanceof StripeError && e.status === 400 && /already exists/i.test(e.message))) throw e;
  }
  await planKeep(mode, kind, id);
  return id;
}
// The company's membership subscription takes the discount it should have now (100% when waived or test).
async function memberSyncDiscount(org: string): Promise<void> {
  const mode = stripeMode();
  if (!mode) return;
  const sub = await subOf(org);
  if (!sub || !sub.subscription_id || LIVE_SUB.indexOf(String(sub.status)) < 0) return;
  const d = await dealOf(org);
  const pct = d.is_test || d.waived ? 100 : Math.max(0, Math.min(100, Math.round(Number(d.discount_pct) || 0)));
  const s = await stripe("POST", "subscriptions/" + sub.subscription_id, { discounts: pct > 0 ? [{ coupon: await planCoupon(mode, pct) }] : "", proration_behavior: "none" });
  await memberFromSub(org, s);
}
// Any member: whether this is a test company and whether you're a Tally admin. The owner also gets the
// membership. refresh: ask Stripe now (the owner is back from Stripe's page).
export async function memberStatus(org: string, me: J, b: J = {}): Promise<J> {
  const admin = await isAdmin(me.uid), o = await orgRow(org);
  if (!o) return { ok: false, message: "Company not found." };
  const [deal, plan] = await Promise.all([dealOf(org), planRow()]);
  const out: J = { ok: true, admin, test: !!deal.is_test, name: o.name };
  if (me.role !== "owner") return out;
  let sub = stripeMode() ? await subOf(org) : null;
  if (b.refresh && sub && stripeMode()) {
    try {
      if (sub.subscription_id) await memberFromSub(org, await stripe("GET", "subscriptions/" + sub.subscription_id));
      else if (sub.checkout_id) {
        const cs = await stripe("GET", "checkout/sessions/" + sub.checkout_id);
        if (cs && cs.status === "complete") await memberFromSession(org, cs);
      }
      sub = await subOf(org);
    } catch (e) { console.error("membership refresh", e); }
  }
  return { ...out, ...memberState(o, deal, sub, plan), billing: !!(sub && sub.customer_id), payments: !!stripeMode() };
}
// The owner starts the membership on Stripe's checkout page.
export async function memberStart(org: string, me: J): Promise<J> {
  if (me.role !== "owner") return { ok: false, status: 403, message: "Only the owner starts the membership." };
  const mode = stripeMode();
  if (!mode) return { ok: false, message: "Membership payments aren't set up yet." };
  const o = await orgRow(org);
  if (!o) return { ok: false, message: "Company not found." };
  const [deal, plan] = await Promise.all([dealOf(org), planRow()]);
  let sub = await subOf(org);
  const m = memberState(o, deal, sub, plan);
  if (m.state === "test") return { ok: false, message: "This is a test company: there's no membership to pay." };
  if (m.state === "waived") return { ok: false, message: "Tally waived this company's membership, so there's nothing to pay." };
  if (["active", "trialing", "past_due", "paused"].indexOf(m.state) >= 0) return { ok: false, portal: true, message: "The membership is already set up. Use Manage billing to change it." };
  const wh = await ensureWebhook("platform");
  if (!wh.ok) return wh;
  // a checkout page already open for this company: the same page again
  if (sub && sub.checkout_id && sub.checkout_url && Date.parse(sub.checkout_expires) > Date.now() + 5 * 60e3) {
    const cs = await stripe("GET", "checkout/sessions/" + sub.checkout_id).catch(() => null);
    if (cs && cs.status === "open") return { ok: true, url: sub.checkout_url };
    if (cs && cs.status === "complete") {
      await memberFromSession(org, cs);
      return { ok: true, done: true, message: "Your membership is set up." };
    }
  }
  const live = liveNow(), S = await getDoc(org, "org/settings");
  let cus = sub && sub.customer_id;
  if (!cus) {
    const c = await stripe("POST", "customers", { name: String(o.name || company(S)).slice(0, 200), email: validEmail(me.email) || undefined,
      description: "Tally company " + org, metadata: { tally_member: org } }, "tally-member-cus-" + org + "-" + mode);
    cus = c.id;
    await rest("POST", "member_subs?on_conflict=org_id,livemode", { org_id: org, livemode: live, customer_id: cus, updated_at: nowIso() }, "resolution=merge-duplicates");
  }
  const price = await planPrice(mode, plan.monthly_cents);
  const coupon = m.discount_pct > 0 ? await planCoupon(mode, m.discount_pct) : "";
  // what's left of the free trial carries over (Stripe needs at least two days of it)
  const trialEnd = Math.floor((Date.parse(String(o.trial_ends || "")) || 0) / 1000);
  const cs = await stripe("POST", "checkout/sessions", {
    mode: "subscription", customer: cus, client_reference_id: org,
    line_items: [{ price, quantity: 1 }],
    discounts: coupon ? [{ coupon }] : undefined,
    subscription_data: { metadata: { tally_member: org }, trial_end: trialEnd > Date.now() / 1000 + 49 * 3600 ? trialEnd : undefined,
      description: "Tally membership: " + String(o.name || "your company").slice(0, 100) },
    metadata: { tally_member: org },
    success_url: base() + "/member/done", cancel_url: base() + "/member/back",
  }, "tally-member-" + org + "-" + mode + "-" + strHash([cus, price, coupon, trialEnd].join("|")) + "-" + Math.floor(Date.now() / 60e3));   // a double tap gets the same page
  if (!cs || !/^https:\/\//.test(String(cs.url || ""))) return { ok: false, message: "Stripe did not give a checkout page. Try again in a minute." };
  await rest("POST", "member_subs?on_conflict=org_id,livemode", { org_id: org, livemode: live, customer_id: cus, checkout_id: cs.id, checkout_url: cs.url,
    checkout_expires: toIso(cs.expires_at) || new Date(Date.now() + 23 * 3600e3).toISOString(), updated_at: nowIso() }, "resolution=merge-duplicates");
  return { ok: true, url: cs.url };
}
// The owner's Stripe billing page: card, invoices, cancelling.
export async function memberPortal(org: string, me: J): Promise<J> {
  if (me.role !== "owner") return { ok: false, status: 403, message: "Only the owner manages the membership." };
  const mode = stripeMode();
  if (!mode) return { ok: false, message: "Membership payments aren't set up yet." };
  const sub = await subOf(org);
  if (!sub || !sub.customer_id) return { ok: false, message: "Start the membership first." };
  let conf = await planId(mode, "portal");
  if (!conf) {
    const c = await stripe("POST", "billing_portal/configurations", {
      business_profile: { headline: "Tally membership" },
      features: { invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: "at_period_end" } },
      default_return_url: base() + "/member/back",
    }, "tally-portal-" + mode);
    conf = c.id;
    await planKeep(mode, "portal", conf);
  }
  const s = await stripe("POST", "billing_portal/sessions", { customer: sub.customer_id, configuration: conf, return_url: base() + "/member/back" });
  if (!s || !/^https:\/\//.test(String(s.url || ""))) return { ok: false, message: "Stripe did not give a billing page. Try again in a minute." };
  return { ok: true, url: s.url };
}

/* Tally admin: every company, and what each pays */
const adminOnly = (): J => ({ ok: false, status: 403, message: "Only Tally's admins can do that." });
function adminCompany(o: J, ctx: J): J {
  const deal = ctx.deals[o.id] || {}, sub = ctx.subs[o.id] || null;
  const st = memberState(o, deal, sub, ctx.plan);
  const acct = ctx.accts[o.id];
  const cards = ctx.payOrgs[o.id] ? "platform" : !acct ? "none" : acct.disabled_reason === "disconnected" ? "disconnected" : acct.charges_enabled ? "connected" : "connecting";
  return { id: o.id, name: o.name, created: o.created_at, trial_ends: o.trial_ends, owners: ctx.owners[o.id] || [], invited: ctx.invited[o.id] || [],
    members: ctx.count[o.id] || 0, test: !!deal.is_test, waived: !!deal.waived, discount_pct: Number(deal.discount_pct) || 0, note: deal.note || "",
    member: st, cards, cc: !!ctx.cc[o.id] };
}
async function adminContext(): Promise<J> {
  const live = liveNow();
  const [orgs, mem, deals, subs, inv, accts, payOrgs, plan] = await Promise.all([
    rest("GET", "orgs?select=id,name,created_at,trial_ends&order=created_at.desc&limit=1000"),
    rest("GET", "members?select=org_id,role,email&limit=20000"),
    rest("GET", "member_deals?select=*&limit=1000"),
    rest("GET", "member_subs?select=*&livemode=eq." + live + "&limit=1000"),
    rest("GET", "member_invites?select=org_id,email,claimed_at&limit=2000"),
    rest("GET", "pay_accounts?select=org_id,charges_enabled,disabled_reason&is_current=is.true&livemode=eq." + live + "&limit=1000"),
    rest("GET", "pay_orgs?select=org_id,enabled&limit=1000"),
    planRow(),
  ]);
  const ctx: J = { orgs: orgs || [], plan, deals: {}, subs: {}, owners: {}, invited: {}, count: {}, accts: {}, payOrgs: {}, cc: {}, team: null };
  // the call center service: which companies have it, and Tally's team (null: no supabase-callcenter.sql yet)
  try {
    const [on, team] = await Promise.all([rest("GET", "cc_orgs?select=org_id&limit=1000"), ccTeam()]);
    (on || []).forEach((r: J) => { ctx.cc[r.org_id] = true; });
    ctx.team = team;
  } catch {
    ctx.team = null;
  }
  (mem || []).forEach((m: J) => { ctx.count[m.org_id] = (ctx.count[m.org_id] || 0) + 1; if (m.role === "owner") (ctx.owners[m.org_id] = ctx.owners[m.org_id] || []).push(m.email || ""); });
  (deals || []).forEach((d: J) => { ctx.deals[d.org_id] = d; });
  (subs || []).forEach((s: J) => { ctx.subs[s.org_id] = s; });
  (inv || []).forEach((i: J) => { if (!i.claimed_at) (ctx.invited[i.org_id] = ctx.invited[i.org_id] || []).push(i.email); });
  (accts || []).forEach((a: J) => { ctx.accts[a.org_id] = a; });
  (payOrgs || []).forEach((p: J) => { if (p.enabled) ctx.payOrgs[p.org_id] = true; });
  return ctx;
}
export async function adminList(me: J): Promise<J> {
  if (!(await isAdmin(me.uid))) return adminOnly();
  const ctx = await adminContext();
  return { ok: true, plan: ctx.plan, payments: stripeMode() || "", companies: ctx.orgs.map((o: J) => adminCompany(o, ctx)), team: ctx.team };
}
// One company's deal: test company, fee waived, discount, note, and the call center service. Any running
// membership follows at once.
export async function adminSet(me: J, b: J): Promise<J> {
  if (!(await isAdmin(me.uid))) return adminOnly();
  const org = String(b.target || "");
  if (!UUID_RE.test(org) || !(await orgRow(org))) return { ok: false, message: "Company not found." };
  if (b.cc !== undefined) {
    try {
      if (b.cc) await rest("POST", "cc_orgs?on_conflict=org_id", { org_id: org, on_by: String(me.email || "admin").slice(0, 200), on_at: nowIso() }, "resolution=ignore-duplicates");
      else await rest("DELETE", "cc_orgs?org_id=eq." + q(org));
    } catch (e) {
      console.error("call center switch", e);
      return { ok: false, message: CC_SQL };
    }
  }
  if (b.test === undefined && b.waived === undefined && b.discount === undefined && b.note === undefined) {
    const ctx0 = await adminContext(), o0 = ctx0.orgs.find((x: J) => x.id === org);
    return { ok: true, message: "Saved.", company: o0 ? adminCompany(o0, ctx0) : null };
  }
  const row: J = { org_id: org, updated_by: String(me.email || "admin").slice(0, 200), updated_at: nowIso() };
  if (b.test !== undefined) row.is_test = !!b.test;
  if (b.waived !== undefined) row.waived = !!b.waived;
  if (b.discount !== undefined) {
    const pct = Number(b.discount);
    if (!(pct >= 0 && pct <= 100) || Math.round(pct) !== pct) return { ok: false, message: "A discount is a whole percent from 0 to 100." };
    row.discount_pct = pct;
  }
  if (b.note !== undefined) row.note = String(b.note || "").slice(0, 500);
  await rest("POST", "member_deals?on_conflict=org_id", row, "resolution=merge-duplicates");
  let warn = "";
  try { await memberSyncDiscount(org); } catch (e) { console.error("membership discount", e); warn = " Stripe didn't take the change on the running membership yet: " + stripeTrouble(e); }
  const ctx = await adminContext(), o = ctx.orgs.find((x: J) => x.id === org);
  return { ok: true, message: "Saved." + warn, company: o ? adminCompany(o, ctx) : null };
}
/* ---------- the call center: Tally's own team, for the companies Tally admin switches it on for ----------
   Richie (Oct 22): "Call center is a service that the moving companys will be able to purchase to help get
   bookings . So call center will only be able to see companys that pay for that service ." He bills them himself.
   A person on the team is linked to their sign-in by claim_cc_team() when they open Tally with that email. */
const CC_SQL = "The call center isn't set up in the database yet. Run supabase-callcenter.sql in the Supabase SQL editor first.";
async function ccTeam(): Promise<J[]> {
  const rows = await rest("GET", "tally_cc_team?select=email,name,phone,user_id,added_at&order=added_at.asc&limit=500");
  return (rows || []).map((r: J) => ({ email: r.email, name: r.name || "", phone: r.phone || "", signedIn: !!r.user_id, added: r.added_at }));
}
export async function adminCcAdd(me: J, b: J): Promise<J> {
  if (!(await isAdmin(me.uid))) return adminOnly();
  const name = String(b.name || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) return { ok: false, message: "Give their name (up to 80 letters)." };
  const email = validEmail(b.email).toLowerCase();
  if (!email) return { ok: false, message: "Enter the email they sign in with." };
  const phone = String(b.phone || "").trim();
  if (phone && !e164(phone)) return { ok: false, message: "That phone number doesn't look right. Use the 10 digits, like 512-555-0107." };
  try {
    await rest("POST", "tally_cc_team?on_conflict=email", { email, name, phone: phone.slice(0, 40), added_by: String(me.email || "admin").slice(0, 200) }, "resolution=merge-duplicates");
    return { ok: true, message: name + " is on the call center team. They sign in to Tally with " + email + ".", team: await ccTeam() };
  } catch (e) {
    console.error("call center team", e);
    return { ok: false, message: CC_SQL };
  }
}
export async function adminCcRemove(me: J, b: J): Promise<J> {
  if (!(await isAdmin(me.uid))) return adminOnly();
  const email = validEmail(b.email).toLowerCase();
  if (!email) return { ok: false, message: "Which person?" };
  try {
    await rest("DELETE", "tally_cc_team?email=eq." + q(email));
    return { ok: true, message: "Taken off the call center team. They see no company's work from now on.", team: await ccTeam() };
  } catch (e) {
    console.error("call center team", e);
    return { ok: false, message: CC_SQL };
  }
}
// The price and the free trial, for memberships started from now on.
export async function adminPlan(me: J, b: J): Promise<J> {
  if (!(await isAdmin(me.uid))) return adminOnly();
  const patch: J = { updated_by: String(me.email || "admin").slice(0, 200), updated_at: nowIso() };
  if (b.monthly !== undefined) {
    const c = Math.round(Number(b.monthly) * 100);
    if (!(c >= 100 && c <= 10000000)) return { ok: false, message: "The monthly price is from $1 to $100,000." };
    patch.monthly_cents = c;
  }
  if (b.trialDays !== undefined) {
    const d = Number(b.trialDays);
    if (!(d >= 0 && d <= 365) || Math.round(d) !== d) return { ok: false, message: "The free trial is 0 to 365 days." };
    patch.trial_days = d;
  }
  await rest("PATCH", "tally_plan?id=eq.1", patch);
  return { ok: true, message: "Saved. New memberships use it; running ones keep their price.", plan: await planRow() };
}
// A company for someone: they become its owner when they sign in with this email. With your own email
// (a test company, say) you're its owner at once.
export async function adminAdd(me: J, b: J): Promise<J> {
  if (!(await isAdmin(me.uid))) return adminOnly();
  const name = String(b.name || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 120) return { ok: false, message: "Give the company a name (up to 120 letters)." };
  const email = validEmail(b.email).toLowerCase();
  if (!email) return { ok: false, message: "Enter the owner's email." };
  const plan = await planRow();
  const code = await rest("POST", "rpc/new_join_code", {});
  const made = await rest("POST", "orgs", { name, join_code: String(code || randToken().slice(0, 6).toUpperCase()), plan: "trial",
    trial_ends: new Date(Date.now() + plan.trial_days * 86400e3).toISOString() }, "return=representation");
  const org = made && made[0] && made[0].id;
  if (!org) return { ok: false, message: "Could not make the company. Try again." };
  if (b.test) await rest("POST", "member_deals?on_conflict=org_id", { org_id: org, is_test: true, waived: true, note: "Test company", updated_by: String(me.email || "admin").slice(0, 200), updated_at: nowIso() }, "resolution=merge-duplicates");
  const mine = email === String(me.email || "").toLowerCase();
  if (mine) await rest("POST", "members", { org_id: org, user_id: me.uid, email, staff: "", role: "owner" });
  else await rest("POST", "member_invites", { org_id: org, email, invited_by: String(me.email || "admin").slice(0, 200) });
  return { ok: true, org, mine, message: mine ? name + " is ready. You're its owner: switch to it from the company list." :
    name + " is ready. When " + email + " signs in to Tally with that email, they go straight in as its owner." };
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
  const amt = cents(b.amount), save = !!b.save, by = who(me), acct = c.acct;
  if (!(amt > 0)) return { ok: false, message: "Enter an amount." };
  const wh = await hookFor(acct);
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
      if (again.amount_cents === amt && Date.parse(pageEnds(again)) > Date.now() + 15 * 60e3 && sessionLive(again.session_id) === liveNow() && pageOn(again, acct)) return { ok: true, link: again };
      const r = await renewPage(again, job, c.S, amt, acct);
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
    const cus = (await jobCustomer(org, jobId, job, acct)).customer;
    const token = randToken(), until = Date.now() + LINK_DAYS * 86400e3;
    const s = await mintSession({ org, jobId, job, S: c.S, by, token, amt, save, cus, until, acct });
    const link = {
      token, org_id: org, job_id: jobId, session_id: s.id, url: s.url, amount_cents: amt, cap_cents: amt, save_card: save, created_by: by,
      status: "open", expires_at: new Date(until).toISOString(), session_expires: new Date(s.expires_at * 1000).toISOString(), account: acct,
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
  const amt = cents(b.amount), save = !!b.save, by = who(me), acct = c.acct;
  if (!(amt > 0)) return { ok: false, message: "Enter an amount." };
  if (!publishableKey()) return { ok: false, message: "Typing a card in needs STRIPE_PUBLISHABLE_KEY in Supabase. Use a pay link for now." };
  if (await tooManyPays(org, by)) return { ok: false, message: TOO_MANY };
  const wh = await hookFor(acct);
  if (!wh.ok) return wh;
  const res = await withJobLock(org, jobId, async (): Promise<J> => {
    const ready = await readyToCharge(org, jobId, me, amt, c.job);
    if (!ready.ok) return ready;
    const job = ready.job, cus = (await jobCustomer(org, jobId, job, acct)).customer;
    const md = payMeta(org, jobId, job, by, "card", me.uid);
    const pi = await stripe("POST", "payment_intents", {
      amount: amt, currency: "usd", customer: cus, allowed_payment_method_types: ["card"],
      payment_method_options: { card: { setup_future_usage: save ? "off_session" : "none" } },
      metadata: md, description: payWhat(c.S, job), receipt_email: validEmail((job.d || {}).email) || undefined,
    }, undefined, acct);
    await rest("POST", "pay_log?on_conflict=pi", { pi: pi.id, org_id: org, job_id: jobId, amount_cents: amt, status: pi.status || "requires_payment_method",
      source: "card", cust_key: md.tally_cust, by_staff: by, livemode: !!pi.livemode, updated_at: nowIso(), account: acct }, "resolution=merge-duplicates");
    // the card box on the phone works on the same Stripe account the payment is on
    return { ok: true, clientSecret: pi.client_secret, returnUrl: base() + "/pay/done", amount: amt / 100, account: acct };
  });
  return res || { ok: false, message: BUSY };
}

// Charge a card kept on file for this job's customer.
export async function paySaved(org: string, me: J, jobId: string, b: J): Promise<J> {
  const c = await payContext(org, me, jobId);
  if (c.err) return { ok: false, message: c.err, status: c.status };
  const amt = cents(b.amount), by = who(me), live = liveNow(), acct = c.acct;
  if (!(amt > 0)) return { ok: false, message: "Enter an amount." };
  const vid = String(b.vaultId || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(vid)) return { ok: false, message: "Pick a saved card." };
  const card = ((await rest("GET", "pay_cards?select=*&org_id=eq." + q(org) + "&id=eq." + q(vid) + "&limit=1")) || [])[0];
  if (!card || !card.pm_id) return { ok: false, message: "That saved card can't be charged here. Use a pay link or the card itself." };
  if (!(await getDoc(org, "vault/" + vid))) return { ok: false, message: "That card is no longer on file." };
  if (!!card.livemode !== live) return { ok: false, message: "That card was saved in Stripe " + (card.livemode ? "live" : "test") + " mode and can't be used now." };
  if ((card.account || "") !== acct) return { ok: false, message: "That card was kept on file on a different Stripe account, so it can't be charged here. Use a pay link or the card itself." };
  if (await tooManyPays(org, by)) return { ok: false, message: TOO_MANY };
  const wh = await hookFor(acct);
  if (!wh.ok) return wh;
  const res = await withJobLock(org, jobId, async (): Promise<J> => {
    // the same amount charged to a card on this job a moment ago: most likely a double tap
    const since = new Date(Date.now() - 120e3).toISOString();
    const recent = await rest("GET", "pay_log?select=pi&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&source=eq.saved&amount_cents=eq." + amt + "&status=in.(succeeded,processing)&created_at=gte." + q(since) + "&limit=1");
    if (recent && recent.length) return { ok: false, message: "This card was just charged " + money(amt) + ". Check the bill before charging it again." };
    const ready = await readyToCharge(org, jobId, me, amt, c.job);
    if (!ready.ok) return ready;
    const job = ready.job;
    if ((await jobCustomer(org, jobId, job, acct)).customer !== card.customer_id) return { ok: false, message: "That card belongs to a different customer." };
    if (me.role === "lead" && card.job_id !== jobId) {
      const here = card.fingerprint ? await rest("GET", "pay_cards?select=id&org_id=eq." + q(org) + "&customer_id=eq." + q(card.customer_id) + "&fingerprint=eq." + q(card.fingerprint) + "&job_id=eq." + q(jobId) + "&limit=1") : [];
      if (!(here && here.length)) return { ok: false, message: "This card was kept on file on another job. The office can charge it, or send a pay link." };
    }
    // A crew lead charges a card on file for whatever the move came to, as the office does, up to what is
    // still owed (readyToCharge), even past the quote's estimated top price, which is a guide (Oct 24).
    // Richie, Oct 25: "Whatever price the move ends up is what the lead needs to charge the customer . If
    // the customer forgets to mention the crazy entry to the house that addes 3 hours thats not my problem
    // its the customers for not mentioning it when booking". (Until then a lead could charge one only up
    // to the estimated top price.)
    // one charge however many times this is sent: the key names the job, the card, the amount, the bill so far
    const tries = (await rest("GET", "pay_log?select=pi&org_id=eq." + q(org) + "&job_id=eq." + q(jobId) + "&source=eq.saved")) || [];
    const idem = "tally-saved-" + await sha([org, jobId, card.pm_id, amt, jobTotalCents(job) - ready.owed, tries.length, live, acct].join("|"));
    const md = payMeta(org, jobId, job, by, "saved", me.uid);
    try {
      const pi = await stripe("POST", "payment_intents", {
        amount: amt, currency: "usd", customer: card.customer_id, payment_method: card.pm_id, off_session: true, confirm: true,
        metadata: md, description: payWhat(c.S, job), receipt_email: validEmail((job.d || {}).email) || undefined,
        expand: ["payment_method", "latest_charge"],
      }, idem, acct);
      await recordIntent(pi, acct);
      const what = methodLabel(pi.payment_method && typeof pi.payment_method === "object" ? pi.payment_method : null);
      if (pi.status === "succeeded") return { ok: true, message: "Charged " + money(amt) + " to " + what + "." };
      if (pi.status === "processing") return { ok: true, message: "Payment of " + money(amt) + " is processing." };
      return { ok: false, message: "The card was not charged." };
    } catch (e) {
      if (e instanceof StripeError && e.err && e.err.type === "card_error") {
        if (e.err.payment_intent && e.err.payment_intent.id) await recordIntent({ id: e.err.payment_intent.id }, acct).catch(() => {});
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
  const pa = await payAccount(org);
  if (!pa.on) return { ok: false, message: payOffWhy(pa.reason) };
  const job = await getDoc(org, "jobs/" + jobId);
  if (!job) return { ok: false, message: "That job is not available." };
  if (!canTakePay(me, job)) return { ok: false, status: 403, message: "Crew leads and the office take payments." };
  const pid = String(b.pi || "");
  if (pid) {
    if (!/^pi_[A-Za-z0-9_]+$/.test(pid)) return { ok: false, message: "Unknown payment." };
    const md = (await stripe("GET", "payment_intents/" + pid, undefined, undefined, pa.acct)).metadata || {};
    if (md.tally_org !== org || md.tally_job !== jobId) return { ok: false, message: "That payment belongs to another job." };
  }
  const out = await withJobLock(org, jobId, async () => {
    // looked up again inside the lock, so an older state of the same payment can't be written over a newer one
    const rec = pid ? await recordIntent({ id: pid }, pa.acct) : null;
    const { inflight } = await settleJob(org, jobId, { reserve: true });
    const fixed = await repairJob(org, jobId);
    // a card payment going through on another phone that no longer fits the bill (cash came in, or the
    // bill was lowered) is called off; the ones that still fit hold their amount back from pay link pages
    const owed = await owedCents(org, jobId);
    let reserved = 0;
    for (const f of inflight) {
      const a = Number(f.pi.amount) || 0;
      if (a > owed - reserved) await cancelIntent(f.pi, f.acct);
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
    ? (await rest("GET", "pay_cards?select=id,pm_id,livemode,account&org_id=eq." + q(org) + "&customer_id=eq." + q(card.customer_id) + "&fingerprint=eq." + q(card.fingerprint))) || []
    : [card];
  for (const r of all) {
    if (!r.pm_id) continue;
    if (stripeMode() && !!r.livemode === liveNow()) {
      try { await stripe("POST", "payment_methods/" + r.pm_id + "/detach", undefined, undefined, r.account || ""); } catch (e) { if (!stripeNo(e)) throw e; }
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
  const pa = stripeMode() ? await payAccount(l.org_id) : { on: false };
  if (!pa.on || (job.test && liveNow())) return text("Card payments are paused right now. Ask " + co + " how to pay.", 503);
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
    if (cur.amount_cents === want && Date.parse(pageEnds(cur)) > Date.now() + 10 * 60e3 && sessionLive(cur.session_id) === liveNow() && pageOn(cur, pa.acct)) return { url: cur.url };
    const r = await renewPage(cur, (await getDoc(l.org_id, "jobs/" + l.job_id)) || job, S, want, pa.acct);
    if (r.state === "paid") return { msg: "This payment is done. Thank you!" };
    if (r.state === "open") return { msg: "This payment is going through. Check back in a minute.", status: 409 };
    if (r.state === "gone") return { msg: "This payment link has expired. Ask " + co + " for a new one.", status: 410 };
    return { url: r.link.url };
  });
  if (!out) return text("Busy for a moment. Try the link again.", 503);
  if (out.msg) return text(out.msg, out.status || 200);
  return new Response(null, { status: 302, headers: { Location: out.url, "Cache-Control": "no-store" } });
}
async function handleStripe(req: Request, kind: HookKind = "platform"): Promise<Response> {
  const raw = await req.text();
  const secrets = await webhookSecrets(kind);
  if (!secrets.length || !(await stripeSigOk(raw, req.headers.get("stripe-signature") || "", secrets))) return text("Bad signature", 400);
  let ev: J;
  try { ev = JSON.parse(raw); } catch { return text("Bad request", 400); }
  // test events once the live keys are in (or the other way round) can't be looked up with this key
  if (!stripeMode() || !!(ev && ev.livemode) !== liveNow()) return json({ received: true, skipped: "other-mode" });
  const o = (ev && ev.data && ev.data.object) || {}, type = String((ev && ev.type) || "");
  const idOf = (x: J) => typeof x === "string" ? x : x && x.id;
  // events from a company's own Stripe account say which account; the platform's own never do
  const acct = kind === "connect" ? String((ev && ev.account) || "") : "";
  if (kind === "connect" && !ACCT_RE.test(acct)) return json({ received: true, skipped: "no-account" });
  try {
    if (kind === "platform" && await memberEvent(type, o)) return json({ received: true });
    if (kind === "connect" && type === "account.updated") {
      await rest("PATCH", "pay_accounts?account_id=eq." + q(acct), { ...acctState(o), updated_at: nowIso() });
      return json({ received: true });
    }
    if (kind === "connect" && type === "account.application.deauthorized") {
      // the company disconnected Tally in its Stripe dashboard: no more card payments until it connects again
      await rest("PATCH", "pay_accounts?account_id=eq." + q(acct), { charges_enabled: false, disabled_reason: "disconnected", updated_at: nowIso() });
      return json({ received: true });
    }
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
        : ((await stripe("GET", "payment_intents/" + pid, undefined, undefined, acct)) || {}).metadata || {};
      const org = String(md.tally_org || ""), job = String(md.tally_job || "");
      if (/^[0-9A-Fa-f-]{36}$/.test(org) && /^[A-Za-z0-9_-]{1,40}$/.test(job) && await orgExists(org) && (!acct || await acctIsOrgs(org, acct))) {
        // written down inside the job's lock, so a check running at the same moment can't write an older
        // state of this payment over it; pay link pages that now ask for more than is left are closed
        const work = async () => {
          const rec = await recordIntent({ id: pid }, acct);
          if (rec.ok && rec.org) await trimSessions(rec.org, rec.job, rec.owed);
          return rec;
        };
        if ((await withJobLock(org, job, work, 5000)) === null) await recordIntent({ id: pid }, acct);   // still busy: write it down anyway
      }
    }
  } catch (e) {
    console.error("stripe event", type, e);
    return text("Try again", 500);   // Stripe sends it again later
  }
  return json({ received: true });
}

/* ---------- a new quote made on site by the crew lead ----------
   The app works a new quote out room by room on the crew lead's phone (rqBuild and calc in the app), and the
   customer signs it there. Only the office may change a job's quote (jobs_guard), so the lead's phone sends
   the signed quote here. This works the price out again the same way (rqBuildS, priceCalc): from the job,
   what's moving, and the rate card the job was quoted at. It saves it only when it comes to the total the
   customer signed, and keeps the quote it replaces in the job's history. With Options › Office approves new
   quotes, it also needs the office's yes, which the office writes into the job's quote (quote.rqOk), where
   only the office can write. tests/function/requote.ts checks this agrees with the app, case by case. */
// the app's defaults for what a price is worked out from (defaultSettings in the app)
export const PRICE_DEFAULTS: J = {
  rates: { r2: 140, r3: 195, r4: 250 }, minHours: 3, prod: 45, mph: 30, shopAddress: "", shopTravel: true, truckFee: 45, includedMiles: 20, mileRate: 1.5, stairFee: 25, packPerBox: 8, taxPct: 0, depositPct: 25, ntePct: 15, opt: {},
  trucks: [{ id: "t26", name: "Box 1 (26 ft)", cf: 1700 }, { id: "t20", name: "Box 2 (20 ft)", cf: 1000 }, { id: "t16", name: "Van (16 ft)", cf: 800 }],
  catalog: [
    { id: "sofa3", name: "Sofa (3-seat)", cf: 55, cat: "Living room" },
    { id: "loveseat", name: "Loveseat", cf: 38, cat: "Living room" },
    { id: "chair", name: "Armchair", cf: 22, cat: "Living room" },
    { id: "recliner", name: "Recliner", cf: 30, cat: "Living room" },
    { id: "coffee", name: "Coffee table", cf: 10, cat: "Living room" },
    { id: "endtable", name: "End table", cf: 6, cat: "Living room" },
    { id: "tvstand", name: "TV stand", cf: 14, cat: "Living room" },
    { id: "tv", name: "TV (flat screen)", cf: 8, cat: "Living room" },
    { id: "bookcase", name: "Bookcase", cf: 18, cat: "Living room" },
    { id: "bedq", name: "Queen bed (frame + mattress)", cf: 62, cat: "Bedroom" },
    { id: "bedk", name: "King bed (frame + mattress)", cf: 78, cat: "Bedroom" },
    { id: "bedt", name: "Twin bed", cf: 36, cat: "Bedroom" },
    { id: "dresser", name: "Dresser (6-drawer)", cf: 35, cat: "Bedroom" },
    { id: "nightstand", name: "Nightstand", cf: 6, cat: "Bedroom" },
    { id: "wardrobe", name: "Armoire / wardrobe", cf: 40, cat: "Bedroom" },
    { id: "dintable", name: "Dining table", cf: 30, cat: "Dining" },
    { id: "dinchair", name: "Dining chair", cf: 5, cat: "Dining" },
    { id: "hutch", name: "China cabinet", cf: 40, cat: "Dining" },
    { id: "fridge", name: "Refrigerator", cf: 45, cat: "Kitchen & laundry" },
    { id: "washer", name: "Washer", cf: 30, cat: "Kitchen & laundry" },
    { id: "dryer", name: "Dryer", cf: 30, cat: "Kitchen & laundry" },
    { id: "desk", name: "Desk", cf: 25, cat: "Office" },
    { id: "ochair", name: "Office chair", cf: 8, cat: "Office" },
    { id: "filecab", name: "File cabinet", cf: 10, cat: "Office" },
    { id: "boxs", name: "Small box", cf: 1.5, cat: "Boxes" },
    { id: "boxm", name: "Medium box", cf: 3, cat: "Boxes" },
    { id: "boxl", name: "Large box", cf: 4.5, cat: "Boxes" },
    { id: "boxw", name: "Wardrobe box", cf: 10, cat: "Boxes" },
    { id: "piano", name: "Upright piano", cf: 60, cat: "Specialty", fee: 150 },
    { id: "treadmill", name: "Treadmill", cf: 40, cat: "Specialty", fee: 50 },
    { id: "safe", name: "Gun or fire safe", cf: 20, cat: "Specialty", fee: 100 },
    { id: "grill", name: "Grill", cf: 15, cat: "Specialty" },
    { id: "mirror", name: "Large mirror", cf: 5, cat: "Specialty" },
    { id: "bike", name: "Bicycle", cf: 12, cat: "Specialty" },
  ],
};
const numP = (v: unknown): number => { const n = parseFloat(v as string); return isFinite(n) ? n : 0; };
// the app's money(): $1,541, or $549.75 when there are cents
export function usd(n: number): string {
  n = Math.round((+n || 0) * 100) / 100;
  const neg = n < 0;
  n = Math.abs(n);
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return (neg ? "-" : "") + "$" + (whole ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}
function fmtMi(x: number): string { x = Math.round(x * 10) / 10; return (Math.abs(x - Math.round(x)) < 0.05 ? Math.round(x) : x).toLocaleString("en-US"); }
// the app's canon(): the same text for the same data, whatever order its keys are in
export function canon(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const o = v as J;
  return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
}
// the app's opt(): a Setup › Options switch, or its default (these two start off)
function optOn(S: J, k: string): boolean {
  const o = (S && S.opt) || {};
  if (o[k] === true || o[k] === false) return o[k];
  if (k === "tax") return numP(S.taxPct) > 0;
  return ["photosReq", "rqOffice"].indexOf(k) < 0;
}
// the settings a price is worked out from: what the company saved, over the app's defaults
export function priceSettings(saved: J): J {
  const S = Object.assign({}, PRICE_DEFAULTS, saved || {});
  if (!S.opt || typeof S.opt !== "object") S.opt = {};
  if (!S.rates || typeof S.rates !== "object") S.rates = PRICE_DEFAULTS.rates;
  if (!Array.isArray(S.trucks)) S.trucks = PRICE_DEFAULTS.trucks;
  if (!Array.isArray(S.catalog)) S.catalog = PRICE_DEFAULTS.catalog;
  return S;
}
// a job's details with its items as {id: how many}, the way the app holds them (docToJob)
function jobD(job: J): J {
  const d = Object.assign({}, (job && job.d) || {}), m: J = {};
  (Array.isArray(d.items) ? d.items : []).forEach((x: J) => { if (x && x.id) m[x.id] = x.q; });
  d.items = m;
  return d;
}
// the app's calc(), for a quote whose move type is set (d.moveKind)
export function priceCalc(d: J, S: J): J {
  let cf = 0, count = 0, boxes = 0, fees = 0;
  S.catalog.forEach((it: J) => { const q = d.items[it.id] || 0; if (!q) return; cf += q * it.cf; count += q; if (it.cat === "Boxes") boxes += q; if (it.fee) fees += q * it.fee; });
  const shopTravel = !!S.shopAddress && S.shopTravel !== false;
  const moveMi = numP(d.miles), legMi = shopTravel ? numP(d.milesOut) + numP(d.milesBack) : 0, miles = moveMi + legMi, flights = numP(d.flights);
  const kind = d.moveKind === "mileage" ? "mileage" : "local", mileage = kind === "mileage";
  const crew = parseInt(d.crew, 10) || (cf < 350 ? 2 : cf < 1000 ? 3 : 4);
  const raw = cf ? cf / (crew * S.prod) + (mileage ? 0 : miles / S.mph) : 0;
  let hours = cf ? Math.max(S.minHours, Math.ceil(raw * 2) / 2) : 0;
  if (numP(d.hoursOverride) > 0) hours = numP(d.hoursOverride);
  const trucks = S.trucks.slice().sort((a: J, b: J) => a.cf - b.cf);
  const truck = trucks.find((t: J) => t.id === d.truckId) || trucks.find((t: J) => cf * 1.08 <= t.cf) || trucks[trucks.length - 1] || { id: "", name: "No truck", cf: 1 };
  const nTrucks = Math.max(1, Math.ceil(cf * 1.08 / truck.cf));
  const pct = cf ? Math.min(1, cf / (nTrucks * truck.cf)) : 0;
  const lines: J[] = [], rate = S.rates["r" + crew] || 0, mileRate = numP(S.mileRate), billMi = Math.round(miles * 100) / 100;
  let fixed = 0;
  const add = (label: string, amt: number, k: string) => { lines.push({ label, amt, k }); if (k === "fixed") fixed += amt; };
  if (cf) {
    add(crew + " movers, " + hours + " hr" + (mileage ? " loading and unloading" : "") + " at " + usd(rate) + "/hr", Math.round(rate * hours), "hours");
    if (optOn(S, "truckFee")) add((nTrucks > 1 ? nTrucks + " trucks" : "Truck") + " and fuel", Math.round(S.truckFee * nTrucks), "fixed");
    if (mileage && miles > 0) add("Mileage: " + fmtMi(miles) + " mi" + (legMi ? " from the shop and back" : "") + " at " + usd(mileRate) + "/mi", Math.round(billMi * mileRate), "miles");
    if (flights > 0 && optOn(S, "stairs")) add("Stairs: " + flights + " flight" + (flights === 1 ? "" : "s"), Math.round(flights * S.stairFee), "fixed");
    if (d.pack && boxes > 0 && optOn(S, "packing")) add("Packing and materials: " + boxes + " boxes", Math.round(boxes * S.packPerBox), "fixed");
    if (fees > 0) add("Specialty items", Math.round(fees), "fixed");
    if (numP(d.discount) > 0) add("Discount", -Math.round(numP(d.discount)), "fixed");
  }
  const subtotal = lines.reduce((a, l) => a + l.amt, 0);
  const taxPct = optOn(S, "tax") ? numP(S.taxPct) : 0, tax = Math.round(subtotal * taxPct / 100);
  if (tax > 0) lines.push({ label: "Tax (" + taxPct + "%)", amt: tax, k: "tax" });
  const total = Math.max(0, subtotal + tax);
  return {
    cf, count, lbs: cf * 7, crew, hours, truckId: truck.id, truckName: truck.name, truckCf: truck.cf, nTrucks, pct, lines, total,
    nte: Math.ceil(total * (1 + S.ntePct / 100) / 5) * 5, deposit: optOn(S, "deposit") ? Math.ceil(total * S.depositPct / 100) : 0,
    kind, rate, miles: mileage ? billMi : 0, mileRate, fixed, taxPct, minHours: numP(S.minHours), flat: !optOn(S, "byClock"),
    shopTravel, backH: shopTravel && S.mph > 0 ? Math.round(numP(d.milesBack) / S.mph * 100) / 100 : 0, capNte: S.nteCap !== false,
    driveH: mileage && S.mph > 0 ? Math.round(miles / S.mph * 100) / 100 : 0,
  };
}
// the app's rqSettings(): the rate card the job was quoted at (the quote's own rates and fees)
function rqSettings(job: J, jd: J, S: J): J {
  const q0 = job.quote || {}, o = Object.assign({}, S.opt || {});
  const S2 = Object.assign({}, S, { rates: Object.assign({}, S.rates), opt: o });
  const crew = numP(q0.crew);
  if (crew && numP(q0.rate) > 0) S2.rates["r" + crew] = numP(q0.rate);
  if (q0.mileRate != null) S2.mileRate = numP(q0.mileRate);
  if (q0.taxPct != null) { S2.taxPct = numP(q0.taxPct); o.tax = numP(q0.taxPct) > 0; }
  if (q0.minHours != null) S2.minHours = numP(q0.minHours);
  if (typeof q0.flat === "boolean") o.byClock = !q0.flat;
  if (typeof q0.capNte === "boolean") S2.nteCap = q0.capNte;
  if (typeof q0.shopTravel === "boolean") S2.shopTravel = q0.shopTravel;
  const L: J[] = Array.isArray(q0.lines) ? q0.lines : [];
  const line = (re: RegExp) => L.find((l) => l && re.test(String(l.label))) || null;
  if (L.length) {
    const tl = line(/^(\d+ trucks|Truck) and fuel$/);
    o.truckFee = !!tl;
    if (tl) S2.truckFee = numP(tl.amt) / Math.max(1, numP(q0.nTrucks));
    const fl = numP(jd.flights), sl = line(/^Stairs: /);
    if (sl && fl > 0) { o.stairs = true; S2.stairFee = numP(sl.amt) / fl; }
    const pl = line(/^Packing and materials: \d+ boxes$/), bx = pl ? parseInt(String(pl.label).replace(/\D+/g, ""), 10) : 0;
    if (pl && bx > 0) { o.packing = true; S2.packPerBox = numP(pl.amt) / bx; }
  }
  return S2;
}
// the app's rqBuild(): the new quote for what's moving, {d, q, items}
export function rqBuildS(job: J, S: J, dr: { items: Record<string, number>; flights: number; pack: boolean }): J {
  const q0 = job.quote || {}, jd = jobD(job), S2 = rqSettings(job, jd, S), d = JSON.parse(JSON.stringify(jd));
  d.items = Object.assign({}, dr.items);
  d.flights = numP(dr.flights) > 0 ? String(numP(dr.flights)) : "";
  d.pack = !!dr.pack;
  if (q0.crew) d.crew = String(q0.crew);
  if (q0.kind === "local" || q0.kind === "mileage") d.moveKind = q0.kind;
  if (job.assign && job.assign.truckId) d.truckId = job.assign.truckId;
  let cf1 = 0;
  S.catalog.forEach((it: J) => { cf1 += (d.items[it.id] || 0) * it.cf; });
  const ho = numP(jd.hoursOverride);
  d.hoursOverride = ho > 0 ? String(Math.max(numP(S2.minHours), Math.ceil(ho * cf1 / numP(q0.cf) * 2) / 2)) : "";
  const q = priceCalc(d, S2);
  q.deposit = numP(q0.deposit);
  const items = S2.catalog.filter((it: J) => d.items[it.id] > 0).map((it: J) => ({ id: it.id, name: it.name, cf: it.cf, qty: d.items[it.id] }));
  return { d, q, items };
}
// the app's rqKey(): what the office's yes is for, these items at this price
export function rqKeyS(items: { id: string; q: number }[], flights: string, pack: boolean, total: number): string {
  return strHash(canon({ items, flights, pack, total }));
}
export async function requote(org: string, me: J, jobId: string, b: J): Promise<J> {
  const office = me.role === "owner" || me.role === "dispatch";
  const no = (status: number, message: string): J => ({ ok: false, final: true, status, message });
  const [S0, job] = await Promise.all([getDoc(org, "org/settings"), getDoc(org, "jobs/" + jobId)]);
  if (!job) return no(404, "That job is not available.");
  const crew: string[] = (job.assign && job.assign.crew) || [];
  if (!office && !(me.role === "lead" && crew.indexOf(me.staff) >= 0)) return no(403, "Only the crew lead on this job can make a new quote on it.");
  const S = priceSettings(S0);
  if (optOff(S, "rqCrew")) return no(403, "New quotes on site are switched off (Setup › Options).");
  const rq = b.rq && typeof b.rq === "object" ? b.rq : {};
  const id = String(rq.id || "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return no(400, "The new quote didn't come through. Make it again.");
  // sent again after a dropped connection: it's already on the job
  if (job.rq && job.rq.id === id && job.rq.state === "done") return { ok: true, already: true, total: numP((job.quote || {}).total), message: "The new quote is on the job." };
  if (["booked", "active"].indexOf(job.status) < 0 || job.clockAt) return no(409, "This job can't take a new quote now: it has been billed out.");
  const q0 = job.quote || {};
  if (!(q0.kind === "local" || q0.kind === "mileage") || !(numP(q0.cf) > 0)) return no(409, "This job's quote can't be redone on site. The office can change it.");
  if (Math.abs(numP(rq.was) - numP(q0.total)) >= 0.005) return no(409, "The quote on this job changed while the new one was being made. Make the new quote again.");
  // what's moving: items still in Setup, whole numbers
  const rd = rq.d && typeof rq.d === "object" ? rq.d : {};
  if (!Array.isArray(rd.items) || rd.items.length > 400) return no(400, "The items didn't come through. Make the new quote again.");
  const cat: J = {};
  S.catalog.forEach((it: J) => { if (it && it.id) cat[it.id] = it; });
  const items: Record<string, number> = {};
  for (const x of rd.items) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !cat[x.id]) continue;   // taken out of Setup meanwhile: not in the price, as in the app
    if (typeof x.q !== "number" || !Number.isInteger(x.q) || x.q < 1 || x.q > 999) return no(400, "An item's count didn't come through. Make the new quote again.");
    items[x.id] = x.q;
  }
  const fl = rd.flights === "" || rd.flights == null ? 0 : Number(rd.flights);
  if (!Number.isInteger(fl) || fl < 0 || fl > 99) return no(400, "The stairs didn't come through. Make the new quote again.");
  const pack = rd.pack === true;
  // the customer's signature
  const sig = rq.sig && typeof rq.sig === "object" ? rq.sig : {};
  const name = String(sig.name || "").trim().slice(0, 120), img = String(sig.img || "");
  if (!name || img.length > 400000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img)) return no(400, "The customer's signature didn't come through. Have them sign again.");
  // the price, worked out again here: it has to be the one the customer signed
  const built = rqBuildS(job, S, { items, flights: fl, pack });
  if (!(built.q.cf > 0)) return no(400, "The new quote has nothing moving.");
  if (Math.abs(built.q.total - numP(rq.quote && rq.quote.total)) >= 0.005) {
    console.error("requote: price differs", jobId, built.q.total, rq.quote && rq.quote.total);
    return no(409, "The new price didn't come out the same at the office. Make the new quote again.");
  }
  const itemsArr = Object.keys(items).sort().map((k) => ({ id: k, q: items[k] }));
  // Options › Office approves new quotes: the office's yes, for these items at this price
  const yes = q0.rqOk && typeof q0.rqOk === "object" && q0.rqOk.id === id ? q0.rqOk : null;
  if (S.opt.rqOffice === true && !office) {
    if (!yes) return no(403, "This new quote needs the office's approval first.");
    if (yes.key !== rqKeyS(itemsArr, built.d.flights, pack, built.q.total) || Math.abs(numP(yes.total) - built.q.total) >= 0.005) return no(409, "This isn't the new quote the office approved. Make it again.");
  }
  const now = Date.now(), by = String((office ? me.staff || rq.by || "Office" : me.staff) || "").slice(0, 60);
  const when = (t: unknown) => (typeof t === "number" && t > 0 && t <= now + 6e4 ? t : now);
  const note = String(rq.note || "").trim().slice(0, 500);
  const changes = (Array.isArray(rq.changes) ? rq.changes : []).filter((c: unknown) => typeof c === "string").slice(0, 60).map((c: string) => c.slice(0, 160));
  const prevOk = job.rq && job.rq.id === id && job.rq.ok && typeof job.rq.ok === "object" ? job.rq.ok : null;
  const ok = yes ? { by: String(yes.by || "").slice(0, 60), ts: numP(yes.ts) || now, ...(prevOk && prevOk.note ? { note: String(prevOk.note).slice(0, 200) } : {}) } : null;
  const nq = built.q, jd = jobD(job), was = JSON.parse(JSON.stringify(q0));
  delete was.rqOk;
  // the quote replaced whole: a key the new one doesn't have (the office's yes) is removed
  const quote: J = {};
  Object.keys(q0).forEach((k) => { if (!(k in nq)) quote[k] = null; });
  Object.assign(quote, nq);
  const hist = (Array.isArray(job.quoteHist) ? job.quoteHist : []).concat([{
    id, ts: now, by, was, wasItems: job.items || [],
    wasD: { items: Object.keys(jd.items).filter((k) => jd.items[k] > 0).sort().map((k) => ({ id: k, q: jd.items[k] })), flights: jd.flights || "", pack: !!jd.pack, hoursOverride: jd.hoursOverride || "" },
    now: nq.total, why: note, changes, sign: { name, img, ts: when(sig.ts) }, ok,
  }]).slice(-10);
  const dNew = { items: itemsArr, flights: built.d.flights, pack, hoursOverride: built.d.hoursOverride };
  const rec: J = {
    id, by, ts: when(rq.ts), was: numP(q0.total), d: dNew, quote: nq, items: built.items, note, changes,
    state: "done", sig: { name, ts: when(sig.ts), by: me.staff || by }, ok, no: null, seen: null, applied: now, refused: null, cancel: null,
  };
  Object.keys(job.rq || {}).forEach((k) => { if (!(k in rec)) rec[k] = null; });
  const ev = "New quote on site by " + (by || "the crew") + ": " + usd(numP(q0.total)) + " → " + usd(nq.total) + ", signed by " + name;
  const saved = await rest("POST", "rpc/doc_patch", { o: org, p: "jobs/" + jobId, patch: { quote, items: built.items, d: dNew, quoteHist: hist, rq: rec, log: { [logKey(now, ev)]: { ts: now, ev } } } });
  if (saved !== true) return { ok: false, message: "The new quote couldn't be saved. Try again." };
  return { ok: true, total: nq.total, message: "The new quote is on the job." };
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
      // quotes: the office and the call center
      if (!office && me.role !== "callcenter") return json({ ok: false, message: "Only the office and the call center build quotes." }, 403);
      return json(await driveDistance(b.from, b.to));
    }
    if (b.action === "shop_distance") {
      // bill-out on a mileage move: from where the truck is now back to this company's own shop (the
      // shop comes from Setup, so the lookup can't be pointed anywhere else)
      if (!office && me.role !== "lead") return json({ ok: false, message: "Crew leads and the office bill out jobs." }, 403);
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!(typeof b.lat === "number" && typeof b.lng === "number" && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) {
        return json({ ok: false, message: "The phone's location didn't come through." }, 400);
      }
      const shop = String(((await getDoc(org, "org/settings")) || {}).shopAddress || "").trim();
      if (!shop) return json({ ok: false, message: "The shop address isn't in Setup yet." });
      return json(await driveDistance({ lat, lng }, shop));
    }
    if (b.action === "pay_config") return json(await payConfig(org, b));
    if (b.action === "pay_connect") {
      try {
        const out = await payConnect(org, me);
        const st = out.status;
        delete out.status;
        return json(out, typeof st === "number" ? st : 200);
      } catch (e) {
        console.error("pay_connect", e);
        return json({ ok: false, message: stripeTrouble(e) });
      }
    }
    if (b.action === "sos") {
      const out = await sosText(org, me, String(b.msgId || ""), String(b.kind || ""), b.now);
      const st = out.status;
      delete out.status;
      return json(out, typeof st === "number" ? st : 200);
    }
    // the membership, and Tally admin (every company; Tally's admins only)
    const member: Record<string, (o: string, m: J, x: J) => Promise<J>> = {
      member_status: memberStatus, member_start: (o: string, m: J) => memberStart(o, m), member_portal: (o: string, m: J) => memberPortal(o, m),
      admin_list: (_o: string, m: J) => adminList(m), admin_set: (_o: string, m: J, x: J) => adminSet(m, x),
      admin_plan: (_o: string, m: J, x: J) => adminPlan(m, x), admin_add: (_o: string, m: J, x: J) => adminAdd(m, x),
      admin_cc_add: (_o: string, m: J, x: J) => adminCcAdd(m, x), admin_cc_remove: (_o: string, m: J, x: J) => adminCcRemove(m, x),
    };
    if (member[b.action]) {
      try {
        const out = await member[b.action](org, me, b);
        const st = out.status;
        delete out.status;
        return json(out, typeof st === "number" ? st : 200);
      } catch (e) {
        console.error(b.action, e);
        return json({ ok: false, message: stripeTrouble(e) });
      }
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
    if (b.action === "requote") {
      const out = await requote(org, me, jobId, b);
      const st = out.status;
      delete out.status;
      return json(out, typeof st === "number" ? st : 200);
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
    // where Stripe's sign-up for a company's own account sends the owner back to
    if (/^\/connect\/done\/?$/.test(sub)) return text("Thanks, that's all Stripe needed for now.\n\nGo back to Tally: Setup › Payments shows when Stripe has finished checking your details and card payments are on.");
    if (/^\/connect\/again\/?$/.test(sub)) return text("This Stripe sign-up link has expired or was already used.\n\nGo back to Tally and press Continue with Stripe in Setup › Payments for a fresh one.");
    // where Stripe's membership checkout and billing pages send the owner back to
    if (/^\/member\/done\/?$/.test(sub)) return text("Thanks! Your Tally membership is set up.\n\nGo back to Tally: Setup › Membership shows it.");
    if (/^\/member\/back\/?$/.test(sub)) return text("Go back to Tally: Setup › Membership shows where your membership stands.");
  }
  if (req.method !== "POST") return json({ ok: false, message: "POST only" }, 405);
  if (sub === "/app" || sub === "/app/") return handleApp(req);
  if (sub === "/stripe" || sub === "/stripe/") return handleStripe(req);
  if (sub === "/stripe/connect" || sub === "/stripe/connect/") return handleStripe(req, "connect");
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
