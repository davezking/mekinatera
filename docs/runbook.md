# Ops runbook

These are short procedures for the situations that come up after launch. The admin is at `https://byd-manuals-admin.<account>.workers.dev/admin`, behind Cloudflare Access.

Rules that always apply:
- **Never release a PDF without a payment you have checked.**
- Payer names and phone numbers stay inside the admin. Don't paste them into chats, issues or logs.
- Download links are shown **once**. Copy a new link and send it to the buyer before leaving the page.

To watch live logs, run this from the repository. Logs hold only event names and ids, never personal data.

```sh
pnpm wrangler tail --env production --format pretty
```

## 1. "I paid but it doesn't work"

Ask the buyer for the **transaction number** from their telebirr confirmation, and the model they want. Then:

1. **Admin → Payments**, tab **All**: find the transaction number. Use ctrl-F; the list is newest first, and **Older** pages back. Then check the row's status:
   - **Unclaimed**: the payment is fine. Ask the buyer to enter the number again, with no spaces needed, on `/m/<model>`. Or approve it yourself (step 4).
   - **Claimed**: open it. The **Order** section shows the link status. If the link is **Expired**, **Used up** or **Revoked**, follow §3.
   - **Flagged** (`amount_too_low`): they paid less than the price. Ask them to pay the difference, or approve it anyway if you agree (step 4).
2. **Not in Payments at all?**
   - Check the banner at the top. If it's red, the phone is offline (§2).
   - **Admin → SMS → Failed**: the SMS arrived but its wording isn't recognised (§7).
   - **Admin → SMS → Ignored**: it was a bank or app deposit, not telebirr-to-telebirr (§4).
   - Check the phone's own SMS inbox for the telebirr message with that number.
3. If the buyer saw **"Too many tries"**, they hit the rate limit: 10 tries per 10 minutes for each network address. Ask them to wait 10 minutes. Many buyers share mobile network addresses, so if this happens often, tell the developer. The limit is `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MINUTES` in `wrangler.jsonc`.
4. **Approve by hand**, once you've confirmed the money arrived (the telebirr SMS on the phone, or your telebirr balance history):
   - **Payment is listed:** open it → **Approve for** → choose the manual → add a note (why) → tick **I checked this payment is real** → **Approve and create link** → **Copy link** → send it on Telegram or SMS.
   - **Payment isn't listed:** **Orders → Approve without a payment** → choose the manual → put the buyer's transaction number and contact in the note → tick → create → copy and send the link.

## 2. Phone offline (red banner)

The banner says "Phone has not checked in for …" or "Phone has never checked in". **Payments will not verify automatically**: buyers stay on "Waiting for telebirr confirmation" for up to 10 minutes, then see "not received yet".

1. Check the phone:
   - Is it on and charging?
   - Does it have mobile data or Wi-Fi?
   - Are the SMS forwarder and MacroDroid still allowed to run? Battery optimisation turned back on after an update is the usual cause; see `docs/phone-setup.md` §3.
2. Open MacroDroid and run the heartbeat macro once (**Test actions**), then reload the admin. The banner turns green within a minute.
3. SMS that arrived while the phone was offline are sent once it's back online, if forwarder retries are on.
   - Check **Admin → Payments** for any buyer who wrote in meanwhile.
   - If an SMS never arrives, approve that buyer by hand (§1 step 4) after checking the telebirr SMS on the phone itself.

## 3. Link expired or used up

A link lasts 24 hours and allows 3 downloads. Find the order: **Admin → Orders**, or open the payment.

1. Press **New link**.
2. Add a note (for example "buyer lost the file"), tick **Revoke the old link and create a new one**, then **Create new link**.
3. Copy the link and send it. The old link stops working at once, and the new one has a fresh 24 hours and 3 downloads.

## 4. Paid from a bank app (not telebirr-to-telebirr)

Bank deposits arrive as a different SMS and are **ignored** on purpose (**Admin → SMS → Ignored**), so they can't be claimed automatically.

- If the money did arrive and the amount is right: **Orders → Approve without a payment**. In the note, put the bank SMS reference, the amount and the buyer's contact. Then send the link.
- If you don't want to accept bank payments: refund them (§5), and point them to the telebirr-to-telebirr steps on the checkout page.

## 5. Refund

Refunds happen **outside the system**: send the money back from your telebirr. Then make sure the payment can't be used afterwards:

- **The buyer already has a link:** open the order and press **New link** (§3) with the note "refunded <date>". **Don't** send the new link. The old link stops working, and the note stays on the order.
- **The payment is still Unclaimed or Flagged:** the buyer could still claim it on the site. Open the payment → **Approve for** any manual → note "refunded <date>, link not sent" → tick → approve. **Don't** copy or send the link. The payment is now Claimed, so it can't be claimed again. The link exists only on that one page and nobody has it.

## 6. Webhook secret leaked

The webhook secret lets anything post "telebirr SMS" to the site. If it was shared, shown in a screenshot, or the phone was lost, rotate it right away:

1. Make a new value and store it in your password manager:
   ```sh
   openssl rand -hex 32
   ```
2. Set it in Cloudflare. It takes effect within seconds, and the old value stops working.
   ```sh
   pnpm wrangler secret put WEBHOOK_SECRET --env production
   ```
3. On the phone, update the `X-Webhook-Secret` header:
   - **SMS to URL Forwarder** → the forwarding rule → Headers;
   - **MacroDroid** → the Heartbeat macro → HTTP Request → Header.
4. In MacroDroid, use **Test actions**: the admin banner turns green. Send yourself a small transfer: it appears in **Payments**.
5. Check **Payments** and **SMS** for anything posted while the secret was out: payments you don't recognise in your real telebirr history. Don't approve those. Tell the developer.

## 7. New SMS wording in Failed SMS

**Admin → SMS → Failed** shows a real telebirr payment SMS that the parser doesn't recognise. telebirr may have changed its wording.

1. Copy the SMS text from the admin. It is already redacted.
2. Ask the developer to:
   - add a pattern in `src/lib/sms/patterns.ts`, as a new `id` such as `t2t-received-v2`, keeping the old one;
   - add a test with that exact text in `test/sms-parser.test.ts`;
   - ship it through the normal task PR → phase → `main` → `v*` tag → approved deploy.
3. Until then, approve affected buyers by hand (§1 step 4, "Approve without a payment"). SMS that already failed aren't re-read after the fix.

## 8. Approaching the free limits

Cloudflare emails you at 80% (launch checklist §8). You can also check Workers & Pages → byd-manuals → Metrics, D1 → byd-manuals → Metrics, and R2 → byd-manuals → Metrics.

- **Worker requests (100,000/day):** look for a spike in `pnpm wrangler tail` (bots, or a link shared somewhere unexpected). Turnstile and the rate limit protect `/api/claim`. With a custom domain (launch checklist §9), a Cloudflare **WAF rate-limiting rule** on that domain can stop a flood before it reaches the Worker. WAF rules don't apply to `workers.dev` addresses.
- **D1 rows written (100,000/day):** every claim attempt writes a row, including blocked ones. A flood of fake claims is the likely cause; handle it as above.
- **D1 rows read (5M/day) or storage (5 GB):** unlikely at this size. Tell the developer.
- **R2 storage (10 GB):** remove manuals you no longer sell. Replacing a PDF deletes the old file automatically.
- If real sales are what's pushing the limits, the test is succeeding. That is the signal from the PRD to plan the full system and a paid plan.
