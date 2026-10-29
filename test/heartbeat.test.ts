import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getPhoneStatus, parseBattery, recordHeartbeat, staleMinutes } from "../src/lib/heartbeat";
import { DAY, HOUR, MINUTE } from "../src/lib/time";
import { formatDuration } from "../src/views/admin/status-banner";
import { adminFetch } from "./helpers/admin";

const SECRET = "dev-webhook-secret";
const NOW = 1_780_000_000_000;

function beat(init: { secret?: string | null; body?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.secret !== null) headers["X-Webhook-Secret"] = init.secret ?? SECRET;
  return SELF.fetch("https://example.com/api/heartbeat", {
    method: "POST",
    headers,
    body: init.body ?? JSON.stringify({ battery: 80 }),
  });
}

async function rows() {
  const { results } = await env.DB.prepare(
    "SELECT key, value, updated_at FROM system_status ORDER BY key",
  ).all<{ key: string; value: string; updated_at: number }>();
  return results;
}

async function insertSms(receivedAt: number, status: "parsed" | "ignored" | "failed") {
  await env.DB.prepare(
    `INSERT INTO raw_sms (sender, body, received_at, parse_status, created_at)
     VALUES ('127', 'x', ?, ?, ?)`,
  )
    .bind(receivedAt, status, receivedAt)
    .run();
}

async function adminHtml(overrides = {}) {
  const res = await adminFetch("/admin", undefined, overrides);
  expect(res.status).toBe(200);
  return res.text();
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM system_status"),
    env.DB.prepare("DELETE FROM payments"),
    env.DB.prepare("DELETE FROM raw_sms"),
  ]);
});

describe("POST /api/heartbeat", () => {
  it.each([
    ["missing", null],
    ["wrong", "nope"],
    ["wrong length", `${SECRET}x`],
  ])("401 with a %s secret and records nothing", async (_, secret) => {
    const res = await beat({ secret });
    expect(res.status).toBe(401);
    expect(await rows()).toEqual([]);
  });

  it("upserts last_heartbeat_at and battery", async () => {
    const res = await beat();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const first = await rows();
    expect(first.map((r) => r.key)).toEqual(["battery", "last_heartbeat_at"]);
    expect(first[0]?.value).toBe("80");
    expect(Number(first[1]?.value)).toBe(first[1]?.updated_at);

    await beat({ body: JSON.stringify({ battery: 55 }) });
    const second = await rows();
    expect(second).toHaveLength(2);
    expect(second[0]?.value).toBe("55");
  });

  it.each([
    ["no body", ""],
    ["invalid JSON", "{"],
    ["out-of-range battery", JSON.stringify({ battery: 140 })],
    ["text battery", JSON.stringify({ battery: "[battery]" })],
  ])("still records the heartbeat with %s, without a battery", async (_, body) => {
    expect((await beat({ body })).status).toBe(200);
    expect((await rows()).map((r) => r.key)).toEqual(["last_heartbeat_at"]);
  });
});

describe("parseBattery / staleMinutes / formatDuration", () => {
  it("parses battery levels", () => {
    expect(parseBattery(80)).toBe(80);
    expect(parseBattery("55")).toBe(55);
    expect(parseBattery(0)).toBe(0);
    expect(parseBattery(100)).toBe(100);
    expect(parseBattery(79.6)).toBe(80);
    for (const bad of [-1, 101, "", "abc", null, undefined, true, Number.NaN]) {
      expect(parseBattery(bad)).toBeNull();
    }
  });

  it("reads HEARTBEAT_STALE_MINUTES", () => {
    expect(staleMinutes("45")).toBe(45);
    expect(staleMinutes("0")).toBe(0);
    expect(staleMinutes(undefined)).toBe(45);
    expect(staleMinutes("")).toBe(45);
    expect(staleMinutes("soon")).toBe(45);
    expect(staleMinutes("-5")).toBe(45);
  });

  it("formats durations", () => {
    expect(formatDuration(30_000)).toBe("less than a minute");
    expect(formatDuration(-5_000)).toBe("less than a minute");
    expect(formatDuration(12 * MINUTE)).toBe("12 min");
    expect(formatDuration(3 * HOUR)).toBe("3 h");
    expect(formatDuration(2 * HOUR + 5 * MINUTE)).toBe("2 h 5 min");
    expect(formatDuration(2 * DAY)).toBe("2 d");
    expect(formatDuration(2 * DAY + 2 * HOUR)).toBe("2 d 2 h");
  });
});

