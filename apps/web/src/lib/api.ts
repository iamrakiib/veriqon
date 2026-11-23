import type { Conversation, Message } from "../components/chat-panel";
import { sessionFetch } from "./session";
export type SourceMetadata = { publishedAt?: string; effectiveFrom?: string; effectiveTo?: string; scope?: string; authority?: string; supersedes?: string };
export type DocumentRecord = {
  id: string;
  text: string;
  chunkCount: number;
  source?: string;
  page?: number;
  version?: string;
  hasOriginal?: boolean;
};
export type Citation = {
  metadata?: SourceMetadata;
  relations?: { claim: string; relationship: "supporting" | "contradicting" }[];
  index: number;
  documentId: string;
  source: string;
  version?: string;
  page?: number;
  chunkIndex: number;
  chunkEndIndex?: number;
  excerpt: string;
};
export const citationChunkLabel = (citation: Citation) =>
  citation.chunkEndIndex !== undefined &&
  citation.chunkEndIndex > citation.chunkIndex
    ? `Chunks ${citation.chunkIndex + 1}–${citation.chunkEndIndex + 1}`
    : `Chunk ${citation.chunkIndex + 1}`;
export type QueryResult = {
  answerOrigin?: "workspace_metadata" | "saved_provenance";
  contextUsed?: boolean;
  retrievalMode?: "hybrid" | "lexical_fallback";
  draft: string;
  status: "supported" | "repaired" | "abstained";
  verificationStatus?:
    | "VERIFIED_UNCHANGED"
    | "REPAIRED_VERIFIED"
    | "PARTIALLY_VERIFIED"
    | "INSUFFICIENT_EVIDENCE"
    | "UNRESOLVED_CONFLICT"
    | "VERIFICATION_FAILED";
  retrievalRounds?: number;
  claimsChecked?: number;
  claimsSupported?: number;
  claimsUnresolved?: number;
  promptVersion?: string;
  repairHistory?: {
    original: string;
    revised?: string;
    accepted: boolean;
    reason: string;
    edits?: {
      claimId: string;
      original: string;
      replacement: string;
      evidence: { index: number; quote: string }[];
    }[];
    after?: { passed: boolean; verdict: string };
  }[];
  modelUsage?: {
    stage: string;
    model: string;
    durationMs: number;
    success: boolean;
    promptTokens: number | null;
    completionTokens: number | null;
  }[];
  apiCost?: number | null;
  factCheck: {
    verdict: string;
    evidence: string;
    passed: boolean;
    failure?: {
      stage: "decomposition" | "verification";
      code: "invalid_response" | "timeout" | "provider_error";
      retryable: boolean;
    };
    claims: {
      sentence: string;
      supported: boolean;
      evidenceIndexes: number[];
    }[];
    atomicClaims?: {
      id: string;
      text: string;
      verdict: string;
      supporting: { index: number; quote: string }[];
      contradicting: { index: number; quote: string }[];
    }[];
  };
  citations: Citation[];
  attempts: number;
  durationMs: number;
  cached?: boolean;
  cache?: {
    kind: "exact" | "semantic" | "miss";
    matchedQuestion?: string;
    similarity?: number;
    ageMs?: number;
    lookupMs: number;
    reason?: string;
    policyVersion: string;
  };
  sourceRevision?: number;
  sourcesChanged?: boolean;
  reason?: "no_documents" | "insufficient_context" | "verification_failed" | "generation_failed" | "source_selection_required";
  documentScope?: string[];
  correction: { original: string; revised: string; reason: string } | null;
};
export type Health = {
  status: string;
  providerConfigured: boolean;
  storage: string;
  capabilities?: { durableUploads?: boolean };
};
export type IngestionJob = {
  id: string; documentId: string; source: string;
  status: "queued" | "processing" | "retry_wait" | "failed" | "completed";
  totalChunks: number; completedChunks: number; attempts: number; error?: string; nextAt: number;
};

export const hasRepairAttempt = (result?: QueryResult) => Boolean(result && !result.cached && (result.repairHistory?.length || result.correction));

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  try {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData))
      headers.set("Content-Type", "application/json");
    const response = await sessionFetch(`/api/rag/${path}`, {
      ...options,
      headers,
      signal: options.signal || AbortSignal.timeout(180000),
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.message;
      throw new Error(
        Array.isArray(message)
          ? message.join(". ")
          : typeof message === "string"
            ? message
            : "The API is unavailable. Check that the NestJS server is running.",
      );
    }
    if (data === null)
      throw new Error(
        "The API returned an invalid response. Refresh and try again.",
      );
    return data as T;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    )
      throw new Error(
        path === "query"
          ? "The answer timed out. Please retry, or select a faster model in the server configuration."
          : "The request timed out. Refresh the library before retrying an upload.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Could not connect to the API. Check that the server is running and retry.",
      );
    throw error instanceof Error
      ? error
      : new Error("Could not connect to the API.");
  }
}

export const api = {
  uploads: (signal?: AbortSignal) => request<IngestionJob[]>("uploads", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }),
  retryUpload: (id: string) => request<IngestionJob>(`uploads/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  discardUpload: (id: string) => request<{ success: boolean }>(`uploads/${encodeURIComponent(id)}`, { method: "DELETE" }),
  queueUpload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<IngestionJob>("uploads", { method: "POST", body });
  },
  savedAnswer: (id: string) => request<{ conversationId: string; title: string; message: Message }>(`messages/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10000) }),
  documents: (signal?: AbortSignal) => request<DocumentRecord[]>("docs", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : undefined }),
  health: (signal?: AbortSignal) =>
    request<Health>("health", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }),
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ success: boolean; id: string }>("upload", {
      method: "POST",
      body,
    });
  },
  add: (document: { id: string; text: string; source: string }) =>
    request<{ success: boolean }>("add", {
      method: "POST",
      body: JSON.stringify(document),
    }),
  conversations: (before?: string) => request<Conversation[]>(`conversations${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  olderMessages: (id: string, before?: string) => request<{ messages: Message[]; olderMessagesCursor: string | null }>(`conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  query: (query: string, conversationId?: string, messageId?: string) =>
    request<QueryResult>("query", {
      method: "POST",
      body: JSON.stringify({ query, conversationId, messageId }),
    }),
  removeDocument: (id: string) =>
    request<{ success: boolean }>(`docs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  download: async (id: string, name: string) => {
    const response = await sessionFetch(
      `/api/rag/docs/${encodeURIComponent(id)}/file`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok)
      throw new Error(
        "The original file could not be downloaded. Please sign in again and retry.",
      );
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

/** Presentation-only provenance, derived from recorded claim assessments. */
export function citationWithAssessment(
  citation: Citation,
  result?: QueryResult,
): Citation {
  return {
    ...citation,
    relations:
      result?.factCheck.atomicClaims?.flatMap((claim) => [
        ...(claim.supporting.some((q) => q.index === citation.index)
          ? [{ claim: claim.text, relationship: "supporting" as const }]
          : []),
        ...(claim.contradicting.some((q) => q.index === citation.index)
          ? [{ claim: claim.text, relationship: "contradicting" as const }]
          : []),
      ]) || [],
  };
}
