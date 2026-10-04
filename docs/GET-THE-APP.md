# Getting Tally on a phone

## The first time

1. On the Android phone, open this repository's **Releases** page (or bookmark
   `https://github.com/<your-account>/Tally/releases/latest`).
2. Under **Assets**, tap **Tally.apk**. Chrome downloads it.
3. Tap the download. Android asks to allow installs from Chrome. Turn that on once, go back, and
   tap **Install**.
4. Open **Tally** from the home screen.

Android may warn that the app is from an unknown developer. That's expected for an app you build
yourself rather than download from the Play Store.

## Updates

When a new build finishes (Actions › Android app turns green), download **Tally.apk** again from
the same page and install it. It updates in place, and data on the phone stays.

## Connecting the phones to each other

Until Supabase is connected, each phone is on its own with sample data. To connect:

1. Set up Supabase (`SETUP-supabase.md`).
2. In this repository: **Settings › Secrets and variables › Actions › Variables** › add
   `TALLY_SUPABASE_URL` and `TALLY_SUPABASE_ANON_KEY`.
3. **Actions › Android app › Run workflow** (or push any change). Install the new Tally.apk.

Texts and company-line calls also need the Twilio steps, and the distance lookup needs the
Google key (both in `SETUP-twilio.md`).

## What the app does that the website can't

- **Back button** closes the open screen (a job, signing, a menu) before it leaves Tally.
- **Photo buttons** offer the camera first, then the gallery.
- **Calls, texts and directions** open the phone's own apps.
- **Location** is asked for once, and shared only while someone is clocked in.
- **Opens with no signal**, because the app is inside the APK.

Texts still link to the Tally website if you also host one (see `SETUP-website.md`). Without
it, texts tell people to open Tally › Job messages.
