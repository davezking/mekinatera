# Launch checklist

Work through this from top to bottom, ticking each box. Each step lists the exact command or screen, so nothing needs a question. Run commands from the repository root on your own computer, after `pnpm install` and `pnpm wrangler login`.

Production is the Worker `byd-manuals` (public site) plus `byd-manuals-admin` (admin), sharing the D1 database `byd-manuals` and the R2 bucket `byd-manuals`. Both are configured under `env.production` in `wrangler.jsonc` and `wrangler.admin.jsonc`.

> **Deploys happen only from GitHub Actions** (`.github/workflows/deploy-production.yml`). The workflow runs on any `v*` tag on `main`, including the phase tags such as `v0.3-phase3`, and waits for your approval. It refuses to run while any `REPLACE_WITH_*` value is left in either `env.production` block. So a phase tag pushed before this checklist is done shows a red "Deploy production" run and deploys nothing. Never run `wrangler deploy --env production` by hand.

## 1. GitHub: production environment (do this first)

- [ ] GitHub → the repository → **Settings → Environments → New environment** → name it `production`.
  - [ ] **Required reviewers**: add yourself. Every production deploy now waits for your click.
  - [ ] **Deployment branches and tags** → **Selected branches and tags** → **Add rule** → type **Tag** → pattern `v*`.
  - [ ] **Environment secrets**:
    - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare dashboard → Workers & Pages → Account ID, in the right sidebar.
    - `CLOUDFLARE_API_TOKEN`: dashboard → My Profile → API Tokens → **Create Token** → template **Edit Cloudflare Workers**. Then add the permission **Account → D1 → Edit**, and limit the token to your account.
- [ ] Check the guard. Tag any commit that is **not** on `main`, for example on a phase branch:
  ```sh
  git tag v0.0.0-guard-test origin/phase-3 && git push origin v0.0.0-guard-test
  ```
  In GitHub → Actions → **Deploy production**, the `verify` job fails at "Refuse tags that are not on main", and nothing asks for approval. Then delete the tag:
  ```sh
  git push origin :refs/tags/v0.0.0-guard-test && git tag -d v0.0.0-guard-test
  ```

## 2. Cloudflare: database and bucket

- [ ] Create the production database. Copy the `database_id` it prints.
  ```sh
  pnpm wrangler d1 create byd-manuals
  ```
- [ ] Paste that id in **both** files, replacing `REPLACE_WITH_PRODUCTION_D1_ID`: `wrangler.jsonc` → `env.production.d1_databases[0].database_id`, and the same field in `wrangler.admin.jsonc`.
- [ ] Create the production bucket:
  ```sh
  pnpm wrangler r2 bucket create byd-manuals
  ```
- [ ] Check the bucket is **private**. The manuals must only leave through `/d/<token>`.
  ```sh
  pnpm wrangler r2 bucket dev-url get byd-manuals   # must say the r2.dev URL is disabled
  pnpm wrangler r2 bucket domain list byd-manuals   # must list no custom domains
  ```
  If the r2.dev URL is enabled, run `pnpm wrangler r2 bucket dev-url disable byd-manuals`.

## 3. Cloudflare: Turnstile

- [ ] Dashboard → **Turnstile → Add widget**:
  - name `BYD Manuals`;
  - hostname `byd-manuals.<account>.workers.dev`, where `<account>` is your workers.dev subdomain from Workers & Pages → Settings;
  - widget mode **Managed**.
- [ ] Copy the **site key** into `wrangler.jsonc` → `env.production.vars.TURNSTILE_SITE_KEY`, replacing `REPLACE_WITH_PRODUCTION_TURNSTILE_SITE_KEY`.
- [ ] Keep the **secret key** for step 4. Don't put it in any file.

## 4. Cloudflare: secrets (new random values, never reused from staging)

The public Worker reads these secrets; the admin Worker needs none. If wrangler asks to create the `byd-manuals` Worker, answer yes.

- [ ] **Webhook secret.** The phone also needs this value, so save it in your password manager first:
  ```sh
  openssl rand -hex 32                                       # copy the output to your password manager
  pnpm wrangler secret put WEBHOOK_SECRET --env production   # paste the same value
  ```
- [ ] **Ticket secret.** Nobody needs to know this one:
  ```sh
  openssl rand -base64 48 | pnpm wrangler secret put TICKET_SECRET --env production
  ```
