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
estimated top price and no drive-back step):

- **Local:** from **Start job** to **Done unloading**, plus the drive back to the shop when Setup
  counts the drive from the shop. When it doesn't, the clock starts at **Start loading**.
- **Mileage:** the loading time plus the unloading time, and the miles driven. The crew lead types
  the miles from the odometer on the job card (**Miles driven on this move**). Left blank, the bill
  uses the quoted miles.
- Example: 120 miles driven, 4 hours loading and 3 hours unloading. The bill is 7 hours and
  120 miles.
- Hours are billed in 15-minute steps, with the minimum hours as the least.
- The quote's **estimated top price** (it was called the not-to-exceed price) is a guide, not a cap
  (Richie, Oct 24: "The not to exceed amount is a suggestion not a rule", and "It should say estimated
  top price"): the bill is the time and miles, even past it, and the job sheet says when it went past
  ("Bill $1,070, past the $595 estimated top price"), so the office can decide whether to give the
  customer a break (set the billed hours, or add a credit). Switch off **Estimated top price** in
  Setup › Options (or the Rate card) and quotes stop showing one. A bill made before Oct 24 was held to
  the price, and keeps that when it's worked out again.
- Nothing holds a payment to it either: a crew lead charging a card kept on file (the customer not
  there) charges whatever the move came to, up to what's still owed (Richie, Oct 25: "Whatever price the
  move ends up is what the lead needs to charge the customer . If the customer forgets to mention the
  crazy entry to the house that addes 3 hours thats not my problem its the customers for not mentioning
  it when booking"). Until Oct 25 a lead could charge a card on file only up to the estimated top price.
- The bill shows the quote first, then what the bill is made of, under **Billed by the clock**: the
  hours at the hourly rate (with the times, and "the 3-hour minimum" when the minimum filled it in),
  the miles on a mileage move, the quote's fees (truck and fuel, stairs, packing, specialty items,
  a discount), and tax (a bill from before Oct 24 also has **Held to the estimated top price** when it
  was). Then the materials and the
  charges added on the job, and the bill. For example, quoted $1,445 for 10 hours:

  > Quote (10 hr, 2 movers) $1,445 · *Billed by the clock* · 2 movers, 3.25 hr at $140/hr, 6:30 PM
  > to 9:40 PM (3h 10m), $455 · Truck and fuel $45 · Bill $500

  This is on the crew lead's bill and on the job sheet. The customer pays the bill. In the database it
  is one line, the difference from the quote (*By the clock: 7h 0m loading and unloading, billed
  7 h, 120 mi driven (quoted 6.5 h, 110 mi)*), with the rows kept on it.

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
   (1 → 2)", "−2 Medium box (30 → 28)"), the new quote's lines, its estimated top price, and a note
   for the office about why.
