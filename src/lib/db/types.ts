// Row types for migrations/0001_init.sql. Columns are snake_case as stored.
// Money columns are integer santim; *_at columns are integer Unix ms UTC.

export type ParseStatus = "parsed" | "ignored" | "failed";
export type PaymentStatus = "unclaimed" | "claimed" | "flagged";
export type OrderCreatedBy = "auto" | "admin";
export type ManualLanguage = "en" | "am";
/** SQLite boolean: 0 or 1. */
export type DbBool = 0 | 1;

export type CarModelRow = {
  id: number;
  name: string;
  slug: string;
  model_year: string;
  image_key: string | null;
  is_visible: DbBool;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export type ManualVersionRow = {
  id: number;
  car_model_id: number;
  language: ManualLanguage;
  price_santim: number;
  r2_key: string | null;
  file_size: number | null;
  is_visible: DbBool;
  created_at: number;
  updated_at: number;
};

export type RawSmsRow = {
  id: number;
  sender: string;
  /** Always redacted before insert. */
  body: string;
  received_at: number;
  parse_status: ParseStatus;
  pattern_id: string | null;
  created_at: number;
};

export type PaymentRow = {
  id: number;
  transaction_number: string;
  amount_santim: number;
  payer_name: string;
  payer_phone_masked: string;
  paid_at: number;
  raw_sms_id: number | null;
  status: PaymentStatus;
  claimed_at: number | null;
  claim_ref: string | null;
  flag_reason: string | null;
  created_at: number;
};

export type OrderRow = {
  id: number;
  /** NULL for admin approvals without an SMS (FR-26). */
  payment_id: number | null;
  manual_version_id: number;
  created_by: OrderCreatedBy;
  admin_note: string | null;
  created_at: number;
};

export type DownloadTokenRow = {
  id: number;
  order_id: number;
  /** SHA-256 of the URL token. */
  token_hash: string;
  expires_at: number;
  max_downloads: number;
  download_count: number;
  revoked_at: number | null;
  created_at: number;
};

export type ClaimAttemptRow = {
  id: number;
  transaction_number_input: string;
  manual_version_id: number | null;
  ip: string;
  result_code: string;
  created_at: number;
};