- [ ] **Turnstile secret**, from step 3:
  ```sh
  pnpm wrangler secret put TURNSTILE_SECRET_KEY --env production
  ```
- [ ] Check the list. It must show exactly these three; `ADMIN_DEV_BYPASS` must **not** be there.
  ```sh
  pnpm wrangler secret list --env production
  ```

## 5. Production vars, in both config files

Edit the `env.production.vars` block of **both** `wrangler.jsonc` and `wrangler.admin.jsonc`. Bindings and vars are not inherited between environments.

- [ ] `TELEBIRR_PHONE` is `0977328406`.
- [ ] `TELEBIRR_NAME` is `Dawit As****`, **exactly** as telebirr shows the name to a payer. Ask a friend to start a transfer to the number and read the name off their screen.
- [ ] `SUPPORT_CONTACT` is a mailbox you read. Send a test email to it and confirm it arrives.
- [ ] `PUBLIC_SITE_URL` (admin file) is `https://byd-manuals.<account>.workers.dev`.
- [ ] `ADMIN_EMAIL` (admin file) is the email you will log in with.
- [ ] `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (admin file) come in step 7. Leave the placeholders for now.
- [ ] Run `pnpm cf-typegen`, so `worker-configuration.d.ts` matches the new values.
- [ ] Open a PR with these edits into the current phase branch, as with any task, and let CI pass.

## 6. First deploy

The deploy guard refuses any `REPLACE_WITH_*` left in production, and step 7 needs the admin Worker to exist first. So the first deploy uses a temporary Access value:

- [ ] In `wrangler.admin.jsonc` → `env.production.vars`:
  - set `ACCESS_TEAM_DOMAIN` to `https://pending.cloudflareaccess.com`;
  - set `ACCESS_AUD` to `pending`.

  No Access login can match these values, so the admin Worker answers **403 to every request**, which is safe.
- [ ] Merge to `main` (phase close-out, `docs/WORKFLOW.md` step 5). Then tag and push:
  ```sh
  git checkout main && git pull
  git tag v1.0.0-rc1 && git push origin v1.0.0-rc1
  ```
- [ ] GitHub → Actions → **Deploy production**: `verify` passes, then `deploy` waits. Click **Review deployments → Approve**.
- [ ] Check the deploy:
  - `https://byd-manuals.<account>.workers.dev/healthz` returns `{"ok":true,"env":"production"}`;
  - `https://byd-manuals-admin.<account>.workers.dev/admin` returns **403** until step 7.

## 7. Cloudflare Access on the admin Worker only

- [ ] Dashboard → **Workers & Pages → byd-manuals-admin → Settings → Domains & Routes → workers.dev** → **Enable Cloudflare Access**.
- [ ] **Manage Cloudflare Access** → edit the application's policy:
  - Action: Allow;
  - Include → **Emails** → your email only;
  - remove any other rule.
- [ ] On the same application page, copy the **Application Audience (AUD) Tag**. In Zero Trust → Settings → **Team domain**, copy your team domain (`https://<team>.cloudflareaccess.com`).
- [ ] Put both into `wrangler.admin.jsonc` → `env.production.vars` (`ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`). Merge to `main`, then tag `v1.0.0-rc2`, push it, and approve the deploy.
- [ ] Open `https://byd-manuals-admin.<account>.workers.dev/admin` in a private window:
  - Cloudflare asks for your email and a code;
  - after logging in you see the dashboard;
  - a different email is refused.
- [ ] Check the **public** Worker has Access **off**. Workers & Pages → **byd-manuals** → Settings → Domains & Routes → workers.dev must show Access disabled. Opening `https://byd-manuals.<account>.workers.dev/` must show the catalog with no login. Access on the public Worker would block buyers and the SMS webhook.

## 8. Limits and alerts

- [ ] Re-check the free-plan limits against `docs/prd.md` §4 (PRD risk 11) on these pages:
  - https://developers.cloudflare.com/workers/platform/limits/ : requests per day, CPU time, upload size of 100 MB or more;
  - https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/platform/pricing/ : rows read and written per day;
  - https://developers.cloudflare.com/r2/pricing/ : 10 GB free storage.

  Write down anything that changed and tell the developer.
- [ ] Set up usage alerts at 80% of the free limits: dashboard → **Notifications → Add**. Add each Workers, D1 and R2 usage notification your plan offers, with your email.
- [ ] If your plan doesn't offer a usage notification for one of them, add a weekly calendar reminder instead. Check Workers & Pages → byd-manuals → Metrics, D1 → byd-manuals → Metrics, and R2 → byd-manuals → Metrics.

