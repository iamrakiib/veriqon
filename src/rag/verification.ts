import type { SourceMetadata } from './temporal';
export type Evidence = { id: string; text: string; source?: string; page?: number; version?: string; snapshotId?: string; metadata?: SourceMetadata; chunkIndex: number; chunkEndIndex?: number; retrievalMode?: 'hybrid' | 'lexical_fallback' };
export const MAX_FACTS_PER_SENTENCE = 16;
export const MAX_FACTS_PER_ANSWER = 32;
export type ClaimVerdict = 'SUPPORTED' | 'CONTRADICTED' | 'INSUFFICIENT_EVIDENCE' | 'TEMPORALLY_INVALID' | 'CONFLICTED';
export type EvidenceQuote = { index: number; quote: string };
export type SourceConflict = {
  id: string; claim: string; supporting: EvidenceQuote[]; contradicting: EvidenceQuote[];
  scope: { time: string | null; place: string | null }; reason: string;
  scopeRelation?: 'SAME' | 'UNKNOWN'; periodRelation?: 'OVERLAPPING' | 'UNKNOWN';
  precedence?: 'NONE_ESTABLISHED' | 'MODEL_ASSERTED';
};
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
  sourceConflicts?: SourceConflict[];
  appliedDecisions?: {id:string;claim:string;action:'PREFER_SOURCE'|'DIFFERENT_SCOPE'}[];
  failure?: { stage: 'decomposition' | 'verification'; code: 'invalid_response' | 'timeout' | 'provider_error'; retryable: boolean };
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

