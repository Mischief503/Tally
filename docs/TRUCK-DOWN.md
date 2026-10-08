# Truck down: the emergency beacon

When a truck breaks down or is in an accident, the crew taps **Truck down? Tell the office** in
Tally. The office is told right away which truck, who sent it, the job, and where the truck is.

## What the crew does

1. On **Today** (or **My jobs**, or **More › Truck down**), tap **Truck down? Tell the office**.
2. Check the truck (Tally picks the one on today's job) and, if there's time, say what happened:
   *flat tire on I-5, won't start, accident*.
3. Tap **Tell the office**. The phone asks to use its location the first time; allow it.

The screen then shows who in the office got it, whether the location is going out, and who was
texted. Keep Tally open: the location keeps updating while the alert is on (if the truck is
towed, the office sees it move). When the truck is going again, tap **Running again: end the
alert** (two taps, so it can't end by accident). Someone hurt? The screen has **Call 911**.

## What the office sees

Owner and dispatch get a red screen in Tally, with a chime (and a buzz on Android phones):

- **Box 1 (26 ft) is down**, the crew's note, who sent it and the job
- **Directions** and **Map** to where the truck is, and how precise the location is
- **Call Marcus**, with his number showing
- **Got it**, which tells the crew someone in the office has it

Closing the screen leaves a red bar at the top of Tally until the truck is running again. The
office can also close the alert once it's sorted (**Truck sorted out: close this alert**).

Nobody else is shown the alert; it doesn't go into the team chat.

## Texts

With the company line set up ([SETUP-twilio.md](SETUP-twilio.md)), owner and dispatch also get a
text from it, so they hear about it with Tally closed:

`Ace Moving TRUCK DOWN: Box 1 (26 ft) is down. Sent by Marcus at 2:14 PM, on the Priya Nair job. "Flat tire" Location: https://maps.google.com/?q=30.26715,-97.74306 (within 12 m). Call Marcus: +15125550101. Live in Tally: https://your-tally-site#sos`

and an all-clear when it's over. The text waits up to 8 seconds for the phone's location so it
can carry one. At most 6 alerts an hour per company are texted (a send that fails doesn't count,
so the crew can try again). Everyone in the office needs a phone number on their profile under
**Setup › Employees**.

Without the company line (or in the claude.ai copy of Tally), the alert still reaches the office
in Tally, and the crew's screen says no texts went out, with the office's numbers to call.

## Location and privacy

The location is shared only while the alert is on, only with the office, and stops when the
crew taps Running again or the office closes the alert. If the phone's location is turned off,
the office is told so and the crew is asked to say where they are in the note.

## Trying it out

Put a crew member on a **test job** for today and send a truck-down alert from their phone. The
office sees the alert in Tally (marked as from a test job), but no texts go out. End it with
Running again.
