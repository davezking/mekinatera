# BYD Manual Store (MVP) — PRD

**Status:** Draft (v5: telebirr → telebirr transfers only)
**Author:** [owner]
**Last updated:** 2026-10-28

---

## 1. Problem Statement & Background

Most BYD cars in Ethiopia are China-market imports. Their owner's manuals are written in Chinese and are hard to find online. We have translated these manuals into English and Amharic. **This test sells the English PDFs only.** Amharic can be added later if the test works.

Before we build a full platform, we want a **small, cheap test** that answers one question: will owners pay for these manuals?

Payment gateways such as Chapa add setup work, fees, and business-registration requirements. For this test, buyers will send money by **telebirr-to-telebirr transfer directly to the owner's personal phone number**. Bank transfers into telebirr are not accepted for this test. Each incoming Telebirr deposit triggers an SMS to that phone with a unique transaction number (e.g. `DJD9REAQD9`, `DJD0RGOO68`). The system will read those SMS messages automatically. It will then verify a buyer's payment when the buyer enters the transaction number, and release a download link.

## 2. Goals & Success Metrics

**Goals**
- Validate demand: real people pay real money for a translated BYD manual.
- Deliver the PDF automatically with no manual work for most orders.
- Keep the build small enough to finish and launch quickly.

**Success metrics (test phase)**

| Metric | Target _(assumption: owner to adjust)_ |
|---|---|
| Paid orders in first 30 days | ≥ 20 |
| Orders verified automatically (no manual approval) | ≥ 90% |
| Time from Telebirr payment to download available | < 2 minutes (p90) |
| Fraud / duplicate-claim incidents that release a PDF without payment | 0 |
| Support requests per order ("I paid but can't download") | < 10% |

**Non-goals for these metrics:** SEO traffic, repeat purchases, subscription revenue.

## 3. User Stories / Personas

**Personas**
- **Buyer:** a BYD owner or mechanic in Ethiopia, usually on a mobile phone, has Telebirr.
- **Owner/Admin:** runs the site, owns the Telebirr number, uploads manuals, handles exceptions.

**Stories**
1. As a buyer, I want to see the list of BYD models with manuals available, so that I can find mine.
2. As a buyer, I want to see the price and what the manual covers before I pay, so that I know what I'm buying.
3. As a buyer, I want clear instructions (amount, phone number, steps), so that I send the right payment.
4. As a buyer, I want to type my Telebirr transaction number and immediately get my PDF, so that I don't wait for a human.
5. As a buyer who entered the transaction number before the system received the SMS, I want the page to keep checking for a short time, so that I don't have to start over.
6. As an admin, I want incoming Telebirr SMS to be recorded automatically, so that I don't verify payments by hand.
7. As an admin, I want to see unmatched payments and failed claims, so that I can resolve "I paid but it didn't work" cases.
8. As an admin, I want to add or edit car models and upload PDFs, so that I can grow the catalog without code changes.

## 4. Scope & Non-Goals

**In scope**
- Public catalog page listing BYD models, each with available language versions and price.
- Model detail / checkout page with Telebirr payment instructions.
- Transaction-number claim form and verification.
- One-time, time-limited download link.
- Android phone running an SMS forwarder app that sends Telebirr SMS to a server webhook.
- SMS parser and payments ledger.
- Minimal password-protected admin page.
- English-only website and English-only PDFs.
- Hosting entirely on the Cloudflare free plan (see Technical Requirements).

**Out of scope (for this test)**
- User accounts, login, re-download history. Buyers get a one-time link only.
- Payment gateways (Chapa, Telebirr merchant API, cards).
- Searchable online manual or subscription. That is a later "full system".
- Automatic refunds. Refunds are handled manually by the owner.
- Native mobile app.
- Amharic PDFs and Amharic website language (possible later).
- Paid hosting of any kind. If the test outgrows the free plan, that is a signal to build the full system.

## 5. Requirements

### Functional Requirements

