import { Injectable, OnModuleInit, ConflictException, NotFoundException, HttpException, BadRequestException } from '@nestjs/common';
import { SqlStore } from './sql-store';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { randomBytes, randomUUID } from 'crypto';

export type StoredChunk = { chunkId: string; content: string; embedding: number[]; source?: string; page?: number; version?: string; index: number };
export type StoredDocument = { id: string; text: string; embeddingModel?: string; chunks: StoredChunk[] };
export type OriginalFile = { bytes: Buffer; name: string; mime: string };

@Injectable()
export class DatabaseService extends SqlStore implements OnModuleInit {
  readonly setupFile: string;
  readonly legacyFile: string;
  constructor() {
    super(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')),
        document_revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS recovery_codes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,code_hash));
      CREATE TABLE IF NOT EXISTS security_events (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS security_events_user ON security_events(user_id,created_at);
      CREATE TABLE IF NOT EXISTS documents (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
        text TEXT NOT NULL, source TEXT, version TEXT, page INTEGER, embedding_model TEXT,
        original_file BLOB, original_name TEXT, original_mime TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY(owner_id,id));
      CREATE TABLE IF NOT EXISTS chunks (
        owner_id TEXT NOT NULL, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL, embedding TEXT NOT NULL, source TEXT, page INTEGER, version TEXT,
        PRIMARY KEY(owner_id,document_id,chunk_index),
        FOREIGN KEY(owner_id,document_id) REFERENCES documents(owner_id,id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
        title TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(owner_id,id));
      CREATE TABLE IF NOT EXISTS messages (
        owner_id TEXT NOT NULL, conversation_id TEXT NOT NULL, id TEXT NOT NULL,
        question TEXT NOT NULL, result TEXT, error TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,conversation_id) REFERENCES conversations(owner_id,id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(owner_id,conversation_id,created_at);
      PRAGMA user_version=2;`);
    this.setupFile = process.env.SETUP_CODE_PATH || join(dirname(this.filename), 'setup-code.txt');
    this.legacyFile = process.env.DOCUMENT_STORE_PATH || join(process.cwd(), 'data', 'documents.json');
    if (this.dialect === 'sqlite' && !this.db.prepare('SELECT id FROM users LIMIT 1').get() && this.filename !== ':memory:' && !existsSync(this.setupFile)) {
      mkdirSync(dirname(this.setupFile), { recursive: true });
      writeFileSync(this.setupFile, randomBytes(24).toString('base64url'), { mode: 0o600, flag: 'wx' });
    }
  }
  async onModuleInit() { await this.initialize(); }
  async hasUsers() { return Boolean(await this.get('SELECT id FROM users LIMIT 1')); }
  async readDocuments(ownerId: string): Promise<StoredDocument[]> {
    const docs = await this.all('SELECT id,text,embedding_model FROM documents WHERE owner_id=? ORDER BY created_at,id', ownerId);
    const chunks = await this.all('SELECT * FROM chunks WHERE owner_id=? ORDER BY document_id,chunk_index', ownerId);
    return docs.map(doc => ({ id: String(doc.id), text: String(doc.text), embeddingModel: doc.embedding_model ? String(doc.embedding_model) : undefined,
      chunks: chunks.filter(c => c.document_id === doc.id).map(c => ({ chunkId: `${doc.id}#${c.chunk_index}`, index: Number(c.chunk_index), content: String(c.content), embedding: JSON.parse(String(c.embedding)), source: c.source ? String(c.source) : undefined, page: c.page ? Number(c.page) : undefined, version: c.version ? String(c.version) : undefined })) }));
  }
  async writeDocument(ownerId: string, record: StoredDocument, file?: OriginalFile) {
    await this.transaction(async () => {
      await this.checkLibraryLimit(ownerId, record.id, record.text, file);
      await this.insertDocument(ownerId, record, file);
    });
  }
  async preflightDocument(ownerId: string, id: string, text: string, file?: OriginalFile) {
    // Release the lock before provider work; writeDocument rechecks atomically at commit.
    await this.transaction(() => this.checkLibraryLimit(ownerId, id, text, file));
  }
  private async checkLibraryLimit(ownerId: string, id: string, text: string, file?: OriginalFile) {
    if (this.dialect === 'postgresql') await this.get('SELECT id FROM users WHERE id=? FOR UPDATE', ownerId);
    const textSize = this.dialect === 'postgresql' ? 'octet_length(text)' : 'length(CAST(text AS BLOB))';
    const fileSize = this.dialect === 'postgresql' ? 'octet_length(original_file)' : 'length(original_file)';
    const usage = await this.get(`SELECT COUNT(*) AS count, COALESCE(SUM(COALESCE(${fileSize},0)+${textSize}),0) AS bytes FROM documents WHERE owner_id=? AND id<>?`, ownerId, id);
    if (Number(usage!.count) >= 100 || Number(usage!.bytes) + (file?.bytes.length || 0) + Buffer.byteLength(text) > 100 * 1024 * 1024) {
      throw new HttpException('Your library limit is 100 documents or 100 MB of source files and text. Remove documents before uploading more.', 413);
    }
  }
  async attachOriginal(ownerId: string, id: string, text: string, file: OriginalFile) {
    await this.transaction(async () => {
      await this.checkLibraryLimit(ownerId, id, text, file);
      const updated = await this.run('UPDATE documents SET original_file=?,original_name=?,original_mime=? WHERE owner_id=? AND id=? AND text=?', file.bytes, file.name, file.mime, ownerId, id, text);
      if (!updated.changes) throw new ConflictException('The document changed during upload. Refresh the library and retry.');
    });
  }
  /** PostgreSQL ranks vectors on the database; only candidate windows cross the network. */
  async candidateDocuments(ownerId: string, vector: number[], model: string, topK: number, query = ''): Promise<StoredDocument[]> {
    if (this.dialect !== 'postgresql') return this.readDocuments(ownerId);
    const incompatible = await this.get(`SELECT 1 FROM chunks c JOIN documents d ON d.owner_id=c.owner_id AND d.id=c.document_id
      WHERE c.owner_id=? AND (vector_dims(c.embedding)<>? OR (d.embedding_model IS NOT NULL AND d.embedding_model<>?)) LIMIT 1`, ownerId, vector.length, model);
    if (incompatible) throw new BadRequestException('The embedding model changed. Re-upload the documents with the current EMBEDDING_MODEL before querying them.');
    const lexical = [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) || [])].slice(0, 24).join(' | ');
    const depth = Math.max(12, Math.min(80, Number(process.env.RETRIEVAL_CANDIDATES || topK * 10)));
    const rows = await this.all(`WITH dense AS MATERIALIZED (
      SELECT document_id,chunk_index FROM chunks WHERE owner_id=? ORDER BY embedding <=> ?::vector LIMIT ?
    ), lexical AS MATERIALIZED (
      SELECT document_id,chunk_index FROM chunks WHERE owner_id=? AND to_tsvector('simple',content) @@ to_tsquery('simple',?)
      ORDER BY ts_rank_cd(to_tsvector('simple',content),to_tsquery('simple',?)) DESC LIMIT ?
    ), seeds AS MATERIALIZED (
      SELECT * FROM dense UNION SELECT * FROM lexical
    ) SELECT DISTINCT c.*,d.embedding_model FROM seeds s JOIN chunks c
      ON c.document_id=s.document_id AND c.chunk_index BETWEEN s.chunk_index-2 AND s.chunk_index+2
      JOIN documents d ON d.owner_id=c.owner_id AND d.id=c.document_id
      WHERE c.owner_id=? ORDER BY c.document_id,c.chunk_index`, ownerId, JSON.stringify(vector), depth, ownerId, lexical, lexical, depth, ownerId);
    const records = new Map<string, StoredDocument>();
    for (const row of rows) {
      if (!records.has(row.document_id)) records.set(row.document_id, { id: row.document_id, text: '', embeddingModel: row.embedding_model || undefined, chunks: [] });
      records.get(row.document_id)!.chunks.push({ chunkId: `${row.document_id}#${row.chunk_index}`, index: row.chunk_index,
        content: row.content, embedding: JSON.parse(String(row.embedding)), source: row.source || undefined, page: row.page || undefined, version: row.version || undefined });
    }
    return [...records.values()];
  }
  private async insertDocument(ownerId: string, record: StoredDocument, file?: OriginalFile) {
    const meta = record.chunks[0];
    await this.run(`INSERT INTO documents(owner_id,id,text,source,version,page,embedding_model,original_file,original_name,original_mime,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET text=excluded.text,source=excluded.source,version=excluded.version,page=excluded.page,embedding_model=excluded.embedding_model,
      original_file=excluded.original_file,original_name=excluded.original_name,original_mime=excluded.original_mime`, ownerId, record.id, record.text, meta?.source ?? null, meta?.version ?? null, meta?.page ?? null, record.embeddingModel ?? null, file?.bytes ?? null, file?.name ?? null, file?.mime ?? null, Date.now());
    await this.run('DELETE FROM chunks WHERE owner_id=? AND document_id=?', ownerId, record.id);
    
    for (const chunk of record.chunks) await this.run('INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)', ownerId, record.id, chunk.index, chunk.content, JSON.stringify(chunk.embedding), chunk.source ?? null, chunk.page ?? null, chunk.version ?? null);
    await this.run('UPDATE users SET document_revision=document_revision+1 WHERE id=?', ownerId);
  }
  // Called inside first-owner registration's transaction. The source snapshot stays untouched.
  async importLegacy(ownerId: string) {
    if (await this.get("SELECT value FROM settings WHERE key='legacy_imported'")) return 0;
    const records: StoredDocument[] = existsSync(this.legacyFile) ? JSON.parse(readFileSync(this.legacyFile, 'utf8')) : [];
    if (!Array.isArray(records) || records.some(d => !d.id || typeof d.text !== 'string' || !d.chunks?.length || d.chunks.some(c => !Array.isArray(c.embedding) || !c.embedding.length || c.embedding.some(v => !Number.isFinite(v))))) throw new Error('Existing document snapshot is invalid. It has not been modified.');
    for (const record of records) await this.insertDocument(ownerId, record);
    await this.run("INSERT INTO settings VALUES('legacy_imported',?)", String(Date.now()));
    return records.length;
  }
  async revision(ownerId: string) { return Number((await this.get('SELECT document_revision FROM users WHERE id=?', ownerId))?.document_revision || 0); }
  async beginMessage(ownerId: string, conversationId: string, question: string, id: string = randomUUID()) {
    const now = Date.now();
    await this.transaction(async () => {
      await this.run(`INSERT INTO conversations VALUES(?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET updated_at=excluded.updated_at`, ownerId, conversationId, question.slice(0, 80), now);
      const inserted = await this.run('INSERT INTO messages(owner_id,conversation_id,id,question,created_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,id) DO NOTHING', ownerId, conversationId, id, question, now);
      if (!inserted.changes) throw new ConflictException('This request ID already exists. Refresh saved history before retrying.');
    });
    return id;
  }
  async previousMessage(ownerId: string, id: string, conversationId: string, question: string) {
    const row = await this.get('SELECT * FROM messages WHERE owner_id=? AND id=?', ownerId, id);
    if (!row) return undefined;
    if (row.conversation_id !== conversationId || row.question !== question) throw new ConflictException('This request ID was already used for a different question. Send a new request.');
    if (row.result) return JSON.parse(String(row.result));
    throw new ConflictException(row.error ? 'This request already failed. Send a new request to retry.' : 'This request is already processing. Refresh chat history shortly.');
  }
  async limitWork(ownerId: string) {
    const now = Date.now();
    await this.run('DELETE FROM auth_limits WHERE reset_at<=?', now);
    const row = await this.get('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=auth_limits.count+1 RETURNING count', `work:${ownerId}`, now + 60000);
    if (Number(row!.count) > 20) throw new HttpException('You have reached 20 operations per minute. Wait one minute and retry.', 429);
  }
  async deleteDocument(ownerId: string, id: string) {
    await this.transaction(async () => {
      const result = await this.run('DELETE FROM documents WHERE owner_id=? AND id=?', ownerId, id);
      if (!result.changes) throw new NotFoundException('Document not found.');
      await this.run('UPDATE users SET document_revision=document_revision+1 WHERE id=?', ownerId);
    });
  }
  async finishMessage(ownerId: string, messageId: string, result?: unknown, error?: string) {
    await this.run('UPDATE messages SET result=?,error=? WHERE owner_id=? AND id=?', result === undefined ? null : JSON.stringify(result), error ?? null, ownerId, messageId);
  }
  async conversations(ownerId: string) {
    const revision = await this.revision(ownerId);
    const rows = await this.all('SELECT id,title FROM conversations WHERE owner_id=? ORDER BY updated_at DESC,id LIMIT 100', ownerId);
    const messages = await this.all('SELECT * FROM messages WHERE owner_id=? AND conversation_id IN (SELECT id FROM conversations WHERE owner_id=? ORDER BY updated_at DESC,id LIMIT 100) ORDER BY created_at,id', ownerId, ownerId);
    return rows.map(row => ({ id: String(row.id), title: String(row.title), messages: messages.filter(message => message.conversation_id === row.id).map(message => ({
      id: String(message.id), question: String(message.question), createdAt: new Date(Number(message.created_at)).toISOString(),
      ...(message.result ? { result: (() => { const result = JSON.parse(String(message.result)); return { ...result, sourcesChanged: result.sourceRevision === undefined ? undefined : result.sourceRevision !== revision }; })() } : { error: message.error ? String(message.error) : Date.now() - Number(message.created_at) < 180000 ? 'This answer is still processing. Refresh chat history shortly to check for a result.' : 'This answer was interrupted before completion. You can retry the question.' })
    })) }));
  }
}
