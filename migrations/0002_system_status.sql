-- Small key/value store for system health (FR-27). Keys: last_heartbeat_at, battery.
-- value is TEXT; updated_at is integer Unix ms UTC, the time the key was last written.
CREATE TABLE system_status (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
