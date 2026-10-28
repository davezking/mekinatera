---
id: P3-E2E
title: Phase 3 E2E tests
phase: 3
sprint: 1
model: sonnet
review: auto          # auto | opus
depends_on: [P3-SEED]
parallel_group: 1C
files: [e2e/phase3.spec.ts, e2e/helpers.ts, e2e/phase1.spec.ts, e2e/phase2.spec.ts]
---

## Why this model / review tier
Sonnet: Turnstile and header assertions need careful handling in Playwright.
Auto: test-only.

## Context
Local and CI use Turnstile test keys (always pass). The demo is `docs/phases/phase-3-demo.md`; write one test per step, named `step N: …`. Phase 1 E2E tests may need a small update to wait for the Turnstile widget before submitting (that's why `phase1.spec.ts` is in `files`).

## Do this
- `e2e/helpers.ts`: `waitForTurnstile(page)` (waits until the submit button is enabled) and `uniqueClientIp()`; set `test.use({ extraHTTPHeaders: { "X-Test-Client-IP": uniqueClientIp() } })` per test file so specs don't rate-limit each other.
- `e2e/phase3.spec.ts`: the Turnstile widget is visible and submit works; rate limiting (`request.post` with header `X-Test-Client-IP: 203.0.113.7` → 2 more attempts → `RATE_LIMITED`); security headers present on `/`, `/m/…` (:8787) and `/admin` (`ADMIN_URL`, :8788); no CSP console errors on checkout (`page.on("console")`); robots.txt; friendly 404; 1 ETB test product happy path with `DEMOONE001`.
- Update `phase1.spec.ts` (and `phase2.spec.ts` if it submits claims) to call `waitForTurnstile` where it submits and to use a unique client IP.

## Acceptance criteria
- `pnpm e2e` passes all Phase 1–3 specs locally and on `phase-3`.
- One test per Phase 3 demo step.

## Tests to write or update
- `e2e/phase3.spec.ts`, helper update, Phase 1 spec adjustment.

## How to test manually
1. `pnpm e2e` → all green; the report shows Phase 3 steps.
