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
];

const resetSection: SeedSection = () => RESET_TABLES.map((t) => `DELETE FROM ${t};`);

const catalogSection: SeedSection = ({ now }) =>
  DEMO_MODELS.flatMap((m) => {
    const pdf = m.hasPdf ? demoPdf(m) : null;
    return [
      `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
VALUES (${sql(m.name)}, ${sql(m.slug)}, ${sql(m.year)}, ${m.visible ? 1 : 0}, ${m.sortOrder}, ${now}, ${now});`,
      `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, file_size, is_visible, created_at, updated_at)
SELECT id, 'en', ${DEMO_PRICE_SANTIM}, ${sql(pdf ? demoPdfKey(m.slug) : null)}, ${sql(pdf ? pdf.length : null)}, 1, ${now}, ${now}
FROM car_models WHERE slug = ${sql(m.slug)};`,
    ];
  });

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

export const SEED_SECTIONS: SeedSection[] = [resetSection, catalogSection, phase1Payments];

/** A minimal valid one-page PDF 1.4 with a single line of text. */
export function demoPdf(m: Pick<DemoModel, "name" | "year">): Buffer {
  // \x97 is the em dash in WinAnsiEncoding.
  const text = `DEMO \x97 ${m.name} (${m.year}) owner's manual`.replace(/[\\()]/g, "\\$&");
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

  for (const m of DEMO_MODELS.filter((model) => model.hasPdf)) {
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
