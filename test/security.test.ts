import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { CONTENT_SECURITY_POLICY } from "../src/middleware/security";
import { adminFetch } from "./helpers/admin";

const BASE = "https://example.com";

function expectSecurityHeaders(res: Response) {
  expect(res.headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  expect(res.headers.get("Referrer-Policy")).toBeTruthy();
}

let logs: string[];

beforeEach(async () => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
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
       SELECT id, 'en', 50000, 'manuals/byd-sealion-2026-en-demo.pdf', 10, 1, 0, 0 FROM car_models`,
    ),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("security headers", () => {
  it("has a CSP that allows only self-hosted code plus Turnstile, and no inline code", () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  });

  it.each(["/", "/m/byd-sealion-2026", "/api/models", "/healthz", "/does-not-exist"])(
    "are set on %s",
    async (path) => {
      const res = await SELF.fetch(`${BASE}${path}`);
      expectSecurityHeaders(res);
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      // Not production: everything is noindex.
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    },
  );

  it("keep no-referrer and noindex on download links", async () => {
    const res = await SELF.fetch(`${BASE}/d/${"x".repeat(43)}`);
    expect(res.status).toBe(410);
    expectSecurityHeaders(res);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("in production: noindex only on /d/*, not on public pages", async () => {
    const prod = { ...env, ENVIRONMENT: "production" };
    const page = await app.request(`${BASE}/`, {}, prod);
    expectSecurityHeaders(page);
    expect(page.headers.get("X-Robots-Tag")).toBeNull();
    const link = await app.request(`${BASE}/d/${"x".repeat(43)}`, {}, prod);
    expect(link.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it.each(["/admin", "/admin/catalog", "/healthz", "/nope"])(
    "are set on the admin Worker's %s, always noindex",
    async (path) => {
      const res = await adminFetch(path);
      expectSecurityHeaders(res);
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    },
  );

  it("pages use no inline scripts or styles", async () => {
    for (const path of ["/", "/m/byd-sealion-2026", "/does-not-exist"]) {
      const html = await (await SELF.fetch(`${BASE}${path}`)).text();
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(html).not.toMatch(/\sstyle="/);
      expect(html).not.toMatch(/\son[a-z]+="/);
    }
    for (const path of ["/admin", "/admin/catalog", "/admin/payments"]) {
      const html = await (await adminFetch(path)).text();
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(html).not.toMatch(/\sstyle="/);
    }
  });
});

describe("robots.txt", () => {
  it("allows / and disallows /admin, /d/ and /api/", async () => {
    // Served by Workers Static Assets from public/ (SELF in tests reaches only the Worker code).
    const res = await (env as unknown as { ASSETS: Fetcher }).ASSETS.fetch(`${BASE}/robots.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("User-agent: *");
    expect(text).toMatch(/^Allow: \/$/m);
    for (const path of ["/admin", "/d/", "/api/"]) expect(text).toContain(`Disallow: ${path}`);
  });
});

describe("error pages", () => {
  it("unknown pages get a friendly HTML 404", async () => {
    const res = await SELF.fetch(`${BASE}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("Page not found");
    expect(html).toContain('href="/"');
  });

  it("unknown /api/* paths get JSON", async () => {
    const res = await SELF.fetch(`${BASE}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  const broken = {
    ...env,
    DB: {
      prepare() {
        throw new Error("D1 exploded near SELECT payer_name FROM payments");
      },
    } as unknown as D1Database,
  };

  it("a thrown error gives a friendly 500 with no details, and logs only path + message", async () => {
    const res = await app.request(`${BASE}/?secret=abc`, { headers: { cookie: "x=1" } }, broken);
    expect(res.status).toBe(500);
    expectSecurityHeaders(res);
    const html = await res.text();
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain("exploded");
    expect(html).not.toMatch(/at \S+ \(|\.ts:\d+/); // no stack frames

    const line = logs.map((l) => JSON.parse(l)).find((l) => l.event === "unhandled_error");
    expect(line).toEqual({
      event: "unhandled_error",
      path: "/",
      message: "D1 exploded near SELECT payer_name FROM payments",
    });
    expect(logs.join("\n")).not.toContain("secret=abc");
    expect(logs.join("\n")).not.toContain("x=1");
  });

  it("a thrown error under /api/* gives JSON", async () => {
    const res = await app.request(`${BASE}/api/models`, {}, broken);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});
