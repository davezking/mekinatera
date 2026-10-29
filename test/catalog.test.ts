import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const T = 1_700_000_000_000;
const BASE = "https://example.com";

type SeedModel = {
  slug: string;
  name: string;
  year: string;
  sort: number;
  visible?: 0 | 1;
  imageKey?: string | null;
  version?: { r2Key: string | null; visible?: 0 | 1; fileSize?: number | null } | null;
};

const MODELS: SeedModel[] = [
  {
    slug: "byd-sealion-2026",
    name: "BYD Sealion",
    year: "2026",
    sort: 2,
    imageKey: "images/byd-sealion-2026-1.png",
    version: { r2Key: "manuals/byd-sealion-2026-en-demo.pdf", fileSize: 12_582_912 },
  },
  {
    slug: "byd-e2-2025",
    name: "BYD E2",
    year: "2025",
    sort: 1,
    version: { r2Key: "manuals/byd-e2-2025-en-demo.pdf", fileSize: 639 },
  },
  {
    slug: "byd-dolphin-2025",
    name: "BYD Dolphin",
    year: "2025",
    sort: 3,
    version: { r2Key: null },
  },
  {
    slug: "byd-han-2024",
    name: "BYD Han",
    year: "2024",
    sort: 4,
    visible: 0,
    version: { r2Key: "manuals/byd-han-2024-en-demo.pdf" },
  },
  {
    slug: "byd-seal-2025",
    name: "BYD Seal",
    year: "2025",
    sort: 5,
    version: { r2Key: "manuals/byd-seal-2025-en-demo.pdf", visible: 0 },
  },
  { slug: "byd-tang-2025", name: "BYD Tang", year: "2025", sort: 6, version: null },
];

