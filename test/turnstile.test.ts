import { afterEach, describe, expect, it, vi } from "vitest";
import { SITEVERIFY_URL, verifyTurnstile } from "../src/lib/turnstile";

const SECRET = "1x0000000000000000000000000000000AA";

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) =>
      impl(input instanceof Request ? input.url : String(input), init),
    );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyTurnstile", () => {
  it("POSTs secret, response and remoteip form-encoded and returns success", async () => {
    const spy = stubFetch(async () => json({ success: true }));
    expect(await verifyTurnstile(SECRET, "tok-123", "203.0.113.7")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    const form = new URLSearchParams(init.body as URLSearchParams);
    expect(Object.fromEntries(form)).toEqual({
      secret: SECRET,
      response: "tok-123",
      remoteip: "203.0.113.7",
    });
  });

  it("leaves out remoteip when the IP is unknown", async () => {
    const spy = stubFetch(async () => json({ success: true }));
    await verifyTurnstile(SECRET, "tok", null);
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(new URLSearchParams(init.body as URLSearchParams).has("remoteip")).toBe(false);
  });

  it.each([
    ["success false", () => json({ success: false, "error-codes": ["invalid-input-response"] })],
    ["a non-boolean success", () => json({ success: "true" })],
    ["an HTTP error", () => json({ success: true }, 500)],
    ["a non-JSON reply", () => new Response("<html>", { status: 200 })],
  ])("returns false for %s", async (_, reply) => {
    stubFetch(async () => reply());
    expect(await verifyTurnstile(SECRET, "tok", "203.0.113.7")).toBe(false);
  });

  it("returns false on a network error", async () => {
    stubFetch(async () => {
      throw new TypeError("network down");
    });
    expect(await verifyTurnstile(SECRET, "tok", "203.0.113.7")).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a string", 123],
    ["too long", "x".repeat(2049)],
  ])("returns false without calling siteverify for a %s token", async (_, token) => {
    const spy = stubFetch(async () => json({ success: true }));
    expect(await verifyTurnstile(SECRET, token, "203.0.113.7")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
