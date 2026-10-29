import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claim, createOrderWithToken, normalizeTxn } from "../src/lib/claim";
import type { DownloadTokenRow, OrderRow, PaymentRow } from "../src/lib/db/types";
import { createTicket, verifyTicket } from "../src/lib/ticket";
import { DAY, HOUR, MINUTE } from "../src/lib/time";
import { hashToken } from "../src/lib/token";
import { SITEVERIFY_URL } from "../src/lib/turnstile";

const NOW = 1_790_000_000_000;
const ORIGIN = "https://example.com";
const TXN = "DIQ55JS1ED";
/** The stubbed siteverify accepts only this token. */
const GOOD_TOKEN = "turnstile-ok";

let siteverifyCalls: URLSearchParams[];

let versionId: number;
let hiddenVersionId: number;
let noPdfVersionId: number;
let hiddenModelVersionId: number;

async function insertVersion(
  slug: string,
  opts: { modelVisible?: 0 | 1; visible?: 0 | 1; r2Key?: string | null },
) {
  await env.DB.prepare(
    `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
     VALUES (?, ?, '2026', ?, 1, ?, ?)`,
  )
    .bind(slug, slug, opts.modelVisible ?? 1, NOW, NOW)
    .run();
  const id = await env.DB.prepare(
    `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, is_visible, created_at, updated_at)
     SELECT id, 'en', 50000, ?, ?, ?, ? FROM car_models WHERE slug = ? RETURNING id`,
  )
    .bind(
      opts.r2Key === undefined ? `manuals/${slug}.pdf` : opts.r2Key,
      opts.visible ?? 1,
      NOW,
      NOW,
      slug,
    )
    .first<number>("id");
  if (id === null) throw new Error("no version id");
  return id;
}

async function insertPayment(txn: string, amountSantim: number, paidAt: number) {
  await env.DB.prepare(
    `INSERT INTO payments (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, status, created_at)
     VALUES (?, ?, 'Abebe Kebede', '2519****2531', ?, 'unclaimed', ?)`,
  )
    .bind(txn, amountSantim, paidAt, paidAt)
    .run();
}

function getPayment(txn = TXN) {
  return env.DB.prepare("SELECT * FROM payments WHERE transaction_number = ?")
    .bind(txn)
    .first<PaymentRow>();
}

async function all<T>(sql: string) {
  return (await env.DB.prepare(sql).all<T>()).results;
}

function run(txnInput: string, opts: { version?: number; now?: number; ticket?: string } = {}) {
  return claim(env, {
    txnInput,
    versionId: opts.version ?? versionId,
    ip: "203.0.113.7",
    now: opts.now ?? NOW,
    origin: ORIGIN,
    ticket: opts.ticket,
  });
}

