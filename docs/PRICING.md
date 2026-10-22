# Local and mileage moves

How Tally prices a move, and how it works out the final bill from what really happened.

## Which kind of move it is

Each company sets its own **local radius** in **Setup › Rate card** (*Local radius (driving miles
from the shop)*, 20 to start with).

- **With the shop address** (Setup › Company), the radius is measured from the shop: the drive from
  the shop to the pickup, and from the delivery back to the shop. Both inside the radius: a
  **local move**. Either one farther: a **mileage move**.
- **Without a shop address**, the move's own distance (pickup to delivery) decides.
- A drive from the shop that isn't in yet counts as at least the move's length less the other drive.
  A 110-mile move from a pickup 5 miles out is a mileage move even before the drive back is known.
- A radius of **0** makes every move local, and so does switching off **Mileage moves** in
  **Setup › Options** (the quote says so).
- The office can set a quote to Local or Mileage by hand: **Price › Adjust › Move type**.

The quote screen says which kind the move is and why, under the miles and under the price.

## The quote

| | Local move | Mileage move |
|---|---|---|
| Hours | Loading and unloading, worked out from the inventory, plus the drive | Loading and unloading only |
| Miles | Not charged | Every mile at the per-mile rate: the move, plus the drive from the shop and back when Setup counts it |

The truck fee, stairs, packing, specialty items, discount and tax are the same for both. On the
Dispatch board a mileage move still takes its hours plus the drive, so double-booking checks stay
right.

The truck and fuel fee, stairs, packing, the deposit and sales tax each have a switch in **Setup ›
Options › Quotes and pricing** (also in the Rate card). Switched off, they leave the quote; stairs
and packing leave the quote form too. Sales tax also needs a tax %. All of them are listed in
[OPTIONS.md](OPTIONS.md).

## The final bill

When the crew finishes the job, Tally bills by the clock (with **Final bill by the clock** switched
off in Setup › Options, new quotes are a flat price instead: the bill is the quote, with no
not-to-exceed price and no drive-back step):

- **Local:** from **Start job** to **Done unloading**, plus the drive back to the shop when Setup
  counts the drive from the shop. When it doesn't, the clock starts at **Start loading**.
- **Mileage:** the loading time plus the unloading time, and the miles driven. The crew lead types
  the miles from the odometer on the job card (**Miles driven on this move**). Left blank, the bill
  uses the quoted miles.
- Example: 120 miles driven, 4 hours loading and 3 hours unloading. The bill is 7 hours and
  120 miles.
- Hours are billed in 15-minute steps, with the minimum hours as the least.
- The bill is held to the quote's not-to-exceed price. To bill the full time and miles even past it,
  switch off **Not-to-exceed price** in Setup › Options (or the Rate card). With it off, quotes stop
  showing a not-to-exceed price.
- The difference from the quote is one line on the bill, for example *By the clock: 7h 0m loading
  and unloading, billed 7 h, 120 mi driven (quoted 6.5 h, 110 mi)*. The customer pays the total.

### The drive back to the shop, at bill-out

The crew bills out at the customer's, before the drive back. So when the bill counts the drive from
the shop, **Finish job** (and **Collect payment** once the truck is unloaded) first opens
**Drive back to the shop**, before the customer signs and pays:

- **Local move:** the minutes back, starting at the quote's estimate (the miles from the delivery to
  the shop at the rate card's average speed). −5 / +5, quick picks from 10 to 90 minutes, or
  **Already back**. The bill underneath changes as the lead picks, for example *3h 30m on the job +
  45m back = 4.25 h, $640*. On the bill: *By the clock: 3h 30m on the job + 45m back to the shop,
  billed 4.25 h (quoted 3.5 h)*.
- **Mileage move (miles, never time):** the odometer is read twice. **Start job** asks for the
  **odometer leaving the shop** (the job card has the same box, to fix it or put it in later). At
  bill-out the lead puts in the **odometer now**; the miles so far are the difference. The miles
  **back to the shop** fill themselves in from the phone's location: the drive from where the
  truck is to the shop address in Setup, from Google Maps (through the server) or OpenStreetMap
  when Google isn't set up. The quote's miles from the delivery to the shop are used when the
  phone won't share its location, the lookup doesn't answer, or this copy of Tally can't look
  things up (the claude.ai artifact); the step says which. The lead can type over it (**Look up
  again** asks the map once more). No reading from Start job? **Type the miles so far instead**.
  On the bill: *131 mi driven incl. 30 mi back to the shop*; the job sheet keeps both readings and
  where the miles back came from (*by GPS*, *from the quote*, *typed in*).
- Only a local move adds time at the end of the clock; a mileage move adds miles.
- **Add to the bill and continue** puts it on the bill, then the customer signs and pays as before.
  **Exit** leaves the job open and unbilled.
- Until the job is paid, the lead can change it from **Bill out › Change**. The job sheet says who
  put it in (*plus 45m back to the shop (from Marcus at bill-out)*); without it, the bill uses the
  quote's estimate (*plus about 30m back to the shop*).
