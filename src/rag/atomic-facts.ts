import { answerSentences, hasNegation, invalidVerification, isUncertainty, MAX_FACTS_PER_ANSWER, MAX_FACTS_PER_SENTENCE, parseClaimVerification, parseSourceConflicts, quantities, unitsSupported, resolveEvidenceQuote, type AtomicClaim, type Evidence, type Verification } from './verification';

export type FactPlan = { sentences: { id: number; kind: 'FACTUAL' | 'UNCERTAINTY' | 'STYLE'; claims: { text: string; span: string }[] }[] };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !(k in value))) throw new Error('Invalid structured response');
  return value as Record<string, unknown>;
}
const json = (raw: string): unknown => JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
// Conservative lexical guard, not semantic entailment. Keep these qualifiers
// verbatim instead of letting decomposition strengthen or weaken the proposition.
function qualifiers(text: string) {
  return [...text.toLowerCase().matchAll(/\b(?:at\s+most|at\s+least|up\s+to|more\s+than|less\s+than|provided\s+that|only|except|unless|if|may|might|could|must|should|approximately|about|before|after)\b/g)]
    .map(match => match[0].replace(/\s+/g, ' '));
}

/** Separate decomposition from evidence judgments. Never accept model-supplied verdicts here. */
export function parseFactPlan(raw: string, draft: string): FactPlan | null {
  return inspectFactPlan(raw, draft).plan;
}

