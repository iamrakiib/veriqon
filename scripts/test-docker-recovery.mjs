import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const project = process.argv[2], state = JSON.parse(readFileSync(process.argv[3], 'utf8'));
if (!/^veriqon-m5(?:-[a-z]+)?$/.test(project)) throw new Error('Only disposable veriqon-m5 test projects are permitted.');
const prefix = ['compose', '-p', project, '--env-file', '.env.docker', '-f', 'compose.yaml', '-f', 'compose.acceptance.yaml'];
const docker = args => execFileSync('docker', [...prefix, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const provider = (path, body) => JSON.parse(docker(['exec', '-T', 'provider', 'node', '-e',
  "fetch('http://127.0.0.1:8080/'+process.argv[1],{method:'POST',headers:{'Content-Type':'application/json'},body:process.argv[2]}).then(r=>r.text()).then(console.log)", path, JSON.stringify(body || {})]));
const origin = 'http://127.0.0.1:3002'; let cookie;
async function api(path, body) {
  const r = await fetch(origin + '/api/' + path, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
    headers: { 'X-Veriqon-Request': '1', ...(cookie ? { cookie } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const result = await r.json(); assert.ok(r.ok, JSON.stringify(result));
  if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return result;
}
async function until(check, timeout) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await delay(1000); } throw new Error('Container checkpoint recovery deadline exceeded'); }
await api('auth/login', { email: state.email, password: state.password });
const before = provider('stats'); provider('control', { hold: true });
const form = new FormData(); form.append('file', new Blob([Array.from({ length: 70 }, (_, i) => `Section ${i}. This synthetic recovery document discusses infrastructure checkpoint number ${i} and durable storage.`).join('\n')]), 'checkpoint-recovery.txt');
const job = await api('rag/uploads', form);
try {
  await until(async () => (await api('rag/uploads')).find(j => j.id === job.id)?.completedChunks === 2, 45000);
  docker(['kill', '-s', 'SIGKILL', 'worker']);
  provider('control', { hold: false });
  const start = Date.now();
  docker(['up', '-d', '--no-build', '--no-deps', 'worker']);
  // Real lease expiry: no SQL timestamps or job state are rewritten by this test.
  await until(async () => (await api('rag/uploads')).find(j => j.id === job.id)?.status === 'completed', 360000);
  const completed = (await api('rag/uploads')).find(j => j.id === job.id);
  const after = provider('stats');
  assert.equal(completed.completedChunks, completed.totalChunks);
  assert.equal(after.embeddings - before.embeddings, completed.totalChunks, 'Successful saved embedding batches must not be repeated');
  for (const [hash, count] of Object.entries(after.inputsSeen)) if (!before.inputsSeen[hash]) assert.equal(count, 1);
  assert.equal((await api('rag/docs')).filter(d => d.id === completed.documentId).length, 1);
  console.log(JSON.stringify({ passed: true, realLeaseExpiry: true, savedBeforeCrash: 2, totalChunks: completed.totalChunks, embeddings: after.embeddings - before.embeddings, recoveryMs: Date.now() - start }));
} finally { provider('control', { hold: false }); }
