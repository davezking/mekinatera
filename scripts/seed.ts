// Seeds demo data into a NON-production environment: car models, manual versions and
// placeholder PDFs. Usage: tsx scripts/seed.ts --env local|staging
// It resets every table first, so it is safe to run repeatedly. It refuses production.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

export const SEED_SECTIONS: SeedSection[] = [resetSection, catalogSection];

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
