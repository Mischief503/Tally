# Card payments in MoveCrew (Stripe)

MoveCrew takes real card payments three ways. All of them run through Stripe, and card numbers never
touch MoveCrew:

| | How it works | Good for |
|---|---|---|
| **Pay link** | MoveCrew makes a secure Stripe page for the amount. The customer opens it from a text or by scanning a QR code on the crew's screen, then pays with Apple Pay, Google Pay or a card. | Paying at the end of the move, deposits when you book |
| **Card** | Stripe's own card box inside MoveCrew. The crew types the card the customer hands over. | A customer without a phone handy |
| **Card on file** | A card the customer agreed to keep on file (ticked on a pay link or a typed card) is charged again for the rest of the bill. | The balance after the move, when a deposit was paid by link |

Cash and checks are recorded the same way as before.

The payment lands on the job by itself: Stripe tells the server, the server writes it onto the job,
and every phone shows it. A finished job moves to **Paid** when the balance reaches zero.

## What is set up already

- The database parts: the payments tables, the ledger and the safe-merge function.
- A company listed in **Supabase › Table Editor › pay_orgs** (with enabled on) takes cards
  straight into your own Stripe account. Anyone can start a company in MoveCrew, so this list is what
  keeps a stranger's company from charging cards into your account. Since October 10 none is on:
  your **Live company trst** is a test company and connects its own Stripe account like the others.
- Every other company connects **its own** Stripe account from MoveCrew (Stripe Connect, below). Its
  customers' money goes to that company, not to you, and MoveCrew takes no cut.
- Companies pay you a monthly **membership** through the same Stripe account: see `MEMBERSHIP.md`
  (Setup › Membership for owners, More › MoveCrew admin for you).

## What you do: two keys into Supabase

1. Make a Stripe account at **stripe.com** (Start now). You can test everything before you finish
   the business details.
2. In Stripe, make sure you're in **test mode** (the sandbox), then open **Developers › API keys**.
   You'll see two keys:
   - **Publishable key**, starting `pk_test_`
   - **Secret key**, starting `sk_test_` (press **Reveal**)
3. In Supabase › your project › **Edge Functions › Secrets** › **Add new secret**, add both:
   - `STRIPE_SECRET_KEY` = the secret key
   - `STRIPE_PUBLISHABLE_KEY` = the publishable key

   Paste them into Supabase, not into a chat.

That's all. The first time anyone starts a payment, MoveCrew sets up its own Stripe webhook (it shows
up in Stripe under **Developers › Webhooks** as *MoveCrew payments*) and keeps its signing secret where
only the server can read it.

**Check it:** in MoveCrew, **Setup › Payments** should say *Stripe is connected (test mode)*.

## Try it with test cards

Open a finished job › **Collect payment**:

- **Pay link** › **Show a QR code**. Scan it with your phone and pay with
  `4242 4242 4242 4242`, any future date, any security code, any ZIP. Within a few seconds the job
  shows the payment and turns to **Paid**.
- **Card** › type the same test card › **Charge the card**.
- Tick **Keep the card on file** on a part payment, then pay the rest with **Card on file**.

Other test cards: `4000 0025 0000 3155` asks the customer to approve (3D Secure),
`4000 0000 0000 9995` is declined for insufficient funds. Nothing real is charged in test mode.

From the office, a job's sheet has **Send a payment link** for the deposit or the balance. A
deposit link keeps the card on file for the balance. Before the move, **Take a payment** on the sheet
has a **Deposit** button and a **Whole balance** button that fill in the amount, and a booked job
whose deposit hasn't come in shows under **Needs you** on Today and as **No deposit yet** on Jobs.

## How MoveCrew keeps a customer from being charged twice

- **The server decides what is owed**, from the job and its own record of every Stripe payment.
  A phone can't ask for more than that.
- **A pay link asks for what is owed when it is opened**, never more than it was made for. It works
  for 7 days. If the customer paid part in cash meanwhile, the link asks for less; if the bill is
  paid, it says so instead of opening a payment page. A newer link for the same job replaces the
  older one.
- **One payment starts per job at a time.** If two phones try at once, the second waits or is told
  another payment is under way. A card payment someone left half done is called off after 15
  minutes, so it can't go through later on top of another one.
- **Recording cash or a check** closes any pay link page that would now ask for too much.

## Cards on file

- Which card is which in Stripe stays on the server. The app's list shows the brand, last four,
  expiry and the name on the card, and which job it was kept on.
- A **crew lead** can charge a card kept on file on the job they're working, for whatever the bill
  came to, up to what's still owed: past the quote's estimated top price too (Oct 25; until then a
  lead could charge one only up to it). The **office** can also charge the customer's cards kept on
  their other jobs.
- Customers are matched by phone number. A customer without a phone number has their cards on the
  job they were kept on only, so two customers with the same name never share cards.
- A job's Stripe customer is fixed by its first card payment that goes through, so changing the name
  or phone on the job afterwards can't point it at someone else's card.
- Only the office can change a job's quote, and only the server writes card payments, refunds and
  disputes onto a job. A phone that tries is quietly put back.
- **Setup › Saved payment methods › Remove** takes a card off for good, in Stripe too.

## Refunds and disputes

Refund in Stripe (**Payments** › the payment › **Refund**). The refund shows on the job by itself
as a line taking money off the bill. If that leaves money owed on a job marked **Paid**, it goes
back to **Complete**.

