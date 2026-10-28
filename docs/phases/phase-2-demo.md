# Phase 2 demo — Admin & operations

**Public site:** https://byd-manuals-staging.<account>.workers.dev
**Admin:** https://byd-manuals-admin-staging.<account>.workers.dev/admin
**Release tag:** v0.2-phase2

## What's new in this phase
The owner has a private admin area at its own address, protected by a Cloudflare email login. The public site contains no admin pages at all. You can add car models, set prices, upload the manual PDFs and car photos, and see every payment and order. When something goes wrong (an underpaid transfer, a lost SMS, an expired link), you can approve the order yourself and send the buyer a new link. A banner tells you if the payment phone has stopped checking in.

## Demo script
1. Open the **Admin** URL → Cloudflare asks for your email and a code → the dashboard shows payment and order counts and a green "Phone online" banner.   (FR-23, FR-25, FR-27)
2. **Catalog → Add model**: "BYD Atto 3", year 2025, price 450 → save. Open the **public site** → Atto 3 shows **Coming soon**.   (story: 8, FR-24, FR-3)
3. Edit **Sealion**, change the price to 600 → the public checkout page shows 600 ETB. Change it back to 500.   (FR-2, FR-24)
4. Edit **Atto 3** → upload a PDF → the progress bar reaches 100% → the public catalog now shows Atto 3 at 450 ETB and it can be opened.   (FR-24)
5. Upload a car photo for Atto 3 → it appears on the public catalog card.   (FR-24)
6. Try uploading a text file renamed to `.pdf` → "not a PDF" error; nothing changes.   (FR-24)
7. Untick **Visible** on Atto 3 → it disappears from the public site. Tick it again.   (FR-24)
8. **Payments** → switch between Unclaimed / Claimed / Flagged tabs; each shows only matching payments, with payer name and masked phone.   (story: 7, FR-25)
9. Open any payment → you see the SMS text with the balance hidden, and its order and link status.   (FR-10, FR-25)
10. **SMS** → Failed and Ignored lists show the SMS that couldn't be used as payments.   (FR-7)
11. **Flagged** → open `DEMOFLAG01` (300 ETB) → **Approve for** Sealion, add a note, tick the confirmation → a one-time link appears → open it → the PDF downloads.   (story: 7, FR-26)
12. **Orders → Approve without a payment** → choose E2, note "paid from bank app, checked statement" → a link appears and works.   (FR-26)
13. **Orders** → on any order press **New link** → the old link shows "expired or used up"; the new one downloads.   (FR-26)
14. In a terminal: `curl -X POST https://byd-manuals-staging.<account>.workers.dev/api/heartbeat -H "X-Webhook-Secret: $WEBHOOK_SECRET" -H 'content-type: application/json' -d '{"battery":55}'` → reload admin → "last check-in less than a minute ago · battery 55%".   (FR-27)

## Known limitations
- The red "phone offline" banner appears only after 45 minutes of silence, so it isn't shown live; it's covered by automated tests.
- There are no alerts outside the admin page (e.g. Telegram). See the backlog.
- No Turnstile or rate limiting yet (Phase 3).
- Refunds stay manual (outside the system); add a note on the order.
- Links created by the admin are shown once only. Copy them before leaving the page.

## How to give feedback
Open a GitHub issue with the **Feedback** template (mention the step number), or run `/triage-feedback <notes>` in Claude Code.