/** Add only references established by verification; never rewrite factual text. */
export function citeSupportedSentences(draft: string, check: Verification) {
  const sentences = answerSentences(draft);
  if (!check.schemaValid || sentences.length !== check.claims.length || sentences.some((s, i) => s.text !== check.claims[i].sentence)) return { draft, check };
  let rendered = '', cursor = 0;
  const offsets = new Map<number, number>();
  const claims = check.claims.map((claim, i) => {
    const sentence = sentences[i];
    rendered += draft.slice(cursor, sentence.start);
    offsets.set(sentence.id, rendered.length - sentence.start);
    const present = new Set([...sentence.text.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])));
    const missing = claim.supported ? claim.evidenceIndexes.filter(index => !present.has(index)) : [];
    const text = sentence.text + (missing.length ? ' ' + missing.map(index => `[${index}]`).join(' ') : '');
    rendered += text; cursor = sentence.end;
    return { ...claim, sentence: text };
  });
  rendered += draft.slice(cursor);
  return { draft: rendered, check: { ...check, claims, atomicClaims: check.atomicClaims?.map(c => {
    const shift = offsets.get(c.sentenceId) || 0;
    return { ...c, span: { ...c.span, start: c.span.start + shift, end: c.span.end + shift } };
  }) } };
}
const normalized = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const numbers: Record<string, string> = { zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10',eleven:'11',twelve:'12',thirteen:'13',fourteen:'14',fifteen:'15',sixteen:'16',seventeen:'17',eighteen:'18',nineteen:'19',twenty:'20',hundred:'100',thousand:'1000' };
const numeral = '[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[-+]?\\d+)?';
/** Exact base-ten normalization, without floating-point rounding or unbounded exponent expansion. */
function canonicalNumber(value: string): string {
  if (numbers[value]) return numbers[value];
  const match = /^([-+]?)(\d*)(?:\.(\d+))?(?:e([-+]?\d+))?$/i.exec(value)!;
  const fraction = match[3] || '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const trailing = digits.match(/0+$/)?.[0].length || 0;
  digits = digits.slice(0, digits.length - trailing);
  const exponent = BigInt(match[4] || '0') - BigInt(fraction.length) + BigInt(trailing);
  const sign = match[1] === '-' ? '-' : '';
  if (exponent > 100n || exponent < -100n) return `${sign}${digits}e${exponent}`;
  const point = digits.length + Number(exponent);
  return sign + (point <= 0 ? '0.' + '0'.repeat(-point) + digits
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
    : digits.slice(0, point) + '.' + digits.slice(point));
}
export function quantities(text: string) {
  const clean = normalized(text.replace(/\[\d+\]/g, '')).replace(/\u2212/g, '-').replace(/(?<=\d),(?=\d{3}\b)/g, '');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.])${numeral}(?![\\p{L}\\p{N}_])|\\b(?:${Object.keys(numbers).join('|')})\\b`, 'gu');
  return [...new Set((clean.match(pattern) || []).map(canonicalNumber))].sort();
}
export const hasNegation = (text: string) => /\b(?:not|never|no|without|neither|cannot)\b|n['\u2019]t\b/i.test(text);

// Literal quantity/unit pairs, not a unit-conversion or mathematical entailment engine.
// This prevents "5 km" being accepted because "5 metres" happens to contain 5.
const unitAliases: Record<string, string> = {
  '%': '%', percent: '%', percentage: '%',
  km: 'km', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km',
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm', cm: 'cm', mm: 'mm',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', g: 'g', gram: 'g', grams: 'g', mg: 'mg',
  ms: 'ms', millisecond: 'ms', milliseconds: 'ms', s: 's', second: 's', seconds: 's',
  minute: 'minute', minutes: 'minute', hour: 'hour', hours: 'hour',
  day: 'day', days: 'day', week: 'week', weeks: 'week', year: 'year', years: 'year',
  dataset: 'dataset', datasets: 'dataset', architecture: 'architecture', architectures: 'architecture',
};
export function quantityUnits(text: string): string[] {
  const number = `${numeral}|${Object.keys(numbers).join('|')}`;
  const units = Object.keys(unitAliases).sort((a,b) => b.length - a.length).join('|');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${number})\\s*(?:benchmark\\s+|forecasting\\s+)?(${units})(?![\\p{L}\\p{N}])`, 'gu');
  const clean = normalized(text).replace(/\u2212/g, '-').replace(/(?<=\d),(?=\d{3}\b)/g, '');
  return [...new Set([...clean.matchAll(pattern)].map(m => `${canonicalNumber(m[1])}:${unitAliases[m[2]]}`))];
}
export function unitsSupported(text: string, evidence: string) {
  const established = quantityUnits(evidence);
  return quantityUnits(text).every(pair => established.includes(pair));
}
export function isUncertainty(text: string) {
  // Only complete, standalone disclosures may bypass factual verification. A
  // substring such as "not reported" must never exempt an attached assertion.
  const clean = normalized(text.replace(/\[\d+\]/g, '')).replace(/\.$/, '');
  if (quantities(clean).length || /[,;:!?\n\r]|\b(?:and|but|while|although|because|however|which|therefore|so)\b/i.test(clean)) return false;
  const metric = '(?:results|details|information|evidence|accuracy|dataset count|architecture count|methodology|evaluation protocol|(?:inference )?latency(?: in (?:milliseconds|seconds))?)';
  const subject = `(?:(?:the|exact|requested|quantitative|methodological|experimental|available|accessible|retrieved|supplied) )*${metric}`;
  if (new RegExp(`^${subject} (?:is|are|was|were) not (?:reported|provided|specified|available|established)$`, 'i').test(clean)) return true;
  if (/^insufficient (?:information|evidence)$/i.test(clean)) return true;
  const topic = `(?:(?:the|any|exact|requested|quantitative|methodological|experimental|missing|remaining|reported) )*${metric}`;
  const context = '(?: (?:from|in) the (?:(?:retrieved|available|supplied|accessible) )?(?:evidence|passages|sources|documents))?';
  // Unknown prose is sent through factual verification instead of guessed to be
  // a harmless noun phrase; arbitrary trailing clauses cannot bypass the check.
  return new RegExp(`^(?:(?:i|we) (?:cannot|could not) (?:determine|verify|establish)|the (?:(?:retrieved|available|supplied|accessible) )?evidence does not (?:report|provide|specify|establish)) ${topic}${context}$`, 'i').test(clean);
}
function record(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !(k in value))) throw new Error('Invalid schema');
  return value as Record<string, any>;
}

