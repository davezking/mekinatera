import { describe, expect, it } from "vitest";
import { createTicket, readTicket, verifyTicket } from "../src/lib/ticket";
import { base64url } from "../src/lib/token";

const SECRET = "test-ticket-secret";
const NOW = 1_800_000_000_000;
const PAYLOAD = { txn: "DIQ55JS1ED", versionId: 7, expiresAt: NOW + 600_000 };

describe("poll tickets", () => {
  it("round-trips", async () => {
    const ticket = await createTicket(SECRET, PAYLOAD);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyTicket(SECRET, ticket, NOW)).toEqual(PAYLOAD);
  });

  it("rejects a tampered payload", async () => {
    const ticket = await createTicket(SECRET, PAYLOAD);
    const [, sig] = ticket.split(".");
    const forged = base64url(
      new TextEncoder().encode(JSON.stringify({ ...PAYLOAD, txn: "OTHERTXN01" })),
    );
    expect(await verifyTicket(SECRET, `${forged}.${sig}`, NOW)).toBeNull();
  });

  it("rejects a tampered signature or another secret", async () => {
    const ticket = await createTicket(SECRET, PAYLOAD);
    const flipped = ticket.slice(0, -2) + (ticket.endsWith("AA") ? "BB" : "AA");
    expect(await verifyTicket(SECRET, flipped, NOW)).toBeNull();
    expect(await verifyTicket("other-secret", ticket, NOW)).toBeNull();
  });

  it("rejects an expired ticket, but readTicket still reads it", async () => {
    const ticket = await createTicket(SECRET, PAYLOAD);
    expect(await verifyTicket(SECRET, ticket, PAYLOAD.expiresAt)).toBeNull();
    expect(await verifyTicket(SECRET, ticket, PAYLOAD.expiresAt + 1)).toBeNull();
    expect(await readTicket(SECRET, ticket)).toEqual(PAYLOAD);
  });

  it.each(["", "nodot", "a.b.c", ".sig", "!!!.???"])("rejects malformed %j", async (ticket) => {
    expect(await verifyTicket(SECRET, ticket, NOW)).toBeNull();
  });

  it("rejects a correctly signed ticket with the wrong payload shape", async () => {
    const bad = await createTicket(SECRET, {
      txn: 5,
      versionId: "7",
      expiresAt: NOW + 1,
    } as unknown as typeof PAYLOAD);
    expect(await verifyTicket(SECRET, bad, NOW)).toBeNull();
  });
});
