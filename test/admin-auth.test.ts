import { env, SELF } from "cloudflare:test";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardCounts, startOfEatDay } from "../src/routes/admin";
import { adminFetch, TEST_ACCESS } from "./helpers/admin";

const CERTS_URL = `${TEST_ACCESS.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
const PROD = { ENVIRONMENT: "production" } as const;

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;
let logs: string[];

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  otherKey = (await generateKeyPair("RS256")).privateKey;
});

beforeEach(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === CERTS_URL) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  });
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Claims = { email?: string; aud?: string; iss?: string; exp?: number | string };

function jwt(claims: Claims = {}, key: CryptoKey = privateKey) {
  const builder = new SignJWT(claims.email === undefined ? {} : { email: claims.email })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer(claims.iss ?? TEST_ACCESS.ACCESS_TEAM_DOMAIN)
    .setAudience(claims.aud ?? TEST_ACCESS.ACCESS_AUD)
    .setExpirationTime(claims.exp ?? "1h");
  return builder.sign(key);
}

async function get(token: string | null, overrides = {}, path = "/admin", headers = {}) {
  return adminFetch(
    path,
    { headers: { ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}), ...headers } },
    { ...PROD, ...overrides },
  );
}

function expectSecureHeaders(res: Response) {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
}

describe("Access JWT (non-development)", () => {
  it("accepts a valid JWT for ADMIN_EMAIL (FR-23)", async () => {
    const res = await get(await jwt({ email: "owner@example.com" }));
    expect(res.status).toBe(200);
    expectSecureHeaders(res);
    const html = await res.text();
    expect(html).toContain("Dashboard");
    expect(html).toContain("owner@example.com");
  });

  it("matches the email case-insensitively", async () => {
    const res = await get(await jwt({ email: "Owner@Example.COM" }));
    expect(res.status).toBe(200);
  });

  it("accepts the CF_Authorization cookie", async () => {
    const token = await jwt({ email: "owner@example.com" });
    const res = await get(null, {}, "/admin", { Cookie: `CF_Authorization=${token}` });
    expect(res.status).toBe(200);
  });

  it.each([
    ["no JWT", async () => null, "missing_token"],
    [
      "a wrong audience",
      () => jwt({ email: "owner@example.com", aud: "other-aud" }),
      "invalid_token",
    ],
    [
      "a wrong issuer",
      () => jwt({ email: "owner@example.com", iss: "https://evil.cloudflareaccess.com" }),
      "invalid_token",
    ],
    [
      "an expired JWT",
      () => jwt({ email: "owner@example.com", exp: Math.floor(Date.now() / 1000) - 60 }),
      "invalid_token",
    ],
    ["another email", () => jwt({ email: "someone@example.com" }), "wrong_email"],
    ["no email claim", () => jwt({}), "wrong_email"],
    [
      "an unknown signing key",
      () => jwt({ email: "owner@example.com" }, otherKey),
      "invalid_token",
    ],
    ["garbage", async () => "not-a-jwt", "invalid_token"],
  ])("rejects %s with 403", async (_label, make, reason) => {
    const res = await get(await make());
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Not authorized");
    expectSecureHeaders(res);
    expect(logs).toContain(JSON.stringify({ event: "admin_denied", reason }));
  });

  it("fails closed when Access isn't configured", async () => {
    const token = await jwt({ email: "owner@example.com" });
    for (const overrides of [{ ADMIN_EMAIL: "" }, { ACCESS_AUD: "" }, { ACCESS_TEAM_DOMAIN: "" }]) {
      const res = await get(token, overrides);
      expect(res.status, JSON.stringify(overrides)).toBe(403);
    }
  });

  it("protects sub-routes too", async () => {
    for (const path of ["/admin/catalog", "/admin/payments", "/admin/anything"]) {
      const res = await get(null, {}, path);
      expect(res.status, path).toBe(403);
    }
  });
});

describe("dev bypass", () => {
  it("works for development + ADMIN_DEV_BYPASS=1 + localhost", async () => {
    for (const host of ["http://localhost", "http://127.0.0.1:8788"]) {
      const res = await adminFetch(`${host}/admin`);
      expect(res.status, host).toBe(200);
      expectSecureHeaders(res);
      expect(await res.text()).toContain("dev@localhost");
    }
  });

  it.each([
    ["staging", { ENVIRONMENT: "staging" as const }, "http://localhost/admin"],
    ["production", { ENVIRONMENT: "production" as const }, "http://localhost/admin"],
    ["flag off", { ADMIN_DEV_BYPASS: "0" }, "http://localhost/admin"],
    ["flag missing", { ADMIN_DEV_BYPASS: undefined }, "http://localhost/admin"],
    ["a non-local host", {}, "https://byd-manuals-admin.example.workers.dev/admin"],
  ])("does not apply on %s", async (_label, overrides, url) => {
    const res = await adminFetch(url, undefined, overrides);
    expect(res.status).toBe(403);
  });
});

describe("CSRF", () => {
  it("rejects a POST with a foreign or missing Origin", async () => {
    for (const origin of ["https://evil.example", undefined]) {
      const res = await adminFetch("/admin/catalog", {
        method: "POST",
        headers: origin ? { Origin: origin } : {},
      });
      expect(res.status, String(origin)).toBe(403);
      expectSecureHeaders(res);
    }
    expect(logs.filter((l) => l.includes('"csrf"'))).toHaveLength(2);
  });

  it("lets a same-origin POST through to the route", async () => {
    const res = await adminFetch("/admin/payments", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });
    // No POST handler exists yet: past the guard, the route answers 404.
    expect(res.status).toBe(404);
    expectSecureHeaders(res);
  });
});

describe("admin Worker", () => {
  it("redirects / to /admin and serves /healthz", async () => {
    const root = await adminFetch("/");
    expect(root.status).toBe(302);
    expect(root.headers.get("Location")).toBe("/admin");
    const health = await adminFetch("/healthz");
    expect(await health.json()).toEqual({ ok: true, env: "development" });
  });

  it("shows the nav, status banner slot and public site link", async () => {
    const html = await (await adminFetch("/admin")).text();
    for (const href of [
      "/admin",
      "/admin/catalog",
      "/admin/payments",
      "/admin/payments/sms",
      "/admin/payments/orders",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain('<div id="status-banner"></div>');
    expect(html).toContain('href="http://localhost:8787"');
  });
});

describe("public Worker", () => {
  it.each(["/admin", "/admin/", "/admin/anything", "/admin/catalog"])(
    "returns 404 for %s",
    async (path) => {
      const res = await SELF.fetch(`https://example.com${path}`);
      expect(res.status).toBe(404);
      await res.body?.cancel();
    },
  );
});

