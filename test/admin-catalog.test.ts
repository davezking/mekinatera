import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { slugify } from "../src/routes/admin/catalog";
import { adminFetch } from "./helpers/admin";

const ORIGIN = "http://localhost";

function post(path: string, fields: Record<string, string>) {
  return adminFetch(path, {
    method: "POST",
    headers: { Origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function publicText(path: string) {
  const res = await SELF.fetch(`https://example.com${path}`);
  return { status: res.status, text: await res.text() };
}

async function counts() {
  const [m, v] = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT COUNT(*) AS n FROM car_models"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM manual_versions"),
  ]);
  return { models: m?.results[0]?.n, versions: v?.results[0]?.n };
}

let sealionId: number;

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
       VALUES ('BYD Sealion', 'byd-sealion-2026', '2026', 1, 2, 0, 0)`,
    ),
    db.prepare(
      `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
       VALUES ('BYD Han', 'byd-han-2024', '2024', 0, 4, 0, 0)`,
    ),
    db.prepare(
      `INSERT INTO manual_versions (car_model_id, language, price_santim, r2_key, is_visible, created_at, updated_at)
       SELECT id, 'en', 50000, 'manuals/byd-sealion-2026-en-demo.pdf', 1, 0, 0 FROM car_models WHERE slug = 'byd-sealion-2026'`,
    ),
  ]);
  sealionId = (await db
    .prepare("SELECT id FROM car_models WHERE slug = 'byd-sealion-2026'")
    .first<number>("id")) as number;
});

const NEW_MODEL = {
  name: "BYD Atto 3",
  slug: "",
  modelYear: "2025",
  sortOrder: "5",
  visible: "1",
  price: "450",
};

describe("GET /admin/catalog", () => {
  it("lists every model, hidden ones too, with price and PDF status", async () => {
    const res = await adminFetch("/admin/catalog");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("BYD Sealion");
    expect(html).toContain("BYD Han");
    expect(html).toContain("Hidden");
    expect(html).toContain("500 ETB");
    expect(html).toContain("Uploaded");
    expect(html).toContain("Missing");
    expect(html).toContain(`href="/admin/catalog/${sealionId}"`);
    expect(html).toContain('href="/admin/catalog/new"');
  });

  it("shows the new-model form", async () => {
    const html = await (await adminFetch("/admin/catalog/new")).text();
    expect(html).toContain('action="/admin/catalog"');
    expect(html).toContain('name="price"');
    expect(html).toContain("Language: English");
  });
});

describe("create", () => {
  it("creates a model and its en version; the public catalog shows Coming soon (FR-24, FR-3)", async () => {
    const res = await post("/admin/catalog", NEW_MODEL);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin/catalog?created=1");

    const row = await env.DB.prepare(
      `SELECT m.slug, m.model_year, m.sort_order, m.is_visible, v.language, v.price_santim, v.r2_key, v.is_visible AS vv
       FROM car_models m JOIN manual_versions v ON v.car_model_id = m.id WHERE m.name = 'BYD Atto 3'`,
    ).first();
    expect(row).toEqual({
      slug: "byd-atto-3-2025",
      model_year: "2025",
      sort_order: 5,
      is_visible: 1,
      language: "en",
      price_santim: 45000,
      r2_key: null,
      vv: 1,
    });

    const list = await (await adminFetch("/admin/catalog?created=1")).text();
    expect(list).toContain("Model created.");

    const { text } = await publicText("/");
    expect(text).toContain("<h3>BYD Atto 3</h3>");
    expect(text).not.toContain('href="/m/byd-atto-3-2025"');
    expect((await publicText("/m/byd-atto-3-2025")).status).toBe(404);
  });

  it("uses a hand-entered slug", async () => {
    await post("/admin/catalog", { ...NEW_MODEL, slug: "atto-3" });
    const slug = await env.DB.prepare(
      "SELECT slug FROM car_models WHERE name = 'BYD Atto 3'",
    ).first("slug");
    expect(slug).toBe("atto-3");
  });

  it.each([
    ["an invalid slug", { slug: "BAD SLUG!" }, "slug", "lowercase letters"],
    ["a duplicate slug", { slug: "byd-sealion-2026" }, "slug", "already uses this slug"],
    ["an empty name", { name: "" }, "name", "Enter a name."],
    ["an empty year", { modelYear: "" }, "modelYear", "Enter the model year."],
    ["a year over 20 characters", { modelYear: "x".repeat(21) }, "modelYear", "20 characters"],
    ["a zero price", { price: "0" }, "price", "more than 0"],
    ["a negative price", { price: "-5" }, "price", "Enter a number"],
    ["a non-numeric price", { price: "abc" }, "price", "Enter a number"],
    ["an empty price", { price: "" }, "price", "Enter a price."],
    ["a price over 100,000 ETB", { price: "100000.01" }, "price", "at most 100,000 ETB"],
    ["a fractional sort order", { sortOrder: "1.5" }, "sortOrder", "whole number"],
  ])(
    "rejects %s, re-renders the form and saves nothing",
    async (_label, change, field, message) => {
      const res = await post("/admin/catalog", { ...NEW_MODEL, ...change });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Nothing was saved.");
      expect(html).toContain(message);
      expect(html).toMatch(new RegExp(`id="${field}"[^>]*aria-invalid="true"`));
      // Entered values come back.
      expect(html).toContain(
        `value="${(change as Record<string, string>).name ?? NEW_MODEL.name}"`,
      );
      expect(await counts()).toEqual({ models: 2, versions: 1 });
    },
  );

  it("escapes entered values", async () => {
    const res = await post("/admin/catalog", {
      ...NEW_MODEL,
      name: '<script>alert("x")</script>',
      price: "",
    });
    const html = await res.text();
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("edit", () => {
  const SEALION = {
    name: "BYD Sealion",
    slug: "byd-sealion-2026",
    modelYear: "2026",
    sortOrder: "2",
    visible: "1",
    price: "500",
    versionVisible: "1",
  };

  it("shows the edit form with current values and the uploads placeholder", async () => {
    const html = await (await adminFetch(`/admin/catalog/${sealionId}`)).text();
    expect(html).toContain('value="BYD Sealion"');
    expect(html).toContain('value="byd-sealion-2026"');
    expect(html).toContain('value="500"');
    expect(html).toContain('id="uploads"');
    expect(html).toContain("PDF: uploaded");
  });

  it("changes the price; checkout shows it immediately (FR-2)", async () => {
    const res = await post(`/admin/catalog/${sealionId}`, { ...SEALION, price: "600" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin/catalog?saved=1");
    const { text } = await publicText("/m/byd-sealion-2026");
    expect(text).toContain('<span class="price">600 <span class="price__unit">ETB</span></span>');
    expect(text).toContain("Send exactly <strong>600 ETB</strong>");
    const updated = await env.DB.prepare(
      "SELECT price_santim, updated_at FROM manual_versions",
    ).first<{
      price_santim: number;
      updated_at: number;
    }>();
    expect(updated?.price_santim).toBe(60000);
    expect(updated?.updated_at).toBeGreaterThan(0);
  });

  it("accepts a price with santim", async () => {
    await post(`/admin/catalog/${sealionId}`, { ...SEALION, price: "450.50" });
    expect(
      await env.DB.prepare("SELECT price_santim FROM manual_versions").first("price_santim"),
    ).toBe(45050);
  });

  it("hides and unhides a model", async () => {
    const { visible: _drop, ...hidden } = SEALION;
    await post(`/admin/catalog/${sealionId}`, hidden);
    expect((await publicText("/")).text).not.toContain("BYD Sealion");
    expect((await publicText("/m/byd-sealion-2026")).status).toBe(404);

    await post(`/admin/catalog/${sealionId}`, SEALION);
    expect((await publicText("/")).text).toContain("BYD Sealion");
    expect((await publicText("/m/byd-sealion-2026")).status).toBe(200);
  });

  it("hides the version", async () => {
    const { versionVisible: _drop, ...hidden } = SEALION;
    await post(`/admin/catalog/${sealionId}`, hidden);
    expect((await publicText("/m/byd-sealion-2026")).status).toBe(404);
  });

  it("creates the en version for a model that has none", async () => {
    const hanId = await env.DB.prepare(
      "SELECT id FROM car_models WHERE slug = 'byd-han-2024'",
    ).first<number>("id");
    await post(`/admin/catalog/${hanId}`, {
      name: "BYD Han",
      slug: "byd-han-2024",
      modelYear: "2024",
      price: "500",
    });
    expect(await counts()).toEqual({ models: 2, versions: 2 });
  });

  it("keeps its own slug but rejects another model's", async () => {
    expect((await post(`/admin/catalog/${sealionId}`, SEALION)).status).toBe(303);
    const res = await post(`/admin/catalog/${sealionId}`, { ...SEALION, slug: "byd-han-2024" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("already uses this slug");
    expect(
      await env.DB.prepare("SELECT slug FROM car_models WHERE id = ?")
        .bind(sealionId)
        .first("slug"),
    ).toBe("byd-sealion-2026");
  });

  it("rejects an invalid price without saving", async () => {
    const res = await post(`/admin/catalog/${sealionId}`, {
      ...SEALION,
      name: "Renamed",
      price: "0",
    });
    expect(res.status).toBe(400);
    expect(
      await env.DB.prepare("SELECT name FROM car_models WHERE id = ?")
        .bind(sealionId)
        .first("name"),
    ).toBe("BYD Sealion");
  });

  it.each(["/admin/catalog/999999", "/admin/catalog/abc"])("returns 404 for %s", async (path) => {
    expect((await adminFetch(path)).status).toBe(404);
  });
});

describe("guards", () => {
  it("rejects a POST from another origin", async () => {
    const res = await adminFetch("/admin/catalog", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(NEW_MODEL).toString(),
    });
    expect(res.status).toBe(403);
    expect(await counts()).toEqual({ models: 2, versions: 1 });
  });
});

describe("slugify", () => {
  it.each([
    [["BYD Atto 3", "2025"], "byd-atto-3-2025"],
    [["  BYD   Seal U DM-i ", "2025"], "byd-seal-u-dm-i-2025"],
    [["Ëlan!", ""], "elan"],
  ])("%j → %s", (parts, slug) => {
    expect(slugify(...(parts as string[]))).toBe(slug);
  });
});
