---
id: P2-SEED
title: Phase 2 admin demo data
phase: 2
sprint: 2
model: haiku
review: auto          # auto | opus
depends_on: [P2-S1-T3, P2-S2-T2, P2-S2-T3]
parallel_group: 2C
files: [scripts/seed.ts, seed/*]
---

## Why this model / review tier
Haiku: appends rows to the existing seed sections.
Auto: demo data only.

## Context
`scripts/seed.ts` has `SEED_SECTIONS` with the Phase 1 sections. The demo is `docs/phases/phase-2-demo.md`. Tables added in Phase 2: `system_status`.

## Do this
Add a `phase2Admin` section:
- `DEMOFLAG01`: 300 ETB, `flagged`, `flag_reason='amount_too_low'` (ready for the manual-approve demo).
- 12 extra claimed payments spread over the last 20 days, with orders and tokens in mixed states (active, expired, used up, revoked), so the lists and pagination look real (`DEMOHIST01`…`DEMOHIST12`).
- One `admin` order with `payment_id NULL` and a note.
- `system_status.last_heartbeat_at = now − 10 min`, `battery = 76`.
- Two more `raw_sms` `failed` rows with different garbage, one more `ignored`.
Keep every Phase 1 transaction number unchanged (the Phase 1 E2E tests depend on them).

## Acceptance criteria
- After seeding: the dashboard counts are non-zero for every status; the banner is green; the Flagged tab shows `DEMOFLAG01` (and `DEMOLOW001` only after it's claimed).
- `pnpm e2e` (Phase 1 tests) still passes.

## Tests to write or update
- None.

## How to test manually
1. `pnpm db:reset:local && pnpm seed:local`, `pnpm dev` + `pnpm dev:admin` → http://localhost:8788/admin dashboard numbers, green banner; `/admin/payments/orders` shows mixed link states.
