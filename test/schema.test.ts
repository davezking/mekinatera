import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const db = env.DB;
const T = 1_700_000_000_000;

function idOf(row: { id: number } | null): number {
  if (!row) throw new Error("INSERT ... RETURNING id returned no row");
  return row.id;
}

async function insertRawSms(): Promise<number> {
  const row = await db
    .prepare(
      "INSERT INTO raw_sms (sender, body, received_at, parse_status, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind("127", "redacted", T, "parsed", T)
    .first<{ id: number }>();
  return idOf(row);
}

async function insertPayment(txn: string, status = "unclaimed"): Promise<number> {
  const rawSmsId = await insertRawSms();
  const row = await db
    .prepare(
      `INSERT INTO payments
        (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, raw_sms_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(txn, 50000, "Test Payer", "2519****1234", T, rawSmsId, status, T)
    .first<{ id: number }>();
  return idOf(row);
}

async function insertManualVersion(language = "en"): Promise<number> {
  const model = await db
    .prepare(
      `INSERT INTO car_models (name, slug, model_year, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind("BYD Sealion", `sealion-${crypto.randomUUID()}`, "2026", T, T)
    .first<{ id: number }>();
  const version = await db
    .prepare(
      `INSERT INTO manual_versions (car_model_id, language, price_santim, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(idOf(model), language, 50000, T, T)
    .first<{ id: number }>();
  return idOf(version);
}

function insertOrder(paymentId: number | null, manualVersionId: number) {
  return db
    .prepare(
      "INSERT INTO orders (payment_id, manual_version_id, created_by, created_at) VALUES (?, ?, 'auto', ?)",
    )
    .bind(paymentId, manualVersionId, T)
    .run();
}

async function queryPlan(sql: string, ...params: unknown[]): Promise<string> {
  const { results } = await db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();
  return results.map((r) => r.detail).join("\n");
}

beforeEach(async () => {
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
});

describe("payments", () => {
  it("rejects a second payment with the same transaction_number (FR-9)", async () => {
    await insertPayment("DJA1B2C3D4");
    await expect(insertPayment("DJA1B2C3D4")).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("rejects a transaction_number that is not 10 characters", async () => {
    await expect(insertPayment("DJA1B2C3D")).rejects.toThrow(/CHECK constraint failed/);
    await expect(insertPayment("DJA1B2C3D4X")).rejects.toThrow(/CHECK constraint failed/);
  });

  it("rejects an unknown status", async () => {
    await expect(insertPayment("DJA1B2C3D4", "paid")).rejects.toThrow(/CHECK constraint failed/);
  });

  it("rejects a non-positive amount", async () => {
    const stmt = db
      .prepare(
        `INSERT INTO payments
          (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, created_at)
         VALUES ('DJA1B2C3D4', ?, 'x', 'x', 0, 0)`,
      )
      .bind(0);
    await expect(stmt.run()).rejects.toThrow(/CHECK constraint failed/);
  });

  it("rejects a duplicate claim_ref", async () => {
    const a = await insertPayment("DJA1B2C3D4");
    const b = await insertPayment("DJA1B2C3D5");
    const setRef = (id: number) =>
      db.prepare("UPDATE payments SET claim_ref = 'ref-1' WHERE id = ?").bind(id).run();
    await setRef(a);
    await expect(setRef(b)).rejects.toThrow(/UNIQUE constraint failed/);
  });
});

describe("orders", () => {
  it("rejects two orders for the same payment", async () => {
    const paymentId = await insertPayment("DJA1B2C3D4");
    const versionId = await insertManualVersion();
    await insertOrder(paymentId, versionId);
    await expect(insertOrder(paymentId, versionId)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("allows several orders with payment_id NULL", async () => {
    const versionId = await insertManualVersion();
    await insertOrder(null, versionId);
    await insertOrder(null, versionId);
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE payment_id IS NULL")
      .first<{ n: number }>();
    expect(row?.n).toBe(2);
  });

  it("enforces foreign keys", async () => {
    await expect(insertOrder(null, 999_999)).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rejects an unknown created_by", async () => {
    const versionId = await insertManualVersion();
    const stmt = db
      .prepare(
        "INSERT INTO orders (manual_version_id, created_by, created_at) VALUES (?, 'buyer', 0)",
      )
      .bind(versionId);
    await expect(stmt.run()).rejects.toThrow(/CHECK constraint failed/);
  });
});

describe("CHECK constraints", () => {
  it("rejects an unknown raw_sms parse_status", async () => {
    const stmt = db.prepare(
      "INSERT INTO raw_sms (sender, body, received_at, parse_status, created_at) VALUES ('127', 'x', 0, 'x', 0)",
    );
    await expect(stmt.run()).rejects.toThrow(/CHECK constraint failed/);
  });

  it("rejects an unknown manual language", async () => {
    await expect(insertManualVersion("fr")).rejects.toThrow(/CHECK constraint failed/);
  });

  it("rejects a second manual for the same model and language", async () => {
    const versionId = await insertManualVersion();
    const stmt = db
      .prepare(
        `INSERT INTO manual_versions (car_model_id, language, price_santim, created_at, updated_at)
         SELECT car_model_id, 'en', 50000, 0, 0 FROM manual_versions WHERE id = ?`,
      )
      .bind(versionId);
    await expect(stmt.run()).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("rejects a boolean that is not 0 or 1", async () => {
    const stmt = db.prepare(
      "INSERT INTO car_models (name, slug, model_year, is_visible, created_at, updated_at) VALUES ('x', 'x', '2026', 2, 0, 0)",
    );
    await expect(stmt.run()).rejects.toThrow(/CHECK constraint failed/);
  });
});

describe("hot-path lookups use an index", () => {
  it.each([
    ["payments", "SELECT * FROM payments WHERE transaction_number = ?", "DJA1B2C3D4"],
    ["download_tokens", "SELECT * FROM download_tokens WHERE token_hash = ?", "abc"],
    ["payments", "SELECT * FROM payments WHERE claim_ref = ?", "ref-1"],
    ["orders", "SELECT * FROM orders WHERE payment_id = ?", 1],
  ])("%s: %s", async (table, sql, param) => {
    const plan = await queryPlan(sql, param);
    expect(plan).toMatch(/USING (COVERING )?INDEX/);
    expect(plan).not.toContain(`SCAN ${table}`);
  });
});
