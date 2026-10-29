import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';

test('recovery codes: HTTP authorization, hashed storage, regeneration, atomic single use and session revocation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'veriqon-recovery-'));
  const previous = { ...process.env };
  Object.assign(process.env, { DATABASE_PATH: join(directory, 'test.sqlite'), DOCUMENT_STORE_PATH: join(directory, 'legacy.json'), SETUP_CODE_PATH: join(directory, 'setup.txt'), SETUP_CODE: randomBytes(32).toString('hex'), JWT_SECRET: randomBytes(48).toString('hex'), ALLOW_REGISTRATION: 'true', NODE_ENV: 'test', APP_ORIGINS: 'http://localhost:3001', AUTH_COOKIE_SECURE: 'false' });
  delete process.env.DATABASE_URL; delete process.env.REDIS_URL;
  const schema = 'test_' + randomUUID().replace(/-/g, '');
  const admin = process.env.TEST_DATABASE_URL ? new Pool({ connectionString: process.env.TEST_DATABASE_URL }) : undefined;
  if (admin) {
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
  }
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), database = app.get(DatabaseService);
  const request = (path: string, body?: unknown, cookie = '') => fetch(base + '/auth/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Veriqon-Request': '1', Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const cookies = (r: Response) => r.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const email = 'recovery@example.test', password = 'original password for test', replacement = 'replacement password for test';
  try {
    const registration = await request('register', { email, name: 'Recovery test', password, setupCode: process.env.SETUP_CODE });
    assert.equal(registration.status, 201);
    const { recoveryCodes, user } = await registration.json() as { recoveryCodes: string[]; user: { id: string } };
    assert.equal(new Set(recoveryCodes).size, 8);
    assert.match(recoveryCodes[0], /^[A-F0-9]{8}(-[A-F0-9]{8}){3}$/);
    const session = cookies(registration);
    assert.equal((await request('recovery-codes')).status, 401);
    assert.deepEqual(await request('recovery-codes', undefined, session).then(r => r.json()), { remaining: 8 });
    const stored = await database.get('SELECT code_hash FROM recovery_codes WHERE user_id=?', user.id);
    assert.match(String(stored?.code_hash), /^[a-f0-9]{64}$/);
    assert.ok(!recoveryCodes.some(code => code.replace(/-/g, '').toLowerCase() === stored?.code_hash));
    const wrong = await request('recover', { email, code: '0'.repeat(32), password: replacement });
    const unknown = await request('recover', { email: 'missing@example.test', code: recoveryCodes[0], password: replacement });
    assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
    assert.deepEqual(await wrong.json(), await unknown.json());
    assert.equal((await request('recovery-codes', { password: 'incorrect' }, session)).status, 403);
    const regeneration = await request('recovery-codes', { password }, session);
    assert.equal(regeneration.status, 200); assert.equal(regeneration.headers.get('cache-control'), 'no-store');
    const { codes } = await regeneration.json() as { codes: string[] };
    assert.equal(codes.length, 8);
    assert.equal((await request('recover', { email, code: recoveryCodes[0], password: replacement })).status, 401);
    const races = await Promise.all([1, 2].map(() => request('recover', { email, code: codes[0].toLowerCase().replace(/-/g, ' '), password: replacement })));
    assert.deepEqual(races.map(r => r.status).sort(), [200, 401], 'Only one concurrent request may consume a code');
    assert.equal((await request('me', undefined, session)).status, 401);
    assert.equal((await request('refresh', {}, session)).status, 401);
    await database.run('DELETE FROM auth_limits'); // Independent login assertions have their own rate-limit window.
    assert.equal((await request('login', { email, password })).status, 401);
    const login = await request('login', { email, password: replacement });
    assert.equal(login.status, 200);
    assert.deepEqual(await request('recovery-codes', undefined, cookies(login)).then(r => r.json()), { remaining: 7 });
    assert.ok(await database.get('SELECT id FROM security_events WHERE user_id=? AND event=?', user.id, 'password_recovered_sessions_revoked'));
    const other = await request('register', { email: 'other@example.test', name: 'Other', password });
    assert.equal(other.status, 201);
    assert.equal((await request('recover', { email: 'other@example.test', code: codes[1], password: replacement })).status, 401);
  } finally {
    await app.close();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(directory, { recursive: true, force: true });
  }
});
