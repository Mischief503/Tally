# Tally on Android: from the folder to an installed app

No terminal. About 30 minutes the first time. You'll use three websites: Netlify (puts Tally
online), PWABuilder (turns it into an Android app), and your phone.

**How the app works:** the Android app opens your Tally website, full screen, with its own icon.
So when Tally changes, you replace the website files and every phone gets the new version the
next time the app opens. You only build a new APK if you change the app's name or icon.

---

## 1. Put your Supabase details in (one time)

Skip this to try Tally on a single phone with sample data. Nothing syncs and no texts go out.

1. Unzip `tally-app.zip`. You get a folder called `tally-app`.
2. Open `tally-app/index.html` in a plain text editor: Notepad on Windows, or TextEdit on a Mac
   (Format › Make Plain Text first).
3. Find `PASTE_YOUR_PROJECT_URL` and `PASTE_YOUR_ANON_PUBLIC_KEY` near the top, and replace them
   with your Supabase Project URL and anon public key (Supabase › Project Settings › API), the
   same two values as in `SETUP-supabase.md`. Keep the quote marks. Save.

## 2. Put the folder online (Netlify)

1. Sign in at **app.netlify.com** (free). Signing in first matters: a site dropped without an
   account is deleted after a short while.
2. Go to **app.netlify.com/drop** and drag the whole `tally-app` folder onto the page.
3. You get an address like `https://cheerful-otter-1234.netlify.app`. You can rename it under
   **Site configuration › Change site name** (e.g. `acemoving-tally`).
4. Open that address on your phone in Chrome and sign in once, to check it works.

If you use Twilio, open **Setup › Texts and calls** once from this address. That makes the links
in texts point here.

## 3. Build the Android app (PWABuilder)

1. Go to **pwabuilder.com**, paste your Netlify address, press **Start**.
2. It checks the site. Tally ships with everything it looks for (app name, icons, offline
   support), so you can go straight to **Package for stores**.
3. Under **Android**, press **Generate package**. The defaults are fine. Package ID: something
   like `com.acemoving.tally`. Signing key: **New**. Press **Download**.
4. You get a zip. Inside:
   - an **.apk**: the file you install on phones
   - an **.aab**: for the Google Play Store later, if you want it there
   - **assetlinks.json**: used in step 5
   - **signing.keystore** and **signing-key-info.txt**: keep both somewhere safe, like a password
     manager. Every future version of the app must be signed with them.

## 4. Install it on a phone

1. Get the .apk onto the phone: email it to yourself, put it in Google Drive, or plug in a cable.
2. Tap it. Android asks to allow installs from that app (Chrome, Gmail, Files). Allow it once.
3. Tap **Install**. Tally shows up with its own icon.

Do the same on each employee's phone, or put it on the Play Store later using the .aab.

## 5. Hide the address bar (recommended)

Until this step, the app shows a thin bar with your web address at the top. To remove it:

1. In your `tally-app` folder, make a new folder named `.well-known`, with the dot at the start.
   On a Mac, Finder hides dot-folders: make it as `well-known`, then rename it, and accept the
   warning.
2. Put the `assetlinks.json` from PWABuilder's zip inside it.
3. In Netlify, open your site › **Deploys**, and drag the `tally-app` folder onto the box that
   says to drag and drop a new version.
4. Close the app fully and open it again. The bar is gone.

If you later publish through Google Play, Play re-signs the app. You then update `assetlinks.json`
with the fingerprint from Play Console › App signing, as PWABuilder explains.

## 6. Updating Tally later

When I send a new `tally-app.zip`:
1. Unzip it and put your two Supabase values back into `index.html` (step 1).
2. Copy your `.well-known` folder into it.
3. Drag the folder onto **Deploys** for the same site.

Phones pick up the new version next time the app opens. No new APK needed.

---

## What works where

| | On one phone (step 1 skipped) | With Supabase | + Twilio (`SETUP-twilio.md`) | + Google key (4c) |
|---|---|---|---|---|
| Quotes, jobs, field steps, signing, payments, reports | ✓ | ✓ | ✓ | ✓ |
| Sign-in, sharing between phones, chat, confirmations | | ✓ | ✓ | ✓ |
| Texts, company-line calls, arrival texts, evening reminders | | | ✓ | ✓ |
| Distance filled in on quotes | Map link | Map link | Map link | ✓ |

**Back button:** in the app, the phone's Back button closes whatever is open (a job, the signing
screen, a menu) before it leaves Tally.

**Quicker test without an APK:** open your Netlify address in Chrome on the phone, tap **⋮ ›
Add to Home screen › Install**. You get the same app, minus the APK file.
