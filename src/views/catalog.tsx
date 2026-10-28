import type { CatalogModel } from "../lib/db/catalog";
import { santimToEtbLabel } from "../lib/money";

export const CAR_PLACEHOLDER = "/img/car-placeholder.svg";

/** "500 ETB" → <span class="price">500 <span class="price__unit">ETB</span></span> */
export function Price({ santim }: { santim: number }) {
  const amount = santimToEtbLabel(santim).replace(/ ETB$/, "");
  return (
    <span class="price">
      {amount} <span class="price__unit">ETB</span>
    </span>
  );
}

export function Icon({
  d,
  circles = [],
  size = 20,
}: {
  d: string[];
  circles?: [cx: number, cy: number, r: number][];
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="notice__icon"
    >
      {circles.map(([cx, cy, r]) => (
        <circle cx={cx} cy={cy} r={r} />
      ))}
      {d.map((path) => (
        <path d={path} />
      ))}
    </svg>
  );
}

const STEPS = [
  ["Choose your model", "Each manual is a complete English PDF."],
  ["Pay with the telebirr app", "telebirr to telebirr only, not from a bank app."],
  ["Enter the transaction number", "Your download starts as soon as the payment is confirmed."],
] as const;

function ModelCard({ model }: { model: CatalogModel }) {
  return (
    <article class="model-card">
      <div class="model-card__image">
        <img
          src={model.imageUrl ?? CAR_PLACEHOLDER}
          alt=""
          width="230"
          height="92"
          loading="lazy"
        />
        {!model.available && <span class="pill pill-outline">Coming soon</span>}
      </div>
      <div class="model-card__body">
        <div class="model-card__head">
          <div class="model-card__meta">
            <h3>{model.name}</h3>
            <span>{model.modelYear} · English owner's manual</span>
          </div>
          {model.available && model.version && <Price santim={model.version.priceSantim} />}
        </div>
        {model.available ? (
          <a class="btn btn-dark" href={`/m/${model.slug}`}>
            Get manual
          </a>
        ) : (
          <p class="model-card__soon">Translation in progress</p>
        )}
      </div>
    </article>
  );
}

const FAQ = [
  [
    "How do I pay?",
    "Send the price from the telebirr app to the number shown on the manual's page (telebirr to telebirr). Then type the transaction number from telebirr on the same page.",
  ],
  [
    "Can I pay from my bank app?",
    "Bank-app payments can't be checked automatically. Use the telebirr app, or email {SUPPORT} if you already paid from a bank.",
  ],
  [
    'I paid, but it says "waiting" or "not found"',
    "Most payments confirm within a minute. If nothing happens after 10 minutes, check the number and email {SUPPORT}. We'll send your link by hand.",
  ],
  [
    "Can I download it again later?",
    "Your link works for 24 hours and up to 3 downloads. There are no accounts, so save the PDF to your phone right away.",
  ],
] as const;

export function CatalogPage({
  models,
  supportContact,
}: {
  models: CatalogModel[];
  supportContact: string;
}) {
  const mailto = `mailto:${supportContact}`;
  return (
    <>
      <section class="hero">
        <div class="hero__inner">
          <div class="hero__text">
            <span class="eyebrow">For China-import BYD owners in Ethiopia</span>
            <h1>Your BYD owner's manual, in English.</h1>
            <p class="lead">
              Translated from the Chinese original. Pay with telebirr and download the PDF in about
              a minute. No account needed.
            </p>
            <div class="hero__actions">
              <a class="btn btn-lg" href="#manuals">
                Find my model
                <Icon d={["M12 5v14", "M6 13l6 6 6-6"]} size={18} />
              </a>
              <a class="btn btn-lg btn-secondary hero__secondary" href="#how">
                How it works
              </a>
            </div>
          </div>
          <div class="how-card" id="how">
            <h2>How it works</h2>
            <ol>
              {STEPS.map(([title, text], i) => (
                <li>
                  <span class="how__num">{`0${i + 1}`}</span>
                  <div class="how__step">
                    <strong>{title}</strong>
                    <span class="how__text">{text}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section class="section how-section" aria-labelledby="how-mobile-title">
        <div class="container stack">
          <h2 class="section-kicker" id="how-mobile-title">
            How it works
          </h2>
          <ol class="how">
            {STEPS.map(([title], i) => (
              <li>
                <span class="how__num">{`0${i + 1}`}</span>
                <span>{title}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section class="section" id="manuals" aria-labelledby="manuals-title">
        <div class="container stack">
          <div class="section-head">
            <h2 id="manuals-title">Manuals</h2>
            <span class="muted">English PDF</span>
          </div>
          <div class="models">
            {models.map((model) => (
              <ModelCard model={model} />
            ))}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="card trust">
            <div class="trust__item">
              <Icon circles={[[12, 8, 4]]} d={["M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6", "M3 3l18 18"]} />
              <p class="trust__text">
                <strong>No account needed.</strong> Just your telebirr transaction number.
              </p>
            </div>
            <div class="trust__item">
              <Icon circles={[[12, 12, 9]]} d={["M12 7v5l3 2"]} />
              <p class="trust__text">
                <strong>Save it right away.</strong> Your download link works for 24 hours and 3
                downloads.
              </p>
            </div>
            <div class="trust__item">
              <Icon d={["M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"]} />
              <p class="trust__text">
                <strong>Need help?</strong> Email <a href={mailto}>{supportContact}</a> with your
                transaction number.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="section" id="help" aria-labelledby="help-title">
        <div class="container faq-section">
          <div class="stack">
            <h2 id="help-title">Questions</h2>
            <p class="muted">
              Still stuck? Email <a href={mailto}>{supportContact}</a> with your transaction number.
            </p>
          </div>
          <div class="faq">
            {FAQ.map(([question, answer], i) => (
              <details open={i === 0}>
                <summary>{question}</summary>
                <p>{answer.replaceAll("{SUPPORT}", supportContact)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
