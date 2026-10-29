import type { Context } from "hono";
import { Hono } from "hono";
import { raw } from "hono/html";
import type { JSX } from "hono/jsx/jsx-runtime";
import type { AppEnv } from "../env";
import { getCheckout, listCatalog } from "../lib/db/catalog";
import { CatalogPage } from "../views/catalog";
import { CheckoutPage, NotFoundPage } from "../views/checkout";
import { Layout } from "../views/layout";

// Catalog page (/), checkout page (/m/:slug) and car images (/media/images/*).
export const publicRoutes = new Hono<AppEnv>();

function page(c: Context<AppEnv>, title: string, body: JSX.Element, status: 200 | 404 = 200) {
  return c.html(
    <>
      {raw("<!doctype html>")}
      <Layout title={title} env={c.env.ENVIRONMENT} supportContact={c.env.SUPPORT_CONTACT}>
        {body}
      </Layout>
    </>,
    status,
  );
}

publicRoutes.get("/", async (c) => {
  const models = await listCatalog(c.env.DB);
  return page(
    c,
    "BYD Manuals: English owner's manuals",
    <CatalogPage models={models} supportContact={c.env.SUPPORT_CONTACT} />,
  );
});

publicRoutes.get("/m/:slug", async (c) => {
  const model = await getCheckout(c.env.DB, c.req.param("slug"));
  if (!model?.version.available) {
    return page(c, "Not found · BYD Manuals", <NotFoundPage />, 404);
  }
  return page(
    c,
    `${model.name} (${model.modelYear}) · BYD Manuals`,
    <CheckoutPage
      model={model}
      telebirrPhone={c.env.TELEBIRR_PHONE}
      telebirrName={c.env.TELEBIRR_NAME}
      supportContact={c.env.SUPPORT_CONTACT}
      turnstileSiteKey={c.env.TURNSTILE_SITE_KEY}
    />,
  );
});

// Car images only. The R2 key is the path after /media/ and must be a flat image file under
// images/ (admin uploads use images/<slug>-<ts>.<ext>): manual PDFs are never reachable here.
const IMAGE_KEY = /^images\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/i;

publicRoutes.get("/media/images/*", async (c) => {
  const prefix = "/media/";
  let key: string;
  try {
    key = decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length));
  } catch {
    return c.notFound();
  }
  if (!IMAGE_KEY.test(key) || key.includes("..")) return c.notFound();
  const object = await c.env.MANUALS.get(key);
  if (!object) return c.notFound();
  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
});
