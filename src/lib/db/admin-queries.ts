// Read-only queries for the admin lists (FR-7, FR-25). These are the only queries that read payer
// names and phone numbers, and only the admin Worker calls them.
import type { OrderCreatedBy, ParseStatus, PaymentStatus } from "./types";

export const PAGE_SIZE = 50;

/**
 * Keyset cursor for lists ordered by (time DESC, id DESC). Rows can share a timestamp, so the id
 * breaks ties. Serialised as "<ms>.<id>" in the `before` query parameter.
 */
export type Cursor = { at: number; id: number };

export function encodeCursor(cursor: Cursor): string {
  return `${cursor.at}.${cursor.id}`;
}

/** Strict parse of "<ms>.<id>"; null for anything else. */
export function parseCursor(value: string | undefined): Cursor | null {
  const match = value ? /^(\d{1,16})\.(\d{1,16})$/.exec(value) : null;
  if (!match) return null;
  const at = Number(match[1]);
  const id = Number(match[2]);
  return Number.isSafeInteger(at) && Number.isSafeInteger(id) ? { at, id } : null;
}

export type Page<T> = { rows: T[]; next: string | null };

/** Splits off the extra row fetched to tell whether there is an older page. */
function page<T>(rows: T[], limit: number, cursorOf: (row: T) => string): Page<T> {
  const more = rows.length > limit;
  const kept = more ? rows.slice(0, limit) : rows;
  const last = kept[kept.length - 1];
  return { rows: kept, next: more && last ? cursorOf(last) : null };
}

export type PaymentFilter = "all" | PaymentStatus;
export const PAYMENT_FILTERS: PaymentFilter[] = ["all", "unclaimed", "claimed", "flagged"];
const ALL_STATUSES: PaymentStatus[] = ["unclaimed", "claimed", "flagged"];

export type AdminPayment = {
  id: number;
  txn: string;
  amountSantim: number;
  payerName: string;
  payerPhoneMasked: string;
  paidAt: number;
  status: PaymentStatus;
  flagReason: string | null;
};

type PaymentListRow = {
  id: number;
  transaction_number: string;
  amount_santim: number;
  payer_name: string;
  payer_phone_masked: string;
  paid_at: number;
  status: PaymentStatus;
  flag_reason: string | null;
};

const PAYMENT_COLUMNS =
  "id, transaction_number, amount_santim, payer_name, payer_phone_masked, paid_at, status, flag_reason";

/**
 * SQL and bindings for the payments list. Always constrains `status` so the (status, paid_at)
 * index serves it; "all" lists every status (the index then needs a sort step, see the PR notes).
 */
export function paymentsListQuery(opts: {
  status?: PaymentFilter;
  before?: Cursor | null;
  limit?: number;
}): { sql: string; params: (string | number)[] } {
  const statuses = !opts.status || opts.status === "all" ? ALL_STATUSES : [opts.status];
  const where = [`status IN (${statuses.map(() => "?").join(", ")})`];
  const params: (string | number)[] = [...statuses];
  if (opts.before) {
    // paid_at <= ? is the index range; the OR breaks ties on the same millisecond.
    where.push("paid_at <= ? AND (paid_at < ? OR id < ?)");
    params.push(opts.before.at, opts.before.at, opts.before.id);
  }
  params.push((opts.limit ?? PAGE_SIZE) + 1);
  return {
    sql: `SELECT ${PAYMENT_COLUMNS} FROM payments INDEXED BY idx_payments_status_paid
      WHERE ${where.join(" AND ")} ORDER BY paid_at DESC, id DESC LIMIT ?`,
    params,
  };
}

function toPayment(r: PaymentListRow): AdminPayment {
  return {
    id: r.id,
    txn: r.transaction_number,
    amountSantim: r.amount_santim,
    payerName: r.payer_name,
    payerPhoneMasked: r.payer_phone_masked,
    paidAt: r.paid_at,
    status: r.status,
    flagReason: r.flag_reason,
  };
}

export async function listPayments(
  db: D1Database,
  opts: { status?: PaymentFilter; before?: Cursor | null; limit?: number } = {},
): Promise<Page<AdminPayment>> {
  const limit = opts.limit ?? PAGE_SIZE;
  const { sql, params } = paymentsListQuery({ ...opts, limit });
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<PaymentListRow>();
  return page(results.map(toPayment), limit, (p) => encodeCursor({ at: p.paidAt, id: p.id }));
}

export type LinkStatus = "active" | "expired" | "used_up" | "revoked";

export type TokenSummary = {
  downloadCount: number;
  maxDownloads: number;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
};

/** What the download route would do with this token. A spent link reads "used up" even once expired. */
export function linkStatus(token: TokenSummary, now: number): LinkStatus {
  if (token.revokedAt !== null) return "revoked";
  if (token.downloadCount >= token.maxDownloads) return "used_up";
  if (token.expiresAt <= now) return "expired";
  return "active";
}

export type AdminOrder = {
  id: number;
  createdBy: OrderCreatedBy;
  adminNote: string | null;
  createdAt: number;
  /** null for an admin approval without a payment (FR-26). */
  paymentId: number | null;
  txn: string | null;
  versionId: number;
  language: string;
  modelName: string;
  modelYear: string;
  /** The newest token of the order; null if it has none. */
  token: TokenSummary | null;
};

type OrderRow = {
  id: number;
  created_by: OrderCreatedBy;
  admin_note: string | null;
  created_at: number;
  payment_id: number | null;
  transaction_number: string | null;
  manual_version_id: number;
  language: string;
  model_name: string;
  model_year: string;
  download_count: number | null;
  max_downloads: number | null;
  expires_at: number | null;
  revoked_at: number | null;
  token_created_at: number | null;
};

