// Real container HTTP workflow; only the compose.acceptance.yaml inference endpoint is scripted.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
const phase = process.argv[2], statePath = resolve(process.argv[3] || 'data/docker-acceptance-state.json');
if (!['exercise', 'verify'].includes(phase)) throw new Error('Use exercise|verify followed by a private state-file path; run only against disposable acceptance Compose on localhost:3002.');
const origin = 'http://127.0.0.1:3002';
let cookie = '';
async function request(path, method = 'GET', body, status = 200) {
  const response = await fetch(origin + '/api/' + path, { method, signal: AbortSignal.timeout(120000),
    headers: { 'X-Veriqon-Request': '1', origin, ...(cookie ? { cookie } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const value = await response.json(); assert.equal(response.status, status, `${path}: ${JSON.stringify(value).slice(0, 300)}`);
  if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return value;
}
async function until(check, label, timeout = 90000) {
  const end = Date.now() + timeout; let value;
  while (Date.now() < end) { value = await check(); if (value) return value; await delay(1000); }
  throw new Error('Timed out: ' + label);
}
function pdf(lines) {
  const stream = 'BT /F1 12 Tf 50 740 Td ' + lines.map((line, i) => `${i ? '0 -20 Td ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`).join('\n') + ' ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}
async function upload(name, bytes) {
  const form = new FormData(); form.append('file', new Blob([bytes]), name);
  const job = await request('rag/uploads', 'POST', form, 202);
  await until(async () => (await request('rag/uploads')).some(j => j.id === job.id && j.status === 'completed'), 'index ' + name);
  return (await request('rag/docs')).find(d => d.source === name);
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function verify(state) {
  const versions = await request(`rag/messages/${state.messageId}/version-history`);
  assert.equal(versions.items[0].result.verificationStatus, 'REPAIRED_VERIFIED');
  assert.match(versions.items[0].result.draft, /one remote day/);
  assert.match(versions.items[0].result.draft, /twenty vacation days/);
  assert.equal(versions.items.at(-1).result.draft, state.original);
  assert.ok(versions.items[0].result.citations.every(c => c.version));
  if (state.versionSequences) assert.deepEqual(versions.items.map(v => v.sequence), state.versionSequences, 'No duplicate assessments after restart/restore');
  const archive = await request(`rag/docs/${state.oldId}/version-history`);
  assert.ok(archive.items.length);
  assert.ok((await request(`rag/conflicts/${state.conflictId}/decision-history`)).items.length);
  const download = await fetch(origin + `/api/rag/docs/${state.oldId}/file`, { headers: { cookie } });
  assert.equal(download.status, 200); assert.equal(hash(Buffer.from(await download.arrayBuffer())), state.fileHash);
  const history = await request(`rag/conversations/${state.conversationId}/messages`); assert.ok(JSON.stringify(history).includes(state.messageId));
  return versions.items.map(v => v.sequence);
}
assert.equal((await fetch(origin)).status, 200);
if (phase === 'exercise') {
  const settings = readFileSync('.env.docker', 'utf8');
  const setupCode = settings.match(/^SETUP_CODE=(.+)$/m)?.[1].trim();
  assert.ok(setupCode);
  const state = { email: `docker-${randomBytes(4).toString('hex')}@example.test`, password: randomBytes(24).toString('hex') };
  const registration = await request('auth/register', 'POST', { ...state, name: 'Docker acceptance owner', setupCode }, 201);
  assert.equal(registration.recoveryCodes.length, 8);
  const bytes = pdf(['Engineering permits three remote days.', 'Benefits include twenty vacation days.']);
  const old = await upload('policy-original.pdf', bytes);
  state.oldId = old.id; state.fileHash = hash(bytes);
  await request(`rag/docs/${old.id}/metadata`, 'PUT', { metadata: { effectiveFrom: '2024-01-01' }, expectedRevision: 0, reason: 'Confirmed date in the synthetic policy fixture.' });
  const answer = await request('rag/query', 'POST', { query: 'What is the current Engineering remote-work allowance and vacation benefit?' });
  assert.equal(answer.verificationStatus, 'VERIFIED_UNCHANGED');
  state.messageId = answer.messageId; state.conversationId = answer.conversationId; state.original = answer.draft;
  const revised = await upload('policy-revised.pdf', pdf(['Engineering permits one remote day.', 'Benefits include twenty vacation days.']));
  await until(async () => (await request(`rag/messages/${answer.messageId}/version-history`)).items[0]?.result.verificationStatus === 'UNRESOLVED_CONFLICT', 'automatic conflict assessment');
  const conflict = (await request('rag/conflicts')).records.find(c => c.claim === 'Engineering permits three remote days.');
  assert.ok(conflict); state.conflictId = conflict.id;
  await request(`rag/conflicts/${conflict.id}/decision`, 'POST', { action: 'PREFER_SOURCE', preferredDocumentId: revised.id, expectedRevision: conflict.revision, explanation: 'Synthetic policy owner confirms the revised one-day policy is authoritative.' }, 201);
  await until(async () => (await request(`rag/messages/${answer.messageId}/version-history`)).items[0]?.result.verificationStatus === 'REPAIRED_VERIFIED', 'automatic factual correction');
  state.versionSequences = await verify(state);
  writeFileSync(statePath, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  console.log('PASS: production container PDF indexing, citations, automatic conflict/correction, preserved benefit, archives, history and original bytes. Scripted HTTP inference only.');
} else {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  await request('auth/login', 'POST', { email: state.email, password: state.password });
  await verify(state);
  const scanned = new FormData(); scanned.append('file', new Blob([pdf([])]), 'no-text.pdf');
  const unreadable = await request('rag/uploads', 'POST', scanned, 400);
  assert.match(unreadable.message, /OCR/);
  const answer = await request('rag/query', 'POST', { query: 'What is the current Engineering remote-work allowance and vacation benefit?' });
  assert.equal(answer.verificationStatus, 'REPAIRED_VERIFIED');
  console.log('PASS: persisted files, source archives, original/corrected assessments, decision audit and conversations; fresh retrieval/verified repair works.');
}
