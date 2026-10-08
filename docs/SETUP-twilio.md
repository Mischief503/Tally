# Tally — turning on texts and the company line (Twilio)

No terminal needed. Everything below is done in a browser: Twilio's console, the Supabase
dashboard, and Netlify Drop. Allow about an hour of clicking, then a wait of days to a few weeks
for US texting approval (calls work the same day).

You'll need: the three files that came with this guide — `supabase-twilio.sql`,
`tally-twilio/index.ts`, and the updated `tally-supabase.html`.

---

## 1. Twilio account and number

1. Sign up at twilio.com and **upgrade** the account (add a card). A trial account can only
   text and call numbers you've verified one by one, so it can't run a crew.
2. **Phone Numbers › Buy a number.** Pick a **local** number in your area code with **Voice**
   and **SMS** ticked. Local beats toll-free here: it's cheaper per month, much cheaper for
   incoming calls, and customers answer local numbers.
3. Note two things from the Console home page: **Account SID** (starts `AC`) and **Auth Token**
   (click to reveal). Keep the Auth Token private, like the Supabase service key.

## 2. Register for US texting (A2P 10DLC)

US carriers block business texts from unregistered numbers. Calls aren't affected.

**Messaging › Regulatory Compliance › A2P 10DLC** (Twilio walks you through it):

- **Brand:** your moving company. Choose *Low-Volume Standard* if you have an EIN — you'll send
  far fewer than its 6,000 texts a day.
- **Campaign:** use case *Low Volume Mixed*. Description, for example:
  *"Job alerts to our own moving crew (assignments, schedule changes, signatures waiting),
  an arrival-time text to the customer when their crew heads out, forwarding of customer
  texts and missed calls to our office staff, and truck-down alerts from our crews to our
  office staff."*
- **How people opt in:** *"Employees give us their mobile number when hired and agree to receive
  job alerts by text. Customers give us their mobile number when they book and are told we
  will text them on moving day when the crew is on the way."* Make that true: say it when you
  book, or put it on the quote.
- **Sample messages** (copy from what Tally sends):
  - `Ace Moving: You're on Priya Nair, Sat Oct 4 at 8:00 AM. Pickup 418 Oak St, Austin. Truck Box 1 (26 ft). Lead Marcus. Reply STOP to opt out.`
  - `Ace Moving: Priya Nair moved to Mon Oct 6 at 9:30 AM (was Sat Oct 4 at 8:00 AM).`
  - `Ace Moving: Tomorrow you're on Priya Nair at 8:00 AM (418 Oak St). Please confirm: https://your-tally-site#messages`
  - `Ace Moving: Hi Priya, your crew is on the way and should arrive in about 30 minutes, around 8:35 AM. Reply STOP to opt out.`
  - `Ace Moving TRUCK DOWN: Box 1 (26 ft) is down. Sent by Marcus at 2:14 PM, on the Priya Nair job. "Flat tire" Location: https://maps.google.com/?q=30.26715,-97.74306 (within 12 m). Call Marcus: +15125550101.`
- Tick that messages include opt-out wording. Tally adds "Reply STOP to opt out." to the first
  text each number receives, and Twilio handles STOP itself.

Approval usually takes a few days, sometimes two to three weeks. Until then texts may fail with
error **30034**; Tally shows that on the job's "Calls and texts" log so you can see it.

## 3. Supabase: the tables

1. Supabase › **SQL Editor** › New query. Paste all of `supabase-twilio.sql`, Run.
   (It needs `supabase-schema-v2.sql` to have been run already — it says so if not.)
2. **Table Editor › members**: copy the `org_id` of your moving company (any of your rows).
3. **Table Editor › comm_lines › Insert row:**
   - `org_id`: paste it
   - `phone_number`: your Twilio number as `+15125550000` (plus sign, country code, no spaces)
   - `enabled`: true

This table is the lock on your Twilio account. Anyone can start a company in Tally, but only a
company with a row here can send a text or place a call — and only you can add rows. A second
company (the property work) needs its own Twilio number and its own row.

## 4. Supabase: the Edge Function

Already deployed it? Open the function, paste the new `index.ts` over the old code, and
Deploy again. Nothing else changes.


1. Supabase › **Edge Functions › Deploy a new function › Via Editor**.
2. Name it exactly **`tally-twilio`**. Replace the sample code with all of
   `tally-twilio/index.ts`. **Deploy**.
3. Open the function's **Details/Settings** and turn **"Enforce JWT verification" OFF**, then
   save. Twilio can't send a Supabase sign-in, so the function checks callers itself: every app
   request carries the person's own sign-in, and every Twilio request is checked against
   Twilio's signature.
4. **Edge Functions › Secrets** (or *Manage secrets*), add:
   - `TWILIO_ACCOUNT_SID` = your Account SID
   - `TWILIO_AUTH_TOKEN` = your Auth Token
   - `TALLY_TZ` = your time zone, e.g. `America/Chicago` (optional; used to skip texts for past
     jobs; default is `America/Los_Angeles`)

The function's address is
`https://YOUR-PROJECT.supabase.co/functions/v1/tally-twilio`
(the same project URL you pasted into `tally-supabase.html`).

## 4b. The evening-before texts (optional, recommended)

