import { describe, expect, it } from "vitest";
import { etbToSantim, santimToEtbLabel } from "../src/lib/money";

describe("etbToSantim", () => {
  it.each([
    ["500", 50000],
    ["500.00", 50000],
    ["500.5", 50050],
    ["500.50", 50050],
    ["1,500.00", 150000],
    ["1500", 150000],
    ["0.01", 1],
    ["0.10", 10],
    ["1,234,567.89", 123456789],
  ])("%s → %i", (input, expected) => {
    expect(etbToSantim(input)).toBe(expected);
  });

  it.each(["abc", "1.234", "-5", "", ".5", "5.", "1,50", "1,5000", "5 ETB", "1e3"])(
    "throws on %j",
    (input) => {
      expect(() => etbToSantim(input)).toThrow();
    },
  );
});

describe("santimToEtbLabel", () => {
  it.each([
    [50000, "500 ETB"],
    [50050, "500.50 ETB"],
    [50005, "500.05 ETB"],
    [1, "0.01 ETB"],
    [0, "0 ETB"],
    [150000, "1500 ETB"],
  ])("%i → %s", (input, expected) => {
    expect(santimToEtbLabel(input)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN])("throws on %d", (input) => {
    expect(() => santimToEtbLabel(input)).toThrow();
  });
});
