# The call center

A service Tally sells to moving companies: Tally's own call center team answers for them, quotes
their customers and books jobs onto their schedules. Richie's words (Oct 22, 2026): "Call center is a
service that the moving companys will be able to purchase to help get bookings . So call center will
only be able to see companys that pay for that service ."

- The team is **Tally's own people**, not a company's employees. A company can also have **its own call
  center people** (since Oct 28): the Call center switch on an employee's profile (below).
- **Tally admin switches the service on** for each company that buys it. Richie bills the companies
  himself; nothing in the app charges for it.
- The team sees **only the companies switched on**, and of those only what quoting and booking need.
- Phone calls to a company's Tally line are left as they are for now (companies send their calls to
  the call center themselves).

## Setting it up (hosted app)

1. Run `supabase/sql/supabase-callcenter.sql` once in the Supabase SQL editor (after
   `supabase-schema-v2.sql` and `supabase-payments.sql`; it's safe to run again). Until then, Tally
   admin's Call center team section says so. (Since Oct 25 its rate card copy also counts each
   company's movers and carries each truck's day, for the day plan; a database that ran it before
   then runs it again. Without that, the call center's day plan goes by the trucks alone.)
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
- With the move date filled in, each company shows how much room it has that day in its slots (see
  The day plan below): **Open** (nothing booked), **2 of 3 open** (slots with room for a move of its
  minimum hours), **Full**, or **No movers on** (everyone off), and the map's
  numbered dots take the same colours (green, orange, red), the same ones as the Schedule's calendar.
- Tapping a company (or its dot) opens its **rate card**: the hourly rate for 2, 3 and 4 movers,
  the minimum hours, the truck and fuel fee, stairs, packing, the local area and the rate per mile
  past it, the deposit, sales tax, the estimated top price (a guide) and the specialty items' fees,
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

- **Schedule.** A month of days. Each day shows how many jobs are booked and is coloured by the room
  left in its slots (green room in most, orange in half or fewer, red no room). Tap a day for its
  slots (below) and its jobs, earliest first: the time, the customer, the route, the
  movers and trucks ("5 movers · 1 truck") and the hours. Open one for the phone (with **Call**), the
  email, the addresses, stairs, how many movers are on it so far (not who), the truck, the custom
  fields, the items and the job notes. Never the price, the payments or the bill.
- **Quotes.** Every open quote and lead, newest first, with its price and when it was made. Search by
  name, phone (or its last digits) or address. **Open quote**, **Call**, **Mark lost** (tap twice).
- **New quote.** The same quote builder as the office, with three differences: the price step has
  no **Discount** (a discount the office gave stays as it was); **Book job** needs the move date, so
  the job lands on the schedule; and they put the move in a slot of that day first, where it fits
  (The day plan, below). After booking: "Booked for Thu, Oct 30 at 8:00 AM in slot 2. Dispatch adds
  the truck and crew." Booking is the call center's last change to a job; after that it's the
  office's.

The office sees "Quote made by Jess (call center)" on the job sheet, and the job's activity says who
booked it or marked it lost ("Booked by Jess (call center)"), and where it was lined up ("Lined up in
slot 2 at 8:00 AM").

## The day plan: lining the day up in slots

Richie's words (Oct 25, 2026): "each truck represents a crew slot and they can book to that but then
top number of movers needs to be in there per truck and available for dispatch"; a truck takes "as
many as they can complete in like 12 hrs but maybe 4 tops per truck if all addresses are close and
they can get them done . I feel like booking should see a timeline for each truck slot"; "if it can
fit on a truck slot timeline for the day then it works if not than they should suggest another day or
switch companys"; "if the job calls for 5 movers 1 truck then it should say that in scheduling"; and
the office marks days off. Then: "Call center doent actually assign the truck . They line up the day
depending on length and distance . But the call center is a real person so it should be something
they look and drag and drop to a slot . Dispatch selects the truck and crew members."; "If its a 2
truck it takes up 2 slots for that amount of time".

- **Slots**: each truck is a slot, smallest first ("Slot 1 · up to 800 cu ft · 0 of 4 moves").
  The call center lines a move up in a slot; the truck and the crew are dispatch's to pick.
- **Each truck's day** (Setup › Fleet, the office): it starts at **7:00 AM** and lasts **12 hours**,
  with at most **4 moves** and **60 minutes between moves** for the drive (the same hour the Board's
  double-booked check uses). A move takes its estimated hours (a mileage move adds the drive in).
- **The movers on a day**: everyone on the crew list less who the office marked off that day (the
  Board › **Who's off**: tap names; it's kept with the settings).
- **Under the price** (the quote's last step, for the office and the call center): the move day's
  slots, each a lane from the day's start to its end with its moves as blocks ("8–11 Alpha Co / 3
  movers"; tap one to read it; two at once are stacked and marked Double-booked), the movers busy each
  hour against the movers on, and **This move** above the slots, at the time asked for. The call
  center sees how many movers are on and off, never who.
- **Putting it in a slot**: drag the move onto a slot (it follows the finger or the mouse; the slot
  under it shows where it would start, green where it fits, red where it doesn't), or tap a slot where
  it should start; it goes to the quarter hour. Drag it again to move it; **Take it out** puts it back
  above the slots. A move of two trucks takes two slots for its time: the one it's put in and the
  nearest other free then ("In slots 1 and 2 from 8:00 AM to 11:00 AM.").
- **It fits** in a slot at a time when the slot takes its load (at least the quoted truck's size), is
  free then (with the time between moves, under its most moves), and the movers busy then, with this
  move's, are no more than the movers on: "In slot 1 from 9:00 AM to 12:00 PM. 5 of 6 movers busy
  then. Dispatch picks the truck and crew."
- **It doesn't fit** there: it says why ("Slot 2 has Alpha Co from 8:00 AM to 11:00 AM, and 60
  minutes between moves."; "Slot 1 is for loads up to 800 cu ft, and this one needs a truck of 1,000
  cu ft."; "5 movers would be busy then, and 4 movers are on that day."), then offers the **times
  with a slot free** that day (an hour apart; tapping one puts it in that slot); if none, the **next
  days with room** (the next four weeks) and, for the call center, **other companies with room that
  day**. Tapping another company opens it with the caller's move filled in (the customer, the day and
  time, the addresses, the items; that company works out its own slot, truck, crew and price).
- **Book job**: the call center books only a move it has put in a slot where it fits ("Put the move
  in a slot first: drag it onto one under the price, or tap one."). The office can book without a
  slot when one is free then, and is asked first otherwise (the button says **Book anyway**).
  Booking never puts a truck on the job: "Job booked in slot 1 at 11:00 AM. Add the truck and crew."
- **Dispatch** sees the slot on the Board: Needs scheduling says "Lined up in slot 3" with **Use Box 1
  (26 ft)** (the slot's truck, in one tap), and No truck yet shows it too. On the plan a job sits on
  the trucks dispatch gave it, else in its slots, else in the first slot free then.
- **The Schedule** shows the picked day's slots above its jobs, and each job says its movers and
  trucks ("5 movers · 1 truck").

## A company's own call center people (Oct 28)

Richie's words: "In the employee profile it should have a set of switches to give access to different
sides of the app . Like field view for crew members and leads , so off , crew or lead will be the 3
options for that switch . Then dispatch should be another switch . Then call center will be another
switch ."; "The switches will dictate what the employee sees when they log in"; and on the call center
switch: "Im thinking every company will have their own assigned call center person . Not to sure on this
part so we are winging it and then when i present it to my company we will really dial this part in ."

- **Setup › Employees › a person › What they see**: **Owner** (everything; the other switches go),
  **Field view** (Off, Crew or Lead), **Dispatch** and **Call center**, with a line saying what they'll
  see ("Tanya sees: the jobs they’re on (running them and billing out) and the time clock; the
  schedule, Quotes and New quote, with no money or discounts. All in one app."). With every side off,
  it won't save unless "Can use Tally" is off too.
- **More than one side: one app, all their tabs together.** A crew lead with the call center sees Jobs
  (theirs, first), Schedule, Quotes, Chat and the round + for a new quote. Dispatch takes in the field
  (dispatch can already run a job), so dispatch with Field view is the office's tabs, with them on the
  crew list. The call center alone: Schedule, Quotes, Chat and the + (no Companies: that's Tally's
  team, for many companies).
- **Their quotes are the call center's**: no discount, the move put in a slot before booking, no truck
  put on ("Created as Booked by Tanya (call center)"); dispatch picks the truck and crew.
- **Kept by the app**: the settings' lists (the crew, the leads, the office, and `ccStaff` for the
  company's own call center people) follow each profile's switches, kept in the profile
  (`info.access`) so they come back when someone's access is turned back on. The role the database goes
  by stays one of owner, dispatch, lead or crew: the office's when they have it, else the field's, else
  crew (someone with the call center side only is crew with no jobs).
- **Kept by the database** (in supabase-callcenter.sql): `cc_member(company)`: a crew member or lead
  whose name is in the settings' `ccStaff` (which only the owner writes). The call center rules
  (`cc_in`) take them in with Tally's team: they read the open quotes, the schedule's copy and the rate
  card, and save quotes and bookings only through `cc_save`, with no discount and no payment. The jobs
  they're on, they change as crew or a lead as before. The office named there is still the office.
- See it their way: each person, from any row, opens with their own sides; Call center lists the
  company's own people and **Tally’s team**.
- **The Edge Function** knows them too (a crew member or lead named in `ccStaff`): they call
  customers on open quotes and scheduled jobs through the company's line (it rings their phone from
  the company's contacts first), and they look up a quote's miles.

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
  prices only, each truck's day, and how many movers there are and how many are off each day
  (`movers: {n, off: {day: count}}`), kept by a trigger on every save of the settings; never the
  crew's names, pay, costs, phones, materials' costs, forms or the office); the open quotes and
  leads, in full; the schedule as a copy (with the slots each move was lined up in)
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
