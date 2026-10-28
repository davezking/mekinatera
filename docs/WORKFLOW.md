# Workflow

How to build this project with Claude Code, one phase at a time. You are the builder and the only reviewer.

## One-time setup

1. **Repo**: unzip this plan into the repo root and commit it to `main`.
2. **GitHub secrets** (Settings → Secrets → Actions): `CLOUDFLARE_API_TOKEN` (Workers, D1 and R2 edit permissions), `CLOUDFLARE_ACCOUNT_ID`. No `ANTHROPIC_API_KEY` is needed: there is no Claude review workflow in CI (see **Merging** below).
3. **Claude GitHub app**: install it from https://github.com/apps/claude so Claude Code (claude.ai/code) can open, review and merge PRs.
4. **Labels**: `gh label create review:auto; gh label create review:opus; gh label create feedback`.
5. **Branch protection rule** for pattern `phase-*`: require a pull request and the status check `check` (CI). No auto-merge: a PR is merged only when you ask Claude to review and merge it.
6. **Cloudflare staging** (do this once P1-S1-T1 is merged):
   ```
   pnpm wrangler d1 create byd-manuals-staging      # paste the id into wrangler.jsonc env.staging
   pnpm wrangler r2 bucket create byd-manuals-staging
   pnpm wrangler secret put WEBHOOK_SECRET --env staging
   pnpm wrangler secret put TICKET_SECRET --env staging
   pnpm wrangler secret put TURNSTILE_SECRET_KEY --env staging   # test secret 1x0000000000000000000000000000000AA
   ```
   From Phase 2 the admin Worker deploys too; it needs no secrets (its Access settings are plain vars).
7. **Claude Code permissions**: `.claude/settings.json` allows the commands the task loop needs (pnpm scripts, git, gh) and denies deploys, staging seeding, force-pushes and reading `.dev.vars`. Review it before running headless: `scripts/run-task.sh` uses `--permission-mode acceptEdits`, so file edits are not confirmed one by one.

The first push of `phase-1` will fail CI and the staging deploy, because the app doesn't exist yet. That's expected; it goes green once P1-S1-T1 merges.

## The loop

1. **Start a phase**
   `git checkout -b phase-<N> main && git push -u origin phase-<N>`
2. **Run tasks group by group** in the order shown in the roadmap (`1A → 1B → 1C → 2A …`). A group can only start when all its tasks' `depends_on` are merged.
   - One task: `scripts/run-task.sh P1-S2-T1` (it picks the model from the task file).
   - A whole group in parallel: `scripts/parallel-group.sh 1 2A` → run each printed command in its own terminal. Remove worktrees after merge with `git worktree remove <dir>`.
   - Interactive alternative: open `claude`, `/model sonnet`, `/run-task P1-S2-T1`.
3. **Merging** (nothing merges on its own)
   - When a task PR is open and CI (`check`) is green, tell Claude: "review and merge <TASK-ID>".
   - Claude reviews the PR against `docs/tasks/<TASK-ID>.md` and `CLAUDE.md`: acceptance criteria met, listed tests present and meaningful, files outside the task's `files` list explained, conventions (santim, UTC ms, bound SQL, streaming, no PII in logs, timing-safe secret compare), and any path that could release a PDF without a valid payment.
   - Blocking findings: Claude fixes them on the task branch, waits for CI, then squash-merges into `phase-<N>`. Non-blocking findings are listed in a PR comment.
   - `review:opus` tasks (money path, security) get the same review with extra depth on those areas, and Claude reports what it checked before merging. Say "review <TASK-ID>" instead if you want to read the review before the merge.
4. **Watch the preview**: every merge into `phase-<N>` redeploys staging and reseeds demo data. Staging data is reset on every push, so don't keep anything there.
5. **Phase close-out**
   1. All phase tasks merged; the `E2E` workflow is green on `phase-<N>`.
   2. Run `/phase-review <N>` with Opus on the full phase diff; turn must-fix findings into new tasks and run them.
   3. Walk `docs/phases/phase-<N>-demo.md` yourself on the staging URL.
   4. (Only you review, so skip "send to client". Write your notes as you go.)
   5. Run `/triage-feedback` on your notes or `feedback` issues; fix `bug` items in this phase.
   6. Approve: `git checkout main && git merge --no-ff phase-<N> && git tag v0.<N>-phase<N> && git push origin main --tags`.

Production deploys happen only from a `v*` tag on `main`, after approval in the GitHub `production` environment (set up in P3-S1-T3).

## Gates outside the code

- **Before P1-S3 (claim)**: one real telebirr transfer from a friend's phone, to confirm the sender sees the same transaction number as your SMS (PRD Q1b).
- **During Phase 2**: after P2-S1-T1's first staging deploy, open Workers → `byd-manuals-admin-staging` → Settings → Domains & Routes → `workers.dev` → turn on Cloudflare Access, set the policy to your email only, and put the AUD tag and team domain into `wrangler.admin.jsonc` `env.staging`. Never turn Access on for the public Worker (`byd-manuals-staging`); it would block buyers and the SMS webhook.
- **Before launch**: complete `docs/launch-checklist.md`.

## When requirements change

Use the saas-architect skill in Change mode with `architecture.md`, the changelog entry, and the list of merged task IDs. Merged tasks are never rewritten; changes become new tasks.
