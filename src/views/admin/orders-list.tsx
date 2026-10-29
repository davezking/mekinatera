import { type AdminOrder, linkStatus, type TokenSummary } from "../../lib/db/admin-queries";
import { formatEat, LINK_LABEL, OlderLink } from "./payments";

export function downloadsLabel(token: TokenSummary | null): string {
  return token ? `${token.downloadCount}/${token.maxDownloads} downloads` : "No link";
}

export function linkLabel(token: TokenSummary | null, now: number): string {
  return token ? LINK_LABEL[linkStatus(token, now)] : "No link";
}

export function OrdersList({
  rows,
  next,
  now,
}: {
  rows: AdminOrder[];
  next: string | null;
  now: number;
}) {
  return (
    <section class="card stack" aria-labelledby="orders-title">
      <h1 class="card-title" id="orders-title">
        Orders
      </h1>
      {rows.length === 0 ? (
        <p class="muted">No orders yet.</p>
      ) : (
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">Created</th>
                <th scope="col">By</th>
                <th scope="col">Transaction</th>
                <th scope="col">Manual</th>
                <th scope="col">Downloads</th>
                <th scope="col">Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr>
                  <td>{formatEat(o.createdAt)}</td>
                  <td>{o.createdBy === "auto" ? "Auto" : "Admin"}</td>
                  <th scope="row" class="mono">
                    {o.txn && o.paymentId !== null ? (
                      <a href={`/admin/payments/${o.paymentId}`}>{o.txn}</a>
                    ) : (
                      "manual"
                    )}
                  </th>
                  <td>
                    {o.modelName} {o.modelYear}
                  </td>
                  <td>{downloadsLabel(o.token)}</td>
                  <td>{linkLabel(o.token, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OlderLink href={next ? `/admin/payments/orders?before=${next}` : null} />
    </section>
  );
}
