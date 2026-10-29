import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  encodeCursor,
  linkStatus,
  listPayments,
  parseCursor,
  paymentsListQuery,
} from "../src/lib/db/admin-queries";
import { redactSms } from "../src/lib/sms/redact";
import { DAY, HOUR, MINUTE } from "../src/lib/time";
import { formatEat } from "../src/views/admin/payments";
import { adminFetch } from "./helpers/admin";

const NOW = Date.now();
const PAYER = "Abebech Gobena Demo";

async function html(path: string) {
  const res = await adminFetch(path);
  return { status: res.status, text: await res.text() };
}

type Seed = {
  txn: string;
  status: "unclaimed" | "claimed" | "flagged";
  paidAt: number;
  amount?: number;
  flagReason?: string;
};

async function insertPayment(db: D1Database, p: Seed, i: number) {
  const body = `Dear Customer You have received ETB 500.00 from ${PAYER} ${i}(2519****${String(i).padStart(4, "0")}) on 01/01/2026 10:00:00. Your transaction number is ${p.txn}. Your current E-Money Account balance is ETB 1,250.00. Thank you for using telebirr`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO raw_sms (sender, body, received_at, parse_status, pattern_id, created_at)
         VALUES ('127', ?, ?, 'parsed', 't2t-received-v1', ?)`,
      )
      .bind(redactSms(body), p.paidAt, p.paidAt),
    db
      .prepare(
        `INSERT INTO payments (transaction_number, amount_santim, payer_name, payer_phone_masked,
           paid_at, raw_sms_id, status, flag_reason, created_at)
         VALUES (?, ?, ?, ?, ?, (SELECT max(id) FROM raw_sms), ?, ?, ?)`,
      )
      .bind(
        p.txn,
        p.amount ?? 50000,
        `${PAYER} ${i}`,
        `2519****${String(i).padStart(4, "0")}`,
        p.paidAt,
        p.status,
        p.flagReason ?? null,
        p.paidAt,
      ),
  ]);
}

async function paymentId(txn: string) {
  return (await env.DB.prepare("SELECT id FROM payments WHERE transaction_number = ?")
    .bind(txn)
    .first<number>("id")) as number;
}

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
  await db.batch([
    db.prepare(
      `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
       VALUES ('BYD Sealion', 'byd-sealion-2026', '2026', 1, 1, 0, 0)`,
    ),
    db.prepare(
      `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, file_size, is_visible, created_at, updated_at)
       SELECT id, 'en', 50000, 'manuals/byd-sealion-2026-en-demo.pdf', 1000, 1, 0, 0 FROM car_models`,
    ),
  ]);
  const seeds: Seed[] = [
    { txn: "DEMOPAY001", status: "unclaimed", paidAt: NOW - 5 * MINUTE },
    {
      txn: "DEMOLOW001",
      status: "flagged",
      paidAt: NOW - 4 * MINUTE,
      amount: 30000,
      flagReason: "amount_too_low",
    },
    { txn: "DEMOOLD001", status: "unclaimed", paidAt: NOW - 10 * DAY },
    { txn: "DEMOUSED01", status: "claimed", paidAt: NOW - DAY },
  ];
  for (const [i, s] of seeds.entries()) await insertPayment(db, s, i + 1);
  await db.batch([
    db
      .prepare(
        `INSERT INTO orders (payment_id, manual_version_id, created_by, created_at)
         SELECT p.id, v.id, 'auto', ? FROM payments p, manual_versions v
         WHERE p.transaction_number = 'DEMOUSED01'`,
      )
      .bind(NOW - DAY + MINUTE),
    // An older, replaced token and the current one: the list shows the newest.
    db
      .prepare(
        `INSERT INTO download_tokens (order_id, token_hash, expires_at, max_downloads, download_count, revoked_at, created_at)
         SELECT id, 'old-hash', ?, 3, 3, ?, ? FROM orders`,
      )
      .bind(NOW + DAY, NOW - HOUR, NOW - DAY),
    db
      .prepare(
        `INSERT INTO download_tokens (order_id, token_hash, expires_at, max_downloads, download_count, created_at)
         SELECT id, 'new-hash', ?, 3, 1, ? FROM orders`,
      )
      .bind(NOW + DAY, NOW - DAY + MINUTE),
    db
      .prepare(
        `INSERT INTO raw_sms (sender, body, received_at, parse_status, pattern_id, created_at)
         VALUES ('127', ?, ?, 'ignored', 'bank-deposit-v1', ?)`,
      )
      .bind(
        redactSms(
          "Dear Customer You have received ETB 1,000.00 from Commercial Bank of Ethiopia by transaction number FT26DEMO0001. Your current E-Money Account balance is ETB 2,250.00. Thank you for using telebirr",
        ),
        NOW - 30 * MINUTE,
        NOW,
      ),
    db
      .prepare(
        `INSERT INTO raw_sms (sender, body, received_at, parse_status, pattern_id, created_at)
         VALUES ('127', 'Demo garbage message that matches no telebirr pattern.', ?, 'failed', NULL, ?)`,
      )
      .bind(NOW - 20 * MINUTE, NOW),
  ]);
});

describe("cursor", () => {
  it("round-trips and rejects junk", () => {
    expect(parseCursor(encodeCursor({ at: 1700000000000, id: 42 }))).toEqual({
      at: 1700000000000,
      id: 42,
    });
    for (const bad of [undefined, "", "1", "1.", ".1", "a.b", "1.2.3", "-1.2", "1e3.2"]) {
      expect(parseCursor(bad)).toBeNull();
    }
  });
});

describe("linkStatus", () => {
  const base = {
    downloadCount: 1,
    maxDownloads: 3,
    expiresAt: NOW + 1,
    revokedAt: null,
    createdAt: 0,
  };
  it("orders revoked, used up, expired, active", () => {
    expect(linkStatus(base, NOW)).toBe("active");
    expect(linkStatus({ ...base, expiresAt: NOW }, NOW)).toBe("expired");
    expect(linkStatus({ ...base, downloadCount: 3, expiresAt: NOW }, NOW)).toBe("used_up");
    expect(linkStatus({ ...base, downloadCount: 3, revokedAt: NOW }, NOW)).toBe("revoked");
  });
});

describe("GET /admin/payments", () => {
  it("lists every payment newest first, with EAT time, ETB, payer and masked phone", async () => {
    const { status, text } = await html("/admin/payments");
    expect(status).toBe(200);
    const order = ["DEMOLOW001", "DEMOPAY001", "DEMOUSED01", "DEMOOLD001"].map((t) =>
      text.indexOf(t),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain(formatEat(NOW - 5 * MINUTE));
    expect(text).toContain("300 ETB");
    expect(text).toContain(`${PAYER} 1`);
    expect(text).toContain("2519****0001");
    expect(text).toContain("amount_too_low");
    expect(text).toContain(`href="/admin/payments/${await paymentId("DEMOPAY001")}"`);
    expect(text).not.toContain("Older");
  });

  it.each([
    ["unclaimed", ["DEMOPAY001", "DEMOOLD001"], ["DEMOLOW001", "DEMOUSED01"]],
    ["claimed", ["DEMOUSED01"], ["DEMOPAY001", "DEMOLOW001", "DEMOOLD001"]],
    ["flagged", ["DEMOLOW001"], ["DEMOPAY001", "DEMOUSED01", "DEMOOLD001"]],
  ])("?status=%s shows only matching payments", async (s, shown, hidden) => {
    const { status, text } = await html(`/admin/payments?status=${s}`);
    expect(status).toBe(200);
    for (const t of shown) expect(text).toContain(t);
    for (const t of hidden) expect(text).not.toContain(t);
    expect(text).toMatch(new RegExp(`href="/admin/payments\\?status=${s}" aria-current="page"`));
  });

  it("rejects an unknown status or a malformed cursor", async () => {
    expect((await html("/admin/payments?status=deleted")).status).toBe(400);
    expect((await html("/admin/payments?before=yesterday")).status).toBe(400);
  });

  it("pages by 50 with an Older link, including rows that share a paid_at", async () => {
    const db = env.DB;
    const at = NOW - HOUR; // 60 payments in the same millisecond, older than the seeds.
    await db.batch(
      Array.from({ length: 60 }, (_, i) =>
        db
          .prepare(
            `INSERT INTO payments (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, status, created_at)
             VALUES (?, 50000, 'Bulk', '2519****9999', ?, 'unclaimed', ?)`,
          )
          .bind(`BULK${String(i).padStart(6, "0")}`, at, at),
      ),
    );
    const first = await listPayments(db, { status: "unclaimed" });
    expect(first.rows).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = await listPayments(db, {
      status: "unclaimed",
      before: parseCursor(first.next ?? ""),
    });
    // 62 unclaimed in total: 1 newer seed, 60 bulk, 1 ten days old.
    expect(second.rows).toHaveLength(12);
    expect(second.next).toBeNull();
    const ids = [...first.rows, ...second.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(62);
    expect(second.rows.at(-1)?.txn).toBe("DEMOOLD001");

    // A page that holds exactly every row has no next cursor.
    const exact = await listPayments(db, { status: "unclaimed", limit: 62 });
    expect(exact.next).toBeNull();

    const page1 = await html("/admin/payments?status=unclaimed");
    expect(page1.text).toContain(`/admin/payments?status=unclaimed&amp;before=${first.next}`);
    const page2 = await html(`/admin/payments?status=unclaimed&before=${first.next}`);
    expect(page2.status).toBe(200);
    expect(page2.text).toContain("DEMOOLD001");
    expect(page2.text).not.toContain("DEMOPAY001");
    expect(page2.text).not.toContain(">Older<");
  });

  it("uses the (status, paid_at) index for every filter", async () => {
    for (const status of ["all", "unclaimed", "claimed", "flagged"] as const) {
      for (const before of [null, { at: NOW, id: 10 }]) {
        const { sql, params } = paymentsListQuery({ status, before });
        const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind(...params)
          .all<{ detail: string }>();
        const plan = results.map((r) => r.detail).join(" | ");
        expect(plan).toContain("USING INDEX idx_payments_status_paid");
        expect(plan).not.toMatch(/SCAN payments(?! USING)/);
      }
    }
  });
});

describe("GET /admin/payments/:id", () => {
  it("shows every field, the redacted SMS and no order for an unclaimed payment", async () => {
    const { status, text } = await html(`/admin/payments/${await paymentId("DEMOPAY001")}`);
    expect(status).toBe(200);
    expect(text).toContain("DEMOPAY001");
    expect(text).toContain(`${PAYER} 1`);
    expect(text).toContain("2519****0001");
    expect(text).toContain("500 ETB");
    expect(text).toContain("t2t-received-v1");
    expect(text).toContain("Your transaction number is DEMOPAY001");
    expect(text).not.toContain("1,250.00"); // balance redacted
    expect(text).toContain("No order for this payment.");
    expect(text).toContain('<section id="actions">');
  });

  it("shows the linked order and the newest token", async () => {
    const { text } = await html(`/admin/payments/${await paymentId("DEMOUSED01")}`);
    expect(text).toContain("Claimed");
    expect(text).toContain("BYD Sealion 2026 (en)");
    expect(text).toContain("1/3 downloads");
    expect(text).toContain("Active");
  });

  it("shows the flag reason", async () => {
    const { text } = await html(`/admin/payments/${await paymentId("DEMOLOW001")}`);
    expect(text).toContain("Flagged");
    expect(text).toContain("amount_too_low");
  });

  it("404s for an unknown id", async () => {
    expect((await html("/admin/payments/999999")).status).toBe(404);
  });
});

describe("GET /admin/payments/sms", () => {
  it("defaults to failed SMS", async () => {
    const { status, text } = await html("/admin/payments/sms");
    expect(status).toBe(200);
    expect(text).toContain("Demo garbage message");
    expect(text).not.toContain("Commercial Bank");
  });

  it("?status=ignored shows the bank SMS with its pattern, redacted", async () => {
    const { text } = await html("/admin/payments/sms?status=ignored");
    expect(text).toContain("Commercial Bank of Ethiopia");
    expect(text).toContain("bank-deposit-v1");
    expect(text).toContain(formatEat(NOW - 30 * MINUTE));
    expect(text).not.toContain("2,250.00");
    expect(text).not.toContain("Demo garbage message");
  });

  it("rejects other statuses", async () => {
    expect((await html("/admin/payments/sms?status=parsed")).status).toBe(400);
  });
});

describe("GET /admin/payments/orders", () => {
  it("shows DEMOUSED01's order with 1/3 downloads and its link status", async () => {
    const { status, text } = await html("/admin/payments/orders");
    expect(status).toBe(200);
    expect(text).toContain("DEMOUSED01");
    expect(text).toContain("1/3 downloads");
    expect(text).toContain("BYD Sealion 2026");
    expect(text).toContain("Auto");
    expect(text).toContain("Active");
  });

  it("shows 'manual' for an admin order without a payment, and each link status", async () => {
    const db = env.DB;
    const cases: [string, number, number, number | null][] = [
      ["Expired", 1, NOW - 1, null],
      ["Used up", 3, NOW + DAY, null],
      ["Revoked", 0, NOW + DAY, NOW],
    ];
    for (const [, count, expiresAt, revokedAt] of cases) {
      await db.batch([
        db.prepare(
          `INSERT INTO orders (manual_version_id, created_by, admin_note, created_at)
           SELECT id, 'admin', 'paid in cash', ${NOW} FROM manual_versions`,
        ),
        db
          .prepare(
            `INSERT INTO download_tokens (order_id, token_hash, expires_at, max_downloads, download_count, revoked_at, created_at)
             VALUES ((SELECT max(id) FROM orders), ?, ?, 3, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), expiresAt, count, revokedAt, NOW),
      ]);
    }
    const { text } = await html("/admin/payments/orders");
    expect(text).toContain("manual");
    expect(text).toContain("Admin");
    for (const [label] of cases) expect(text).toContain(`<td>${label}</td>`);
  });

  it("rejects a malformed cursor", async () => {
    expect((await html("/admin/payments/orders?before=abc")).status).toBe(400);
  });
});

describe("payer data stays on /admin", () => {
  it("never appears on public pages or the public API", async () => {
    for (const path of ["/", "/m/byd-sealion-2026", "/api/models"]) {
      const res = await SELF.fetch(`https://example.com${path}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(PAYER);
      expect(text).not.toContain("2519****");
    }
  });
});
