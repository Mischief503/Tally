# Tally

Moving-company software: quotes, dispatch, crew in the field, signing, payments, texts and calls,
and a truck-down alert that tells the office where a broken-down truck is ([docs/TRUCK-DOWN.md](docs/TRUCK-DOWN.md)).
Local moves are billed by the hour and mileage moves by the mile plus loading and unloading time,
from what really happened on the job ([docs/PRICING.md](docs/PRICING.md)).
One web app (`web/index.html`) that runs three ways:

- **Android app**: built here by GitHub on every push. The APK has the whole app inside it.
- **Website**: the `web/` folder, for any static host such as Netlify.
- **claude.ai artifact**: the same app without the Supabase block (`scripts/build.py` makes it).

## Get the app on a phone

On the phone, open **Releases › latest** in this repository and tap **Tally.apk**. The full
steps, including the one-time "install unknown apps" permission, are in
[docs/GET-THE-APP.md](docs/GET-THE-APP.md).

Each push to `main` builds a new APK, opens it in an Android emulator to prove it loads, then
replaces `Tally.apk` in the latest release. Installing a new one updates the app in place.

## Settings GitHub uses when it builds

**Settings › Secrets and variables › Actions**

| Name | Kind | What it is |
|---|---|---|
| `TALLY_SUPABASE_URL` | Variable | Supabase › Project Settings › API › Project URL |
| `TALLY_SUPABASE_ANON_KEY` | Variable | The "anon public" key on the same page (safe to publish) |
| `TALLY_KEYSTORE_BASE64`, `TALLY_KEYSTORE_PASSWORD`, `TALLY_KEY_ALIAS`, `TALLY_KEY_PASSWORD` | Secrets | Optional. Your own signing key, before a Play Store release |

Without the two Supabase variables, the app runs on one phone with sample data. Never put the
Supabase **service role** key, the Twilio token or a Google key in this repository. Those live
only in Supabase › Edge Functions › Secrets.

The APK is signed with `android/app/tally-test.keystore`, a test key kept in this public
repository so every build can update the last one. Use your own key before going to the Play Store.

## What's where

| Path | |
|---|---|
| `web/` | The app (`index.html`) plus the website pieces: manifest, offline helper, icons |
| `android/` | The Android shell: shows `web/index.html` full screen; handles camera, file picker, location, Back, and calls/texts/maps |
| `supabase/functions/tally-twilio/` | Edge Function: texts, masked calls, call log, reminders, quote distance |
| `supabase/sql/` | Database add-ons (run in Supabase › SQL Editor) |
| `docs/` | Setup guides |
| `tests/` | Every check: UI (jsdom and Chromium), Edge Function (Deno), database rules (Postgres) |
| `scripts/` | Build helpers used by the workflows |

Run every check locally with `bash tests/run-all.sh` (needs Node 20, Deno 2, Python 3, Postgres).
GitHub runs them on every push (**Actions › Tests**).
