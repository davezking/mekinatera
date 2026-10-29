import type { AdminPayment, LinkStatus, PaymentFilter } from "../../lib/db/admin-queries";
import { PAYMENT_FILTERS } from "../../lib/db/admin-queries";
import type { PaymentStatus } from "../../lib/db/types";
import { santimToEtbLabel } from "../../lib/money";

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** UTC ms → "29/10/2026 14:05 EAT" (Ethiopia, UTC+3), the way the owner reads telebirr SMS. */
export function formatEat(ms: number): string {
  const d = new Date(ms + EAT_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} EAT`;
}

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  unclaimed: "Unclaimed",
  claimed: "Claimed",
  flagged: "Flagged",
};

export const LINK_LABEL: Record<LinkStatus, string> = {
  active: "Active",
  expired: "Expired",
  used_up: "Used up",
  revoked: "Revoked",
};

const TAB_LABEL: Record<PaymentFilter, string> = {
  all: "All",
  unclaimed: "Unclaimed",
  claimed: "Claimed",
  flagged: "Flagged",
};

/** Tab links; `current` gets aria-current. */
export function AdminTabs<T extends string>({
  label,
  tabs,
  current,
  href,
}: {
  label: string;
  tabs: readonly [T, string][];
  current: T;
  href: (tab: T) => string;
}) {
  return (
    <nav class="admin-tabs" aria-label={label}>
      {tabs.map(([tab, text]) => (
        <a href={href(tab)} aria-current={tab === current ? "page" : undefined}>
          {text}
        </a>
      ))}
    </nav>
  );
}

export function OlderLink({ href }: { href: string | null }) {
  return href ? (
    <p>
      <a class="btn btn-sm" href={href} rel="next">
        Older
      </a>
    </p>
  ) : null;
}

export function PaymentsList({
  status,
  rows,
  next,
}: {
  status: PaymentFilter;
  rows: AdminPayment[];
  next: string | null;
}) {
  const query = (s: PaymentFilter) => (s === "all" ? "" : `?status=${s}`);
  const older = next
    ? `/admin/payments?${new URLSearchParams({ ...(status === "all" ? {} : { status }), before: next })}`
    : null;
  return (
    <section class="card stack" aria-labelledby="payments-title">
      <h1 class="card-title" id="payments-title">
        Payments
      </h1>
      <AdminTabs
        label="Payment status"
        tabs={PAYMENT_FILTERS.map((s) => [s, TAB_LABEL[s]] as [PaymentFilter, string])}
        current={status}
        href={(s) => `/admin/payments${query(s)}`}
      />
      {rows.length === 0 ? (
        <p class="muted">No payments here.</p>
      ) : (
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">Paid at</th>
                <th scope="col">Transaction</th>
                <th scope="col">Amount</th>
                <th scope="col">Payer</th>
                <th scope="col">Phone</th>
                <th scope="col">Status</th>
                <th scope="col">Flag reason</th>
                <th scope="col">
                  <span class="visually-hidden">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr>
                  <td>{formatEat(p.paidAt)}</td>
                  <th scope="row" class="mono">
                    {p.txn}
                  </th>
                  <td>{santimToEtbLabel(p.amountSantim)}</td>
                  <td>{p.payerName}</td>
                  <td class="mono">{p.payerPhoneMasked}</td>
                  <td>{STATUS_LABEL[p.status]}</td>
                  <td>{p.flagReason ?? "—"}</td>
                  <td>
                    <a href={`/admin/payments/${p.id}`}>View</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OlderLink href={older} />
    </section>
  );
}
