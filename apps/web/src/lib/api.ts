import type { Conversation } from '../components/chat-panel';
import { sessionFetch } from './session';
export type DocumentRecord = { id: string; text: string; chunkCount: number; source?: string; page?: number; version?: string; hasOriginal?: boolean };
export type Citation = { index: number; documentId: string; source: string; version?: string; page?: number; chunkIndex: number; chunkEndIndex?: number; excerpt: string };
export const citationChunkLabel = (citation: Citation) => citation.chunkEndIndex !== undefined && citation.chunkEndIndex > citation.chunkIndex
  ? `Chunks ${citation.chunkIndex + 1}–${citation.chunkEndIndex + 1}` : `Chunk ${citation.chunkIndex + 1}`;
export type QueryResult = {
  draft: string;
  status: 'supported' | 'repaired' | 'abstained';
  verificationStatus?: 'VERIFIED_UNCHANGED' | 'REPAIRED_VERIFIED' | 'PARTIALLY_VERIFIED' | 'INSUFFICIENT_EVIDENCE' | 'UNRESOLVED_CONFLICT' | 'VERIFICATION_FAILED';
  retrievalRounds?: number;
  claimsChecked?: number;
  claimsSupported?: number;
  claimsUnresolved?: number;
  promptVersion?: string;
  repairHistory?: { original: string; revised?: string; accepted: boolean; reason: string }[];
  factCheck: { verdict: string; evidence: string; passed: boolean; claims: { sentence: string; supported: boolean; evidenceIndexes: number[] }[] };
  citations: Citation[];
  attempts: number;
  durationMs: number;
  cached?: boolean;
  sourceRevision?: number;
  sourcesChanged?: boolean;
  reason?: 'no_documents' | 'insufficient_context' | 'verification_failed';
  correction: { original: string; revised: string; reason: string } | null;
};
export type Health = { status: string; providerConfigured: boolean; storage: string };

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await sessionFetch(`/api/rag/${path}`, { ...options, headers, signal: options.signal || AbortSignal.timeout(180000), cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.message;
      throw new Error(Array.isArray(message) ? message.join('. ') : typeof message === 'string' ? message : 'The API is unavailable. Check that the NestJS server is running.');
    }
    if (data === null) throw new Error('The API returned an invalid response. Refresh and try again.');
    return data as T;
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new Error(path === 'query' ? 'The answer timed out. Please retry, or select a faster model in the server configuration.' : 'The request timed out. Refresh the library before retrying an upload.');
    if (error instanceof TypeError) throw new Error('Could not connect to the API. Check that the server is running and retry.');
    throw error instanceof Error ? error : new Error('Could not connect to the API.');
  }
}

export const api = {
  documents: () => request<DocumentRecord[]>('docs'),
  health: () => request<Health>('health', { signal: AbortSignal.timeout(10000) }),
  upload: (file: File) => {
    const body = new FormData(); body.append('file', file);
    return request<{ success: boolean; id: string }>('upload', { method: 'POST', body });
  },
  add: (document: { id: string; text: string; source: string }) => request<{ success: boolean }>('add', { method: 'POST', body: JSON.stringify(document) }),
  conversations: () => request<Conversation[]>('conversations'),
  query: (query: string, conversationId?: string, messageId?: string) => request<QueryResult>('query', { method: 'POST', body: JSON.stringify({ query, conversationId, messageId }) }),
  removeDocument: (id: string) => request<{ success: boolean }>(`docs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  download: async (id: string, name: string) => {
    const response = await sessionFetch(`/api/rag/docs/${encodeURIComponent(id)}/file`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('The original file could not be downloaded. Please sign in again and retry.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
