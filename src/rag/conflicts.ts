import { createHash } from 'crypto';
import type { AtomicClaim, Verification } from './verification';

type Citation = { index: number; documentId: string; source: string; version?: string; excerpt: string; chunkIndex: number; chunkEndIndex?: number };
export type EvidenceConflict = {
  id: string; messageId: string; conversationId: string; question: string; detectedAt: string;
  claim: string; status: 'UNRESOLVED'; scope: AtomicClaim['scope']; temporalValidity: AtomicClaim['temporalValidity'];
  supporting: (Citation & { quote: string })[]; contradicting: (Citation & { quote: string })[];
  reason: string;
};
export function answerConflicts(message: { id: string; conversationId: string; question: string; createdAt: number }, result: { factCheck?: Verification; citations?: Citation[] }): EvidenceConflict[] {
  const citations = result.citations || [];
  return (result.factCheck?.atomicClaims || []).filter(c => c.verdict === 'CONFLICTED').flatMap(claim => {
    const references = (quotes: AtomicClaim['supporting']) => quotes.flatMap(q => {
      const source = citations.find(c => c.index === q.index);
      return source && source.excerpt.includes(q.quote) ? [{ ...source, quote: q.quote }] : [];
    });
    const supporting = references(claim.supporting), contradicting = references(claim.contradicting);
    if (!supporting.length || !contradicting.length) return [];
    return [{ id: createHash('sha256').update(message.id + ':' + claim.id).digest('hex'), messageId: message.id, conversationId: message.conversationId, question: message.question, detectedAt: new Date(message.createdAt).toISOString(), claim: claim.text, status: 'UNRESOLVED' as const, scope: claim.scope, temporalValidity: claim.temporalValidity, supporting, contradicting, reason: 'The answer verifier found conflicting evidence. No source precedence has been established; human review is required.' }];
  });
}
