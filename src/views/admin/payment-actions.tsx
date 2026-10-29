import type { AdminOrder, AdminPaymentDetail } from "../../lib/db/admin-queries";
import { santimToEtbLabel } from "../../lib/money";

/** A manual version an admin can release: it has an uploaded PDF. */
export type VersionOption = {
  versionId: number;
  label: string;
};

/** Raw values of the admin order forms, echoed back on a validation error. */
export type ActionValues = { versionId: string; note: string };
export type ActionErrors = Partial<Record<"versionId" | "note" | "confirm" | "form", string>>;

export function versionLabel(v: {
  name: string;
  modelYear: string;
  priceSantim: number | null;
  visible: boolean;
  versionVisible: boolean;
}): string {
  const price = v.priceSantim === null ? "" : ` · ${santimToEtbLabel(v.priceSantim)}`;
  const hidden = v.visible && v.versionVisible ? "" : " (hidden)";
  return `${v.name} ${v.modelYear}${price}${hidden}`;
}

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <span class="admin-error" id={`${id}-error`}>
      {error}
    </span>
  ) : null;
}

export function FormError({ error }: { error?: string }) {
  return error ? (
    <p class="notice-error" role="alert">
      {error}
    </p>
  ) : null;
}

export function VersionSelect({
  versions,
  value,
  error,
  label,
}: {
  versions: VersionOption[];
  value: string;
  error?: string;
  label: string;
}) {
  return (
    <div class="admin-field">
      <label for="versionId">{label}</label>
      <select
        id="versionId"
        name="versionId"
        required
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? "versionId-error" : undefined}
      >
        <option value="">Choose a manual</option>
        {versions.map((v) => (
          <option value={String(v.versionId)} selected={String(v.versionId) === value}>
            {v.label}
          </option>
        ))}
      </select>
      <FieldError id="versionId" error={error} />
    </div>
  );
}

export function NoteField({ value, error, hint }: { value: string; error?: string; hint: string }) {
  return (
    <div class="admin-field">
      <label for="note">Note (required)</label>
      <textarea
        id="note"
        name="note"
        rows={3}
        maxlength={500}
        required
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? "note-error" : "note-hint"}
      >
        {value}
      </textarea>
      <span class="field-hint" id="note-hint">
        {hint}
      </span>
      <FieldError id="note" error={error} />
    </div>
  );
}

export function ConfirmCheck({ label, error }: { label: string; error?: string }) {
  return (
    <div class="admin-field">
      <label class="admin-check">
        <input type="checkbox" name="confirm" value="1" required />
        {label}
      </label>
      <FieldError id="confirm" error={error} />
    </div>
  );
}

/** The #actions section of the payment detail page (P2-S2-T3). */
export function PaymentActions({
  payment,
  versions,
  values = { versionId: "", note: "" },
  errors = {},
}: {
  payment: AdminPaymentDetail;
  versions: VersionOption[];
  values?: ActionValues;
  errors?: ActionErrors;
}) {
  const canApprove = payment.status === "unclaimed" || payment.status === "flagged";
  return (
    <div class="card stack">
      <h2 class="card-title">Actions</h2>
      <FormError error={errors.form} />
      {canApprove ? (
        <form method="post" action="/admin/orders/approve-payment" class="admin-form">
          <input type="hidden" name="paymentId" value={String(payment.id)} />
          <p class="muted">
            Release a manual for this payment without the automatic checks (amount, age). Use it for
            an underpaid transfer that was settled another way.
          </p>
          <VersionSelect
            versions={versions}
            value={values.versionId}
            error={errors.versionId}
            label="Approve for"
          />
          <NoteField
            value={values.note}
            error={errors.note}
            hint="Why you are approving it, e.g. “paid the rest in cash”."
          />
          <ConfirmCheck label="I checked this payment is real" error={errors.confirm} />
          <div>
            <button type="submit" class="btn btn-dark">
              Approve and create link
            </button>
          </div>
        </form>
      ) : (
        <p class="muted">This payment is already claimed.</p>
      )}
      {payment.order && <NewLinkButton order={payment.order} />}
    </div>
  );
}

export function NewLinkButton({ order }: { order: Pick<AdminOrder, "id"> }) {
  return (
    <a class="btn btn-sm" href={`/admin/orders/${order.id}/regenerate`}>
      New link
    </a>
  );
}

/** Confirm page for replacing an order's download link. */
export function RegenerateForm({
  order,
  values = { versionId: "", note: "" },
  errors = {},
}: {
  order: AdminOrder;
  values?: ActionValues;
  errors?: ActionErrors;
}) {
  return (
    <section class="card stack" aria-labelledby="regen-title">
      <h1 class="card-title" id="regen-title">
        New link for order #{order.id}
      </h1>
      <p>
        {order.modelName} {order.modelYear} · {order.txn ?? "manual"}
      </p>
      <p class="muted">
        Every current link for this order stops working, and a new link with a fresh allowance of
        downloads is created.
      </p>
      <FormError error={errors.form} />
      <form method="post" action={`/admin/orders/${order.id}/regenerate`} class="admin-form">
        <NoteField
          value={values.note}
          error={errors.note}
          hint="Why, e.g. “buyer lost the file, asked on Telegram”."
        />
        <ConfirmCheck label="Revoke the old link and create a new one" error={errors.confirm} />
        <div>
          <button type="submit" class="btn btn-dark">
            Create new link
          </button>
        </div>
      </form>
    </section>
  );
}