A dispute (a chargeback) shows the same way while the customer's bank decides. If you win it, the
line comes off again. Answer disputes in Stripe (**Payments › Disputes**).

## Other companies: their own Stripe account (Connect)

Your Stripe account is the *platform*: MoveCrew uses your keys to set up each company's own Stripe
account and to take payments on it for them. The money lands in the company's account, Stripe pays
it out to the company's bank, and Stripe's card fee comes out of each payment. MoveCrew takes no cut
(companies pay you the membership instead). Refunds, disputes and payouts are the company's own, in
its own Stripe Dashboard at dashboard.stripe.com.

**What the owner of a company does** (owners only; dispatch and crews don't see it):

1. **Setup › Payments › Connect with Stripe.** Stripe's own sign-up page opens (in the phone's
   browser in the Android app).
2. On Stripe's page: the business details, the bank account for payouts, and an ID check. About ten
   minutes. MoveCrew never sees any of it. Have the EIN (or SSN for a sole owner) and the bank account
   ready.
3. Back in MoveCrew, **Setup › Payments** shows where it stands: what Stripe still needs (in plain
   words, with **Continue with Stripe**), *Stripe is checking your details*, and then
   *Card payments go to your own Stripe account*. It updates by itself when the owner comes back
   from Stripe, and when Stripe finishes checking.

Until then the payment screen offers cash and checks, and says the owner connects Stripe in Setup.
If a company disconnects MoveCrew in its Stripe Dashboard, cards stop and Setup says so, with
**Connect again** (that sets up a new Stripe account; old payments stay in the old one and their
refunds still show on the jobs).

**On your Stripe side:**

- **Sandbox (test keys): done October 10.** Connect is set up in the *Massive Art ENT. sandbox*
  (direct charges, Stripe collects its fees from the companies and covers losses, companies use the
  full Stripe Dashboard). MoveCrew makes a second webhook for the companies' accounts by itself
  (*MoveCrew payments (companies' own Stripe accounts)*).
- **Live, before another company takes real cards:** Stripe › **Settings › Connect › Platform
  profile › View onboarding**, and answer Stripe's questions about MoveCrew as a platform (it starts
  with sales tax). Add your branding under **Settings › Connect › Onboarding interface** (name,
  icon, color) so companies see MoveCrew on Stripe's sign-up page. If you use a restricted live key,
  it also needs Stripe's Connect permissions for accounts and account links.

**Try it in the sandbox:**

1. In MoveCrew, start a second company (any name; you're its owner).
2. In that company: **Setup › Payments › Connect with Stripe**.
3. Stripe's sandbox page usually offers test details to fill in. If it asks: phone code `000000`,
   SSN `000-00-0000`, address line 1 `address_full_match`, bank routing `110000000` and account
   `000123456789`.
4. Back in MoveCrew, **Setup › Payments** should turn to *Card payments go to your own Stripe account
   (test mode)*. Take a test card payment on one of that company's jobs: it shows in the sandbox
   under **Connect › Connected accounts ›** the company › **Payments**, not in your own payments.

## Payment methods customers see

Stripe › **Settings › Payment methods**. Cards, Apple Pay and Google Pay are on by default. If you
turn on more there (ACH bank payments, Affirm or Klarna for big moves), the pay link offers them too.
Bank payments show on the job as *pending* until they clear. If one bounces, it comes off the job
again and a job marked Paid goes back to Complete. The card box on the crew's phone takes cards only.

## Going live

1. Finish activating your Stripe account (business details and the bank account for payouts).
2. Switch Stripe to live mode. Instead of the full secret key, make a **restricted key**
   (Developers › API keys › **Create restricted key**) with only these permissions:
   - Checkout Sessions: **Write**
   - PaymentIntents: **Write**
   - Customers: **Write**
   - PaymentMethods: **Write** (to take a card off file)
   - Charges: **Read** (to see refunds)
   - Disputes: **Read**
   - Webhook Endpoints: **Write**
3. In Supabase, replace `STRIPE_SECRET_KEY` with the restricted key (`rk_live_…`) and
   `STRIPE_PUBLISHABLE_KEY` with the live publishable key (`pk_live_…`). MoveCrew makes a separate
   webhook for live mode the first time a live payment starts.

Tip: make the same restricted key in test mode first (`rk_test_…`), put it in Supabase, and run the
test cards once more. If MoveCrew says *The Stripe key is missing a permission*, the request that failed
shows in Stripe under **Developers › Logs**, with the permission it needed.

Once the live keys are in, test payments stop counting toward any bill (they show as *· test*),
cards saved in test mode can't be charged, and test jobs can't be charged at all.

## Costs

Stripe's standard US pricing (check stripe.com/pricing for yours): cards **2.9% + 30¢**, ACH bank
payments **0.8% capped at $5**, and **$15** per dispute (returned if you win). No monthly fee.

## If something's off

- **Setup › Payments** tells you what's missing: no keys, the company's Stripe account isn't
  connected or checked yet, or the publishable key doesn't match the secret key (one test, one
  live). If the server can't be reached, the payment screen offers cash and checks only, with a
  **Check again** button.
- **Connect with Stripe** shows Stripe's reason when Stripe says no (for example, that your
  platform questions aren't answered yet in live mode).
- Server log: Supabase › Edge Functions › **tally-twilio** › Logs.
- Stripe's side: **Developers › Webhooks › MoveCrew payments** shows every event and whether MoveCrew took
  it. If you ever delete that webhook, the next payment that starts makes a new one.