/** Machine-readable failures permit one contract retry without trusting malformed claims. */
export function inspectFactPlan(raw: string, draft: string): { plan: FactPlan | null; issue?: string } {
  try {
    const value = object(json(raw), ['sentences']), sentences = answerSentences(draft);
    if (!Array.isArray(value.sentences) || !sentences.length || value.sentences.length !== sentences.length || sentences.length > 32) throw new Error('Include every supplied sentence ID exactly once.');
    const plan: FactPlan = { sentences: value.sentences.map((entry, index) => {
      const s = object(entry, ['id', 'kind', 'claims']), original = sentences[index];
      if (s.id !== original.id || !['FACTUAL','UNCERTAINTY','STYLE'].includes(String(s.kind)) || !Array.isArray(s.claims)) throw new Error(`Sentence ${original.id}: retain the supplied ID, allowed kind and claims array.`);
      if (s.claims.length > MAX_FACTS_PER_SENTENCE) throw new Error(`Sentence ${original.id}: exceeds the ${MAX_FACTS_PER_SENTENCE}-claim budget. Do not omit or merge independent facts to hide this limit.`);
      const kind = s.kind as FactPlan['sentences'][number]['kind'];
      if (kind !== 'FACTUAL') {
        if (s.claims.length || !(kind === 'UNCERTAINTY' ? isUncertainty(original.text) : /^(?:#{1,3}\s*)?(?:objective|methodology|results|limitations|summary|evidence|conclusion):?$/i.test(original.text))) throw new Error(`Sentence ${original.id}: this wording cannot bypass evidence assessment. Use FACTUAL with verbatim spans covering every assertion, including any missing-information statement. Do not rewrite the answer.`);
        return { id: original.id, kind, claims: [] };
      }
      if (!s.claims.length) throw new Error('No claims');
      const claims = s.claims.map(item => {
        const c = object(item, ['text', 'span']);
        if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000 || typeof c.span !== 'string' || c.span.length < 3 || !original.text.includes(c.span)) throw new Error('Invalid fact span');
        // Standalone claims may repeat a numerical subject from the same sentence.
        // They must retain every quantity in their span and cannot invent a new one.
        if (quantities(c.span).some(n => !quantities(c.text as string).includes(n)) || quantities(c.text).some(n => !quantities(original.text).includes(n))) throw new Error(`Sentence ${original.id}: decomposition changed numerical content.`);
        if (!unitsSupported(c.span, c.text) || !unitsSupported(c.text, original.text)) throw new Error(`Sentence ${original.id}: decomposition changed quantity units.`);
        if (hasNegation(c.span) && !hasNegation(c.text)) throw new Error(`Sentence ${original.id}: decomposition dropped negation.`);
        if (qualifiers(c.span).some(q => !qualifiers(c.text as string).includes(q)) || qualifiers(c.text).some(q => !qualifiers(original.text).includes(q))) throw new Error(`Sentence ${original.id}: retain original modal, conditional and quantity-bound qualifiers verbatim.`);
        return { text: c.text, span: c.span };
      });
      // Every content-bearing word must occur inside at least one recorded span.
      // This checks textual coverage, not semantic decomposition quality.
      const covered = claims.map(c => { const start = original.text.indexOf(c.span); return [start, start + c.span.length]; });
      for (const word of original.text.matchAll(/[\p{L}\p{N}]+/gu)) {
        if (/^(?:a|an|the|and|or|but|while|using|with|on|in|at|to|of|for|was|were|is|are|it)$/i.test(word[0])) continue;
        if (original.text[word.index! - 1] === '[' && original.text[word.index! + word[0].length] === ']') continue;
        if (!covered.some(([a,b]) => word.index! >= a && word.index! + word[0].length <= b)) throw new Error(`Sentence ${original.id}: spans omit original wording at character ${word.index}. Cover the entire assertion including its introduction and qualifiers; copy spans verbatim.`);
      }
      return { id: original.id, kind, claims };
    }) };
    if (plan.sentences.reduce((total, sentence) => total + sentence.claims.length, 0) > MAX_FACTS_PER_ANSWER) throw new Error(`The answer exceeds the ${MAX_FACTS_PER_ANSWER}-claim verification budget. Ask a narrower question.`);
    return { plan };
  } catch (error) { return { plan: null, issue: error instanceof SyntaxError ? 'Return a complete JSON object, without commentary.' : (error as Error).message }; }
}

/** Stable IDs make the server, rather than a second model response, own claim text/spans. */
export function parseFactAssessments(raw: string, draft: string, docs: Evidence[], plan: FactPlan, requireSourceComparisons = false): Verification {
  try {
    const parsed = json(raw);
    const hasComparisons = Boolean(parsed && typeof parsed === 'object' && 'conflicts' in parsed);
    const root = object(parsed, requireSourceComparisons || hasComparisons ? ['claims', 'conflicts'] : ['claims']);
    const sourceConflicts = requireSourceComparisons || hasComparisons ? parseSourceConflicts(root.conflicts, docs) : [];
    const expected = plan.sentences.flatMap(s => s.claims.map((c, i) => ({ ...c, id: `s${s.id}c${i + 1}` })));
    if (!Array.isArray(root.claims) || root.claims.length !== expected.length) throw new Error('Missing assessments');
    const assessments = new Map<string, Record<string, unknown>>();
    for (const rawClaim of root.claims) {
      const claim = object(rawClaim, ['id', 'verdict', 'supporting', 'contradicting', 'missingInformation', 'temporalValidity', 'scope']);
      if (typeof claim.id !== 'string' || !expected.some(c => c.id === claim.id) || assessments.has(claim.id)) throw new Error('Invalid claim ID');
      assessments.set(claim.id, claim);
    }
    const sentences = plan.sentences.map(s => ({ ...s, claims: s.claims.map((c, i) => {
      const assessment = { ...assessments.get(`s${s.id}c${i + 1}`)! };
      delete assessment.id;
      return { ...c, ...assessment };
    }) }));
    const check = parseClaimVerification(JSON.stringify({ sentences }), draft, docs);
    return { ...check, sourceConflicts, ...(sourceConflicts.length ? { passed: false, verdict: 'Unresolved source conflict' } : {}) };
  } catch { return invalidVerification('The verifier omitted a claim, changed its ID, or returned an invalid assessment contract.'); }
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
  return inspectClaimEdits(raw, original, check, docs).revision;
}
/** Separate an invalid provider contract from a valid but unsafe/no-op proposal. */
export function inspectClaimEdits(raw: string, original: string, check: Verification, docs: Evidence[]): { revision: ClaimRevision | null; malformed: boolean } {
  let contractValid = false;
  try {
    const root = object(json(raw), ['corrections']);
    if (!Array.isArray(root.corrections) || root.corrections.length > 8) throw new Error('Invalid corrections array');
    for (const value of root.corrections) {
      const edit = object(value, ['claimId', 'replacement', 'evidence']);
      if (typeof edit.claimId !== 'string' || typeof edit.replacement !== 'string' || !edit.replacement.trim() || edit.replacement.length > 2000 || !Array.isArray(edit.evidence) || !edit.evidence.length || edit.evidence.length > 4) throw new Error('Invalid correction fields');
      for (const quote of edit.evidence) {
        const q = object(quote, ['index', 'quote']);
        if (!Number.isInteger(q.index) || Number(q.index) < 1 || typeof q.quote !== 'string' || q.quote.length < 8 || q.quote.length > 2000) throw new Error('Invalid quote fields');
      }
    }
    contractValid = true;
    if (!root.corrections.length) return { revision: null, malformed: false };
    const seen = new Set<string>(), changes: (ClaimEdit & { claim: AtomicClaim })[] = [];
    for (const value of root.corrections) {
      const edit = object(value, ['claimId', 'replacement', 'evidence']);
      const claim = check.atomicClaims?.find(c => c.id === edit.claimId);
      if (!claim || !['CONTRADICTED','TEMPORALLY_INVALID'].includes(claim.verdict) || seen.has(claim.id) || typeof edit.replacement !== 'string' || !edit.replacement.trim() || edit.replacement.length > 2000 || !Array.isArray(edit.evidence) || !edit.evidence.length || edit.evidence.length > 4) throw new Error('Invalid correction');
      if (isUncertainty(answerSentences(original)[claim.sentenceId - 1].text)) throw new Error('Caveat removal');
      const evidence = edit.evidence.map(value => {
        const q = object(value, ['index','quote']);
        if (typeof q.index !== 'number' || !Number.isInteger(q.index) || typeof q.quote !== 'string' || q.quote.length < 8 || q.quote.length > 2000 || !docs[q.index - 1]) throw new Error('Invalid correction quote');
        const exact = resolveEvidenceQuote(docs[q.index - 1].text, q.quote);
        if (!exact) throw new Error('Invalid correction quote');
        return { index: q.index, quote: exact };
      });
      const replacement = edit.replacement.trim();
      if (quantities(replacement).some(n => !quantities(evidence.map(e => e.quote).join(' ')).includes(n))) throw new Error('Unsupported correction quantity');
      if (!unitsSupported(replacement, evidence.map(e => e.quote).join(' '))) throw new Error('Unsupported correction unit');
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
    return { revision: { text, edits: changes.map(({ claim: _claim, ...edit }) => edit) }, malformed: false };
  } catch { return { revision: null, malformed: !contractValid }; }
}