// The newest token is found through idx_download_tokens_order.
const ORDER_SELECT = `SELECT o.id, o.created_by, o.admin_note, o.created_at, o.payment_id,
    p.transaction_number, o.manual_version_id, v.language, m.name AS model_name,
    m.model_year, t.download_count, t.max_downloads, t.expires_at, t.revoked_at,
    t.created_at AS token_created_at
  FROM orders o
  JOIN manual_versions v ON v.id = o.manual_version_id
  JOIN car_models m ON m.id = v.car_model_id
  LEFT JOIN payments p ON p.id = o.payment_id
  LEFT JOIN download_tokens t
    ON t.id = (SELECT max(id) FROM download_tokens WHERE order_id = o.id)`;

function toOrder(r: OrderRow): AdminOrder {
  return {
    id: r.id,
    createdBy: r.created_by,
    adminNote: r.admin_note,
    createdAt: r.created_at,
    paymentId: r.payment_id,
    txn: r.transaction_number,
    versionId: r.manual_version_id,
    language: r.language,
    modelName: r.model_name,
    modelYear: r.model_year,
    token:
      r.download_count === null ||
      r.max_downloads === null ||
      r.expires_at === null ||
      r.token_created_at === null
        ? null
        : {
            downloadCount: r.download_count,
            maxDownloads: r.max_downloads,
            expiresAt: r.expires_at,
            revokedAt: r.revoked_at,
            createdAt: r.token_created_at,
          },
  };
}

/**
 * Orders newest first. Ids grow with created_at, so the keyset runs on the primary key and needs
 * no extra index. `before` is an order id.
 */
export async function listOrders(
  db: D1Database,
  opts: { before?: number | null; limit?: number } = {},
): Promise<Page<AdminOrder>> {
  const limit = opts.limit ?? PAGE_SIZE;
  const stmt = opts.before
    ? db
        .prepare(`${ORDER_SELECT} WHERE o.id < ? ORDER BY o.id DESC LIMIT ?`)
        .bind(opts.before, limit + 1)
    : db.prepare(`${ORDER_SELECT} ORDER BY o.id DESC LIMIT ?`).bind(limit + 1);
  const { results } = await stmt.all<OrderRow>();
  return page(results.map(toOrder), limit, (o) => String(o.id));
}

export type AdminSms = {
  id: number;
  sender: string;
  /** Stored redacted: no balance, no long digit runs. */
  body: string;
  receivedAt: number;
  parseStatus: ParseStatus;
  patternId: string | null;
};

type SmsRow = {
  id: number;
  sender: string;
  body: string;
  received_at: number;
  parse_status: ParseStatus;
  pattern_id: string | null;
};

function toSms(r: SmsRow): AdminSms {
  return {
    id: r.id,
    sender: r.sender,
    body: r.body,
    receivedAt: r.received_at,
    parseStatus: r.parse_status,
    patternId: r.pattern_id,
  };
}

export async function listSms(
  db: D1Database,
  opts: { parseStatus: "failed" | "ignored"; before?: Cursor | null; limit?: number },
): Promise<Page<AdminSms>> {
  const limit = opts.limit ?? PAGE_SIZE;
  const before = opts.before;
  const stmt = before
    ? db
        .prepare(
          `SELECT id, sender, body, received_at, parse_status, pattern_id
           FROM raw_sms INDEXED BY idx_raw_sms_status_received
           WHERE parse_status = ? AND received_at <= ? AND (received_at < ? OR id < ?)
           ORDER BY received_at DESC, id DESC LIMIT ?`,
        )
        .bind(opts.parseStatus, before.at, before.at, before.id, limit + 1)
    : db
        .prepare(
          `SELECT id, sender, body, received_at, parse_status, pattern_id
           FROM raw_sms INDEXED BY idx_raw_sms_status_received
           WHERE parse_status = ? ORDER BY received_at DESC, id DESC LIMIT ?`,
        )
        .bind(opts.parseStatus, limit + 1);
  const { results } = await stmt.all<SmsRow>();
  return page(results.map(toSms), limit, (s) => encodeCursor({ at: s.receivedAt, id: s.id }));
}

export type AdminPaymentDetail = AdminPayment & {
  claimedAt: number | null;
  claimRef: string | null;
  createdAt: number;
  sms: AdminSms | null;
  order: AdminOrder | null;
};

type PaymentDetailRow = PaymentListRow & {
  claimed_at: number | null;
  claim_ref: string | null;
  created_at: number;
  raw_sms_id: number | null;
};

/** One payment with its redacted SMS and its order (if any). null if there is no such payment. */
export async function getPayment(db: D1Database, id: number): Promise<AdminPaymentDetail | null> {
  const [paymentRes, smsRes, orderRes] = await db.batch<PaymentDetailRow & SmsRow & OrderRow>([
    db
      .prepare(
        `SELECT ${PAYMENT_COLUMNS}, claimed_at, claim_ref, created_at, raw_sms_id
         FROM payments WHERE id = ?`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT s.id, s.sender, s.body, s.received_at, s.parse_status, s.pattern_id
         FROM payments p JOIN raw_sms s ON s.id = p.raw_sms_id WHERE p.id = ?`,
      )
      .bind(id),
    db.prepare(`${ORDER_SELECT} WHERE o.payment_id = ?`).bind(id),
  ]);
  const p = paymentRes?.results[0] as PaymentDetailRow | undefined;
  if (!p) return null;
  const sms = smsRes?.results[0] as SmsRow | undefined;
  const order = orderRes?.results[0] as OrderRow | undefined;
  return {
    ...toPayment(p),
    claimedAt: p.claimed_at,
    claimRef: p.claim_ref,
    createdAt: p.created_at,
    sms: sms ? toSms(sms) : null,
    order: order ? toOrder(order) : null,
  };
}
