import { BadRequestException } from '@nestjs/common';

export type SourceMetadata = {
  publishedAt?: string; effectiveFrom?: string; effectiveTo?: string;
  scope?: string; authority?: string; supersedes?: string;
};
export type TemporalScope = { from: string; to: string; kind: 'current' | 'date' | 'year' | 'range' };
/** Intent boundary shared by retrieval and caching; the caller also checks file scope. */
export function sourceInspectionRequested(question: string, scope: TemporalScope) {
  return scope.kind === 'current' && /\b(according to|what (?:does|did)|quote|summari[sz]e|summary|overview|describe)\b/i.test(question)
    && !/\b(current|currently|today|now|latest)\b/i.test(question);
}
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= '0001-01-01' && value <= '9998-12-31'
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function nextDay(date: string) { return new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10); }
export function temporalScope(question: string, asOf?: string, now = new Date()): TemporalScope {
  if (asOf !== undefined && !validDate(asOf)) throw new BadRequestException('Use an actual calendar date in YYYY-MM-DD format.');
  if (asOf) return { from: asOf, to: nextDay(asOf), kind: 'date' };
  const periods: TemporalScope[] = [];
  const dateLists = question.matchAll(/\b(?:as of|on|effective on|between|from)\s+(\d{4}-\d{2}-\d{2}(?:\s*(?:and|to|through|versus|vs\.?)\s*(?:on\s+)?\d{4}-\d{2}-\d{2})*)\b/gi);
  for (const list of dateLists) for (const date of list[1].match(/\d{4}-\d{2}-\d{2}/g) || []) {
    if (!validDate(date)) throw new BadRequestException('The requested calendar date is invalid; use a date in years 0001–9998.');
    periods.push({ from: date, to: nextDay(date), kind: 'date' });
  }
  // Only explicit temporal phrases. A number in a filename or bibliography is not query scope.
  const yearLists = question.matchAll(/\b(?:in|during|for the year|between|from)\s+((?:19|20)\d{2}(?:\s*(?:,|and|to|through|versus|vs\.?)\s*(?:(?:in|during)\s+)?(?:19|20)\d{2})*)\b(?!-\d)/gi);
  for (const list of yearLists) for (const year of list[1].match(/(?:19|20)\d{2}/g) || []) periods.push({ from: `${year}-01-01`, to: `${Number(year) + 1}-01-01`, kind: 'year' });
  const today = now.toISOString().slice(0, 10);
  if (!periods.length || /\b(current|currently|today|now|latest)\b/i.test(question)) periods.push({ from: today, to: nextDay(today), kind: 'current' });
  const distinct = [...new Map(periods.map(p => [`${p.from}/${p.to}`, p])).values()];
  if (distinct.length === 1) return distinct[0];
  // A comparison retrieves the enclosing interval, retaining each source's
  // metadata. It does not assert that one source applies to the whole range.
  return { from: distinct.map(p => p.from).sort()[0], to: distinct.map(p => p.to).sort().at(-1)!, kind: 'range' };
}
export function validateMetadata(input: SourceMetadata): SourceMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['publishedAt','effectiveFrom','effectiveTo','scope','authority','supersedes'].includes(k))) throw new BadRequestException('Invalid source metadata.');
  const result: SourceMetadata = {};
  for (const key of ['publishedAt','effectiveFrom','effectiveTo'] as const) {
    if (input[key]) { if (!validDate(input[key])) throw new BadRequestException(`${key} must be an actual YYYY-MM-DD date.`); result[key] = input[key]; }
  }
  for (const key of ['scope','authority','supersedes'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key]!.length > 160 || input[key]!.includes('\0'))) throw new BadRequestException(`Invalid ${key}.`);
    if (input[key]?.trim()) result[key] = input[key]!.trim();
  }
  if (result.effectiveFrom && result.effectiveTo && result.effectiveFrom > result.effectiveTo) throw new BadRequestException('Effective end cannot precede effective start.');
  return result;
}
export function applicable(meta: SourceMetadata, scope: TemporalScope) {
  // User-supplied effective dates only. Publication and upload dates never establish validity.
  return (!meta.effectiveFrom || meta.effectiveFrom < scope.to) && (!meta.effectiveTo || meta.effectiveTo >= scope.from);
}
export function fullyApplicable(meta: SourceMetadata, scope: TemporalScope) {
  return Boolean(meta.effectiveFrom && meta.effectiveFrom <= scope.from && (!meta.effectiveTo || nextDay(meta.effectiveTo) >= scope.to));
}
export function sameScope(a: SourceMetadata, b: SourceMetadata) {
  return Boolean(a.scope && b.scope && a.scope.normalize('NFKC').toLowerCase() === b.scope.normalize('NFKC').toLowerCase());
}
