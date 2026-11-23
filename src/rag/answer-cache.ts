import { cosineSim } from '../common/utils';
import { quantities, quantityUnits } from './verification';

export const CACHE_POLICY_VERSION = 'semantic-v2-numeric-units';
export function semanticCacheConfig() {
  const number = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(process.env[name] || fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    return value;
  };
  return {
    enabled: process.env.SEMANTIC_CACHE_ENABLED !== 'false',
    threshold: number('SEMANTIC_CACHE_THRESHOLD', 0.92, 0.8, 1),
    timeoutMs: Math.floor(number('SEMANTIC_CACHE_TIMEOUT_MS', 8000, 1000, 15000)),
    ttlMs: Math.floor(number('ANSWER_CACHE_TTL_MS', 300000, 1000, 900000)),
    maxEntries: Math.floor(number('ANSWER_CACHE_MAX_ENTRIES', 100, 1, 1000)),
  };
}

/** Conservative prefilter, not a semantic equivalence decision. */
export function compatibleQuestionScope(a: string, b: string) {
  const signature = (query: string) => ({
    quantities: quantities(query.replace(/[\[\]]/g, '')),
    quantityUnits: quantityUnits(query).sort(),
    negated: /\b(not|never|without|except|exclude|excluding|cannot|can't|don't|doesn't|isn't)\b/i.test(query),
    temporal: /\b(today|yesterday|tomorrow)\b/i.exec(query)?.[0].toLowerCase()
      || (/\b(current|currently|latest|now)\b/i.test(query) ? 'current' : 'unspecified'),
  });
  // Follow-ups need conversation context, which the current query contract does not include.
  const contextual = /\b(it|they|them|those|that one|this one|previous answer|above)\b/i;
  return !contextual.test(a) && !contextual.test(b) && JSON.stringify(signature(a)) === JSON.stringify(signature(b));
}

export function parseCacheEquivalence(raw: string): boolean {
  try {
    const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    const keys = ['equivalent', 'sameScope', 'sameAnswerRequirements'];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === keys.length && keys.every(key => value[key] === true);
  } catch { return false; }
}

export type CacheEntry<T> = { key: string; namespace: string; question: string; vector?: number[]; createdAt: number; expires: number; result: T };

/** Bounded per-process cache. Never searches across authorization/configuration namespaces. */
export class AnswerCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  constructor(private readonly clock: () => number = Date.now) {}
  private prune() { for (const [key, entry] of this.entries) if (entry.expires <= this.clock()) this.entries.delete(key); }
  exact(key: string) { this.prune(); return this.entries.get(key); }
  hasCandidates(namespace: string, question: string) {
    this.prune();
    return [...this.entries.values()].some(e => e.namespace === namespace && e.vector && compatibleQuestionScope(e.question, question));
  }
  nearest(namespace: string, question: string, vector: number[], threshold: number) {
    this.prune();
    if (!vector.length || vector.some(n => !Number.isFinite(n)) || !vector.some(n => n !== 0)) return undefined;
    return [...this.entries.values()]
      .filter(e => e.namespace === namespace && e.vector?.length === vector.length && compatibleQuestionScope(e.question, question))
      .map(entry => ({ entry, similarity: cosineSim(vector, entry.vector!) }))
      .filter(c => Number.isFinite(c.similarity) && c.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)[0];
  }
  put(key: string, namespace: string, question: string, result: T, vector: number[] | undefined, ttlMs: number, maxEntries: number) {
    this.prune(); this.entries.delete(key);
    while (this.entries.size >= maxEntries) this.entries.delete(this.entries.keys().next().value!);
    const valid = vector?.length && vector.every(Number.isFinite) && vector.some(n => n !== 0);
    this.entries.set(key, { key, namespace, question, result: structuredClone(result), vector: valid ? [...vector!] : undefined, createdAt: this.clock(), expires: this.clock() + ttlMs });
  }
}
