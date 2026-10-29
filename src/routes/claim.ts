import { Hono } from "hono";
import type { AppEnv } from "../env";
import { type ClaimResult, claim, recordClaimAttempt } from "../lib/claim";
import { clientIp, isRateLimited, rateLimitConfig, recordBlockedAttempt } from "../lib/rate-limit";
import { readTicket } from "../lib/ticket";
import { nowMs } from "../lib/time";
import { verifyTurnstile } from "../lib/turnstile";

// Claim + poll endpoints (/api/claim).
export const claimRoutes = new Hono<AppEnv>();

claimRoutes.use(async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});

function log(event: string, result: ClaimResult, versionId: number | null) {
  console.log(
    JSON.stringify({
      event,
      status: result.status,
      code: result.status === "error" ? result.code : undefined,
      versionId,
    }),
  );
}

claimRoutes.post("/", async (c) => {
  // The body is read first only to log the attempt and find the Turnstile token. The checks run
  // in this order: rate limit, then Turnstile, then input validation and the claim itself.
  let payload: unknown = null;
  try {
    payload = await c.req.json();
  } catch {
    payload = null; // Rejected below: by the bot check (no token), or as INVALID_REQUEST.
  }
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const { transactionNumber, versionId, turnstileToken } = body;
  const ip = clientIp(c);
  const now = nowMs();
  const attempt = {
    txnInput: typeof transactionNumber === "string" ? transactionNumber : "",
    versionId: Number.isSafeInteger(versionId) ? (versionId as number) : null,
    ip,
    now,
  };

  const { max, windowMs } = rateLimitConfig(c.env);
  if (await isRateLimited(c.env.DB, ip, now, max, windowMs)) {
    await recordBlockedAttempt(c.env.DB, attempt, "RATE_LIMITED");
    const result: ClaimResult = {
      status: "error",
      code: "RATE_LIMITED",
      message: "Too many attempts. Wait a few minutes and try again.",
    };
    log("claim", result, attempt.versionId);
    return c.json(result, 429);
  }

  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, turnstileToken, ip))) {
    await recordBlockedAttempt(c.env.DB, attempt, "BOT_CHECK_FAILED");
    const result: ClaimResult = {
      status: "error",
      code: "BOT_CHECK_FAILED",
      message: "We couldn't check that you're not a robot. Reload the page and try again.",
    };
    log("claim", result, attempt.versionId);
    return c.json(result, 403);
  }

  if (
    typeof transactionNumber !== "string" ||
    !Number.isSafeInteger(versionId) ||
    (versionId as number) <= 0
  ) {
    return c.json({ status: "error", code: "INVALID_REQUEST", message: "Invalid request." }, 400);
  }

  const result = await claim(c.env, {
    txnInput: transactionNumber,
    versionId: versionId as number,
    ip,
    now,
    origin: new URL(c.req.url).origin,
  });
  log("claim", result, versionId as number);
  return c.json(result);
});

claimRoutes.get("/status", async (c) => {
  const ticket = c.req.query("ticket") ?? "";
  const payload = ticket ? await readTicket(c.env.TICKET_SECRET, ticket) : null;
  if (!payload) {
    return c.json({ status: "error", code: "INVALID_TICKET", message: "Invalid ticket." }, 400);
  }

  // Polls are authorized by the signed ticket: no Turnstile and no rate limit.
  const now = nowMs();
  const ip = clientIp(c);
  if (payload.expiresAt <= now) {
    await recordClaimAttempt(
      c.env.DB,
      { txnInput: payload.txn, versionId: payload.versionId, ip, now },
      "NOT_FOUND",
    );
    const result: ClaimResult = {
      status: "error",
      code: "NOT_FOUND",
      message: `We haven't received this payment yet. Check the number, or contact ${c.env.SUPPORT_CONTACT}.`,
    };
    log("claim_poll", result, payload.versionId);
    return c.json(result);
  }

  const result = await claim(c.env, {
    txnInput: payload.txn,
    versionId: payload.versionId,
    ip,
    now,
    origin: new URL(c.req.url).origin,
    ticket,
  });
  if (result.status !== "pending") log("claim_poll", result, payload.versionId);
  return c.json(result);
});
