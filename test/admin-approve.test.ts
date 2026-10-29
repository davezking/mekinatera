import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { approvePayment, claim, createOrder } from "../src/lib/claim";
import { MINUTE } from "../src/lib/time";
import { adminFetch, TEST_ACCESS } from "./helpers/admin";

const ORIGIN = "http://localhost";
const PDF = "%PDF-1.4\ndemo sealion\n%%EOF\n";

function post(path: string, fields: Record<string, string>, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (origin !== null) headers.Origin = origin;
  return adminFetch(path, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

/** The one link on a link-created page. */
function linkFrom(html: string): string {
  const match = new RegExp(`value="(${TEST_ACCESS.PUBLIC_SITE_URL}/d/[A-Za-z0-9_-]{43})"`).exec(
    html,
  );
  if (!match?.[1]) throw new Error("no download link in page");
  return match[1];
}

function download(url: string) {
  return SELF.fetch(url.replace(TEST_ACCESS.PUBLIC_SITE_URL, "https://example.com"));
}

async function one<T>(sql: string, ...params: unknown[]): Promise<T | null> {
  return env.DB.prepare(sql)
    .bind(...params)
    .first<T>();
}

async function count(sql: string, ...params: unknown[]): Promise<number> {
  return (await one<{ n: number }>(sql, ...params))?.n ?? -1;
}

let sealion: number;
let e2: number;
let hiddenNoPdf: number;
const ids: Record<string, number> = {};

beforeEach(async () => {
  const db = env.DB;
  await db.batch(
    [
      "download_tokens",
      "orders",
      "claim_attempts",
      "payments",
      "raw_sms",
      "manual_versions",
      "car_models",
    ].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
  const now = Date.now();
  const models: [string, string, string, string | null][] = [
    ["BYD Sealion", "byd-sealion-2026", "2026", "manuals/byd-sealion-2026-en-demo.pdf"],
    ["BYD E2", "byd-e2-2025", "2025", "manuals/byd-e2-2025-en-demo.pdf"],
    ["BYD Dolphin", "byd-dolphin-2025", "2025", null],
  ];
  for (const [i, [name, slug, year, key]] of models.entries()) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, 0, 0)`,
        )
        .bind(name, slug, year, i),
      db
        .prepare(
          `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, file_size, is_visible, created_at, updated_at)
           SELECT id, 'en', 50000, ?, ?, 1, 0, 0 FROM car_models WHERE slug = ?`,
        )
        .bind(key, key ? PDF.length : null, slug),
    ]);
    if (key) await env.MANUALS.put(key, PDF);
  }
  const version = async (slug: string) =>
    (
      await one<{ id: number }>(
        "SELECT v.id FROM manual_versions v JOIN car_models m ON m.id = v.car_model_id WHERE m.slug = ?",
        slug,
      )
    )?.id as number;
  sealion = await version("byd-sealion-2026");
  e2 = await version("byd-e2-2025");
  hiddenNoPdf = await version("byd-dolphin-2025");

  const payments: [string, number, string, string | null][] = [
    ["DEMOPAY001", 50000, "unclaimed", null],
    ["DEMOLOW001", 30000, "flagged", "amount_too_low"],
    ["DEMOUSED01", 50000, "claimed", null],
  ];
  for (const [txn, amount, status, reason] of payments) {
    await db
      .prepare(
        `INSERT INTO payments (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, status, flag_reason, created_at)
         VALUES (?, ?, 'Demo Buyer', '2519****0001', ?, ?, ?, ?)`,
      )
      .bind(txn, amount, now - 5 * MINUTE, status, reason, now)
      .run();
    ids[txn] = (
      await one<{ id: number }>("SELECT id FROM payments WHERE transaction_number = ?", txn)
    )?.id as number;
  }
});

const approve = (txn: string, extra: Record<string, string> = {}) =>
  post("/admin/orders/approve-payment", {
    paymentId: String(ids[txn]),
    versionId: String(sealion),
    note: "paid rest in cash",
    confirm: "1",
    ...extra,
  });

describe("payment detail actions", () => {
  it("offers Approve for a flagged payment, listing only versions with a PDF", async () => {
    const html = await (await adminFetch(`/admin/payments/${ids.DEMOLOW001}`)).text();
    expect(html).toContain('action="/admin/orders/approve-payment"');
    expect(html).toContain("I checked this payment is real");
    expect(html).toContain(`value="${sealion}"`);
    expect(html).toContain(`value="${e2}"`);
    expect(html).not.toContain(`value="${hiddenNoPdf}"`);
  });

  it("does not offer Approve for a claimed payment", async () => {
    const html = await (await adminFetch(`/admin/payments/${ids.DEMOUSED01}`)).text();
    expect(html).not.toContain('action="/admin/orders/approve-payment"');
    expect(html).toContain("already claimed");
  });
});

describe("POST /admin/orders/approve-payment", () => {
  it("approves flagged DEMOLOW001 for Sealion; the link downloads the PDF once shown", async () => {
    const res = await approve("DEMOLOW001");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const html = await res.text();
    expect(html).toContain("This link is shown only once.");
    expect(html).toContain("Send it to the buyer now (Telegram/SMS).");
    expect(html).toContain("data-copy=");

    const payment = await one<{ status: string; claimed_at: number; claim_ref: string }>(
      "SELECT status, claimed_at, claim_ref FROM payments WHERE id = ?",
      ids.DEMOLOW001,
    );
    expect(payment?.status).toBe("claimed");
    expect(payment?.claimed_at).toBeGreaterThan(0);
    expect(payment?.claim_ref).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const order = await one<{
      created_by: string;
      admin_note: string;
      manual_version_id: number;
    }>(
      "SELECT created_by, admin_note, manual_version_id FROM orders WHERE payment_id = ?",
      ids.DEMOLOW001,
    );
    expect(order).toEqual({
      created_by: "admin",
      admin_note: "paid rest in cash",
      manual_version_id: sealion,
    });

    const dl = await download(linkFrom(html));
    expect(dl.status).toBe(200);
    expect(dl.headers.get("Content-Type")).toBe("application/pdf");
    expect(await dl.text()).toBe(PDF);
  });

  it("approves an unclaimed payment too", async () => {
    expect((await approve("DEMOPAY001")).status).toBe(200);
    expect(
      await count("SELECT COUNT(*) AS n FROM orders WHERE payment_id = ?", ids.DEMOPAY001),
    ).toBe(1);
  });

  it("refuses an already-claimed payment and creates no order", async () => {
    const res = await approve("DEMOUSED01");
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Payment was already claimed");
    expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM download_tokens")).toBe(0);
  });

  it("refuses a second approval of the same payment", async () => {
    expect((await approve("DEMOLOW001")).status).toBe(200);
    expect((await approve("DEMOLOW001")).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(1);
  });

  it.each([
    ["no confirm", { confirm: "" }, "Tick"],
    ["no note", { note: "  " }, "Enter a note."],
    ["a long note", { note: "x".repeat(501) }, "500 characters or fewer"],
    ["no version", { versionId: "" }, "Choose a manual."],
    ["a version without a PDF", { versionId: "HIDDEN" }, "Choose a manual."],
    ["an unknown version", { versionId: "999999" }, "Choose a manual."],
  ])("rejects %s and changes nothing", async (_, extra, message) => {
    const fields: Record<string, string> = { ...extra };
    if (fields.versionId === "HIDDEN") fields.versionId = String(hiddenNoPdf);
    const res = await approve("DEMOLOW001", fields);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(message);
    expect(
      (await one<{ status: string }>("SELECT status FROM payments WHERE id = ?", ids.DEMOLOW001))
        ?.status,
    ).toBe("flagged");
    expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(0);
  });

  it("404s for an unknown payment", async () => {
    const res = await post("/admin/orders/approve-payment", {
      paymentId: "999999",
      versionId: String(sealion),
      note: "x",
      confirm: "1",
    });
    expect(res.status).toBe(404);
  });

  it("exactly one wins when an auto-claim and an admin approval race", async () => {
    for (let round = 0; round < 5; round++) {
      await env.DB.prepare(
        "UPDATE payments SET status = 'unclaimed', claimed_at = NULL, claim_ref = NULL WHERE id = ?",
      )
        .bind(ids.DEMOPAY001)
        .run();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM download_tokens"),
        env.DB.prepare("DELETE FROM orders"),
      ]);
      const now = Date.now();
      const [auto, admin] = await Promise.all([
        claim(env, {
          txnInput: "DEMOPAY001",
          versionId: sealion,
          ip: "203.0.113.9",
          now,
          origin: "https://example.com",
        }),
        approvePayment(env, {
          paymentId: ids.DEMOPAY001 as number,
          versionId: e2,
          adminNote: "race",
          now,
        }),
      ]);
      const wins = [auto.status === "ok", admin !== null].filter(Boolean).length;
      expect(wins).toBe(1);
      expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(1);
      expect(await count("SELECT COUNT(*) AS n FROM download_tokens")).toBe(1);
      if (auto.status !== "ok") expect(auto).toMatchObject({ code: "ALREADY_USED" });
    }
  });
});

describe("manual order without a payment", () => {
  it("shows the form", async () => {
    const html = await (await adminFetch("/admin/orders/manual")).text();
    expect(html).toContain('action="/admin/orders/manual"');
    expect(html).toContain("I checked this payment is real");
  });

  it("creates an order with no payment, listed as 'manual', whose link works", async () => {
    const res = await post("/admin/orders/manual", {
      versionId: String(e2),
      note: "SMS lost; buyer txn ABCDE12345, Telegram @buyer",
      confirm: "1",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const link = linkFrom(await res.text());
    const order = await one<{ payment_id: number | null; created_by: string }>(
      "SELECT payment_id, created_by FROM orders",
    );
    expect(order).toEqual({ payment_id: null, created_by: "admin" });
    expect((await download(link)).status).toBe(200);

    const list = await (await adminFetch("/admin/payments/orders")).text();
    expect(list).toContain("manual");
    expect(list).toContain("BYD E2 2025");
    expect(list).toContain('href="/admin/orders/manual"');
  });

  it.each([
    ["no confirm", { confirm: "" }],
    ["no note", { note: "" }],
    ["no version", { versionId: "" }],
  ])("rejects %s", async (_, extra) => {
    const res = await post("/admin/orders/manual", {
      versionId: String(e2),
      note: "x",
      confirm: "1",
      ...extra,
    });
    expect(res.status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(0);
  });
});

describe("regenerate a link", () => {
  async function orderWithUsedLink() {
    const created = await createOrder(env, {
      paymentId: ids.DEMOUSED01 as number,
      versionId: sealion,
      createdBy: "auto",
      adminNote: null,
      now: Date.now(),
    });
    return created;
  }

  it("shows a confirm page, linked from the orders list and the payment detail", async () => {
    const { orderId } = await orderWithUsedLink();
    const list = await (await adminFetch("/admin/payments/orders")).text();
    expect(list).toContain(`href="/admin/orders/${orderId}/regenerate"`);
    const detail = await (await adminFetch(`/admin/payments/${ids.DEMOUSED01}`)).text();
    expect(detail).toContain(`href="/admin/orders/${orderId}/regenerate"`);
    const page = await adminFetch(`/admin/orders/${orderId}/regenerate`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`action="/admin/orders/${orderId}/regenerate"`);
  });

  it("revokes the old link (410) and the new one works with a fresh 3 downloads", async () => {
    const { orderId, token } = await orderWithUsedLink();
    const old = `${TEST_ACCESS.PUBLIC_SITE_URL}/d/${token}`;
    expect((await download(old)).status).toBe(200);

    const res = await post(`/admin/orders/${orderId}/regenerate`, {
      note: "buyer lost the file",
      confirm: "1",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const fresh = linkFrom(await res.text());
    expect(fresh).not.toBe(old);

    expect((await download(old)).status).toBe(410);
    for (let i = 0; i < 3; i++) expect((await download(fresh)).status).toBe(200);
    expect((await download(fresh)).status).toBe(410);

    const tokens = await env.DB.prepare(
      "SELECT revoked_at, download_count, max_downloads FROM download_tokens WHERE order_id = ? ORDER BY id",
    )
      .bind(orderId)
      .all<{ revoked_at: number | null; download_count: number; max_downloads: number }>();
    expect(tokens.results).toHaveLength(2);
    expect(tokens.results[0]?.revoked_at).not.toBeNull();
    expect(tokens.results[1]).toEqual({ revoked_at: null, download_count: 3, max_downloads: 3 });
    const note = await one<{ admin_note: string }>(
      "SELECT admin_note FROM orders WHERE id = ?",
      orderId,
    );
    expect(note?.admin_note).toMatch(
      /^New link \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z: buyer lost the file$/,
    );
  });

  it.each([
    ["no confirm", { note: "x" }],
    ["no note", { note: "", confirm: "1" }],
  ])("rejects %s and keeps the old link", async (_, fields) => {
    const { orderId, token } = await orderWithUsedLink();
    const res = await post(`/admin/orders/${orderId}/regenerate`, fields);
    expect(res.status).toBe(400);
    expect((await download(`${TEST_ACCESS.PUBLIC_SITE_URL}/d/${token}`)).status).toBe(200);
    expect(
      await count("SELECT COUNT(*) AS n FROM download_tokens WHERE order_id = ?", orderId),
    ).toBe(1);
  });

  it("404s for an unknown order", async () => {
    expect((await adminFetch("/admin/orders/999999/regenerate")).status).toBe(404);
    expect(
      (await post("/admin/orders/999999/regenerate", { note: "x", confirm: "1" })).status,
    ).toBe(404);
  });
});

describe("outside admin", () => {
  it.each([
    ["approve", "/admin/orders/approve-payment"],
    ["manual", "/admin/orders/manual"],
    ["regenerate", "/admin/orders/1/regenerate"],
  ])("rejects a foreign or missing Origin on %s", async (_, path) => {
    const fields = {
      paymentId: String(ids.DEMOLOW001),
      versionId: String(sealion),
      note: "x",
      confirm: "1",
    };
    expect((await post(path, fields, "https://evil.example")).status).toBe(403);
    expect((await post(path, fields, null)).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(0);
  });

  it("is not reachable on the public Worker", async () => {
    const res = await SELF.fetch("https://example.com/admin/orders/manual", {
      method: "POST",
      headers: { Origin: "https://example.com" },
    });
    expect(res.status).toBe(404);
  });
});
