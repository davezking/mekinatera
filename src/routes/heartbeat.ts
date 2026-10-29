import { Hono } from "hono";
import type { AppEnv } from "../env";
import { parseBattery, recordHeartbeat } from "../lib/heartbeat";
import { safeEqual } from "../lib/secrets";
import { nowMs } from "../lib/time";

// Phone heartbeat (/api/heartbeat), posted by a MacroDroid macro every 30 minutes (FR-27).
// Same secret as the SMS webhook. The admin Worker reads the result (src/lib/heartbeat.ts).
export const heartbeatRoutes = new Hono<AppEnv>();

heartbeatRoutes.post("/", async (c) => {
  const expected = c.env.WEBHOOK_SECRET;
  const given = c.req.header("X-Webhook-Secret") ?? "";
  if (!expected || !safeEqual(given, expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  // The body is optional: a ping with no (or unreadable) JSON still proves the phone is online.
  let battery: number | null = null;
  try {
    const payload: unknown = await c.req.json();
    if (typeof payload === "object" && payload !== null) {
      battery = parseBattery((payload as Record<string, unknown>).battery);
    }
  } catch {
    // Not JSON: record the heartbeat without a battery level.
  }

  await recordHeartbeat(c.env.DB, nowMs(), battery);
  console.log(JSON.stringify({ event: "heartbeat", hasBattery: battery !== null }));
  return c.json({ ok: true });
});
