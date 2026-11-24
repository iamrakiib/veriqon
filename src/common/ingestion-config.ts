import { createHash } from 'node:crypto';

/** Shared parser/indexer bounds. Larger documents use the durable upload queue. */
export const MAX_DOCUMENT_CHARACTERS = 500_000;
export const SYNC_DOCUMENT_CHARACTERS = 100_000;
export const MAX_DOCUMENT_CHUNKS = 1000;

export function boundedInteger(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}

export function embeddingSettings() {
  const model = process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small';
  const documentType = process.env.EMBEDDING_DOCUMENT_INPUT_TYPE?.trim() || undefined;
  const queryType = process.env.EMBEDDING_QUERY_INPUT_TYPE?.trim() || undefined;
  const endpoint = (process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const endpointVersion = endpoint === 'https://openrouter.ai/api/v1' ? '' : `|endpoint:${createHash('sha256').update(endpoint).digest('hex').slice(0, 16)}`;
  if (Boolean(documentType) !== Boolean(queryType) || [documentType, queryType].some(v => v && !/^[a-z_]{1,40}$/.test(v))) {
    throw new Error('Configure both EMBEDDING_DOCUMENT_INPUT_TYPE and EMBEDDING_QUERY_INPUT_TYPE, or neither.');
  }
  const chunkSize = boundedInteger('CHUNK_SIZE', 800, 200, 4000);
  const overlap = boundedInteger('CHUNK_OVERLAP', 120, 0, Math.floor(chunkSize / 2));
  return { model, documentType, queryType, chunkSize, overlap,
    batchSize: boundedInteger('EMBEDDING_BATCH_SIZE', 8, 1, 32),
    // A conservative free-model default, not a promise about the provider's actual quota.
    minIntervalMs: boundedInteger('EMBEDDING_MIN_INTERVAL_MS', model.endsWith(':free') ? 3000 : 0, 0, 60000),
    // Never compare query vectors with documents created using another input mode.
    identity: model + endpointVersion + (documentType ? `|input:${documentType}/${queryType}` : '') };
}
