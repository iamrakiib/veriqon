import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { SqlStore } from './sql-store';
import { type SourceMetadata, type TemporalScope, validateMetadata, sameScope } from '../rag/temporal';
import { answerConflicts, type EvidenceConflict } from '../rag/conflicts';
import { historyCursor, readHistoryCursor } from './history-cursor';
import type { StoredDocument } from './database.service';
import type { ReviewDecision } from '../rag/source-decisions';

export type ConflictDecision = { action: 'PREFER_SOURCE' | 'DIFFERENT_SCOPE' | 'KEEP_UNRESOLVED'; preferredDocumentId?: string; explanation: string; expectedRevision: number };
type ReviewSource = { documentId: string; version?: string; snapshotId?: string };
export type HistoricalSource = { id: string; snapshotId: string; bytes: number; metadata: SourceMetadata };

/** Persistent knowledge lifecycle. Every lookup and mutation is scoped to the authenticated library. */
export class KnowledgeStore extends SqlStore {
  async metadata(owner: string, id: string) {
    if (!await this.get('SELECT id FROM documents WHERE owner_id=? AND id=?', owner, id)) throw new NotFoundException('Document not found.');
    const row = await this.get('SELECT * FROM document_metadata WHERE owner_id=? AND document_id=?', owner, id);
    return { metadata: row ? JSON.parse(String(row.metadata)) as SourceMetadata : {}, revision: Number(row?.revision || 0), updatedAt: row ? Number(row.updated_at) : null };
  }
  async metadataMap(owner: string): Promise<Map<string, SourceMetadata>> {
    return new Map((await this.all('SELECT document_id,metadata FROM document_metadata WHERE owner_id=?', owner)).map(row => [String(row.document_id), JSON.parse(String(row.metadata))]));
  }
  async auditKnowledge(owner: string, id: string, action: string, reason: string, payload: unknown) {
    await this.run('INSERT INTO knowledge_events VALUES(?,?,?,?,?,?,?)', randomUUID(), owner, id, action, reason, JSON.stringify(payload), Date.now());
  }
  async captureDocumentVersion(owner: string, id: string) {
    const doc = await this.get('SELECT id,text,source,version,page FROM documents WHERE owner_id=? AND id=?', owner, id);
    if (!doc) return;
    const metadata = await this.get('SELECT metadata,revision FROM document_metadata WHERE owner_id=? AND document_id=?', owner, id);
    const chunks = await this.all('SELECT chunk_index,content FROM chunks WHERE owner_id=? AND document_id=? ORDER BY chunk_index', owner, id);
    const snapshot = JSON.stringify({ ...doc, version: doc.version || 'sha256:' + createHash('sha256').update(String(doc.text)).digest('hex'), metadata: metadata ? JSON.parse(String(metadata.metadata)) : {}, metadataRevision: Number(metadata?.revision || 0), chunks });
    const version = createHash('sha256').update(snapshot).digest('hex');
    // Immutable, deduplicated snapshots. No embeddings, original binaries, or secrets are copied.
    if (!await this.get('SELECT 1 FROM document_versions WHERE owner_id=? AND document_id=? AND version_id=?', owner, id, version)) {
      const size = this.dialect === 'postgresql' ? 'octet_length(snapshot)' : 'length(CAST(snapshot AS BLOB))';
      const usage = await this.get(`SELECT COALESCE(SUM(${size}),0) AS bytes FROM document_versions WHERE owner_id=?`, owner);
      if (Number(usage?.bytes || 0) + Buffer.byteLength(snapshot) > 200 * 1024 * 1024) throw new BadRequestException('Document version history reached 200 MB. Export and remove unneeded documents before adding versions.');
      const latest = await this.get('SELECT MAX(recorded_at) AS time FROM document_versions WHERE owner_id=? AND document_id=?',owner,id);
      await this.run('INSERT INTO document_versions VALUES(?,?,?,?,?) ON CONFLICT(owner_id,document_id,version_id) DO NOTHING', owner, id, version, snapshot, Math.max(Date.now(),Number(latest?.time || 0)+1));
    }
  }
  async recordLibraryChange(owner: string, id: string, reason: string) {
    const revision = Number((await this.get('SELECT document_revision FROM users WHERE id=?', owner))?.document_revision || 0);
    await this.run('INSERT INTO library_changes(owner_id,revision,document_id,reason,created_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,revision) DO NOTHING', owner, revision, id, reason, Date.now());
  }
  async updateMetadata(owner: string, id: string, input: SourceMetadata, expectedRevision: number, reason: string) {
    const meta = validateMetadata(input);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || !reason?.trim() || reason.trim().length < 10 || reason.length > 1000) throw new BadRequestException('Include the current metadata revision and an explanation of 10–1,000 characters.');
    return this.transaction(async () => {
      if (this.dialect === 'postgresql') await this.get('SELECT id FROM users WHERE id=? FOR UPDATE', owner);
      const previous = await this.metadata(owner, id);
      if (previous.revision !== expectedRevision) throw new ConflictException('Metadata changed. Reload the source before saving.');
      if (meta.supersedes) {
        if (meta.supersedes === id || !meta.effectiveFrom || !meta.scope) throw new BadRequestException('Supersession needs another source, an effective start, and an explicit scope.');
        const target = await this.metadata(owner, meta.supersedes);
        if (!sameScope(meta, target.metadata)) throw new BadRequestException('Supersession requires matching explicit source scopes.');
        const seen = new Set([id]); let cursor: string | undefined = meta.supersedes;
        while (cursor) {
          if (seen.has(cursor)) throw new BadRequestException('Supersession cannot form a cycle.');
          seen.add(cursor); cursor = (await this.metadata(owner, cursor)).metadata.supersedes;
        }
      }
      await this.captureDocumentVersion(owner, id);
      await this.run(`INSERT INTO document_metadata VALUES(?,?,?,?,?) ON CONFLICT(owner_id,document_id)
        DO UPDATE SET metadata=excluded.metadata,revision=excluded.revision,updated_at=excluded.updated_at`, owner, id, JSON.stringify(meta), expectedRevision + 1, Date.now());
      await this.captureDocumentVersion(owner, id);
      await this.auditKnowledge(owner, id, 'SOURCE_METADATA', reason.trim(), { before: previous.metadata, after: meta });
      await this.run('UPDATE users SET document_revision=document_revision+1 WHERE id=?', owner);
      await this.recordLibraryChange(owner, id, 'Source metadata changed');
      return this.metadata(owner, id);
    });
  }
  async documentVersions(owner: string, id: string) {
    await this.metadata(owner, id);
    return (await this.all('SELECT version_id,snapshot,recorded_at FROM document_versions WHERE owner_id=? AND document_id=? ORDER BY recorded_at DESC,version_id LIMIT 100', owner, id))
      .map(row => ({ versionId: row.version_id, recordedAt: Number(row.recorded_at), ...JSON.parse(String(row.snapshot)) }));
  }
  protected snapshotField(field: string) {
    return this.dialect === 'postgresql' ? `snapshot::jsonb #>> '{${field.replace(/\./g, ',')}}'` : `json_extract(snapshot,'$.${field}')`;
  }
  /** Small version descriptors also expose supersession outside a selected file scope. */
  async historicalSources(owner: string, time: TemporalScope, ids?: string[]): Promise<HistoricalSource[]> {
    if (ids && !ids.length) return [];
    const field = (name: string) => this.snapshotField(name);
    const size = this.dialect === 'postgresql' ? 'octet_length(snapshot)' : 'length(CAST(snapshot AS BLOB))';
    const candidates = await this.all(`WITH ranked AS (
      SELECT document_id,version_id,snapshot,recorded_at,
        row_number() OVER (PARTITION BY document_id,COALESCE(${field('version')},${field('text')})
          ORDER BY COALESCE(CAST(${field('metadataRevision')} AS INTEGER),0) DESC,recorded_at DESC,version_id DESC) AS position
      FROM document_versions WHERE owner_id=?
    ) SELECT document_id,version_id,${size} AS bytes,${field('metadata')} AS metadata FROM ranked
      WHERE position=1 AND ${field('metadata.effectiveFrom')} IS NOT NULL
      AND ${field('metadata.effectiveFrom')} < ? AND (${field('metadata.effectiveTo')} IS NULL OR ${field('metadata.effectiveTo')} >= ?)
      AND ${field('text')} <> (SELECT text FROM documents WHERE owner_id=? AND id=ranked.document_id)
      ${ids ? `AND (document_id IN (${ids.map(()=>'?').join(',')}) OR ${field('metadata.supersedes')} IN (${ids.map(()=>'?').join(',')}))` : ''}
      ORDER BY document_id,recorded_at DESC,version_id LIMIT 1001`,owner,time.to,time.from,owner,...(ids || []),...(ids || []));
    if (candidates.length > 1000) throw new BadRequestException('Too many applicable archived relationships. Select fewer documents or a narrower date period.');
    return candidates.map(row=>({id:String(row.document_id),snapshotId:String(row.version_id),bytes:Number(row.bytes),metadata:JSON.parse(String(row.metadata || '{}')) as SourceMetadata}));
  }
  /** Archived text uses lexical ranking; vectors are deliberately not fabricated. */
  async historicalDocuments(owner: string, time: TemporalScope, ids?: string[]): Promise<StoredDocument[]> {
    const sources=await this.historicalSources(owner,time,ids);
    return this.readHistoricalDocuments(owner,sources.filter(s=>!ids || ids.includes(s.id)));
  }
  async readHistoricalDocuments(owner: string, candidates: HistoricalSource[]): Promise<StoredDocument[]> {
    if (candidates.length > 100) throw new BadRequestException('Too many applicable archived versions. Select a document or a narrower date period.');
    // Check serialized size in SQL before transferring/parsing whole snapshots in Node.
    // The owner storage quota alone is not a safe per-request allocation bound.
    if (candidates.reduce((total,row)=>total+Number(row.bytes),0) > 8 * 1024 * 1024) throw new BadRequestException('Archived evidence exceeds the 8 MiB request budget. Narrow the selected documents or date range.');
    if (!candidates.length) return [];
    const rows = await this.all(`SELECT document_id,version_id,snapshot FROM document_versions WHERE owner_id=? AND (${candidates.map(()=>'(document_id=? AND version_id=?)').join(' OR ')})`,owner,...candidates.flatMap(row=>[row.id,row.snapshotId]));
    if (rows.length!==candidates.length) throw new ConflictException('Document history changed during retrieval. Retry the question.');
    const key=(row:Record<string,unknown>)=>JSON.stringify([row.document_id,row.version_id]);
    const order = new Map(candidates.map((row,index)=>[JSON.stringify([row.id,row.snapshotId]),index]));
    rows.sort((a,b)=>order.get(key(a))!-order.get(key(b))!);
    return rows.map(row => {
      const snapshot=JSON.parse(String(row.snapshot));
      const version=snapshot.version || 'sha256:'+createHash('sha256').update(snapshot.text).digest('hex');
      return {id:String(row.document_id),text:snapshot.text,metadata:snapshot.metadata,snapshotId:String(row.version_id),
        chunks:snapshot.chunks.map((c: {chunk_index:number;content:string})=>({chunkId:`${row.document_id}@${row.version_id}#${c.chunk_index}`,index:c.chunk_index,content:c.content,source:snapshot.source || undefined,page:snapshot.page || undefined,version,embedding:[]}))};
    });
  }
  async documentVersionPage(owner: string,id: string,limit=20,cursor?:string) {
    await this.metadata(owner,id);
    if (!Number.isInteger(limit) || limit<1 || limit>50) throw new BadRequestException('History limit must be 1–50.');
    const after=readHistoryCursor(cursor), field=(name:string)=>this.snapshotField(name);
    const rows=await this.all(`SELECT version_id,recorded_at,${field('version')} AS version,${field('metadata.effectiveFrom')} AS effective_from,
      ${field('metadata.effectiveTo')} AS effective_to,${field('metadata.scope')} AS scope
      FROM document_versions WHERE owner_id=? AND document_id=? ${after?'AND (recorded_at<? OR (recorded_at=? AND version_id<?))':''}
      ORDER BY recorded_at DESC,version_id DESC LIMIT ?`,owner,id,...(after?[after[0],after[0],after[1]]:[]),limit+1);
    const items=rows.slice(0,limit).map(row=>({versionId:String(row.version_id),version:row.version,recordedAt:Number(row.recorded_at),metadata:{effectiveFrom:row.effective_from || undefined,effectiveTo:row.effective_to || undefined,scope:row.scope || undefined}}));
    const last=items.at(-1);
    return {items,nextCursor:rows.length>limit && last?historyCursor(last.recordedAt,last.versionId):null};
  }
  async documentVersion(owner:string,id:string,versionId:string) {
    await this.metadata(owner,id);
    const row=await this.get('SELECT snapshot,recorded_at FROM document_versions WHERE owner_id=? AND document_id=? AND version_id=?',owner,id,versionId);
    if (!row) throw new NotFoundException('Document version not found.');
    return {versionId,recordedAt:Number(row.recorded_at),...JSON.parse(String(row.snapshot))};
  }
  async knowledgeEventPage(owner:string,id:string,limit=20,cursor?:string) {
    if (!Number.isInteger(limit)||limit<1||limit>50) throw new BadRequestException('History limit must be 1–50.');
    const after=readHistoryCursor(cursor);
    const rows=await this.all(`SELECT id,action,reason,payload,created_at FROM knowledge_events WHERE owner_id=? AND entity_id=?
      ${after?'AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT ?`,owner,id,...(after?[after[0],after[0],after[1]]:[]),limit+1);
    const items=rows.slice(0,limit).map(row=>({id:String(row.id),action:row.action,reason:row.reason,actorId:owner,payload:JSON.parse(String(row.payload)),createdAt:Number(row.created_at)}));
    const last=items.at(-1);
    return {items,nextCursor:rows.length>limit && last?historyCursor(last.createdAt,last.id):null};
  }
  async knowledgeEvents(owner: string, id: string) {
    return (await this.all('SELECT id,action,reason,payload,created_at FROM knowledge_events WHERE owner_id=? AND entity_id=? ORDER BY created_at,id LIMIT 200', owner, id))
      .map(row => ({ id: row.id, action: row.action, reason: row.reason, actorId: owner, payload: JSON.parse(String(row.payload)), createdAt: Number(row.created_at) }));
  }
  async persistConflict(owner: string, conflict: EvidenceConflict) {
    const sourceMetadataRevisions: Record<string,number> = {};
    for (const source of [...conflict.supporting,...conflict.contradicting]) sourceMetadataRevisions[source.documentId]=Number((await this.get('SELECT revision FROM document_metadata WHERE owner_id=? AND document_id=?',owner,source.documentId))?.revision || 0);
    await this.run(`INSERT INTO evidence_conflicts(owner_id,id,payload,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(owner_id,id) DO NOTHING`, owner, conflict.id, JSON.stringify({...conflict,sourceMetadataRevisions}), Date.now(), Date.now());
  }
  async persistAnswerConflicts(owner: string, messageId: string, result: any) {
    const message = await this.get('SELECT conversation_id,question,created_at FROM messages WHERE owner_id=? AND id=?', owner, messageId);
    if (!message) return;
    for (const conflict of answerConflicts({ id: messageId, conversationId: String(message.conversation_id), question: String(message.question), createdAt: Number(message.created_at) }, result)) await this.persistConflict(owner, conflict);
  }
  async conflictRecords(owner: string, legacy: EvidenceConflict[] = [], review?: { sources?: ReviewSource[] }) {
    if (!review && legacy.length) {
      const hidden = new Set((await this.all(`SELECT DISTINCT entity_id FROM knowledge_events WHERE owner_id=? AND action='CONFLICT_ARCHIVED' AND entity_id IN (${legacy.map(() => '?').join(',')})`, owner, ...legacy.map(c => c.id))).map(row => String(row.entity_id)));
      legacy = legacy.filter(c => !hidden.has(c.id));
    }
    const records = new Map<string, any>(legacy.map(c => [c.id, { ...c, revision: 0 }]));
    const args:unknown[]=[owner];
    let filter=review ? " AND status IN ('RESOLVED','DISMISSED')" : " AND NOT EXISTS (SELECT 1 FROM knowledge_events e WHERE e.owner_id=evidence_conflicts.owner_id AND e.entity_id=evidence_conflicts.id AND e.action='CONFLICT_ARCHIVED')";
    if (review?.sources) {
      const sources=review.sources.filter(s=>s.version);
      if (!sources.length) return {records:[],truncated:false};
      // Filter all recorded source identities in SQL before the bounded display window.
      const side=(name:'supporting'|'contradicting')=>this.dialect==='postgresql'
        ? `SELECT value->>'documentId' AS document_id,value->>'version' AS version,value->>'snapshotId' AS snapshot_id FROM jsonb_array_elements(payload::jsonb->'${name}')`
        : `SELECT json_extract(value,'$.documentId') AS document_id,json_extract(value,'$.version') AS version,json_extract(value,'$.snapshotId') AS snapshot_id FROM json_each(payload,'$.${name}')`;
      filter+=` AND NOT EXISTS (SELECT 1 FROM (${side('supporting')} UNION ALL ${side('contradicting')}) refs WHERE NOT (${sources.map(()=>"(COALESCE(document_id,'')=? AND COALESCE(version,'')=? AND COALESCE(snapshot_id,'')=?)").join(' OR ')}))`;
      args.push(...sources.flatMap(s=>[s.documentId,s.version,s.snapshotId || '']));
    }
    const rows = await this.all(`SELECT * FROM evidence_conflicts WHERE owner_id=?${filter} ORDER BY updated_at DESC,id LIMIT 201`, ...args);
    const parsed = rows.slice(0, 200).map(row => ({ row, conflict: JSON.parse(String(row.payload)) as EvidenceConflict & { sourceMetadataRevisions?: Record<string, number> } }));
    const references = [...legacy, ...parsed.map(p => p.conflict)].flatMap(c => [...c.supporting, ...c.contradicting]);
    const ids = [...new Set(references.map(s => s.documentId))];
    if (!ids.length) return { records: [...records.values()], truncated: rows.length > 200 };
    const placeholders = ids.map(() => '?').join(',');
    const metadataRows = await this.all(`SELECT document_id,metadata,revision FROM document_metadata WHERE owner_id=? AND document_id IN (${placeholders})`, owner, ...ids);
    const metadata = new Map(metadataRows.map(d => [String(d.document_id), JSON.parse(String(d.metadata)) as SourceMetadata]));
    const metadataRevisions = new Map(metadataRows.map(d => [String(d.document_id), Number(d.revision)]));
    const currentRows = await this.all(`SELECT id,version FROM documents WHERE owner_id=? AND id IN (${placeholders})`, owner, ...ids);
    const current = new Map(currentRows.map(d => [String(d.id), String(d.version || '')]));
    // Normal writes already carry content hashes. Read text only for referenced legacy rows.
    const unhashed = currentRows.filter(d => !d.version).map(d => String(d.id));
    if (unhashed.length) for (const d of await this.all(`SELECT id,text FROM documents WHERE owner_id=? AND id IN (${unhashed.map(() => '?').join(',')})`, owner, ...unhashed)) {
      current.set(String(d.id), 'sha256:' + createHash('sha256').update(String(d.text)).digest('hex'));
    }
    const snapshotIds = [...new Set(references.flatMap(s => s.snapshotId ? [s.snapshotId] : []))];
    const archiveRows = snapshotIds.length ? await this.all(`SELECT document_id,version_id FROM document_versions WHERE owner_id=? AND document_id IN (${placeholders}) AND version_id IN (${snapshotIds.map(() => '?').join(',')})`, owner, ...ids, ...snapshotIds) : [];
    const archives = new Set(archiveRows.map(row => `${row.document_id}:${row.version_id}`));
    for (const { row, conflict: c } of parsed) {
      const resolution = row.resolution ? JSON.parse(String(row.resolution)) : null;
      const stale = [...c.supporting, ...c.contradicting].some(s => !current.has(s.documentId) || (s.snapshotId ? !archives.has(`${s.documentId}:${s.snapshotId}`) : current.get(s.documentId) !== s.version)
        || Number((resolution?.sourceMetadataRevisions || c.sourceMetadataRevisions)?.[s.documentId] || 0) !== (metadataRevisions.get(s.documentId) || 0));
      records.set(row.id, { ...c, status: stale ? 'UNRESOLVED' : row.status, revision: Number(row.revision), resolution, stale });
    }
    return { records: [...records.values()].map(c => ({ ...c,
      supporting: c.supporting.map((s: EvidenceConflict['supporting'][number]) => ({ ...s, currentMetadata: metadata.get(s.documentId) || {} })),
      contradicting: c.contradicting.map((s: EvidenceConflict['contradicting'][number]) => ({ ...s, currentMetadata: metadata.get(s.documentId) || {} })) })), truncated: rows.length > 200 };
  }
  async archiveConflicts(owner: string, records: { id: string; expectedRevision: number }[], legacy: EvidenceConflict[] = []) {
    if (!records.length || records.length > 200 || new Set(records.map(c => c.id)).size !== records.length
      || records.some(c => !c.id || c.id.length > 160 || !Number.isInteger(c.expectedRevision) || c.expectedRevision < 0)) throw new BadRequestException('Choose 1-200 distinct conflict records.');
    return this.transaction(async () => {
      if (this.dialect === 'postgresql') await this.get('SELECT id FROM users WHERE id=? FOR UPDATE', owner);
      for (const item of records) {
        const row = await this.get('SELECT revision FROM evidence_conflicts WHERE owner_id=? AND id=?', owner, item.id);
        const historical = legacy.find(c => c.id === item.id);
        if (!row && !historical) throw new NotFoundException('Conflict not found.');
        if (row && await this.get("SELECT id FROM knowledge_events WHERE owner_id=? AND entity_id=? AND action='CONFLICT_ARCHIVED' LIMIT 1", owner, item.id)) continue;
        if ((row ? Number(row.revision) : 0) !== item.expectedRevision) throw new ConflictException('A conflict decision changed. Refresh before clearing history.');
        if (!row) await this.persistConflict(owner, historical!);
        await this.auditKnowledge(owner, item.id, 'CONFLICT_ARCHIVED', 'Cleared from Conflict Center history; source decisions and saved answers retained.', { revision: item.expectedRevision });
      }
      return { cleared: records.length };
    });
  }

  async decideConflict(owner: string, id: string, decision: ConflictDecision, legacy?: EvidenceConflict) {
    if (!['PREFER_SOURCE','DIFFERENT_SCOPE','KEEP_UNRESOLVED'].includes(decision.action) || !decision.explanation?.trim() || decision.explanation.trim().length < 10 || decision.explanation.length > 1000 || !Number.isInteger(decision.expectedRevision)) throw new BadRequestException('Choose a decision and provide an explanation of 10–1,000 characters.');
    return this.transaction(async () => {
      if (this.dialect === 'postgresql') await this.get('SELECT id FROM users WHERE id=? FOR UPDATE', owner);
      const existing = await this.get('SELECT * FROM evidence_conflicts WHERE owner_id=? AND id=?', owner, id);
      if (!existing && !legacy) throw new NotFoundException('Conflict not found.');
      if (!existing && legacy) await this.persistConflict(owner, legacy);
      const row = (await this.get('SELECT * FROM evidence_conflicts WHERE owner_id=? AND id=?', owner, id))!;
      if ((existing ? Number(row.revision) : 0) !== decision.expectedRevision) throw new ConflictException('This conflict has a newer decision. Reload before deciding.');
      const conflict = JSON.parse(String(row.payload));
      const sources = [...conflict.supporting, ...conflict.contradicting];
      for (const source of sources) {
        let current = await this.get('SELECT version,text FROM documents WHERE owner_id=? AND id=?', owner, source.documentId);
        if (current && source.snapshotId) {
          const archived=await this.documentVersion(owner,source.documentId,source.snapshotId);
          current={version:archived.version,text:archived.text};
        }
        const version=current && (current.version || 'sha256:'+createHash('sha256').update(String(current.text)).digest('hex'));
        if (!current || !source.version || version !== source.version || !String(current.text).includes(source.quote)
          || Number(conflict.sourceMetadataRevisions?.[source.documentId] || 0)!==(await this.metadata(owner,source.documentId)).revision) throw new ConflictException('A source or its metadata was removed or revised. Recheck the evidence before resolving this conflict.');
      }
      if (decision.action === 'PREFER_SOURCE' && !sources.some(s => s.documentId === decision.preferredDocumentId)) throw new BadRequestException('Choose a source represented in this conflict.');
      const status = decision.action === 'KEEP_UNRESOLVED' ? 'UNRESOLVED' : decision.action === 'DIFFERENT_SCOPE' ? 'DISMISSED' : 'RESOLVED';
      const sourceMetadataRevisions: Record<string, number> = {};
      for (const source of sources) sourceMetadataRevisions[source.documentId] = (await this.metadata(owner, source.documentId)).revision;
      const resolution = { ...decision, actorId: owner, at: Date.now(), sourceMetadataRevisions };
      await this.run('UPDATE evidence_conflicts SET status=?,resolution=?,revision=revision+1,updated_at=? WHERE owner_id=? AND id=?', status, JSON.stringify(resolution), Date.now(), owner, id);
      await this.auditKnowledge(owner, id, 'CONFLICT_DECISION', decision.explanation.trim(), { before: row.resolution ? JSON.parse(String(row.resolution)) : null, after: resolution });
      await this.run('UPDATE users SET document_revision=document_revision+1 WHERE id=?', owner);
      await this.recordLibraryChange(owner, '', 'Conflict review decision changed');
      return { status, revision: Number(row.revision) + 1, resolution };
    });
  }
  async reviewDecisions(owner: string, sources?: ReviewSource[]): Promise<ReviewDecision[]> {
    const { records, truncated } = await this.conflictRecords(owner, [], {sources});
    if (truncated) throw new BadRequestException('More than 200 source decisions match this evidence. Narrow the selected documents before answering.');
    return records.filter(c => !c.stale && ['RESOLVED','DISMISSED'].includes(c.status) && ['PREFER_SOURCE','DIFFERENT_SCOPE'].includes(c.resolution?.action)).map(c => ({
      id: c.id, claim: c.claim, scope:c.scope, action:c.resolution.action, preferredDocumentId: c.resolution.preferredDocumentId,
      sources: [...c.supporting, ...c.contradicting].map(s => ({ documentId: s.documentId, version: s.version, snapshotId:s.snapshotId, quote: s.quote }))
    }));
  }
  async answerVersionPage(owner: string, messageId: string, limit = 20, cursor?: string) {
    if (!await this.get('SELECT id FROM messages WHERE owner_id=? AND id=?', owner, messageId)) throw new NotFoundException('Answer not found.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BadRequestException('History limit must be 1-50.');
    // Sequence is immutable and indexed by owner/message. Bind cursors to this answer.
    const before = readHistoryCursor(cursor);
    if (before && before[1] !== messageId) throw new BadRequestException('History cursor belongs to another answer.');
    const rows = await this.all(`SELECT sequence,result,source_revision,reason,created_at FROM answer_versions
      WHERE owner_id=? AND message_id=? ${before ? 'AND sequence<?' : ''} ORDER BY sequence DESC LIMIT ?`,
      owner, messageId, ...(before ? [before[0]] : []), limit + 1);
    const items = rows.slice(0, limit).map(row => ({ sequence: Number(row.sequence), result: JSON.parse(String(row.result)), sourceRevision: Number(row.source_revision), reason: row.reason, createdAt: Number(row.created_at) }));
    return { items, nextCursor: rows.length > limit ? historyCursor(items[items.length - 1].sequence, messageId) : null };
  }
  async answerVersions(owner: string, messageId: string) {
    if (!await this.get('SELECT id FROM messages WHERE owner_id=? AND id=?', owner, messageId)) throw new NotFoundException('Answer not found.');
    return (await this.all('SELECT sequence,result,source_revision,reason,created_at FROM answer_versions WHERE owner_id=? AND message_id=? ORDER BY sequence', owner, messageId))
      .map(row => ({ sequence: Number(row.sequence), result: JSON.parse(String(row.result)), sourceRevision: Number(row.source_revision), reason: row.reason, createdAt: Number(row.created_at) }));
  }
}