describe("dashboard counts", () => {
  const NOW = Date.UTC(2026, 9, 28, 12, 0, 0); // 15:00 EAT
  const TODAY = startOfEatDay(NOW);

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
    await db
      .prepare(
        `INSERT INTO car_models (name, slug, model_year, is_visible, sort_order, created_at, updated_at)
       VALUES ('BYD E2', 'byd-e2-2025', '2025', 1, 1, 0, 0)`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO manual_versions (car_model_id, language, price_santim, is_visible, created_at, updated_at)
       SELECT id, 'en', 50000, 1, 0, 0 FROM car_models`,
      )
      .run();
    const pay = (txn: string, status: string, paidAt: number) =>
      db
        .prepare(
          `INSERT INTO payments (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, status, created_at)
           VALUES (?, 50000, 'X', 'Y', ?, ?, ?)`,
        )
        .bind(txn, paidAt, status, paidAt);
    await db.batch([
      pay("TODAYUNC01", "unclaimed", TODAY + 1000),
      pay("TODAYCLM01", "claimed", TODAY + 2000),
      pay("OLDUNCLM01", "unclaimed", TODAY - 1000),
      pay("OLDFLAG001", "flagged", TODAY - 5000),
    ]);
    await db
      .prepare(
        `INSERT INTO orders (payment_id, manual_version_id, created_by, created_at)
       SELECT p.id, v.id, 'auto', ? FROM payments p, manual_versions v WHERE p.transaction_number = 'TODAYCLM01'`,
      )
      .bind(TODAY + 3000)
      .run();
    const sms = (status: string, at: number) =>
      db
        .prepare(
          "INSERT INTO raw_sms (sender, body, received_at, parse_status, created_at) VALUES ('127', 'x', ?, ?, ?)",
        )
        .bind(at, status, at);
    await db.batch([
      sms("failed", TODAY + 10),
      sms("failed", TODAY - 10),
      sms("parsed", TODAY + 10),
    ]);
  });

  it("starts the day at midnight in Ethiopia", () => {
    expect(TODAY).toBe(Date.UTC(2026, 9, 27, 21, 0, 0));
    expect(startOfEatDay(Date.UTC(2026, 9, 27, 21, 0, 0))).toBe(Date.UTC(2026, 9, 27, 21, 0, 0));
    expect(startOfEatDay(Date.UTC(2026, 9, 27, 20, 59, 59))).toBe(Date.UTC(2026, 9, 26, 21, 0, 0));
  });

  it("counts today and all time", async () => {
    expect(await dashboardCounts(env.DB, NOW)).toEqual({
      payments: {
        received: { today: 2, total: 4 },
        claimed: { today: 1, total: 1 },
        unclaimed: { today: 1, total: 2 },
        flagged: { today: 0, total: 1 },
      },
      orders: { today: 1, total: 1 },
      failedSms: { today: 1, total: 2 },
    });
  });

  it("renders the counts on the dashboard", async () => {
    const html = await (await adminFetch("/admin")).text();
    expect(html).toContain("Payments received");
    expect(html).toContain("Failed SMS");
    expect(html).toMatch(/Payments received<\/th><td>\d+<\/td><td>4<\/td>/);
  });
});
