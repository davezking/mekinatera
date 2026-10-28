import { Hono } from "hono";
import type { AppEnv } from "../env";
import { insertPaymentIfNew, insertRawSms } from "../lib/db/payments";
import { safeEqual } from "../lib/secrets";
import { parseTelebirrSms } from "../lib/sms/parser";
import { redactSms } from "../lib/sms/redact";
import { nowMs } from "../lib/time";

/** telebirr sends its notifications from this short code. Anything else is never stored (FR-7). */
const TELEBIRR_SENDER = "127";

type WebhookResult = "stored" | "duplicate" | "ignored" | "failed" | "discarded";

/** Epoch ms (number or numeric string) or an ISO date; anything else falls back to now. */
export function parseReceivedAt(value: unknown, now: number): number {
  let ms = Number.NaN;
  if (typeof value === "number") ms = value;
  else if (typeof value === "string" && value.trim() !== "") {
    const s = value.trim();
    ms = /^\d+$/.test(s) ? Number(s) : Date.parse(s);
  }
  return Number.isSafeInteger(ms) && ms > 0 ? ms : now;
}

function log(result: WebhookResult, patternId: string | null, rawSmsId: number | null) {
  console.log(JSON.stringify({ event: "sms_received", result, patternId, rawSmsId }));
}

// telebirr SMS webhook (/api/sms-webhook), called by the SMS forwarder on the owner's phone.
export const webhookRoutes = new Hono<AppEnv>();

webhookRoutes.post("/", async (c) => {
  const expected = c.env.WEBHOOK_SECRET;
  const given = c.req.header("X-Webhook-Secret") ?? "";
  if (!expected || !safeEqual(given, expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (typeof payload !== "object" || payload === null) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const { from, body, receivedAt } = payload as Record<string, unknown>;
  if (typeof body !== "string" || body.trim() === "") {
    return c.json({ error: "invalid_body" }, 400);
  }

  if (typeof from !== "string" || from.trim() !== TELEBIRR_SENDER) {
    log("discarded", null, null);
    return c.json({ result: "discarded" satisfies WebhookResult });
  }

  const now = nowMs();
  const parsed = parseTelebirrSms(body);
  const rawSmsId = await insertRawSms(c.env.DB, {
    sender: TELEBIRR_SENDER,
    body: redactSms(body),
    receivedAt: parseReceivedAt(receivedAt, now),
    parseStatus: parsed.kind === "payment" ? "parsed" : parsed.kind,
    patternId: parsed.kind === "failed" ? null : parsed.patternId,
    createdAt: now,
  });

  let result: WebhookResult;
  if (parsed.kind === "payment") {
    const inserted = await insertPaymentIfNew(c.env.DB, {
      transactionNumber: parsed.transactionNumber,
      amountSantim: parsed.amountSantim,
      payerName: parsed.payerName,
      payerPhoneMasked: parsed.payerPhoneMasked,
      paidAt: parsed.paidAt,
      rawSmsId,
      createdAt: now,
    });
    result = inserted ? "stored" : "duplicate";
  } else {
    result = parsed.kind;
  }

  log(result, parsed.kind === "failed" ? null : parsed.patternId, rawSmsId);
  return c.json({ result });
});
