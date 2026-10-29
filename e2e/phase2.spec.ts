// One test per step of docs/phases/phase-2-demo.md, against the admin Worker (:8788, dev bypass
// instead of Cloudflare Access) and the public site (:8787) on the same local D1/R2.
//
// The Phase 1 spec runs in parallel on the same database, so these tests never change seeded
// models (Sealion, E2): catalog steps create their own uniquely named model, and link steps work
// with links they created themselves. Seeded payments are only read, except DEMOFLAG01 (step 11).
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { ADMIN_URL } from "../playwright.config";
import { postHeartbeat, uploadFile, useUniqueClientIp } from "./helpers";

const FIXTURES = "e2e/fixtures";
const TINY_PDF = `${FIXTURES}/tiny.pdf`;
const NOT_A_PDF = `${FIXTURES}/not-a-pdf.pdf`;
const CAR_PNG = `${FIXTURES}/car.png`;

const admin = (path: string) => `${ADMIN_URL}${path}`;

// No claims here, but public pages visited from this file still get their own client IP.
useUniqueClientIp(test);

/** A model name no other test or earlier run uses. */
function uniqueName(base: string): string {
  return `${base} ${Math.random().toString(36).slice(2, 7)}`;
}

/** Adds a model through Catalog → Add model. Returns its admin id and generated slug. */
async function createModel(page: Page, name: string, priceEtb: string) {
  await page.goto(admin("/admin/catalog/new"));
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Model year").fill("2025");
  await page.getByLabel("Price (ETB)").fill(priceEtb);
  await page.getByRole("button", { name: "Create model" }).click();
  await expect(page).toHaveURL(admin("/admin/catalog?created=1"));
  await expect(page.getByText("Model created.")).toBeVisible();
  const row = page.locator(".admin-table tbody tr").filter({ hasText: name });
  const slug = (await row.locator(".admin-slug").textContent())?.trim() ?? "";
  const href = (await row.getByRole("link", { name: "Edit" }).getAttribute("href")) ?? "";
  const id = Number(href.split("/").pop());
  expect(id).toBeGreaterThan(0);
  return { id, slug };
}

/** Uploads the tiny PDF on the model's edit page and waits for the reloaded page. */
async function uploadPdf(page: Page, id: number) {
  await page.goto(admin(`/admin/catalog/${id}`));
  const res = await uploadFile(page, "#upload-pdf", TINY_PDF);
  expect(res.status()).toBe(200);
  await expect(page.getByText(/Current: .+\.pdf/)).toBeVisible();
}

/** The public catalog card for a model. */
async function publicCard(page: Page, name: string) {
  await page.goto("/");
  return page.locator(".model-card").filter({ hasText: name });
}

