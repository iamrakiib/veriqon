import { Injectable, Logger, BadRequestException, UnauthorizedException, NotFoundException, HttpException } from '@nestjs/common';
import OpenAI from 'openai';
import { cosineSim, chunkText, lexicalTerms } from '../common/utils';
import { providerClient, providerError, requireProvider, withProviderRetry } from '../common/provider';
import { createHash } from 'crypto';
import { DatabaseService, OriginalFile, StoredChunk } from '../database/database.service';
import { embeddingSettings, MAX_DOCUMENT_CHARACTERS, MAX_DOCUMENT_CHUNKS } from '../common/ingestion-config';
import { resolveDocumentScope } from '../rag/document-scope';
import { EmbeddingPacer } from '../common/embedding-pacer';
import { applicable, fullyApplicable, sourceInspectionRequested, temporalScope, type SourceMetadata } from '../rag/temporal';

type Chunk = StoredChunk;
export type IndexCheckpoint = {
  vectors: number[][];
  beforeBatch?: (offset: number) => void;
  save: (offset: number, vectors: number[][]) => Promise<void>;
  commit: (publish: () => Promise<void>) => Promise<void>;
};

export function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16384
    && value.every(v => typeof v === 'number' && Number.isFinite(v)) && value.some(v => v !== 0);
}
function invalidEmbeddings() {
  return Object.assign(new HttpException('Document embedding failed: The provider returned invalid vectors. Check embedding model compatibility before retrying.', 502), { retryable: false });
}

/** An explicit, unambiguous filename token scopes retrieval; vague "my paper" does not. */
export function namedDocumentIds(query: string, documents: { id: string; source?: string }[]): string[] | undefined {
  const scope = resolveDocumentScope(query, documents);
  if (scope.issue) throw new BadRequestException(scope.issue);
  return scope.ids;
}