**Catalog**
- **FR-1** The system SHALL display a list of BYD models (name, image, model year). Launch catalog: **BYD E2 (2025)** and **BYD Sealion (2026)**.
- **FR-2** Each model SHALL have one English manual. Launch price is **500 ETB** for every model; price is stored per manual so the admin can change it without a code change. _(The data model keeps a `language` field fixed to `en`, so Amharic can be added later without a schema change.)_
- **FR-3** Models without an uploaded PDF SHALL be hidden or marked "coming soon".

**Checkout and payment instructions**
- **FR-4** When a buyer selects a model, the system SHALL show: the exact price, the Telebirr phone number and account name to pay, and numbered steps.
- **FR-5** The instructions SHALL state that payment must be sent **from the telebirr app (telebirr to telebirr)**, not from a bank app, and tell the buyer to keep the transaction number from their telebirr confirmation SMS.

**SMS ingestion**
- **FR-6** The system SHALL expose a webhook that receives forwarded SMS messages from the owner's Android phone.
- **FR-7** The system SHALL accept only messages from the telebirr sender ID `127` (confirmed) that match the telebirr-to-telebirr "received" pattern. Other messages from `127` (e.g. bank deposits, airtime) SHALL be stored in `raw_sms` as `ignored` and SHALL NOT be claimable. SMS from any other sender SHALL be discarded and not stored.
- **FR-8** For each accepted SMS the system SHALL extract: transaction number, amount (ETB), payer name, payer phone (as masked by telebirr, e.g. `2519****2531`), and transaction date/time.
- **FR-9** The system SHALL store each transaction number at most once (idempotent). A repeated SMS with the same transaction number SHALL NOT create a second payment.
- **FR-10** The system SHALL NOT store the account balance or other unneeded content from the SMS.

**Claim and verification**
- **FR-11** The buyer SHALL enter a transaction number on the checkout page for the chosen model.
- **FR-12** The system SHALL normalize the input (trim, uppercase, remove spaces) and validate the format: 10 uppercase letters/digits (confirmed from real SMS).
- **FR-13** The claim SHALL succeed only if all of the following hold:
  a) a payment with that transaction number exists;
  b) it has not already been claimed;
  c) its amount is greater than or equal to the price of the selected version;
  d) it was received within the claim window _(assumption: 7 days)_.
- **FR-14** Marking a payment as claimed SHALL be atomic, so two simultaneous claims with the same transaction number cannot both succeed. _(D1 implementation: `UPDATE payments SET status='claimed' WHERE transaction_number=? AND status='unclaimed'`, and continue only if exactly 1 row changed.)_
- **FR-15** If no matching payment exists yet, the page SHALL show a "waiting for payment confirmation" state and re-check automatically every few seconds for up to 10 minutes, then show a message with a support contact.
- **FR-16** If the amount is less than the price, the claim SHALL fail with a clear message and the payment SHALL be flagged for admin review.
- **FR-17** If the transaction number was already used, the claim SHALL fail with a clear message ("This transaction number has already been used").

**Download**
- **FR-18** On a successful claim the system SHALL create an order and a download link containing a random, unguessable token.
- **FR-19** The download link SHALL be valid for 24 hours and allow up to 3 downloads _(assumption: strict single-download fails often on mobile when a download is interrupted)_.
- **FR-20** PDFs SHALL be stored privately. They SHALL only be served through a valid download token, never through a public URL.
- **FR-21** The success page SHALL tell the buyer to save the PDF now, since there are no accounts.
- **FR-22** _(Deferred)_ Per-buyer PDF watermarking is not part of this test. Stamping a large PDF on each download does not fit the free plan's CPU limit per request.

**Admin**
- **FR-23** Admin pages SHALL be protected by Cloudflare Access (free for small teams), with the owner's email as the only allowed login. _(assumption: avoids writing our own password login)_
- **FR-24** The admin SHALL be able to create, edit, and hide models, set prices, and upload PDFs (each PDF is under 100 MB, which fits the 100 MB upload limit of the free plan).
- **FR-25** The admin SHALL see a payments list (received, claimed, unclaimed, flagged) and an orders list.
- **FR-26** The admin SHALL be able to manually approve a claim (e.g. when the SMS was lost) and generate a new download link for a buyer.
- **FR-27** The admin SHALL see the time of the last SMS received from the phone and a warning if the phone has been silent too long (see TR on heartbeat).