- The office's own ways skip the step: finishing or collecting from the job sheet, **Update the
  bill** with the hours or miles, and **Bill at the quote**.

The job sheet shows how the bill was worked out. The office can:

- type the hours or miles to bill (**Update the bill**), and go back to the clock (**Use the clock
  again**);
- **Bill at the quote**, for a customer who was promised a flat price;
- **Bill by the clock** on a job that was closed at its quoted price.

When the bill goes up after a job is paid, the job owes again and goes back to **Complete**. When
the bill drops below what the customer paid, the sheet shows how much they overpaid.

Jobs quoted before move types existed keep their quoted price. Changing a job's status by hand
doesn't re-bill it.

## Two phones at once

The bill line keeps a record of the numbers it was worked out from. When a phone gets a job from the
database whose line was worked out from older numbers, it works the line out again and saves it.
This happens, for example, when the office changed the quote while the crew lead's phone was offline.

## A new quote on site

When the crew shows up and the inventory isn't what was quoted, the crew lead makes a new quote from
the job card: **Items different? Make a new quote**, under the Quote part, before the move or during
it (not once it's billed out).

1. **Room by room.** Every room in the item list, with the quoted count for each item; the rooms with
   something on the quote start open. **+** and **−** change the counts, and each changed item says
   what it was ("was 1"). Stairs and packing are there too. The bar at the bottom shows the new price
   against the quote as you go.
2. **Check it.** The old and new price and the difference, what's different ("+1 Sofa (3-seat)
   (1 → 2)", "−2 Medium box (30 → 28)"), the new quote's lines, its not-to-exceed price, and a note
   for the office about why.
3. **The customer signs.** "New estimate: $1,788", how the bill still works (by the time and miles,
   never over the not-to-exceed price; or the flat price), the printed name, a tick box and the
   signature. Only then does the new quote go on the job.

The new quote is worked out the same way as the office's, at the rates on the job's quote: the same
hourly and mileage rates, tax, minimum hours, truck, stair and packing fees, and the same crew and
move type, even if the Rate card changed since booking. The truck on the job stays (more trucks go on
the quote when the load won't fit), hours the office set by hand grow and shrink with the load, and
the deposit stays as booked.

The office is told: *New quote signed on site* on Today and at the top of the job sheet, with who made
it, who signed, why and what changed, until someone taps **Got it**. Every quote a new one replaced
stays on the job, under **Earlier quotes** on the card and the sheet, with the customer's signature
(on the sheet).

With **Options › Office approves new quotes from the crew** on, step 3 is **Send to the office to
approve** instead. The owner or dispatch sees *New quote to approve* on Today, and on the sheet
**Approve** or **Don't approve**, with a note back. Approved, the lead's card says so with **The
customer signs** and **The customer doesn't agree**; the price on the job changes only when the
customer signs. If the office changes the job's quote while a new one waits, that one stops counting
and the lead makes it again. The lead can **Take it back** while it waits.

On the hosted app only the office can change a job's quote, so a crew lead's signed quote goes to the
server (the `requote` action of the tally-twilio function). It works the price out again from the
job, the items and the job's rates, and saves it only if it's the price the customer signed, and, with
office approval on, only the quote the office approved. No signal on site: the phone keeps the signed
quote, says so on the card (**Try again now**), and sends it as soon as it can.

## Movers joining or leaving on site

When a mover shows up partway through a job (or one leaves early), the crew lead puts it in from the
job card: under the crew, **Movers on the bill: 2 (as quoted)** and **A mover joined or left**. The
panel has **Someone joined** (everyone on the list who isn't on the job, or a name typed in) and
**Someone left**, and **When?**: Now, or 15 to 60 minutes ago (before the job starts, only "From the
start"). It says what it does to the bill ("From 10:15 AM: 4 movers on the bill at $250/hr (the quote
is $140/hr for 2)"). Each change can be taken back; after the job, only the office changes them.

The bill is still worked out for the quote's crew, held to the not-to-exceed price. Every stretch of
the work with a different crew is its own line on the bill, at that crew's rate instead of the quote's,
by the minute, and not held to the not-to-exceed price (the customer was quoted for the quote's crew; a
mover more is extra, like stairs or parking):

> 2 movers quoted at $140/hr; 2 more join 2 hours in; the job takes 5 hours.
> By the clock: 5 h at $140/hr. Then "4 movers from 10:15 AM, 3h 0m at $250/hr instead of $140/hr":
> 3 h × $110 = $330. That's 2 movers for 2 hours and 4 movers for 3 hours.

A crew size's rate is the quote's rate plus the Rate card's difference between the two crew sizes (the
Rate card at the first change is kept on the job, so changing the Rate card later doesn't move the
bill); past 4 movers each one adds what the 4th does, and 1 mover takes off what the 3rd adds. On a
mileage move only loading and unloading time counts. A flat-price job's bill stays at the quote.

Someone picked from the list goes on the job's crew, and on the job's times when they're clocked in;
their pay on the card is their own time on the job (at least the minimum). Someone who left comes off
the job's times then. The office sees the same line on the job sheet (with **Change**), and the bill
lines on the sheet, the lead's bill and the customer's payment screen.

