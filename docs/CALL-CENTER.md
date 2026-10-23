# The call center

A role for the people who answer the phones. They make quotes, book them onto the schedule, and
see the schedule. Nothing else in Tally is theirs: no Today screen, no Jobs list, no Board, no field
view, no chat, no money screens, no Setup.

## Setting someone up

- **Setup › Employees**: give the person the role **Call center** (and the email they sign in
  with, in the hosted app). They go on the call center list, not the crew or the office.
- In the claude.ai copy, **Setup › App access** has **Call center** in the role list too.
- **More › See it their way › Call center** shows the owner exactly what they see.
- The hosted app needs `supabase/sql/supabase-callcenter.sql` run once in the Supabase SQL editor
  (after the other files). Until then, the database doesn't know the role.

## What they see

The bottom bar is **Schedule**, **Quotes**, the round **+** button for a new quote, and **More**
(the look, their profile, sign out). No Truck down.

**Schedule.** A month of days. Each day shows how many jobs are booked and is coloured by how many
trucks are taken:

| Colour | Meaning |
| --- | --- |
| None | Nothing booked |
| Green | Some trucks taken |
| Orange | Half the fleet or more |
| Red | Every truck |

A job without a truck yet counts the trucks its quote needs. Tap a day to see its jobs, earliest
first: the time, the customer, the route, the crew size and the estimated hours. Open one for the
phone number (with **Call**), the email, the addresses, stairs, how many movers are on it so far (not
who), the truck, the custom fields, the items and the job notes. Never the price, the payments or the
bill. Booked jobs with no date yet are listed under the calendar.

**Quotes.** Every open quote and lead, newest first, with its price, when it was made and by whom.
Search by name, phone (or its last digits) or address. **Open quote** puts it in the quote builder;
**Call**; **Mark lost** (tap twice).

**New quote.** The same quote builder as the office, with two differences:

- The price step can change the move type, crew size, truck and hours, but has no **Discount**. A
  discount the office gave stays as it was when the call center changes the quote.
- **Book job** needs the move date, so the job lands on the schedule. The date shows how busy that
  day already is ("Thu, Oct 30: 2 jobs booked, 2 of 3 trucks taken"), for everyone who makes quotes.
  After booking: "Booked for Thu, Oct 30 at 8:00 AM. Dispatch adds the crew and trucks." Booking is
  the call center's last change to a job; after that it's the office's.

The office sees who made a quote on the job sheet ("Quote made by Jess (call center)"), and the job's
activity says who booked it or marked it lost.

## What the database enforces (hosted app)

From `supabase-callcenter.sql` (the same rules are in `supabase-schema-v2.sql`,
`supabase-employees.sql` and `supabase-payments.sql`):

- **Reading:** the open quotes and leads, in full; the schedule only as a copy without the money
  (`sched/<job id>`: the customer, day and time, addresses, notes, custom fields, items, crew size,
  hours, trucks and how many movers). A trigger keeps the copies as every job is saved, by anyone,
  and removes a copy when the job is finished, lost or deleted. Nobody writes the copies.
- **Writing:** only through `cc_save`, which the app calls for them. A new job is a quote or a
  booking with no payment and no discount. A change is to an open quote only. It can change the
  price but not the discount or the payments, and booking it or marking it lost is the last change.
  A quote the office booked or closed meanwhile is closed to them. Their phone drops it and says so.
- The Edge Function lets them look up a quote's miles and call customers through the company line
  on open quotes and scheduled jobs.

## Not built yet

- The company line rings whoever Setup › Texts and calls lists. Add the call center there to have
  it answer customer calls (the default is the office).
- Taking a deposit when booking (the office takes payments, or sends a pay link).
