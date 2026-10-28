---
id: P3-SEED
title: Launch-test seed data
phase: 3
sprint: 1
model: haiku
review: auto          # auto | opus
depends_on: [P3-S1-T1, P3-S1-T2, P3-S1-T3]
parallel_group: 1B
files: [scripts/seed.ts, seed/*]
---

## Why this model / review tier
Haiku: a small addition to the seed sections.
Auto: demo data only.

## Context
`SEED_SECTIONS` holds the Phase 1 and 2 sections. The demo is `docs/phases/phase-3-demo.md`.

## Do this
- Add a `phase3Launch` section: a visible model "Test product" (slug `test-product`, year "—", sort 99) with an `en` version at **1 ETB** (100 santim) and a placeholder PDF, mirroring the launch checklist's 1 ETB gate. Add payment `DEMOONE001` of 1.00 ETB, unclaimed.
- Add 9 `claim_attempts` rows from IP `203.0.113.7` in the last 5 minutes, so the demo can show rate limiting after 2 more tries from that IP (the E2E test sends `X-Test-Client-IP: 203.0.113.7`, which is honoured only in development).

## Acceptance criteria
- After seeding, "Test product" shows on the catalog at 1 ETB, and `DEMOONE001` claims it successfully.
- Phase 1 and 2 E2E tests still pass.

## Tests to write or update
- None.

## How to test manually
1. `pnpm db:reset:local && pnpm seed:local && pnpm dev` → "Test product — 1 ETB" on the catalog; claim `DEMOONE001` → download.
