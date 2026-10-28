# Phase 3 demo — Hardening & launch

**Public site:** https://byd-manuals-staging.<account>.workers.dev
**Admin:** https://byd-manuals-admin-staging.<account>.workers.dev/admin
**Release tag:** v0.3-phase3

## What's new in this phase
The claim form is protected against bots (Cloudflare Turnstile) and against guessing (10 tries per 10 minutes per connection). Pages send security headers, and errors show friendly pages. The production deploy is set up to run only from an approved release, and there is a step-by-step launch checklist and a runbook for support situations.

## Demo script
1. Open the Sealion checkout → a small Cloudflare check appears under the form; **Get my PDF** becomes active once it passes.   (PRD security: Turnstile)
2. Enter `DEMOPAY001` → success, as before. Go back and enter another number → the check refreshes and the form works again.   (FR-11)
3. Rate limit: run this 11 times quickly: `curl -s -X POST https://byd-manuals-staging.<account>.workers.dev/api/claim -H 'content-type: application/json' -d '{"transactionNumber":"GUESS00001","versionId":1,"turnstileToken":"x"}'` → the last replies show `RATE_LIMITED`.   (PRD security: rate limit)
4. `curl -I https://byd-manuals-staging.<account>.workers.dev/` → you see `content-security-policy`, `x-content-type-options: nosniff`, and `x-robots-tag: noindex` (staging).   (PRD security)
5. Open `https://byd-manuals-staging.<account>.workers.dev/robots.txt` → admin, download and API paths are disallowed.   (PRD security)
6. Open `https://byd-manuals-staging.<account>.workers.dev/nothing-here` → friendly "page not found".   
7. Catalog shows **Test product — 1 ETB**; enter `DEMOONE001` → download works. This is the rehearsal for the real 1 ETB test.   (PRD rollout 1)
8. Open `docs/launch-checklist.md` and `docs/runbook.md` → every step is clear enough to follow without help.   (PRD rollout)

## Known limitations
- Production isn't live until you complete `docs/launch-checklist.md`, including the real 1 ETB transfer from a friend's phone (PRD Q1b).
- No PDF watermarking (FR-22 deferred). Buyers can share the PDF.
- Telebirr personal-account limits and tax questions are outside the software (PRD risk 4).

## How to give feedback
Open a GitHub issue with the **Feedback** template, or run `/triage-feedback <notes>`.
