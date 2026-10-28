import { base64url, fromBase64url } from "./token";

/** What a poll ticket vouches for: this buyer passed the POST checks for this txn and version. */
export type TicketPayload = { txn: string; versionId: number; expiresAt: number };

const encoder = new TextEncoder();

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/** `base64url(JSON) + "." + base64url(HMAC-SHA256(secret, first part))`. */
export async function createTicket(secret: string, payload: TicketPayload): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(sig))}`;
}

/**
 * Checks the signature (constant-time, via `crypto.subtle.verify`) and the payload shape,
 * but not the expiry. Returns null for anything malformed or tampered with.
 */
export async function readTicket(secret: string, ticket: string): Promise<TicketPayload | null> {
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [body, sigPart] = parts as [string, string];
  const sig = fromBase64url(sigPart);
  const json = fromBase64url(body);
  if (!body || !sig || !json) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    sig,
    encoder.encode(body),
  );
  if (!ok) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return null;
  }
  const p = payload as Partial<TicketPayload> | null;
  if (
    typeof p !== "object" ||
    p === null ||
    typeof p.txn !== "string" ||
    !Number.isSafeInteger(p.versionId) ||
    !Number.isSafeInteger(p.expiresAt)
  ) {
    return null;
  }
  return { txn: p.txn, versionId: p.versionId as number, expiresAt: p.expiresAt as number };
}

/** The payload of a valid, unexpired ticket, or null. */
export async function verifyTicket(
  secret: string,
  ticket: string,
  now: number,
): Promise<TicketPayload | null> {
  const payload = await readTicket(secret, ticket);
  return payload && payload.expiresAt > now ? payload : null;
}
