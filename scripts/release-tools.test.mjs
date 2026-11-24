import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { auditSources } from './release-tools.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'veriqon-release-audit-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet'); git('config', 'user.name', 'Synthetic audit test'); git('config', 'user.email', 'audit@example.test');
  writeFileSync(join(root, '.gitignore'), '.env\ndata/\n');
  writeFileSync(join(root, 'README.md'), 'Synthetic source');
  const close = () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    assert.ok(root.includes('veriqon-release-audit-'));
    rmSync(root, { recursive: true, force: true });
  };
  return { root, git, close };
}
test('audit scans uncommitted sources without copying ignored secrets or requiring a first commit', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, '.env'), `JWT_SECRET=${randomBytes(32).toString('hex')}`);
    const result = auditSources(f.root, true);
    assert.equal(result.passed, true); assert.equal(result.historyObjects, 0);
    assert.equal(result.manifest.some(file => file.path === '.env'), false);
    assert.equal(result.manifest.some(file => file.path === 'README.md'), true);
  } finally { f.close(); }
});
test('audit rejects local secret values in source and reachable history without echoing them', () => {
  const f = fixture();
  try {
    const secret = randomBytes(32).toString('base64url');
    writeFileSync(join(f.root, '.env'), `JWT_SECRET=${secret}`);
    writeFileSync(join(f.root, 'accidental.txt'), secret);
    const first = auditSources(f.root);
    assert.equal(first.passed, false); assert.ok(!JSON.stringify(first).includes(secret));
    f.git('add', '.'); f.git('commit', '--quiet', '-m', 'Synthetic exposure fixture');
    f.git('rm', 'accidental.txt'); f.git('commit', '--quiet', '-m', 'Synthetic removal fixture');
    assert.equal(auditSources(f.root).passed, true);
    const history = auditSources(f.root, true);
    assert.equal(history.passed, false); assert.ok(history.findings.some(f => f.location.startsWith('history:')));
    assert.ok(!JSON.stringify(history).includes(secret));
  } finally { f.close(); }
});
test('audit rejects tracked operational files and remote credential URLs', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'dump.sqlite'), 'synthetic binary placeholder');
    writeFileSync(join(f.root, 'config.txt'), 'postgresql://' + 'someone:synthetic-test-value@db.invalid/library');
    const result = auditSources(f.root);
    assert.equal(result.passed, false);
    assert.deepEqual(new Set(result.findings.map(f => f.rule)), new Set(['operational-or-private-file', 'credential-bearing-remote-url']));
  } finally { f.close(); }
});