// Preserve the continuation of a retrieved passage without duplicating chunk overlap.
export function joinPassages(pieces: string[]) {
  return pieces.reduce((text, next) => {
    if (!text) return next;
    let overlap = Math.min(text.length, next.length, 400);
    while (overlap > 0 && text.slice(-overlap) !== next.slice(0, overlap)) overlap--;
    return text + (overlap ? '' : '\n') + next.slice(overlap);
  }, '');
}

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private client: OpenAI;
  readonly embeddingConfig = embeddingSettings();
  private readonly embeddingModel = this.embeddingConfig.identity;
  private readonly queryVectors = new Map<string, { vector: number[]; expires: number }>();
  private readonly pacer: EmbeddingPacer;
  constructor(private readonly database: DatabaseService) {
    this.client = providerClient();
    this.pacer = new EmbeddingPacer(database, this.embeddingConfig.minIntervalMs, this.embeddingConfig.model);
  }
  private owner(ownerId?: string) {
    if (!ownerId) throw new UnauthorizedException('Sign in to access documents.');
    return ownerId;
  }
  revision(ownerId: string) { return this.database.revision(this.owner(ownerId)); }
  reviewDecisions(ownerId: string, sources?: {id:string;version?:string;snapshotId?:string}[]) {
    return this.database.reviewDecisions(this.owner(ownerId),sources?.map(s=>({documentId:s.id,version:s.version,snapshotId:s.snapshotId})));
  }
  conversationContext(ownerId: string, conversationId: string) { return this.database.conversationContext(this.owner(ownerId), conversationId); }
  async inventory(ownerId: string) {
    return (await this.database.all('SELECT id,source FROM documents WHERE owner_id=? ORDER BY created_at,id', this.owner(ownerId)))
      .map(d => ({ id: String(d.id), source: d.source ? String(d.source) : String(d.id) }));
  }

  private queryKey(query: string, ownerId: string) {
    return createHash('sha256').update(this.owner(ownerId)).update('\0').update(query.trim()).digest('hex');
  }
  cachedQueryEmbedding(query: string, ownerId: string): number[] | undefined {
    const cached = this.queryVectors.get(this.queryKey(query, ownerId));
    return cached && cached.expires > Date.now() ? [...cached.vector] : undefined;
  }
  async queryEmbedding(query: string, ownerId: string, signal?: AbortSignal): Promise<number[]> {
    const cached = this.cachedQueryEmbedding(query, ownerId);
    if (cached) return cached;
    const vector = await this.getEmbedding(query, signal);
    if (this.queryVectors.size >= 128) this.queryVectors.delete(this.queryVectors.keys().next().value!);
    this.queryVectors.set(this.queryKey(query, ownerId), { vector: [...vector], expires: Date.now() + 10 * 60000 });
    return vector;
  }

  async getEmbeddings(texts: string[], signal = AbortSignal.timeout(90000), checkpoint?: IndexCheckpoint, purpose: 'document' | 'query' = 'document'): Promise<number[][]> {
    const vectors: number[][] = checkpoint?.vectors.map(v => [...v]) || [];
    if (vectors.length > texts.length || vectors.some(v => !validVector(v) || v.length !== vectors[0].length)) throw new BadRequestException('Invalid indexing checkpoint. Discard this upload and upload the file again.');
    try {
      if (vectors.length < texts.length) requireProvider();
      if (texts.some(text => typeof text !== 'string' || !text.trim())) throw new BadRequestException('Text for embedding cannot be empty');
      for (let offset = vectors.length; offset < texts.length; offset += this.embeddingConfig.batchSize) {
        signal.throwIfAborted();
        checkpoint?.beforeBatch?.(offset);
        const input = texts.slice(offset, offset + this.embeddingConfig.batchSize);
        const inputType = purpose === 'query' ? this.embeddingConfig.queryType : this.embeddingConfig.documentType;
        const result = await withProviderRetry(async () => {
          await this.pacer.acquire(signal);
          try {
          const result = await this.client.embeddings.create({ model: this.embeddingConfig.model, input, encoding_format: 'float',
            ...(inputType ? { input_type: inputType } : {}) }, { signal });
          // Some compatible gateways return an error envelope with HTTP 200.
          const embeddedError = (result as unknown as { error?: { code?: unknown } })?.error;
          if (embeddedError) throw Object.assign(new Error('Embedding gateway error'), { status: typeof embeddedError.code === 'number' ? embeddedError.code : 502 });
          return result;
          } catch (error) { await this.pacer.recordLimit(error); throw error; }
        }, signal, false); // Durable scheduling owns rate-limit retries; do not turn a real failure into a free pause.
        signal.throwIfAborted();
        if (!Array.isArray(result?.data)) throw invalidEmbeddings();
        const batch = [...result.data].sort((a, b) => a.index - b.index);
        const dimensions = vectors[0]?.length ?? batch[0]?.embedding?.length;
        if (batch.length !== input.length || batch.some((item, index) => item.index !== index || !validVector(item.embedding) || item.embedding.length !== dimensions)) throw invalidEmbeddings();
        await checkpoint?.save(offset, batch.map(item => item.embedding));
        vectors.push(...batch.map(item => item.embedding));
      }
      if (vectors.some(vector => vector.length !== vectors[0].length)) throw invalidEmbeddings();
      return vectors;
    } catch (error) { throw providerError(error, 'Document embedding failed'); }
  }

  async getEmbedding(text: string, signal?: AbortSignal): Promise<number[]> {
    try {
      if (!text || text.trim().length === 0) {
        throw new BadRequestException('Text for embedding cannot be empty');
      }
      return (await this.getEmbeddings([text], signal, undefined, 'query'))[0];
    } catch (error: any) {
      this.logger.error('Embedding provider request failed');
      throw providerError(error, 'Embedding failed');
    }
  }

  async addDocument(id: string, text: string, meta?: { source?: string; page?: number; version?: string }, ownerId?: string, file?: OriginalFile, signal = AbortSignal.timeout(90000), checkpoint?: IndexCheckpoint) {
    const owner = this.owner(ownerId);
    signal.throwIfAborted();
    if (!id?.trim() || !text?.trim() || text.length > MAX_DOCUMENT_CHARACTERS) throw new BadRequestException('Document ID and readable text are required (up to 500,000 characters).');
    meta = { ...meta, version: meta?.version || 'sha256:' + createHash('sha256').update(text).digest('hex') };
    try {
      const pieces = chunkText(text, this.embeddingConfig.chunkSize, this.embeddingConfig.overlap);
      if (pieces.length > MAX_DOCUMENT_CHUNKS) throw new BadRequestException('This document exceeds 1,000 indexing passages. Split it into smaller documents.');
      const existing = await this.database.get('SELECT text,source,page,version,embedding_model FROM documents WHERE owner_id=? AND id=?', owner, id);
      if (existing && existing.text === text && existing.embedding_model === this.embeddingModel && (existing.source ?? undefined) === meta?.source && (existing.page ?? undefined) === meta?.page && (existing.version ?? undefined) === meta?.version) {
        // Embedding space identity does not include chunk boundaries. Reuse only the
        // exact current passage layout; a changed chunk profile must really reindex.
        const indexed = await this.database.all('SELECT chunk_index,content FROM chunks WHERE owner_id=? AND document_id=? ORDER BY chunk_index', owner, id);
        if (indexed.length === pieces.length && indexed.every((chunk, index) => Number(chunk.chunk_index) === index && chunk.content === pieces[index])) {
          const publish = async () => { if (file) await this.database.attachOriginal(owner, id, text, file); };
          if (checkpoint) await checkpoint.commit(publish); else await publish();
          return;
        }
      }

      await this.database.preflightDocument(owner, id, text, file);
      const chunks: Chunk[] = [];
      const embeddings = await this.getEmbeddings(pieces, signal, checkpoint);
      signal.throwIfAborted();
      for (let i = 0; i < pieces.length; i++) {
        const content = pieces[i];
        const embedding = embeddings[i];
        chunks.push({
          chunkId: `${id}#${i}`,
          content,
          embedding,
          source: meta?.source,
          page: meta?.page,
          version: meta?.version,
          index: i
        });
      }
      const publish = () => this.database.writeDocument(owner, { id, text, embeddingModel: this.embeddingModel, chunks }, file);
      if (checkpoint) await checkpoint.commit(publish); else await publish();
      this.logger.log('Document indexed successfully');
    } catch (error: any) {
      this.logger.error('Document indexing failed');
      throw error;
    }
  }

  async bulkAdd(docs: { id: string; text: string; source?: string; page?: number; version?: string }[], ownerId?: string, signal = AbortSignal.timeout(90000)) {
    this.owner(ownerId);
    this.logger.log(`Bulk adding ${docs.length} documents...`);
    let successCount = 0;
    const errors: { id: string; error: string }[] = [];

    for (const d of docs) {
      try {
        // One budget for the batch, not a fresh 90-second provider wait for
        // every document while the account remains locked against other work.
        signal.throwIfAborted();
        await this.addDocument(d.id, d.text, { source: d.source, page: d.page, version: d.version }, ownerId, undefined, signal);
        successCount++;
      } catch (error: any) {
        errors.push({ id: d.id, error: signal.aborted ? 'The ingestion time budget expired. Retry this document.' : providerError(error, 'Document could not be indexed').message });
      }
    }

    this.logger.log(`Bulk add completed: ${successCount}/${docs.length} successful`);
    if (errors.length > 0) {
      this.logger.warn(`Documents not indexed: ${errors.length}`);
    }
    return { success: errors.length === 0, count: successCount, errors };
  }

  async search(query: string, topK = 5, signal?: AbortSignal, ownerId?: string, requestedDocuments?: string[], time = temporalScope(query), sourceQuestion = query) {
    const owner = this.owner(ownerId);
    try {
      const library = await this.database.all('SELECT id,source FROM documents WHERE owner_id=?', owner);
      if (!library.length) {
        this.logger.warn('No documents in store');
        return [];
      }

      const focus = requestedDocuments ? library.filter(d => requestedDocuments.includes(String(d.id))).map(d => String(d.id))
        : namedDocumentIds(query, library.map(d => ({ id: String(d.id), source: d.source ? String(d.source) : undefined })));
      if (focus && !focus.length) return [];
      topK = Math.min(10, Math.max(topK, focus?.length || 0));
      const metadata = await this.database.metadataMap(owner);
      // A question explicitly attributing a source may inspect its historical wording.
      // Explicit dates and current-policy questions still apply the validity filter.
      const sourceInspection = Boolean(focus?.length && namedDocumentIds(sourceQuestion, library.map(d => ({ id: String(d.id), source: d.source ? String(d.source) : undefined })))?.length
        && sourceInspectionRequested(sourceQuestion, time));
      const eligible = library.filter(d => sourceInspection || applicable(metadata.get(String(d.id)) || {}, time));
      const historical = sourceInspection ? [] : await this.database.historicalSources(owner,time,focus);
      const scopeKey=(id:string,meta?:SourceMetadata)=>meta?.scope ? JSON.stringify([id,meta.scope.normalize('NFKC').toLowerCase()]) : '';
      const superseded = new Set<string>();
      if (!sourceInspection) for (const meta of [...eligible.map(d=>metadata.get(String(d.id))),...historical.map(d=>d.metadata)]) {
        if (meta?.supersedes && meta.scope && fullyApplicable(meta,time)) superseded.add(scopeKey(meta.supersedes,meta));
      }
      const archived = await this.database.readHistoricalDocuments(owner,historical.filter(d=>(!focus || focus.includes(d.id)) && !superseded.has(scopeKey(d.id,d.metadata))));
      const historicalIds=new Set(historical.map(d=>d.id));
      const allowed = eligible.filter(d => !superseded.has(scopeKey(String(d.id),metadata.get(String(d.id)))) && (!focus || focus.includes(String(d.id)))
        && !(time.kind !== 'current' && !metadata.get(String(d.id))?.effectiveFrom && historicalIds.has(String(d.id)))).map(d => String(d.id));
      const scoped = focus || allowed.length !== library.length ? allowed : undefined;
      if (!allowed.length && !archived.length) return [];
      let qVec: number[] | undefined, embeddingFailure: unknown;
      try { if (allowed.length) qVec = await this.queryEmbedding(query, owner, signal); }
      catch (error) {
        if (signal?.aborted || !(error instanceof HttpException) || ![429,502,503,504].includes(error.getStatus())) throw error;
        embeddingFailure = error;
        this.logger.warn('Semantic search unavailable; attempting authorized lexical retrieval.');
      }
      const records = !allowed.length ? [] : qVec ? await this.database.candidateDocuments(owner, qVec, this.embeddingModel, topK, query, scoped)
        : await this.database.lexicalDocuments(owner, query, topK, scoped);
      if (qVec && records.some(d => (d.embeddingModel && d.embeddingModel !== this.embeddingModel) || d.chunks.some(c => c.embedding.length !== qVec!.length))) {
        throw new BadRequestException('The embedding model changed. Re-upload the documents with the current EMBEDDING_MODEL before querying them.');
      }
      records.push(...archived);
      const scoredChunks: { id: string; text: string; score: number; source?: string; page?: number; version?: string; snapshotId?: string; metadata?: SourceMetadata; chunkIndex: number; retrievalMode: 'hybrid' | 'lexical_fallback' }[] = [];
      for (const d of records) {
        for (const c of d.chunks) {
          const score = qVec && !d.snapshotId ? cosineSim(qVec, c.embedding) : 0;
          scoredChunks.push({ id: d.id, text: c.content, score, source: c.source, page: c.page, version: c.version, snapshotId:d.snapshotId,
            metadata:d.snapshotId?d.metadata:metadata.get(d.id), chunkIndex: c.index, retrievalMode: qVec && !d.snapshotId ? 'hybrid' : 'lexical_fallback' });
        }
      }
      scoredChunks.sort((a, b) => b.score - a.score);
      // Reciprocal-rank fusion keeps retrieval scores separate from factual support.
      const terms = lexicalTerms(query);
      const lexical = scoredChunks.map(chunk => ({ chunk, hits: terms.filter(term => chunk.text.toLowerCase().includes(term)).length })).filter(c => c.hits > 0).sort((a, b) => b.hits - a.hits);
      if (!qVec && !lexical.length && !focus?.length) { if (embeddingFailure) throw embeddingFailure; return []; }
      const fusion = new Map(scoredChunks.map((chunk, rank) => [chunk, qVec && !chunk.snapshotId ? 1 / (60 + rank + 1) : 0]));
      lexical.forEach(({ chunk }, rank) => fusion.set(chunk, fusion.get(chunk)! + 1 / (60 + rank + 1)));
      // For a named paper overview include its opening/abstract, not only dense result snippets.
      if (focus && /\b(about|overview|summari[sz]e|summary|objective)\b/i.test(query)) {
        scoredChunks.filter(c => c.chunkIndex === 0).forEach(c => fusion.set(c, fusion.get(c)! + 1 / 30));
      }
      scoredChunks.sort((a, b) => fusion.get(b)! - fusion.get(a)!);
      // A comparison must represent every selected source before filling remaining slots.
      const representatives = focus && focus.length > 1 ? focus.flatMap(id => {
        const best = scoredChunks.find(chunk => chunk.id === id); return best ? [best] : [];
      }) : [];
      const seeds = [...representatives, ...scoredChunks.filter(chunk => !representatives.includes(chunk))];
      const passages: (typeof scoredChunks[number] & { chunkEndIndex: number })[] = [];
      const covered = new Set<string>();
      let characters = 0;
      for (const seed of seeds) {
        if (!qVec && !focus?.length && !fusion.get(seed)) continue;
        if (passages.length >= topK) break;
        const key = `${seed.id}:${seed.snapshotId || seed.version || ''}`;
        if (covered.has(`${key}:${seed.chunkIndex}`)) continue;
        const document = records.find(d => d.id === seed.id && d.snapshotId === seed.snapshotId)!;
        const window = document.chunks.filter(c => Math.abs(c.index - seed.chunkIndex) <= 2 && !covered.has(`${key}:${c.index}`)).sort((a, b) => a.index - b.index);
        // Never join across a gap caused by a previously selected window.
        const center = window.findIndex(c => c.index === seed.chunkIndex);
        let start = center, end = center;
        while (start > 0 && window[start - 1].index === window[start].index - 1) start--;
        while (end + 1 < window.length && window[end + 1].index === window[end].index + 1) end++;
        let context = window.slice(start, end + 1);
        let text = joinPassages(context.map(c => c.content));
        const reserved = representatives.filter(c => c.id !== seed.id && !passages.some(p => p.id === c.id)).reduce((sum, c) => sum + c.text.length, 0);
        if (characters + text.length + reserved > 18000) {
          context = [window[center]]; text = seed.text;
          if (characters + text.length + reserved > 18000) continue;
        }
        passages.push({ ...seed, text, chunkIndex: context[0].index, chunkEndIndex: context[context.length - 1].index });
        context.forEach(c => covered.add(`${key}:${c.index}`));
        characters += text.length;
      }
      return passages;
    } catch (error: any) {
      this.logger.error('Document search failed');
      throw error;
    }
  }

  async getAllDocs(ownerId?: string) {
    const owner = this.owner(ownerId);
    return (await this.database.all(`SELECT d.id,d.text,d.source,d.version,d.page,d.created_at AS "createdAt",
      (d.original_file IS NOT NULL) AS "hasOriginal", COUNT(c.chunk_index) AS "chunkCount"
      FROM documents d LEFT JOIN chunks c ON c.owner_id=d.owner_id AND c.document_id=d.id
      WHERE d.owner_id=? GROUP BY d.owner_id,d.id ORDER BY d.created_at,d.id`, owner)).map(d => ({
        id: String(d.id), text: String(d.text), source: d.source ? String(d.source) : undefined,
        version: d.version ? String(d.version) : 'sha256:' + createHash('sha256').update(String(d.text)).digest('hex'), page: d.page ? Number(d.page) : undefined,
        createdAt: Number(d.createdAt), chunkCount: Number(d.chunkCount), hasOriginal: Boolean(d.hasOriginal)
      }));
  }
  async getOriginal(ownerId: string, id: string) {
    const row = await this.database.get('SELECT original_file,original_name,original_mime FROM documents WHERE owner_id=? AND id=?', this.owner(ownerId), id);
    if (!row?.original_file) throw new NotFoundException('Original file is unavailable. Older imports retain extracted text only.');
    return { bytes: Buffer.from(row.original_file as Uint8Array), name: String(row.original_name), mime: String(row.original_mime) };
  }
}