describe("getPhoneStatus", () => {
  it("is 'never' with no heartbeat", async () => {
    expect(await getPhoneStatus(env.DB, NOW)).toEqual({
      lastHeartbeatAt: null,
      lastSmsAt: null,
      battery: null,
      state: "never",
    });
  });

  it("is 'ok' up to the stale limit and 'stale' after it", async () => {
    await recordHeartbeat(env.DB, NOW - 45 * MINUTE, 80);
    expect(await getPhoneStatus(env.DB, NOW)).toMatchObject({
      lastHeartbeatAt: NOW - 45 * MINUTE,
      battery: 80,
      state: "ok",
    });
    expect((await getPhoneStatus(env.DB, NOW + 1)).state).toBe("stale");
    expect((await getPhoneStatus(env.DB, NOW, 60)).state).toBe("ok");
    expect((await getPhoneStatus(env.DB, NOW, 0)).state).toBe("stale");
  });

  it("drops a battery reading older than the latest heartbeat", async () => {
    await recordHeartbeat(env.DB, NOW - 10 * MINUTE, 80);
    await recordHeartbeat(env.DB, NOW, null);
    expect(await getPhoneStatus(env.DB, NOW)).toMatchObject({
      lastHeartbeatAt: NOW,
      battery: null,
    });
  });

  it("reports the newest raw_sms of any status", async () => {
    await insertSms(NOW - 3 * HOUR, "parsed");
    await insertSms(NOW - HOUR, "failed");
    await insertSms(NOW - 2 * HOUR, "ignored");
    expect((await getPhoneStatus(env.DB, NOW)).lastSmsAt).toBe(NOW - HOUR);
  });

  it("finds the last SMS through the (parse_status, received_at) index", async () => {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT MAX(last) AS last FROM (
         SELECT MAX(received_at) AS last FROM raw_sms WHERE parse_status = 'parsed'
         UNION ALL SELECT MAX(received_at) FROM raw_sms WHERE parse_status = 'ignored'
         UNION ALL SELECT MAX(received_at) FROM raw_sms WHERE parse_status = 'failed')`,
    ).all<{ detail: string }>();
    const plan = results.map((r) => r.detail).join(" | ");
    expect(plan).toContain("idx_raw_sms_status_received");
    expect(plan).not.toMatch(/SCAN raw_sms(?! USING)/);
  });
});

describe("admin status banner", () => {
  it("shows the red 'never checked in' banner before any heartbeat", async () => {
    const html = await adminHtml();
    expect(html).toContain("Phone has never checked in.");
    expect(html).toContain("Payments will not verify automatically. Check the phone.");
    expect(html).toContain('role="alert"');
  });

  it("turns green after a heartbeat, with battery and last SMS", async () => {
    await insertSms(Date.now() - 3 * HOUR, "parsed");
    expect((await beat()).status).toBe(200);
    const html = await adminHtml();
    expect(html).toContain(
      "Phone online · last check-in less than a minute ago · last SMS 3 h ago · battery 80%",
    );
    expect(html).not.toContain('role="alert"');
  });

  it("is red on every admin page once the heartbeat is stale", async () => {
    await recordHeartbeat(env.DB, Date.now() - (2 * HOUR + 5 * MINUTE + 10_000), 80);
    for (const path of [
      "/admin",
      "/admin/catalog",
      "/admin/payments",
      "/admin/payments/sms",
      "/admin/payments/orders",
    ]) {
      const html = await (await adminFetch(path)).text();
      expect(html, path).toContain("Phone has not checked in for 2 h 5 min.");
    }
  });

  it("honours HEARTBEAT_STALE_MINUTES", async () => {
    await recordHeartbeat(env.DB, Date.now() - MINUTE - 10_000, 80);
    expect(await adminHtml()).toContain("Phone online");
    expect(await adminHtml({ HEARTBEAT_STALE_MINUTES: "0" })).toContain(
      "Phone has not checked in for 1 min.",
    );
  });
});
