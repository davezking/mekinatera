---
id: P1-SEED
title: Phase 1 demo seed data and fake-sms script
phase: 1
sprint: 3
model: haiku
review: auto          # auto | opus
depends_on: [P1-S3-T2, P1-S3-T3, P1-S1-T3]
parallel_group: 3C
files: [scripts/seed.ts, scripts/fake-sms.sh, seed/*]
---

## Why this model / review tier
Haiku: mechanical data entry into the existing seed structure plus a curl wrapper.
Auto: demo data only; the seed script already refuses production.

## Context
`scripts/seed.ts` exists with a `SEED_SECTIONS` array (P1-S1-T3). Demo steps are in `docs/phases/phase-1-demo.md`. The webhook is `POST /api/sms-webhook` with `X-Webhook-Secret`. Payment SMS wording: `You have received ETB <amount> from <Name>(<masked phone>) on <DD/MM/YYYY HH:mm:ss>. Your transaction number is <TXN>. Your current E-Money Account balance is ETB [redacted].`

## Do this
1. Add a `phase1Payments` section to `SEED_SECTIONS`. Each payment gets a matching `raw_sms` row (`parsed`, pattern `t2t-received-v1`, redacted body). Times are relative to the seed run (`now`):
   | txn | amount | paid_at | status | purpose |
   |---|---|---|---|---|
   | `DEMOPAY001` | 500 ETB | now − 5 min | unclaimed | demo happy path |
   | `DEMOPAY002`…`DEMOPAY005` | 500 ETB | now − 5 min | unclaimed | E2E tests (one per test) |
   | `DEMOLOW001` | 300 ETB | now − 5 min | unclaimed | amount too low |
   | `DEMOOLD001` | 500 ETB | now − 10 days | unclaimed | expired |
   | `DEMOUSED01` | 500 ETB | now − 1 day | claimed (+ order `auto` + token, count 1) | already used |
   Payer names: obviously fake ("Demo Buyer 1"…). Masked phones: `2519****0001`…
   Also add one `raw_sms` row with `parse_status='ignored'` (bank-deposit wording) and one `failed` (garbage text), for Phase 2's admin lists.
2. `scripts/fake-sms.sh <local|staging> <TXN> <AMOUNT_ETB> [sender=127] [kind=payment|bank]`:
   - Base URL: `http://localhost:8787` for local; `$STAGING_URL` (required) for staging. Refuse any other env.
   - Secret: `$WEBHOOK_SECRET`, or for local read it from `.dev.vars`.
   - Builds the body with the current Ethiopia time (`TZ=Africa/Addis_Ababa date +'%d/%m/%Y %H:%M:%S'`), amount formatted with 2 decimals, and payer "Demo Buyer" `2519****9999`. `kind=bank` uses a bank-deposit wording instead.
   - Prints the HTTP status and response.

## Acceptance criteria
- After `pnpm db:reset:local && pnpm seed:local`, every payment above exists with the stated status, and `DEMOUSED01` has an order and a token.
- `scripts/fake-sms.sh local NEWPAY0001 500` → `{"result":"stored"}`; again → `duplicate`.
- `scripts/fake-sms.sh local NEWPAY0002 500 8899` → `discarded`; `… kind bank` → `ignored`.
- `scripts/fake-sms.sh production …` exits 1.

## Tests to write or update
- None (scripts). Used by P1-E2E and the demo.

## How to test manually
1. `pnpm db:reset:local && pnpm seed:local && pnpm dev`
2. `pnpm wrangler d1 execute DB --local --command "SELECT transaction_number, status FROM payments ORDER BY transaction_number"` → the 9 demo payments.
3. `scripts/fake-sms.sh local NEWPAY0001 500` → stored.
