CREATE TABLE ingestion_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  source TEXT NOT NULL,
  text TEXT,
  original_file BYTEA,
  original_mime TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','processing','retry_wait','failed','completed')),
  total_chunks INTEGER NOT NULL,
  completed_chunks INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_at BIGINT NOT NULL,
  lease_token TEXT,
  lease_until BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(owner_id,document_id)
);
CREATE INDEX ingestion_due ON ingestion_jobs(status,next_at,lease_until);
CREATE INDEX ingestion_owner ON ingestion_jobs(owner_id,created_at);
CREATE TABLE ingestion_vectors (
  job_id TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  embedding TEXT NOT NULL,
  PRIMARY KEY(job_id,chunk_index)
);
