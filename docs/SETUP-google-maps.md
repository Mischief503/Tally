# Google Maps distances in Tally

When you build a quote, Tally looks up the driving miles between the shop, the pickup and the
delivery. With a Google key, the lookups come from Google Maps. Without one, Tally falls back to
OpenStreetMap, which is free but less exact.

## What is set up (October 5, 2026)

| | |
|---|---|
| Google Cloud project | **tally** (ID `tally-510721`), on the billing account "My Billing Account" |
| API turned on | **Routes API** (Google's setup also switched on its other Maps APIs; the key can't use them) |
| Key | **Tally distances (Supabase)**, restricted to the Routes API only |
| Daily caps | Routes API › Quotas: ComputeRoutes **300 a day**, ComputeRouteMatrix **300 a day** |
| Where the key lives | Supabase › Edge Functions › Secrets, as `GOOGLE_MAPS_KEY` |

The key stays on the Supabase server. The app asks the `tally-twilio` function for the distance,
and the function asks Google, so the key never reaches a phone or a web page. Only the owner and
dispatch can ask (they're the ones who build quotes). This works for the website and the Android
app alike, and adding or changing the key never needs a new APK.

Cost: Google gives 10,000 free route lookups a month. A quote uses up to 3 (shop to pickup,
pickup to delivery, delivery back to the shop), and the same pair of addresses isn't looked up
twice. The 300-a-day cap keeps a month under 9,300, inside the free amount. Past the free amount
Google charges $5 per 1,000.

## Putting the key in Supabase

1. Google Cloud › **APIs & Services › Credentials** (project tally). Press **Show key** on
   *Tally distances (Supabase)* and copy it.
2. Supabase › your project › **Edge Functions › Secrets** › **Add new secret**.
   Name: `GOOGLE_MAPS_KEY`. Value: the key. **Save**.

That's all. Paste the key into Supabase, not into a chat.

## Check it

Open a quote and enter a pickup and a delivery. Within a few seconds the miles fill in, and under
them it says **"Distances from Google Maps."** If it says OpenStreetMap instead, the key isn't in
Supabase yet (or was pasted with a space at either end).

If Google ever refuses the key, the function's log shows `routes 403` (Supabase › Edge Functions ›
tally-twilio › Logs). The usual causes: the Routes API was turned off, the key's API restriction
no longer includes the Routes API, or the billing account was closed.

## Changing the cap

Google Cloud › **Google Maps Platform › Quotas** › Routes API. On *Directions - ComputeRoutes per
request quota per day*, use **⋮ › Edit quota**.

## Optional: a key built into the Android app

The Android app can also ask Google itself, with a second key locked to the app. It isn't
needed: the app already gets Google distances through Supabase. If you ever want it:

1. Google Cloud › Credentials › **Create credentials › API key**. Restrict it to the **Routes API**,
   and under **Application restrictions** choose **Android apps** with package `com.tally.movers`
   and SHA-1 `62:D7:C6:F6:98:8D:1E:70:47:11:7C:0C:4C:28:7F:D0:7E:1F:D5:68` (the test signing key
   the GitHub build uses).
2. GitHub › Tally › **Settings › Secrets and variables › Actions** › **New repository secret**:
   `TALLY_GOOGLE_MAPS_KEY`. Then run **Actions › Android app** and install the new Tally.apk.

The app tries its own key first, then Supabase, then OpenStreetMap.

## Navigation is separate

The Pickup and Delivery addresses on a job card open turn-by-turn directions in the Google Maps
app on the phone. That needs no key.
