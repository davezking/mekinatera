# Phone setup guide

This guide is for the owner. It sets up the Android phone that holds the telebirr SIM so that:

1. every telebirr SMS goes to the website within seconds, which is how payments are verified, and
2. the phone checks in every 30 minutes, so the admin pages can warn you when it goes quiet (FR-27).

A quiet phone and a quiet shop look the same from the SMS alone ("no SMS" can just mean "no sales"). That's why the phone also sends a separate check-in, called the heartbeat.

You need:
- the phone with the telebirr SIM, charged, with mobile data and Wi-Fi;
- the **webhook secret** (`WEBHOOK_SECRET`). The developer gives it to you. Treat it like a password and never share it in a chat or a screenshot;
- the site address for each environment:

| Environment | Address |
|---|---|
| Production | `https://byd-manuals.<account>.workers.dev` |
| Staging (testing) | `https://byd-manuals-staging.<account>.workers.dev` |

`<account>` is your Cloudflare account's workers.dev name. If a custom domain is added later, use that address instead.

Set the phone up against **staging** first, run the soak test (step 4), and only then switch both URLs to production.

---

## 1. SMS forwarder

Install **SMS to URL Forwarder**. It's an open-source app (package `tech.bogomolov.incomingsmsgateway`), available on F-Droid, Google Play and its GitHub releases page. Open it, allow the **SMS** permission, then add a forwarding rule:

| Setting | Value |
|---|---|
| Sender | `127` (telebirr's short code; only these SMS are sent, personal SMS never leave the phone) |
| URL | `https://byd-manuals.<account>.workers.dev/api/sms-webhook` |
| Headers | `{"X-Webhook-Secret": "<the webhook secret>", "Content-Type": "application/json"}` |
| JSON template | `{"from":"%from%","body":"%text%","receivedAt":"%receivedStamp%"}` |
| Retries | on: at least 10 retries (the app retries when there is no network) |
| Ignore SSL errors | **off** |

Save the rule, then check it: send yourself a small telebirr transfer from another account. Within a minute, the payment shows on **Admin → Payments**. A message from any sender other than `127` is dropped by the website as well, but the sender filter on the phone keeps it from ever being sent.

## 2. Heartbeat (MacroDroid)

Install **MacroDroid** from Google Play. The free version allows enough macros. Create one macro:

1. **Trigger:** Date/Time → **Regular Interval** → every **30 minutes**. Turn on "Use alarm" if your phone offers it, so the timer still fires while the screen is off.
2. **Action:** Connectivity → **HTTP Request**:
   - Method: `POST`
   - URL: `https://byd-manuals.<account>.workers.dev/api/heartbeat`
   - Header: `X-Webhook-Secret` = `<the webhook secret>`
   - Content type: `application/json`
   - Body: `{"battery": [battery]}`. `[battery]` is MacroDroid's magic text for the battery level; pick it from the magic-text list rather than typing it.
3. **Constraints:** none.
4. Name the macro "Heartbeat" and save it. Use **Test actions** once.

Then open **Admin**. The green line reads "Phone online · last check-in less than a minute ago · … · battery 80%".

## 3. Phone settings

Android stops background apps to save battery, and a stopped app means lost SMS. Do all of this for **both** SMS to URL Forwarder and MacroDroid:

- **Battery optimization off:** Settings → Apps → *app* → Battery → **Unrestricted** (or "Don't optimize").
- **Auto-start allowed**, where the phone has that setting.
- **Background data allowed:** Settings → Apps → *app* → Mobile data → allow background data. Data Saver must not block it.
- **Lock the app in recents:** open the recent-apps screen, long-press the app, and tap the lock icon so "clear all" doesn't kill it.
- Keep the phone **on charge**, with **mobile data and Wi-Fi** both on, so it falls back from one to the other.
- Don't use any "phone cleaner", booster or antivirus app that kills background apps.

Brand-specific notes:

- **Tecno / Infinix (HiOS / XOS):**
  - Phone Master → Auto-start management → allow both apps.
  - Settings → Battery → App launch / Power management → set both apps to **manual**, with *auto-launch*, *secondary launch* and *run in background* all on.
  - Turn off "Power saving" and "Smart power saving".
- **Samsung (One UI):**
  - Settings → Battery → Background usage limits → add both apps to **Never sleeping apps**.
  - Make sure neither app is in "Sleeping apps" or "Deep sleeping apps".
  - Turn off "Put unused apps to sleep".
- **Other brands:** search "<brand> keep app running in background". https://dontkillmyapp.com lists the steps for most phones.

Restart the phone once, then confirm both apps start again on their own. The next heartbeat arrives within 30 minutes.

## 4. The 48-hour soak test

Before launch, run the phone on **staging** for 48 hours without touching it:

1. Set both apps to the staging URLs and leave the phone in its normal place, on charge.
2. At least 4 times, spread across day and night, send a small telebirr transfer to the phone. Include one while the screen has been off for an hour or more.
3. Each time, check **Admin → Payments**: the payment should arrive within a minute.
4. Check the admin banner a few times a day. It must stay green the whole time.
5. Pass: every transfer arrived and the banner never turned red. If anything was missed, recheck step 3 (usually battery settings) and run the soak test again.

Then switch both apps to the production URLs and send one more test transfer.

## Reading the banner

Every admin page shows the phone status at the top:

- **Green:** "Phone online · last check-in 12 min ago · last SMS 3 h ago · battery 80%". The phone checked in within the last 45 minutes (`HEARTBEAT_STALE_MINUTES`). "Last SMS" is when the newest telebirr SMS arrived; a long gap there is normal on a slow day.
- **Red, "Phone has not checked in for 2 h 5 min":** the phone is off, has no network, or Android has stopped the apps. **Payments will not verify automatically** until it is back. Buyers' SMS are delayed, not lost, as long as the forwarder keeps retrying. Check the phone: power, network, and that both apps are still allowed to run. Payments that arrive while it's down can be approved by hand on **Admin → Payments**.
- **Red, "Phone has never checked in":** the heartbeat macro hasn't been set up yet, or its URL or secret is wrong. Go back to step 2.

If the battery shown keeps dropping while the phone is "on charge", check the charger and cable.
