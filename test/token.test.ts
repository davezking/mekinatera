import { describe, expect, it } from "vitest";
import { base64url, fromBase64url, generateToken, hashToken } from "../src/lib/token";

describe("generateToken", () => {
  it("is 43 base64url characters (32 bytes, no padding)", () => {
    for (let i = 0; i < 20; i++) {
      const t = generateToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fromBase64url(t)).toHaveLength(32);
    }
  });

  it("is random", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));
    expect(tokens.size).toBe(50);
  });
});

describe("hashToken", () => {
  it("is deterministic, 64 lowercase hex characters", async () => {
    const t = generateToken();
    const h = await hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(t)).toBe(h);
    expect(await hashToken(`${t}x`)).not.toBe(h);
  });

  it("matches the known SHA-256 of 'abc'", async () => {
    expect(await hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("base64url", () => {
  it("round-trips bytes and rejects non-base64url input", () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 250, 251]);
    expect(base64url(bytes)).toBe("AP8-P_r7");
    expect(fromBase64url("AP8-P_r7")).toEqual(bytes);
    expect(fromBase64url("AP8+P/r7")).toBeNull();
    expect(fromBase64url("a")).toBeNull();
  });
});
