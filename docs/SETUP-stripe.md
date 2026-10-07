# Card payments in Tally (Stripe)

Tally takes real card payments three ways. All of them run through Stripe, and card numbers never
touch Tally:

| | How it works | Good for |
|---|---|---|
| **Pay link** | Tally makes a secure Stripe page for the amount. The customer opens it from a text or by scanning a QR code on the crew's screen, then pays with Apple Pay, Google Pay or a card. | Paying at the end of the move, deposits when you book |
| **Card** | Stripe's own card box inside Tally. The crew types the card the customer hands over. | A customer without a phone handy |
| **Card on file** | A card the customer agreed to keep on file (ticked on a pay link or a typed card) is charged again for the rest of the bill. | The balance after the move, when a deposit was paid by link |

Cash and checks are recorded the same way as before.

The payment lands on the job by itself: Stripe tells the server, the server writes it onto the job,
and every phone shows it. A finished job moves to **Paid** when the balance reaches zero.

## What is set up already

- The database parts: the payments tables, the ledger and the safe-merge function.
- Your company (**Live company trst**) is turned on for card payments. Only companies listed in
  **Supabase › Table Editor › pay_orgs** can take cards. Anyone can start a company in Tally, so
  this list is what keeps a stranger's company from charging cards into your Stripe account.

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

That's all. The first time anyone starts a payment, Tally sets up its own Stripe webhook (it shows
up in Stripe under **Developers › Webhooks** as *Tally payments*) and keeps its signing secret where
only the server can read it.

**Check it:** in Tally, **Setup › Payments** should say *Stripe is connected (test mode)*.

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
deposit link keeps the card on file for the balance.

## How Tally keeps a customer from being charged twice

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
- A **crew lead** can charge a card kept on file on the job they're working, up to the quote's
  not-to-exceed amount (the customer isn't there to approve more). For anything past that, they send
  a pay link or the office charges it. The **office** can also charge the customer's cards kept on
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
   `STRIPE_PUBLISHABLE_KEY` with the live publishable key (`pk_live_…`). Tally makes a separate
   webhook for live mode the first time a live payment starts.

Tip: make the same restricted key in test mode first (`rk_test_…`), put it in Supabase, and run the
test cards once more. If Tally says *The Stripe key is missing a permission*, the request that failed
shows in Stripe under **Developers › Logs**, with the permission it needed.

Once the live keys are in, test payments stop counting toward any bill (they show as *· test*),
cards saved in test mode can't be charged, and test jobs can't be charged at all.

## Costs

Stripe's standard US pricing (check stripe.com/pricing for yours): cards **2.9% + 30¢**, ACH bank
payments **0.8% capped at $5**, and **$15** per dispute (returned if you win). No monthly fee.

## If something's off

- **Setup › Payments** tells you what's missing: no keys, the company isn't turned on, or the
  publishable key doesn't match the secret key (one test, one live). If the server can't be
  reached, the payment screen offers cash and checks only, with a **Check again** button.
- Server log: Supabase › Edge Functions › **tally-twilio** › Logs.
- Stripe's side: **Developers › Webhooks › Tally payments** shows every event and whether Tally took
  it. If you ever delete that webhook, the next payment that starts makes a new one.
