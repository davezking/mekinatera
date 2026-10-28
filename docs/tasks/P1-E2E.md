---
id: P1-E2E
title: Phase 1 E2E tests
phase: 1
sprint: 3
model: sonnet
review: auto          # auto | opus
depends_on: [P1-SEED]
parallel_group: 3D
files: [e2e/phase1.spec.ts, e2e/helpers.ts]
---

## Why this model / review tier
Sonnet: E2E tests need judgment about timing and selectors so they aren't flaky.
Auto: test-only change.

## Context
`playwright.config.ts` starts `pnpm e2e:server` (reset + seed + `wrangler dev`) on :8787 with a Pixel 7 profile. Seed transaction numbers are in `docs/tasks/P1-SEED.md`. The demo script is `docs/phases/phase-1-demo.md`. Write **one test per demo step**, named `step N: …`.

## Do this
1. `e2e/helpers.ts`: `postSms({txn, amountEtb, sender="127", kind="payment"})` that POSTs directly to `/api/sms-webhook` with `X-Webhook-Secret: dev-webhook-secret` (same body format as `scripts/fake-sms.sh`; EAT time computed in JS); `claimOnPage(page, slug, txn)`.
2. `e2e/phase1.spec.ts` (use a different seeded txn in each test so the tests are independent; run serially with `test.describe.configure({ mode: "serial" })` only where a test depends on state):
   - step 1: catalog lists E2 and Sealion at 500 ETB, Dolphin "Coming soon" without a link, no Han.
   - step 2: Sealion checkout shows price, phone, name, steps and the telebirr-only notice.
   - step 3: `demopay 002` → success panel; the save-now notice is visible.
   - step 4: clicking Download PDF triggers a download (`page.waitForEvent("download")`) with filename `BYD-Sealion-2026-EN.pdf` and a non-empty file.
   - step 5: `DEMOUSED01` → "already been used".
   - step 6: `DEMOLOW001` → amount too low message.
   - step 7: `ABC` → format message, no `/api/claim` request (check with `page.on("request")`).
   - step 8: a fresh txn → waiting state; then `postSms` → success within 15 s.
   - step 9: posting the same SMS twice returns `stored` then `duplicate` (API-level).
   - step 10: `DEMOOLD001` → older than 7 days message.
   - step 11: a download link works 3 times and the 4th returns 410 (use `request.get`).
   - step 12: an SMS from sender `8899` → `discarded`; bank wording from 127 → `ignored`, and claiming that txn stays in the waiting state.

## Acceptance criteria
- `pnpm e2e` passes locally and in the E2E workflow on `phase-1`.
- Each demo step in `docs/phases/phase-1-demo.md` has exactly one matching test.
- No fixed `waitForTimeout` longer than 1 s; use `expect(...).toBeVisible({ timeout })`.

## Tests to write or update
- `e2e/phase1.spec.ts`, `e2e/helpers.ts`.

## How to test manually
1. `pnpm exec playwright install chromium && pnpm e2e` → 12 passing tests.
2. `pnpm exec playwright show-report` → each test is named after its demo step.