## 9. Optional, later: custom domain

The site works on `workers.dev`. If you want your own domain later:

- [ ] Buy it on Cloudflare: dashboard → **Domain Registration → Register Domains**.
- [ ] Workers & Pages → **byd-manuals** → Settings → Domains & Routes → **Add → Custom Domain** → for example `manuals.<your-domain>`.
- [ ] Turnstile → the BYD Manuals widget → **Hostnames → Add** the new domain.
- [ ] Update the URLs, replacing the workers.dev address:
  - the SMS forwarder URL and the MacroDroid URL on the phone (`docs/phone-setup.md`);
  - `PUBLIC_SITE_URL` in `wrangler.admin.jsonc`, then deploy.
- [ ] The admin Worker stays on `workers.dev` behind Access. Don't give it the custom domain.

## 10. Content

- [ ] In the production admin, go to **Catalog** and upload the real **BYD E2** and **BYD Sealion** English PDFs. Each must be under 100 MB. Add their car photos too.
- [ ] Check each price, which is 500 ETB unless decided otherwise, and that each model shows on the public catalog with **Get manual**.
- [ ] Hide every model that has no PDF yet, or leave it as **Coming soon** on purpose.

## 11. Phone

- [ ] Follow `docs/phone-setup.md` with the **production** URLs and the production `WEBHOOK_SECRET` from step 4:
  - SMS forwarder → `https://byd-manuals.<account>.workers.dev/api/sms-webhook`;
  - MacroDroid heartbeat → `https://byd-manuals.<account>.workers.dev/api/heartbeat`.
- [ ] Run the **48-hour soak test** (`docs/phone-setup.md` §4) against production:
  - the admin banner stays green the whole time;
  - every test transfer appears on **Admin → Payments** within a minute.

## 12. Gate: the buyer sees the same transaction number (PRD Q1b)

The whole claim flow depends on this. Don't go live until it passes.

- [ ] Admin → **Catalog → Add model**: name `Test product`, year `test`, price `1` ETB, visible.
- [ ] Upload any small PDF to it.
- [ ] From a **friend's** phone, they send **1 ETB** telebirr-to-telebirr to `0977328406`.
- [ ] Compare the transaction number in the **friend's** telebirr confirmation with the one in the **owner's** SMS. They must be identical.
- [ ] The friend opens `https://byd-manuals.<account>.workers.dev/m/<test-product-slug>` and enters their transaction number. They see **Payment confirmed**, and the PDF downloads.
- [ ] Admin → **Payments**: the 1 ETB payment shows as Claimed, with an auto order.
- [ ] Admin → Catalog → Test product → untick **Visible** → save.
- [ ] If the numbers differ, **stop**. Tell the developer before going live, because the claim flow needs a change.

## 13. Go live

- [ ] Admin → Catalog: every model that should be on sale is visible, has a PDF and the right price.
- [ ] Post the site link in 1–2 BYD Telegram groups (soft launch).
- [ ] Write down today's date. The **30-day review** is due on: ____________.
- [ ] For the 30-day review, pull these numbers. These are read-only queries, run from your computer:
  ```sh
  # Paid orders since launch (replace the date)
  pnpm wrangler d1 execute DB --env production --remote --command \
    "SELECT COUNT(*) AS orders FROM orders WHERE created_at >= strftime('%s','2026-11-01')*1000"
  # Auto vs admin orders
  pnpm wrangler d1 execute DB --env production --remote --command \
    "SELECT created_by, COUNT(*) AS n FROM orders GROUP BY created_by"
  # Average minutes from payment to claim
  pnpm wrangler d1 execute DB --env production --remote --command \
    "SELECT ROUND(AVG(claimed_at - paid_at) / 60000.0, 1) AS avg_minutes FROM payments WHERE status = 'claimed'"
  # Flagged payments and SMS that matched no pattern
  pnpm wrangler d1 execute DB --env production --remote --command \
    "SELECT (SELECT COUNT(*) FROM payments WHERE status = 'flagged') AS flagged, (SELECT COUNT(*) FROM raw_sms WHERE parse_status = 'failed') AS failed_sms"
  ```
  Support requests: count the emails to `SUPPORT_CONTACT` and the Telegram messages about the site.
