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
- A radius of **0** makes every move local.
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

## The final bill

When the crew finishes the job, Tally bills by the clock:

- **Local:** from **Start job** to **Done unloading**, plus the drive back to the shop when Setup
  counts the drive from the shop. When it doesn't, the clock starts at **Start loading**.
- **Mileage:** the loading time plus the unloading time, and the miles driven. The crew lead types
  the miles from the odometer on the job card (**Miles driven on this move**). Left blank, the bill
  uses the quoted miles.
- Example: 120 miles driven, 4 hours loading and 3 hours unloading. The bill is 7 hours and
  120 miles.
- Hours are billed in 15-minute steps, with the minimum hours as the least.
- The bill is held to the quote's not-to-exceed price. To bill the full time and miles even past it,
  switch off **Hold the final bill to the not-to-exceed price** in the Rate card. With it off, quotes
  stop showing a not-to-exceed price.
- The difference from the quote is one line on the bill, for example *By the clock: 7h 0m loading
  and unloading, billed 7 h, 120 mi driven (quoted 6.5 h, 110 mi)*. The customer pays the total.

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
