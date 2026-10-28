import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AdminEnv } from "../admin-env";

type Jwks = ReturnType<typeof createRemoteJWKSet>;

/** One JWKS fetcher per team domain per isolate; jose caches the keys inside it. */
const jwksCache = new Map<string, Jwks>();

function jwksFor(teamDomain: string): Jwks {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Local dev only: all three conditions must hold, so it can never apply on staging or production. */
function devBypass(env: AdminEnv["Bindings"], url: URL): boolean {
  return (
    env.ENVIRONMENT === "development" &&
    env.ADMIN_DEV_BYPASS === "1" &&
    LOCAL_HOSTS.has(url.hostname)
  );
}

type Verdict = { ok: true; email: string } | { ok: false; reason: string };

async function verifyAccessJwt(
  env: AdminEnv["Bindings"],
  token: string | undefined,
): Promise<Verdict> {
  if (!token) return { ok: false, reason: "missing_token" };
  const teamDomain = (env.ACCESS_TEAM_DOMAIN ?? "").replace(/\/+$/, "");
  const adminEmail = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!teamDomain.startsWith("https://") || !env.ACCESS_AUD || !adminEmail) {
    return { ok: false, reason: "misconfigured" };
  }
  try {
    const { payload } = await jwtVerify(token, jwksFor(teamDomain), {
      issuer: teamDomain,
      audience: env.ACCESS_AUD,
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (email !== adminEmail) return { ok: false, reason: "wrong_email" };
    return { ok: true, email };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}

function secure(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

/**
 * Guards every /admin route (architecture.md §6): Cloudflare Access JWT for ADMIN_EMAIL (or the
 * local dev bypass), same-origin check on writes, and no-store + noindex on every response.
 */
export function adminAuth(): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const url = new URL(c.req.url);
    const deny = (reason: string) => {
      console.log(JSON.stringify({ event: "admin_denied", reason }));
      return secure(c.text("Not authorized", 403));
    };

    let email: string;
    if (devBypass(c.env, url)) {
      email = "dev@localhost";
    } else {
      const token = c.req.header("Cf-Access-Jwt-Assertion") ?? getCookie(c, "CF_Authorization");
      const verdict = await verifyAccessJwt(c.env, token);
      if (!verdict.ok) return deny(verdict.reason);
      email = verdict.email;
    }

    if (
      c.req.method !== "GET" &&
      c.req.method !== "HEAD" &&
      c.req.header("Origin") !== url.origin
    ) {
      return deny("csrf");
    }

    c.set("adminEmail", email);
    await next();
    secure(c.res);
  };
}
