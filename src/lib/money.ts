// Money is integer santim (100 santim = 1 ETB). Convert only at the edges, never with floats.

const ETB_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** "1,500.00" → 150000. Accepts "500", "500.5", "500.50"; throws on anything else. */
export function etbToSantim(input: string): number {
  const value = input.trim();
  const match = ETB_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid ETB amount: ${JSON.stringify(input)}`);
  const [whole = "", fraction = ""] = value.replaceAll(",", "").split(".");
  const santim = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(santim)) throw new Error(`ETB amount too large: ${input}`);
  return santim;
}

/** 50000 → "500 ETB", 50050 → "500.50 ETB". */
export function santimToEtbLabel(santim: number): string {
  if (!Number.isSafeInteger(santim) || santim < 0) {
    throw new Error(`Invalid santim amount: ${santim}`);
  }
  const whole = Math.trunc(santim / 100);
  const fraction = santim % 100;
  const etb = fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
  return `${etb} ETB`;
}
