# The call center

A service Tally sells to moving companies: Tally's own call center team answers for them, quotes
their customers and books jobs onto their schedules. Richie's words (Oct 22, 2026): "Call center is a
service that the moving companys will be able to purchase to help get bookings . So call center will
only be able to see companys that pay for that service ."

- The team is **Tally's own people**, not a company's employees. A company can't make one of its own
  people the call center.
- **Tally admin switches the service on** for each company that buys it. Richie bills the companies
  himself; nothing in the app charges for it.
- The team sees **only the companies switched on**, and of those only what quoting and booking need.
- Phone calls to a company's Tally line are left as they are for now (companies send their calls to
  the call center themselves).

## Setting it up (hosted app)

1. Run `supabase/sql/supabase-callcenter.sql` once in the Supabase SQL editor (after
   `supabase-schema-v2.sql` and `supabase-payments.sql`; it's safe to run again). Until then, Tally
   admin's Call center team section says so.
2. **Tally admin › Call center team**: add each person with their name, the email they sign in
   with, and their phone. The phone is what a company's line rings when they press **Call** on a
   quote, before it connects them to the customer.
3. **Tally admin › a company › Change › Call center service**: switch it on for each company that
   buys the service. Switched off, the team stops seeing that company at once.
4. The person signs in to Tally with that email. They don't join any company; their app opens on
   **Companies**.

A company's owner sees what the call center sees with **More › See it their way › Call center**.

## What the team sees

The bottom bar: **Companies**, **Schedule**, **Quotes**, the round **+** for a new quote, and
**More** (the look, their profile, sign out). No Truck down, no chat.

**Companies.** The customer's pickup address and move date at the top, then a map of every company
with the service, then the companies in a list:

- With the pickup filled in, the companies line up nearest first ("8.6 mi from the pickup", in a
  straight line) and the map centres on the pickup.
- With the move date filled in, each company shows how busy it is that day: **Open**,
  **2 of 3 trucks**, or **Full**, and the map's numbered dots take the same colours (green, orange,
  red), the same ones as the Schedule's calendar.
- Tapping a company (or its dot) opens its **rate card**: the hourly rate for 2, 3 and 4 movers,
  the minimum hours, the truck and fuel fee, stairs, packing, the local area and the rate per mile
  past it, the deposit, sales tax, the not-to-exceed price (a guide) and the specialty items' fees,
  whether the move is local for them, their shop and their trucks.
- **Make a quote for <company>** opens that company's quote builder with the pickup and the date
  already filled in. **Their schedule** opens that company's calendar on the move date.

In the phone app the map is a street map (OpenStreetMap, through Leaflet, loaded the first time).
Where that can't load (the claude.ai copy, no connection) it is a drawing of how far each company is
from the pickup, with rings every few miles. The claude.ai copy can't look addresses up, so it
measures from the middle of the town in the address; the sample company has three made-up companies
beside it so the map has something to show.

A company's spot on the map comes from its shop address (Setup › Company). The owner's phone looks it
up once when the shop address changes and saves it with the settings; for a company without one yet,
the call center's phone looks the shop up itself and remembers it.

**Inside a company** (after Make a quote or Their schedule; the header shows which company):

- **Schedule.** A month of days. Each day shows how many jobs are booked and is coloured by how many
  trucks are taken (green some, orange half or more, red every truck; a job without a truck yet
  counts the trucks its quote needs). Tap a day for its jobs, earliest first: the time, the
  customer, the route, the crew size and the hours. Open one for the phone (with **Call**), the
  email, the addresses, stairs, how many movers are on it so far (not who), the truck, the custom
  fields, the items and the job notes. Never the price, the payments or the bill.
- **Quotes.** Every open quote and lead, newest first, with its price and when it was made. Search by
  name, phone (or its last digits) or address. **Open quote**, **Call**, **Mark lost** (tap twice).
- **New quote.** The same quote builder as the office, with two differences: the price step has no
  **Discount** (a discount the office gave stays as it was), and **Book job** needs the move date, so
  the job lands on the schedule. The date says how busy that day already is. After booking: "Booked
  for Thu, Oct 30 at 8:00 AM. Dispatch adds the crew and trucks." Booking is the call center's last
  change to a job; after that it's the office's.

The office sees "Quote made by Jess (call center)" on the job sheet, and the job's activity says who
booked it or marked it lost ("Booked by Jess (call center)").

## What the database enforces

From `supabase-callcenter.sql` (the same blocks are in `supabase-schema-v2.sql` and
`supabase-payments.sql`, between the `-- @cc` lines; `scripts/cc_sql.py` writes the file from them):

- **The team:** `tally_cc_team` (email, name, phone; linked to a sign-in by `claim_cc_team()` once
  the email is confirmed) and `cc_orgs` (the companies with the service). Nobody in the app reads or
  changes either; Tally admin does it through the Edge Function.
- **Who counts as the call center for a company** (`cc_in`): on the team, the company switched on,
  and not one of the company's own people (a company's crew member who is also on the team is still
  just crew there).
- **Reading:** the company's name; its rate card (`ratecard/main`: a copy of the settings with the
  prices only, kept by a trigger on every save of the settings; never the crew, pay, costs, phones,
  materials' costs, forms or the office); the open quotes and leads, in full; the schedule as a copy
  without the money (`sched/<job id>`, kept by a trigger as every job is saved). Nothing else: not
  the settings themselves, the booked jobs, the people, the chat, the crew's locations, the photos or
  the forms.
- **Writing:** only through `cc_save`, which the app calls for them. A new job is a quote or a
  booking with no payment and no discount. A change is to an open quote only; it can change the
  price but not the discount or the payments, and booking it or marking it lost is the last change.
  A quote the office booked or closed meanwhile is closed to them: their phone drops it and says so.
- `my_orgs` lists the companies with the service for the team (as "Call center").
- **The Edge Function** knows the team in a switched-on company: they can look up a quote's miles,
  and call customers on open quotes and scheduled jobs through the company's line (it rings their
  phone from the team list first).

## Not built yet

- Ringing the call center when a customer calls a company's Tally line (Richie: leave calls alone
  for now).
- Billing for the service in the app (Richie bills the companies himself).
- Taking a deposit when booking (the office takes payments, or sends a pay link).
