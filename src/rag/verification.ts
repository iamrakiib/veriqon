export type Evidence = { id: string; text: string; source?: string; page?: number; version?: string; chunkIndex: number; chunkEndIndex?: number };
export type ClaimVerdict = 'SUPPORTED' | 'CONTRADICTED' | 'INSUFFICIENT_EVIDENCE' | 'TEMPORALLY_INVALID' | 'CONFLICTED';
export type EvidenceQuote = { index: number; quote: string };
export type AtomicClaim = {
  id: string; sentenceId: number; text: string; span: { start: number; end: number; text: string };
  verdict: ClaimVerdict; supporting: EvidenceQuote[]; contradicting: EvidenceQuote[];
  missingInformation: string[]; temporalValidity: 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNKNOWN';
  scope: { time: string | null; place: string | null };
  recommendedAction: 'PRESERVE' | 'TARGETED_RETRIEVAL' | 'REPAIR' | 'HUMAN_REVIEW';
};
export type Verification = {
  verdict: string; evidence: string; passed: boolean;
  claims: { sentence: string; supported: boolean; evidenceIndexes: number[] }[];
  atomicClaims?: AtomicClaim[]; schemaValid?: boolean;
};
export function answerSentences(text: string) {
  const pieces: { id: number; text: string; start: number; end: number }[] = [];
  for (const item of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)) {
    // Standalone citation markers belong to the preceding sentence.
    for (const match of item.segment.matchAll(/[^\r\n]+/g)) {
      let value = match[0].trim(); if (!value) continue;
      let start = item.index + match.index! + match[0].indexOf(value);
      const prefix = value.match(/^(?:\[\d+\]\s*)+/)?.[0];
      if (prefix && pieces.length) {
        const last = pieces[pieces.length - 1]; last.end = start + prefix.trimEnd().length; last.text = text.slice(last.start, last.end);
        start += prefix.length; value = value.slice(prefix.length);
        if (!value) continue;
      }
      if (/^(?:\[\d+\]\s*)+$/.test(value) && pieces.length) {
        const last = pieces[pieces.length - 1]; last.end = start + value.length; last.text = text.slice(last.start, last.end);
      } else pieces.push({ id: pieces.length + 1, text: value, start, end: start + value.length });
    }
  }
  return pieces;
}
const normalized = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const numbers: Record<string, string> = { zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10',eleven:'11',twelve:'12',thirteen:'13',fourteen:'14',fifteen:'15',sixteen:'16',seventeen:'17',eighteen:'18',nineteen:'19',twenty:'20',hundred:'100',thousand:'1000' };
export function quantities(text: string) {
  const clean = normalized(text.replace(/\[\d+\]/g, '')).replace(/(?<=\d),(?=\d{3}\b)/g, '');
  return [...new Set((clean.match(/\b(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|hundred|thousand)\b/g) || []).map(n => numbers[n] || n))].sort();
}
export function isUncertainty(text: string) {
  return !/[;]|\b(?:and|but|while|although|because|however)\b/i.test(text) && /(?:\b(?:not (?:reported|provided|specified|available|established)|does not (?:report|provide|specify|establish)|insufficient (?:information|evidence)|cannot (?:determine|verify|establish)|could not (?:determine|verify|establish)|missing (?:details|information|results|evidence))\b)/i.test(text) && quantities(text).length === 0;
}
function record(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !(k in value))) throw new Error('Invalid schema');
  return value as Record<string, any>;
}
function quotes(value: unknown, docs: Evidence[]): EvidenceQuote[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid evidence');
  return value.map(raw => {
    const item = record(raw, ['index','quote']);
    if (!Number.isInteger(item.index) || !docs[item.index - 1] || typeof item.quote !== 'string' || item.quote.trim().length < 8 || item.quote.length > 2000 || !normalized(docs[item.index - 1].text).includes(normalized(item.quote))) throw new Error('Invented evidence quote');
    return { index: item.index, quote: item.quote };
  });
}
export function invalidVerification(reason = 'The verifier did not return a complete, valid assessment.'): Verification {
  return { passed: false, schemaValid: false, verdict: 'Verification failed', evidence: reason, claims: [], atomicClaims: [] };
}

