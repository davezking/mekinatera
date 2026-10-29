import { raw } from "hono/html";
import { Layout } from "./layout";

/** Friendly page for unknown URLs (404) and unexpected errors (500). Never shows error details. */
export function ErrorPage({
  status,
  supportContact,
}: {
  status: 404 | 500;
  supportContact: string;
}) {
  const notFound = status === 404;
  return (
    <div class="narrow not-found">
      <h1>{notFound ? "Page not found" : "Something went wrong"}</h1>
      <p class="lead">
        {notFound
          ? "We couldn't find this page. It may have moved, or the address has a typo."
          : "Sorry, we couldn't load this page. Please try again in a minute."}
      </p>
      <p class="muted">
        Paid and need help? Email <a href={`mailto:${supportContact}`}>{supportContact}</a> with
        your transaction number.
      </p>
      <a class="btn btn-dark btn-block btn-lg" href="/">
        Back to manuals
      </a>
    </div>
  );
}

/** The full HTML document for a 404 or 500 page on the public Worker. */
export function errorDocument(
  status: 404 | 500,
  env: { ENVIRONMENT: string; SUPPORT_CONTACT: string },
) {
  const title = status === 404 ? "Page not found" : "Something went wrong";
  return (
    <>
      {raw("<!doctype html>")}
      <Layout
        title={`${title} · BYD Manuals`}
        env={env.ENVIRONMENT}
        supportContact={env.SUPPORT_CONTACT}
      >
        <ErrorPage status={status} supportContact={env.SUPPORT_CONTACT} />
      </Layout>
    </>
  );
}
