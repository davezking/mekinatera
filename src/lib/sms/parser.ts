import { etbToSantim } from "../money";
import { HOUR } from "../time";
import { type SmsPattern, TELEBIRR_PATTERNS } from "./patterns";

export type ParseResult =
  | {
      kind: "payment";
      patternId: string;
      transactionNumber: string;
      amountSantim: number;
      payerName: string;
      payerPhoneMasked: string;
      paidAt: number;
    }
  | { kind: "ignored"; patternId: string }
  | { kind: "failed"; reason: string };

/** Ethiopia time is UTC+3 all year (no daylight saving). */
const EAT_OFFSET_MS = 3 * HOUR;
const EAT_DATE = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/** Collapse line breaks, tabs and repeated spaces to single spaces; trim. */
export function normalizeSmsBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/** "DD/MM/YYYY HH:mm:ss" in Ethiopia time → UTC ms. Throws on an impossible date or time. */
export function parseEatDate(s: string): number {
  const m = EAT_DATE.exec(s);
  if (!m) throw new Error(`Invalid EAT date: ${JSON.stringify(s)}`);
  const [day, month, year, hour, minute, second] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const eatAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(eatAsUtc);
  // Date.UTC rolls over out-of-range parts (31/02 → 03/03, 25:00 → next day); reject those.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    throw new Error(`Invalid EAT date: ${JSON.stringify(s)}`);
  }
  return eatAsUtc - EAT_OFFSET_MS;
}

export function parseTelebirrSms(
  body: string,
  patterns: SmsPattern[] = TELEBIRR_PATTERNS,
): ParseResult {
  const text = normalizeSmsBody(body);
  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    if (pattern.kind === "ignore") return { kind: "ignored", patternId: pattern.id };

    const g = match.groups ?? {};
    const { amount, name, phone, date, txn } = g;
    if (!amount || !name || !phone || !date || !txn) {
      return { kind: "failed", reason: "missing_group" };
    }
    let amountSantim: number;
    try {
      amountSantim = etbToSantim(amount);
    } catch {
      return { kind: "failed", reason: "invalid_amount" };
    }
    if (amountSantim <= 0) return { kind: "failed", reason: "invalid_amount" };
    let paidAt: number;
    try {
      paidAt = parseEatDate(date);
    } catch {
      return { kind: "failed", reason: "invalid_date" };
    }
    const payerName = name.trim();
    if (!payerName) return { kind: "failed", reason: "missing_name" };
    return {
      kind: "payment",
      patternId: pattern.id,
      transactionNumber: txn,
      amountSantim,
      payerName,
      payerPhoneMasked: phone,
      paidAt,
    };
  }
  return { kind: "failed", reason: "no_pattern" };
}
