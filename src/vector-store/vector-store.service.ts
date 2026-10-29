import { Injectable, Logger, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import OpenAI from 'openai';
import { cosineSim, chunkText } from '../common/utils';
import { providerClient, providerError, requireProvider, withProviderRetry } from '../common/provider';
import { createHash } from 'crypto';
import { DatabaseService, OriginalFile, StoredChunk } from '../database/database.service';

type Chunk = StoredChunk;

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
  private readonly embeddingModel = process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small';
  private readonly queryVectors = new Map<string, { vector: number[]; expires: number }>();
  constructor(private readonly database: DatabaseService) { this.client = providerClient(); }
  private owner(ownerId?: string) {
    if (!ownerId) throw new UnauthorizedException('Sign in to access documents.');
    return ownerId;
  }
  revision(ownerId: string) { return this.database.revision(this.owner(ownerId)); }

  async getEmbeddings(texts: string[], signal = AbortSignal.timeout(90000)): Promise<number[][]> {
    requireProvider();
    const vectors: number[][] = [];
    try {
      for (let offset = 0; offset < texts.length; offset += 32) {
        const input = texts.slice(offset, offset + 32);
        const result = await withProviderRetry(() => this.client.embeddings.create({ model: this.embeddingModel, input }, { signal }), signal);
        const batch = [...result.data].sort((a, b) => a.index - b.index);
        if (batch.length !== input.length || batch.some((item, index) => item.index !== index || !item.embedding?.length || item.embedding.some(v => !Number.isFinite(v)) || !item.embedding.some(v => v !== 0))) throw new Error('Invalid embeddings');
        vectors.push(...batch.map(item => item.embedding));
      }
      if (vectors.some(vector => vector.length !== vectors[0].length)) throw new Error('Inconsistent embedding dimensions');
      return vectors;
    } catch (error) { throw providerError(error, 'Document embedding failed'); }
  }

  async getEmbedding(text: string, signal?: AbortSignal): Promise<number[]> {
    try {
      if (!text || text.trim().length === 0) {
        throw new BadRequestException('Text for embedding cannot be empty');
      }
      return (await this.getEmbeddings([text], signal))[0];
    } catch (error: any) {
      this.logger.error('Embedding provider request failed');
      throw providerError(error, 'Embedding failed');
    }
  }

  async addDocument(id: string, text: string, meta?: { source?: string; page?: number; version?: string }, ownerId?: string, file?: OriginalFile) {
    const owner = this.owner(ownerId);
    if (!id?.trim() || !text?.trim() || text.length > 100000) throw new BadRequestException('Document ID and readable text are required (up to 100,000 characters).');
    meta = { ...meta, version: meta?.version || 'sha256:' + createHash('sha256').update(text).digest('hex') };
    try {
      const existing = await this.database.get('SELECT text,source,page,version,embedding_model FROM documents WHERE owner_id=? AND id=?', owner, id);
      if (existing && existing.text === text && existing.embedding_model === this.embeddingModel && (existing.source ?? undefined) === meta?.source && (existing.page ?? undefined) === meta?.page && (existing.version ?? undefined) === meta?.version) {
        if (file) await this.database.attachOriginal(owner, id, text, file);
        return;
      }

      await this.database.preflightDocument(owner, id, text, file);
      const pieces = chunkText(text, parseInt(process.env.CHUNK_SIZE || '800'), parseInt(process.env.CHUNK_OVERLAP || '120'));
      const chunks: Chunk[] = [];
      const embeddings = await this.getEmbeddings(pieces);
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
      await this.database.writeDocument(owner, { id, text, embeddingModel: this.embeddingModel, chunks }, file);
      this.logger.log(`Document added: ${id}`);
    } catch (error: any) {
      this.logger.error('Document indexing failed');
      throw error;
    }
  }

  async bulkAdd(docs: { id: string; text: string; source?: string; page?: number; version?: string }[], ownerId?: string) {
    this.owner(ownerId);
    this.logger.log(`Bulk adding ${docs.length} documents...`);
    let successCount = 0;
    const errors: { id: string; error: string }[] = [];

    for (const d of docs) {
      try {
        await this.addDocument(d.id, d.text, { source: d.source, page: d.page, version: d.version }, ownerId);
        successCount++;
      } catch (error: any) {
        errors.push({ id: d.id, error: providerError(error, 'Document could not be indexed').message });
      }
    }

    this.logger.log(`Bulk add completed: ${successCount}/${docs.length} successful`);
    if (errors.length > 0) {
      this.logger.warn(`Failed documents: ${JSON.stringify(errors)}`);
    }
    return { success: errors.length === 0, count: successCount, errors };
  }

  async search(query: string, topK = 5, signal?: AbortSignal, ownerId?: string) {
    const owner = this.owner(ownerId);
    try {
      if (!await this.database.get('SELECT id FROM documents WHERE owner_id=? LIMIT 1', owner)) {
        this.logger.warn('No documents in store');
        return [];
      }

      const key = createHash('sha256').update(owner).update('\0').update(query.trim()).digest('hex');
      const cached = this.queryVectors.get(key);
      const qVec = cached && cached.expires > Date.now() ? cached.vector : await this.getEmbedding(query, signal);
      if (this.queryVectors.size >= 128) this.queryVectors.delete(this.queryVectors.keys().next().value!);
      this.queryVectors.set(key, { vector: qVec, expires: Date.now() + 10 * 60000 });
      const records = await this.database.candidateDocuments(owner, qVec, this.embeddingModel, topK, query);
      if (records.some(d => (d.embeddingModel && d.embeddingModel !== this.embeddingModel) || d.chunks.some(c => c.embedding.length !== qVec.length))) {
        throw new BadRequestException('The embedding model changed. Re-upload the documents with the current EMBEDDING_MODEL before querying them.');
      }
      const scoredChunks: { id: string; text: string; score: number; source?: string; page?: number; version?: string; chunkIndex: number }[] = [];
      for (const d of records) {
        for (const c of d.chunks) {
          const score = cosineSim(qVec, c.embedding);
          scoredChunks.push({ id: d.id, text: c.content, score, source: c.source, page: c.page, version: c.version, chunkIndex: c.index });
        }
      }
      scoredChunks.sort((a, b) => b.score - a.score);
      // Reciprocal-rank fusion keeps retrieval scores separate from factual support.
      const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(t => !['the','and','was','were','what','how','does','this','that','with','from','for','are','can','has','have','which'].includes(t));
      const lexical = scoredChunks.map(chunk => ({ chunk, hits: terms.filter(term => chunk.text.toLowerCase().includes(term)).length })).filter(c => c.hits > 0).sort((a, b) => b.hits - a.hits);
      const fusion = new Map(scoredChunks.map((chunk, rank) => [chunk, 1 / (60 + rank + 1)]));
      lexical.forEach(({ chunk }, rank) => fusion.set(chunk, fusion.get(chunk)! + 1 / (60 + rank + 1)));
      scoredChunks.sort((a, b) => fusion.get(b)! - fusion.get(a)!);
      const passages: (typeof scoredChunks[number] & { chunkEndIndex: number })[] = [];
      const covered = new Set<string>();
      let characters = 0;
      for (const seed of scoredChunks) {
        if (passages.length >= topK) break;
        if (covered.has(`${seed.id}:${seed.chunkIndex}`)) continue;
        const document = records.find(d => d.id === seed.id)!;
        const window = document.chunks.filter(c => Math.abs(c.index - seed.chunkIndex) <= 2 && !covered.has(`${seed.id}:${c.index}`)).sort((a, b) => a.index - b.index);
        // Never join across a gap caused by a previously selected window.
        const center = window.findIndex(c => c.index === seed.chunkIndex);
        let start = center, end = center;
        while (start > 0 && window[start - 1].index === window[start].index - 1) start--;
        while (end + 1 < window.length && window[end + 1].index === window[end].index + 1) end++;
        let context = window.slice(start, end + 1);
        let text = joinPassages(context.map(c => c.content));
        if (characters + text.length > 18000) {
          context = [window[center]]; text = seed.text;
          if (characters + text.length > 18000) continue;
        }
        passages.push({ ...seed, text, chunkIndex: context[0].index, chunkEndIndex: context[context.length - 1].index });
        context.forEach(c => covered.add(`${seed.id}:${c.index}`));
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
        version: d.version ? String(d.version) : undefined, page: d.page ? Number(d.page) : undefined,
        createdAt: Number(d.createdAt), chunkCount: Number(d.chunkCount), hasOriginal: Boolean(d.hasOriginal)
      }));
  }
  async getOriginal(ownerId: string, id: string) {
    const row = await this.database.get('SELECT original_file,original_name,original_mime FROM documents WHERE owner_id=? AND id=?', this.owner(ownerId), id);
    if (!row?.original_file) throw new NotFoundException('Original file is unavailable. Older imports retain extracted text only.');
    return { bytes: Buffer.from(row.original_file as Uint8Array), name: String(row.original_name), mime: String(row.original_mime) };
  }
}
