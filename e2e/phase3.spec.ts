// One test per step of docs/phases/phase-3-demo.md. Turnstile runs for real with the test keys
// (site key 1x00000000000000000000AA, secret 1x0000000000000000000000000000000AA), which always
// pass, so the widget, its script under our CSP and the server-side siteverify are all exercised.
import { readFileSync } from "node:fs";
import { type APIResponse, expect, type Page, test } from "@playwright/test";
import { ADMIN_URL } from "../playwright.config";
import {
  CLIENT_IP_HEADER,
  submitClaim,
  TEST_TURNSTILE_TOKEN,
  useUniqueClientIp,
  versionIdFor,
  waitForTurnstile,
} from "./helpers";

const SEALION = "byd-sealion-2026";
/** Seeded with 9 claim attempts in the last 5 minutes (scripts/seed.ts phase3Launch). */
const RATE_LIMIT_DEMO_IP = "203.0.113.7";

useUniqueClientIp(test);

/** The two download-ready messages after a successful claim. */
async function expectConfirmed(page: Page) {
  await expect(page.getByText("Payment confirmed")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
}

function expectSecurityHeaders(res: APIResponse) {
  const headers = res.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("https://challenges.cloudflare.com");
  expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBeTruthy();
  expect(headers["permissions-policy"]).toContain("camera=()");
  // Local dev is not production, so every page is noindex (like staging).
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
}

test("step 1: the Turnstile check appears under the form and enables Get my PDF", async ({
  page,
}) => {
  await page.goto(`/m/${SEALION}`);
  await waitForTurnstile(page);
  // The widget renders inside the slot under the form (its iframe may sit in a shadow root).
  const slot = page.locator("#turnstile-slot");
  await expect(slot).toBeVisible();
  expect(await slot.evaluate((el) => el.childElementCount)).toBeGreaterThan(0);
  expect((await slot.boundingBox())?.height ?? 0).toBeGreaterThan(0);
});

test("step 2: a paid number succeeds; after a failed try the check refreshes and works again", async ({
  page,
}) => {
  await page.goto(`/m/${SEALION}`);
  await submitClaim(page, "DEMOPAY001");
  await expectConfirmed(page);

  // Back to the form with another number: a used one fails, then a fresh token lets a paid one in.
  await page.goto(`/m/${SEALION}`);
  const claims: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/claim") {
      claims.push((req.postDataJSON() as { turnstileToken: string }).turnstileToken);
    }
  });
  await submitClaim(page, "DEMOUSED01");
  await expect(page.getByRole("alert")).toContainText(
    "This transaction number has already been used.",
  );
  await submitClaim(page, "DEMOPAY005");
  await expectConfirmed(page);
  expect(claims).toHaveLength(2);
  for (const token of claims) expect(token).toBeTruthy();
});

test("step 3: repeated tries from one address end in RATE_LIMITED", async ({ request }) => {
  const versionId = await versionIdFor(request, SEALION);
  const guess = async () => {
    const res = await request.post("/api/claim", {
      headers: { [CLIENT_IP_HEADER]: RATE_LIMIT_DEMO_IP },
      data: { transactionNumber: "GUESS00001", versionId, turnstileToken: TEST_TURNSTILE_TOKEN },
    });
    return { status: res.status(), code: ((await res.json()) as { code?: string }).code };
  };

  // The seed gives this address 9 attempts in the 5 minutes before seeding, so on a fresh seed the
  // 2nd try here is the 11th in the 10-minute window and is refused (demo step 3). Those rows age
  // out from 5 minutes after seeding, so a slower run needs more tries; the limit is 10 either way.
  const tries: Array<{ status: number; code?: string }> = [];
  while (tries.length < 11) {
    const result = await guess();
    tries.push(result);
    if (result.status === 429) break;
    expect(result.code).not.toBe("RATE_LIMITED");
  }
  expect(tries.at(-1)).toEqual({ status: 429, code: "RATE_LIMITED" });
  test
    .info()
    .annotations.push({ type: "tries until RATE_LIMITED", description: `${tries.length}` });
});

test("step 4: pages send security headers, and checkout has no CSP errors", async ({
  page,
  request,
}) => {
  for (const url of ["/", `/m/${SEALION}`, `${ADMIN_URL}/admin`]) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(200);
    expectSecurityHeaders(res);
  }

  // The Turnstile script and iframe load under the CSP without any violation.
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to (load|execute|frame|connect|apply)/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  await page.goto(`/m/${SEALION}`);
  await waitForTurnstile(page);
  expect(violations).toEqual([]);
});

test("step 5: robots.txt disallows the admin, download and API paths", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const text = await res.text();
  for (const path of ["/admin", "/d/", "/api/"]) expect(text).toContain(`Disallow: ${path}`);
});

test("step 6: an unknown page shows a friendly page not found", async ({ page }) => {
  const res = await page.goto("/nothing-here");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Page not found");
  await expect(page.locator('a[href="/"]').first()).toBeVisible();
});

test("step 7: the 1 ETB Test product claims DEMOONE001 and downloads", async ({ page }) => {
  await page.goto("/");
  const card = page.locator(".model-card").filter({ hasText: "Test product" });
  await expect(card).toContainText("1 ETB");
  await card.getByRole("link", { name: "Get manual" }).click();
  await expect(page).toHaveURL("/m/test-product");

  await submitClaim(page, "DEMOONE001");
  await expectConfirmed(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("BYD-Test-product-EN.pdf");
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe("%PDF-");
});

test("step 8: the launch checklist and runbook are in the repository", () => {
  const checklist = readFileSync("docs/launch-checklist.md", "utf8");
  expect(checklist).toContain("1 ETB");
  expect(checklist).toMatch(/- \[ \]/); // ordered checkboxes
  const runbook = readFileSync("docs/runbook.md", "utf8");
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8])
    expect(runbook).toMatch(new RegExp(`^## ${n}\\. `, "m"));
});
