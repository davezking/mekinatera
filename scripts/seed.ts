// Seeds demo data into a NON-production environment: car models, manual versions,
// placeholder PDFs and demo payments. Usage: tsx scripts/seed.ts --env local|staging
// It resets every table first, so it is safe to run repeatedly. It refuses production.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { redactSms } from "../src/lib/sms/redact";

type SeedEnv = "local" | "staging";

const TARGETS: Record<SeedEnv, { bucket: string; flags: string[] }> = {
  local: { bucket: "byd-manuals-dev", flags: ["--local"] },
  staging: { bucket: "byd-manuals-staging", flags: ["--remote", "--env", "staging"] },
};

export type SeedContext = { now: number };
/** A seed section returns SQL statements. Later phases append sections to SEED_SECTIONS. */
export type SeedSection = (ctx: SeedContext) => string[];

export type DemoModel = {
  slug: string;
  name: string;
  year: string;
  sortOrder: number;
  visible: boolean;
  /** false = version exists but has no PDF yet ("coming soon", FR-3). */
  hasPdf: boolean;
};

export const DEMO_MODELS: DemoModel[] = [
  { slug: "byd-e2-2025", name: "BYD E2", year: "2025", sortOrder: 1, visible: true, hasPdf: true },
  {
    slug: "byd-sealion-2026",
    name: "BYD Sealion",
    year: "2026",
    sortOrder: 2,
    visible: true,
    hasPdf: true,
  },
  {
    slug: "byd-dolphin-2025",
    name: "BYD Dolphin",
    year: "2025",
    sortOrder: 3,
    visible: true,
    hasPdf: false,
  },
  {
    slug: "byd-han-2024",
    name: "BYD Han",
    year: "2024",
    sortOrder: 4,
    visible: false,
    hasPdf: false,
  },
];

export const DEMO_PRICE_SANTIM = 50000;

export function demoPdfKey(slug: string): string {
  return `manuals/${slug}-en-demo.pdf`;
}