### Technical Requirements

**Architecture overview**

```
Buyer (browser)
   │  1. pays via Telebirr app ──────────────► Owner's phone (Telebirr SMS)
   │                                              │ 2. SMS forwarder app
   │                                              ▼
   │                                     POST /api/sms-webhook
   │                                              │ 3. parse + store payment
   │  4. POST /api/claim {txn, versionId} ───► Web app + DB
   │  5. ◄── download token
   │  6. GET /d/{token} ────────────────────► private PDF storage
```

Everything runs on the **Cloudflare free plan**:

| Need | Cloudflare service | Free-plan fit |
|---|---|---|
| Website pages + API | **Workers** (one Worker serving static assets and API routes) | 100,000 requests/day; small CPU time per request |
| Database | **D1** (SQLite) | 5 GB storage, 5M rows read/day, 100K rows written/day |
| PDF storage | **R2** (private bucket) | 10 GB storage, no egress fees |
| Scheduled checks (phone heartbeat) | **Cron Triggers** on the Worker | included |
| Admin login | **Cloudflare Access** | free for small teams |
| Bot protection on claim form | **Turnstile** | free |
| HTTPS + domain | **Custom domain** on Cloudflare DNS, attached to the Worker as a Custom Domain | DNS, SSL and Worker routing are free; the domain itself has a yearly fee |

