import type { OrderCreatedBy, PaymentRow } from "./db/types";
import { createTicket } from "./ticket";
import { DAY, HOUR, MINUTE } from "./time";
import { generateToken, hashToken } from "./token";

export type ClaimErrorCode =
  | "INVALID_FORMAT"
  | "INVALID_VERSION"
  | "ALREADY_USED"
  | "AMOUNT_TOO_LOW"
  | "EXPIRED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "BOT_CHECK_FAILED";

export type ClaimResult =
  | { status: "ok"; downloadUrl: string }
  | { status: "pending"; ticket: string; retryAfterMs: number }
  | { status: "error"; code: ClaimErrorCode; message: string };

export type ClaimEnv = Pick<
  Env,
  | "DB"
  | "TICKET_SECRET"
  | "CLAIM_WINDOW_DAYS"
  | "TOKEN_TTL_HOURS"
  | "TOKEN_MAX_DOWNLOADS"
  | "POLL_TIMEOUT_MINUTES"
>;

export type ClaimInput = {
  txnInput: string;
  versionId: number;
  ip: string;
  now: number;
  /** Site origin for the download URL, e.g. "https://byd-manuals.example.workers.dev". */
  origin: string;
  /** Set when polling (GET /api/claim/status): pending returns this ticket and is not recorded. */
  ticket?: string;
};

export const RETRY_AFTER_MS = 5000;
const TXN_FORMAT = /^[A-Z0-9]{10}$/;
/** Stored inputs are capped so a junk POST can't grow claim_attempts. */
const MAX_STORED_INPUT = 64;

