CREATE TABLE recovery_codes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(user_id, code_hash)
);
CREATE TABLE security_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX security_events_user ON security_events(user_id, created_at);
