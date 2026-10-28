import { raw } from "hono/html";
import { Layout } from "./layout";

export function DownloadExpiredPage({ supportContact }: { supportContact: string }) {
  return (
    <div class="narrow not-found link-expired">
      <div class="status-tile">
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M14 3v5h5" />
          <circle cx="12.5" cy="15" r="3.5" />
          <path d="M12.5 13.5V15l1 1" />
        </svg>
      </div>
      <h1>This download link has expired</h1>
      <p class="lead">
        Links work for 24 hours and up to 3 downloads. This one has run out, or a new link was sent
        to you.
      </p>
      <div class="card paid-card">
        <strong>Already paid?</strong>
        <p class="help-note__text">
          Email <a href={`mailto:${supportContact}`}>{supportContact}</a> with your telebirr
          transaction number. We'll send you a new link.
        </p>
      </div>
      <a class="btn btn-dark btn-block btn-lg" href="/">
        Back to manuals
      </a>
    </div>
  );
}

export function DownloadFailedPage({ supportContact }: { supportContact: string }) {
  return (
    <div class="narrow not-found">
      <h1>Something went wrong</h1>
      <p class="lead">
        We couldn't send this file right now. Please try again in a few minutes, or email{" "}
        <a href={`mailto:${supportContact}`}>{supportContact}</a>.
      </p>
      <a class="btn btn-dark btn-block btn-lg" href="/">
        Back to manuals
      </a>
    </div>
  );
}

/** Full HTML documents, so the route module (download.ts) needs no JSX. */
export function downloadErrorDocument(
  kind: "expired" | "failed",
  env: { ENVIRONMENT: string; SUPPORT_CONTACT: string },
) {
  const supportContact = env.SUPPORT_CONTACT;
  return (
    <>
      {raw("<!doctype html>")}
      <Layout
        title={kind === "expired" ? "Link expired · BYD Manuals" : "Download failed · BYD Manuals"}
        env={env.ENVIRONMENT}
        supportContact={supportContact}
      >
        {kind === "expired" ? (
          <DownloadExpiredPage supportContact={supportContact} />
        ) : (
          <DownloadFailedPage supportContact={supportContact} />
        )}
      </Layout>
    </>
  );
}
