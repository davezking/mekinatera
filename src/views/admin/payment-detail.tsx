import type { Child } from "hono/jsx";
import type { AdminPaymentDetail } from "../../lib/db/admin-queries";
import { santimToEtbLabel } from "../../lib/money";
import { downloadsLabel, linkLabel } from "./orders-list";
import { formatEat, STATUS_LABEL } from "./payments";

function Row({ label, children }: { label: string; children: unknown }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PaymentDetail({
  payment: p,
  now,
  actions,
}: {
  payment: AdminPaymentDetail;
  now: number;
  /** Approve / new link forms (views/admin/payment-actions.tsx). */
  actions?: Child;
}) {
  const o = p.order;
  return (
    <>
      <p>
        <a href="/admin/payments">← All payments</a>
      </p>
      <section class="card stack" aria-labelledby="payment-title">
        <h1 class="card-title" id="payment-title">
          Payment <span class="mono">{p.txn}</span>
        </h1>
        <dl class="admin-dl">
          <Row label="Status">{STATUS_LABEL[p.status]}</Row>
          <Row label="Flag reason">{p.flagReason ?? "—"}</Row>
          <Row label="Amount">{santimToEtbLabel(p.amountSantim)}</Row>
          <Row label="Payer">{p.payerName}</Row>
          <Row label="Phone">
            <span class="mono">{p.payerPhoneMasked}</span>
          </Row>
          <Row label="Paid at">{formatEat(p.paidAt)}</Row>
          <Row label="Recorded at">{formatEat(p.createdAt)}</Row>
          <Row label="Claimed at">{p.claimedAt === null ? "—" : formatEat(p.claimedAt)}</Row>
          <Row label="Claim ref">
            <span class="mono">{p.claimRef ?? "—"}</span>
          </Row>
        </dl>
      </section>

      <section class="card stack" aria-labelledby="sms-title">
        <h2 class="card-title" id="sms-title">
          SMS
        </h2>
        {p.sms ? (
          <>
            <dl class="admin-dl">
              <Row label="Sender">
                <span class="mono">{p.sms.sender}</span>
              </Row>
              <Row label="Received">{formatEat(p.sms.receivedAt)}</Row>
              <Row label="Pattern">
                <span class="mono">{p.sms.patternId ?? "—"}</span>
              </Row>
            </dl>
            <p class="admin-sms-body">{p.sms.body}</p>
          </>
        ) : (
          <p class="muted">No SMS stored for this payment.</p>
        )}
      </section>

      <section class="card stack" aria-labelledby="order-title">
        <h2 class="card-title" id="order-title">
          Order
        </h2>
        {o ? (
          <dl class="admin-dl">
            <Row label="Order">#{o.id}</Row>
            <Row label="Created">
              {formatEat(o.createdAt)} ({o.createdBy === "auto" ? "auto" : "admin"})
            </Row>
            <Row label="Manual">
              {o.modelName} {o.modelYear} ({o.language})
            </Row>
            <Row label="Downloads">{downloadsLabel(o.token)}</Row>
            <Row label="Link">{linkLabel(o.token, now)}</Row>
            {o.token && <Row label="Link expires">{formatEat(o.token.expiresAt)}</Row>}
            {o.adminNote && <Row label="Note">{o.adminNote}</Row>}
          </dl>
        ) : (
          <p class="muted">No order for this payment.</p>
        )}
      </section>

      <section id="actions">{actions}</section>
    </>
  );
}
