// Read-mostly local API probes. Synthetic-account credentials and raw responses are never printed.
// Invalid writes are deliberate validation probes; no valid document/query writes or model calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { request } from '@playwright/test';

const origin = 'http://127.0.0.1:3000';
const account = JSON.parse(fs.readFileSync('data/hard-query-account.json', 'utf8'));
assert.ok(account.email.startsWith('hard-query-'), 'Only the isolated synthetic evaluation account is allowed');
const api = await request.newContext({ baseURL: origin, extraHTTPHeaders: { 'X-Veriqon-Request': '1' }, timeout: 15000 });
const anonymous = await request.newContext({ baseURL: origin, extraHTTPHeaders: { 'X-Veriqon-Request': '1' }, timeout: 15000 });
const checks = [];
const report = { checkedAt: new Date().toISOString(), method: 'Real localhost HTTP, isolated synthetic account, no model calls. Small read burst is not a capacity benchmark.', checks };
const check = async (name, action, expected) => {
  const started = performance.now();
  const response = await action();
  const passed = response.status() === expected;
  checks.push({ name, expected, status: response.status(), passed, elapsedMs: Math.round(performance.now() - started) });
  assert.ok(passed, `${name}: HTTP ${response.status()}, expected ${expected}`);
  return response;
};
try {
  await check('synthetic account login', () => api.post('/auth/login', { data: { email: account.email, password: account.password } }), 200);
  const health = await check('API health', () => api.get('/rag/health'), 200);
  report.capabilities = (await health.json()).capabilities;
  await check('storage readiness', () => api.get('/rag/ready'), 200);
  for (const path of ['/rag/docs', '/rag/conversations', '/rag/conflicts', '/auth/me', '/auth/recovery-codes']) {
    await check(`unauthenticated ${path}`, () => anonymous.get(path), 401);
  }
  await check('forged bearer token', () => anonymous.get('/rag/docs', { headers: { Authorization: 'Bearer invalid.synthetic.token' } }), 401);
  await check('account-switch header', () => api.get('/rag/docs', { headers: { 'X-Veriqon-Account': 'different-synthetic-account' } }), 409);
  await check('cross-origin query', () => api.post('/rag/query', { headers: { Origin: 'https://untrusted.example' }, data: { query: 'Must be rejected' } }), 403);
  await check('missing anti-CSRF header', () => api.post('/rag/query', { headers: { 'X-Veriqon-Request': '' }, data: { query: 'Must be rejected' } }), 403);
  for (const data of [{ query: ' ' }, { query: ['array'] }, { query: 'x'.repeat(4001) }, { query: 'x', ownerId: 'injected' }, { query: 'x', messageId: '../invalid' }]) {
    await check('invalid query shape', () => api.post('/rag/query', { data }), 400);
  }
  await check('invalid history cursor', () => api.get('/rag/conversations?before=%27%20OR%201%3D1'), 400);
  await check('document path traversal', () => api.get('/rag/docs/..%2F..%2F.env/file'), 404);
  await check('SQL-shaped document identifier', () => api.get('/rag/docs/%27%20OR%201%3D1/file'), 404);
  await check('empty bulk ingestion', () => api.post('/rag/bulk-add', { data: { documents: [] } }), 400);
  await check('extra bulk owner field', () => api.post('/rag/bulk-add', { data: { documents: [{ id: 'bad', text: 'Rejected', ownerId: 'injected' }] } }), 400);
  for (const [name, buffer] of [['empty.txt', Buffer.alloc(0)], ['invalid.docx', Buffer.from('not a ZIP document')], ['executable.exe', Buffer.from('not a permitted document')]]) {
    await check(`reject ${name}`, () => api.post('/rag/upload', { multipart: { file: { name, mimeType: 'application/octet-stream', buffer } } }), 400);
  }
  const paths = ['/rag/docs', '/rag/conversations', '/rag/conflicts', '/rag/ready'];
  const latency = [];
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < 40) {
      const index = next++;
      const started = performance.now();
      const response = await api.get(paths[index % paths.length]);
      assert.equal(response.status(), 200, `Read burst ${index}`);
      await response.json();
      assert.match(response.headers()['cache-control'], /no-store/);
      latency.push(performance.now() - started);
    }
  }));
  latency.sort((a, b) => a - b);
  report.readBurst = { requests: latency.length, concurrency: 5, passed: true, p50Ms: Math.round(latency[19]), p95Ms: Math.round(latency[37]), maxMs: Math.round(latency[39]) };
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error instanceof Error ? error.message : 'Probe failed'; process.exitCode = 1;
} finally {
  await api.post('/auth/logout').catch(() => {});
  await api.dispose(); await anonymous.dispose();
  fs.writeFileSync('data/reassessment-api.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
