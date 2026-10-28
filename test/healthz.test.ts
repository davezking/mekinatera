import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /healthz", () => {
  it("returns ok and the environment", async () => {
    const res = await SELF.fetch("https://example.com/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, env: "development" });
  });

  it("sets noindex outside production", async () => {
    const res = await SELF.fetch("https://example.com/healthz");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("returns 404 for unknown paths, including /admin", async () => {
    for (const path of ["/nope", "/admin", "/admin/models", "/api/unknown"]) {
      const res = await SELF.fetch(`https://example.com${path}`);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("X-Robots-Tag"), path).toBe("noindex, nofollow");
    }
  });
});
