# MoveCrew

Moving-company software: quotes, dispatch, crew in the field, signing, payments, texts and calls,
and a truck-down alert that tells the office where a broken-down truck is ([docs/TRUCK-DOWN.md](docs/TRUCK-DOWN.md)).
Local moves are billed by the hour and mileage moves by the mile plus loading and unloading time,
from what really happened on the job ([docs/PRICING.md](docs/PRICING.md)). The owner turns parts of it
on and off in Setup › Options ([docs/OPTIONS.md](docs/OPTIONS.md)).
One web app (`web/index.html`) that runs four ways:

- **Android app**, for the crews: built here by GitHub on every push. The APK has the whole app inside it.
- **Windows app**, for the office, dispatch and the call center: built and checked on a Windows
  computer by GitHub on every push (`windows/`). It installs once and keeps itself up to date.
- **Website**: the `web/` folder, put up by GitHub Pages (or any static host).
- **claude.ai artifact**: the same app without the Supabase block (`scripts/build.py` makes it).

## Get the app on a phone

On the phone, open **Releases › latest** in this repository and tap **MoveCrew.apk**. The full
steps, including the one-time "install unknown apps" permission, are in
[docs/GET-THE-APP.md](docs/GET-THE-APP.md).

Each push to `main` builds a new APK, opens it in an Android emulator to prove it loads, then
replaces `MoveCrew.apk` in the latest release. Installing a new one updates the app in place.

## Get the app on a Windows computer

Download **MoveCrew-Setup.exe** from the **MoveCrew for Windows** release
(`releases/download/windows/MoveCrew-Setup.exe`) and open it; if Windows says it protected your PC,
press **More info › Run anyway**. Details in [docs/GET-THE-APP.md](docs/GET-THE-APP.md#on-a-windows-computer-the-office-dispatch-the-call-center).

Each push to `main` builds the installer on a Windows computer, checks the app there (links, alerts,
updates), installs it like a new office computer would, opens it to the sign-in screen with Supabase
answering, then replaces the `windows` release. Installed copies update themselves from it. That
release is never marked Latest, so the phone app's links keep working.

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
| `windows/` | The Windows shell (Electron): `web/index.html` in its own window from a private address (`app://movecrew/`); links out, truck-down alerts on the taskbar, updates from the `windows` release |
| `supabase/functions/tally-twilio/` | Edge Function: texts, masked calls, call log, reminders, quote distance |
| `supabase/sql/` | Database add-ons (run in Supabase › SQL Editor) |
| `docs/` | Setup guides |
| `tests/` | Every check: UI (jsdom and Chromium), Edge Function (Deno), database rules (Postgres) |
| `scripts/` | Build helpers used by the workflows |

Run every check locally with `bash tests/run-all.sh` (needs Node 20, Deno 2, Python 3, Postgres).
GitHub runs them on every push (**Actions › Tests**).
