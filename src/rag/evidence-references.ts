import type { Evidence } from './verification';

/** Retry-only source references avoid asking a model to reproduce source typography.
 * These are evidence locations, not entailment labels. All normal verification
 * checks still run after resolving them to exact, version-bound source text.
 */
export function evidenceReferences(docs: Evidence[]) {
  return docs.map((doc, i) => {
    const segments: { quoteId: string; text: string }[] = [];
    for (const { segment } of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(doc.text)) {
      let rest = segment;
      while (rest.length) {
        let end = Math.min(rest.length, 2000);
        if (end < rest.length) {
          const boundary = rest.lastIndexOf(' ', end);
          if (boundary > 1000) end = boundary;
        }
        const text = rest.slice(0, end).trim(); rest = rest.slice(end);
        if (text) segments.push({ quoteId: `${i + 1}:${segments.length + 1}`, text });
      }
    }
    return { index: i + 1, source: doc.source, documentId: doc.id, version: doc.version ?? null, metadata: doc.metadata, segments };
  });
}

/** Only explicit source-reference fields are expanded. Unknown IDs/extra fields
 * fail closed. Exact quotes remain compatible with the original strict contract.
 */
export function resolveAssessmentReferences(raw: string, references: ReturnType<typeof evidenceReferences>): string {
  try {
    const root = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    const expand = (quotes: unknown) => {
      if (!Array.isArray(quotes)) return quotes;
      return quotes.map(q => {
        if (!q || typeof q !== 'object' || !('quoteId' in q)) return q;
        if (Object.keys(q).length !== 2 || !Number.isInteger(q.index) || typeof q.quoteId !== 'string') throw new Error('Invalid reference');
        const source = references[q.index - 1];
        const segment = source?.segments.find(s => s.quoteId === q.quoteId);
        if (!segment) throw new Error('Unknown source reference');
        return { index: q.index, quote: segment.text };
      });
    };
    for (const key of ['claims', 'conflicts']) {
      if (!Array.isArray(root?.[key])) continue;
      for (const item of root[key]) {
        if (!item || typeof item !== 'object') continue;
        if ('supporting' in item) item.supporting = expand(item.supporting);
        if ('contradicting' in item) item.contradicting = expand(item.contradicting);
      }
    }
    return JSON.stringify(root);
  } catch { return raw; } // The original strict parser rejects the unresolved contract.
}
