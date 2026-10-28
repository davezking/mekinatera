# Phase 1 demo — Buyer happy path

**Preview URL:** <filled in after deploy: https://byd-manuals-staging.<account>.workers.dev>
**Release tag:** v0.1-phase1

## What's new in this phase
A buyer can open the site on a phone, choose a BYD model, see exactly how to pay with telebirr, type the transaction number, and download the manual. Payments come in automatically from forwarded telebirr SMS. In this demo, a script plays the role of the phone. Every way a claim can fail (wrong number, used twice, underpaid, too old) shows a clear message.

## Before you start
- Use a phone, or a browser in mobile view.
- In a terminal at the repo root: `export STAGING_URL=<preview URL>` and `export WEBHOOK_SECRET=<staging webhook secret>`.
- Staging is reseeded on every push to `phase-1`. If you've used up the demo numbers, re-run the "Deploy staging" workflow.

## Demo script
1. Open the preview URL → BYD E2 (2025) and BYD Sealion (2026) at **500 ETB**; BYD Dolphin shows **Coming soon** and can't be opened; BYD Han is not listed.   (story: 1, FR-1–3)
2. Tap **BYD Sealion** → price 500 ETB, the telebirr phone number and name, 4 numbered steps, the yellow "telebirr app only" notice, and under the input the hint "starts with D and has 10 letters and numbers".   (story: 2, 3, FR-4–5)
3. Type `demopay 001` (lowercase, with a space) → tap **Get my PDF** → green **Payment confirmed** with the save-now notice.   (story: 4, FR-11–13, FR-21)
4. Tap **Download PDF** → `BYD-Sealion-2026-EN.pdf` downloads and opens (a one-page demo PDF).   (story: 4, FR-18, FR-20)
5. Reload the page, enter `DEMOUSED01` → "This transaction number has already been used."   (FR-17)
6. Enter `DEMOLOW001` → "The amount received is less than the price…"   (FR-16)
7. Enter `ABC` → a message about the 10-character format, shown instantly.   (FR-12)
8. Enter `NEWPAY0001` → "Waiting for telebirr confirmation…" with a timer. In the terminal run `scripts/fake-sms.sh staging NEWPAY0001 500` → within about 5 seconds the page switches to **Payment confirmed**.   (story: 5, 6, FR-6–8, FR-15)
9. Run `scripts/fake-sms.sh staging NEWPAY0001 500` again → the terminal shows `duplicate`.   (FR-9)
10. Enter `DEMOOLD001` → "This payment is older than 7 days…"   (FR-13d)
11. Open the download link from step 3 three more times (long-press → copy link → paste in a new tab) → the 4th time shows "This download link has expired or has been used up".   (FR-19)
12. Run `scripts/fake-sms.sh staging FAKEBANK01 500 8899` → `discarded`. Run `scripts/fake-sms.sh staging BANKPAY001 500 127 bank` → `ignored`. Enter `BANKPAY001` on the site → it stays in "Waiting…" (a bank-app payment can't be claimed automatically).   (FR-7, edge cases)

## Known limitations
- No admin pages yet. Catalog changes, PDF uploads, payment lists and manual approval come in Phase 2.
- PDFs are one-page placeholders, not the real manuals.
- No Turnstile bot check or rate limiting yet (Phase 3).
- After 10 minutes of waiting, the page shows "not found" with the support contact; there's no way yet for the owner to fix it.
- The 24-hour link expiry can't be shown live; it's covered by automated tests.
- Runs on a `workers.dev` address; a custom domain is optional after the project.

## How to give feedback
Open a GitHub issue with the **Feedback** template (one issue per problem, mention the step number), or paste notes into Claude Code with `/triage-feedback <notes>`.