/** Match typography only, never approximate wording, and retain the exact source slice. */
export function resolveEvidenceQuote(source: string, quote: string): string | null {
  if (source.includes(quote)) return quote;
  const canonical = (text: string) => {
    let value = '';
    const offsets: { start: number; end: number }[] = [];
    for (let i = 0; i < text.length;) {
      // PDF line wrapping: "Experi-\nments" is the same word, not invented evidence.
      const wrap = /\p{L}/u.test(text[i - 1] || '') ? text.slice(i).match(/^[-\u00ad][ \t]*\r?\n[ \t]*(?=\p{L})/u) : null;
      if (wrap) { i += wrap[0].length; continue; }
      const original = String.fromCodePoint(text.codePointAt(i)!);
      const end = i + original.length;
      for (const char of original.normalize('NFKC').toLowerCase().replace(/[\u2010\u2011]/g, '-')) {
        if (/\s/u.test(char)) {
          if (value.endsWith(' ')) offsets[offsets.length - 1].end = end;
          else { value += ' '; offsets.push({ start: i, end }); }
        } else {
          value += char;
          for (let unit = 0; unit < char.length; unit++) offsets.push({ start: i, end });
        }
      }
      i = end;
    }
    return { value, offsets };
  };
  const original = canonical(source), wanted = canonical(quote).value.trim();
  const start = wanted ? original.value.indexOf(wanted) : -1;
  return start < 0 ? null : source.slice(original.offsets[start].start, original.offsets[start + wanted.length - 1].end);
}

function quotes(value: unknown, docs: Evidence[], location = 'Evidence'): EvidenceQuote[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid evidence');
  return value.map(raw => {
    const item = record(raw, ['index','quote']);
    if (!Number.isInteger(item.index) || !docs[item.index - 1] || typeof item.quote !== 'string' || item.quote.trim().length < 8 || item.quote.length > 2000) throw new Error('Invalid evidence quote');
    const exact = resolveEvidenceQuote(docs[item.index - 1].text, item.quote);
    if (!exact) throw new Error(`${location}: quote does not match evidence [${item.index}]. Copy a contiguous substring from that passage. Do not paraphrase, add punctuation or join separated source fragments; use separate quote records when necessary.`);
    return { index: item.index, quote: exact };
  });
}

/** Source attribution/counts are not policy values. All other numerical anchors remain required. */
// Exact decimal comparison for the only cross-unit exclusion supported here.
// This does not authorize generating converted values or comparing other units.
function distinctExcludedQuantity(actual: string, unit: string, excluded: string, excludedUnit: string) {
  if (unit === excludedUnit) return actual !== excluded;
  if (![unit, excludedUnit].every(u => u === 'ms' || u === 's')) return false;
  const parts = [actual, excluded].map(n => /^(-?)(\d+)(?:\.(\d+))?$/.exec(n));
  if (parts.some(p => !p)) return false;
  const scale = Math.max(...parts.map(p => p![3]?.length || 0));
  const integers = parts.map((p, i) => BigInt(`${p![1]}${p![2]}${(p![3] || '').padEnd(scale, '0')}`) * ([unit, excludedUnit][i] === 's' ? 1000n : 1n));
  return integers[0] !== integers[1];
}

