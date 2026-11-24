CREATE TABLE IF NOT EXISTS document_metadata (
  owner_id TEXT NOT NULL, document_id TEXT NOT NULL, metadata TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL,
  PRIMARY KEY(owner_id,document_id),
  FOREIGN KEY(owner_id,document_id) REFERENCES documents(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS document_versions (
  owner_id TEXT NOT NULL, document_id TEXT NOT NULL, version_id TEXT NOT NULL,
  snapshot TEXT NOT NULL, recorded_at BIGINT NOT NULL,
  PRIMARY KEY(owner_id,document_id,version_id),
  FOREIGN KEY(owner_id,document_id) REFERENCES documents(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS knowledge_events (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, payload TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_event_owner ON knowledge_events(owner_id,entity_id,created_at);
CREATE TABLE IF NOT EXISTS evidence_conflicts (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
  payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'UNRESOLVED', revision INTEGER NOT NULL DEFAULT 1,
  resolution TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY(owner_id,id)
);
CREATE INDEX IF NOT EXISTS evidence_conflict_recent ON evidence_conflicts(owner_id,updated_at);
CREATE TABLE IF NOT EXISTS answer_versions (
  owner_id TEXT NOT NULL, message_id TEXT NOT NULL, sequence INTEGER NOT NULL,
  result TEXT NOT NULL, source_revision BIGINT NOT NULL, reason TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY(owner_id,message_id,sequence),
  FOREIGN KEY(owner_id,message_id) REFERENCES messages(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS revalidation_jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, message_id TEXT NOT NULL, target_revision BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL,
  lease_token TEXT, lease_until BIGINT NOT NULL DEFAULT 0, last_error TEXT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  UNIQUE(owner_id,message_id,target_revision),
  FOREIGN KEY(owner_id,message_id) REFERENCES messages(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS revalidation_due ON revalidation_jobs(status,next_at,lease_until);
CREATE TABLE IF NOT EXISTS library_changes (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, revision BIGINT NOT NULL,
  document_id TEXT NOT NULL, reason TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued', created_at BIGINT NOT NULL,
  PRIMARY KEY(owner_id,revision)
);
