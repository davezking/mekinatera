import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPaymentByTxn } from "../src/lib/db/payments";
import type { RawSmsRow } from "../src/lib/db/types";
import { parseReceivedAt } from "../src/routes/webhook";

const URL = "https://example.com/api/sms-webhook";
const SECRET = "dev-webhook-secret";

const PAYMENT_SMS =
  "Dear [Owner] You have received ETB 500.00 from Abebe Kebede(2519****2531) on 26/09/2026 09:57:24. Your transaction number is DIQ55JS1ED. Your current E-Money Account balance is ETB 1,234.00. Thank you for using telebirr";
const BANK_SMS =
  "Dear [Owner] You have received ETB 1,000.00 from Commercial Bank of Ethiopia on 26/09/2026 09:57:24 by transaction number FT26269ABC12. Your current E-Money Account balance is ETB 5,000.00. Thank you for using telebirr";

function post(payload: unknown, secret: string | null = SECRET, raw = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["X-Webhook-Secret"] = secret;
  return SELF.fetch(URL, {
    method: "POST",
    headers,
    body: raw ? (payload as string) : JSON.stringify(payload),
  });
}

async function counts() {
  const [raw, pay] = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT count(*) AS n FROM raw_sms"),
    env.DB.prepare("SELECT count(*) AS n FROM payments"),
  ]);
  return { raw: raw?.results[0]?.n, payments: pay?.results[0]?.n };
}

let logs: string[];

beforeEach(async () => {
  await env.DB.batch(
    ["download_tokens", "orders", "payments", "raw_sms"].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/sms-webhook auth", () => {
  it.each([
    ["missing", null],
    ["wrong", "nope"],
    ["wrong, same length", "dev-webhook-secreT"],
    ["empty", ""],
  ])("rejects a %s secret with 401 and stores nothing", async (_label, secret) => {
    const res = await post({ from: "127", body: PAYMENT_SMS }, secret);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(await counts()).toEqual({ raw: 0, payments: 0 });
  });
});

describe("POST /api/sms-webhook validation", () => {
  it.each([
    ["not JSON", "{nope", true],
    ["a JSON array", "[]", true],
    ["missing body", { from: "127" }, false],
    ["empty body", { from: "127", body: "  " }, false],
    ["non-string body", { from: "127", body: 5 }, false],
  ])("returns 400 for %s", async (_label, payload, raw) => {
    const res = await post(payload, SECRET, raw);
    expect(res.status).toBe(400);
    expect(await counts()).toEqual({ raw: 0, payments: 0 });
  });
});

describe("POST /api/sms-webhook from 127", () => {
  it("stores a payment SMS with a redacted body (FR-6, FR-8, FR-10)", async () => {
    const res = await post({ from: "127", body: PAYMENT_SMS, receivedAt: "1790000000000" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "stored" });
    expect(await counts()).toEqual({ raw: 1, payments: 1 });

    const raw = await env.DB.prepare("SELECT * FROM raw_sms").first<RawSmsRow>();
    expect(raw).toMatchObject({
      sender: "127",
      parse_status: "parsed",
      pattern_id: "t2t-received-v1",
      received_at: 1_790_000_000_000,
    });
    expect(raw?.body).toContain("balance is ETB [redacted]");
    expect(raw?.body).not.toContain("1,234.00");

    const payment = await getPaymentByTxn(env.DB, "DIQ55JS1ED");
    expect(payment).toMatchObject({
      amount_santim: 50000,
      payer_name: "Abebe Kebede",
      payer_phone_masked: "2519****2531",
      status: "unclaimed",
      // 26/09/2026 09:57:24 EAT = 06:57:24 UTC
      paid_at: Date.UTC(2026, 8, 26, 6, 57, 24),
      raw_sms_id: raw?.id,
      claimed_at: null,
      claim_ref: null,
    });
  });

  it("returns duplicate for the same SMS twice and keeps one payment (FR-9)", async () => {
    expect(await (await post({ from: "127", body: PAYMENT_SMS })).json()).toEqual({
      result: "stored",
    });
    const res = await post({ from: "127", body: PAYMENT_SMS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "duplicate" });
    const { payments } = await counts();
    expect(payments).toBe(1);
  });

  it("accepts a sender with surrounding whitespace", async () => {
    const res = await post({ from: " 127 ", body: PAYMENT_SMS });
    expect(await res.json()).toEqual({ result: "stored" });
  });

  it("stores a bank-deposit SMS as ignored, with no payment (FR-7)", async () => {
    const res = await post({ from: "127", body: BANK_SMS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ignored" });
    expect(await counts()).toEqual({ raw: 1, payments: 0 });
    const raw = await env.DB.prepare("SELECT parse_status, pattern_id FROM raw_sms").first();
    expect(raw).toEqual({ parse_status: "ignored", pattern_id: "bank-deposit-v1" });
  });

  it("stores unparseable text as failed for the admin, with no payment", async () => {
    const res = await post({ from: "127", body: "Something telebirr never sends 0911223344" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "failed" });
    expect(await counts()).toEqual({ raw: 1, payments: 0 });
    const raw = await env.DB.prepare("SELECT body, parse_status, pattern_id FROM raw_sms").first();
    expect(raw).toEqual({
      body: "Something telebirr never sends [redacted]",
      parse_status: "failed",
      pattern_id: null,
    });
  });
});

describe("POST /api/sms-webhook from other senders", () => {
  it.each(["+251911223344", "0911223344", "1270", ""])(
    "discards %j and stores nothing (FR-7)",
    async (from) => {
      const res = await post({ from, body: PAYMENT_SMS });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: "discarded" });
      expect(await counts()).toEqual({ raw: 0, payments: 0 });
    },
  );

  it("discards a missing sender", async () => {
    const res = await post({ body: PAYMENT_SMS });
    expect(await res.json()).toEqual({ result: "discarded" });
    expect(await counts()).toEqual({ raw: 0, payments: 0 });
  });
});

describe("logging", () => {
  it("logs only the event, result, pattern and row id", async () => {
    await post({ from: "127", body: PAYMENT_SMS });
    await post({ from: "127", body: BANK_SMS });
    await post({ from: "+251911223344", body: PAYMENT_SMS });
    const events = logs.filter((l) => l.includes("sms_received"));
    expect(events).toHaveLength(3);
    for (const line of events) {
      expect(Object.keys(JSON.parse(line)).sort()).toEqual(
        ["event", "patternId", "rawSmsId", "result"].sort(),
      );
    }
    const all = logs.join("\n");
    for (const secret of [
      "Abebe",
      "Kebede",
      "2519****2531",
      "DIQ55JS1ED",
      "1,234.00",
      "251911223344",
      "received ETB",
    ]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("parseReceivedAt", () => {
  const NOW = 1_800_000_000_000;
  it.each([
    [1_790_000_000_000, 1_790_000_000_000],
    ["1790000000000", 1_790_000_000_000],
    [" 1790000000000 ", 1_790_000_000_000],
    ["2026-09-26T06:57:24Z", Date.UTC(2026, 8, 26, 6, 57, 24)],
    ["2026-09-26T09:57:24+03:00", Date.UTC(2026, 8, 26, 6, 57, 24)],
    [undefined, NOW],
    [null, NOW],
    ["", NOW],
    ["yesterday", NOW],
    [-5, NOW],
    [1.5, NOW],
    [{}, NOW],
  ])("%j → %d", (input, expected) => {
    expect(parseReceivedAt(input, NOW)).toBe(expected);
  });
});
