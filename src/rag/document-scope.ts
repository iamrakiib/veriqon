type Source = { id: string; source?: string };
export type DocumentScope = { ids?: string[]; explicit: boolean; issue?: string };
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const requestsWholeLibrary = (query: string) => /\b(?:all (?:workspace )?(?:documents|files|sources)|(?:across|in) (?:the |my )?(?:whole|entire) (?:library|workspace)|other (?:documents|files|sources))\b/i.test(query);

/** Resolve names only inside an already authorized inventory. Never silently widen a failed filename lookup. */
export function resolveDocumentScope(query: string, documents: Source[]): DocumentScope {
  const text = query.normalize('NFKC').toLowerCase();
  const matches: { start: number; end: number; id: string; exact: boolean }[] = [];
  for (const doc of documents) {
    if (!doc.source) continue;
    const source = doc.source.normalize('NFKC').toLowerCase();
    for (const exact of [true, false]) {
      const pattern = exact ? escape(source) : source.split(/[\s_-]+/).map(escape).join('[\\s_-]+');
      for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_-])${pattern}(?![\\p{L}\\p{N}_-])`, 'gu'))) {
        matches.push({ start: match.index!, end: match.index! + match[0].length, id: doc.id, exact });
      }
    }
  }
  // A longer filename wins over a suffix; exact spelling wins over a separator alias.
  const selected = matches.filter(m => !matches.some(other => other.start <= m.start && other.end >= m.end
    && (other.end - other.start > m.end - m.start || other.exact && !m.exact)));
  const ambiguous = selected.some(m => selected.some(other => m.id !== other.id && m.start < other.end && other.start < m.end));
  if (ambiguous) return { explicit: true, issue: 'More than one uploaded document matches that filename. Use the exact filename shown in your knowledge base, or rename duplicate files.' };
  const extensions = [...text.matchAll(/\.(?:pdf|docx|txt|md|markdown)(?![\p{L}\p{N}_-])/gu)];
  if (extensions.some(m => !selected.some(s => s.start <= m.index! && s.end >= m.index! + m[0].length))) {
    return { explicit: true, issue: 'I could not match every requested filename in your accessible knowledge base. Use the filenames shown there; I have not searched other documents.' };
  }
  const ids = [...new Set(selected.map(m => m.id))];
  if (ids.length > 10 && !requestsWholeLibrary(query)) return { explicit: true, issue: 'Please compare at most ten named files at a time so each source can be represented in the evidence.' };
  if (ids.length) return { ids: requestsWholeLibrary(query) ? undefined : ids, explicit: true };

  // Retain established topic/acronym shortcuts, but do not infer scope from common filename words.
  const words = new Set(text.match(/[a-z0-9]{3,}/g) || []);
  const generic = new Set(['new','final','draft','paper','document','report','copy','version','revised','pdf','docx','txt','markdown','model','method','policy','results','result','accuracy','overview','summary','data','study','research','notes','evaluation','test','work']);
  const inferred = documents.filter(d => {
    if (!d.source) return false;
    const basename = d.source.replace(/\.[^.]+$/, '');
    const originalTokens: string[] = basename.match(/[a-zA-Z0-9]{3,}/g) || [];
    return (basename.toLowerCase().match(/[a-z0-9]{3,}/g) || []).some(word => !generic.has(word) && words.has(word)
      && (word === 'resume' || word === 'cv' || /[a-z]/.test(word) && word.length <= 8 && originalTokens.includes(word.toUpperCase())
        || new RegExp(`\\b${word}\\s+(?:paper|document|file|manuscript)\\b|\\b(?:paper|document|file|manuscript)\\s+(?:called\\s+|named\\s+)?${word}\\b`, 'i').test(query)));
  }).map(d => d.id);
  const openComparison = inferred.length === 1 && /\b(compare|comparison|versus|vs|between)\b/i.test(query);
  return { ids: inferred.length && !requestsWholeLibrary(query) && !openComparison ? inferred : undefined, explicit: false };
}

export function sourceReference(query: string): 'pair' | 'plural' | 'singular' | undefined {
  if (/\b(?:these|those|both|the)\s+(?:two|2)\s+(?:policy\s+)?(?:files|documents|sources|papers)\b|\bboth\s+(?:policy\s+)?(?:files|documents|sources|papers)\b/i.test(query)) return 'pair';
  if (/\b(?:these|those)\s+(?:policy\s+)?(?:files|documents|sources|papers)\b/i.test(query)) return 'plural';
  if (/\b(?:this|that|same)\s+(?:policy\s+)?(?:file|document|source|paper)\b/i.test(query)) return 'singular';
}

/** Questions supply references, never factual support. Only explicit, uniquely resolved filenames are inherited. */
export function inheritDocumentScope(query: string, questions: string[], documents: Source[]): DocumentScope {
  const reference = sourceReference(query);
  const recent = [...questions].reverse().map(q => resolveDocumentScope(q, documents));
  if (reference === 'pair') {
    const ids: string[] = [];
    for (const scope of recent) {
      if (scope.issue) break; // A missing/deleted or ambiguous source must not be replaced by an older one.
      if (!scope.explicit || !scope.ids?.length) continue;
      for (const id of scope.ids) if (!ids.includes(id)) ids.push(id);
      if (ids.length >= 2) break;
    }
    return ids.length === 2 ? { ids, explicit: false } : { explicit: false, issue: 'Which two files should I compare? Include both filenames so I can restrict the search to those sources.' };
  }
  const scope = recent.find(s => s.issue || s.ids?.length);
  if (scope?.issue) return scope;
  if (scope?.ids?.length && (reference !== 'singular' || scope.ids.length === 1)) return { ids: scope.ids, explicit: false };
  return reference ? { explicit: false, issue: 'Which document or documents do you mean? Include the filenames from your knowledge base.' } : { explicit: false };
}
