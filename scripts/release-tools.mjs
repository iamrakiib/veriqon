import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

export function sourceFiles(root = process.cwd()) {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
  return [...new Set(names)].filter(name => existsSync(resolve(root, name))).sort().map(name => {
    if (name.includes('..') || name.startsWith('/') || !lstatSync(resolve(root, name)).isFile()) throw new Error('Release sources must be regular files inside the repository.');
    return name;
  });
}
const privatePath = /(?:^|\/)(?:node_modules|\.next|dist|data|\.vercel|test-results|playwright-report)(?:\/|$)|(?:^|\/)\.env(?:\.[^/]*)?$|\.(?:sqlite(?:-wal|-shm)?|db|dump|pem|key|log|tsbuildinfo)$/i;
const allowedTemplate = /(?:^|\/)\.env\.example$/;
const signatures = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['provider-key', /\bsk-or-v1-[a-f0-9]{32,}\b/gi],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['google-key', /\bAIza[A-Za-z0-9_-]{30,}\b/g],
];
function privateValues(root) {
  const values = new Set();
  for (const name of readdirSync(root).filter(n => /^\.env(?:\.|$)/.test(n) && !n.endsWith('.example'))) {
    if (!lstatSync(resolve(root, name)).isFile()) continue;
    for (const [key, value] of Object.entries(parse(readFileSync(resolve(root, name))))) {
      if (/(?:SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL|REDIS_URL|SETUP_CODE)/.test(key) && value.length >= 16) values.add(value);
    }
  }
  const data = resolve(root, 'data');
  if (existsSync(data)) for (const name of readdirSync(data).filter(n => /^(?:setup-code|password-reset-.*)\.txt$/.test(n))) {
    for (const token of readFileSync(resolve(data, name), 'utf8').match(/[A-Za-z0-9_-]{24,}/g) || []) values.add(token);
  }
  return [...values].map(value => Buffer.from(value));
}
export function auditSources(root = process.cwd(), history = false) {
  const files = sourceFiles(root), secrets = privateValues(root), findings = [];
  const inspect = (buffer, location) => {
    if (secrets.some(secret => buffer.includes(secret))) findings.push({ location, rule: 'matches-private-local-value' });
    const text = buffer.toString('utf8');
    for (const [rule, pattern] of signatures) { pattern.lastIndex = 0; if (pattern.test(text)) findings.push({ location, rule }); }
    for (const match of text.matchAll(/(?:postgres(?:ql)?|rediss?):\/\/[^\s'"`]+/g)) {
      try {
        const url = new URL(match[0]);
        if (url.password && !['localhost', '127.0.0.1', 'postgres', 'redis', 'db'].includes(url.hostname)
          && !/example|placeholder|\$|\{|<|YOUR_/i.test(match[0])) findings.push({ location, rule: 'credential-bearing-remote-url' });
      } catch { /* Template strings and examples are not credentials. */ }
    }
  };
  const manifest = files.map(path => {
    if (privatePath.test(path) && !allowedTemplate.test(path)) findings.push({ location: path, rule: 'operational-or-private-file' });
    const bytes = readFileSync(resolve(root, path)); inspect(bytes, path);
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  let historyObjects = 0;
  if (history) {
    const objects = execFileSync('git', ['rev-list', '--objects', '--all'], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString().trim().split('\n').filter(Boolean);
    const names = new Map(objects.map(line => { const i = line.indexOf(' '); return i < 0 ? [line, ''] : [line.slice(0, i), line.slice(i + 1)]; }));
    const batch = names.size ? execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: [...names.keys()].join('\n') + '\n', maxBuffer: 128 * 1024 * 1024 }) : Buffer.alloc(0);
    let offset = 0;
    while (offset < batch.length) {
      const end = batch.indexOf(10, offset), [id, type, length] = batch.subarray(offset, end).toString().split(' ');
      const size = Number(length); if (end < 0 || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid Git object stream');
      const content = batch.subarray(end + 1, end + 1 + size); offset = end + size + 2; historyObjects++;
      if (type === 'blob') {
        const name = names.get(id) || '';
        if (privatePath.test(name) && !allowedTemplate.test(name)) findings.push({ location: `history:${id.slice(0, 12)}:${name}`, rule: 'operational-or-private-file' });
        inspect(content, `history:${id.slice(0, 12)}:${name}`);
      }
    }
  }
  return { passed: findings.length === 0, files: manifest.length, historyObjects, privateValuesCompared: secrets.length, findings, manifest };
}
