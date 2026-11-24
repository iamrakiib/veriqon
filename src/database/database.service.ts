import { Injectable, OnModuleInit, ConflictException, NotFoundException, HttpException, BadRequestException } from '@nestjs/common';
import { KnowledgeStore } from './knowledge-store';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { answerConflicts } from '../rag/conflicts';
import type { ConversationContext } from '../rag/query-context';
import { historyCursor, readHistoryCursor } from './history-cursor';
import { lexicalTerms } from '../common/utils';
import type { SourceMetadata } from '../rag/temporal';

export type StoredChunk = { chunkId: string; content: string; embedding: number[]; source?: string; page?: number; version?: string; index: number };
export type StoredDocument = { id: string; text: string; embeddingModel?: string; chunks: StoredChunk[]; metadata?: SourceMetadata; snapshotId?: string };
export type OriginalFile = { bytes: Buffer; name: string; mime: string };

@Injectable()
export class DatabaseService extends KnowledgeStore implements OnModuleInit {
  private readonly shutdownTasks: (() => Promise<void>)[] = [];
  registerShutdown(task: () => Promise<void>) { this.shutdownTasks.push(task); }
  async onModuleDestroy() { await Promise.all(this.shutdownTasks.map(task => task())); await super.onModuleDestroy(); }
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
      CREATE TABLE IF NOT EXISTS ingestion_jobs (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL, source TEXT NOT NULL, text TEXT, original_file BLOB, original_mime TEXT NOT NULL,
        fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','processing','retry_wait','failed','completed')),
        total_chunks INTEGER NOT NULL, completed_chunks INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, next_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(owner_id,document_id));
      CREATE INDEX IF NOT EXISTS ingestion_due ON ingestion_jobs(status,next_at,lease_until);
      CREATE INDEX IF NOT EXISTS ingestion_owner ON ingestion_jobs(owner_id,created_at);
      CREATE TABLE IF NOT EXISTS ingestion_vectors (
        job_id TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL, embedding TEXT NOT NULL, PRIMARY KEY(job_id,chunk_index));
      PRAGMA user_version=4;` + readFileSync(join(process.cwd(), 'migrations', '004_knowledge_lifecycle.sql'), 'utf8'));
    this.setupFile = process.env.SETUP_CODE_PATH || join(dirname(this.filename), 'setup-code.txt');
    this.legacyFile = process.env.DOCUMENT_STORE_PATH || join(process.cwd(), 'data', 'documents.json');
    if (this.dialect === 'sqlite' && !this.db.prepare('SELECT id FROM users LIMIT 1').get() && this.filename !== ':memory:' && !existsSync(this.setupFile)) {
      mkdirSync(dirname(this.setupFile), { recursive: true });
      writeFileSync(this.setupFile, randomBytes(24).toString('base64url'), { mode: 0o600, flag: 'wx' });
    }
  }
  async onModuleInit() { await this.initialize(); }
  async hasUsers() { return Boolean(await this.get('SELECT id FROM users LIMIT 1')); }
  async readDocuments(ownerId: string, documentIds?: string[]): Promise<StoredDocument[]> {
    if (documentIds && !documentIds.length) return [];
    const ids = documentIds ? [...new Set(documentIds)] : [];
    const scope = documentIds ? ` AND id IN (${ids.map(() => '?').join(',')})` : '';
    const chunkScope = documentIds ? ` AND document_id IN (${ids.map(() => '?').join(',')})` : '';
    const docs = await this.all(`SELECT id,text,version,embedding_model FROM documents WHERE owner_id=?${scope} ORDER BY created_at,id`, ownerId, ...ids);
    const chunks = await this.all(`SELECT * FROM chunks WHERE owner_id=?${chunkScope} ORDER BY document_id,chunk_index`, ownerId, ...ids);
    const records = new Map<string, StoredDocument>(docs.map(doc => [String(doc.id), { id: String(doc.id), text: String(doc.text), embeddingModel: doc.embedding_model ? String(doc.embedding_model) : undefined, chunks: [] }]));
    const versions = new Map(docs.map(doc => [String(doc.id), doc.version ? String(doc.version) : undefined]));
    for (const c of chunks) {
      const doc = records.get(String(c.document_id));
      if (!doc) continue;
      let version = c.version ? String(c.version) : versions.get(doc.id);
      if (!version) {
        version = 'sha256:' + createHash('sha256').update(doc.text).digest('hex');
        versions.set(doc.id, version);
      }
      doc.chunks.push({ chunkId: `${doc.id}#${c.chunk_index}`, index: Number(c.chunk_index), content: String(c.content), embedding: JSON.parse(String(c.embedding)), source: c.source ? String(c.source) : undefined, page: c.page ? Number(c.page) : undefined, version });
    }
    return [...records.values()];
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
  /** Provider-independent fallback: bounded passage windows, no vectors or original-file payloads. */
  async lexicalDocuments(ownerId: string, query: string, topK: number, documentIds?: string[]): Promise<StoredDocument[]> {
    if (documentIds && !documentIds.length) return [];
    const terms = lexicalTerms(query);
    if (!terms.length && !documentIds?.length) return [];
    const depth = Math.max(12, Math.min(80, topK * 10));
    const scope = documentIds ? ` AND document_id IN (${documentIds.map(() => '?').join(',')})` : '';
    // Terms contain only letters/numbers; bound parameters cannot supply LIKE wildcards or SQL.
    const score = terms.length ? terms.map(() => 'CASE WHEN lower(content) LIKE ? THEN 1 ELSE 0 END').join('+') : '0';
    const multi = documentIds && documentIds.length > 1;
    const seeds = multi ? `SELECT document_id,chunk_index FROM (
      SELECT document_id,chunk_index,row_number() OVER (PARTITION BY document_id ORDER BY score DESC,chunk_index) AS position FROM scored
      ) ranked WHERE position<=?` : `SELECT document_id,chunk_index FROM scored ${documentIds ? '' : 'WHERE score>0'} ORDER BY score DESC,document_id,chunk_index LIMIT ?`;
    const rows = await this.all(`WITH scored AS (
      SELECT document_id,chunk_index,(${score}) AS score FROM chunks WHERE owner_id=?${scope}
    ), seeds AS (${seeds})
      SELECT DISTINCT c.document_id,c.chunk_index,c.content,c.source,c.page,c.version,d.version AS document_version,d.embedding_model
      FROM seeds s JOIN chunks c ON c.document_id=s.document_id AND c.chunk_index BETWEEN s.chunk_index-2 AND s.chunk_index+2
      JOIN documents d ON d.owner_id=c.owner_id AND d.id=c.document_id
      WHERE c.owner_id=? ORDER BY c.document_id,c.chunk_index`, ...terms.map(term => `%${term}%`), ownerId, ...(documentIds || []),
      multi ? Math.max(1, Math.floor(depth / documentIds.length)) : depth, ownerId);
    const records = new Map<string, StoredDocument>();
    const legacyVersions = new Map<string, string>();
    for (const row of rows) {
      let version = row.version || row.document_version;
      if (!version) {
        version = legacyVersions.get(row.document_id);
        if (!version) {
          const document = await this.get('SELECT text FROM documents WHERE owner_id=? AND id=?', ownerId, row.document_id);
          if (!document) continue;
          version = 'sha256:' + createHash('sha256').update(String(document.text)).digest('hex');
          legacyVersions.set(row.document_id, version);
        }
      }
      if (!records.has(row.document_id)) records.set(row.document_id, { id: row.document_id, text: '', embeddingModel: row.embedding_model || undefined, chunks: [] });
      records.get(row.document_id)!.chunks.push({ chunkId: `${row.document_id}#${row.chunk_index}`, index: Number(row.chunk_index),
        content: row.content, embedding: [], source: row.source || undefined, page: row.page ?? undefined, version });
    }
    return [...records.values()];
  }
  /** PostgreSQL ranks vectors on the database; only candidate windows cross the network. */
  async candidateDocuments(ownerId: string, vector: number[], model: string, topK: number, query = '', documentIds?: string[]): Promise<StoredDocument[]> {
    if (documentIds && !documentIds.length) return [];
    if (this.dialect !== 'postgresql') return this.readDocuments(ownerId, documentIds);
    const scope = documentIds ? ` AND document_id IN (${documentIds.map(() => '?').join(',')})` : '';
    const scopeArgs = documentIds || [];
    const incompatible = await this.get(`SELECT 1 FROM chunks c JOIN documents d ON d.owner_id=c.owner_id AND d.id=c.document_id
      WHERE c.owner_id=?${scope} AND (vector_dims(c.embedding)<>? OR (d.embedding_model IS NOT NULL AND d.embedding_model<>?)) LIMIT 1`, ownerId, ...scopeArgs, vector.length, model);
    if (incompatible) throw new BadRequestException('The embedding model changed. Re-upload the documents with the current EMBEDDING_MODEL before querying them.');
    const lexical = [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) || [])].slice(0, 24).join(' | ');
    const depth = Math.max(12, Math.min(80, Number(process.env.RETRIEVAL_CANDIDATES || topK * 10)));
    const multiSource = documentIds && documentIds.length > 1;
    const dense = multiSource ? `SELECT document_id,chunk_index FROM (
      SELECT document_id,chunk_index,row_number() OVER (PARTITION BY document_id ORDER BY embedding <=> ?::vector) AS position
      FROM chunks WHERE owner_id=?${scope}) ranked WHERE position<=?`
      : `SELECT document_id,chunk_index FROM chunks WHERE owner_id=?${scope} ORDER BY embedding <=> ?::vector LIMIT ?`;
    const denseArgs = multiSource ? [JSON.stringify(vector), ownerId, ...scopeArgs, Math.max(1, Math.floor(depth / documentIds.length))]
      : [ownerId, ...scopeArgs, JSON.stringify(vector), depth];
    const rows = await this.all(`WITH dense AS MATERIALIZED (
      ${dense}
    ), lexical AS MATERIALIZED (
      SELECT document_id,chunk_index FROM chunks WHERE owner_id=?${scope} AND to_tsvector('simple',content) @@ to_tsquery('simple',?)
      ORDER BY ts_rank_cd(to_tsvector('simple',content),to_tsquery('simple',?)) DESC LIMIT ?
    ), seeds AS MATERIALIZED (
      SELECT * FROM dense UNION SELECT * FROM lexical
    ) SELECT DISTINCT c.*,d.embedding_model,COALESCE(d.version,'sha256:' || encode(sha256(convert_to(d.text,'UTF8')),'hex')) AS document_version FROM seeds s JOIN chunks c
      ON c.document_id=s.document_id AND c.chunk_index BETWEEN s.chunk_index-2 AND s.chunk_index+2
      JOIN documents d ON d.owner_id=c.owner_id AND d.id=c.document_id
      WHERE c.owner_id=? ORDER BY c.document_id,c.chunk_index`, ...denseArgs, ownerId, ...scopeArgs, lexical, lexical, depth, ownerId);
    const records = new Map<string, StoredDocument>();
    for (const row of rows) {
      if (!records.has(row.document_id)) records.set(row.document_id, { id: row.document_id, text: '', embeddingModel: row.embedding_model || undefined, chunks: [] });
      records.get(row.document_id)!.chunks.push({ chunkId: `${row.document_id}#${row.chunk_index}`, index: row.chunk_index,
        content: row.content, embedding: JSON.parse(String(row.embedding)), source: row.source || undefined, page: row.page || undefined, version: row.version || row.document_version });
    }
    return [...records.values()];
  }
  private async insertDocument(ownerId: string, record: StoredDocument, file?: OriginalFile) {
    const previous = await this.get('SELECT text,version FROM documents WHERE owner_id=? AND id=?',ownerId,record.id);
    if (previous && previous.text !== record.text && record.chunks[0]?.version && previous.version === record.chunks[0].version) throw new ConflictException('A content version cannot identify different document text. Supply a new version.');
    if (record.chunks[0]?.version && await this.get(`SELECT 1 FROM document_versions WHERE owner_id=? AND document_id=?
      AND ${this.snapshotField('version')}=? AND ${this.snapshotField('text')}<>? LIMIT 1`,ownerId,record.id,record.chunks[0].version,record.text)) {
      throw new ConflictException('A historical content version cannot identify different document text. Supply a new version.');
    }
    await this.captureDocumentVersion(ownerId, record.id);
    if (previous && previous.text !== record.text) {
      // Effective dates describe a particular content version, not a reusable filename.
      await this.run(`INSERT INTO document_metadata VALUES(?,?,'{}',1,?) ON CONFLICT(owner_id,document_id)
        DO UPDATE SET metadata='{}',revision=document_metadata.revision+1,updated_at=excluded.updated_at`,ownerId,record.id,Date.now());
    }
    const meta = record.chunks[0];
    await this.run(`INSERT INTO documents(owner_id,id,text,source,version,page,embedding_model,original_file,original_name,original_mime,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET text=excluded.text,source=excluded.source,version=excluded.version,page=excluded.page,embedding_model=excluded.embedding_model,
      original_file=excluded.original_file,original_name=excluded.original_name,original_mime=excluded.original_mime`, ownerId, record.id, record.text, meta?.source ?? null, meta?.version ?? null, meta?.page ?? null, record.embeddingModel ?? null, file?.bytes ?? null, file?.name ?? null, file?.mime ?? null, Date.now());
    await this.run('DELETE FROM chunks WHERE owner_id=? AND document_id=?', ownerId, record.id);
    
    for (const chunk of record.chunks) await this.run('INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)', ownerId, record.id, chunk.index, chunk.content, JSON.stringify(chunk.embedding), chunk.source ?? null, chunk.page ?? null, chunk.version ?? null);
    await this.run('UPDATE users SET document_revision=document_revision+1 WHERE id=?', ownerId);
    await this.captureDocumentVersion(ownerId, record.id);
    await this.recordLibraryChange(ownerId, record.id, 'Document indexed or revised');
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
      // Fence a pending re-index before removing the searchable copy.
      await this.run('DELETE FROM ingestion_jobs WHERE owner_id=? AND document_id=?', ownerId, id);
      const result = await this.run('DELETE FROM documents WHERE owner_id=? AND id=?', ownerId, id);
      if (!result.changes) throw new NotFoundException('Document not found.');
      await this.run('UPDATE users SET document_revision=document_revision+1 WHERE id=?', ownerId);
      await this.recordLibraryChange(ownerId, id, 'Document removed');
    });
  }
  async finishMessage(ownerId: string, messageId: string, result?: unknown, error?: string) {
    await this.transaction(async () => {
      await this.run('UPDATE messages SET result=?,error=? WHERE owner_id=? AND id=?', result === undefined ? null : JSON.stringify(result), error ?? null, ownerId, messageId);
      if (result !== undefined) {
        await this.run('INSERT INTO answer_versions VALUES(?,?,0,?,?,?,?) ON CONFLICT(owner_id,message_id,sequence) DO NOTHING', ownerId, messageId, JSON.stringify(result), Number((result as any).sourceRevision || 0), 'Original answer', Date.now());
        await this.persistAnswerConflicts(ownerId, messageId, result);
      }
    });
  }
  async conflicts(ownerId: string) {
    const rows = await this.all('SELECT id,conversation_id,question,created_at,result FROM messages WHERE owner_id=? AND result IS NOT NULL ORDER BY created_at DESC,id LIMIT 201', ownerId);
    const saved = rows.slice(0, 200).flatMap(row => answerConflicts({ id: String(row.id), conversationId: String(row.conversation_id), question: String(row.question), createdAt: Number(row.created_at) }, JSON.parse(String(row.result))));
    const persisted = await this.conflictRecords(ownerId, saved);
    return { coverage: 'saved_answer_assessments' as const, truncated: rows.length > 200 || persisted.truncated, reviewedAnswers: Math.min(200, rows.length), records: persisted.records };
  }
  private historyMessage(message: Record<string, any>, revision: number) {
    return {
      id: String(message.id), question: String(message.question), createdAt: new Date(Number(message.created_at)).toISOString(),
      ...(message.result ? { result: (() => { const result = JSON.parse(String(message.result)); return { ...result, sourcesChanged: result.sourceRevision === undefined ? undefined : result.sourceRevision !== revision }; })() } : { error: message.error ? String(message.error) : Date.now() - Number(message.created_at) < 180000 ? 'This answer is still processing. Refresh chat history shortly to check for a result.' : 'This answer was interrupted before completion. You can retry the question.' })
    };
  }
  async savedAnswer(ownerId: string, messageId: string) {
    const row = await this.get('SELECT m.*,c.title FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.owner_id=m.owner_id WHERE m.owner_id=? AND m.id=?', ownerId, messageId);
    if (!row) throw new NotFoundException('Saved answer not found.');
    return { conversationId: String(row.conversation_id), title: String(row.title), message: this.historyMessage(row, await this.revision(ownerId)) };
  }
  async conversations(ownerId: string, before?: string) {
    const revision = await this.revision(ownerId);
    const cursor = readHistoryCursor(before);
    const rows = await this.all(`SELECT id,title,updated_at FROM conversations WHERE owner_id=? ${cursor ? 'AND (updated_at<? OR (updated_at=? AND id<?))' : ''} ORDER BY updated_at DESC,id DESC LIMIT 21`, ownerId, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []));
    const selected = rows.slice(0, 20);
    // Rank keys, then load only bounded result blobs; one batch avoids a database round trip per chat.
    const messages = selected.length ? await this.all(`WITH ranked AS (
      SELECT id,conversation_id,ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC,id DESC) AS position
      FROM messages WHERE owner_id=? AND conversation_id IN (${selected.map(() => '?').join(',')})
    ) SELECT m.* FROM ranked r JOIN messages m ON m.id=r.id AND m.owner_id=?
      WHERE r.position<=11 ORDER BY m.created_at DESC,m.id DESC`, ownerId, ...selected.map(r => r.id), ownerId) : [];
    return selected.map(row => ({ id: String(row.id), title: String(row.title), ...this.historyPage(messages.filter(m => m.conversation_id === row.id), 10, revision),
        cursor: historyCursor(Number(row.updated_at), String(row.id)),
        hasMoreConversations: rows.length > 20 }));
  }
  private async messagePage(ownerId: string, conversationId: string, before: string | undefined, limit: number, revision: number) {
    const cursor = readHistoryCursor(before);
    const rows = await this.all(`SELECT * FROM messages WHERE owner_id=? AND conversation_id=? ${cursor ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''} ORDER BY created_at DESC,id DESC LIMIT ?`, ownerId, conversationId, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), limit + 1);
    return this.historyPage(rows, limit, revision);
  }
  private historyPage(rows: Record<string, any>[], limit: number, revision: number) {
    const selected = rows.slice(0, limit);
    const oldest = selected[selected.length - 1];
    return { messages: selected.reverse().map(message => this.historyMessage(message, revision)),
      olderMessagesCursor: rows.length > limit && oldest ? historyCursor(Number(oldest.created_at), String(oldest.id)) : null };
  }
  async conversationMessages(ownerId: string, conversationId: string, before?: string) {
    if (!await this.get('SELECT id FROM conversations WHERE owner_id=? AND id=?', ownerId, conversationId)) throw new NotFoundException('Conversation not found.');
    return this.messagePage(ownerId, conversationId, before, 30, await this.revision(ownerId));
  }
  async conversationContext(ownerId: string, conversationId: string): Promise<ConversationContext | undefined> {
    const rows = await this.all('SELECT question,result FROM messages WHERE owner_id=? AND conversation_id=? AND result IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 20', ownerId, conversationId);
    const usable = rows.flatMap(row => {
      try {
        const result = JSON.parse(String(row.result));
        if (result.answerOrigin || !['VERIFIED_UNCHANGED','REPAIRED_VERIFIED'].includes(result.verificationStatus) || !result.factCheck?.passed || typeof result.draft !== 'string') return [];
        return [{ question: String(row.question).slice(0, 1200), answer: result.draft.slice(0, 2000), citations: Array.isArray(result.citations) ? result.citations : [] }];
      } catch { return []; }
    }).slice(0, 3);
    if (!rows.length) return undefined;
    const citations = (usable[0]?.citations || []).filter((c: any) => typeof c.documentId === 'string' && typeof c.source === 'string').map((c: any) => ({ documentId: c.documentId, source: c.source, ...(typeof c.version === 'string' ? { version: c.version } : {}) }));
    // Even a conflicted answer can follow an explicit user filename reference.
    // Retain only questions for reference resolution; failed/conflicted answer text is never injected.
    return { turns: usable.reverse().map(({ question, answer }) => ({ question, answer })), citations,
      sourceQuestions: rows.slice(0, 3).reverse().map(row => String(row.question).slice(0, 4000)) };
  }
}
