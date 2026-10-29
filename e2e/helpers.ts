import {
  type APIRequestContext,
  expect,
  type Page,
  type Response,
  request,
} from "@playwright/test";

export const BASE_URL = "http://localhost:8787";
const WEBHOOK_SECRET = "dev-webhook-secret";

/** Current time in Ethiopia (UTC+3) as telebirr writes it: DD/MM/YYYY HH:mm:ss. */
export function eatNow(): string {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** A fresh, valid transaction number that no seed or earlier run uses. */
export function freshTxn(prefix: string): string {
  const random = Math.random()
    .toString(36)
    .slice(2)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return `${prefix}${random}0000000000`.slice(0, 10);
}

/** Posts an SMS to the webhook, like scripts/fake-sms.sh does. Returns the `result`. */
export async function postSms({
  txn,
  amountEtb,
  sender = "127",
  kind = "payment",
}: {
  txn: string;
  amountEtb: number;
  sender?: string;
  kind?: "payment" | "bank";
}): Promise<string> {
  const amount = amountEtb.toFixed(2);
  const body =
    kind === "payment"
      ? `Dear Customer You have received ETB ${amount} from Demo Buyer(2519****9999) on ${eatNow()}. Your transaction number is ${txn}. Your current E-Money Account balance is ETB 1,250.00. Thank you for using telebirr`
      : `Dear Customer You have received ETB ${amount} from Commercial Bank of Ethiopia on ${eatNow()} by transaction number ${txn}. Your current E-Money Account balance is ETB 1,250.00. Thank you for using telebirr`;
  const api = await request.newContext({ baseURL: BASE_URL });
  try {
    const res = await api.post("/api/sms-webhook", {
      headers: { "X-Webhook-Secret": WEBHOOK_SECRET },
      data: { from: sender, body, receivedAt: String(Date.now()) },
    });
    expect(res.status()).toBe(200);
    return ((await res.json()) as { result: string }).result;
  } finally {
    await api.dispose();
  }
}

/** Opens a checkout page and submits a transaction number in the claim form. */
export async function claimOnPage(page: Page, slug: string, txn: string): Promise<void> {
  await page.goto(`/m/${slug}`);
  await page.locator("#txn").fill(txn);
  await page.getByRole("button", { name: "Get my PDF" }).click();
}

/** The id of a model's visible `en` version, from the public API. */
export async function versionIdFor(api: APIRequestContext, slug: string): Promise<number> {
  const res = await api.get("/api/models");
  const models = (await res.json()) as Array<{ slug: string; versions: Array<{ id: number }> }>;
  const id = models.find((m) => m.slug === slug)?.versions[0]?.id;
  if (id === undefined) throw new Error(`No version for ${slug}`);
  return id;
}

/** Posts a phone heartbeat (MacroDroid's 30-minute ping, docs/phone-setup.md). */
export async function postHeartbeat(battery?: number): Promise<void> {
  const api = await request.newContext({ baseURL: BASE_URL });
  try {
    const res = await api.post("/api/heartbeat", {
      headers: { "X-Webhook-Secret": WEBHOOK_SECRET },
      data: battery === undefined ? {} : { battery },
    });
    expect(res.status()).toBe(200);
  } finally {
    await api.dispose();
  }
}

/**
 * Picks a file in an admin upload control (public/js/admin-upload.js PUTs it straight away) and
 * returns the upload's response. On success the page reloads itself; assert on the reloaded page.
 */
export async function uploadFile(page: Page, selector: string, path: string): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/uploads/")),
    page.locator(selector).setInputFiles(path),
  ]);
  return response;
}
