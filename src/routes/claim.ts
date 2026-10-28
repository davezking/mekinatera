import { Hono } from "hono";
import type { AppEnv } from "../env";
import { type ClaimResult, claim, recordClaimAttempt } from "../lib/claim";
import { readTicket } from "../lib/ticket";
import { nowMs } from "../lib/time";

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
  // P3-S1-T1: turnstile + rate limit

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ status: "error", code: "INVALID_REQUEST", message: "Invalid request." }, 400);
  }
  const { transactionNumber, versionId } = (payload ?? {}) as Record<string, unknown>;
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
    ip: c.req.header("CF-Connecting-IP") ?? "unknown",
    now: nowMs(),
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

  const now = nowMs();
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
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
