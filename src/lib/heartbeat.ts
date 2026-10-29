// Phone health (FR-27). "No SMS" can just mean "no sales", so the phone proves it is alive with a
// heartbeat every 30 minutes (MacroDroid → POST /api/heartbeat). The last SMS time is context.
import { MINUTE } from "./time";

export const DEFAULT_STALE_MINUTES = 45;

export type PhoneState = "ok" | "stale" | "never";

export type PhoneStatus = {
  lastHeartbeatAt: number | null;
  lastSmsAt: number | null;
  /** 0–100, only when the latest heartbeat reported it. */
  battery: number | null;
  state: PhoneState;
};

/** A battery level is a whole or decimal number (or numeric string) from 0 to 100. */
export function parseBattery(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\s*\d{1,3}(\.\d+)?\s*$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
}

/** Records a heartbeat, plus the battery level if one was sent, in one batch. */
export async function recordHeartbeat(
  db: D1Database,
  now: number,
  battery: number | null,
): Promise<void> {
  const upsert = db.prepare(
    `INSERT INTO system_status (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const statements = [upsert.bind("last_heartbeat_at", String(now), now)];
  if (battery !== null) statements.push(upsert.bind("battery", String(battery), now));
  await db.batch(statements);
}

/** Stale minutes from the env var; a missing or malformed value falls back to the default. */
export function staleMinutes(value: string | undefined): number {
  const n = value === undefined || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_STALE_MINUTES;
}

export async function getPhoneStatus(
  db: D1Database,
  now: number,
  staleAfterMinutes = DEFAULT_STALE_MINUTES,
): Promise<PhoneStatus> {
  const [status, sms] = await db.batch<{
    key?: string;
    value?: string;
    updated_at?: number;
    last?: number | null;
  }>([
    db.prepare(
      "SELECT key, value, updated_at FROM system_status WHERE key IN ('last_heartbeat_at', 'battery')",
    ),
    // One MAX per parse_status so each uses idx_raw_sms_status_received (a bare MAX over the
    // whole table cannot: received_at is the second column of the index).
    db.prepare(
      `SELECT MAX(last) AS last FROM (
         SELECT MAX(received_at) AS last FROM raw_sms WHERE parse_status = 'parsed'
         UNION ALL SELECT MAX(received_at) FROM raw_sms WHERE parse_status = 'ignored'
         UNION ALL SELECT MAX(received_at) FROM raw_sms WHERE parse_status = 'failed')`,
    ),
  ]);
  const rows = new Map((status?.results ?? []).map((r) => [r.key, r]));
  const heartbeat = rows.get("last_heartbeat_at");
  const batteryRow = rows.get("battery");
  const lastHeartbeatAt = heartbeat ? Number(heartbeat.value) : null;
  // Show the battery only when it came with the latest heartbeat, never an old reading.
  const battery =
    heartbeat && batteryRow && batteryRow.updated_at === heartbeat.updated_at
      ? Number(batteryRow.value)
      : null;
  const state: PhoneState =
    lastHeartbeatAt === null
      ? "never"
      : now - lastHeartbeatAt > staleAfterMinutes * MINUTE
        ? "stale"
        : "ok";
  return { lastHeartbeatAt, lastSmsAt: sms?.results[0]?.last ?? null, battery, state };
}