/** Trim, uppercase, remove all whitespace (FR-12). No other fuzzy matching. */
export function normalizeTxn(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

function positiveInt(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function error(code: ClaimErrorCode, message: string): ClaimResult {
  return { status: "error", code, message };
}

async function recordAttempt(
  db: D1Database,
  input: ClaimInput,
  resultCode: ClaimErrorCode | "OK" | "PENDING",
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO claim_attempts (transaction_number_input, manual_version_id, ip, result_code, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      input.txnInput.slice(0, MAX_STORED_INPUT),
      input.versionId,
      input.ip,
      resultCode,
      input.now,
    )
    .run();
}

/** Claim algorithm steps 1–8 (architecture.md §5). Never writes claim_attempts. */
async function check(env: ClaimEnv, input: ClaimInput): Promise<ClaimResult> {
  const db = env.DB;
  const windowDays = positiveInt("CLAIM_WINDOW_DAYS", env.CLAIM_WINDOW_DAYS);

  // 1. Normalize and validate.
  const txn = normalizeTxn(input.txnInput);
  if (!TXN_FORMAT.test(txn)) {
    return error(
      "INVALID_FORMAT",
      "A transaction number has 10 letters and numbers. Copy it from the telebirr app.",
    );
  }

  // 2. A visible version with an uploaded PDF, on a visible model.
  const price = await db
    .prepare(
      `SELECT v.price_santim FROM manual_versions v JOIN car_models m ON m.id = v.car_model_id
       WHERE v.id = ? AND v.is_visible = 1 AND v.r2_key IS NOT NULL AND m.is_visible = 1`,
    )
    .bind(input.versionId)
    .first<number>("price_santim");
  if (price === null) return error("INVALID_VERSION", "This manual isn't available right now.");

  // 3. The payment, by its UNIQUE transaction number.
  const payment = await db
    .prepare("SELECT id, amount_santim, paid_at, status FROM payments WHERE transaction_number = ?")
    .bind(txn)
    .first<Pick<PaymentRow, "id" | "amount_santim" | "paid_at" | "status">>();
  if (!payment) {
    return {
      status: "pending",
      ticket:
        input.ticket ??
        (await createTicket(env.TICKET_SECRET, {
          txn,
          versionId: input.versionId,
          expiresAt:
            input.now + positiveInt("POLL_TIMEOUT_MINUTES", env.POLL_TIMEOUT_MINUTES) * MINUTE,
        })),
      retryAfterMs: RETRY_AFTER_MS,
    };
  }

  // 4. Already claimed or flagged.
  const alreadyUsed = () => error("ALREADY_USED", "This transaction number has already been used.");
  const tooLow = () =>
    error("AMOUNT_TOO_LOW", "The amount received is less than the price. Contact support.");
  if (payment.status === "claimed") return alreadyUsed();
  if (payment.status === "flagged") return tooLow();

  // 5. Underpaid: flag it so it can't be claimed later at a lower price (FR-16).
  if (payment.amount_santim < price) {
    await db
      .prepare(
        "UPDATE payments SET status = 'flagged', flag_reason = 'amount_too_low' WHERE id = ? AND status = 'unclaimed'",
      )
      .bind(payment.id)
      .run();
    return tooLow();
  }

  // 6. Outside the claim window.
  const paidAfter = input.now - windowDays * DAY;
  if (payment.paid_at < paidAfter) {
    return error("EXPIRED", `This payment is older than ${windowDays} days. Contact support.`);
  }

  // 7. Claim, order and token in one transaction. claimRef is unique to this request, so a
  // racing request that loses the UPDATE inserts nothing: its claimRef matches no row.
  const claimRef = generateToken();
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const expiresAt = input.now + positiveInt("TOKEN_TTL_HOURS", env.TOKEN_TTL_HOURS) * HOUR;
  const maxDownloads = positiveInt("TOKEN_MAX_DOWNLOADS", env.TOKEN_MAX_DOWNLOADS);
  const [claimed] = await db.batch([
    db
      .prepare(
        `UPDATE payments SET status = 'claimed', claimed_at = ?, claim_ref = ?
         WHERE transaction_number = ? AND status = 'unclaimed' AND amount_santim >= ? AND paid_at >= ?`,
      )
      .bind(input.now, claimRef, txn, price, paidAfter),
    db
      .prepare(
        `INSERT INTO orders (payment_id, manual_version_id, created_by, created_at)
         SELECT id, ?, 'auto', ? FROM payments WHERE claim_ref = ?`,
      )
      .bind(input.versionId, input.now, claimRef),
    db
      .prepare(
        `INSERT INTO download_tokens (order_id, token_hash, expires_at, max_downloads, download_count, created_at)
         SELECT o.id, ?, ?, ?, 0, ? FROM orders o JOIN payments p ON p.id = o.payment_id
         WHERE p.claim_ref = ?`,
      )
      .bind(tokenHash, expiresAt, maxDownloads, input.now, claimRef),
  ]);

  // 8. Lost the race, or the payment changed between steps 3 and 7.
  if (claimed?.meta.changes !== 1) {
    const now = await db
      .prepare("SELECT status FROM payments WHERE transaction_number = ?")
      .bind(txn)
      .first<PaymentRow["status"]>("status");
    return now === "flagged" ? tooLow() : alreadyUsed();
  }
  return { status: "ok", downloadUrl: `${input.origin}/d/${token}` };
}

/**
 * Claims a payment for a manual version (architecture.md §5). Records one claim_attempts row
 * per call (step 9), except for a pending poll.
 */
export async function claim(env: ClaimEnv, input: ClaimInput): Promise<ClaimResult> {
  const result = await check(env, input);
  if (result.status === "pending" && input.ticket !== undefined) return result;
  await recordAttempt(
    env.DB,
    input,
    result.status === "ok" ? "OK" : result.status === "pending" ? "PENDING" : result.code,
  );
  return result;
}

/** Records a final attempt that never reached the claim checks (e.g. an expired poll ticket). */
export async function recordClaimAttempt(
  db: D1Database,
  input: Pick<ClaimInput, "txnInput" | "versionId" | "ip" | "now">,
  resultCode: ClaimErrorCode,
): Promise<void> {
  await recordAttempt(db, { ...input, origin: "" }, resultCode);
}

/**
 * Creates an order and a download token in one batch, without the auto-claim guard. For
 * admin approvals (P2-S2-T3). The caller must already have checked the payment, if any.
 * Returns the raw token; only its hash is stored.
 */
export async function createOrderWithToken(
  env: Pick<Env, "DB" | "TOKEN_TTL_HOURS" | "TOKEN_MAX_DOWNLOADS">,
  args: {
    paymentId: number | null;
    versionId: number;
    createdBy: OrderCreatedBy;
    adminNote: string | null;
    now: number;
  },
): Promise<string> {
  const db = env.DB;
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const expiresAt = args.now + positiveInt("TOKEN_TTL_HOURS", env.TOKEN_TTL_HOURS) * HOUR;
  const maxDownloads = positiveInt("TOKEN_MAX_DOWNLOADS", env.TOKEN_MAX_DOWNLOADS);
  const [order] = await db.batch<{ id: number }>([
    db
      .prepare(
        `INSERT INTO orders (payment_id, manual_version_id, created_by, admin_note, created_at)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(args.paymentId, args.versionId, args.createdBy, args.adminNote, args.now),
    db
      .prepare(
        `INSERT INTO download_tokens (order_id, token_hash, expires_at, max_downloads, download_count, created_at)
         VALUES (last_insert_rowid(), ?, ?, ?, 0, ?)`,
      )
      .bind(tokenHash, expiresAt, maxDownloads, args.now),
  ]);
  if (!order?.results[0]) throw new Error("order insert returned no id");
  return token;
}
