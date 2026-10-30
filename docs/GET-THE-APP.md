# Getting MoveCrew on a phone, and on an office computer

## The first time

1. On the Android phone, open this repository's **Releases** page (or bookmark
   `https://github.com/<your-account>/Tally/releases/latest`).
2. Under **Assets**, tap **MoveCrew.apk**. Chrome downloads it.
3. Tap the download. Android asks to allow installs from Chrome. Turn that on once, go back, and
   tap **Install**.
4. Open **MoveCrew** from the home screen.

Android may warn that the app is from an unknown developer. That's expected for an app you build
yourself rather than download from the Play Store.

## Updates

When a new build finishes (Actions › Android app turns green), download **MoveCrew.apk** again from
the same page and install it. It updates in place, and data on the phone stays.

## Connecting the phones to each other

Until Supabase is connected, each phone is on its own with sample data. To connect:

1. Set up Supabase (`SETUP-supabase.md`).
2. In this repository: **Settings › Secrets and variables › Actions › Variables** › add
   `TALLY_SUPABASE_URL` and `TALLY_SUPABASE_ANON_KEY`.
3. **Actions › Android app › Run workflow** (or push any change). Install the new MoveCrew.apk.

Texts and company-line calls also need the Twilio steps, and the distance lookup needs the
Google key (both in `SETUP-twilio.md`).

## What the app does that the website can't

- **Back button** closes the open screen (a job, signing, a menu) before it leaves MoveCrew.
- **Photo buttons** offer the camera first, then the gallery.
- **Calls, texts and directions** open the phone's own apps.
- **Location** is asked for once, and shared only while someone is clocked in.
- **Opens with no signal**, because the app is inside the APK.

Texts still link to the MoveCrew website if you also host one (see `SETUP-website.md`). Without
it, texts tell people to open MoveCrew › Job messages.

# On a Windows computer (the office, dispatch, the call center)

MoveCrew for Windows is the same app in its own window, for people who work at a desk and don't go out
in the field (Richie, Oct 30: "call center and office employees like the dispatch that may not go out
in the field"). The crews keep the phone app. Everyone signs in with the email on their profile, and
sees the sides of the app their profile gives them.

## The first time

1. On the computer, open
   `https://github.com/<your-account>/Tally/releases/download/windows/MoveCrew-Setup.exe`
   (or this repository's **Releases** page › **MoveCrew for Windows** › **MoveCrew-Setup.exe**).
   The same link is in Setup › Employees.
2. Open the download. It installs in a few seconds, for that Windows user, with no administrator
   password, and puts MoveCrew on the desktop and in the Start menu.
3. Windows may say **"Windows protected your PC"**. That's Windows being careful with a program it
   hasn't seen many times; MoveCrew isn't signed with a paid certificate yet. Press **More info**, then
   **Run anyway**. It asks once.
4. Sign in with the email on your profile and the 6-digit code.

Texting someone the app from their profile (**Text Dana the app**) sends this link to people who work
only in the office, and the phone app's link to everyone in the field.

## Updates

Nothing to do. Every change is built and checked on a Windows computer by GitHub (**Actions ›
Windows app**), then published. A copy that's open looks for a new version when it starts and every
few hours, downloads it in the background, and shows **A new version of MoveCrew is ready** with
**Restart now** and **Later**. Later is fine: the new version goes in the next time MoveCrew is closed.

## What the Windows app does that a browser tab doesn't

- **Its own window** in the taskbar and the Start menu, the right size and place each time.
  Starting it again brings that window up; there's only ever one.
- **A truck-down alert** chimes even when MoveCrew is behind other windows or minimized, flashes it
  on the taskbar, and pops up a Windows notice. Clicking the notice brings MoveCrew to the front.
- **Stays live in the background**: the board and alerts keep updating while you're in other programs.
- **Opens with no internet**, because the app is inside it, like the phone app.
- **Calls, texts, maps, documents and Stripe's pages** open in the computer's own apps: the browser,
  and Phone Link or Teams for calls when the computer has one.
- **Right-click** has Cut, Copy, Paste and spelling suggestions. **Ctrl +** and **Ctrl -** make
  everything bigger or smaller (**Ctrl 0** goes back), **F5** reloads, **F11** is full screen, and the
  mouse's back button closes what's open.

Removing it: Windows **Settings › Apps › Installed apps › MoveCrew › Uninstall**. Your sign-in and
settings for this computer stay in the user's AppData folder in case it's installed again.