This is the one text that runs on a clock instead of on a tap: every evening, each person on
tomorrow's jobs gets "Tomorrow you're on…", with a link to confirm if they haven't, and the
office gets who hasn't confirmed yet.

1. **Edge Functions › Secrets**, add `TALLY_CRON_SECRET` = any long random phrase you make up
   (e.g. three random words and a number). It stops strangers from triggering the run.
2. Supabase › **Integrations › Cron** (turn it on if asked) › **Create job**:
   - Name: `tally-tomorrow`
   - Schedule: `0 1 * * *` — Supabase clocks are UTC, so this is 6 PM Pacific in summer and 5 PM
     in winter. For Central time use `0 23 * * *` (6 PM summer).
   - Type: **HTTP request**, method **POST**
   - URL: `https://YOUR-PROJECT.supabase.co/functions/v1/tally-twilio/cron/tomorrow`
   - Header: `x-tally-cron` = the same phrase as `TALLY_CRON_SECRET`
3. Save. It never sends the same person two "tomorrow" texts in one evening, so a test run is safe.

Turn it off any time in Tally › Setup › Texts and calls.

## 4c. Distance lookup on quotes (Google Maps)

When both addresses are in on a quote, Tally fills in the driving miles. This needs a Google
key. It doesn't need Twilio, so you can do it on its own.

1. Go to **console.cloud.google.com**, create a project (e.g. "Tally"), and add a billing account
   when asked. Google requires a card even for the free allowance.
2. **APIs & Services › Library**: search **Routes API** and click **Enable**.
3. **APIs & Services › Credentials › Create credentials › API key**. Then edit the key and,
   under **API restrictions**, choose **Restrict key** and tick only **Routes API**. Save.
4. Optional safety net: **APIs & Services › Routes API › Quotas** — set requests per day to
   about 300. That keeps you inside the free allowance whatever happens.
5. Supabase › **Edge Functions › Secrets**: add `GOOGLE_MAPS_KEY` = that key. No redeploy needed
   for a new secret, but if you haven't redeployed since this update, paste in the new
   `index.ts` and deploy.

Cost: Google gives 10,000 free distance lookups a month on this tier; at 8 quotes a day you'd use
a few hundred. Beyond the free amount it's $5 per 1,000.

Until the key is in, the quote shows a "See the drive on Google Maps" link instead.

## 5. Point your Twilio number at it

Twilio › **Phone Numbers › Active numbers ›** your number:

- **Voice — A call comes in:** Webhook, HTTP POST,
  `https://YOUR-PROJECT.supabase.co/functions/v1/tally-twilio/twilio/voice`
- **Messaging — A message comes in:** Webhook, HTTP POST,
  `https://YOUR-PROJECT.supabase.co/functions/v1/tally-twilio/twilio/sms`

Save. Use the address exactly — Twilio signs the full address and the function checks it.

## 6. Put the new app online

Drag the new `tally-supabase.html` onto your Netlify site (Deploys › drag and drop), the same as
before. Your two config lines are blank in the new file, so paste the Project URL and anon key
back in first (same values as last time).

## 7. In Tally

**More › Setup › Texts and calls** should now say *Company line (512) 555-0000*.

- Make sure everyone has a phone number under **Crew** and **Office staff** — that's where
  texts go and which phone rings for a company-line call. The card lists anyone missing one.
- Pick **who rings when a customer calls the company line**. Nobody picked = the office staff.
- The switches turn each kind of text on or off.
- **Link in texts** fills itself in the first time you open this card on the hosted site. It's
  the address texts point to, so a tap opens the app at Job messages (or, in a truck-down text,
  at the alert).

**Try it:** call the Twilio number from your cell — your office phones should ring and announce
"Tally call from…". Then open a job, tap Call, choose *Call through the company line*: your
phone rings from the company number, press 1, and the customer's phone shows the company
number.

---

## What happens, day to day

| When | Who gets a text |
|---|---|
| Dispatch puts someone on a booked job (20 seconds after the last tap) | That person: job, day, time, pickup, truck, lead, and a link to confirm in the app |
| Someone is taken off a job | That person: "You're off…" |
| A job's day or time changes | Everyone still on it: new time, old time, and a link to confirm again |
| The evening before (Cron, 4b) | Each person on tomorrow's jobs: their jobs, plus a confirm link if they haven't. Office: who hasn't confirmed |
| Office taps "Text … a reminder" on a job | Everyone on it who hasn't confirmed |
| A lead taps Start job with the arrival text ticked | The customer: "on the way, about N minutes" |
| A lead exits signing with a form unsigned (after Done unloading) | Owner and dispatch (at most once every 6 hours per job) |
| Nobody answers the company line | Whoever rings for it: "Missed call from…" |
| A customer texts the company line | Whoever rings for it, with the text |
| A mover replies to an alert | Nobody — it lands in the app chat with Dispatch, free |
| A crew taps **Truck down** | Owner and dispatch: which truck, who sent it, the job, their note, a map link to where they are, and their number (at most 6 alerts an hour per company) |
| The crew taps **Running again**, or the office closes the alert | The same people: all clear |

Past jobs, quotes and finished jobs never trigger schedule texts. Every text and call is logged
on the job (job sheet › Calls and texts), with delivery status and any error. Crew see only
their own entries; owner and dispatch see all of them.

Calls are not recorded. Some states require everyone on a call to agree to recording, and Tally
doesn't ask, so it's left off.
