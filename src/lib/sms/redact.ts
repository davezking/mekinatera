import { normalizeSmsBody } from "./parser";

/**
 * The only form of an SMS body we store (FR-10): whitespace normalized first (real SMS
 * contain double spaces such as "Account  balance"), then the balance amount and any
 * run of 10+ digits (full phone or account numbers) replaced with "[redacted]".
 */
export function redactSms(body: string): string {
  return normalizeSmsBody(body)
    .replace(/(balance is ETB )[\d,]+\.\d{2}/gi, "$1[redacted]")
    .replace(/\b\d{10,}\b/g, "[redacted]");
}
