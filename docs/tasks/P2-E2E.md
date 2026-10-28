---
id: P2-E2E
title: Phase 2 E2E tests
phase: 2
sprint: 2
model: sonnet
review: auto          # auto | opus
depends_on: [P2-SEED]
parallel_group: 2D
files: [e2e/phase2.spec.ts, e2e/helpers.ts, e2e/fixtures/*]
---

## Why this model / review tier
Sonnet: multi-page admin flows with uploads and downloads.
Auto: test-only.

## Context
E2E runs on localhost: the public site on :8787 and the admin Worker on :8788 (`ADMIN_URL` exported from `playwright.config.ts`); admin uses the dev bypass (no Access). The demo script is `docs/phases/phase-2-demo.md`. Write one test per demo step, named `step N: …`. Seed data is in `docs/tasks/P2-SEED.md`.

## Do this
- `e2e/fixtures/tiny.pdf` (a valid tiny PDF), `e2e/fixtures/not-a-pdf.pdf` (text), `e2e/fixtures/car.png`.
- `e2e/phase2.spec.ts` with one test per demo step: dashboard + green banner; add a model; set price; upload PDF → public catalog shows it buyable; upload image → visible on the card; fake PDF rejected; hide a model; payments tabs filter; payment detail shows the redacted SMS; failed/ignored SMS lists; approve `DEMOFLAG01` → the link downloads; manual order; regenerate link → old 410 / new 200; heartbeat POST → banner shows "last check-in" under 1 min. (The stale/red state is covered by `test/heartbeat.test.ts`, since E2E can't move the clock.)
- Extend `e2e/helpers.ts` with `postHeartbeat()` and `uploadFile(page, selector, path)`.

## Acceptance criteria
- `pnpm e2e` passes (Phase 1 + Phase 2 specs) locally and in CI on `phase-2`.
- One test per Phase 2 demo step.

## Tests to write or update
- `e2e/phase2.spec.ts`, helpers, fixtures.

## How to test manually
1. `pnpm e2e` → all Phase 1 and Phase 2 tests pass.