/** Ticks the confirm box, submits, and returns the link from the "shown only once" page. */
async function submitAndReadLink(page: Page, button: string) {
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: button }).click();
  await expect(page.getByText("This link is shown only once.")).toBeVisible();
  await expect(page.getByText("Send it to the buyer now (Telegram/SMS).")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  const url = await page.locator("#download-url").inputValue();
  expect(url).toMatch(/^http:\/\/localhost:8787\/d\/[A-Za-z0-9_-]{43}$/);
  const orderText = (await page.getByText(/^Order #\d+\./).textContent()) ?? "";
  return { url, orderId: Number(/#(\d+)/.exec(orderText)?.[1]) };
}

async function expectPdf(request: APIRequestContext, url: string) {
  const res = await request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect((await res.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
}

/** Picks the version option whose label starts with a model's name and year. */
async function chooseManual(page: Page, modelAndYear: string) {
  const option = page.locator("#versionId option").filter({ hasText: modelAndYear });
  await page.locator("#versionId").selectOption((await option.first().getAttribute("value")) ?? "");
}

test("step 1: the dashboard shows counts and the green Phone online banner", async ({ page }) => {
  await page.goto(admin("/admin"));
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // The seed's check-in is 10 minutes old, so this holds for 35 minutes after seeding.
  await expect(page.locator("#status-banner")).toContainText("Phone online");
  await expect(page.locator("#status-banner")).toContainText("battery");
  for (const label of [
    "Payments received",
    "Claimed",
    "Unclaimed",
    "Flagged",
    "Orders",
    "Failed SMS",
  ]) {
    const allTime = page
      .locator("tr")
      .filter({ has: page.getByRole("rowheader", { name: label }) });
    await expect(allTime.locator("td").nth(1)).not.toHaveText("0");
  }
});

test("step 2: Add model creates it, and the public site shows Coming soon", async ({ page }) => {
  const name = uniqueName("BYD Atto 3");
  await createModel(page, name, "450");
  const card = await publicCard(page, name);
  await expect(card).toContainText("Coming soon");
  await expect(card.getByRole("link")).toHaveCount(0);
});

test("step 3: changing the price changes the public checkout price", async ({ page }) => {
  const name = uniqueName("BYD Price");
  const { id, slug } = await createModel(page, name, "500");
  await uploadPdf(page, id);

  for (const price of ["600", "500"]) {
    await page.goto(admin(`/admin/catalog/${id}`));
    await page.getByLabel("Price (ETB)").fill(price);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await page.goto(`/m/${slug}`);
    await expect(page.locator(".price-card")).toContainText(`${price} ETB`);
  }
});

test("step 4: uploading a PDF makes the model buyable on the public catalog", async ({ page }) => {
  const name = uniqueName("BYD Atto 3");
  const { id, slug } = await createModel(page, name, "450");
  await page.goto(admin(`/admin/catalog/${id}`));
  await expect(page.getByText("No PDF yet.")).toBeVisible();

  const res = await uploadFile(page, "#upload-pdf", TINY_PDF);
  expect(res.status()).toBe(200);
  await expect(page.getByText(/Current: .+\.pdf/)).toBeVisible();
  await expect(page.getByText("PDF: uploaded")).toBeVisible();

  const card = await publicCard(page, name);
  await expect(card).toContainText("450 ETB");
  await card.getByRole("link", { name: "Get manual" }).click();
  await expect(page).toHaveURL(`/m/${slug}`);
  await expect(page.locator(".price-card")).toContainText("450 ETB");
});

test("step 5: an uploaded car photo appears on the public catalog card", async ({
  page,
  request,
}) => {
  const name = uniqueName("BYD Photo");
  const { id } = await createModel(page, name, "450");
  await page.goto(admin(`/admin/catalog/${id}`));
  const res = await uploadFile(page, "#upload-image", CAR_PNG);
  expect(res.status()).toBe(200);
  await expect(page.getByText(/Current: .+\.png/)).toBeVisible();

  const card = await publicCard(page, name);
  const src = (await card.locator("img").getAttribute("src")) ?? "";
  expect(src).toMatch(/^\/media\/images\/.+\.png$/);
  const image = await request.get(src);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
});

test("step 6: a text file renamed to .pdf is rejected and nothing changes", async ({ page }) => {
  const name = uniqueName("BYD Fake");
  const { id } = await createModel(page, name, "450");
  await page.goto(admin(`/admin/catalog/${id}`));

  const res = await uploadFile(page, "#upload-pdf", NOT_A_PDF);
  expect(res.status()).toBe(400);
  await expect(page.locator(".admin-upload__status").first()).toHaveText("This file is not a PDF.");
  await page.reload();
  await expect(page.getByText("No PDF yet.")).toBeVisible();
  await expect(await publicCard(page, name)).toContainText("Coming soon");
});

test("step 7: unticking Visible hides the model from the public site", async ({ page }) => {
  const name = uniqueName("BYD Hidden");
  const { id, slug } = await createModel(page, name, "450");
  await uploadPdf(page, id);

  const setVisible = async (visible: boolean) => {
    await page.goto(admin(`/admin/catalog/${id}`));
    await page.getByLabel("Model visible on the public site").setChecked(visible);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
  };

  await setVisible(false);
  await expect(await publicCard(page, name)).toHaveCount(0);
  expect((await page.goto(`/m/${slug}`))?.status()).toBe(404);

  await setVisible(true);
  await expect(await publicCard(page, name)).toContainText("450 ETB");
});

test("step 8: each Payments tab shows only matching payments, with payer and phone", async ({
  page,
}) => {
  const cases: [string, string, string][] = [
    ["Unclaimed", "unclaimed", "DEMOPAY001"],
    ["Claimed", "claimed", "DEMOHIST01"],
    ["Flagged", "flagged", ""],
  ];
  for (const [label, status, txn] of cases) {
    await page.goto(admin("/admin/payments"));
    await page
      .getByRole("navigation", { name: "Payment status" })
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(page).toHaveURL(admin(`/admin/payments?status=${status}`));
    const rows = page.locator(".admin-table tbody tr");
    await expect(rows.first()).toBeVisible();
    // The status column (the 5th td) of every row matches the tab.
    for (const cell of await rows.locator("td:nth-of-type(5)").allTextContents()) {
      expect(cell).toBe(label);
    }
    if (txn) await expect(rows.filter({ hasText: txn })).toHaveCount(1);
  }
  await page.goto(admin("/admin/payments?status=claimed"));
  const row = page.locator(".admin-table tbody tr").filter({ hasText: "DEMOHIST01" });
  await expect(row).toContainText(/Demo Buyer \d+/);
  await expect(row).toContainText(/2519\*{4}\d{4}/);
});

test("step 9: a payment shows its SMS with the balance hidden, and its order and link", async ({
  page,
}) => {
  await page.goto(admin("/admin/payments?status=claimed"));
  await page
    .locator(".admin-table tbody tr")
    .filter({ hasText: "DEMOHIST01" })
    .getByRole("link", { name: "View" })
    .click();
  await expect(page.getByRole("heading", { name: "Payment DEMOHIST01" })).toBeVisible();
  const sms = page.locator(".admin-sms-body");
  await expect(sms).toContainText("Your transaction number is DEMOHIST01");
  await expect(sms).toContainText("balance is ETB [redacted]");
  await expect(page.locator("main")).not.toContainText("1,250.00");
  await expect(page.locator("main")).toContainText("1/3 downloads");
  await expect(page.locator("main")).toContainText("Active");
});

test("step 10: the SMS page lists failed and ignored messages", async ({ page }) => {
  await page.goto(admin("/admin/payments/sms?status=failed"));
  const body = page.locator(".admin-table");
  await expect(body).toContainText("Demo garbage message that matches no telebirr pattern.");
  await expect(body).toContainText("You have won a prize");
  await expect(body).not.toContainText("Commercial Bank");

  await page
    .getByRole("navigation", { name: "SMS status" })
    .getByRole("link", { name: "Ignored", exact: true })
    .click();
  await expect(body).toContainText("Commercial Bank of Ethiopia");
  await expect(body).toContainText("bank-deposit-v1");
  await expect(body).toContainText("airtime-v1");
  await expect(body).not.toContainText("2,250.00");
});

test("step 11: approving flagged DEMOFLAG01 for Sealion gives a link that downloads", async ({
  page,
  request,
}) => {
  await page.goto(admin("/admin/payments?status=flagged"));
  await page
    .locator(".admin-table tbody tr")
    .filter({ hasText: "DEMOFLAG01" })
    .getByRole("link", { name: "View" })
    .click();
  await expect(page.locator("main")).toContainText("300 ETB");
  await chooseManual(page, "BYD Sealion 2026");
  await page.getByLabel("Note (required)").fill("paid the rest in cash");
  const { url } = await submitAndReadLink(page, "Approve and create link");
  await expectPdf(request, url);

  await page.goto(admin("/admin/payments?status=claimed"));
  await expect(page.locator(".admin-table")).toContainText("DEMOFLAG01");
});

test("step 12: Approve without a payment creates a manual order with a working link", async ({
  page,
  request,
}) => {
  await page.goto(admin("/admin/payments/orders"));
  await page.getByRole("link", { name: "Approve without a payment" }).click();
  await expect(page).toHaveURL(admin("/admin/orders/manual"));
  await chooseManual(page, "BYD E2 2025");
  await page.getByLabel("Note (required)").fill("paid from bank app, checked statement");
  const { url, orderId } = await submitAndReadLink(page, "Create order and link");
  await expectPdf(request, url);

  await page.goto(admin("/admin/payments/orders"));
  const row = page
    .locator(".admin-table tbody tr")
    .filter({ has: page.locator(`a[href="/admin/orders/${orderId}/regenerate"]`) });
  await expect(row).toContainText("manual");
  await expect(row).toContainText("BYD E2 2025");
});

test("step 13: New link stops the old link (410) and the new one downloads", async ({
  page,
  request,
}) => {
  await page.goto(admin("/admin/orders/manual"));
  await chooseManual(page, "BYD E2 2025");
  await page.getByLabel("Note (required)").fill("E2E: order for the new-link step");
  const first = await submitAndReadLink(page, "Create order and link");
  await expectPdf(request, first.url);

  await page.goto(admin("/admin/payments/orders"));
  await page.locator(`a[href="/admin/orders/${first.orderId}/regenerate"]`).click();
  await page.getByLabel("Note (required)").fill("buyer lost the file");
  const second = await submitAndReadLink(page, "Create new link");
  expect(second.orderId).toBe(first.orderId);
  expect(second.url).not.toBe(first.url);

  const old = await request.get(first.url);
  expect(old.status()).toBe(410);
  expect(await old.text()).toContain("This download link has expired");
  await expectPdf(request, second.url);
});

test("step 14: a heartbeat shows 'last check-in less than a minute ago'", async ({ page }) => {
  await postHeartbeat(55);
  await page.goto(admin("/admin"));
  const banner = page.locator("#status-banner");
  await expect(banner).toContainText("Phone online");
  await expect(banner).toContainText("last check-in less than a minute ago");
  await expect(banner).toContainText("battery 55%");
});
