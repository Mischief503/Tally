# The customer side (Oct 28)

Richie's words: "I want there to be a customer side as well . Where they have a profile . Then they can have the app on
there phone if they would like and pay with google pay"; asked how they get in: "They open the app and sign in with their
gmail . Their move will already be link to their gmail"; and what they do: accept their quote, follow move day, sign
forms ahead, tip the crew, and "They should also be auto took to the review page for the company they book through after
the move is complete".

## How a customer gets in

- The office (or the call center) puts the customer's email on the quote or the job: **Email (they sign in with it to
  see their move)**. That's the link: nothing else to set up per customer.
- The customer opens the Tally website on their phone (`https://mischief503.github.io/Tally/`, also shown in Setup ›
  Customer app) and signs in with **Continue with Google** (once Google sign-in is set up, see SETUP-google-signin.md)
  or with a 6-digit code sent to their email (works now).
- A Gmail address matches with or without dots or a +tag, on gmail.com or googlemail.com (`emailKey`, the same in the
  app and the server).
- On a job, **Text them the app** sends the address and the email to sign in with, from the company line.
- They can put it on their home screen like an app (Profile › Get the app: Chrome's Install or Add to Home screen on
  Android; Share › Add to Home Screen in Safari on an iPhone). Nothing comes from a store.
- Someone who works for a company and has a move of their own: More › **My moves**, and Profile › **Back to work**.
- An email with no move yet: the app says to ask the moving company to put that email on the move.

## What they see and do

Three tabs: **My move**, **Pay**, **Profile**. More than one move (or more than one company): the one that needs them
most first, and a list of the rest.

- **The quote**: the day, the arrival time, the addresses, the movers, trucks and hours, the price (and the estimated
  top price on hourly moves), the price lines and what's moving. **Book my move** (Options › Customers book their own
  quote): the day must not have passed, and there must still be room on the trucks then. It's booked with no truck:
  dispatch adds the truck and crew (Needs scheduling), and the owner and dispatch get a text when the company line is
  set up.
- **The deposit**: straight after booking, when the company takes deposits.
- **Forms to sign ahead**: the required forms marked **Customer signs ahead** in Setup › Forms to sign (a sample
  moving agreement is one tap away there). Signed ahead, the crew isn't asked for them at the end. The delivery receipt
  stays with the crew.
- **A bigger crew** (more movers on the move than quoted, Oct 29): **Sign for your bigger crew**, with the movers and
  their rate, until the crew starts loading (on move day too); otherwise the lead gets it on their phone at Start
  loading, never at Start job (Richie: "Having them sign on the crews side of the app before we start doesnt make sense
  we are not with the customer yet"). See PRICING.md, A bigger crew.
- **Move day**: the crew on the way (about when, from the arrival time at Start job), loading, on the road, unloading,
  finishing up, as the lead taps them.
- **The bill**, once the move is done, with a **tip for the crew** (no tip, 10, 15, 20% or their own amount;
  Options › Tips for the crew). The tip goes to the movers on the job, split evenly, apart from the bill.
- **The review page**: once the move is done and paid, the app thanks them, counts down 5 seconds and opens the
  company's review page (Setup › Customer app › Review page), once. "Not now" isn't asked again.
- **Profile**: their name and phone (kept on their account and put on their open moves) and the email they sign in with.
- Never shown: the crew's pay, the costs, job notes, crew notes, the activity, the crew's names (only the lead's first
  name and how many movers).

## Paying with Google Pay

Pay opens the company's **Stripe page** (Stripe Checkout, on the company's own Stripe account or Tally's): Google Pay
on Android phones with a card in Google Wallet, Apple Pay on iPhones, or a card. It needs nothing in the code; Google
Pay has to be on in Stripe › Settings › Payment methods (on by default for most accounts). The page comes back to the
app, which brings the move up to date and says thank you.

- What's owed is worked out on the server, never taken from the app: the deposit on a booked move, the bill on a done
  one. An out-of-date screen is shown the new amount instead of being charged.
- The page is kept like a pay link (pay_links, `created_by` "customer (app)"): a cash payment or a newer page closes it,
  so the bill can't be paid twice. Its code never works as a pay link, and the office's pay link never hands it out.
- The tip is its own line on the page. The payment says how much (metadata `tally_tip`), the ledger keeps it in its
  source (`cust;tip=<cents>`), and the job's payment carries it as `tip`: it never counts toward the bill. A refund or a
  dispute comes off the bill's part first, then the tip's (an `rt_` line).

## Where it lives

- The app: the customer module in `web/index.html` (`custMoveOf`, `renderMyMove`, `renderMyPay`, `renderMyProfile`, the
  `cs:` sheets), and in the hosted back end `window.tallyCust` (their moves through the Edge Function).
- The server: the Edge Function's customer actions (`cust_list`, `cust_book`, `cust_sign`, `cust_pay`, `cust_check`,
  `cust_reviewed`, `cust_profile`; and the office's `invite_app`). A customer is none of a company's people, so they
  never touch the database directly: the function checks their sign-in (a confirmed email) and that each move has
  that email. No new tables, no SQL to run.
- The website: `.github/workflows/website.yml` and `scripts/prepare_site.py` put `web/` on GitHub Pages on every push,
  once Pages is on for the repository (Settings › Pages › Build and deployment › Source: **GitHub Actions**; until
  then the workflow only says so).
- Tests: `tests/ui/cust.js` (both editions), `tests/ui/cust-hosted.js`, `tests/function/cust.ts`.

## Not built yet

- A Play Store listing for customers (the home-screen app needs none).
- Live truck location for the customer (move day shows the steps the lead taps).
- Customers rescheduling or cancelling in the app (they call or text the company).
- Tips in Reports and the crew's pay.
