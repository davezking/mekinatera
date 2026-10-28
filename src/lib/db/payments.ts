import type { ParseStatus, PaymentRow } from "./types";

export type NewRawSms = {
  sender: string;
  /** Must already be redacted (redactSms). */
  body: string;
  receivedAt: number;
  parseStatus: ParseStatus;
  patternId: string | null;
  createdAt: number;
};

export type NewPayment = {
  transactionNumber: string;
  amountSantim: number;
  payerName: string;
  payerPhoneMasked: string;
  paidAt: number;
  rawSmsId: number | null;
  createdAt: number;
};

/** Inserts a raw_sms row and returns its id. */
export async function insertRawSms(db: D1Database, row: NewRawSms): Promise<number> {
  const id = await db
    .prepare(
      `INSERT INTO raw_sms (sender, body, received_at, parse_status, pattern_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(row.sender, row.body, row.receivedAt, row.parseStatus, row.patternId, row.createdAt)
    .first<number>("id");
  if (id === null) throw new Error("raw_sms insert returned no id");
  return id;
}

/** Inserts an unclaimed payment. Returns false if the transaction number already exists (FR-9). */
export async function insertPaymentIfNew(db: D1Database, row: NewPayment): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO payments
         (transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, raw_sms_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'unclaimed', ?)
       ON CONFLICT (transaction_number) DO NOTHING`,
    )
    .bind(
      row.transactionNumber,
      row.amountSantim,
      row.payerName,
      row.payerPhoneMasked,
      row.paidAt,
      row.rawSmsId,
      row.createdAt,
    )
    .run();
  return result.meta.changes > 0;
}

/** Looks up a payment by transaction number (UNIQUE index). */
export async function getPaymentByTxn(db: D1Database, txn: string): Promise<PaymentRow | null> {
  return db
    .prepare("SELECT * FROM payments WHERE transaction_number = ?")
    .bind(txn)
    .first<PaymentRow>();
}
