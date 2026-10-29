// Per-IP limit on claim requests (PRD security), counted from claim_attempts, which is indexed
// on (ip, created_at). Every POST /api/claim that passes or fails these checks writes one row.
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { MINUTE } from "./time";

/** Same cap as claim_attempts rows written by src/lib/claim.ts. */
const MAX_STORED = 64;

/**
 * The client's IP: Cloudflare's CF-Connecting-IP. Only in development, an X-Test-Client-IP
 * header overrides it, so E2E tests (all from localhost) don't rate-limit each other.
 */
export function clientIp(c: Context<AppEnv>): string {
  if (c.env.ENVIRONMENT === "development") {
    const test = c.req.header("X-Test-Client-IP")?.trim();
    if (test) return test.slice(0, MAX_STORED);
  }
  return c.req.header("CF-Connecting-IP")?.slice(0, MAX_STORED) ?? "unknown";
}

/** true when `ip` already made `max` or more claim requests in the last `windowMs`. */
export async function isRateLimited(
  db: D1Database,
  ip: string,
  now: number,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM claim_attempts WHERE ip = ? AND created_at > ?")
    .bind(ip, now - windowMs)
    .first<number>("n");
  return (count ?? 0) >= max;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && /^\d+$/.test(value.trim()) && Number.isSafeInteger(n) && n > 0
    ? n
    : fallback;
}

/** RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MINUTES, defaulting to 10 per 10 minutes. */
export function rateLimitConfig(env: {
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_MINUTES?: string;
}): { max: number; windowMs: number } {
  return {
    max: positiveInt(env.RATE_LIMIT_MAX, 10),
    windowMs: positiveInt(env.RATE_LIMIT_WINDOW_MINUTES, 10) * MINUTE,
  };
}

/** A claim_attempts row for a request stopped before the claim checks (rate limit, bot check). */
export async function recordBlockedAttempt(
  db: D1Database,
  attempt: { txnInput: string; versionId: number | null; ip: string; now: number },
  resultCode: "RATE_LIMITED" | "BOT_CHECK_FAILED",
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO claim_attempts (transaction_number_input, manual_version_id, ip, result_code, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      attempt.txnInput.slice(0, MAX_STORED),
      attempt.versionId,
      attempt.ip,
      resultCode,
      attempt.now,
    )
    .run();
}
