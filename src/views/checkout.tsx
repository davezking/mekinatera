import type { CheckoutModel } from "../lib/db/catalog";
import { santimToEtbLabel } from "../lib/money";
import { CAR_PLACEHOLDER, Icon, Price } from "./catalog";

/** "0977328406" → "0977 328 406" (4-3-3 grouping, as telebirr shows it). */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10
    ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
    : digits;
}

function fileSizeLabel(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return "";
  return ` · ${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

type CheckoutProps = {
  model: CheckoutModel;
  telebirrPhone: string;
  telebirrName: string;
  supportContact: string;
};

export function CheckoutPage({
  model,
  telebirrPhone,
  telebirrName,
  supportContact,
}: CheckoutProps) {
  const price = santimToEtbLabel(model.version.priceSantim);
  return (
    <div class="narrow checkout">
      <a class="back-link" href="/">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        All manuals
      </a>

      <section class="checkout-head">
        <div class="model-tile">
          <img src={model.imageUrl ?? CAR_PLACEHOLDER} alt="" width="70" height="28" />
        </div>
        <div class="checkout-head__text">
          <h1>
            {model.name} ({model.modelYear})
          </h1>
          <span class="muted">
            English owner's manual · PDF{fileSizeLabel(model.version.fileSize)}
          </span>
        </div>
      </section>

      <section class="price-card">
        <div>
          <div class="price-card__label">Price</div>
          <Price santim={model.version.priceSantim} />
        </div>
        <span class="price-card__note">Translated from the Chinese original</span>
      </section>

      <section class="card" aria-labelledby="pay-title">
        <h2 class="card-title" id="pay-title">
          Pay with telebirr
        </h2>
        <ol class="steps">
          <li>
            <span class="step-num">1</span>
            <span class="step-body">
              <span>
                Open the <strong>telebirr app</strong>.
              </span>
            </span>
          </li>
          <li>
            <span class="step-num">2</span>
            <div class="step-body">
              <span>
                Send exactly <strong>{price}</strong> to:
              </span>
              <div class="phone-box">
                <div class="phone-box__text">
                  <span class="phone-box__number">{formatPhone(telebirrPhone)}</span>
                  <span class="phone-box__name">
                    telebirr shows: <strong>{telebirrName}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  data-copy={telebirrPhone.replace(/\D/g, "")}
                >
                  Copy
                </button>
              </div>
            </div>
          </li>
          <li>
            <span class="step-num">3</span>
            <span class="step-body">
              <span>
                In the telebirr app, find the <strong>transaction number</strong> of this payment.
              </span>
            </span>
          </li>
          <li>
            <span class="step-num">4</span>
            <span class="step-body">
              <span>Enter it below to get your PDF.</span>
            </span>
          </li>
        </ol>
        <div class="notice-warn">
          <Icon d={["M12 3l9.5 17h-19z", "M12 10v4", "M12 17.5v.5"]} />
          <span>
            <strong>telebirr to telebirr only.</strong> Payments from a bank app can't be verified
            automatically.
          </span>
        </div>
      </section>

      <section class="card claim-card">
        <form id="claim-form" class="stack claim-form" method="post" novalidate>
          <label class="field-label" for="txn">
            Transaction number
          </label>
          <input
            id="txn"
            class="txn-input"
            name="transactionNumber"
            placeholder="D•••••••••"
            autocapitalize="characters"
            autocomplete="off"
            inputmode="text"
            spellcheck={false}
            maxlength={14}
            aria-describedby="txn-hint"
          />
          <p id="txn-hint" class="field-hint">
            Copy it from the telebirr app. It starts with <strong>D</strong> and has 10 letters and
            numbers.
          </p>
          <input type="hidden" name="versionId" value={String(model.version.id)} />
          <div id="turnstile-slot" />
          <button type="submit" class="btn btn-block btn-lg">
            Get my PDF
          </button>
        </form>
        <div id="claim-status" aria-live="polite" />
      </section>

      <section class="help-note">
        <h2>Paid but something went wrong?</h2>
        <p class="muted help-note__text">
          Email <a href={`mailto:${supportContact}`}>{supportContact}</a> with your transaction
          number and the model you bought. We'll sort it out by hand.
        </p>
      </section>

      <script type="module" src="/js/copy.js" />
      <script type="module" src="/js/claim.js" />
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div class="narrow not-found">
      <h1>Page not found</h1>
      <p class="lead">
        This manual isn't available. It may have been removed or not translated yet.
      </p>
      <a class="btn btn-dark btn-block btn-lg" href="/">
        Back to manuals
      </a>
    </div>
  );
}
