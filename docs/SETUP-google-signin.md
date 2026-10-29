# Sign in with Google (for customers)

Customers can already sign in with a 6-digit code sent to their email. These steps add a **Continue with Google**
button: one tap on an Android phone signed in to Gmail. About 15 minutes, all in a web browser. You paste the secret
yourself; it never goes in a chat or in the code.

## 0. GitHub: put the website up (once, 1 minute)

The customer app is the MoveCrew website, which GitHub puts up from the repository. If
`https://mischief503.github.io/Tally/` doesn't open yet: **github.com/Mischief503/Tally** › **Settings** › **Pages** ›
Build and deployment › Source: **GitHub Actions**. Then **Actions** › **Website** › **Run workflow** (or wait for the next
change). A minute later the address works.

## 1. Google: make a sign-in key

1. Go to **console.cloud.google.com** and sign in with the Google account for your business.
2. At the top, pick a project or make a new one (**New project**, name it `MoveCrew`).
3. Menu › **APIs & Services** › **OAuth consent screen** (Google may call it **Google Auth Platform**).
   - User type: **External**. App name: `MoveCrew`. Support email and developer email: yours. Save.
   - Under **Audience**, press **Publish app** when you're ready for customers (until then only test users you add
     can sign in).
4. Menu › **APIs & Services** › **Credentials** › **Create credentials** › **OAuth client ID**.
   - Application type: **Web application**. Name: `MoveCrew Supabase`.
   - **Authorized redirect URIs** › Add: `https://jgajcfvrzxafoqekzcug.supabase.co/auth/v1/callback`
   - Create. Google shows a **Client ID** and a **Client secret**. Keep the page open.

## 2. Supabase: switch Google on

1. **supabase.com** › your project › **Authentication** › **Sign In / Providers** (or **Providers**) › **Google**.
2. Turn it on. Paste the **Client ID** and the **Client secret** from step 1. Save.
3. **Authentication** › **URL Configuration** › **Redirect URLs** › Add: `https://mischief503.github.io/Tally/**`
   (Google sends people back to the MoveCrew website). Save.

That's all: the button shows up on the sign-in screen by itself as soon as Google is on in Supabase. It doesn't show in
the crew's Android app (Google won't sign in inside an app's own window there); the crew sign in with their code.

## 3. Stripe: Google Pay

Paying in the customer app opens Stripe's own page, which shows Google Pay on Android phones with a card in Google
Wallet (and Apple Pay on iPhones). Check it's on: **dashboard.stripe.com** › Settings › **Payment methods** › Google Pay.
A company with its own Stripe account (Setup › Payments › Connect with Stripe) checks the same in its own Stripe account.
