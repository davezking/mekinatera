// Cloudflare Turnstile server-side check for POST /api/claim (PRD security). The site key is
// public (TURNSTILE_SITE_KEY); the secret is a Worker secret (TURNSTILE_SECRET_KEY).
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Turnstile tokens are at most 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 5000;

/**
 * true only if siteverify says the token is valid. A missing or oversized token is rejected
 * without a network call; a network error, timeout or unreadable reply counts as a failure.
 */
export async function verifyTurnstile(
  secret: string,
  token: unknown,
  ip: string | null,
): Promise<boolean> {
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN_LENGTH) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  }
}