_(Limits checked Oct 2026; re-check Cloudflare's limits page before launch. R2 may ask for a card on signup but does not charge under the free limits.)_

**Free-plan design rules (engineering must follow):**
- Keep each request light. No PDF processing, image processing, or heavy hashing inside the Worker.
- Stream PDFs from R2 to the buyer. Do not load the whole file into Worker memory.
- Every D1 query that runs on a hot path (claim, polling, webhook) SHALL use an index (`payments.transaction_number`, `download_tokens.token`), because D1 counts rows scanned, not rows returned.
- Polling (FR-15) every 5 seconds for 10 minutes is about 120 requests per waiting buyer. This is well inside 100K/day at test volume, but polling SHALL stop as soon as the claim succeeds or times out.
- Write the app so it can move to the $5 Workers Paid plan without code changes if the test succeeds.

**SMS forwarder (phone side)**
- An Android phone (dedicated, or the owner's own) with the Telebirr SIM, running an SMS forwarder app that can POST incoming SMS to an HTTPS URL with a custom header. Candidates: open-source "SMS to URL / webhook forwarder" apps, or a small custom Android app if no existing app is reliable enough.
- The forwarder SHALL filter by sender `127` before sending, so personal SMS never leave the phone.
- Each request SHALL include a shared secret header (e.g. `X-Webhook-Secret`). The server SHALL reject requests without it.
- Battery optimization SHALL be turned off for the forwarder app, and the phone SHALL stay charged with mobile data or Wi-Fi.

**API**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/sms-webhook` | POST | Receive forwarded SMS. Body: `{ from, body, receivedAt }`. Auth: shared secret. Returns 200 even for ignored messages (so the app does not retry forever). |
| `/api/heartbeat` | POST | Optional: forwarder or a scheduled phone task pings to prove the phone is online. |
| `/api/models` | GET | Public catalog. |
| `/api/claim` | POST | Body: `{ transactionNumber, versionId }`. Returns `{ status: "ok", downloadUrl }`, `{ status: "pending" }`, or `{ status: "error", code }`. |
| `/d/{token}` | GET | Stream the PDF if the token is valid; count the download. |
| `/admin/*` | — | Admin pages (auth required). |

Error codes for `/api/claim`: `INVALID_FORMAT`, `NOT_FOUND_YET` (pending), `ALREADY_USED`, `AMOUNT_TOO_LOW`, `EXPIRED`, `RATE_LIMITED`.

**Data model**

| Table | Key fields |
|---|---|
| `car_models` | id, name, slug, image_key (R2), year_range, is_visible, sort_order |
| `manual_versions` | id, car_model_id, language (always `en` for now), price_etb, r2_key, file_size, is_visible |
| `raw_sms` | id, sender, body, received_at, parse_status (`parsed`/`ignored`/`failed`). Keep only Telebirr messages. |
| `payments` | id, transaction_number (UNIQUE, indexed), amount_etb, payer_name, payer_phone_masked, paid_at (stored in UTC; SMS time is Ethiopia time, UTC+3), raw_sms_id, status (`unclaimed`/`claimed`/`flagged`), claimed_at |
| `orders` | id, payment_id (UNIQUE), manual_version_id, created_at, created_by (`auto`/`admin`) |
| `download_tokens` | id, order_id, token (random, ≥ 32 bytes, UNIQUE, indexed), expires_at, max_downloads, download_count |
| `claim_attempts` | id, transaction_number_input, ip, result_code, created_at (for rate limiting and support) |

**SMS parsing**
- The parser SHALL be driven by a list of configurable patterns (regex), tried in order, so a new SMS wording is a config change, not a code rewrite.
- **Pattern 1 (confirmed, telebirr → telebirr transfer):**
  ```
  You have received ETB (?<amount>[\d,]+\.\d{2}) from (?<name>.+?)\s*\((?<phone>[\d*]+)\) on (?<date>\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2})\. Your transaction number is (?<txn>[A-Z0-9]{10})\.
  ```
  - Collapse line breaks and repeated spaces to single spaces before matching.
  - Amount: remove commas before converting (e.g. `1,500.00`).
  - Date is **DD/MM/YYYY** in Ethiopia time (UTC+3); convert to UTC for storage.
- Bank-deposit SMS ("…by transaction number … from Commercial Bank of Ethiopia…") does not match Pattern 1 and is stored as `ignored` (FR-7).
- The parser SHALL NOT extract or store the balance line or the owner's own account number.
- Messages that come from `127` but fail to parse SHALL be stored with `parse_status = failed` and shown to the admin.
- _Blocking:_ the exact SMS format must be confirmed from a real deposit SMS before the parser is written (see Open Questions).

**Error handling & edge cases**
- **Buyer enters the number before the SMS arrives:** pending state + polling (FR-15).
- **Buyer types the number wrong (O vs 0, I vs 1):** show a clear "not found" message after the waiting period. _(Assumption: no fuzzy matching, to avoid matching someone else's payment.)_
- **Buyer pays twice or overpays:** the second transaction stays unclaimed; admin handles it manually.
- **Buyer pays less than the price:** claim fails, payment flagged (FR-16).
- **Phone offline:** SMS is delayed until the phone reconnects; forwarder should retry. Admin is warned by the heartbeat check (FR-27).
- **Someone sends a fake "Telebirr" SMS to the owner's phone from a normal number:** rejected because the sender is not `127`.
- **Someone guesses a transaction number:** unlikely (10-character random IDs), and claims are rate-limited.
- **Duplicate webhook delivery:** ignored because `transaction_number` is unique (FR-9).
- **Buyer pays from a bank app anyway:** the SMS does not match Pattern 1, so it is stored as `ignored` and cannot be claimed. The buyer contacts support; the admin decides case by case (approve manually with FR-26 or refund).

**Security**
- HTTPS everywhere.
- Shared secret on the webhook; rotate if leaked.
- Rate limit `/api/claim`: e.g. 10 attempts per IP per 10 minutes, counted from `claim_attempts` in D1 or with Cloudflare's rate limiting rules. Turnstile on the claim form blocks bots.
- Download tokens are random and expire; PDFs never sit in a public folder.
- Payer phone numbers and names are personal data: show them only in admin, never on public pages.
- Admin protected by Cloudflare Access; admin pages not indexed by search engines.
- Webhook secret and other secrets stored as Worker secrets, never in the code repository.

**Performance & scale**
- Expected load is small (tens to hundreds of orders per month), well inside the Cloudflare free plan.
- PDF downloads are streamed from R2 through the Worker after the token check. R2 has no egress fees, so download volume does not create cost.

**Dependencies**
- Telebirr (personal account and its SMS format).
- An Android phone with the Telebirr SIM and an SMS forwarder app.
- Cloudflare account (free plan): Workers, D1, R2, Access, Turnstile.

**Rollout**
1. Build and test with small real payments (e.g. 1 ETB test product) from a friend's phone.
2. Soft launch to 1–2 BYD Telegram groups.
3. Review metrics after 30 days and decide whether to build the full system.

## 6. Timeline / Milestones

All dates are aspirational.

| Milestone | Target |
|---|---|
| Confirm real Telebirr SMS format + choose forwarder app | Week 1 |
| Cloudflare setup (Worker, D1, R2, Access) + catalog, checkout page, admin upload | Week 1 |
| SMS webhook, parser, claim + download flow | Week 2 |
| End-to-end test with real small payments | End of week 2 |
| Soft launch | Week 3 |
| Go / no-go decision on full system | Launch + 30 days |

## 7. Open Questions & Risks

| # | Question / Risk | Owner | Notes |
|---|---|---|---|
| 1 | ~~SMS wording~~ | — | **Resolved:** telebirr → telebirr wording confirmed (Pattern 1). |
| 1b | **Does the buyer see the same transaction number?** Confirm the sender's own telebirr confirmation shows the same number the owner receives. | Owner | One test transfer before launch. The whole claim flow depends on it. |
| 2 | ~~Price~~ | — | **Resolved:** 500 ETB per manual. |
| 3 | ~~Launch models~~ | — | **Resolved:** BYD E2 (2025) and BYD Sealion (2026); each PDF under 100 MB. |
| 4 | **Using a personal Telebirr account for sales** may hit daily transaction limits or Telebirr terms for commercial use, and has tax implications. | Owner | Fine for a small test; check before scaling. Full system should move to a merchant account or gateway. |
| 5 | **Phone reliability:** if the phone dies or loses data, auto-verification stops. | Owner | Mitigated by heartbeat warning + manual approve. Consider a dedicated cheap Android phone. |
| 6 | Which SMS forwarder app is reliable on the chosen phone (background limits differ by brand)? | Dev | Test for 48 hours before launch. |
| 7 | **PDF sharing:** a buyer can forward the PDF to Telegram groups. | Owner | Accept for the test; per-buyer watermark is deferred (FR-22). |
| 10 | Domain name to buy, and where to register it | Owner | **Decided:** custom domain. Domain must use Cloudflare DNS (register through Cloudflare Registrar, or point the nameservers of an existing domain to Cloudflare). |
| 11 | **Free-plan limits** change over time. | Dev | Re-check before launch; set up Cloudflare usage notifications. |
| 8 | Refund policy and support contact (Telegram username or phone) | Owner | Must appear on the checkout page. |
| 9 | Download limits (24 h / 3 downloads) acceptable? | Owner | FR-19 assumption. |

## 8. Appendix

**Example transaction numbers:** `DJD9REAQD9`, `DJD0RGOO68`, `DIQ55JS1ED` (10 characters, uppercase letters and digits).

**Real SMS from sender `127` (telebirr → telebirr; names and balance masked):**
```
Dear [Owner]
You have received ETB 500.00 from [Payer Name](2519****2531) on 26/09/2026 09:57:24. Your transaction number is DIQ55JS1ED. Your current E-Money Account balance is ETB [hidden].
Thank you for using telebirr
Ethio telecom
```
Parsed result: `txn=DIQ55JS1ED`, `amount=500.00`, `payer_name=[Payer Name]`, `payer_phone_masked=2519****2531`, `paid_at=2026-09-26 09:57:24 EAT (06:57:24 UTC)`.

**Launch catalog:** BYD E2 (2025), BYD Sealion (2026); English PDF, 500 ETB each.

**Buyer flow (happy path)**
1. Open site → choose "BYD Sealion (2026)".
2. See: "Send **500 ETB** from the telebirr app to **09XXXXXXXX** (Name). Then enter the transaction number from your Telebirr SMS below."
3. Pay in the Telebirr app → receive SMS with transaction number.
4. Enter `DJD9REAQD9` → "Payment confirmed" → **Download PDF**.

**Future (full system), not part of this PRD:** Amharic PDFs and Amharic website, user accounts, searchable online manual, subscriptions, merchant Telebirr / gateway integration, more car brands.
