// One test per step of docs/phases/phase-1-demo.md. Each test uses its own seeded or fresh
// transaction number, so the tests don't depend on each other's state.
import { expect, test } from "@playwright/test";
import {
  CLIENT_IP_HEADER,
  claimOnPage,
  freshTxn,
  postSms,
  TEST_TURNSTILE_TOKEN,
  useUniqueClientIp,
  versionIdFor,
} from "./helpers";

const SEALION = "byd-sealion-2026";
// Its own rate-limit bucket: this file makes 8 claims, and other specs make more (Phase 3).
const clientIp = useUniqueClientIp(test);

test("step 1: catalog lists the models, prices and Coming soon", async ({ page }) => {
  await page.goto("/");
  const card = (name: string) => page.locator(".model-card").filter({ hasText: name });

  for (const name of ["BYD E2", "BYD Sealion"]) {
    await expect(card(name)).toContainText("500 ETB");
    await expect(card(name).getByRole("link", { name: "Get manual" })).toBeVisible();
  }
  await expect(card("BYD Dolphin")).toContainText("Coming soon");
  await expect(card("BYD Dolphin").getByRole("link")).toHaveCount(0);
  await expect(page.locator('a[href="/m/byd-dolphin-2025"]')).toHaveCount(0);
  await expect(page.getByText("BYD Han")).toHaveCount(0);
});

test("step 2: checkout shows price, phone, name, steps and the telebirr-only notice", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator(".model-card")
    .filter({ hasText: "BYD Sealion" })
    .getByRole("link", { name: "Get manual" })
    .click();
  await expect(page).toHaveURL(`/m/${SEALION}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("BYD Sealion (2026)");
  await expect(page.locator(".price-card")).toContainText("500 ETB");
  await expect(page.locator(".phone-box__number")).toHaveText("0900 000 000");
  await expect(page.locator(".phone-box__name")).toContainText("Test Account");
  await expect(page.locator(".steps > li")).toHaveCount(4);
  await expect(page.getByText("telebirr to telebirr only.")).toBeVisible();
  await expect(page.locator("#txn-hint")).toContainText(
    "starts with D and has 10 letters and numbers",
  );
});

test("step 3: a paid number (lowercase, with a space) shows Payment confirmed", async ({
  page,
}) => {
  await claimOnPage(page, SEALION, "demopay 002");
  await expect(page.locator("#txn")).toHaveValue("DEMOPAY002");
  await expect(page.getByText("Payment confirmed")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
  await expect(page.getByText("Save the PDF to your phone now.")).toBeVisible();
});

test("step 4: Download PDF downloads BYD-Sealion-2026-EN.pdf", async ({ page }) => {
  await claimOnPage(page, SEALION, "DEMOPAY003");
  const link = page.getByRole("link", { name: "Download PDF" });
  await expect(link).toBeVisible({ timeout: 10_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("BYD-Sealion-2026-EN.pdf");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const pdf = Buffer.concat(chunks);
  expect(pdf.byteLength).toBeGreaterThan(0);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
});

test("step 5: an already used number says so", async ({ page }) => {
  await claimOnPage(page, SEALION, "DEMOUSED01");
  await expect(page.getByRole("alert")).toContainText(
    "This transaction number has already been used.",
  );
});

test("step 6: an underpaid number shows the amount too low message", async ({ page }) => {
  await claimOnPage(page, SEALION, "DEMOLOW001");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Amount too low");
  await expect(alert).toContainText("We received less than 500 ETB");
});

test("step 7: a malformed number shows the format message without calling the server", async ({
  page,
}) => {
  const claimRequests: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/claim")) claimRequests.push(req.url());
  });
  await claimOnPage(page, SEALION, "ABC");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Check the number");
  await expect(alert).toContainText("10 letters and numbers");
  expect(claimRequests).toEqual([]);
});

test("step 8: waiting switches to Payment confirmed when the SMS arrives", async ({ page }) => {
  const txn = freshTxn("NEW");
  await claimOnPage(page, SEALION, txn);
  await expect(page.getByText("Waiting for telebirr confirmation")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".txn-pill")).toContainText(txn);
  expect(await postSms({ txn, amountEtb: 500 })).toBe("stored");
  await expect(page.getByText("Payment confirmed")).toBeVisible({ timeout: 15_000 });
});

test("step 9: the same SMS twice is stored once, then reported as a duplicate", async () => {
  const txn = freshTxn("DUP");
  expect(await postSms({ txn, amountEtb: 500 })).toBe("stored");
  expect(await postSms({ txn, amountEtb: 500 })).toBe("duplicate");
});

test("step 10: a payment older than 7 days is refused", async ({ page }) => {
  await claimOnPage(page, SEALION, "DEMOOLD001");
  await expect(page.getByRole("alert")).toContainText("This payment is older than 7 days.");
});

test("step 11: a download link works 3 times, then returns 410", async ({ request }) => {
  const versionId = await versionIdFor(request, SEALION);
  const claim = await request.post("/api/claim", {
    headers: { [CLIENT_IP_HEADER]: clientIp },
    data: { transactionNumber: "DEMOPAY004", versionId, turnstileToken: TEST_TURNSTILE_TOKEN },
  });
  const body = (await claim.json()) as { status: string; downloadUrl: string };
  expect(body.status).toBe("ok");
  const path = new URL(body.downloadUrl).pathname;

  for (let i = 1; i <= 3; i++) {
    const res = await request.get(path);
    expect(res.status(), `download ${i}`).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
  }
  const fourth = await request.get(path);
  expect(fourth.status()).toBe(410);
  expect(await fourth.text()).toContain("This download link has expired");
});

test("step 12: other senders are discarded; a bank deposit is ignored and can't be claimed", async ({
  page,
}) => {
  expect(await postSms({ txn: freshTxn("FAKE"), amountEtb: 500, sender: "8899" })).toBe(
    "discarded",
  );
  const bankTxn = freshTxn("BANK");
  expect(await postSms({ txn: bankTxn, amountEtb: 500, kind: "bank" })).toBe("ignored");

  await claimOnPage(page, SEALION, bankTxn);
  const waiting = page.getByText("Waiting for telebirr confirmation");
  await expect(waiting).toBeVisible({ timeout: 10_000 });
  // After the first poll the claim is still pending.
  const poll = await page.waitForResponse((res) => res.url().includes("/api/claim/status"), {
    timeout: 15_000,
  });
  expect(((await poll.json()) as { status: string }).status).toBe("pending");
  await expect(waiting).toBeVisible();
});
