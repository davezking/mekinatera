import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrderWithToken } from "../src/lib/claim";
import { HOUR } from "../src/lib/time";
import { hashToken } from "../src/lib/token";
import { parseRange, pdfFilename } from "../src/routes/download";

const BASE = "https://example.com";
const R2_KEY = "manuals/byd-sealion-2026-en-demo.pdf";
const PDF = new TextEncoder().encode(`%PDF-1.4\n${"x".repeat(300)}\n%%EOF\n`);

let versionId: number;
let logs: string[];

async function newToken() {
  return createOrderWithToken(env, {
    paymentId: null,
    versionId,
    createdBy: "admin",
    adminNote: null,
    now: Date.now(),
  });
}

async function count(token: string) {
  return env.DB.prepare("SELECT download_count FROM download_tokens WHERE token_hash = ?")
    .bind(await hashToken(token))
    .first<number>("download_count");
}

function get(token: string, headers: Record<string, string> = {}) {
  return SELF.fetch(`${BASE}/d/${token}`, { headers });
}

async function expectExpired(res: Response) {
  expect(res.status).toBe(410);
  expect(res.headers.get("Content-Type")).toContain("text/html");
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  const text = await res.text();
  expect(text).toContain("This download link has expired");
  expect(text).toContain("Links work for 24 hours and up to 3 downloads.");
  expect(text).toContain("Already paid?");
  expect(text).toContain('href="mailto:info@mekinatera.com"');
  expect(text).toContain("Back to manuals");
  expect(text).not.toContain("%PDF");
}

