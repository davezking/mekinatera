import type { PhoneStatus } from "../../lib/heartbeat";
import { DAY, HOUR, MINUTE } from "../../lib/time";

/** 45 s → "less than a minute", 12 min → "12 min", 125 min → "2 h 5 min", 50 h → "2 d 2 h". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = minutes - h * 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms - d * DAY) / HOUR);
  return h === 0 ? `${d} d` : `${d} d ${h} h`;
}

function lastSms(status: PhoneStatus, now: number): string {
  return status.lastSmsAt === null
    ? "no SMS yet"
    : `last SMS ${formatDuration(now - status.lastSmsAt)} ago`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Phone health on every admin page (FR-27): a green line when online, a red banner otherwise. */
export function StatusBanner({ status, now }: { status: PhoneStatus; now: number }) {
  if (status.state === "ok" && status.lastHeartbeatAt !== null) {
    const parts = [
      "Phone online",
      `last check-in ${formatDuration(now - status.lastHeartbeatAt)} ago`,
      lastSms(status, now),
      ...(status.battery === null ? [] : [`battery ${status.battery}%`]),
    ];
    return (
      <p class="phone-status phone-status--ok" role="status">
        {parts.join(" · ")}
      </p>
    );
  }
  const title =
    status.lastHeartbeatAt === null
      ? "Phone has never checked in."
      : `Phone has not checked in for ${formatDuration(now - status.lastHeartbeatAt)}.`;
  return (
    <div class="notice-error" role="alert">
      <div class="notice__body">
        <strong class="notice__title">{title}</strong>
        <span>Payments will not verify automatically. Check the phone.</span>
        <span>{capitalize(lastSms(status, now))}. Setup steps: docs/phone-setup.md.</span>
      </div>
    </div>
  );
}