async function seed() {
  const db = env.DB;
  await db.batch(
    ["download_tokens", "orders", "payments", "raw_sms", "manual_versions", "car_models"].map((t) =>
      db.prepare(`DELETE FROM ${t}`),
    ),
  );
  for (const m of MODELS) {
    await db
      .prepare(
        `INSERT INTO car_models (name, slug, model_year, image_key, is_visible, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(m.name, m.slug, m.year, m.imageKey ?? null, m.visible ?? 1, m.sort, T, T)
      .run();
    if (m.version) {
      await db
        .prepare(
          `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, file_size, is_visible, created_at, updated_at)
           SELECT id, 'en', 50000, ?, ?, ?, ?, ? FROM car_models WHERE slug = ?`,
        )
        .bind(m.version.r2Key, m.version.fileSize ?? null, m.version.visible ?? 1, T, T, m.slug)
        .run();
    }
  }
}

async function getText(path: string) {
  const res = await SELF.fetch(`${BASE}${path}`);
  return { res, text: await res.text() };
}

beforeEach(seed);

describe("GET / (catalog)", () => {
  it("lists visible models in sort order with the price (FR-1)", async () => {
    const { res, text } = await getText("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(text.startsWith("<!doctype html>")).toBe(true);
    const order = ["BYD E2", "BYD Sealion", "BYD Dolphin", "BYD Seal", "BYD Tang"].map((n) =>
      text.indexOf(`<h3>${n}</h3>`),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain('<span class="price">500 <span class="price__unit">ETB</span></span>');
    expect(text).toContain('href="/m/byd-e2-2025"');
    expect(text).toContain('href="/m/byd-sealion-2026"');
  });

  it("shows Coming soon without a link for models with no available PDF (FR-3)", async () => {
    const { text } = await getText("/");
    expect(text).toContain("Coming soon");
    expect(text).toContain("Translation in progress");
    for (const slug of ["byd-dolphin-2025", "byd-seal-2025", "byd-tang-2025"]) {
      expect(text).not.toContain(`/m/${slug}`);
    }
  });

  it("omits hidden models", async () => {
    const { text } = await getText("/");
    expect(text).not.toContain("BYD Han");
    expect(text).not.toContain("byd-han-2024");
  });

  it("uses the uploaded image or the placeholder", async () => {
    const { text } = await getText("/");
    expect(text).toContain('src="/media/images/byd-sealion-2026-1.png"');
    expect(text).toContain('src="/img/car-placeholder.svg"');
  });

  it("never exposes R2 manual keys", async () => {
    const { text } = await getText("/");
    expect(text).not.toContain("manuals/");
  });
});

describe("GET /m/:slug (checkout)", () => {
  it("shows the price, telebirr phone and name, steps, notice and hint (FR-4, FR-5)", async () => {
    const { res, text } = await getText("/m/byd-sealion-2026");
    expect(res.status).toBe(200);
    expect(text).toContain("BYD Sealion (2026)");
    expect(text).toContain("English owner&#39;s manual · PDF · 12 MB");
    expect(text).toContain('<span class="price">500 <span class="price__unit">ETB</span></span>');
    expect(text).toContain("Send exactly <strong>500 ETB</strong> to:");
    expect(text).toContain('<span class="phone-box__number">0900 000 000</span>');
    expect(text).toContain('data-copy="0900000000"');
    expect(text).toContain("telebirr shows: <strong>Test Account</strong>");
    expect(text.match(/<span class="step-num">\d<\/span>/g)).toHaveLength(4);
    expect(text).toContain("<strong>telebirr to telebirr only.</strong>");
    expect(text).toContain('id="txn-hint"');
    expect(text).toContain("It starts with <strong>D</strong> and has 10 letters and");
    expect(text).toContain("Paid but something went wrong?");
    expect(text).toContain('href="mailto:info@mekinatera.com"');
    expect(text).not.toContain("manuals/");
  });

  it("renders the claim form markup for P1-S3-T3", async () => {
    const { text } = await getText("/m/byd-sealion-2026");
    const versionId = await env.DB.prepare(
      "SELECT v.id FROM manual_versions v JOIN car_models m ON m.id = v.car_model_id WHERE m.slug = ?",
    )
      .bind("byd-sealion-2026")
      .first<number>("id");
    expect(text).toContain('<form id="claim-form"');
    expect(text).toMatch(/<input id="txn"[^>]*name="transactionNumber"/);
    expect(text).toContain('placeholder="D•••••••••"');
    expect(text).toContain('autocapitalize="characters"');
    expect(text).toContain('maxlength="14"');
    expect(text).toContain('aria-describedby="txn-hint"');
    // The hint is display-only: no pattern attribute that would require a leading D.
    expect(text).not.toMatch(/<input id="txn"[^>]*pattern=/);
    expect(text).toContain(`<input type="hidden" name="versionId" value="${versionId}"/>`);
    expect(text).toContain(
      '<div id="turnstile-slot" data-sitekey="1x00000000000000000000AA"></div>',
    );
    expect(text).toContain(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&amp;onload=onTurnstileLoad",
    );
    expect(text).toContain("Get my PDF");
    expect(text).toContain('<div id="claim-status" aria-live="polite"></div>');
    expect(text).toContain('<script type="module" src="/js/claim.js"></script>');
    expect(text).toContain('<script type="module" src="/js/copy.js"></script>');
  });

  it.each([
    ["hidden model", "/m/byd-han-2024"],
    ["no PDF", "/m/byd-dolphin-2025"],
    ["hidden version", "/m/byd-seal-2025"],
    ["no version", "/m/byd-tang-2025"],
    ["unknown slug", "/m/unknown"],
  ])("returns a 404 page for %s", async (_label, path) => {
    const { res, text } = await getText(path);
    expect(res.status).toBe(404);
    expect(text).toContain("Page not found");
    expect(text).not.toContain("phone-box");
  });
});

describe("GET /api/models", () => {
  it("returns the documented shape without hidden models", async () => {
    const res = await SELF.fetch(`${BASE}/api/models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.map((m) => m.slug)).toEqual([
      "byd-e2-2025",
      "byd-sealion-2026",
      "byd-dolphin-2025",
      "byd-seal-2025",
      "byd-tang-2025",
    ]);
    const sealion = body.find((m) => m.slug === "byd-sealion-2026");
    expect(sealion).toEqual({
      slug: "byd-sealion-2026",
      name: "BYD Sealion",
      modelYear: "2026",
      imageUrl: "/media/images/byd-sealion-2026-1.png",
      versions: [{ id: expect.any(Number), language: "en", priceEtb: 500, available: true }],
    });
    expect(body.find((m) => m.slug === "byd-dolphin-2025")).toMatchObject({
      imageUrl: null,
      versions: [{ available: false }],
    });
    expect(body.find((m) => m.slug === "byd-seal-2025")).toMatchObject({ versions: [] });
    expect(JSON.stringify(body)).not.toContain("manuals/");
    expect(JSON.stringify(body)).not.toContain("BYD Han");
  });
});

describe("GET /media/images/*", () => {
  it("streams an image from R2 with its content type and cache header", async () => {
    await env.MANUALS.put("images/byd-sealion-2026-1.png", new Uint8Array([137, 80, 78, 71]), {
      httpMetadata: { contentType: "image/png" },
    });
    const res = await SELF.fetch(`${BASE}/media/images/byd-sealion-2026-1.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("returns 404 for a missing image", async () => {
    const res = await SELF.fetch(`${BASE}/media/images/nope.png`);
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });

  it.each([
    "/media/images/manuals/x.pdf",
    "/media/images/%2e%2e/manuals/byd-e2-2025-en-demo.pdf",
    "/media/images/..%2Fmanuals%2Fbyd-e2-2025-en-demo.pdf",
    "/media/manuals/byd-e2-2025-en-demo.pdf",
  ])("never serves a manual PDF: %s", async (path) => {
    await env.MANUALS.put("manuals/byd-e2-2025-en-demo.pdf", "%PDF-1.4 secret");
    await env.MANUALS.put("images/manuals/x.pdf", "%PDF-1.4 secret");
    const res = await SELF.fetch(`${BASE}${path}`);
    const text = await res.text();
    expect(res.status).toBe(404);
    expect(text).not.toContain("%PDF");
  });
});
