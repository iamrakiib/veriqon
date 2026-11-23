import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

test('review scoring rejects incomplete reviews, changed corpora and invented quotations', () => {
  const root = mkdtempSync(join(tmpdir(), 'veriqon-research-review-'));
  const script = resolve('scripts/review-research.mjs');
  const corpus = JSON.stringify({ documents: [{ id: 'source', text: 'The experiment used two datasets.' }] });
  const report = { datasetHash: createHash('sha256').update(corpus).digest('hex'), rows: [
    { variant: 'rac-inspired', case: 'synthetic', answer: 'The experiment used two datasets. [1]' },
  ] };
  const run = (...args) => execFileSync(process.execPath, [script, 'report.json', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  try {
    mkdirSync(join(root, 'research')); writeFileSync(join(root, 'research/fixtures.json'), corpus);
    writeFileSync(join(root, 'report.json'), JSON.stringify(report)); run('--template');
    const review = JSON.parse(readFileSync(join(root, 'report-review.json'), 'utf8'));
    assert.throws(() => run('--score', 'report-review.json'));
    review.reviewerId = 'synthetic-test-reviewer'; review.independentReview = true;
    review.rows[0].coverageConfirmed = true;
    review.rows[0].claims = [{ text: 'The experiment used two datasets.', verdict: 'SUPPORTED', citationSupported: true,
      // A supplied claim field must not change which variant receives the judgment.
      variant: 'uncorrected-fixed-draft', evidence: [{ documentId: 'source', quote: 'The experiment used two datasets.' }] }];
    const save = () => writeFileSync(join(root, 'report-review.json'), JSON.stringify(review));
    save(); const scored = JSON.parse(run('--score', 'report-review.json'));
    assert.equal(scored.summaries[0].claimsReviewed, 1); assert.equal(scored.summaries[0].claimSupportRate, 1);
    review.rows[0].claims[0].evidence[0].quote = 'The experiment used five datasets.'; save();
    assert.throws(() => run('--score', 'report-review.json'));
    writeFileSync(join(root, 'research/fixtures.json'), corpus + '\n');
    assert.throws(() => run('--score', 'report-review.json'));
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('veriqon-research-review-'));
    rmSync(root, { recursive: true, force: true });
  }
});
