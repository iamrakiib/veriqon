import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [reportPath, mode, reviewPath] = process.argv.slice(2);
if (!reportPath || !['--template', '--score'].includes(mode)) throw new Error('Usage: node scripts/review-research.mjs REPORT.json --template | --score REVIEW.json');
const raw = readFileSync(reportPath), report = JSON.parse(raw), reportHash = createHash('sha256').update(raw).digest('hex');
const rows = report.rows.map(row => ({ variant: row.variant, case: row.case, answer: row.answer ?? row.result?.draft ?? '', executionFailure: Boolean(row.executionFailure) }));
const fixtureBytes = readFileSync('research/fixtures.json'), fixtures = JSON.parse(fixtureBytes);
if (report.datasetHash !== createHash('sha256').update(fixtureBytes).digest('hex')) throw new Error('The source corpus does not match this report');
if (mode === '--template') {
  const output = reportPath.replace(/\.json$/, '') + '-review.json';
  writeFileSync(output, JSON.stringify({ reportHash, reviewerId: '', independentReview: false,
    instructions: 'An independent reviewer must enumerate ALL factual claims (exact answer spans), label each SUPPORTED, CONTRADICTED or INSUFFICIENT_EVIDENCE, and provide documentId/quote evidence for supported/contradicted claims. Set coverageConfirmed only after checking omissions. citationSupported is a separate judgment about the answer citation, not retrieval relevance. An abstention can have no factual claims. Do not use the tested LLM as the sole reviewer.',
    rows: rows.map(row => ({ ...row, coverageConfirmed: false, claims: [] })) }, null, 2), { flag: 'wx' });
  console.log(`Review template: ${output}`);
} else {
  const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
  if (review.reportHash !== reportHash || !review.reviewerId?.trim() || review.independentReview !== true || review.rows.length !== rows.length) throw new Error('Review is incomplete or belongs to a different report');
  const seen = new Set(), judgments = [];
  for (const row of review.rows) {
    const expected = rows.find(r => r.variant === row.variant && r.case === row.case), key = `${row.variant}:${row.case}`;
    if (!expected || seen.has(key) || expected.answer !== row.answer || !row.coverageConfirmed || !Array.isArray(row.claims)) throw new Error('Missing, duplicate or modified answer review');
    seen.add(key);
    for (const claim of row.claims) {
      if (typeof claim.text !== 'string' || !claim.text.trim() || !row.answer.includes(claim.text) || !['SUPPORTED', 'CONTRADICTED', 'INSUFFICIENT_EVIDENCE'].includes(claim.verdict)
        || typeof claim.citationSupported !== 'boolean' || !Array.isArray(claim.evidence)) throw new Error('Invalid claim judgment');
      if (claim.verdict !== 'INSUFFICIENT_EVIDENCE' && !claim.evidence.length) throw new Error('An evidence-based verdict needs a quote');
      for (const e of claim.evidence) if (typeof e.quote !== 'string' || e.quote.length < 8 || !fixtures.documents.find(d => d.id === e.documentId)?.text.includes(e.quote)) throw new Error('Review evidence is not an exact source passage');
      judgments.push({ ...claim, variant: row.variant });
    }
  }
  const summaries = [...new Set(rows.map(row => row.variant))].map(variant => {
    const claims = judgments.filter(c => c.variant === variant), total = claims.length;
    return { variant, claimsReviewed: total, claimSupportRate: total ? claims.filter(c => c.verdict === 'SUPPORTED').length / total : null,
      unsupportedClaimRate: total ? claims.filter(c => c.verdict !== 'SUPPORTED').length / total : null,
      citationSupportAccuracy: total ? claims.filter(c => c.citationSupported).length / total : null,
      executionFailures: rows.filter(r => r.variant === variant && r.executionFailure).length };
  });
  console.log(JSON.stringify({ reportHash, reviewerId: review.reviewerId, basis: 'Human judgments supplied by the reviewer. Identity, independence and exhaustive coverage are declared, not automatically verified.', summaries }, null, 2));
}
