/** Shown once after an admin creates a download link. The raw token is never stored. */
export function LinkCreated({
  heading,
  url,
  orderId,
  paymentId,
}: {
  heading: string;
  url: string;
  orderId: number;
  paymentId: number | null;
}) {
  return (
    <section class="card stack" aria-labelledby="link-title">
      <h1 class="card-title" id="link-title">
        {heading}
      </h1>
      <p class="notice-warn" role="status">
        <strong>This link is shown only once.</strong> Send it to the buyer now (Telegram/SMS).
      </p>
      <div class="admin-field">
        <label for="download-url">Download link</label>
        <input id="download-url" class="mono" type="text" value={url} readonly />
      </div>
      <div>
        <button type="button" class="btn btn-dark" data-copy={url}>
          Copy link
        </button>
      </div>
      <p class="muted">
        Order #{orderId}.{" "}
        {paymentId !== null && <a href={`/admin/payments/${paymentId}`}>Back to the payment</a>}{" "}
        <a href="/admin/payments/orders">All orders</a>
      </p>
      <script type="module" src="/js/copy.js" />
    </section>
  );
}
