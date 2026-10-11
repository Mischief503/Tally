# The Tally membership and Tally admin

Companies pay Tally a monthly membership. Tally takes no cut of their customers' card payments
(those go to each company's own Stripe account, see `SETUP-stripe.md`).

## What a company sees

- **Anyone can start a company** in the app. It gets a free trial (14 days unless you change it).
- The owner finds **Setup › Membership**: how many days of trial are left and the price after it.
  **Start membership** opens Stripe's own checkout page. The card is kept by Stripe and isn't
  charged until the trial ends (with less than two days left, Stripe starts the membership the same
  day). **Manage billing** opens Stripe's billing page: change the card, see invoices, cancel (the
  membership then runs to the end of the month it's paid for).
- In the last three days of the trial, after it, or when a membership payment fails, **Today**
  reminds the owner, with a button to the Membership card. **Nobody is locked out**: the app keeps
  working. If you ever want the app to stop after a trial, that can be a switch in Tally admin.
- Dispatch and the crew never see the membership.

## Tally admin (you only)

**More › Tally admin**, shown only to Tally's admins (you, by your sign-in; it isn't a role a
company can give anyone). It lists every company:

- the owner's email (or who it's waiting for), how many people, since when;
- where the membership stands: free trial until a date, set up but still free, paying (and how
  much), payment failed, fee waived, test company;
- whether its card payments are set up (its own Stripe account connected, or still checking);
- at the top: how many companies, how many pay and what that adds up to a month.

**Change** on a company:

- **Test company**: never charged, labelled **TEST** at the top of the app for everyone in it.
  Use it to try things. Your "Live company trst" is one.
- **Waive the membership fee**: nothing to pay. If the company was already paying, Stripe stops
  charging at once (a 100% coupon on its membership), and switching it back starts charging again
  without the owner doing anything.
- **Discount (%)**: taken off every month, from the next invoice of a running membership, or from
  the start of a new one.
- **Note**: only admins see it.

**Membership price**: the monthly price and the free trial for new companies. Companies already
paying keep their price.

**Add a company**: the company name and the owner's email. When that person signs in to Tally with
that email, they go straight in as the owner (no company code). With your own email you're its
owner at once (tick Test company for another test company; switch to it from the company list).

## On the Stripe side

Nothing to set up. The first time a membership starts, the server makes in Stripe, on your own
account: a product "Tally membership", a monthly price (a new one whenever you change the price),
coupons for the discounts used, and the settings for Stripe's billing page. Memberships show in
Stripe under **Billing › Subscriptions**, each labelled with the company. Stripe can also email the
owner receipts and failed-payment notices: switch those on in Stripe › **Settings › Customer
emails** (Stripe doesn't send them in test mode).

The server's own webhook (*Tally payments*) also listens for memberships: started, changed,
cancelled, invoices paid or failed. It updates itself the first time a payment or membership
starts after this version is deployed.

**In test mode** (now) nothing real is charged. To try it: Tally admin › Add a company, with your
own email and Test company left unticked; switch to it, then Setup › Membership › Start membership,
and pay with `4242 4242 4242 4242`. **With live keys**, memberships charge real cards;
test-mode memberships don't carry over. A restricted live key also needs Stripe's permissions for
Products, Prices, Coupons, Subscriptions, Checkout Sessions, Customers and the Customer portal.

## Who's an admin

Only a database change makes someone an admin, never the app:

```sql
insert into public.tally_admins(user_id)
  select id from auth.users where lower(email) = 'someone@example.com';
```

You were added on October 10, 2026.
