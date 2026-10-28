export type SmsPattern = { id: string; kind: "payment" | "ignore"; regex: RegExp };

// telebirr SMS wordings, tried in order against the whitespace-normalized body.
// Add new wordings here (a new id per wording; never change a shipped regex in place).
// Payment patterns come first. Ignore patterns must NEVER match the payment wording:
// test/sms-parser.test.ts checks every ignore pattern against a real payment SMS.
export const TELEBIRR_PATTERNS: SmsPattern[] = [
  {
    id: "t2t-received-v1",
    kind: "payment",
    regex:
      /You have received ETB (?<amount>[\d,]+\.\d{2}) from (?<name>.+?)\s*\((?<phone>[\d*]+)\) on (?<date>\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2})\. Your transaction number is (?<txn>[A-Z0-9]{10})\./,
  },
  {
    id: "bank-deposit-v1",
    kind: "ignore",
    regex: /\bfrom [A-Za-z .&]*Bank\b|\bby transaction number\b/i,
  },
  { id: "outgoing-v1", kind: "ignore", regex: /\bYou have (transferred|sent|paid)\b/i },
  { id: "airtime-v1", kind: "ignore", regex: /\b(airtime|recharged|package)\b/i },
];