/** Validate proposition coverage, exact source quotes and numerical anchors, never a confidence score. */
export function parseClaimVerification(raw: string, draft: string, docs: Evidence[]): Verification {
  try {
    const value = record(JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')), ['sentences']);
    const sentences = answerSentences(draft);
    if (!sentences.length || sentences.length > 32 || !Array.isArray(value.sentences) || value.sentences.length !== sentences.length) throw new Error('Missing sentence');
    const atomicClaims: AtomicClaim[] = [];
    const claims = sentences.map((sentence, i) => {
      const entry = record(value.sentences[i], ['id','kind','claims']);
      if (entry.id !== sentence.id || !['FACTUAL','UNCERTAINTY','STYLE'].includes(entry.kind) || !Array.isArray(entry.claims)) throw new Error('Invalid sentence assessment');
      if (entry.kind !== 'FACTUAL') {
        // Only narrowly recognized caveats/headings bypass factual verification.
        const style = /^\s*(?:#{1,3}\s*)?(?:objective|methodology|results|limitations|summary|evidence|conclusion):?\s*$/i.test(sentence.text);
        if (entry.claims.length || !(entry.kind === 'UNCERTAINTY' ? isUncertainty(sentence.text) : style)) throw new Error('Unverified factual sentence');
        return { sentence: sentence.text, supported: true, evidenceIndexes: [] };
      }
      if (!entry.claims.length || entry.claims.length > 8) throw new Error('Missing atomic claims');
      const extracted: AtomicClaim[] = entry.claims.map((rawClaim: unknown, j: number) => {
        const c = record(rawClaim, ['text','span','verdict','supporting','contradicting','missingInformation','temporalValidity','scope']);
        if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000 || typeof c.span !== 'string' || c.span.length < 3 || !sentence.text.includes(c.span)) throw new Error('Invalid claim span');
        const dimensions = c.text.toLowerCase().match(/\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:benchmark\s+|forecasting\s+)?(?:datasets?|architectures?|%|percent|days?)\b/g) || [];
        if (dimensions.length > 1 && /\b(?:and|using|across|with|achieved)\b/i.test(c.text)) throw new Error('Compound numerical claim must be split');
        if (!['SUPPORTED','CONTRADICTED','INSUFFICIENT_EVIDENCE','TEMPORALLY_INVALID','CONFLICTED'].includes(c.verdict) || !['APPLICABLE','NOT_APPLICABLE','UNKNOWN'].includes(c.temporalValidity)) throw new Error('Invalid verdict');
        const scope = record(c.scope, ['time','place']);
        if ([scope.time, scope.place].some(s => s !== null && (typeof s !== 'string' || s.length > 160))) throw new Error('Invalid scope');
        if (!Array.isArray(c.missingInformation) || c.missingInformation.length > 8 || c.missingInformation.some((s: unknown) => typeof s !== 'string' || !s.trim() || s.length > 300)) throw new Error('Invalid missing information');
        const supporting = quotes(c.supporting, docs), contradicting = quotes(c.contradicting, docs);
        if (c.verdict === 'SUPPORTED' && (!supporting.length || contradicting.length || c.temporalValidity === 'NOT_APPLICABLE')) throw new Error('Inconsistent support');
        if (c.verdict === 'CONTRADICTED' && !contradicting.length) throw new Error('Missing contradiction');
        if (c.verdict === 'CONFLICTED' && (!supporting.length || !contradicting.length)) throw new Error('Missing conflict evidence');
        if (c.verdict === 'TEMPORALLY_INVALID' && (c.temporalValidity !== 'NOT_APPLICABLE' || !contradicting.length)) throw new Error('Missing temporal evidence');
        let verdict = c.verdict as ClaimVerdict;
        const missingInformation: string[] = [...c.missingInformation];
        const quoted = supporting.map(q => q.quote).join(' ');
        if (verdict === 'SUPPORTED' && (quantities(c.text + ' ' + c.span).some(n => !quantities(quoted).includes(n)) || /%|\bpercent\b/i.test(c.text + ' ' + c.span) && !/%|\bpercent\b/i.test(quoted))) {
          verdict = 'INSUFFICIENT_EVIDENCE'; missingInformation.push('The exact numerical value or unit is not established by the quoted evidence.');
        }
        const offset = sentence.start + sentence.text.indexOf(c.span);
        return { id: `s${sentence.id}c${j + 1}`, sentenceId: sentence.id, text: c.text, span: { start: offset, end: offset + c.span.length, text: c.span }, verdict, supporting, contradicting, missingInformation,
          temporalValidity: c.temporalValidity, scope: { time: scope.time, place: scope.place }, recommendedAction: verdict === 'SUPPORTED' ? 'PRESERVE' : verdict === 'CONFLICTED' ? 'HUMAN_REVIEW' : verdict === 'INSUFFICIENT_EVIDENCE' ? 'TARGETED_RETRIEVAL' : 'REPAIR' };
      });
      if (quantities(sentence.text).some(n => !quantities(extracted.map(c => c.text + ' ' + c.span.text).join(' ')).includes(n))) throw new Error('Numerical claim omitted');
      const evidenceIndexes = [...new Set(extracted.flatMap(c => c.supporting.map(q => q.index)))];
      if ([...sentence.text.matchAll(/\[(\d+)\]/g)].some(m => !docs[Number(m[1]) - 1])) throw new Error('Invalid inline citation');
      const supported = extracted.every(c => c.verdict === 'SUPPORTED');
      if (supported && [...sentence.text.matchAll(/\[(\d+)\]/g)].some(m => !evidenceIndexes.includes(Number(m[1])))) throw new Error('Citation mismatch');
      atomicClaims.push(...extracted); return { sentence: sentence.text, supported, evidenceIndexes };
    });
    const passed = atomicClaims.length > 0 && claims.every(c => c.supported);
    return { passed, schemaValid: true, claims, atomicClaims, verdict: passed ? 'Claims supported by quoted evidence and model assessment' : 'Unresolved factual claims', evidence: atomicClaims.map(c => `${c.id} · ${c.verdict}: ${c.text}${c.missingInformation.length ? ' — ' + c.missingInformation.join('; ') : ''}`).join('\n') };
  } catch { return invalidVerification(); }
}

