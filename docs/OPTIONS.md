# Options: what the owner can switch on and off

**Setup › Options** has 35 switches, in eight groups. They apply to everyone in the company and save
as soon as they're flipped. Each switch also sits in the Setup section it belongs to, so the Rate
card has the pricing switches, Roles has what crew, leads and dispatch can do, and so on. Only the
owner can change them.

All of them start on, except **Photos before finishing** and **Sales tax** (it starts on only when a
tax % is set). The **Options** row in Setup shows how many are on, and the search box at the top of
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
| Crew add materials and costs | No Materials on the job card. The office can still add them on the job sheet. |
| Photos before finishing (starts off) | On: **Finish job** waits for a pickup photo and a delivery photo, and opens Photos to take them. |
| Truck down button | No Truck down button for the crew (an alert already open still shows). |

## Billing out

| Switch | Off means |
|---|---|
| Crew leads collect payment | Leads get the signatures (**Get signatures**) and the job says *The office collects the payment*. The server refuses a lead's card payment or pay link too. |
| Crew leads add charges and credits | No charge or credit box on the lead's bill. |
| Miles back to the shop by GPS | On a mileage move, the miles back come from the quote; the lead can still change them. |

## Time clock

| Switch | Off means |
|---|---|
| Time clock | No clock card, no round clock button, no clock line on Today. |
| Note for late clock-outs (minutes) | Clocking out long after the last job doesn't need a note. |
| Location while clocked in | The phone doesn't share where the crew is. |
| Pay the minimum hours | A short job pays the crew the hours it took, not the Rate card's minimum. |

## Quotes and pricing

| Switch | Off means |
|---|---|
| Mileage moves (local radius) | Every move is local, charged by the hour. The quote says why. |
| Count the drive from the shop | The drive to the pickup and back from the delivery isn't charged. |
| Final bill by the clock | New quotes are a flat price: the bill is the quote, with no not-to-exceed price and no drive-back step. |
| Not-to-exceed price (cushion %) | The final bill follows the clock even past the quote. |
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
| Dispatch can take payments | Dispatch has no payment buttons (*The owner takes payments on this job*); the server refuses dispatch's payments too. |
| Dispatch sees revenue | No Revenue screen for dispatch; Today shows what's to schedule instead of what's owed. |

## Where it's kept

The switches are `settings.opt` in the company's settings (`org/settings`), next to the older ones
they sit with (`comms.alerts.*`, `payMin`, `shopTravel`, `nteCap`). A switch that was never flipped
uses its default. The server reads the same settings for texts and payments.
