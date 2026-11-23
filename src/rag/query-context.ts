/** Previous answers help resolve references; they are never factual evidence for a new answer. */
import { sourceReference } from './document-scope';
export type ConversationContext = {
  sourceQuestions?: string[];
  turns: { question: string; answer: string }[];
  citations: { documentId: string; source: string; version?: string }[];
};
export function asksInventory(question: string) {
  return /\b(?:(?:how many|number of)\s+(?:uploaded\s+)?|(?:list|which|what)\s+(?:(?:are|is)\s+)?(?:(?:all|the|my|uploaded)\s+)*)(?:documents?|files?|sources?)\b/i.test(question)
    && /\b(?:my (?:workspace|library|documents|files)|uploaded|given here|available here|in (?:the|this) workspace)\b/i.test(question);
}
export function asksProvenance(question: string) {
  return /\b(?:previous answer|last answer|this ans(?:wer)?|that answer|you (?:used|extracted)|u (?:used|extracted|related))\b/i.test(question)
    && /\b(?:why|how|which|where)\b/i.test(question)
    && /\b(?:source|sources|extract\w*|cit\w*|relat\w*|used|from)\b/i.test(question);
}
export function needsConversationContext(question: string) {
  return Boolean(sourceReference(question)) || /\b(?:it|its|they|their|them|person'?s?|this (?:method|paper|model)|that (?:method|paper|model)|previous|last answer|elaborate|tell me more)\b/i.test(question);
}
