# PRD changelog

Changes to requirements after planning. Each entry: date · what changed · why · affected task IDs.
Entries are added by `/triage-feedback`; affected tasks are updated with the saas-architect skill's Change mode.

## 2026-10-28 · Admin on a separate Worker; no custom domain during the project
- **What:** FR-23 is unchanged (Cloudflare Access, owner email only), but admin now runs as a second Worker on its own `workers.dev` address with Access switched on for that whole address. The public Worker has no admin routes. The custom domain (PRD Q10) moves to an optional step after the project.
- **Why:** without a domain, Access can't protect just `/admin` on a `workers.dev` address; turning it on for the public address would block buyers and the SMS webhook.
- **Affected tasks:** P1-S1-T1, P2-S1-T1 (rewritten), P2-S1-T2, P2-S1-T3, P2-S2-T1, P2-S2-T2, P2-S2-T3, P2-SEED, P2-E2E, P3-S1-T2, P3-S1-T3, P3-E2E; `architecture.md` §3, §5–8, risk 5; `deploy-staging.yml`; Phase 2/3 demos.

## 2026-10-28 · Transaction-number hint (FR-12)
- **What:** the checkout shows "starts with D, 10 letters and numbers" and a `D•••••••••` placeholder. Validation stays `^[A-Z0-9]{10}$`; a leading D is **not** enforced, because prefixes appear to change over time (DI… in Sept, DJ… in Oct 2026).
- **Why:** buyers copy the number from the telebirr app; the hint helps them find it.
- **Affected tasks:** P1-S2-T1, P1-S3-T3; Phase 1 demo step 2.

## 2026-10-28 · Real outgoing-transfer SMS added as a parser test; redaction normalizes first (FR-7, FR-10)
- **Affected tasks:** P1-S2-T2.

## 2026-10-28 · Approved buyer-site design + real contact values
- **What:** visual design approved (design canvas; exported to `docs/design/*.dc.html`, spec in `docs/design.md`). Fonts self-hosted. Non-production pages show a "Test site" banner and test telebirr values; production uses telebirr 0977328406, account name "Dawit As****", support info@mekinatera.com.
- **Why:** owner approved the design; staging must not collect real payments.
- **Affected tasks:** P1-S1-T1, P1-S2-T1, P1-S3-T2, P1-S3-T3, P3-S1-T2 (CSP `font-src 'self'`), P3-S1-T3; `CLAUDE.md`.

