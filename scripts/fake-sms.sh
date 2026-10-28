#!/usr/bin/env bash
# Plays the owner's phone: posts a telebirr-style SMS to the webhook.
# Usage: scripts/fake-sms.sh <local|staging> <TXN> <AMOUNT_ETB> [sender=127] [kind=payment|bank]
# Never targets production.
set -euo pipefail

usage() {
  echo "Usage: $0 <local|staging> <TXN> <AMOUNT_ETB> [sender=127] [kind=payment|bank]" >&2
  exit 1
}

[[ $# -ge 3 ]] || usage
env="$1"
txn="$2"
amount="$3"
sender="${4:-127}"
kind="${5:-payment}"
root="$(cd "$(dirname "$0")/.." && pwd)"

case "$env" in
  local)
    base="http://localhost:8787"
    if [[ -z "${WEBHOOK_SECRET:-}" && -f "$root/.dev.vars" ]]; then
      WEBHOOK_SECRET="$(sed -n 's/^WEBHOOK_SECRET=//p' "$root/.dev.vars" | tr -d '"\r')"
    fi
    ;;
  staging)
    base="${STAGING_URL:?Set STAGING_URL to the staging Worker URL}"
    ;;
  *)
    echo "fake-sms: refusing env '$env'. Use local or staging (never production)." >&2
    exit 1
    ;;
esac
: "${WEBHOOK_SECRET:?Set WEBHOOK_SECRET (local: or put it in .dev.vars)}"

if ! [[ "$amount" =~ ^[0-9]+(\.[0-9]{1,2})?$ ]]; then
  echo "fake-sms: AMOUNT_ETB must be a number like 500 or 500.50" >&2
  exit 1
fi
amount_fmt="$(printf '%.2f' "$amount")"
when="$(TZ=Africa/Addis_Ababa date +'%d/%m/%Y %H:%M:%S')"

case "$kind" in
  payment)
    body="Dear Customer You have received ETB ${amount_fmt} from Demo Buyer(2519****9999) on ${when}. Your transaction number is ${txn}. Your current E-Money Account balance is ETB 1,250.00. Thank you for using telebirr"
    ;;
  bank)
    body="Dear Customer You have received ETB ${amount_fmt} from Commercial Bank of Ethiopia on ${when} by transaction number ${txn}. Your current E-Money Account balance is ETB 1,250.00. Thank you for using telebirr"
    ;;
  *)
    echo "fake-sms: kind must be payment or bank" >&2
    exit 1
    ;;
esac

# Build the JSON with node so quotes or backslashes in the inputs can't break it.
payload="$(FROM="$sender" BODY="$body" node -e \
  'process.stdout.write(JSON.stringify({from: process.env.FROM, body: process.env.BODY, receivedAt: String(Date.now())}))')"

curl -sS -X POST "${base%/}/api/sms-webhook" \
  -H "X-Webhook-Secret: ${WEBHOOK_SECRET}" \
  -H "content-type: application/json" \
  --data "$payload" \
  -w '\nHTTP %{http_code}\n'
