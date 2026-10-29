import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { clientIp, isRateLimited, rateLimitConfig } from "../src/lib/rate-limit";
import { MINUTE } from "../src/lib/time";

const NOW = 1_790_000_000_000;
const WINDOW = 10 * MINUTE;

async function attempts(ip: string, count: number, at: number) {
  await env.DB.batch(
    Array.from({ length: count }, () =>
      env.DB.prepare(
        `INSERT INTO claim_attempts (transaction_number_input, manual_version_id, ip, result_code, created_at)
         VALUES ('DEMOPAY001', 1, ?, 'NOT_FOUND', ?)`,
      ).bind(ip, at),
    ),
  );
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM claim_attempts").run();
});

describe("isRateLimited", () => {
  it("allows 10 attempts and limits the 11th", async () => {
    await attempts("203.0.113.7", 9, NOW - MINUTE);
    expect(await isRateLimited(env.DB, "203.0.113.7", NOW, 10, WINDOW)).toBe(false);
    await attempts("203.0.113.7", 1, NOW - MINUTE);
    expect(await isRateLimited(env.DB, "203.0.113.7", NOW, 10, WINDOW)).toBe(true);
  });

  it("only counts attempts inside the window", async () => {
    await attempts("203.0.113.7", 10, NOW - WINDOW); // exactly at the edge: outside
    expect(await isRateLimited(env.DB, "203.0.113.7", NOW, 10, WINDOW)).toBe(false);
    await attempts("203.0.113.7", 10, NOW - WINDOW + 1);
    expect(await isRateLimited(env.DB, "203.0.113.7", NOW, 10, WINDOW)).toBe(true);
    // Once the window has passed, the same IP is allowed again.
    expect(await isRateLimited(env.DB, "203.0.113.7", NOW + WINDOW, 10, WINDOW)).toBe(false);
  });

  it("is per IP", async () => {
    await attempts("203.0.113.7", 10, NOW - MINUTE);
    expect(await isRateLimited(env.DB, "203.0.113.7", NOW, 10, WINDOW)).toBe(true);
    expect(await isRateLimited(env.DB, "203.0.113.8", NOW, 10, WINDOW)).toBe(false);
  });

  it("uses the (ip, created_at) index", async () => {
    const { results } = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT COUNT(*) AS n FROM claim_attempts WHERE ip = ? AND created_at > ?",
    )
      .bind("203.0.113.7", NOW)
      .all<{ detail: string }>();
    expect(results.map((r) => r.detail).join(" ")).toContain("idx_claim_attempts_ip_created");
  });
});

describe("rateLimitConfig", () => {
  it("reads the vars and falls back to 10 per 10 minutes", () => {
    expect(rateLimitConfig({ RATE_LIMIT_MAX: "5", RATE_LIMIT_WINDOW_MINUTES: "2" })).toEqual({
      max: 5,
      windowMs: 2 * MINUTE,
    });
    expect(rateLimitConfig({})).toEqual({ max: 10, windowMs: 10 * MINUTE });
    expect(rateLimitConfig({ RATE_LIMIT_MAX: "0", RATE_LIMIT_WINDOW_MINUTES: "x" })).toEqual({
      max: 10,
      windowMs: 10 * MINUTE,
    });
  });
});

describe("clientIp", () => {
  const app = new Hono<AppEnv>().get("/", (c) => c.text(clientIp(c)));
  const ip = (environment: string, headers: Record<string, string>) =>
    Promise.resolve(
      app.request("http://localhost/", { headers }, { ...env, ENVIRONMENT: environment }),
    ).then((r) => r.text());

  it("uses CF-Connecting-IP", async () => {
    expect(await ip("production", { "CF-Connecting-IP": "196.188.0.1" })).toBe("196.188.0.1");
    expect(await ip("production", {})).toBe("unknown");
  });

  it("honours X-Test-Client-IP only in development", async () => {
    const headers = { "CF-Connecting-IP": "127.0.0.1", "X-Test-Client-IP": "203.0.113.9" };
    expect(await ip("development", headers)).toBe("203.0.113.9");
    expect(await ip("staging", headers)).toBe("127.0.0.1");
    expect(await ip("production", headers)).toBe("127.0.0.1");
  });
});
