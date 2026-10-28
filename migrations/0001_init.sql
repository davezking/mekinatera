-- Core schema. Money is integer santim; every *_at is integer Unix ms UTC.
-- Never edit this file once merged: add migrations/NNNN_*.sql instead.

CREATE TABLE car_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  model_year TEXT NOT NULL,
  image_key TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE manual_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_model_id INTEGER NOT NULL REFERENCES car_models (id),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'am')),
  price_santim INTEGER NOT NULL CHECK (price_santim > 0),
  r2_key TEXT,
  file_size INTEGER,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (car_model_id, language)
);

-- body is always stored redacted (no balance, no long digit runs).
CREATE TABLE raw_sms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed', 'ignored', 'failed')),
  pattern_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_raw_sms_status_received ON raw_sms (parse_status, received_at);

-- transaction_number UNIQUE: one payment can never be recorded (or claimed) twice.
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_number TEXT NOT NULL UNIQUE CHECK (length(transaction_number) = 10),
  amount_santim INTEGER NOT NULL CHECK (amount_santim > 0),
  payer_name TEXT NOT NULL,
  payer_phone_masked TEXT NOT NULL,
  paid_at INTEGER NOT NULL,
  raw_sms_id INTEGER REFERENCES raw_sms (id),
  status TEXT NOT NULL DEFAULT 'unclaimed' CHECK (status IN ('unclaimed', 'claimed', 'flagged')),
  claimed_at INTEGER,
  claim_ref TEXT UNIQUE,
  flag_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_payments_status_paid ON payments (status, paid_at);

-- payment_id is UNIQUE so a payment can back at most one order; NULL for admin
-- approvals without an SMS (FR-26). SQLite allows many NULLs in a UNIQUE column.
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER UNIQUE REFERENCES payments (id),
  manual_version_id INTEGER NOT NULL REFERENCES manual_versions (id),
  created_by TEXT NOT NULL CHECK (created_by IN ('auto', 'admin')),
  admin_note TEXT,
  created_at INTEGER NOT NULL
);

-- token_hash is the SHA-256 of the URL token; the token itself is never stored.
CREATE TABLE download_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders (id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  max_downloads INTEGER NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_download_tokens_order ON download_tokens (order_id);

-- Log of every claim request, including invalid input, so manual_version_id is
-- deliberately not a foreign key (it may name a version that does not exist).
CREATE TABLE claim_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_number_input TEXT NOT NULL,
  manual_version_id INTEGER,
  ip TEXT NOT NULL,
  result_code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_claim_attempts_ip_created ON claim_attempts (ip, created_at);