export function parseMinimalRepair(raw: string, original: string, check: Verification): string | null {
  try {
    const value = record(JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')), ['edits']);
    if (!Array.isArray(value.edits) || !value.edits.length || value.edits.length > 8) return null;
    const sentences = answerSentences(original), seen = new Set<number>();
    const edits = value.edits.map((rawEdit: unknown) => {
      const edit = record(rawEdit, ['sentenceId','text']);
      const sentence = sentences.find(s => s.id === edit.sentenceId);
      if (!sentence || seen.has(sentence.id) || typeof edit.text !== 'string' || edit.text.length > 3000 || !edit.text.trim() || isUncertainty(sentence.text)) throw new Error('Invalid edit');
      const affected = check.atomicClaims?.filter(c => c.sentenceId === sentence.id) || [];
      if (!affected.some(c => c.verdict !== 'SUPPORTED') || affected.filter(c => c.verdict === 'SUPPORTED').some(c => !edit.text.includes(c.span.text))) throw new Error('Supported claim changed');
      seen.add(sentence.id); return { ...sentence, replacement: edit.text.trim() };
    });
    let result = original;
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    return result;
  } catch { return null; }
}

/** Conservative acceptance: a changed number/negation plus quoted support, not merely new wording. */
export function substantiveRepair(before: Verification, after: Verification) {
  if (!after.passed || !before.atomicClaims?.length || !after.atomicClaims?.length) return false;
  const failed = before.atomicClaims.filter(c => c.verdict !== 'SUPPORTED');
  let corrected = 0;
  for (const claim of failed) {
    const anchors = (text: string) => new Set((text.toLowerCase().replace(/\[\d+\]/g, '').match(/[a-z]{3,}/g) || []).filter(w => !['the','was','were','has','had','and','with','that','this','not','one','two','three','four','five','six','seven','eight','nine','ten'].includes(w)).map(w => w.replace(/s$/, '')));
    const originalAnchors = anchors(claim.text);
    const candidates = after.atomicClaims.filter(c => [...anchors(c.text)].some(w => originalAnchors.has(w)));
    const oldNumbers = quantities(claim.text);
    // Same numerical assertion surviving a rewrite is not a factual correction.
    if (oldNumbers.length && candidates.some(c => oldNumbers.every(n => quantities(c.text).includes(n)))) return false;
    if (!oldNumbers.length && candidates.some(c => /\b(?:not|never|no)\b/i.test(c.text) === /\b(?:not|never|no)\b/i.test(claim.text))) return false;
    const changed = candidates.some(c => c.supporting.length && (oldNumbers.length && quantities(c.text).length && JSON.stringify(oldNumbers) !== JSON.stringify(quantities(c.text)) || /\b(?:not|never|no)\b/i.test(c.text) !== /\b(?:not|never|no)\b/i.test(claim.text)));
    if (changed) corrected++;
  }
  return corrected > 0;
}
