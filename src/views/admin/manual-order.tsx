import {
  type ActionErrors,
  type ActionValues,
  ConfirmCheck,
  FormError,
  NoteField,
  type VersionOption,
  VersionSelect,
} from "./payment-actions";

/** "Approve without a payment" (FR-26): the SMS was lost, or the buyer paid from a bank app. */
export function ManualOrderForm({
  versions,
  values = { versionId: "", note: "" },
  errors = {},
}: {
  versions: VersionOption[];
  values?: ActionValues;
  errors?: ActionErrors;
}) {
  return (
    <section class="card stack" aria-labelledby="manual-title">
      <h1 class="card-title" id="manual-title">
        Approve without a payment
      </h1>
      <p class="muted">
        Creates an order and a download link with no recorded payment. Use it only when you have
        confirmed the money arrived, e.g. the SMS was lost or the buyer paid from a bank app.
      </p>
      <FormError error={errors.form} />
      <form method="post" action="/admin/orders/manual" class="admin-form">
        <VersionSelect
          versions={versions}
          value={values.versionId}
          error={errors.versionId}
          label="Manual"
        />
        <NoteField
          value={values.note}
          error={errors.note}
          hint="The buyer's transaction number and how to reach them."
        />
        <ConfirmCheck label="I checked this payment is real" error={errors.confirm} />
        <div>
          <button type="submit" class="btn btn-dark">
            Create order and link
          </button>
        </div>
      </form>
    </section>
  );
}
