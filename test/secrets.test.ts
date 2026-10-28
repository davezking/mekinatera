import { describe, expect, it } from "vitest";
import { safeEqual } from "../src/lib/secrets";

describe("safeEqual", () => {
  it("returns true for equal strings", () => {
    expect(safeEqual("dev-webhook-secret", "dev-webhook-secret")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("ብር-secret", "ብር-secret")).toBe(true);
  });

  it("returns false for unequal strings of the same length", () => {
    expect(safeEqual("dev-webhook-secret", "dev-webhook-secreT")).toBe(false);
  });

  it("returns false (without throwing) for different lengths", () => {
    expect(safeEqual("short", "much-longer-secret")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
    // Same UTF-16 length, different UTF-8 byte length.
    expect(safeEqual("é", "e")).toBe(false);
  });
});
