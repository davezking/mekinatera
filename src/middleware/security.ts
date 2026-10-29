import type { MiddlewareHandler } from "hono";

// Security headers for every Worker response (both Workers). Static files in public/ are served
// by Workers Static Assets before the Worker runs, so they don't pass through here.
//
// The CSP allows no inline scripts or styles: all JS and CSS are self-hosted under /js and /css.
// Turnstile (checkout) loads its script and iframe from challenges.cloudflare.com.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const NOINDEX = "noindex, nofollow";

/**
 * `worker: "public"`: noindex outside production, and on /d/* links everywhere.
 * `worker: "admin"`: always noindex.
 */
export function securityHeaders(worker: "public" | "admin"): MiddlewareHandler<{
  Bindings: { ENVIRONMENT: string };
}> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    // Download responses set no-referrer themselves; keep the stricter value.
    if (!h.has("Referrer-Policy")) h.set("Referrer-Policy", "strict-origin-when-cross-origin");

    const path = new URL(c.req.url).pathname;
    if (worker === "admin" || c.env.ENVIRONMENT !== "production" || path.startsWith("/d/")) {
      h.set("X-Robots-Tag", NOINDEX);
    }
  };
}