beforeEach(async () => {
  await env.DB.batch(
    [
      "claim_attempts",
      "download_tokens",
      "orders",
      "payments",
      "raw_sms",
      "manual_versions",
      "car_models",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  versionId = await insertVersion("byd-sealion-2026", {});
  hiddenVersionId = await insertVersion("byd-seal-2025", { visible: 0 });
  noPdfVersionId = await insertVersion("byd-dolphin-2025", { r2Key: null });
  hiddenModelVersionId = await insertVersion("byd-han-2024", { modelVisible: 0 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  siteverifyCalls = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== SITEVERIFY_URL) return realFetch(input, init);
    const form = new URLSearchParams(init?.body as URLSearchParams);
    siteverifyCalls.push(form);
    return new Response(JSON.stringify({ success: form.get("response") === GOOD_TOKEN }), {
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeTxn", () => {
  it("trims, uppercases and removes all whitespace (FR-12)", () => {
    expect(normalizeTxn(" diq55js1ed ")).toBe(TXN);
    expect(normalizeTxn("DIQ 55J\tS1ED\n")).toBe(TXN);
  });
});

describe("claim()", () => {
  it("claims an unclaimed payment: order, token hash and download URL (FR-13, FR-18)", async () => {
    await insertPayment(TXN, 50000, NOW - HOUR);
    const result = await run(TXN);
    expect(result).toEqual({
      status: "ok",
      downloadUrl: expect.stringMatching(/^https:\/\/example\.com\/d\/[A-Za-z0-9_-]{43}$/),
    });
    const token = (result as { downloadUrl: string }).downloadUrl.split("/d/")[1] as string;

    const payment = await getPayment();
    expect(payment).toMatchObject({ status: "claimed", claimed_at: NOW });
    expect(payment?.claim_ref).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const orders = await all<OrderRow>("SELECT * FROM orders");
    expect(orders).toEqual([
      expect.objectContaining({
        payment_id: payment?.id,
        manual_version_id: versionId,
        created_by: "auto",
        created_at: NOW,
      }),
    ]);
    const tokens = await all<DownloadTokenRow>("SELECT * FROM download_tokens");
    expect(tokens).toEqual([
      expect.objectContaining({
        order_id: orders[0]?.id,
        token_hash: await hashToken(token),
        expires_at: NOW + 24 * HOUR,
        max_downloads: 3,
        download_count: 0,
        revoked_at: null,
      }),
    ]);

    // The raw token is stored nowhere.
    for (const table of ["payments", "orders", "download_tokens", "claim_attempts"]) {
      const rows = await all<Record<string, unknown>>(`SELECT * FROM ${table}`);
      expect(JSON.stringify(rows), table).not.toContain(token);
    }

    expect(
      await all(
        "SELECT transaction_number_input, manual_version_id, ip, result_code, created_at FROM claim_attempts",
      ),
    ).toEqual([
      {
        transaction_number_input: TXN,
        manual_version_id: versionId,
        ip: "203.0.113.7",
        result_code: "OK",
        created_at: NOW,
      },
    ]);
  });

  it("matches a lowercase, padded number (FR-12)", async () => {
    await insertPayment(TXN, 50000, NOW - HOUR);
    expect(await run(" diq55js1ed ")).toMatchObject({ status: "ok" });
  });

  it.each(["ABC", "", "DIQ55JS1ED1", "DIQ55JS1E-", "ДIQ55JS1ED"])(
    "returns INVALID_FORMAT for %j",
    async (input) => {
      expect(await run(input)).toMatchObject({ status: "error", code: "INVALID_FORMAT" });
    },
  );

  it("returns ALREADY_USED for a second claim (FR-17)", async () => {
    await insertPayment(TXN, 50000, NOW - HOUR);
    expect(await run(TXN)).toMatchObject({ status: "ok" });
    expect(await run(TXN)).toEqual({
      status: "error",
      code: "ALREADY_USED",
      message: "This transaction number has already been used.",
    });
    expect(await all("SELECT id FROM orders")).toHaveLength(1);
    expect(await all("SELECT id FROM download_tokens")).toHaveLength(1);
  });

  it("flags an underpaid payment and keeps returning AMOUNT_TOO_LOW (FR-16)", async () => {
    await insertPayment(TXN, 30000, NOW - HOUR);
    const tooLow = {
      status: "error",
      code: "AMOUNT_TOO_LOW",
      message: "The amount received is less than the price. Contact support.",
    };
    expect(await run(TXN)).toEqual(tooLow);
    expect(await getPayment()).toMatchObject({ status: "flagged", flag_reason: "amount_too_low" });
    expect(await run(TXN)).toEqual(tooLow);
    expect(await all("SELECT id FROM orders")).toHaveLength(0);
  });

  it("returns EXPIRED for a payment older than the claim window (FR-13d)", async () => {
    await insertPayment(TXN, 50000, NOW - 8 * DAY);
    expect(await run(TXN)).toEqual({
      status: "error",
      code: "EXPIRED",
      message: "This payment is older than 7 days. Contact support.",
    });
    expect(await getPayment()).toMatchObject({ status: "unclaimed" });
  });

  it("claims a payment within the window", async () => {
    await insertPayment(TXN, 50000, NOW - 6 * DAY);
    expect(await run(TXN)).toMatchObject({ status: "ok" });
  });

  it("returns pending with a signed ticket for an unknown number (FR-15)", async () => {
    const result = await run(TXN);
    expect(result).toEqual({ status: "pending", ticket: expect.any(String), retryAfterMs: 5000 });
    const ticket = (result as { ticket: string }).ticket;
    expect(await verifyTicket(env.TICKET_SECRET, ticket, NOW)).toEqual({
      txn: TXN,
      versionId,
      expiresAt: NOW + 10 * MINUTE,
    });
    expect(await all("SELECT result_code FROM claim_attempts")).toEqual([
      { result_code: "PENDING" },
    ]);
  });

  it("returns the same ticket on a pending poll and records nothing", async () => {
    const ticket = await createTicket(env.TICKET_SECRET, {
      txn: TXN,
      versionId,
      expiresAt: NOW + MINUTE,
    });
    expect(await run(TXN, { ticket })).toEqual({ status: "pending", ticket, retryAfterMs: 5000 });
    expect(await all("SELECT id FROM claim_attempts")).toHaveLength(0);
  });

  it("lets exactly one of 5 concurrent claims win (FR-14)", async () => {
    await insertPayment(TXN, 50000, NOW - HOUR);
    const results = await Promise.all(Array.from({ length: 5 }, () => run(TXN)));
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.status === "error" && r.code === "ALREADY_USED")).toHaveLength(
      4,
    );
    expect(await all("SELECT id FROM orders")).toHaveLength(1);
    expect(await all("SELECT id FROM download_tokens")).toHaveLength(1);
    expect(await all("SELECT id FROM claim_attempts")).toHaveLength(5);
  });

  it.each([
    ["hidden version", () => hiddenVersionId],
    ["version without a PDF", () => noPdfVersionId],
    ["version of a hidden model", () => hiddenModelVersionId],
    ["unknown version", () => 999_999],
  ])("returns INVALID_VERSION for a %s", async (_label, version) => {
    await insertPayment(TXN, 50000, NOW - HOUR);
    expect(await run(TXN, { version: version() })).toMatchObject({
      status: "error",
      code: "INVALID_VERSION",
    });
    expect(await getPayment()).toMatchObject({ status: "unclaimed" });
  });

  it("caps the stored input length", async () => {
    await run("x".repeat(500));
    const [row] = await all<{ transaction_number_input: string }>(
      "SELECT transaction_number_input FROM claim_attempts",
    );
    expect(row?.transaction_number_input).toHaveLength(64);
  });
});

describe("createOrderWithToken", () => {
  it("creates an admin order and token in one batch, returning the raw token", async () => {
    const token = await createOrderWithToken(env, {
      paymentId: null,
      versionId,
      createdBy: "admin",
      adminNote: "bank transfer",
      now: NOW,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [order] = await all<OrderRow>("SELECT * FROM orders");
    expect(order).toMatchObject({
      payment_id: null,
      created_by: "admin",
      admin_note: "bank transfer",
    });
    expect(
      await all("SELECT order_id, token_hash, expires_at, max_downloads FROM download_tokens"),
    ).toEqual([
      {
        order_id: order?.id,
        token_hash: await hashToken(token),
        expires_at: NOW + 24 * HOUR,
        max_downloads: 3,
      },
    ]);
  });
});

describe("POST /api/claim", () => {
  function post(body: unknown, ip = "198.51.100.4") {
    return SELF.fetch(`${ORIGIN}/api/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async function pastAttempts(ip: string, count: number, at: number) {
    await env.DB.batch(
      Array.from({ length: count }, () =>
        env.DB.prepare(
          `INSERT INTO claim_attempts (transaction_number_input, manual_version_id, ip, result_code, created_at)
           VALUES ('XXXXXXXXXX', NULL, ?, 'NOT_FOUND', ?)`,
        ).bind(ip, at),
      ),
    );
  }

  it("claims a payment and returns a download URL on this origin", async () => {
    await insertPayment(TXN, 50000, Date.now() - HOUR);
    const res = await post({
      transactionNumber: "diq55js1ed",
      versionId,
      turnstileToken: GOOD_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "ok",
      downloadUrl: expect.stringMatching(/^https:\/\/example\.com\/d\/[A-Za-z0-9_-]{43}$/),
    });
    expect(await all("SELECT ip FROM claim_attempts")).toEqual([{ ip: "198.51.100.4" }]);
    expect(siteverifyCalls).toHaveLength(1);
    expect(siteverifyCalls[0]?.get("remoteip")).toBe("198.51.100.4");
  });

  it.each([
    ["null", "null"],
    ["missing number", { versionId: 1 }],
    ["numeric transaction number", { transactionNumber: 123, versionId: 1 }],
    ["string version id", { transactionNumber: TXN, versionId: "1" }],
    ["fractional version id", { transactionNumber: TXN, versionId: 1.5 }],
    ["zero version id", { transactionNumber: TXN, versionId: 0 }],
  ])("returns 400 for %s (after the bot check)", async (_label, body) => {
    const res = await post(
      typeof body === "string" ? body : { ...body, turnstileToken: GOOD_TOKEN },
    );
    // "null" has no token, so the bot check stops it first.
    if (body === "null") {
      expect(res.status).toBe(403);
      return;
    }
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "error", code: "INVALID_REQUEST" });
    expect(await all("SELECT id FROM claim_attempts")).toHaveLength(0);
  });

  it.each([
    ["no token", {}],
    ["an invalid token", { turnstileToken: "bad-token" }],
    ["an empty token", { turnstileToken: "" }],
  ])("returns 403 BOT_CHECK_FAILED with %s and evaluates nothing else", async (_label, extra) => {
    await insertPayment(TXN, 50000, Date.now() - HOUR);
    const res = await post({ transactionNumber: TXN, versionId, ...extra });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ status: "error", code: "BOT_CHECK_FAILED" });
    expect((await getPayment())?.status).toBe("unclaimed");
    expect(await all("SELECT id FROM orders")).toHaveLength(0);
    expect(
      await all(
        "SELECT transaction_number_input, manual_version_id, ip, result_code FROM claim_attempts",
      ),
    ).toEqual([
      {
        transaction_number_input: TXN,
        manual_version_id: versionId,
        ip: "198.51.100.4",
        result_code: "BOT_CHECK_FAILED",
      },
    ]);
  });

  it("returns 403 for a body that is not JSON", async () => {
    const res = await post("{nope");
    expect(res.status).toBe(403);
    expect(await all("SELECT result_code FROM claim_attempts")).toEqual([
      { result_code: "BOT_CHECK_FAILED" },
    ]);
  });

  it("limits the 11th request from one IP within 10 minutes, even with valid input", async () => {
    await insertPayment(TXN, 50000, Date.now() - HOUR);
    for (let i = 0; i < 10; i++) {
      const res = await post({
        transactionNumber: "DXXXXXXX00",
        versionId,
        turnstileToken: GOOD_TOKEN,
      });
      expect(res.status).toBe(200);
    }
    const before = siteverifyCalls.length;
    const res = await post({ transactionNumber: TXN, versionId, turnstileToken: GOOD_TOKEN });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ status: "error", code: "RATE_LIMITED" });
    expect(siteverifyCalls).toHaveLength(before); // limited before the bot check
    expect((await getPayment())?.status).toBe("unclaimed");
    expect(
      await all("SELECT result_code FROM claim_attempts WHERE result_code = 'RATE_LIMITED'"),
    ).toHaveLength(1);

    // Another IP is unaffected.
    const other = await post(
      { transactionNumber: TXN, versionId, turnstileToken: GOOD_TOKEN },
      "198.51.100.5",
    );
    expect(await other.json()).toMatchObject({ status: "ok" });
  });

  it("does not count attempts older than the window", async () => {
    await insertPayment(TXN, 50000, Date.now() - HOUR);
    await pastAttempts("198.51.100.4", 10, Date.now() - 11 * MINUTE);
    const res = await post({ transactionNumber: TXN, versionId, turnstileToken: GOOD_TOKEN });
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("counts blocked attempts too, so a client that keeps trying stays limited", async () => {
    await pastAttempts("198.51.100.4", 10, Date.now() - MINUTE);
    for (let i = 0; i < 3; i++) {
      expect((await post({ transactionNumber: TXN, versionId })).status).toBe(429);
    }
    expect(
      await all("SELECT id FROM claim_attempts WHERE result_code = 'RATE_LIMITED'"),
    ).toHaveLength(3);
  });

  it("uses X-Test-Client-IP in development (E2E tests share localhost)", async () => {
    await pastAttempts("127.0.0.1", 10, Date.now() - MINUTE);
    const res = await SELF.fetch(`${ORIGIN}/api/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": "127.0.0.1",
        "X-Test-Client-IP": "203.0.113.50",
      },
      body: JSON.stringify({ transactionNumber: TXN, versionId, turnstileToken: GOOD_TOKEN }),
    });
    expect(res.status).toBe(200);
    expect(await all("SELECT ip FROM claim_attempts WHERE ip = '203.0.113.50'")).toHaveLength(1);
  });
});

describe("GET /api/claim/status", () => {
  function poll(ticket: string) {
    return SELF.fetch(`${ORIGIN}/api/claim/status?ticket=${encodeURIComponent(ticket)}`);
  }

  it("returns ok once the payment arrives (FR-15)", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionNumber: TXN, versionId, turnstileToken: GOOD_TOKEN }),
    });
    const first = (await res.json()) as { status: string; ticket: string };
    expect(first.status).toBe("pending");

    const waiting = await poll(first.ticket);
    expect(waiting.headers.get("Cache-Control")).toBe("no-store");
    expect(await waiting.json()).toEqual({
      status: "pending",
      ticket: first.ticket,
      retryAfterMs: 5000,
    });

    await insertPayment(TXN, 50000, Date.now() - MINUTE);
    expect(await (await poll(first.ticket)).json()).toMatchObject({
      status: "ok",
      downloadUrl: expect.stringContaining("/d/"),
    });
    expect(await all("SELECT result_code, ip FROM claim_attempts ORDER BY id")).toEqual([
      { result_code: "PENDING", ip: "unknown" },
      { result_code: "OK", ip: "unknown" },
    ]);
  });

  it("works without Turnstile and is not rate-limited", async () => {
    const ip = "198.51.100.9";
    await env.DB.batch(
      Array.from({ length: 10 }, () =>
        env.DB.prepare(
          `INSERT INTO claim_attempts (transaction_number_input, manual_version_id, ip, result_code, created_at)
           VALUES ('XXXXXXXXXX', NULL, ?, 'NOT_FOUND', ?)`,
        ).bind(ip, Date.now() - MINUTE),
      ),
    );
    const ticket = await createTicket(env.TICKET_SECRET, {
      txn: TXN,
      versionId,
      expiresAt: Date.now() + MINUTE,
    });
    const headers = { "CF-Connecting-IP": ip };
    const url = `${ORIGIN}/api/claim/status?ticket=${encodeURIComponent(ticket)}`;
    expect(await (await SELF.fetch(url, { headers })).json()).toMatchObject({ status: "pending" });
    await insertPayment(TXN, 50000, Date.now() - MINUTE);
    expect(await (await SELF.fetch(url, { headers })).json()).toMatchObject({ status: "ok" });
    expect(siteverifyCalls).toHaveLength(0);
  });

  it("returns NOT_FOUND for an expired ticket and records one attempt", async () => {
    const ticket = await createTicket(env.TICKET_SECRET, {
      txn: TXN,
      versionId,
      expiresAt: Date.now() - 1,
    });
    const res = await poll(ticket);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "error",
      code: "NOT_FOUND",
      message:
        "We haven't received this payment yet. Check the number, or contact info@mekinatera.com.",
    });
    expect(await all("SELECT transaction_number_input, result_code FROM claim_attempts")).toEqual([
      { transaction_number_input: TXN, result_code: "NOT_FOUND" },
    ]);
  });

  it.each([
    [
      "tampered",
      async () =>
        `${(await createTicket(env.TICKET_SECRET, { txn: TXN, versionId, expiresAt: Date.now() + MINUTE })).slice(0, -3)}abc`,
    ],
    [
      "signed with another secret",
      () => createTicket("not-the-secret", { txn: TXN, versionId, expiresAt: Date.now() + MINUTE }),
    ],
    ["empty", async () => ""],
  ])("returns INVALID_TICKET for a %s ticket", async (_label, make) => {
    const res = await poll(await make());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "error", code: "INVALID_TICKET" });
    expect(await all("SELECT id FROM claim_attempts")).toHaveLength(0);
  });
});