function numericalEvidenceSupported(text: string, supporting: EvidenceQuote[], docs: Evidence[]) {
  const sourceCount = new Set(supporting.map(q => `${docs[q.index - 1].id}\0${docs[q.index - 1].version || ''}`)).size;
  let invalidSourceCount = false;
  let cleaned = text.replace(/\bOne\s+(?:policy|source|document|passage)\s+(?=states\b|says\b|reports\b|specifies\b)/gi, 'A source ')
    .replace(/\b(?:retrieved evidence contains|supplied evidence contains)\s+(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:conflicting\s+)?(?:policies|sources|documents|passages)\b/gi,
      (_phrase, count: string) => {
        if (Number(numbers[count.toLowerCase()] || count) !== sourceCount) invalidSourceCount = true;
        return 'retrieved sources';
      });
  const quoted = supporting.map(q => q.quote).join(' ');
  // Filename numbers identify an actual cited source; they are not asserted dates.
  for (const q of supporting) {
    const source = docs[q.index - 1].source;
    if (source) cleaned = cleaned.replace(new RegExp(`(?<![\\p{L}\\p{N}_-])${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'giu'), 'the cited source');
  }
  // A grounded exact count also rules out a distinct explicitly excluded count:
  // "three datasets, not five" need not quote the user's incorrect five.
  // Also compare ms/s exclusions exactly; never generalize to approximate values.
  const num = `(?:${numeral}|${Object.keys(numbers).join('|')})`;
  const unit = `(?:${Object.keys(unitAliases).sort((a,b) => b.length-a.length).join('|')})`;
  const denial = new RegExp(`(?<![\\p{L}\\p{N}])(${num}\\s+(?:benchmark\\s+|forecasting\\s+)?${unit})(,?\\s+not\\s+(${num})(?:\\s+(${unit}))?)(?=\\s*(?:[.!?;]|$))`, 'giu');
  let invalidDenial = false;
  cleaned = cleaned.replace(denial, (whole, positive: string, _excluded: string, negative: string, negativeUnit: string | undefined, offset: number) => {
    const [pair] = quantityUnits(positive);
    const actual = quantities(positive)[0], excluded = quantities(negative)[0];
    const actualUnit = pair?.split(':')[1];
    const excludedUnit = negativeUnit ? unitAliases[negativeUnit.toLowerCase()] : actualUnit;
    const approximate = /\b(?:about|approximately|at least|up to|minimum|maximum|over|under|more than|less than)\b/i.test(quoted + ' ' + cleaned.slice(Math.max(0, offset - 25), offset));
    if (pair && distinctExcludedQuantity(actual, actualUnit, excluded, excludedUnit) && !approximate && quantityUnits(quoted).includes(pair)) return positive;
    invalidDenial = true; return whole;
  });
  return !invalidSourceCount && !invalidDenial && quantities(cleaned).every(n => quantities(quoted).includes(n)) && unitsSupported(cleaned, quoted);
}

/** A separate source comparison prevents attributed, supported claims from hiding disagreements. */
export function parseSourceConflicts(value: unknown, docs: Evidence[]): SourceConflict[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid source comparisons');
  const conflicts: SourceConflict[] = [];
  for (const raw of value) {
    const c = record(raw, ['claim','supporting','contradicting','scope','scopeRelation','periodRelation','precedence','reason']);
    if (typeof c.claim !== 'string' || !c.claim.trim() || c.claim.length > 2000 || typeof c.reason !== 'string' || !c.reason.trim() || c.reason.length > 1000) throw new Error('Invalid source conflict');
    const scope = record(c.scope, ['time','place']);
    if ([scope.time, scope.place].some(s => s !== null && (typeof s !== 'string' || s.length > 160))) throw new Error('Invalid conflict scope');
    if (!['SAME','DIFFERENT','UNKNOWN'].includes(c.scopeRelation) || !['OVERLAPPING','DISJOINT','UNKNOWN'].includes(c.periodRelation) || !['NONE_ESTABLISHED','EXPLICIT'].includes(c.precedence)) throw new Error('Invalid conflict relationship');
    const supporting = quotes(c.supporting, docs), contradicting = quotes(c.contradicting, docs);
    if (!supporting.length || !contradicting.length) throw new Error('Missing source conflict side');
    // One passage/version cannot masquerade as two independent competing sources.
    const keys = (items: EvidenceQuote[]) => items.map(q => `${docs[q.index - 1].id}\0${docs[q.index - 1].version || ''}`);
    if (keys(supporting).some(k => keys(contradicting).includes(k))) throw new Error('Conflict sides must use distinct source versions');
    const separatedByMetadata = supporting.every(a=>contradicting.every(b=>{
      const first=docs[a.index-1].metadata,second=docs[b.index-1].metadata;
      return Boolean(first && second && (first.scope && second.scope && first.scope.normalize('NFKC').toLowerCase()!==second.scope.normalize('NFKC').toLowerCase()
        || first.effectiveTo && second.effectiveFrom && first.effectiveTo<second.effectiveFrom
        || second.effectiveTo && first.effectiveFrom && second.effectiveTo<first.effectiveFrom));
    }));
    if (separatedByMetadata || c.scopeRelation === 'DIFFERENT' || c.periodRelation === 'DISJOINT') continue;
    // Unknown applicability is a review candidate, not evidence of agreement.
    // An LLM's EXPLICIT label alone cannot resolve competing sources. Recorded
    // owner decisions are applied separately by the server after strict parsing.
    const qualification = c.scopeRelation === 'UNKNOWN' || c.periodRelation === 'UNKNOWN'
      ? 'Scope or effective period is not established; this potential disagreement requires review. ' : '';
    const precedence = c.precedence === 'EXPLICIT'
      ? 'The verifier suggested supersession, but no authorized precedence decision is recorded; review is required. ' : '';
    conflicts.push({ id: `evidence-${conflicts.length + 1}`, claim: c.claim, supporting, contradicting,
      scope: { time: scope.time, place: scope.place }, reason: qualification + precedence + c.reason,
      scopeRelation: c.scopeRelation, periodRelation: c.periodRelation, precedence: c.precedence === 'EXPLICIT' ? 'MODEL_ASSERTED' : 'NONE_ESTABLISHED' });
  }
  return conflicts;
}
export function invalidVerification(reason = 'The verifier did not return a complete, valid assessment.', failure?: Verification['failure']): Verification {
  return { passed: false, schemaValid: false, verdict: 'Verification failed', evidence: reason, claims: [], atomicClaims: [], ...(failure ? { failure } : {}) };
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
      if (!entry.claims.length || entry.claims.length > MAX_FACTS_PER_SENTENCE) throw new Error(`Each factual sentence requires 1 to ${MAX_FACTS_PER_SENTENCE} atomic claims.`);
      const extracted: AtomicClaim[] = entry.claims.map((rawClaim: unknown, j: number) => {
        const c = record(rawClaim, ['text','span','verdict','supporting','contradicting','missingInformation','temporalValidity','scope']);
        if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000 || typeof c.span !== 'string' || c.span.length < 3 || !sentence.text.includes(c.span)) throw new Error('Invalid claim span');
        const dimensions = c.text.toLowerCase().match(/\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:benchmark\s+|forecasting\s+)?(?:datasets?|architectures?|%|percent|days?)\b/g) || [];
        if (dimensions.length > 1 && /\b(?:and|using|across|with|achieved)\b/i.test(c.text)) throw new Error('Compound numerical claim must be split');
        if (!['SUPPORTED','CONTRADICTED','INSUFFICIENT_EVIDENCE','TEMPORALLY_INVALID','CONFLICTED'].includes(c.verdict) || !['APPLICABLE','NOT_APPLICABLE','UNKNOWN'].includes(c.temporalValidity)) throw new Error('Invalid verdict');
        const scope = record(c.scope, ['time','place']);
        if ([scope.time, scope.place].some(s => s !== null && (typeof s !== 'string' || s.length > 160))) throw new Error('Invalid scope');
        if (!Array.isArray(c.missingInformation) || c.missingInformation.length > 8 || c.missingInformation.some((s: unknown) => typeof s !== 'string' || !s.trim() || s.length > 300)) throw new Error('Invalid missing information');
        const supporting = quotes(c.supporting, docs, `Claim s${sentence.id}c${j + 1} supporting`), contradicting = quotes(c.contradicting, docs, `Claim s${sentence.id}c${j + 1} contradicting`);
        if (c.verdict === 'SUPPORTED' && (!supporting.length || contradicting.length || c.temporalValidity === 'NOT_APPLICABLE')) throw new Error('Inconsistent support');
        if (c.verdict === 'CONTRADICTED' && !contradicting.length) throw new Error('Missing contradiction');
        if (c.verdict === 'CONFLICTED' && (!supporting.length || !contradicting.length)) throw new Error('Missing conflict evidence');
        if (c.verdict === 'TEMPORALLY_INVALID' && (c.temporalValidity !== 'NOT_APPLICABLE' || !contradicting.length)) throw new Error('Missing temporal evidence');
        let verdict = c.verdict as ClaimVerdict;
        const missingInformation: string[] = [...c.missingInformation];
        if (verdict === 'SUPPORTED' && !numericalEvidenceSupported(c.text + ' ' + c.span, supporting, docs)) {
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
      atomicClaims.push(...extracted);
      if (atomicClaims.length > MAX_FACTS_PER_ANSWER) throw new Error(`The answer exceeds the ${MAX_FACTS_PER_ANSWER}-claim verification budget. Ask a narrower question.`);
      return { sentence: sentence.text, supported, evidenceIndexes };
    });
    const passed = atomicClaims.length > 0 && claims.every(c => c.supported);
    return { passed, schemaValid: true, claims, atomicClaims, verdict: passed ? 'Claims supported by quoted evidence and model assessment' : 'Unresolved factual claims', evidence: atomicClaims.map(c => `${c.id} · ${c.verdict}: ${c.text}${c.missingInformation.length ? ' — ' + c.missingInformation.join('; ') : ''}`).join('\n') };
  } catch (error) { return invalidVerification(error instanceof SyntaxError ? 'The verifier returned invalid JSON.' : (error as Error).message); }
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

/** Conservative acceptance of grounded factual changes; wording changes alone are insufficient. */
export function substantiveRepair(before: Verification, after: Verification, edits: { claimId: string; original: string; replacement: string; evidence: EvidenceQuote[] }[] = []) {
  if (!after.passed || !before.atomicClaims?.length || !after.atomicClaims?.length) return false;
  const failed = before.atomicClaims.filter(c => c.verdict !== 'SUPPORTED');
  let corrected = 0;
  for (const claim of failed) {
    // Entity changes require an actual validated localized edit and fresh quoted
    // support. Lowercase paraphrases cannot pass this additional acceptance path.
    const edit = edits.find(e => e.claimId === claim.id);
    if (edit) {
      const oldUnits = quantityUnits(edit.original), newUnits = quantityUnits(edit.replacement);
      const removedUnits = oldUnits.filter(unit => !newUnits.includes(unit));
      if (removedUnits.length && newUnits.length && unitsSupported(edit.replacement, edit.evidence.map(e => e.quote).join(' '))
        && !after.atomicClaims.some(c => quantityUnits(c.text).some(unit => removedUnits.includes(unit)))
        && after.atomicClaims.some(c => newUnits.every(unit => quantityUnits(c.text).includes(unit)) && c.supporting.length)) {
        corrected++; continue;
      }
      const entities = (text: string) => (text.match(/\b[A-Z][\p{L}\p{N}-]+\b/gu) || [])
        .filter(w => !/^(The|A|An|It|This|That|These|Those|We|They|He|She|In|On|At|For|From|Using|Method|Model|System|Framework|Results|Policy|Company|Organization)$/i.test(w));
      const oldEntities = entities(edit.original).filter(e => !entities(edit.replacement).includes(e));
      const newEntities = entities(edit.replacement).filter(e => !entities(edit.original).includes(e));
      const quotes = edit.evidence.map(e => e.quote).join(' ');
      const unchangedNumbers = JSON.stringify(quantities(edit.original)) === JSON.stringify(quantities(edit.replacement));
      const oldAbsent = oldEntities.length > 0 && oldEntities.every(e => !after.atomicClaims!.some(c => c.text.includes(e)));
      const newSupported = newEntities.length > 0 && newEntities.every(e => quotes.includes(e) && after.atomicClaims!.some(c => c.text.includes(e) && c.supporting.some(q => q.quote.includes(e))));
      if (unchangedNumbers && oldAbsent && newSupported) { corrected++; continue; }
    }
    const anchors = (text: string) => new Set((text.toLowerCase().replace(/\[\d+\]/g, '').match(/[a-z]{3,}/g) || []).filter(w => !['the','was','were','has','had','and','with','that','this','not','one','two','three','four','five','six','seven','eight','nine','ten'].includes(w)).map(w => w.replace(/s$/, '')));
    const originalAnchors = anchors(claim.text);
    const candidates = after.atomicClaims.filter(c => [...anchors(c.text)].some(w => originalAnchors.has(w)));
    const oldNumbers = quantities(claim.text);
    // Same numerical assertion surviving a rewrite is not a factual correction.
    if (oldNumbers.length && candidates.some(c => oldNumbers.every(n => quantities(c.text).includes(n)))) return false;
    if (!oldNumbers.length && candidates.some(c => hasNegation(c.text) === hasNegation(claim.text))) return false;
    const changed = candidates.some(c => c.supporting.length && (oldNumbers.length && quantities(c.text).length && JSON.stringify(oldNumbers) !== JSON.stringify(quantities(c.text)) || hasNegation(c.text) !== hasNegation(claim.text)));
    if (changed) corrected++;
  }
  return corrected > 0;
}
