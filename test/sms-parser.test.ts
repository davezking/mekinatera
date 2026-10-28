import { describe, expect, it } from "vitest";
import { normalizeSmsBody, parseEatDate, parseTelebirrSms } from "../src/lib/sms/parser";
import { TELEBIRR_PATTERNS } from "../src/lib/sms/patterns";
import { redactSms } from "../src/lib/sms/redact";

// PRD appendix (real wording, names replaced).
const APPENDIX_SMS = `Dear [Owner]
You have received ETB 500.00 from [Payer Name](2519****2531) on 26/09/2026 09:57:24. Your transaction number is DIQ55JS1ED. Your current E-Money Account balance is ETB [hidden].
Thank you for using telebirr
Ethio telecom`;

const APPENDIX_EXPECTED = {
  kind: "payment",
  patternId: "t2t-received-v1",
  transactionNumber: "DIQ55JS1ED",
  amountSantim: 50000,
  payerName: "[Payer Name]",
  payerPhoneMasked: "2519****2531",
  paidAt: Date.UTC(2026, 8, 26, 6, 57, 24),
};

// Real outgoing telebirr SMS (names replaced), with its double spaces.
const OUTGOING_SMS = `Dear [Owner]
You have transferred ETB 500.00 to [Recipient Name] (2519****3118) on 22/10/2026 10:21:55. Your transaction number is DJM95ZKH8J. The service fee is  ETB 1.74 and  15% VAT on the service fee is ETB 0.26. Your current E-Money Account  balance is ETB 1,679.92. To download your payment information please click this link: https://transactioninfo.ethiotelecom.et/receipt/DJM95ZKH8J.

Thank you for using telebirr
Ethio telecom`;

function payment(fields: { amount?: string; date?: string; txn?: string } = {}): string {
  const { amount = "500.00", date = "26/09/2026 09:57:24", txn = "DIQ55JS1ED" } = fields;
  return `Dear [Owner] You have received ETB ${amount} from Abebe Kebede(2519****2531) on ${date}. Your transaction number is ${txn}. Your current E-Money Account balance is ETB 12,345.67. Thank you for using telebirr`;
}

describe("parseTelebirrSms", () => {
  it("parses the PRD appendix SMS to exactly the expected values (FR-8)", () => {
    expect(parseTelebirrSms(APPENDIX_SMS)).toEqual(APPENDIX_EXPECTED);
  });

  it.each([
    ["one line", APPENDIX_SMS.replace(/\n/g, " ")],
    ["CRLF line breaks", APPENDIX_SMS.replace(/\n/g, "\r\n")],
    ["double spaces", APPENDIX_SMS.replace(/ /g, "  ")],
    [
      "breaks inside sentences",
      APPENDIX_SMS.replace("ETB 500.00 from", "ETB 500.00\nfrom").replace(" on ", "\r\non\t"),
    ],
    ["leading and trailing whitespace", `\n\n  ${APPENDIX_SMS}  \n`],
  ])("parses the same SMS identically with %s", (_label, body) => {
    expect(parseTelebirrSms(body)).toEqual(APPENDIX_EXPECTED);
  });

  it("parses ETB 1,500.00 as 150000 santim", () => {
    expect(parseTelebirrSms(payment({ amount: "1,500.00" }))).toMatchObject({
      kind: "payment",
      amountSantim: 150000,
    });
  });

  it("converts a date after midnight EAT to the previous UTC day", () => {
    const result = parseTelebirrSms(payment({ date: "01/10/2026 01:30:00" }));
    expect(result.kind).toBe("payment");
    if (result.kind === "payment") {
      expect(new Date(result.paidAt).toISOString()).toBe("2026-09-30T22:30:00.000Z");
    }
  });

  it("ignores a bank-deposit message (FR-7)", () => {
    const bank =
      "Dear [Owner] You have received ETB 1,000.00 from Commercial Bank of Ethiopia on 26/09/2026 09:57:24 by transaction number FT26269ABC12. Your current E-Money Account balance is ETB 5,000.00. Thank you for using telebirr";
    expect(parseTelebirrSms(bank)).toEqual({ kind: "ignored", patternId: "bank-deposit-v1" });
  });

  it("ignores the real outgoing telebirr SMS with pattern outgoing-v1", () => {
    expect(parseTelebirrSms(OUTGOING_SMS)).toEqual({ kind: "ignored", patternId: "outgoing-v1" });
  });

  it("ignores an airtime message", () => {
    expect(parseTelebirrSms("You have recharged 50.00 Birr airtime. Thank you.")).toEqual({
      kind: "ignored",
      patternId: "airtime-v1",
    });
  });

  it("fails random text from 127 with reason no_pattern", () => {
    expect(parseTelebirrSms("Hello, your service will be down tonight.")).toEqual({
      kind: "failed",
      reason: "no_pattern",
    });
    expect(parseTelebirrSms("")).toEqual({ kind: "failed", reason: "no_pattern" });
  });

  it.each([
    ["lowercase", "diq55js1ed"],
    ["mixed case", "DIQ55js1ED"],
    ["9 characters", "DIQ55JS1E"],
    ["11 characters", "DIQ55JS1EDX"],
  ])("does not match the payment pattern with a %s transaction number", (_label, txn) => {
    expect(parseTelebirrSms(payment({ txn }))).toEqual({ kind: "failed", reason: "no_pattern" });
  });

  it("fails a zero amount", () => {
    expect(parseTelebirrSms(payment({ amount: "0.00" }))).toEqual({
      kind: "failed",
      reason: "invalid_amount",
    });
  });

  it("fails a malformed amount", () => {
    expect(parseTelebirrSms(payment({ amount: "1,50.00" }))).toEqual({
      kind: "failed",
      reason: "invalid_amount",
    });
  });

  it("fails an impossible date", () => {
    expect(parseTelebirrSms(payment({ date: "31/02/2026 09:57:24" }))).toEqual({
      kind: "failed",
      reason: "invalid_date",
    });
  });

  it("fails a payer name that imitates a second set of payment details", () => {
    const injected = payment().replace(
      "from Abebe Kebede(",
      "from X(2519****0000) on 01/10/2026 00:00:00. Your transaction number is AAAAAAAAAA. Y(",
    );
    expect(parseTelebirrSms(injected)).toEqual({ kind: "failed", reason: "ambiguous" });
  });

  it("never returns the balance or the owner's account number", () => {
    const result = parseTelebirrSms(payment());
    expect(JSON.stringify(result)).not.toContain("12,345.67");
    expect(JSON.stringify(result)).not.toContain("1234567");
  });
});