3. **The customer signs** that it's an estimate, not the bill, and that the bill comes at the end
   (Richie, Oct 24: "The customer signs knowledging that it is a estimate not a bill , the bill comes
   at the end."). "New estimate: $1,788", then "This is an estimate, not the bill. The bill comes at
   the end of the move, from the time it takes and the miles driven. Estimated top price: $2,060.", the
   printed name, a tick box ("I understand that $1,788 is an estimate, not the bill, and that the bill
   comes at the end of the move.") and the signature. A flat price says "This is a flat price: the bill
   is this quote." and "I agree to the new price of $1,788." Only then does the new quote go on the
   job.

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

## The people put on the job

The movers on the bill are the people the office puts on the job's crew, not the quote's crew (Richie,
Oct 24: "When a job is booked as a 2 man move and the office decides to put 3 people on the job the bill
should reflect the people put on the job not the quoted amount of people", and "If a crew goes out
shorthanded, the bill should reflect what went out").

- Put 3 people on a job quoted for 2 movers, and the bill by the clock charges 3 movers at the 3-man
  rate for the whole job. Under the crew, the job sheet and the crew lead's card say **Movers on the
  bill: 2 (as quoted) · 3 from the start**. Before the job, the Local move (or Mileage move) part gives
  the rate and says to let the customer know.
- A crew that goes out short is billed for who went out: quoted as a 3-man move, 2 on the crew, and the
  bill is 2 movers at the 2-man rate ("if it was booked and quoted as a three man, but only two guys go
  out because someone gets sick or calls in, then the bill is only two"). The line says **Movers on the
  bill: 3 (as quoted) · 2 from the start**. So everyone who goes out has to be on the crew: with only
  the lead on it, a 2-man move is billed as 1 mover.
- A job nobody has been put on yet is billed for the quote's crew.
- The crew chips are for the whole job, before, during and after it. Someone who joins or leaves part
  way goes in with **A mover joined or left**. Taking someone off the crew takes their change on site
  off too (they weren't on the job). Putting someone on after the job (a mover the office forgot)
  works the bill out again.
- A driver picked who isn't on the crew goes on it, and on the bill.

> 2 movers quoted at $140/hr, estimated top price $595. The office puts 3 on it; the job takes 5
> hours. 3 movers, 5 hr at $195/hr = $975. Fees $95. Bill $1,070 (past the estimated top price, a
> guide).

> 3 movers quoted at $195/hr, estimated top price $840. Someone calls in sick and 2 go out; the job takes
> 4 hours. 2 movers, 4 hr at $140/hr = $560. Truck and fuel $45. Bill $605 (the quote was $728).

A bill made before Oct 24 (its record of the numbers starts with `c1` or `c2`) keeps the quote's crew,
plus the changes on site, and the hold to the estimated top price. A bill from now on starts with `c5`
and has who's on the crew in it, so a phone that gets a job whose crew another phone changed works the
bill out again, and a phone on a version before leaves it alone. The bills of Builds 42 and 43 (`c3`,
`c4`, Oct 24: a crew short of the quote billed as quoted, then the bill held to the estimated top price)
are worked out again when they come in.

## Movers joining or leaving on site

When a mover shows up partway through a job (or one leaves early), the crew lead puts it in from the
job card: under the crew, **Movers on the bill: 2 (as quoted)** and **A mover joined or left**. The
panel has **Someone joined** (everyone on the list who isn't on the job, or a name typed in) and
**Someone left**, and **When?**: Now, or 15 to 60 minutes ago (before the job starts, only "From the
start"). It says what it does to the bill ("From 10:15 AM: 4 movers on the bill at $250/hr (the quote
is $140/hr for 2)"). Each change can be taken back; after the job, only the office changes them.

The bill charges each stretch of the work at the rate for the movers on it, one row each (Richie: "the
bill should show the quote, then it should show the 1.5 hours as 2 man and 1.25 hours as a 3 man"):

- The time of each change is rounded to the nearest quarter hour, and the end goes up to the next
  quarter hour, as the whole job always did.
- The minimum hours fill in at the end, with the crew there then ("you charge the 2 man for the
  beginning time then when the extra man gets there to the 3 hour minimum").
- Hours the office sets by hand are added to the end, or taken off it.
- On a local move from the shop, the drive back goes with the crew at the end.
- On a mileage move, only loading and unloading count, and a mover who joins on the drive counts from
  unloading.

> 2 movers quoted at $140/hr, a 3-hour minimum. A third mover joins 1h 31m in, and the job takes
> 2h 40m.
> Billed by the clock: 2 movers, 1.5 hr at $140/hr = $210 (1h 31m). 3 movers, 1.5 hr at $195/hr =
> $293 (1h 9m, and the 3-hour minimum). Then the quote's fees.

Every hour is at the rate of the crew on it; the estimated top price doesn't hold the bill (a bill
from before Oct 24 was held to it as if the quote's crew did all the hours, with the time with more
movers on top).

> 2 movers quoted at $140/hr, estimated top price $595; 2 more join 2 hours in; the job takes 5 hours.
> 2 movers, 2 hr at $140/hr = $280. 4 movers, 3 hr at $250/hr = $750. Fees $95. Bill $1,125.

A crew size's rate is the quote's rate plus the Rate card's difference between the two crew sizes (the
Rate card at the first change is kept on the job, so changing the Rate card later doesn't move the
bill); past 4 movers each one adds what the 4th does, and 1 mover takes off what the 3rd adds. On a
mileage move only loading and unloading time counts. A flat-price job's bill stays at the quote.

Someone picked from the list goes on the job's crew, and on the job's times when they're clocked in;
their pay on the card is their own time on the job (at least the minimum). Someone who left comes off
the job's times then. The office sees the same line on the job sheet (with **Change**), and the bill's
rows on the sheet and the lead's bill.

A bill worked out by the version before (the crew changes on lines of their own, "4 movers from
10:15 AM, 3h 0m at $250/hr instead of $140/hr") is worked out again by the movers on the bill when the
job comes in to a phone with this version. The bill's record of the numbers it was worked out from
starts with `c2` for a job whose crew changed, so a phone still on the version before leaves it
alone.

