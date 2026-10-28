# BYD Manual Store (MVP)

Sells English PDF translations of China-market BYD manuals in Ethiopia. Buyers pay 500 ETB by telebirr-to-telebirr transfer to the owner's phone. An SMS forwarder on that phone posts the telebirr SMS to our webhook. The buyer enters the transaction number, and we verify it and return a time-limited download link. Everything runs on the Cloudflare free plan. The rule that matters most: **never release a PDF without a matching payment.**

## Stack
Cloudflare Workers + Static Assets · Hono 4 (`hono/jsx` SSR, no client framework) · D1 (raw SQL, wrangler migrations) · R2 (private) · Cloudflare Access (admin) · Turnstile · TypeScript strict · Biome · Vitest + @cloudflare/vitest-pool-workers · Playwright · pnpm · Node 22

## Folders
```
src/index.ts          PUBLIC Worker app + route mounting (never mount admin here)
src/admin-worker.ts   ADMIN Worker app (wrangler.admin.jsonc); mounts routes/admin.tsx at /admin
src/env.ts            AppEnv type (public); src/admin-env.ts AdminEnv
src/routes/           one module per route group (public, api, claim, webhook, heartbeat, download; admin + admin/* for the admin Worker)
src/middleware/       admin-auth, security
src/lib/              sms/, db/, claim, token, ticket, money, time, secrets, turnstile, rate-limit
src/views/            hono/jsx components; admin/ for admin views
public/               css/, js/ (vanilla ES modules, no build), img/, robots.txt
migrations/           NNNN_name.sql (D1)
scripts/              seed.ts, fake-sms.sh, run-task.sh, parallel-group.sh
test/                 vitest (*.test.ts), runs inside workerd with local D1/R2
e2e/                  playwright (*.spec.ts)
docs/tasks/           one file per task; docs/phases/ demo scripts
```

## Commands
```
pnpm install
pnpm dev                 # public Worker on :8787 (local D1/R2)
pnpm dev:admin           # admin Worker on :8788 (same local D1/R2; from Phase 2)
pnpm lint                # biome check .
pnpm format              # biome format --write .
pnpm typecheck           # tsc --noEmit
pnpm test                # vitest run
pnpm e2e                 # playwright test (starts e2e:server itself)
pnpm db:migrate:local    # wrangler d1 migrations apply DB --local
pnpm db:reset:local      # wipe local D1 state + migrate
pnpm seed:local          # tsx scripts/seed.ts --env local
pnpm seed:staging        # tsx scripts/seed.ts --env staging (refuses production)
pnpm cf-typegen          # wrangler types (regenerate after changing wrangler.jsonc)
```
Run `pnpm lint && pnpm typecheck && pnpm test` before every commit.

## Conventions
- Money is **integer santim** (`*_santim`; 500 ETB = 50000). Convert only at the edges with `src/lib/money.ts`. Never use floats for money.
- Time is **integer Unix ms UTC** (`*_at`). telebirr SMS dates are DD/MM/YYYY in EAT (UTC+3). Convert them in the parser only.
- SQL: always use bound parameters (`.bind()`), never string-concatenate. Every query on a hot path (claim, poll, webhook, download) must use an index; add the index in a migration if it doesn't exist.
- Never edit a merged migration. Add a new `migrations/NNNN_*.sql` instead.
- Multi-step writes that must succeed together go in one `env.DB.batch([...])`.
- Never buffer a PDF. Stream `R2Object.body` out and `request.body` into `R2.put`.
- No PDF, image or other heavy processing in the Worker (free plan allows ~10 ms CPU).
- Logs: `console.log(JSON.stringify({event, ...ids}))`. Never log payer names, phone numbers, SMS bodies, tokens or secrets.
- Payer name and phone number appear only on `/admin` pages.
- Secrets come from `c.env` (Worker secrets / `.dev.vars`); never put them in code or `wrangler.jsonc`.
- Compare secrets with `crypto.subtle.timingSafeEqual` (helper in `src/lib/secrets.ts`).
- UI follows `docs/design.md` (tokens, type, components, claim states, copy). Reference screens: `docs/design/*.dc.html` (reference only, never copy their inline styles into `src/`). Mobile-first, tap targets ≥ 44px, plain English, no client framework. Fonts are self-hosted in `public/fonts/`.
- Route modules export a `Hono<AppEnv>` instance; `src/index.ts` mounts them. Don't add new mounts unless a task says to.
- Tests: Vitest for logic and routes (use `SELF.fetch` from `cloudflare:test`), Playwright only for the phase E2E tasks.
- Names: files kebab-case, types PascalCase, DB columns snake_case, JSON fields camelCase.

## Environments
Two Workers: public (`wrangler.jsonc`) and admin (`wrangler.admin.jsonc`, Phase 2+), both on `workers.dev`, sharing the same D1 and R2 per env. Each config has top-level (local dev), `env.staging` and `env.production`. Bindings and vars are **not inherited**: add a binding or var to all three envs, and to both configs if shared code reads it. Bindings: `DB` (D1), `MANUALS` (R2), `ASSETS`. Test admin routes with `adminFetch` (`test/helpers/admin.ts`), public routes with `SELF`.
Never run `wrangler deploy`, `--remote`, or the seed script against production from a task. Deploys happen in CI.

## Branching
- `main` = last approved phase. Phase branch `phase-<N>` from `main`.
- Task branch `task/<TASK-ID>` from `phase-<N>`, PR back into `phase-<N>`, squash merge.
- No auto-merge and no CI review bot. Never enable auto-merge. Merge a task PR only when the owner says "review and merge <TASK-ID>": review it per `docs/WORKFLOW.md` → Merging, fix blocking findings, wait for green CI, then squash-merge.
- Approved phase: merge `phase-<N>` → `main`, tag `v0.<N>-phase<N>`.

## Tasks
Task files live in `docs/tasks/`. Always follow a task's acceptance criteria exactly, and do not edit files outside its `files` list without saying why in the PR. Implement a task with `/run-task <TASK-ID>`. If something in a task conflicts with this file or `architecture.md`, stop and ask instead of guessing.