describe("ignore patterns", () => {
  const paymentSms = [APPENDIX_SMS, payment()];
  for (const pattern of TELEBIRR_PATTERNS.filter((p) => p.kind === "ignore")) {
    it(`${pattern.id} does not match the payment SMS`, () => {
      for (const sms of paymentSms) {
        expect(pattern.regex.test(normalizeSmsBody(sms))).toBe(false);
      }
    });
  }
});

describe("parseEatDate", () => {
  it("converts EAT to UTC", () => {
    expect(parseEatDate("26/09/2026 09:57:24")).toBe(Date.UTC(2026, 8, 26, 6, 57, 24));
    expect(parseEatDate("01/01/2027 00:00:00")).toBe(Date.UTC(2026, 11, 31, 21, 0, 0));
    expect(parseEatDate("29/02/2028 12:00:00")).toBe(Date.UTC(2028, 1, 29, 9, 0, 0));
  });

  it.each([
    "31/02/2026 09:57:24",
    "29/02/2027 09:57:24",
    "32/01/2026 09:57:24",
    "00/01/2026 09:57:24",
    "15/13/2026 09:57:24",
    "15/00/2026 09:57:24",
    "26/09/2026 25:00:00",
    "26/09/2026 24:00:00",
    "26/09/2026 09:60:00",
    "26/09/2026 09:57:60",
    "26/09/2026",
    "2026-09-26 09:57:24",
    "26/9/2026 09:57:24",
    "",
  ])("throws on %j", (input) => {
    expect(() => parseEatDate(input)).toThrow();
  });
});

describe("redactSms (FR-10)", () => {
  it("removes a real balance from the appendix SMS", () => {
    const body = APPENDIX_SMS.replace("ETB [hidden]", "ETB 12,345.67");
    const redacted = redactSms(body);
    expect(redacted).not.toContain("12,345.67");
    expect(redacted).toContain("balance is ETB [redacted]");
    // What the parser needs is kept.
    expect(redacted).toContain("DIQ55JS1ED");
    expect(redacted).toContain("2519****2531");
  });

  it("removes the outgoing SMS balance despite the double spaces", () => {
    const redacted = redactSms(OUTGOING_SMS);
    expect(redacted).not.toContain("1,679.92");
    expect(redacted).toContain("Account balance is ETB [redacted]");
  });

  it("removes runs of 10 or more digits", () => {
    expect(redactSms("Account 1000123456789 and phone 0911223344 kept 123456789")).toBe(
      "Account [redacted] and phone [redacted] kept 123456789",
    );
  });

  it("normalizes whitespace", () => {
    expect(redactSms("  a\r\n\tb   c  ")).toBe("a b c");
  });

  it("still parses after redaction", () => {
    const body = APPENDIX_SMS.replace("ETB [hidden]", "ETB 12,345.67");
    expect(parseTelebirrSms(redactSms(body))).toEqual(APPENDIX_EXPECTED);
  });
});
