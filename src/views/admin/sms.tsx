import type { AdminSms } from "../../lib/db/admin-queries";
import { AdminTabs, formatEat, OlderLink } from "./payments";

export type SmsFilter = "failed" | "ignored";

const TABS: [SmsFilter, string][] = [
  ["failed", "Failed"],
  ["ignored", "Ignored"],
];

export function SmsList({
  status,
  rows,
  next,
}: {
  status: SmsFilter;
  rows: AdminSms[];
  next: string | null;
}) {
  return (
    <section class="card stack" aria-labelledby="sms-title">
      <h1 class="card-title" id="sms-title">
        SMS
      </h1>
      <p class="muted">
        Messages that did not become a payment. Bodies are stored redacted (no balance).
      </p>
      <AdminTabs
        label="SMS status"
        tabs={TABS}
        current={status}
        href={(s) => `/admin/payments/sms?status=${s}`}
      />
      {rows.length === 0 ? (
        <p class="muted">No messages here.</p>
      ) : (
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">Sender</th>
                <th scope="col">Pattern</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr>
                  <td>{formatEat(s.receivedAt)}</td>
                  <td class="mono">{s.sender}</td>
                  <td class="mono">{s.patternId ?? "—"}</td>
                  <td class="admin-sms-body">{s.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OlderLink
        href={next ? `/admin/payments/sms?${new URLSearchParams({ status, before: next })}` : null}
      />
    </section>
  );
}
