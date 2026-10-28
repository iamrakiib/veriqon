CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')),
  document_revision BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX single_owner ON users(role) WHERE role='owner';
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL UNIQUE, expires_at BIGINT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE documents (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
  text TEXT NOT NULL, source TEXT, version TEXT, page INTEGER, embedding_model TEXT,
  original_file BYTEA, original_name TEXT, original_mime TEXT, created_at BIGINT NOT NULL,
  PRIMARY KEY(owner_id,id)
);
CREATE TABLE chunks (
  owner_id TEXT NOT NULL, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL, embedding vector NOT NULL, source TEXT, page INTEGER, version TEXT,
  PRIMARY KEY(owner_id,document_id,chunk_index),
  FOREIGN KEY(owner_id,document_id) REFERENCES documents(owner_id,id) ON DELETE CASCADE
);
-- Exact cosine search supports different embedding dimensions during model migrations.
-- An ANN expression index requires a fixed dimension/model and recall evaluation first.
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at BIGINT NOT NULL);
CREATE INDEX auth_limits_expiry ON auth_limits(reset_at);
CREATE TABLE conversations (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
  title TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY(owner_id,id)
);
CREATE INDEX conversations_recent ON conversations(owner_id,updated_at DESC);
CREATE TABLE messages (
  owner_id TEXT NOT NULL, conversation_id TEXT NOT NULL, id TEXT NOT NULL,
  question TEXT NOT NULL, result TEXT, error TEXT, created_at BIGINT NOT NULL,
  PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,conversation_id) REFERENCES conversations(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX messages_conversation ON messages(owner_id,conversation_id,created_at,id);
