# Options: what the owner can switch on and off

**Setup › Options** has 42 switches, in eight groups. They apply to everyone in the company and save
as soon as they're flipped. Each switch also sits in the Setup section it belongs to, so the Rate
card has the pricing switches, Roles has what crew, leads and dispatch can do, and so on. Only the
owner can change them.

All of them start on, except **Photos before finishing**, **Office approves new quotes from the crew**
and **Sales tax** (it starts on only when a tax % is set). The **Options** row in Setup shows how many are on, and the search box at the top of
Setup finds a switch by name.

Switching something off hides it from the screens; it doesn't delete anything. Switched back on,
the old notes, tallies, photos and settings are still there.

## Crew and field

| Switch | Off means |
|---|---|
| Arrival text at Start job | **Start job** just starts the clock; no text to the customer. |
| Crew confirm their jobs | No **Confirm I'll be there**. Job messages lists the jobs as Booked, texts stop asking to confirm, the evening text is a plain reminder, the office summary leaves confirmations out, and **Remind** is refused. |
| Load tally | No Tally on the job card or on Today. |
| Quick updates | No *On my way* / *Arrived at pickup* buttons on the job card. |
| Crew members can call the customer | No Call button for crew members. Leads and the office always have it. |
| Crew add materials and costs | Nothing on the job card to add materials or costs with. Materials the office put on the job still show there, to read. The office can still add them on the job sheet. |
| Crew leads make new quotes on site | No **Items different? Make a new quote** on the lead's job card; the office changes quotes on the job sheet. The server refuses a lead's new quote too. See [PRICING.md](PRICING.md#a-new-quote-on-site). |
| Photos before finishing (starts off) | On: **Finish job** waits for a pickup photo and a delivery photo, and opens Photos to take them. |
| Truck down button | No Truck down button for the crew (an alert already open still shows). |

## Billing out

| Switch | Off means |
|---|---|
| Crew leads collect payment | Leads get the signatures (**Get signatures**) and the job says *The office collects the payment*. The server refuses a lead's card payment or pay link too. |
| Crew leads add charges and credits | No charge or credit box on the lead's bill. |
| Crew leads add movers on site | The lead can't put in a mover joining or leaving; the office still can (the job sheet's Movers on the bill). See [PRICING.md](PRICING.md#movers-joining-or-leaving-on-site). |
| Customer signs for a bigger crew | More movers than quoted are billed without the customer's signature. On: the customer signs for them and their rate at Start job, or when someone joins, and the job can't be finished until they do (or the owner waives it). See [PRICING.md](PRICING.md#a-bigger-crew-the-customer-signs-for-it). |
| Miles back to the shop by GPS | On a mileage move, the miles back come from the quote; the lead can still change them. |

## Time clock

| Switch | Off means |
|---|---|
| Time clock | No clock card, nothing to wait for at Start job; everyone on the job is logged on it when it starts. |
| Note for late clock-outs (minutes) | Clocking out long after the last job doesn't need a note. |
| Location while clocked in | The phone doesn't share where the crew is. |
| Everyone clocks in before Start job | The crew lead can start the job without waiting; each person goes on the job when they clock in. (The office's Start job on the job sheet never waits.) |
| Pay the minimum hours | A short job pays the crew the hours it took, not the Rate card's minimum. |

## Quotes and pricing

| Switch | Off means |
|---|---|
| Mileage moves (local radius) | Every move is local, charged by the hour. The quote says why. |
| Count the drive from the shop | The drive to the pickup and back from the delivery isn't charged. |
| Final bill by the clock | New quotes are a flat price: the bill is the quote, with no estimated top price and no drive-back step. |
| Estimated top price (cushion %) | Quotes show no estimated top price. (With it on, it's a guide: the final bill follows the clock even past it.) |
| Deposit to book (%) | Quotes don't ask for a deposit. |
| Sales tax (%) | No tax line. Starts off with no tax % set. |
| Truck and fuel fee ($ per truck) | No truck fee on quotes. |
| Stair fee ($ per flight) | No stair charge, and the quote form drops the stairs box. |
| Packing ($ per box) | No packing on quotes, and the quote form drops the packing box. |

The number under a switch (radius, %, $) shows only while the switch is on. See
[PRICING.md](PRICING.md) for how a quote and the final bill are worked out.

## Paperwork, payments, texts, office

| Switch | Off means |
|---|---|
| Signatures before payment | No forms are asked for before paying, on the phone or on the server. |
| Pay links and QR codes | No pay link. |
| Typing a card in | No card box. |
| Cards on file | Cards aren't kept or charged later. |
| Cash, checks and Zelle | Not offered, unless every other way is off: then it stays, so a payment can always be recorded. |
| Text crew when they're put on a job | No assignment texts. |
| Text the crew when a job moves | No texts when a job changes day or time. |
| Texts the evening before | No evening reminders or office summary. |
| Unsigned forms alert | No text to the office about a job waiting on a signature. |
| Short crew alert | No text to the office when a crew lead starts a job with fewer movers than quoted, or someone leaves and it drops below. The office still sees it on Today. |
| A driver for every truck | No driver boxes on jobs, no Who drives list in Setup › Fleet and drivers, and a truck without a driver doesn't make a job need scheduling. The texts just name the truck. |
| Office approves new quotes from the crew (starts off) | On: a crew lead's new quote waits for the owner or dispatch to approve it (Today: *New quote to approve*), then the customer signs it. Off: the customer's signature is enough, and the office is told. |
| Dispatch can take payments | Dispatch has no payment buttons (*The owner takes payments on this job*); the server refuses dispatch's payments too. |
| Dispatch sees revenue | No Revenue screen for dispatch; Today shows what's to schedule instead of what's owed. |

## Where it's kept

The switches are `settings.opt` in the company's settings (`org/settings`), next to the older ones
they sit with (`comms.alerts.*`, `payMin`, `shopTravel`, `nteCap`). A switch that was never flipped
uses its default. The server reads the same settings for texts and payments.

## The time clock and the job

Each person's clock card on Today has their name, where they stand (Clocked out, On the clock, On
break), one big **Clock In** button, or **Break** / **End break** and **Clock Out** once they're on
the clock, what they clocked in for, and the day's paid time with breaks taken out ("2h 30m paid today
(breaks not counted)"). Crews and leads have it on their **Jobs** screen, under "Good morning" and the
date: one big **Clock In** button, the paid time on one line, and while they're on the clock whether
their location is being shared. The clock card is the one place to clock in and out: there is no
separate round clock button.

With **Everyone clocks in before Start job** on, the crew lead's **Start job** waits until everyone
on the job is clocked in; the card ticks who is ("Crew: Marcus (lead) ✓, Dee, Luis") and says who it
is waiting on. When the job starts, everyone on it is logged on the job: their cards say "On the job:
Priya Nair since 8:05 AM", and phones that weren't the one starting it get a notice. Clocking out
takes a person off the job, clocking back in puts them on again, and so does the office adding or
taking them off the crew while it runs. The finish takes everyone off. The job sheet lists each
person's time on the job, and Reports › Employee hours counts it under On jobs (pay still comes
from the clock, breaks not counted).

