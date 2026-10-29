import { answerSentences, isUncertainty, quantities, type AtomicClaim, type Evidence, type Verification } from './verification';

export type FactPlan = { sentences: { id: number; kind: 'FACTUAL' | 'UNCERTAINTY' | 'STYLE'; claims: { text: string; span: string }[] }[] };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !(k in value))) throw new Error('Invalid structured response');
  return value as Record<string, unknown>;
}
const json = (raw: string): unknown => JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));

/** Separate decomposition from evidence judgments. Never accept model-supplied verdicts here. */
export function parseFactPlan(raw: string, draft: string): FactPlan | null {
  try {
    const value = object(json(raw), ['sentences']), sentences = answerSentences(draft);
    if (!Array.isArray(value.sentences) || !sentences.length || value.sentences.length !== sentences.length || sentences.length > 32) return null;
    return { sentences: value.sentences.map((entry, index) => {
      const s = object(entry, ['id', 'kind', 'claims']), original = sentences[index];
      if (s.id !== original.id || !['FACTUAL','UNCERTAINTY','STYLE'].includes(String(s.kind)) || !Array.isArray(s.claims) || s.claims.length > 8) throw new Error('Invalid sentence');
      const kind = s.kind as FactPlan['sentences'][number]['kind'];
      if (kind !== 'FACTUAL') {
        if (s.claims.length || !(kind === 'UNCERTAINTY' ? isUncertainty(original.text) : /^(?:#{1,3}\s*)?(?:objective|methodology|results|limitations|summary|evidence|conclusion):?$/i.test(original.text))) throw new Error('Unverified assertion');
        return { id: original.id, kind, claims: [] };
      }
      if (!s.claims.length) throw new Error('No claims');
      const claims = s.claims.map(item => {
        const c = object(item, ['text', 'span']);
        if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000 || typeof c.span !== 'string' || c.span.length < 3 || !original.text.includes(c.span)) throw new Error('Invalid fact span');
        if (JSON.stringify(quantities(c.text)) !== JSON.stringify(quantities(c.span))) throw new Error('Decomposition changed numerical content');
        return { text: c.text, span: c.span };
      });
      // Every content-bearing word must occur inside at least one recorded span.
      // This checks textual coverage, not semantic decomposition quality.
      const covered = claims.map(c => { const start = original.text.indexOf(c.span); return [start, start + c.span.length]; });
      for (const word of original.text.matchAll(/[\p{L}\p{N}]+/gu)) {
        if (/^(?:a|an|the|and|or|but|using|with|on|in|at|to|of|for|was|were|is|are|it)$/i.test(word[0])) continue;
        if (original.text[word.index! - 1] === '[' && original.text[word.index! + word[0].length] === ']') continue;
        if (!covered.some(([a,b]) => word.index! >= a && word.index! + word[0].length <= b)) throw new Error('Omitted assertion span');
      }
      return { id: original.id, kind, claims };
    }) };
  } catch { return null; }
}

/** The verifier cannot silently omit, reword or merge facts supplied by decomposition. */
export function matchesFactPlan(plan: FactPlan, check: Verification) {
  const expected = plan.sentences.flatMap(s => s.claims.map(c => ({ ...c, sentenceId: s.id })));
  const actual = check.atomicClaims || [];
  return expected.length === actual.length && expected.every((c, i) => c.sentenceId === actual[i].sentenceId && c.text === actual[i].text && c.span === actual[i].span.text);
}

export type ClaimEdit = { claimId: string; original: string; replacement: string; evidence: { index: number; quote: string }[] };
export type ClaimRevision = { text: string; edits: ClaimEdit[] };
export function parseClaimEdits(raw: string, original: string, check: Verification, docs: Evidence[]): ClaimRevision | null {
  try {
    const root = object(json(raw), ['corrections']);
    if (!Array.isArray(root.corrections) || !root.corrections.length || root.corrections.length > 8) return null;
    const seen = new Set<string>(), changes: (ClaimEdit & { claim: AtomicClaim })[] = [];
    for (const value of root.corrections) {
      const edit = object(value, ['claimId', 'replacement', 'evidence']);
      const claim = check.atomicClaims?.find(c => c.id === edit.claimId);
      if (!claim || !['CONTRADICTED','TEMPORALLY_INVALID'].includes(claim.verdict) || seen.has(claim.id) || typeof edit.replacement !== 'string' || !edit.replacement.trim() || edit.replacement.length > 2000 || !Array.isArray(edit.evidence) || !edit.evidence.length || edit.evidence.length > 4) throw new Error('Invalid correction');
      if (isUncertainty(answerSentences(original)[claim.sentenceId - 1].text)) throw new Error('Caveat removal');
      const evidence = edit.evidence.map(value => {
        const q = object(value, ['index','quote']);
        if (typeof q.index !== 'number' || !Number.isInteger(q.index) || typeof q.quote !== 'string' || q.quote.length < 8 || q.quote.length > 2000 || !docs[q.index - 1]?.text.includes(q.quote)) throw new Error('Invalid correction quote');
        return { index: q.index, quote: q.quote };
      });
      const replacement = edit.replacement.trim();
      if (quantities(replacement).some(n => !quantities(evidence.map(e => e.quote).join(' ')).includes(n))) throw new Error('Unsupported correction quantity');
      if (check.atomicClaims?.some(c => c.verdict === 'SUPPORTED' && c.span.start < claim.span.end && c.span.end > claim.span.start)) throw new Error('Correction overlaps supported fact');
      if (changes.some(c => c.claim.span.start < claim.span.end && c.claim.span.end > claim.span.start)) throw new Error('Overlapping corrections');
      if (original.slice(claim.span.start, claim.span.end) !== claim.span.text) throw new Error('Stale span');
      seen.add(claim.id); changes.push({ claimId: claim.id, original: claim.span.text, replacement, evidence, claim });
    }
    let text = original;
    for (const sentence of answerSentences(original).reverse()) {
      const edits = changes.filter(c => c.claim.sentenceId === sentence.id);
      if (!edits.length) continue;
      let revised = sentence.text;
      for (const change of edits.sort((a,b) => b.claim.span.start - a.claim.span.start)) revised = revised.slice(0, change.claim.span.start - sentence.start) + change.replacement + revised.slice(change.claim.span.end - sentence.start);
      // Replace only citation markers in edited sentences, using real correction quotes
      // and the evidence for preserved supported claims. Never invent a source index.
      const indexes = [...new Set([...edits.flatMap(e => e.evidence.map(q => q.index)), ...(check.atomicClaims || []).filter(c => c.sentenceId === sentence.id && c.verdict === 'SUPPORTED').flatMap(c => c.supporting.map(q => q.index))])].sort((a,b) => a-b);
      revised = revised.replace(/\s*\[\d+\]/g, '').trimEnd() + ' ' + indexes.map(i => `[${i}]`).join(' ');
      text = text.slice(0, sentence.start) + revised + text.slice(sentence.end);
    }
    return { text, edits: changes.map(({ claim: _claim, ...edit }) => edit) };
  } catch { return null; }
}