/** SQL string literal. Seed values are fixed demo data, but quote them properly anyway. */
export function sql(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`Not an integer: ${value}`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

// FK-safe order: children before parents.
const RESET_TABLES = [
  "download_tokens",
  "orders",
  "claim_attempts",
  "payments",
  "raw_sms",
  "manual_versions",
  "car_models",
  "system_status",
];

const resetSection: SeedSection = () => RESET_TABLES.map((t) => `DELETE FROM ${t};`);

/** A car model plus its `en` manual version, with the demo PDF's key and size if it has one. */
function modelInserts(m: DemoModel, priceSantim: number, now: number): string[] {
  const pdf = m.hasPdf ? demoPdf(m) : null;
  return [
    `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
VALUES (${sql(m.name)}, ${sql(m.slug)}, ${sql(m.year)}, ${m.visible ? 1 : 0}, ${m.sortOrder}, ${now}, ${now});`,
    `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, file_size, is_visible, created_at, updated_at)
SELECT id, 'en', ${priceSantim}, ${sql(pdf ? demoPdfKey(m.slug) : null)}, ${sql(pdf ? pdf.length : null)}, 1, ${now}, ${now}
FROM car_models WHERE slug = ${sql(m.slug)};`,
  ];
}

const catalogSection: SeedSection = ({ now }) =>
  DEMO_MODELS.flatMap((m) => modelInserts(m, DEMO_PRICE_SANTIM, now));

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type DemoPayment = {
  txn: string;
  amountEtb: number;
  /** Milliseconds before the seed run. */
  ago: number;
  /** Claimed payments also get an auto order and a used-once download token. */
  claimed: boolean;
};

/** Fixed demo transaction numbers used by docs/phases/phase-1-demo.md and the E2E tests. */
export const DEMO_PAYMENTS: DemoPayment[] = [
  { txn: "DEMOPAY001", amountEtb: 500, ago: 5 * MINUTE, claimed: false }, // demo happy path
  { txn: "DEMOPAY002", amountEtb: 500, ago: 5 * MINUTE, claimed: false }, // E2E, one per test
  { txn: "DEMOPAY003", amountEtb: 500, ago: 5 * MINUTE, claimed: false },
  { txn: "DEMOPAY004", amountEtb: 500, ago: 5 * MINUTE, claimed: false },
  { txn: "DEMOPAY005", amountEtb: 500, ago: 5 * MINUTE, claimed: false },
  { txn: "DEMOLOW001", amountEtb: 300, ago: 5 * MINUTE, claimed: false }, // amount too low
  { txn: "DEMOOLD001", amountEtb: 500, ago: 10 * DAY, claimed: false }, // expired
  { txn: "DEMOUSED01", amountEtb: 500, ago: 1 * DAY, claimed: true }, // already used
];

/** UTC ms → "DD/MM/YYYY HH:mm:ss" in Ethiopia time (UTC+3), as telebirr writes it. */
export function eatDate(ms: number): string {
  const d = new Date(ms + 3 * 60 * MINUTE);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function paymentSms(p: {
  txn: string;
  amountEtb: number;
  name: string;
  phone: string;
  paidAt: number;
}) {
  return `Dear Customer You have received ETB ${p.amountEtb.toFixed(2)} from ${p.name}(${p.phone}) on ${eatDate(p.paidAt)}. Your transaction number is ${p.txn}. Your current E-Money Account balance is ETB 1,250.00. Thank you for using telebirr`;
}

function rawSmsInsert(
  body: string,
  receivedAt: number,
  status: string,
  patternId: string | null,
  now: number,
) {
  return `INSERT INTO raw_sms (sender, body, received_at, parse_status, pattern_id, created_at)
VALUES ('127', ${sql(redactSms(body))}, ${receivedAt}, ${sql(status)}, ${sql(patternId)}, ${now});`;
}

const phase1Payments: SeedSection = ({ now }) => {
  const statements = DEMO_PAYMENTS.flatMap((p, i) => {
    const n = String(i + 1).padStart(4, "0");
    const name = `Demo Buyer ${i + 1}`;
    const phone = `2519****${n}`;
    const paidAt = now - p.ago;
    const out = [
      rawSmsInsert(
        paymentSms({ ...p, name, phone, paidAt }),
        paidAt + 5000,
        "parsed",
        "t2t-received-v1",
        now,
      ),
      `INSERT INTO payments (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, raw_sms_id, status, claimed_at, claim_ref, created_at)
VALUES (${sql(p.txn)}, ${p.amountEtb * 100}, ${sql(name)}, ${sql(phone)}, ${paidAt}, (SELECT max(id) FROM raw_sms),
  ${sql(p.claimed ? "claimed" : "unclaimed")}, ${p.claimed ? paidAt + MINUTE : "NULL"}, ${sql(p.claimed ? randomBytes(32).toString("base64url") : null)}, ${paidAt + 5000});`,
    ];
    if (p.claimed) {
      // The raw token is thrown away: this link exists only to show "already used" on claim.
      const tokenHash = createHash("sha256")
        .update(randomBytes(32).toString("base64url"))
        .digest("hex");
      out.push(
        `INSERT INTO orders (payment_id, manual_version_id, created_by, created_at)
SELECT p.id, v.id, 'auto', ${paidAt + MINUTE} FROM payments p, manual_versions v JOIN car_models m ON m.id = v.car_model_id
WHERE p.transaction_number = ${sql(p.txn)} AND m.slug = 'byd-sealion-2026';`,
        `INSERT INTO download_tokens (order_id, token_hash, expires_at, max_downloads, download_count, created_at)
SELECT o.id, ${sql(tokenHash)}, ${paidAt + MINUTE + DAY}, 3, 1, ${paidAt + MINUTE}
FROM orders o JOIN payments p ON p.id = o.payment_id WHERE p.transaction_number = ${sql(p.txn)};`,
      );
    }
    return out;
  });
  // Non-payment SMS for Phase 2's admin lists.
  statements.push(
    rawSmsInsert(
      `Dear Customer You have received ETB 1,000.00 from Commercial Bank of Ethiopia on ${eatDate(now - 30 * MINUTE)} by transaction number FT26DEMO0001. Your current E-Money Account balance is ETB 2,250.00. Thank you for using telebirr`,
      now - 30 * MINUTE,
      "ignored",
      "bank-deposit-v1",
      now,
    ),
    rawSmsInsert(
      "Demo garbage message that matches no telebirr pattern.",
      now - 20 * MINUTE,
      "failed",
      null,
      now,
    ),
  );
  return statements;
};

const HOUR = 60 * MINUTE;

export type LinkState = "active" | "expired" | "used_up" | "revoked";

export type HistoryPayment = { txn: string; daysAgo: number; slug: string; link: LinkState };

/** Claimed payments over the last 20 days, so the admin lists and pagination look real. */
export const HISTORY_PAYMENTS: HistoryPayment[] = [
  { txn: "DEMOHIST01", daysAgo: 0.2, slug: "byd-sealion-2026", link: "active" },
  { txn: "DEMOHIST02", daysAgo: 0.6, slug: "byd-e2-2025", link: "active" },
  { txn: "DEMOHIST03", daysAgo: 1.5, slug: "byd-sealion-2026", link: "used_up" },
  { txn: "DEMOHIST04", daysAgo: 2.5, slug: "byd-e2-2025", link: "expired" },
  { txn: "DEMOHIST05", daysAgo: 4, slug: "byd-sealion-2026", link: "revoked" },
  { txn: "DEMOHIST06", daysAgo: 5.5, slug: "byd-sealion-2026", link: "expired" },
  { txn: "DEMOHIST07", daysAgo: 7, slug: "byd-e2-2025", link: "used_up" },
  { txn: "DEMOHIST08", daysAgo: 9, slug: "byd-sealion-2026", link: "expired" },
  { txn: "DEMOHIST09", daysAgo: 11.5, slug: "byd-e2-2025", link: "revoked" },
  { txn: "DEMOHIST10", daysAgo: 14, slug: "byd-sealion-2026", link: "expired" },
  { txn: "DEMOHIST11", daysAgo: 17, slug: "byd-sealion-2026", link: "used_up" },
  { txn: "DEMOHIST12", daysAgo: 19.5, slug: "byd-e2-2025", link: "expired" },
];

/** A throwaway token hash: these seeded links are for the lists only and can never be opened. */
function seedTokenHash(): string {
  return createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex");
}

/**
 * download_tokens values for a link created at `createdAt` that is in `state` at `now`. Each link
 * lasts 24 h, so "active" needs createdAt within the last day and "expired" an older one.
 */
function tokenFor(state: LinkState, createdAt: number) {
  const expiresAt = createdAt + DAY;
  if (state === "used_up") return { expiresAt, count: 3, revokedAt: null };
  if (state === "revoked") return { expiresAt, count: 0, revokedAt: createdAt + 2 * HOUR };
  return { expiresAt, count: 1, revokedAt: null };
}

function tokenInsert(orderSql: string, state: LinkState, createdAt: number) {
  const t = tokenFor(state, createdAt);
  return `INSERT INTO download_tokens (order_id, token_hash, expires_at, max_downloads, download_count, revoked_at, created_at)
SELECT o.id, ${sql(seedTokenHash())}, ${t.expiresAt}, 3, ${t.count}, ${sql(t.revokedAt)}, ${createdAt}
FROM ${orderSql};`;
}

/** Phase 2 admin demo (docs/phases/phase-2-demo.md). Phase 1 transaction numbers stay as they are. */
const phase2Admin: SeedSection = ({ now }) => {
  const out: string[] = [];
  const payment = (
    txn: string,
    amountEtb: number,
    n: number,
    paidAt: number,
    status: "flagged" | "claimed",
  ) => {
    const name = `Demo Buyer ${n}`;
    const phone = `2519****${String(n).padStart(4, "0")}`;
    out.push(
      rawSmsInsert(
        paymentSms({ txn, amountEtb, name, phone, paidAt }),
        paidAt + 5000,
        "parsed",
        "t2t-received-v1",
        now,
      ),
      `INSERT INTO payments (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, raw_sms_id, status, claimed_at, claim_ref, flag_reason, created_at)
VALUES (${sql(txn)}, ${amountEtb * 100}, ${sql(name)}, ${sql(phone)}, ${paidAt}, (SELECT max(id) FROM raw_sms),
  ${sql(status)}, ${status === "claimed" ? paidAt + MINUTE : "NULL"}, ${sql(status === "claimed" ? randomBytes(32).toString("base64url") : null)},
  ${sql(status === "flagged" ? "amount_too_low" : null)}, ${paidAt + 5000});`,
    );
  };

  // Underpaid and already flagged, ready for "Approve for…" (demo step 11).
  payment("DEMOFLAG01", 300, 20, now - 40 * MINUTE, "flagged");

  for (const [i, h] of HISTORY_PAYMENTS.entries()) {
    const paidAt = now - Math.round(h.daysAgo * DAY);
    const orderedAt = paidAt + MINUTE;
    payment(h.txn, 500, 21 + i, paidAt, "claimed");
    out.push(
      `INSERT INTO orders (payment_id, manual_version_id, created_by, created_at)
SELECT p.id, v.id, 'auto', ${orderedAt} FROM payments p, manual_versions v JOIN car_models m ON m.id = v.car_model_id
WHERE p.transaction_number = ${sql(h.txn)} AND m.slug = ${sql(h.slug)} AND v.language = 'en';`,
      tokenInsert(
        `orders o JOIN payments p ON p.id = o.payment_id WHERE p.transaction_number = ${sql(h.txn)}`,
        h.link,
        orderedAt,
      ),
    );
  }

  // An admin order without a payment (FR-26).
  const manualAt = now - 3 * HOUR;
  out.push(
    `INSERT INTO orders (payment_id, manual_version_id, created_by, admin_note, created_at)
SELECT NULL, v.id, 'admin', 'Demo: paid from bank app, checked the statement', ${manualAt}
FROM manual_versions v JOIN car_models m ON m.id = v.car_model_id WHERE m.slug = 'byd-e2-2025' AND v.language = 'en';`,
    tokenInsert(
      "orders o WHERE o.payment_id IS NULL AND o.created_by = 'admin'",
      "active",
      manualAt,
    ),
  );

  // Phone checked in 10 minutes ago: the banner is green for the next 35 minutes.
  const beat = now - 10 * MINUTE;
  out.push(
    `INSERT INTO system_status (key, value, updated_at) VALUES ('last_heartbeat_at', ${sql(String(beat))}, ${beat}), ('battery', '76', ${beat});`,
  );

  out.push(
    rawSmsInsert(
      "Congratulations! You have won a prize. Send your PIN to claim it now.",
      now - 2 * HOUR,
      "failed",
      null,
      now,
    ),
    rawSmsInsert(
      "Dear Customer telebirr service will be unavailable tonight from 01:00 to 03:00 for maintenance.",
      now - 26 * HOUR,
      "failed",
      null,
      now,
    ),
    rawSmsInsert(
      `Dear Customer You have recharged airtime of ETB 50.00 on ${eatDate(now - 5 * HOUR)}. Your current E-Money Account balance is ETB 1,200.00. Thank you for using telebirr`,
      now - 5 * HOUR,
      "ignored",
      "airtime-v1",
      now,
    ),
  );
  return out;
};

/** The 1 ETB rehearsal product from the launch checklist's Q1b gate (docs/phases/phase-3-demo.md). */
export const TEST_PRODUCT: DemoModel = {
  slug: "test-product",
  name: "Test product",
  year: "—",
  sortOrder: 99,
  visible: true,
  hasPdf: true,
};

export const TEST_PRICE_SANTIM = 100;

/** The IP that E2E tests send as X-Test-Client-IP (honoured only in development). */
export const RATE_LIMIT_DEMO_IP = "203.0.113.7";

/** Phase 3 launch demo: the 1 ETB product, its payment, and an IP close to the rate limit. */
const phase3Launch: SeedSection = ({ now }) => {
  const paidAt = now - 5 * MINUTE;
  const name = "Demo Buyer 40";
  const phone = "2519****0040";
  const out = [
    ...modelInserts(TEST_PRODUCT, TEST_PRICE_SANTIM, now),
    rawSmsInsert(
      paymentSms({ txn: "DEMOONE001", amountEtb: 1, name, phone, paidAt }),
      paidAt + 5000,
      "parsed",
      "t2t-received-v1",
      now,
    ),
    `INSERT INTO payments (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, raw_sms_id, status, created_at)
VALUES ('DEMOONE001', ${TEST_PRICE_SANTIM}, ${sql(name)}, ${sql(phone)}, ${paidAt}, (SELECT max(id) FROM raw_sms), 'unclaimed', ${paidAt + 5000});`,
  ];
  // 9 of the default 10 per 10 minutes: the next try passes and the one after is RATE_LIMITED.
  for (let i = 0; i < 9; i++) {
    out.push(
      `INSERT INTO claim_attempts (transaction_number_input, manual_version_id, ip, result_code, created_at)
VALUES (${sql(`GUESS${String(i + 1).padStart(5, "0")}`)}, NULL, ${sql(RATE_LIMIT_DEMO_IP)}, 'NOT_FOUND', ${now - (5 * MINUTE - i * 30_000)});`,
    );
  }
  return out;
};

export const SEED_SECTIONS: SeedSection[] = [
  resetSection,
  catalogSection,
  phase1Payments,
  phase2Admin,
  phase3Launch,
];

/** A minimal valid one-page PDF 1.4 with a single line of text. */
export function demoPdf(m: Pick<DemoModel, "name" | "year">): Buffer {
  // \x97 is the em dash in WinAnsiEncoding (Buffer latin1 would keep only the low byte of U+2014).
  const text = `DEMO \x97 ${m.name} (${m.year}) owner's manual`
    .replaceAll("—", "\x97")
    .replace(/[\\()]/g, "\\$&");
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function parseEnv(argv: string[]): SeedEnv {
  const i = argv.indexOf("--env");
  const env = i >= 0 ? argv[i + 1] : undefined;
  if (env === "local" || env === "staging") return env;
  console.error(
    `seed: refusing to run with --env ${JSON.stringify(env ?? null)}. Use --env local or --env staging (never production).`,
  );
  process.exit(1);
}

function wrangler(args: string[]): void {
  execFileSync("pnpm", ["wrangler", ...args], { stdio: "inherit" });
}

function main(): void {
  const env = parseEnv(process.argv.slice(2));
  const target = TARGETS[env];
  const seedDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "seed");
  const pdfDir = join(seedDir, ".pdf");
  mkdirSync(pdfDir, { recursive: true });

  for (const m of [...DEMO_MODELS, TEST_PRODUCT].filter((model) => model.hasPdf)) {
    const file = join(pdfDir, `${m.slug}-en-demo.pdf`);
    writeFileSync(file, demoPdf(m));
    wrangler([
      "r2",
      "object",
      "put",
      `${target.bucket}/${demoPdfKey(m.slug)}`,
      "--file",
      file,
      "--content-type",
      "application/pdf",
      ...target.flags,
    ]);
  }

  const ctx: SeedContext = { now: Date.now() };
  const sqlFile = join(seedDir, ".generated.sql");
  writeFileSync(sqlFile, `${SEED_SECTIONS.flatMap((section) => section(ctx)).join("\n")}\n`);
  wrangler(["d1", "execute", "DB", "--file", sqlFile, ...target.flags]);
  console.log(JSON.stringify({ event: "seed_done", env }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