beforeEach(async () => {
  await env.DB.batch(
    [
      "claim_attempts",
      "download_tokens",
      "orders",
      "payments",
      "manual_versions",
      "car_models",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  await env.DB.prepare(
    `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
     VALUES ('BYD Sealion', 'byd-sealion-2026', '2026', 1, 1, 0, 0)`,
  ).run();
  versionId = (await env.DB.prepare(
    `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, is_visible, created_at, updated_at)
     SELECT id, 'en', 50000, ?, 1, 0, 0 FROM car_models RETURNING id`,
  )
    .bind(R2_KEY)
    .first<number>("id")) as number;
  await env.MANUALS.put(R2_KEY, PDF);
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /d/:token", () => {
  it("streams the PDF with download headers and counts it (FR-18, FR-20)", async () => {
    const token = await newToken();
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="BYD-Sealion-2026-EN.pdf"',
    );
    expect(res.headers.get("Content-Length")).toBe(String(PDF.byteLength));
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect(await count(token)).toBe(1);
  });

  it("allows 3 full downloads, then shows the expired page (FR-19)", async () => {
    const token = await newToken();
    for (let i = 1; i <= 3; i++) {
      const res = await get(token);
      expect(res.status, `download ${i}`).toBe(200);
      await res.arrayBuffer();
      expect(await count(token)).toBe(i);
    }
    await expectExpired(await get(token));
    expect(await count(token)).toBe(3);
  });

  it("counts a range starting at 0 as a download", async () => {
    const token = await newToken();
    const res = await get(token, { Range: "bytes=0-99" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-99/${PDF.byteLength}`);
    expect(res.headers.get("Content-Length")).toBe("100");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF.slice(0, 100));
    expect(await count(token)).toBe(1);
  });

  it("serves a resumed range (bytes=100-) with 206 without counting it", async () => {
    const token = await newToken();
    const res = await get(token, { Range: "bytes=100-" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(
      `bytes 100-${PDF.byteLength - 1}/${PDF.byteLength}`,
    );
    expect(res.headers.get("Content-Length")).toBe(String(PDF.byteLength - 100));
    expect(res.headers.get("Content-Disposition")).toContain("BYD-Sealion-2026-EN.pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF.slice(100));
    expect(await count(token)).toBe(0);
  });

  it("clamps a range end past the file size", async () => {
    const token = await newToken();
    const res = await get(token, { Range: "bytes=300-99999" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(
      `bytes 300-${PDF.byteLength - 1}/${PDF.byteLength}`,
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF.slice(300));
  });

  it("returns 416 for a range that starts past the end", async () => {
    const token = await newToken();
    const res = await get(token, { Range: `bytes=${PDF.byteLength}-` });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe(`bytes */${PDF.byteLength}`);
    expect(await count(token)).toBe(0);
  });

  it("treats an unsupported Range header as a full, counted download", async () => {
    const token = await newToken();
    const res = await get(token, { Range: "bytes=-100" });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect(await count(token)).toBe(1);
  });

  it("rejects an expired token, even for a resumed range", async () => {
    const token = await newToken();
    await env.DB.prepare("UPDATE download_tokens SET expires_at = ?")
      .bind(Date.now() - HOUR)
      .run();
    await expectExpired(await get(token));
    await expectExpired(await get(token, { Range: "bytes=100-" }));
    expect(await count(token)).toBe(0);
  });

  it("rejects a revoked token, even for a resumed range", async () => {
    const token = await newToken();
    await env.DB.prepare("UPDATE download_tokens SET revoked_at = ?").bind(Date.now()).run();
    await expectExpired(await get(token));
    await expectExpired(await get(token, { Range: "bytes=100-" }));
  });

  it("rejects an unknown, well-formed token", async () => {
    await expectExpired(await get("A".repeat(43)));
  });

  it.each(["abc", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}+`, `${"A".repeat(42)}%3D`])(
    "rejects malformed %j without a DB query",
    async (token) => {
      const prepare = vi.spyOn(env.DB, "prepare");
      await expectExpired(await get(token));
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it("shows an error page and logs r2_missing when the PDF is gone", async () => {
    const token = await newToken();
    await env.MANUALS.delete(R2_KEY);
    const res = await get(token);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Something went wrong");
    expect(logs).toContain(JSON.stringify({ event: "r2_missing", versionId }));
  });

  it("logs only the order id and count", async () => {
    const token = await newToken();
    await (await get(token)).arrayBuffer();
    const events = logs.filter((l) => l.includes('"download"'));
    expect(events).toHaveLength(1);
    expect(Object.keys(JSON.parse(events[0] as string)).sort()).toEqual([
      "count",
      "event",
      "orderId",
    ]);
    expect(logs.join("\n")).not.toContain(token);
  });

  it.each([
    "/d",
    "/d/",
    `/d/../${R2_KEY}`,
    `/${R2_KEY}`,
    `/media/${R2_KEY}`,
    `/media/images/../${R2_KEY}`,
  ])("never serves a manual without a token: %s", async (path) => {
    const res = await SELF.fetch(`${BASE}${path}`);
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain("%PDF");
  });
});

describe("pdfFilename", () => {
  it.each([
    ["BYD Sealion", "2026", "BYD-Sealion-2026-EN.pdf"],
    ["BYD Seal U DM-i", "2025", "BYD-Seal-U-DM-i-2025-EN.pdf"],
    ["Song Plus", "2024", "BYD-Song-Plus-2024-EN.pdf"],
    ['BYD "Han" ÉV/2', "2024", "BYD-Han-EV2-2024-EN.pdf"],
  ])("%s %s → %s", (name, year, expected) => {
    expect(pdfFilename(name, year)).toBe(expected);
  });
});

describe("parseRange", () => {
  it.each([
    [undefined, null],
    ["bytes=0-", { start: 0, end: undefined }],
    ["bytes=100-", { start: 100, end: undefined }],
    ["bytes=0-99", { start: 0, end: 99 }],
    ["bytes=-100", null],
    ["bytes=5-1", null],
    ["bytes=0-1,5-9", null],
    ["items=0-1", null],
  ])("%j → %j", (header, expected) => {
    expect(parseRange(header)).toEqual(expected);
  });
});
