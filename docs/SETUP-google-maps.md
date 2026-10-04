# Google Maps distances in the Tally app

Without this, Tally measures quote distances with OpenStreetMap, which is free but less exact.
With it, the Android app asks Google Maps directly. About 10 minutes, all in a web browser.

The key is locked to the Tally app, so it doesn't work anywhere else, even if someone pulls it
out of the APK. Google gives 10,000 free distance lookups a month. A quote uses up to 3, so 8
quotes a day comes to about 720.

## 1. Google Cloud (you do this; it needs your card)

1. Go to **console.cloud.google.com** and sign in with the Google account you want this billed to.
2. Top bar › **Select a project › New project**. Name it `Tally`. **Create**, then select it.
3. **Billing**: link a billing account when asked. Google requires a card even for the free
   allowance; step 6 stops it from ever going past free.
4. **APIs & Services › Library**: search **Routes API**, open it, press **Enable**.
5. **APIs & Services › Credentials › Create credentials › API key**. Copy the key and keep the
   page open.
6. Press **Edit API key** (or the key's name), then:
   - **Application restrictions:** choose **Android apps**, press **Add**, and enter
     - Package name: `com.tally.movers`
     - SHA-1 certificate fingerprint: `62:D7:C6:F6:98:8D:1E:70:47:11:7C:0C:4C:28:7F:D0:7E:1F:D5:68`
   - **API restrictions:** choose **Restrict key** and tick only **Routes API**.
   - **Save**.
7. Optional safety net: **APIs & Services › Routes API › Quotas & system limits**. Set the
   per-day request limit to about **300**.

(That fingerprint belongs to the test signing key the GitHub build uses. If you later switch to
your own signing key, add its SHA-1 to the key too.)

## 2. Give the key to the build (GitHub)

1. In the **Tally** repository on GitHub: **Settings › Secrets and variables › Actions**.
2. **New repository secret**. Name: `TALLY_GOOGLE_MAPS_KEY`. Secret: paste the key. **Add secret**.
3. **Actions › Android app › Run workflow** (or tell Claude, who can start it).
   The build page's notes say "Key is set; quote distances use Google."
4. Install the new Tally.apk.

Paste the key into GitHub, not into a chat. Secrets stay hidden, even in this public repository.

## 3. Check it

Open a quote and enter a pickup and delivery. Under the distance it should say
**"Distances from Google Maps."** If it says OpenStreetMap and "Google Maps turned the key down",
recheck step 6: the package name and the fingerprint.

## Navigation is separate

The Pickup and Delivery addresses on a job card already open turn-by-turn directions in the
Google Maps app on the phone. That needs no key.
